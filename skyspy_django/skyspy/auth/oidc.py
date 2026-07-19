"""OIDC provider discovery + ID-token validation helpers.

The login flow (``auth/views.py``) needs the provider's authorization / token /
userinfo endpoints. Rather than assuming a fixed URL layout — which only fits
Keycloak/Authentik-style providers and breaks hosted IdPs (Google uses entirely
different paths; Auth0's token endpoint is ``/oauth/token``) — we read them from
the provider's discovery document (``.well-known/openid-configuration``).

Falls back to the legacy ``/authorize``, ``/token``, ``/userinfo`` suffixes when
discovery is unavailable, so existing self-hosted configs keep working.
"""

import logging

import httpx
from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)

# Discovery documents are effectively static; cache for an hour to avoid a
# round-trip on every login.
_DISCOVERY_TTL = 3600


def _provider_url() -> str:
    return (getattr(settings, "OIDC_PROVIDER_URL", "") or "").rstrip("/")


def get_provider_config() -> dict:
    """Return the provider's OIDC discovery document (cached), or ``{}`` on failure."""
    provider = _provider_url()
    if not provider:
        return {}

    cache_key = f"oidc:discovery:{provider}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    url = f"{provider}/.well-known/openid-configuration"
    config: dict = {}
    try:
        with httpx.Client(timeout=10) as client:
            resp = client.get(url)
            resp.raise_for_status()
            config = resp.json()
    except (httpx.HTTPError, ValueError) as e:
        logger.warning(f"OIDC discovery failed for {provider}: {e}")

    cache.set(cache_key, config, _DISCOVERY_TTL)
    return config


def get_endpoints() -> dict:
    """Resolve the OIDC endpoints, preferring discovery over legacy suffixes.

    Keys: ``authorization_endpoint``, ``token_endpoint``, ``userinfo_endpoint``,
    ``jwks_uri``, ``issuer``.
    """
    provider = _provider_url()
    config = get_provider_config()
    return {
        "authorization_endpoint": config.get("authorization_endpoint") or f"{provider}/authorize",
        "token_endpoint": config.get("token_endpoint") or f"{provider}/token",
        "userinfo_endpoint": config.get("userinfo_endpoint") or f"{provider}/userinfo",
        "jwks_uri": config.get("jwks_uri") or "",
        "issuer": config.get("issuer") or provider,
    }


def decode_id_token(id_token: str) -> dict:
    """Validate and decode an OIDC ID token against the provider's JWKS.

    Verifies signature, audience (client id) and issuer. Returns the claims dict,
    or ``{}`` when validation isn't possible (no jwks_uri, PyJWKClient/cryptography
    unavailable) or fails — callers fall back to the userinfo endpoint in that case.
    """
    if not id_token:
        return {}

    endpoints = get_endpoints()
    jwks_uri = endpoints["jwks_uri"]
    if not jwks_uri:
        # Without a JWKS we can't verify the signature; decoding unverified would
        # be unsafe, so signal "no claims" and let the caller use userinfo.
        return {}

    client_id = getattr(settings, "OIDC_CLIENT_ID", "")
    try:
        import jwt
        from jwt import PyJWKClient

        signing_key = PyJWKClient(jwks_uri).get_signing_key_from_jwt(id_token)
        return jwt.decode(
            id_token,
            signing_key.key,
            algorithms=["RS256", "ES256"],
            audience=client_id,
            issuer=endpoints["issuer"],
            # access-token hash check is unnecessary for the auth-code flow here
            options={"verify_at_hash": False},
        )
    except Exception as e:  # broad: any jwt/network/import error → fall back to userinfo
        logger.warning(f"OIDC ID token validation failed: {type(e).__name__}: {e}")
        return {}
