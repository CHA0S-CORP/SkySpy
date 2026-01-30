"""
Authentication backends for SkySpy.

Provides OIDC authentication backend that integrates with the SkyspyUser model
and supports automatic role assignment based on claim mappings.
"""
import logging
from django.conf import settings
from django.contrib.auth.models import User
from django.db import transaction

logger = logging.getLogger(__name__)


class OIDCAuthenticationBackend:
    """
    OIDC Authentication backend for SkySpy.

    Handles user creation/update from OIDC claims and automatic role assignment.
    Compatible with mozilla-django-oidc.
    """

    def authenticate(self, request, **kwargs):
        """
        Authenticate a user from OIDC claims.

        This method is called by mozilla-django-oidc after successful
        OIDC authentication. It receives the user info claims.
        """
        # Extract claims from kwargs (set by mozilla-django-oidc)
        claims = kwargs.get('claims', {})
        if not claims:
            return None

        # Required claims
        subject = claims.get('sub')
        if not subject:
            logger.warning("OIDC authentication failed: no 'sub' claim")
            return None

        # Get issuer from claims or settings
        issuer = claims.get('iss', getattr(settings, 'OIDC_PROVIDER_URL', ''))

        try:
            with transaction.atomic():
                user = self._get_or_create_user(claims, subject, issuer)
                self._update_user_from_claims(user, claims, issuer)
                self._assign_roles_from_claims(user, claims)
                return user
        except Exception as e:
            logger.exception(f"OIDC authentication error: {e}")
            return None

    def get_user(self, user_id):
        """Get user by ID for session authentication."""
        try:
            return User.objects.get(pk=user_id)
        except User.DoesNotExist:
            return None

    def _get_or_create_user(self, claims, subject, issuer):
        """
        Get existing user or create a new one from OIDC claims.

        Users are matched by OIDC subject (sub claim) and issuer.
        """
        from skyspy.models.auth import SkyspyUser

        # Try to find existing user by OIDC subject
        try:
            profile = SkyspyUser.objects.select_related('user').get(
                oidc_subject=subject,
                oidc_issuer=issuer
            )
            return profile.user
        except SkyspyUser.DoesNotExist:
            pass

        # Create new user
        email = claims.get('email', '')
        username = self._generate_username(claims, subject)

        # Check if user with same email exists (link accounts)
        # Only if OIDC_ALLOW_EMAIL_LINKING is explicitly enabled
        # WARNING: Email linking can be a security vulnerability if an attacker
        # controls an OIDC provider and uses matching email addresses to take over accounts
        allow_email_linking = getattr(settings, 'OIDC_ALLOW_EMAIL_LINKING', False)
        if allow_email_linking and email:
            try:
                user = User.objects.get(email=email)
                # Link existing user to OIDC
                logger.info(f"Linking existing user {user.username} to OIDC via email {email}")
                self._create_or_update_profile(user, claims, subject, issuer)
                return user
            except User.DoesNotExist:
                pass

        # Create new user
        user = User.objects.create_user(
            username=username,
            email=email,
            first_name=claims.get('given_name', ''),
            last_name=claims.get('family_name', ''),
        )
        user.set_unusable_password()  # OIDC users don't use password
        user.save()

        # Create profile
        self._create_or_update_profile(user, claims, subject, issuer)

        logger.info(f"Created new OIDC user: {username}")
        return user

    def _generate_username(self, claims, subject):
        """Generate a unique username from OIDC claims."""
        # Try preferred_username first
        username = claims.get('preferred_username')
        if username and not User.objects.filter(username=username).exists():
            return username

        # Try email prefix
        email = claims.get('email', '')
        if email:
            email_prefix = email.split('@')[0]
            if not User.objects.filter(username=email_prefix).exists():
                return email_prefix

        # Fall back to subject-based username
        base_username = f"oidc_{subject[:8]}"
        username = base_username
        counter = 1
        while User.objects.filter(username=username).exists():
            username = f"{base_username}_{counter}"
            counter += 1

        return username

    def _create_or_update_profile(self, user, claims, subject, issuer):
        """Create or update the SkyspyUser profile."""
        from skyspy.models.auth import SkyspyUser

        profile, created = SkyspyUser.objects.update_or_create(
            user=user,
            defaults={
                'auth_provider': 'oidc',
                'oidc_subject': subject,
                'oidc_issuer': issuer,
                'oidc_claims': claims,
                'display_name': claims.get('name') or claims.get('preferred_username'),
                'avatar_url': claims.get('picture'),
            }
        )
        return profile

    def _update_user_from_claims(self, user, claims, issuer):
        """Update user fields from OIDC claims."""
        updated = False

        if claims.get('email') and user.email != claims['email']:
            user.email = claims['email']
            updated = True

        if claims.get('given_name') and user.first_name != claims['given_name']:
            user.first_name = claims['given_name']
            updated = True

        if claims.get('family_name') and user.last_name != claims['family_name']:
            user.last_name = claims['family_name']
            updated = True

        if updated:
            user.save()

        # Update profile
        try:
            profile = user.skyspy_profile
            profile.oidc_claims = claims
            if claims.get('name'):
                profile.display_name = claims['name']
            if claims.get('picture'):
                profile.avatar_url = claims['picture']
            profile.save()
        except Exception as e:
            logger.debug(f"Could not update OIDC profile for {user.username}: {e}")

    def _assign_roles_from_claims(self, user, claims):
        """
        Assign roles based on OIDC claim mappings.

        Evaluates all active OIDCClaimMapping rules and assigns
        matching roles to the user.
        """
        from skyspy.models.auth import OIDCClaimMapping, UserRole, Role

        # Get all active claim mappings
        mappings = OIDCClaimMapping.objects.filter(
            is_active=True
        ).select_related('role').order_by('-priority')

        matched_roles = set()
        for mapping in mappings:
            if mapping.matches(claims):
                matched_roles.add(mapping.role)
                logger.debug(f"OIDC claim mapping matched: {mapping.name} -> {mapping.role.name}")

        if not matched_roles:
            # Assign default role if no mappings matched
            default_role_name = getattr(settings, 'OIDC_DEFAULT_ROLE', 'viewer')
            try:
                default_role = Role.objects.get(name=default_role_name)
                matched_roles.add(default_role)
            except Role.DoesNotExist:
                logger.warning(f"Default OIDC role '{default_role_name}' not found")

        # Update user roles
        for role in matched_roles:
            UserRole.objects.get_or_create(
                user=user,
                role=role,
                defaults={'assigned_by': None}  # System-assigned
            )

        logger.info(f"Assigned {len(matched_roles)} roles to user {user.username} from OIDC claims")


class LocalAuthenticationBackend:
    """
    Local username/password authentication backend.

    This is the default Django authentication with SkyspyUser profile support.
    """

    def authenticate(self, request, username=None, password=None, **kwargs):
        """Authenticate with username and password."""
        if not username or not password:
            return None

        try:
            user = User.objects.get(username=username)
        except User.DoesNotExist:
            # Try email as username
            try:
                user = User.objects.get(email=username)
            except User.DoesNotExist:
                return None

        if user.check_password(password):
            # Ensure profile exists
            self._ensure_profile(user)
            return user

        return None

    def get_user(self, user_id):
        """Get user by ID."""
        try:
            return User.objects.get(pk=user_id)
        except User.DoesNotExist:
            return None

    def _ensure_profile(self, user):
        """Ensure user has a SkyspyUser profile."""
        from skyspy.models.auth import SkyspyUser

        SkyspyUser.objects.get_or_create(
            user=user,
            defaults={
                'auth_provider': 'local',
                'display_name': user.get_full_name() or user.username,
            }
        )
