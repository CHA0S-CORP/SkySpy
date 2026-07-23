"""
Authentication views for SkySpy.

Provides endpoints for:
- Login/logout (local and OIDC)
- Token refresh
- User profile
- Password change
"""

import contextlib
import logging

from django.conf import settings
from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.db import DatabaseError
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenRefreshView

from skyspy.api.throttles import AuthRateThrottle
from skyspy.auth.serializers import (
    LoginSerializer,
    PasswordChangeSerializer,
    UserProfileSerializer,
)
from skyspy.models.auth import FEATURE_PERMISSIONS, FeatureAccess, SkyspyUser

logger = logging.getLogger(__name__)


class AuthConfigView(APIView):
    """
    Get authentication configuration.

    This endpoint is always public and returns information about
    how authentication is configured for this instance.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        config = {
            "auth_mode": getattr(settings, "AUTH_MODE", "hybrid"),
            "auth_enabled": getattr(settings, "AUTH_MODE", "hybrid") != "public",
            "oidc_enabled": getattr(settings, "OIDC_ENABLED", False),
            "oidc_provider_name": getattr(settings, "OIDC_PROVIDER_NAME", ""),
            "local_auth_enabled": getattr(settings, "LOCAL_AUTH_ENABLED", True),
            "api_key_enabled": getattr(settings, "API_KEY_ENABLED", True),
            # Local dev (DEV_MODE): the backend relaxes auth gates, so the UI can
            # surface AI/system entries even to an anonymous dev session.
            "dev_mode": bool(getattr(settings, "DEV_MODE", False)),
            # Map clustering threshold — the Live Map mirrors this to flip between
            # cluster-bubble and raw-dart rendering (must match the server branch
            # in mixins/aircraft.py::_get_aircraft_clusters).
            "map_cluster_zoom_threshold": getattr(settings, "MAP_CLUSTER_ZOOM_THRESHOLD", 8),
        }

        # Include feature access configuration
        features = {}
        for feature in FeatureAccess.objects.all():
            features[feature.feature] = {
                "read_access": feature.read_access,
                "write_access": feature.write_access,
                "is_enabled": feature.is_enabled,
            }

        # Add defaults for missing features
        for feature_name in FEATURE_PERMISSIONS:
            if feature_name not in features:
                features[feature_name] = {
                    "read_access": "authenticated",
                    "write_access": "permission",
                    "is_enabled": True,
                }

        config["features"] = features

        return Response(config)


class LoginView(APIView):
    """
    Local username/password login.

    Returns JWT access and refresh tokens on success.
    """

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [AuthRateThrottle]

    def post(self, request):
        # Check if local auth is enabled
        if not getattr(settings, "LOCAL_AUTH_ENABLED", True):
            return Response({"error": "Local authentication is disabled"}, status=status.HTTP_403_FORBIDDEN)

        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        username = serializer.validated_data["username"]
        password = serializer.validated_data["password"]

        # Check if user exists and is active BEFORE authenticating
        # Django's authenticate() returns None for inactive users, so we need to check first
        target_user = None
        try:
            target_user = User.objects.get(username=username)
        except User.DoesNotExist:
            # Try email as username
            with contextlib.suppress(User.DoesNotExist):
                target_user = User.objects.get(email=username)

        # Check if account is disabled before attempting authentication
        if target_user and not target_user.is_active:
            return Response({"error": "Account is disabled"}, status=status.HTTP_403_FORBIDDEN)

        # Authenticate
        user = authenticate(request, username=username, password=password)

        if user is None and target_user:
            # Try email as username if we found the user by email
            user = authenticate(request, username=target_user.username, password=password)

        if user is None:
            return Response({"error": "Invalid credentials"}, status=status.HTTP_401_UNAUTHORIZED)

        # Ensure profile exists
        profile, _ = SkyspyUser.objects.get_or_create(
            user=user, defaults={"auth_provider": "local", "display_name": user.get_full_name() or user.username}
        )

        # Generate tokens
        refresh = RefreshToken.for_user(user)

        # Build response
        response_data = {
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "user": {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "is_superuser": user.is_superuser,
                "is_staff": user.is_staff,
                "display_name": profile.display_name,
                "permissions": profile.get_all_permissions(),
                "roles": [ur.role.name for ur in user.user_roles.all()],
            },
        }

        response = Response(response_data)

        # Set refresh token in httpOnly cookie for security
        if getattr(settings, "JWT_AUTH_COOKIE", False):
            response.set_cookie(
                "refresh_token",
                str(refresh),
                max_age=settings.SIMPLE_JWT.get("REFRESH_TOKEN_LIFETIME").total_seconds(),
                httponly=True,
                secure=not settings.DEBUG,
                samesite="Lax",
            )

        logger.info(f"User logged in: {user.username}")
        return response


class LogoutView(APIView):
    """
    Logout and invalidate refresh token.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            # Get refresh token from body or cookie
            refresh_token = request.data.get("refresh")
            if not refresh_token:
                refresh_token = request.COOKIES.get("refresh_token")

            if refresh_token:
                # Blacklist the refresh token
                token = RefreshToken(refresh_token)
                token.blacklist()

        except (TokenError, InvalidToken, DatabaseError) as e:
            logger.debug(f"Logout token blacklist failed: {e}")

        response = Response({"message": "Logged out successfully"})

        # Clear refresh token cookie
        response.delete_cookie("refresh_token")
        response.delete_cookie("access_token")

        return response


class TokenRefreshViewCustom(TokenRefreshView):
    """
    Refresh access token.

    Can use refresh token from body or httpOnly cookie.
    """

    throttle_classes = [AuthRateThrottle]

    def post(self, request, *args, **kwargs):
        # Try to get refresh token from cookie if not in body
        if "refresh" not in request.data:
            refresh_token = request.COOKIES.get("refresh_token")
            if refresh_token:
                request.data["refresh"] = refresh_token

        return super().post(request, *args, **kwargs)


class ProfileView(APIView):
    """
    Get and update current user's profile.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            profile = request.user.skyspy_profile
        except SkyspyUser.DoesNotExist:
            # Create profile if it doesn't exist
            profile = SkyspyUser.objects.create(
                user=request.user, display_name=request.user.get_full_name() or request.user.username
            )

        serializer = UserProfileSerializer(profile)
        return Response(serializer.data)

    def patch(self, request):
        try:
            profile = request.user.skyspy_profile
        except SkyspyUser.DoesNotExist:
            profile = SkyspyUser.objects.create(
                user=request.user, display_name=request.user.get_full_name() or request.user.username
            )

        serializer = UserProfileSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        return Response(serializer.data)


class PasswordChangeView(APIView):
    """
    Change current user's password.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        # Only allow for local users
        try:
            profile = request.user.skyspy_profile
            if profile.auth_provider != "local":
                return Response(
                    {"error": "Password change not available for OIDC users"}, status=status.HTTP_400_BAD_REQUEST
                )
        except SkyspyUser.DoesNotExist:
            pass

        serializer = PasswordChangeSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()

        return Response({"message": "Password changed successfully"})


class OIDCAuthorizeView(APIView):
    """
    Get OIDC authorization URL.

    Redirects the user to the OIDC provider for authentication.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        if not getattr(settings, "OIDC_ENABLED", False):
            return Response({"error": "OIDC authentication is not enabled"}, status=status.HTTP_403_FORBIDDEN)

        # Build authorization URL
        from urllib.parse import urlencode

        from skyspy.auth.oidc import get_endpoints

        client_id = getattr(settings, "OIDC_CLIENT_ID", "")
        redirect_uri = request.build_absolute_uri("/api/v1/auth/oidc/callback/")
        scopes = getattr(settings, "OIDC_SCOPES", "openid profile email")

        # Generate state for CSRF protection
        import secrets

        state = secrets.token_urlsafe(32)
        request.session["oidc_state"] = state

        params = {
            "client_id": client_id,
            "response_type": "code",
            "scope": scopes,
            "redirect_uri": redirect_uri,
            "state": state,
        }

        # Use the provider's discovered authorization endpoint (works with hosted
        # IdPs like Google/Auth0/Okta), falling back to the legacy /authorize path.
        authorization_endpoint = get_endpoints()["authorization_endpoint"]
        auth_url = f"{authorization_endpoint}?{urlencode(params)}"

        return Response({"authorization_url": auth_url})


class OIDCCallbackView(APIView):
    """
    Handle OIDC callback.

    Exchanges authorization code for tokens and creates/updates user.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        if not getattr(settings, "OIDC_ENABLED", False):
            return Response({"error": "OIDC authentication is not enabled"}, status=status.HTTP_403_FORBIDDEN)

        # Verify state using constant-time comparison to prevent timing attacks
        import secrets

        state = request.GET.get("state")
        expected_state = request.session.get("oidc_state")
        if not state or not secrets.compare_digest(state, expected_state or ""):
            return Response({"error": "Invalid state parameter"}, status=status.HTTP_400_BAD_REQUEST)

        # Get authorization code
        code = request.GET.get("code")
        error = request.GET.get("error")

        if error:
            return Response({"error": f"OIDC error: {error}"}, status=status.HTTP_400_BAD_REQUEST)

        if not code:
            return Response({"error": "No authorization code received"}, status=status.HTTP_400_BAD_REQUEST)

        # Exchange code for tokens
        import httpx

        from skyspy.auth.oidc import decode_id_token, get_endpoints

        client_id = getattr(settings, "OIDC_CLIENT_ID", "")
        client_secret = getattr(settings, "OIDC_CLIENT_SECRET", "")
        redirect_uri = request.build_absolute_uri("/api/v1/auth/oidc/callback/")

        endpoints = get_endpoints()
        token_url = endpoints["token_endpoint"]
        token_data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": client_id,
            "client_secret": client_secret,
        }

        try:
            with httpx.Client() as client:
                token_response = client.post(token_url, data=token_data)
                token_response.raise_for_status()
                tokens = token_response.json()
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as e:
            logger.exception(f"OIDC token exchange failed: {e}")
            return Response(
                {"error": "Failed to exchange authorization code"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

        # Prefer the (verified) ID token claims — hosted IdPs like Google return
        # identity primarily there. Fall back to the userinfo endpoint when the ID
        # token is absent or can't be validated (e.g. no JWKS configured).
        claims = decode_id_token(tokens.get("id_token", ""))

        if not claims:
            access_token = tokens.get("access_token")
            userinfo_url = endpoints["userinfo_endpoint"]
            try:
                with httpx.Client() as client:
                    userinfo_response = client.get(userinfo_url, headers={"Authorization": f"Bearer {access_token}"})
                    userinfo_response.raise_for_status()
                    claims = userinfo_response.json()
            except (httpx.HTTPError, ValueError, KeyError, TypeError) as e:
                logger.exception(f"OIDC userinfo failed: {e}")
                return Response({"error": "Failed to get user info"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # Authenticate user using OIDC backend
        from skyspy.auth.backends import OIDCAuthenticationBackend

        backend = OIDCAuthenticationBackend()
        user = backend.authenticate(request, claims=claims)

        if not user:
            return Response({"error": "Authentication failed"}, status=status.HTTP_401_UNAUTHORIZED)

        # Generate JWT tokens
        refresh = RefreshToken.for_user(user)

        # Get profile
        try:
            profile = user.skyspy_profile
        except SkyspyUser.DoesNotExist:
            profile = SkyspyUser.objects.create(user=user, auth_provider="oidc", oidc_claims=claims)

        response_data = {
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "user": {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "is_superuser": user.is_superuser,
                "is_staff": user.is_staff,
                "display_name": profile.display_name,
                "permissions": profile.get_all_permissions(),
                "roles": [ur.role.name for ur in user.user_roles.all()],
            },
        }

        # Clear OIDC state
        if "oidc_state" in request.session:
            del request.session["oidc_state"]

        # Return HTML that posts tokens to parent window (for popup flow)
        # or redirect with tokens in URL fragment (for redirect flow)
        redirect_url = request.GET.get("redirect_uri", "/")

        # Security: Validate redirect_url to prevent open redirect attacks
        # Only allow relative paths or same-origin URLs
        from urllib.parse import urlparse

        parsed_redirect = urlparse(redirect_url)

        # Check if it's a relative path (no scheme and no netloc)
        is_relative = not parsed_redirect.scheme and not parsed_redirect.netloc

        # Check if it's same-origin (matching scheme and host)
        is_same_origin = False
        if parsed_redirect.scheme and parsed_redirect.netloc:
            request_host = request.get_host()
            redirect_host = parsed_redirect.netloc
            # Compare hosts (including port if present)
            is_same_origin = redirect_host == request_host

        if not is_relative and not is_same_origin:
            logger.warning(f"OIDC callback rejected invalid redirect_url: {redirect_url}")
            redirect_url = "/"

        # Prevent JavaScript injection in redirect URL (e.g., javascript: URLs)
        if redirect_url.lower().startswith("javascript:"):
            logger.warning(f"OIDC callback rejected JavaScript redirect_url: {redirect_url}")
            redirect_url = "/"

        # Prevent scheme-relative URLs (e.g., //evil.com) which could redirect to external sites
        if redirect_url.startswith("//"):
            logger.warning(f"OIDC callback rejected scheme-relative redirect_url: {redirect_url}")
            redirect_url = "/"

        import json

        from django.http import HttpResponse
        from django.utils.html import escape

        # Properly JSON-encode the response data to prevent XSS
        json_data = json.dumps(response_data)

        # Escape the redirect URL for use in JavaScript string
        escaped_redirect_url = escape(redirect_url).replace("\\", "\\\\").replace("'", "\\'")

        # Get the target origin for postMessage from settings, defaulting to same origin
        post_message_origin = getattr(settings, "OIDC_POST_MESSAGE_ORIGIN", None)
        if not post_message_origin:
            # Build same-origin URL from the request
            scheme = "https" if request.is_secure() else "http"
            post_message_origin = f"{scheme}://{request.get_host()}"

        html = f"""
        <!DOCTYPE html>
        <html>
        <head><title>Authentication Complete</title></head>
        <body>
        <script>
            const data = {json_data};
            // Primary handoff: BroadcastChannel is same-origin only and does NOT
            // depend on window.opener, which browsers sever when the popup
            // navigates cross-origin to the IdP (COOP). This makes the popup flow
            // reliable regardless of the IdP's COOP headers.
            try {{
                const bc = new BroadcastChannel('skyspy_oidc');
                bc.postMessage({{type: 'oidc_callback', ...data}});
                bc.close();
            }} catch (e) {{}}
            // Back-compat: also try the opener if it survived.
            try {{
                if (window.opener) {{
                    window.opener.postMessage({{type: 'oidc_callback', ...data}}, '{post_message_origin}');
                }}
            }} catch (e) {{}}
            // Fallback: persist with the app's real storage keys so a full-page
            // redirect still authenticates if messaging is unavailable.
            try {{
                if (data.access) localStorage.setItem('skyspy_access_token', data.access);
                if (data.refresh) localStorage.setItem('skyspy_refresh_token', data.refresh);
                if (data.user) localStorage.setItem('skyspy_user', JSON.stringify(data.user));
            }} catch (e) {{}}
            // Close if possible; the opener also closes us on success. If we are
            // an orphaned popup that can't self-close, redirect into the app.
            window.close();
            setTimeout(function () {{ window.location.href = '{escaped_redirect_url}'; }}, 150);
        </script>
        <p>Authentication complete. You can close this window.</p>
        </body>
        </html>
        """
        return HttpResponse(html, content_type="text/html")


@api_view(["GET"])
@permission_classes([AllowAny])
def permissions_list(request):
    """
    Get list of all available permissions.
    """
    from skyspy.models.auth import FeatureAccess

    feature_names = dict(FeatureAccess.FEATURE_CHOICES)

    permissions = []
    for feature, perms in FEATURE_PERMISSIONS.items():
        permissions.append(
            {
                "feature": feature,
                "display_name": feature_names.get(feature, feature.replace("_", " ").title()),
                # Raw string list kept for backward compatibility; `actions` carries
                # the per-permission labels the RBAC console's role matrix renders.
                "permissions": perms,
                "actions": [
                    {
                        "key": p,
                        "action": p.split(".", 1)[1] if "." in p else p,
                        "label": (p.split(".", 1)[1] if "." in p else p).replace("_", " ").title(),
                    }
                    for p in perms
                ],
            }
        )

    return Response(permissions)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_permissions(request):
    """
    Get current user's permissions.
    """
    try:
        profile = request.user.skyspy_profile
        permissions = profile.get_all_permissions()
    except SkyspyUser.DoesNotExist:
        permissions = []

    return Response(
        {
            "permissions": permissions,
            "is_superuser": request.user.is_superuser,
        }
    )
