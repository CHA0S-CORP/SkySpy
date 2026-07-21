"""
Django settings for SkysPy project.
"""

import json
import os
import warnings
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from django.core.exceptions import ImproperlyConfigured

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent


# Environment-based configuration
def get_env(key, default=None, cast=str):
    """Get environment variable with type casting."""
    value = os.environ.get(key, default)
    if value is None:
        return None
    if cast == bool:
        return value.lower() in ("true", "1", "yes", "on")
    return cast(value)


# Build mode - disables external services during Docker build (collectstatic, etc.)
BUILD_MODE = get_env("BUILD_MODE", "False", bool)


def get_db_config(key, default=None, cast=str):
    """
    Get configuration value from database with env var override.

    Priority order:
    1. Environment variable (if env_var is set on the config)
    2. Database value
    3. Default value

    Args:
        key: Configuration key (e.g., 'safety.vs_change_threshold')
        default: Default value if not found
        cast: Type to cast the value to (str, bool, int, float)

    Returns:
        Configuration value with proper type casting
    """
    if BUILD_MODE:
        # During build, return default to avoid database connection
        return default

    try:
        from skyspy.models.config import SystemConfig

        config = SystemConfig.objects.get(key=key)

        # Check for environment variable override
        if config.env_var:
            env_value = os.environ.get(config.env_var)
            if env_value is not None:
                if cast == bool:
                    return env_value.lower() in ("true", "1", "yes", "on")
                return cast(env_value)

        # Get database value
        value = config.value or config.default_value
        if value is None or value == "":
            return default

        # Cast to proper type
        if cast == bool:
            return str(value).lower() in ("true", "1", "yes", "on")
        return cast(value)

    except Exception:  # broad: settings-load boundary — DB not ready, AppRegistryNotReady, DoesNotExist, cast errors
        # On any error (import, DoesNotExist, etc.), return default
        return default


# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = get_env("DEBUG", "True", bool)

# SECURITY WARNING: keep the secret key used in production secret!
_env_secret_key = get_env("DJANGO_SECRET_KEY")
if _env_secret_key:
    SECRET_KEY = _env_secret_key
elif DEBUG:
    # Only generate a random key in DEBUG mode for development convenience
    from django.core.management.utils import get_random_secret_key

    SECRET_KEY = get_random_secret_key()
    warnings.warn(
        "DJANGO_SECRET_KEY not set - using randomly generated key. This is only acceptable in DEBUG mode.",
        UserWarning,
        stacklevel=2,
    )
else:
    # Production mode requires an explicit secret key
    raise ImproperlyConfigured(
        "DJANGO_SECRET_KEY must be set in production (DEBUG=False). "
        'Generate a secure key with: python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"'
    )

_allowed_hosts_raw = get_env("ALLOWED_HOSTS", "")
ALLOWED_HOSTS = [h.strip() for h in _allowed_hosts_raw.split(",") if h.strip()]

# In DEBUG mode, allow localhost connections for development
if DEBUG and not ALLOWED_HOSTS:
    ALLOWED_HOSTS = ["localhost", "127.0.0.1", "[::1]"]


# Application definition

INSTALLED_APPS = [
    "daphne",  # ASGI server (must be first for runserver override)
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # PostGIS spatial ORM (geom fields, GIST indexes, spatial lookups). Requires
    # the postgis extension on the DB (see docker/postgres/Dockerfile) and
    # GDAL/GEOS in the app image. No-op under the sqlite build/test fallback.
    "django.contrib.gis",
    # Third-party apps
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "django_filters",
    "corsheaders",
    "django_celery_beat",
    "django_celery_results",
    "drf_spectacular",
    # SkysPy apps
    "skyspy",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "skyspy.auth.middleware.AuthModeMiddleware",
    "skyspy.auth.middleware.LastActiveMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "skyspy.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "skyspy.wsgi.application"
ASGI_APPLICATION = "skyspy.asgi.application"


# Database
# https://docs.djangoproject.com/en/5.0/ref/settings/#databases

DATABASE_URL = get_env("DATABASE_URL", "postgresql://adsb:adsb@postgres:5432/adsb")


# Parse DATABASE_URL
def parse_database_url(url):
    """Parse DATABASE_URL into Django database config."""
    import re

    pattern = r"postgresql://(?P<user>[^:]+):(?P<password>[^@]+)@(?P<host>[^:]+):(?P<port>\d+)/(?P<name>.+)"
    match = re.match(pattern, url)
    if match:
        return {
            # GeoDjango PostGIS backend (spatial lookups + geom fields). The DB
            # must have the postgis extension (docker/postgres/Dockerfile); a
            # migration installs it. Falls through to sqlite when the URL isn't
            # postgresql:// (BUILD_MODE / local sqlite — non-spatial).
            "ENGINE": "django.contrib.gis.db.backends.postgis",
            "NAME": match.group("name"),
            "USER": match.group("user"),
            "PASSWORD": match.group("password"),
            "HOST": match.group("host"),
            "PORT": match.group("port"),
            "CONN_MAX_AGE": 60,
            "ATOMIC_REQUESTS": False,
            "AUTOCOMMIT": True,
            # Validate liveness on reuse so a connection the DB/PgBouncer reaped
            # while idle is discarded instead of raising "the connection is
            # closed" (long-lived Socket.IO executor threads never recycle via
            # the request cycle — see main.py _recycle_db_connections).
            "CONN_HEALTH_CHECKS": True,
            "TIME_ZONE": None,
            "OPTIONS": {
                "connect_timeout": 10,
            },
        }
    return {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
        "ATOMIC_REQUESTS": False,
        "AUTOCOMMIT": True,
        "CONN_MAX_AGE": 0,
        "CONN_HEALTH_CHECKS": False,
        "TIME_ZONE": None,
        "OPTIONS": {},
    }


if BUILD_MODE:
    # Use SQLite during build to avoid PostgreSQL connection
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "build.sqlite3",
            "ATOMIC_REQUESTS": False,
            "AUTOCOMMIT": True,
            "CONN_MAX_AGE": 0,
            "CONN_HEALTH_CHECKS": False,
            "TIME_ZONE": None,
            "OPTIONS": {},
        }
    }
else:
    DATABASES = {"default": parse_database_url(DATABASE_URL)}


# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]


# Internationalization
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True


# Static files (CSS, JavaScript, Images)
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# Additional locations for collectstatic to find static files
# In Docker, frontend build is placed in /app/static
# In local dev, frontend build is in ../web/dist
STATICFILES_DIRS = []
_frontend_static = BASE_DIR / "static"
if _frontend_static.exists():
    STATICFILES_DIRS.append(_frontend_static)

# Local development: check for frontend dist directory
_local_frontend_dist = BASE_DIR.parent / "web" / "dist"
if _local_frontend_dist.exists() and _local_frontend_dist not in STATICFILES_DIRS:
    STATICFILES_DIRS.append(_local_frontend_dist)

# WhiteNoise configuration for serving static files in production
if BUILD_MODE:
    # Use simple storage during build for speed
    STATICFILES_STORAGE = "django.contrib.staticfiles.storage.StaticFilesStorage"
else:
    STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"


# Default primary key field type
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# =============================================================================
# Authentication Configuration
# =============================================================================
# Auth Mode: 'public' | 'private' | 'hybrid'
# - public: No authentication required for any endpoint
# - private: Authentication required for all endpoints
# - hybrid: Per-feature configuration (default in production)
AUTH_MODE = get_env("AUTH_MODE", "hybrid")  # Never default to public

# Local-development flag. When True, the AI/assistant + sensitive-endpoint auth
# gates and the per-user owner-scoping are RELAXED so a developer can use the app
# without logging in. MUST be False on any public deployment (default False), so
# the gates enforce. This is deliberately separate from DEBUG: the dev stack runs
# DEBUG=False, and a public deploy also runs DEBUG=False, so DEBUG can't tell them
# apart — the dev stack sets DEV_MODE=True in .env.test.
DEV_MODE = get_env("DEV_MODE", "False", bool)

# JWT Configuration
JWT_SECRET_KEY = get_env("JWT_SECRET_KEY", SECRET_KEY)

# Warn if JWT_SECRET_KEY is the same as SECRET_KEY
if JWT_SECRET_KEY == SECRET_KEY:
    warnings.warn(
        "JWT_SECRET_KEY is using the same value as SECRET_KEY. "
        "For better security, set a separate JWT_SECRET_KEY environment variable.",
        UserWarning,
        stacklevel=2,
    )

if not DEBUG and JWT_SECRET_KEY == SECRET_KEY:
    import logging

    logging.warning("JWT_SECRET_KEY should not equal DJANGO_SECRET_KEY in production!")
JWT_ACCESS_TOKEN_LIFETIME_MINUTES = get_env("JWT_ACCESS_TOKEN_LIFETIME_MINUTES", "60", int)
JWT_REFRESH_TOKEN_LIFETIME_DAYS = get_env("JWT_REFRESH_TOKEN_LIFETIME_DAYS", "2", int)
JWT_AUTH_COOKIE = get_env("JWT_AUTH_COOKIE", "False", bool)

# OIDC Configuration
# OIDC_PROVIDER_URL is the issuer base URL; endpoints are resolved from its
# .well-known/openid-configuration discovery document (see auth/oidc.py), so
# hosted IdPs work out of the box:
#   Google: https://accounts.google.com
#   Auth0:  https://<tenant>.auth0.com
#   Okta:   https://<org>.okta.com/oauth2/default
#   Keycloak: https://<host>/realms/<realm>
# Register redirect URI  <site>/api/v1/auth/oidc/callback/  with the provider.
OIDC_ENABLED = get_env("OIDC_ENABLED", "False", bool)
OIDC_PROVIDER_URL = get_env("OIDC_PROVIDER_URL", "")
OIDC_PROVIDER_NAME = get_env("OIDC_PROVIDER_NAME", "SSO")
OIDC_CLIENT_ID = get_env("OIDC_CLIENT_ID", "")
OIDC_CLIENT_SECRET = get_env("OIDC_CLIENT_SECRET", "")
OIDC_SCOPES = get_env("OIDC_SCOPES", "openid profile email groups")
OIDC_DEFAULT_ROLE = get_env("OIDC_DEFAULT_ROLE", "viewer")
# Link an OIDC identity to an existing local user when the verified email matches
# (only if the provider asserts email_verified). Off by default to avoid account
# takeover via an IdP that doesn't verify email.
OIDC_ALLOW_EMAIL_LINKING = get_env("OIDC_ALLOW_EMAIL_LINKING", "False", bool)
# Target origin for the popup postMessage handshake (defaults to request origin).
# Set to the dashboard origin when the API is served from a different host.
OIDC_POST_MESSAGE_ORIGIN = get_env("OIDC_POST_MESSAGE_ORIGIN", "")

# Local Auth
LOCAL_AUTH_ENABLED = get_env("LOCAL_AUTH_ENABLED", "True", bool)

# API Key Auth
API_KEY_ENABLED = get_env("API_KEY_ENABLED", "True", bool)

# Authentication Backends
AUTHENTICATION_BACKENDS = [
    "skyspy.auth.backends.LocalAuthenticationBackend",
    "django.contrib.auth.backends.ModelBackend",
]

if OIDC_ENABLED:
    AUTHENTICATION_BACKENDS.insert(0, "skyspy.auth.backends.OIDCAuthenticationBackend")


# =============================================================================
# Django REST Framework
# =============================================================================
# Build auth classes based on configuration.
# Always register auth classes, INCLUDING in public mode. They only *identify*
# the requester (parse a bearer JWT / API key); the permission layer decides
# access and already bypasses public reads. In public mode the map/dashboard
# stay open to anonymous visitors, but auth-gated-even-in-public endpoints
# (assistant/LLM, system admin, user/role management) must still be able to
# recognize a signed-in user — leaving this empty made every such gate reject
# everyone, since request.user was always Anonymous.
_DRF_AUTH_CLASSES = [
    "rest_framework_simplejwt.authentication.JWTAuthentication",
    "skyspy.auth.authentication.APIKeyAuthentication",
]

_DRF_PERMISSION_CLASSES = ["rest_framework.permissions.AllowAny"]
if AUTH_MODE == "private":
    _DRF_PERMISSION_CLASSES = ["rest_framework.permissions.IsAuthenticated"]
elif AUTH_MODE == "hybrid":
    _DRF_PERMISSION_CLASSES = ["skyspy.auth.permissions.IsAuthenticatedOrPublic"]

REST_FRAMEWORK = {
    "DEFAULT_PERMISSION_CLASSES": _DRF_PERMISSION_CLASSES,
    "DEFAULT_AUTHENTICATION_CLASSES": _DRF_AUTH_CLASSES,
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.LimitOffsetPagination",
    "PAGE_SIZE": 100,
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "rest_framework.views.exception_handler",
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    # The dashboard is a chatty SPA (aircraft/safety/weather polling); in
    # AUTH_MODE=public every request is anonymous, so the anon rate must
    # comfortably exceed one dashboard's steady-state request volume.
    "DEFAULT_THROTTLE_RATES": {
        "anon": get_env("API_THROTTLE_ANON", "600/minute"),
        "user": get_env("API_THROTTLE_USER", "2000/minute"),
        # Scoped limits for expensive / external-fan-out endpoints (see api/throttles.py).
        # These are keyed per user-or-IP and sit well below the global anon rate.
        "auth": get_env("API_THROTTLE_AUTH", "5/minute"),
        "upload": get_env("API_THROTTLE_UPLOAD", "10/minute"),
        "external_lookup": get_env("API_THROTTLE_EXTERNAL_LOOKUP", "10/minute"),
        "weather": get_env("API_THROTTLE_WEATHER", "30/minute"),
        "geodata": get_env("API_THROTTLE_GEODATA", "60/minute"),
        # Alert-rule writes (create/update/toggle/bulk/import). A dedicated bucket
        # so alert CRUD volume never shares the login `auth` bucket (which would
        # let rule browsing burn the brute-force login budget, and vice versa).
        "alert_write": get_env("API_THROTTLE_ALERT_WRITE", "60/minute"),
    },
}


# =============================================================================
# Simple JWT Configuration
# =============================================================================
from datetime import timedelta

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=JWT_ACCESS_TOKEN_LIFETIME_MINUTES),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=JWT_REFRESH_TOKEN_LIFETIME_DAYS),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
    "ALGORITHM": "HS256",
    "SIGNING_KEY": JWT_SECRET_KEY,
    "VERIFYING_KEY": None,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "AUTH_HEADER_NAME": "HTTP_AUTHORIZATION",
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
    "AUTH_TOKEN_CLASSES": ("rest_framework_simplejwt.tokens.AccessToken",),
    "TOKEN_TYPE_CLAIM": "token_type",
}


# =============================================================================
# DRF Spectacular (OpenAPI Schema)
# =============================================================================
SPECTACULAR_SETTINGS = {
    "TITLE": "SkysPy ADS-B Tracking API",
    "DESCRIPTION": "Real-time ADS-B aircraft tracking, ACARS messaging, and aviation data API",
    "VERSION": "2.6.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
    "TAGS": [
        {"name": "aircraft", "description": "Live aircraft tracking"},
        {"name": "history", "description": "Historical sightings and sessions"},
        {"name": "alerts", "description": "Alert rule management"},
        {"name": "safety", "description": "Safety event monitoring"},
        {"name": "acars", "description": "ACARS/VDL2 messages"},
        {"name": "audio", "description": "Audio transmission management"},
        {"name": "aviation", "description": "Aviation weather and data"},
        {"name": "airframe", "description": "Aircraft information"},
        {"name": "map", "description": "Map data and GeoJSON"},
        {"name": "system", "description": "System health and status"},
        {"name": "notifications", "description": "Notification configuration"},
    ],
}


# =============================================================================
# CORS
# =============================================================================
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOW_CREDENTIALS = True
_cors_origins_raw = get_env("CORS_ALLOWED_ORIGINS", "")
CORS_ALLOWED_ORIGINS = [o.strip() for o in _cors_origins_raw.split(",") if o.strip()]


# =============================================================================
# Security Headers (conditional on production mode)
# =============================================================================
SECURE_BROWSER_XSS_FILTER = True

# Cookie security flags - always set these for protection against XSS and CSRF
CSRF_COOKIE_HTTPONLY = True
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SAMESITE = "Lax"

CSRF_COOKIE_SECURE = not DEBUG or get_env("FORCE_SECURE_COOKIES", "false", bool)
SESSION_COOKIE_SECURE = not DEBUG or get_env("FORCE_SECURE_COOKIES", "false", bool)

SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "SAMEORIGIN"

# Origins allowed to send authenticated POSTs (admin/login, SPA on another host).
# Defaults to the CORS origins so a single env var usually suffices.
_csrf_trusted_raw = get_env("CSRF_TRUSTED_ORIGINS", _cors_origins_raw)
CSRF_TRUSTED_ORIGINS = [o.strip() for o in _csrf_trusted_raw.split(",") if o.strip()]

# HTTPS hardening — production only (DEBUG=False). The app sits behind a
# TLS-terminating reverse proxy, so honor its X-Forwarded-Proto header. The
# liveness probe stays reachable over plain HTTP so load balancers don't get a
# redirect on their health check.
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = get_env("SECURE_SSL_REDIRECT", "True", bool)
    SECURE_REDIRECT_EXEMPT = [r"^health/?$", r"^api/v1/system/health/?$"]
    SECURE_HSTS_SECONDS = get_env("SECURE_HSTS_SECONDS", "31536000", int)  # 1 year
    SECURE_HSTS_INCLUDE_SUBDOMAINS = get_env("SECURE_HSTS_INCLUDE_SUBDOMAINS", "True", bool)
    SECURE_HSTS_PRELOAD = get_env("SECURE_HSTS_PRELOAD", "True", bool)


# =============================================================================
# Django Channels (WebSocket/Real-time)
# =============================================================================
REDIS_URL = get_env("REDIS_URL", "redis://redis:6379/0")

# =============================================================================
# Cache Configuration (Redis for shared aircraft data across processes)
# =============================================================================
if BUILD_MODE:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        }
    }
else:
    # Force the cache onto Redis DB 1 - DB 0 is reserved for the Celery broker.
    # NOTE: redis-py gives the URL path (e.g. "/0") precedence over a "db" kwarg,
    # so an OPTIONS {"db": "1"} entry is silently ignored when REDIS_URL includes
    # a database path. Rewrite the URL path instead; otherwise the cache lands in
    # DB 0 and cache.clear() would wipe the Celery broker.
    _redis_parts = urlsplit(REDIS_URL)
    _cache_redis_url = urlunsplit((_redis_parts.scheme, _redis_parts.netloc, "/1", _redis_parts.query, ""))
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": _cache_redis_url,
            "KEY_PREFIX": "skyspy",
            "TIMEOUT": 300,  # 5 minute default timeout
        }
    }

# =============================================================================
# Socket.IO Configuration
# =============================================================================
# Socket.IO uses Redis for multi-process pub/sub (configured via REDIS_URL)
# Rate limits for WebSocket broadcasts (messages per second)
WS_RATE_LIMITS = {
    "aircraft:update": 10,  # Max 10 Hz
    "aircraft:position": 5,  # Max 5 Hz for position-only updates
    "aircraft:delta": 10,  # Max 10 Hz for delta updates
    "stats:update": 0.5,  # Max 0.5 Hz (2 second minimum)
    "stats:tick": 0.2,  # Max 0.2 Hz (5s minimum — beat emits every 10s)
    "default": 5,  # Default rate limit
}

# Message batching configuration
WS_BATCH_WINDOW_MS = 50  # Collect messages for 50ms before sending
WS_MAX_BATCH_SIZE = 50  # Maximum messages per batch
# Immediate types bypass batching entirely for real-time feel
WS_IMMEDIATE_TYPES = [
    "alert",
    "safety",
    "emergency",  # Critical events
    "aircraft:update",
    "aircraft:new",
    "aircraft:position",  # Real-time aircraft updates
]


# =============================================================================
# Celery Configuration
# =============================================================================
if BUILD_MODE:
    # Use memory broker during build to avoid Redis connection
    CELERY_BROKER_URL = "memory://"
    CELERY_RESULT_BACKEND = "cache+memory://"
else:
    CELERY_BROKER_URL = REDIS_URL
    # Use django-celery-results database backend for queryable task results
    CELERY_RESULT_BACKEND = "django-db"
    CELERY_CACHE_BACKEND = "django-cache"
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = "UTC"
CELERY_TASK_TRACK_STARTED = True
CELERY_TASK_TIME_LIMIT = 30 * 60  # 30 minutes
CELERY_BEAT_SCHEDULER = "django_celery_beat.schedulers:DatabaseScheduler"
# Result expiration (7 days default, adjustable)
CELERY_RESULT_EXPIRES = int(get_env("CELERY_RESULT_EXPIRES", 60 * 60 * 24 * 7))
# Extended result format stores task args, kwargs, and other metadata
CELERY_RESULT_EXTENDED = True


# =============================================================================
# SkysPy Application Settings
# =============================================================================

# ADS-B Sources
ULTRAFEEDER_HOST = get_env("ULTRAFEEDER_HOST", "ultrafeeder")
ULTRAFEEDER_PORT = get_env("ULTRAFEEDER_PORT", "80")
DUMP978_HOST = get_env("DUMP978_HOST", "dump978")
DUMP978_PORT = get_env("DUMP978_PORT", "80")

ULTRAFEEDER_URL = f"http://{ULTRAFEEDER_HOST}:{ULTRAFEEDER_PORT}"
DUMP978_URL = f"http://{DUMP978_HOST}:{DUMP978_PORT}"

# Feeder Location
FEEDER_LAT = get_env("FEEDER_LAT", "47.9377", float)
FEEDER_LON = get_env("FEEDER_LON", "-121.9687", float)

# Polling
POLLING_INTERVAL = get_env("POLLING_INTERVAL", "1", int)
DB_STORE_INTERVAL = get_env("DB_STORE_INTERVAL", "5", int)

# Map server-side clustering (conditional). The Live Map requests aircraft-clusters
# with its viewport bbox + zoom; at/above MAP_CLUSTER_ZOOM_THRESHOLD the server
# returns raw points, below it returns ST_ClusterDBSCAN groups over the
# LiveAircraftPosition table. MAP_CLUSTER_EPS_BASE is the DBSCAN eps in DEGREES,
# scaled down as zoom rises. MAP_CLUSTER_MAX_POINTS caps the raw-points branch.
# LIVE_POSITION_TTL prunes live_aircraft_positions rows older than N seconds so
# clusters reflect only current traffic. The frontend mirrors the threshold via
# the auth/config endpoint so client + server agree on when to flip modes.
MAP_CLUSTER_ZOOM_THRESHOLD = get_env("MAP_CLUSTER_ZOOM_THRESHOLD", "8", int)
MAP_CLUSTER_EPS_BASE = get_env("MAP_CLUSTER_EPS_BASE", "0.4", float)
MAP_CLUSTER_MAX_POINTS = get_env("MAP_CLUSTER_MAX_POINTS", "2000", int)
LIVE_POSITION_TTL = get_env("LIVE_POSITION_TTL", "90", int)

# Aircraft Streaming (replaces polling when enabled)
# Supports two modes: SSE (preferred) and TCP (legacy)
AIRCRAFT_STREAM_ENABLED = get_env("AIRCRAFT_STREAM_ENABLED", "False", bool)
AIRCRAFT_STREAM_HOST = get_env("AIRCRAFT_STREAM_HOST", ULTRAFEEDER_HOST)
AIRCRAFT_STREAM_PORT = get_env("AIRCRAFT_STREAM_PORT", "30047", int)  # TCP net-json-port
AIRCRAFT_STREAM_RECONNECT_DELAY = get_env("AIRCRAFT_STREAM_RECONNECT_DELAY", "5", int)
AIRCRAFT_STREAM_BATCH_MS = get_env("AIRCRAFT_STREAM_BATCH_MS", "100", int)  # Batch broadcasts
# SSE streaming settings (preferred mode)
AIRCRAFT_STREAM_MODE = get_env("AIRCRAFT_STREAM_MODE", "sse")  # 'sse', 'tcp', 'adsbx', 'adsblol', or 'auto'
AIRCRAFT_STREAM_SSE_PORT = get_env("AIRCRAFT_STREAM_SSE_PORT", "80", int)  # HTTP port for SSE
AIRCRAFT_STREAM_SSE_PATH = get_env("AIRCRAFT_STREAM_SSE_PATH", "/v2/sse")  # SSE endpoint path
# ADSBexchange API streaming (polling mode)
AIRCRAFT_STREAM_ADSBX_INTERVAL = get_env("AIRCRAFT_STREAM_ADSBX_INTERVAL", "2", float)  # Poll interval in seconds
AIRCRAFT_STREAM_ADSBX_RADIUS = get_env("AIRCRAFT_STREAM_ADSBX_RADIUS", "250", int)  # Radius in nautical miles
# adsb.lol / community API streaming (keyless, readsb schema, radius max 250nm)
# Politeness guideline is <=1 req/s per source, so keep interval >= 2s.
AIRCRAFT_STREAM_ADSBLOL_INTERVAL = get_env("AIRCRAFT_STREAM_ADSBLOL_INTERVAL", "2", float)  # Poll interval (s)
AIRCRAFT_STREAM_ADSBLOL_RADIUS = get_env("AIRCRAFT_STREAM_ADSBLOL_RADIUS", "250", int)  # Radius in nautical miles
# Round-robin over these keyless sources (comma list). Known names: adsb.lol,
# adsb.fi, airplanes.live. A full URL template containing {lat}/{lon}/{radius}
# is also accepted. Rotating spreads per-IP rate limits; a 429 skips to the next.
AIRCRAFT_STREAM_FREE_SOURCES = get_env("AIRCRAFT_STREAM_FREE_SOURCES", "adsb.lol,adsb.fi,airplanes.live")

# Session Management
SESSION_TIMEOUT_MINUTES = get_env("SESSION_TIMEOUT_MINUTES", "30", int)

# Safety Monitoring
SAFETY_MONITORING_ENABLED = get_env("SAFETY_MONITORING_ENABLED", "True", bool)
SAFETY_VS_CHANGE_THRESHOLD = get_env("SAFETY_VS_CHANGE_THRESHOLD", "2000", int)
SAFETY_VS_EXTREME_THRESHOLD = get_env("SAFETY_VS_EXTREME_THRESHOLD", "9000", int)
SAFETY_PROXIMITY_NM = get_env("SAFETY_PROXIMITY_NM", "0.5", float)
SAFETY_ALTITUDE_DIFF_FT = get_env("SAFETY_ALTITUDE_DIFF_FT", "500", int)
SAFETY_CLOSURE_RATE_KT = get_env("SAFETY_CLOSURE_RATE_KT", "200", float)
SAFETY_TCAS_VS_THRESHOLD = get_env("SAFETY_TCAS_VS_THRESHOLD", "1500", int)

# Default Alerts
WATCH_ICAO_LIST = get_env("WATCH_ICAO_LIST", "")
WATCH_FLIGHT_LIST = get_env("WATCH_FLIGHT_LIST", "")

# ACARS Settings
ACARS_PORT = get_env("ACARS_PORT", "5555", int)
VDLM2_PORT = get_env("VDLM2_PORT", "5556", int)
ACARS_ENABLED = get_env("ACARS_ENABLED", "True", bool)

# Airframes.io live ACARS feed — open community aggregator (api.airframes.io),
# used as a no-hardware ACARS source. When enabled, `run_acars` polls the global
# firehose and keeps only the LAX-area ground stations (or a radius around a
# center point), then ingests them through the same normalize/dedupe/store/
# broadcast path as the UDP listener. Free/keyless today; set
# AIRFRAMES_ACARS_API_KEY if you have a feeder key (raises the rate limit).
AIRFRAMES_ACARS_ENABLED = get_env("AIRFRAMES_ACARS_ENABLED", "False", bool)
AIRFRAMES_ACARS_URL = get_env("AIRFRAMES_ACARS_URL", "https://api.airframes.io/v1/messages")
AIRFRAMES_ACARS_API_KEY = get_env("AIRFRAMES_ACARS_API_KEY", "")
# Poll cadence (s). The firehose's newest 100 msgs span only ~5s, so keep this
# low enough to avoid gaps; dedupe (30s TTL) absorbs the overlap. Min 2.
AIRFRAMES_ACARS_POLL_INTERVAL = get_env("AIRFRAMES_ACARS_POLL_INTERVAL", "4", int)
# Comma-separated ICAOs whose nearest-airport stations we keep (default = LAX
# metro receivers). Empty = rely on the radius filter only.
AIRFRAMES_ACARS_AIRPORTS = get_env(
    "AIRFRAMES_ACARS_AIRPORTS",
    "KLAX,KVNY,KBUR,KSNA,KLGB,KONT,KHHR,KSMO,KTOA,KRIV,KSBD,KNKX,KSAN,KCRQ,KNTD,KPMD,KWJF,KEMT,KFUL,KCNO,KSLI,KNFG",
)
# Geographic fallback: keep stations within this many nm of the center. Defaults
# to LAX (not FEEDER_LAT/LON — airframes coverage is nationwide). 0 disables.
AIRFRAMES_ACARS_CENTER_LAT = get_env("AIRFRAMES_ACARS_CENTER_LAT", "33.9416", float)
AIRFRAMES_ACARS_CENTER_LON = get_env("AIRFRAMES_ACARS_CENTER_LON", "-118.4085", float)
AIRFRAMES_ACARS_RADIUS_NM = get_env("AIRFRAMES_ACARS_RADIUS_NM", "100", float)

# Notifications
APPRISE_URLS = get_env("APPRISE_URLS", "")
NOTIFICATION_COOLDOWN = get_env("NOTIFICATION_COOLDOWN", "300", int)
# SSRF allowlist: comma-separated IPs/CIDRs exempt from the private/internal-IP
# webhook block. Empty (default) blocks all private targets. Use to reach a
# self-hosted webhook receiver on a trusted LAN (e.g. an internal n8n at
# 10.42.252.10, or the whole 10.42.0.0/16).
NOTIFICATION_WEBHOOK_ALLOWED_PRIVATE_CIDRS = get_env("NOTIFICATION_WEBHOOK_ALLOWED_PRIVATE_CIDRS", "")

# Caching
CACHE_TTL = get_env("CACHE_TTL", "5", int)
UPSTREAM_API_MIN_INTERVAL = get_env("UPSTREAM_API_MIN_INTERVAL", "60", int)

# Photo Cache
PHOTO_CACHE_ENABLED = get_env("PHOTO_CACHE_ENABLED", "True", bool)
PHOTO_CACHE_DIR = get_env("PHOTO_CACHE_DIR", "/data/photos")
PHOTO_AUTO_DOWNLOAD = get_env("PHOTO_AUTO_DOWNLOAD", "True", bool)
# Planespotters photo API rejects (HTTP 403) any request whose User-Agent lacks
# a contact URL or email. Must include a "(+https://…)" or an address — set your
# own so they can reach the operator. Default is compliant but generic.
PHOTO_PLANESPOTTERS_USER_AGENT = get_env(
    "PHOTO_PLANESPOTTERS_USER_AGENT", "skyspy/2.6 (+https://github.com/skyspy/skyspy)"
)

# S3 Storage
S3_ENABLED = get_env("S3_ENABLED", "False", bool)
S3_BUCKET = get_env("S3_BUCKET", "")
S3_REGION = get_env("S3_REGION", "us-east-1")
S3_ACCESS_KEY = get_env("S3_ACCESS_KEY")
S3_SECRET_KEY = get_env("S3_SECRET_KEY")
S3_ENDPOINT_URL = get_env("S3_ENDPOINT_URL")
S3_PREFIX = get_env("S3_PREFIX", "aircraft-photos")
S3_PUBLIC_URL = get_env("S3_PUBLIC_URL")

# Radio/Audio
RADIO_ENABLED = get_env("RADIO_ENABLED", "True", bool)
RADIO_AUDIO_DIR = get_env("RADIO_AUDIO_DIR", "/data/radio")
RADIO_MAX_FILE_SIZE_MB = get_env("RADIO_MAX_FILE_SIZE_MB", "50", int)
RADIO_RETENTION_DAYS = get_env("RADIO_RETENTION_DAYS", "7", int)
RADIO_S3_PREFIX = get_env("RADIO_S3_PREFIX", "radio-transmissions")

# Transcription
TRANSCRIPTION_ENABLED = get_env("TRANSCRIPTION_ENABLED", "False", bool)
TRANSCRIPTION_SERVICE_URL = get_env("TRANSCRIPTION_SERVICE_URL")
TRANSCRIPTION_MODEL = get_env("TRANSCRIPTION_MODEL")
TRANSCRIPTION_API_KEY = get_env("TRANSCRIPTION_API_KEY")

# Whisper
WHISPER_ENABLED = get_env("WHISPER_ENABLED", "False", bool)
WHISPER_URL = get_env("WHISPER_URL", "http://whisper:9000")

# ATC Whisper
ATC_WHISPER_ENABLED = get_env("ATC_WHISPER_ENABLED", "False", bool)
ATC_WHISPER_MAX_CONCURRENT = get_env("ATC_WHISPER_MAX_CONCURRENT", "2", int)
ATC_WHISPER_SEGMENT_BY_VAD = get_env("ATC_WHISPER_SEGMENT_BY_VAD", "True", bool)
ATC_WHISPER_PREPROCESS = get_env("ATC_WHISPER_PREPROCESS", "True", bool)
ATC_WHISPER_NOISE_REDUCE = get_env("ATC_WHISPER_NOISE_REDUCE", "True", bool)
ATC_WHISPER_POSTPROCESS = get_env("ATC_WHISPER_POSTPROCESS", "True", bool)

# LLM API Configuration (for enhanced transcript analysis)
LLM_ENABLED = get_env("LLM_ENABLED", "False", bool)
LLM_API_URL = get_env("LLM_API_URL", "https://api.openai.com/v1")
LLM_API_KEY = get_env("LLM_API_KEY", "")
LLM_MODEL = get_env("LLM_MODEL", "gpt-4o-mini")
LLM_TIMEOUT = get_env("LLM_TIMEOUT", "30", int)
LLM_MAX_RETRIES = get_env("LLM_MAX_RETRIES", "3", int)
LLM_CACHE_TTL = get_env("LLM_CACHE_TTL", "3600", int)
LLM_MAX_TOKENS = get_env("LLM_MAX_TOKENS", "500", int)
LLM_TEMPERATURE = get_env("LLM_TEMPERATURE", "0.1", float)

# Embeddings (airframe RAG). Each falls back to the LLM_* provider config so a
# single provider covers both chat and embeddings; override to split them.
EMBEDDING_API_URL = get_env("EMBEDDING_API_URL", "")
EMBEDDING_API_KEY = get_env("EMBEDDING_API_KEY", "")
EMBEDDING_MODEL = get_env("EMBEDDING_MODEL", "text-embedding-3-small")
EMBEDDING_DIM = get_env("EMBEDDING_DIM", "1536", int)  # text-embedding-3-small = 1536

# LLM Assistant (LangChain tool-calling agent over the analytics/search services).
# Requires LLM_ENABLED and a chat model that supports tool/function calling
# (served by vLLM in prod, or OpenAI/Ollama in dev — any OpenAI-compatible URL).
ASSISTANT_ENABLED = get_env("ASSISTANT_ENABLED", "False", bool)
ASSISTANT_MODEL = get_env("ASSISTANT_MODEL", "") or LLM_MODEL
# Tool-call budget per query. Each step is ~2 graph nodes (model call + tool), so
# the recursion limit is MAX_STEPS*2+2. Safe to raise on large-context models
# (128k gpt-4o-mini etc.) — the binding constraint is ASSISTANT_TIMEOUT, not the
# context window: more steps mean more sequential model+tool round-trips, so raise
# the timeout alongside it. COMPACT caps the budget on small windows where deep
# tool chains would overflow the context (see ASSISTANT_CONTEXT_WINDOW).
ASSISTANT_MAX_STEPS = get_env("ASSISTANT_MAX_STEPS", "20", int)
ASSISTANT_MAX_STEPS_COMPACT = get_env("ASSISTANT_MAX_STEPS_COMPACT", "8", int)
ASSISTANT_TIMEOUT = get_env("ASSISTANT_TIMEOUT", "120", int)
# Context-window budget knobs. Raise for large-context models to let tools return
# more and conversations run longer; keep low on RPi/small models. Defaults match
# the historical hardcoded caps.
ASSISTANT_MAX_RESULT_CHARS = get_env("ASSISTANT_MAX_RESULT_CHARS", "6000", int)
ASSISTANT_MAX_HISTORY_MSGS = get_env("ASSISTANT_MAX_HISTORY_MSGS", "16", int)
ASSISTANT_MAX_HISTORY_CHARS = get_env("ASSISTANT_MAX_HISTORY_CHARS", "3000", int)
# The chat model's max context window in tokens. When set to a small value
# (<=16000, e.g. a local 8k vLLM/Ollama model) the assistant auto-switches to
# COMPACT MODE: a short system prompt, first-sentence-only tool descriptions, and
# tighter result/history/briefing caps — so the fixed prompt + tool schemas
# stop overflowing the window on the very first model call. 0 (default) = assume a
# large context, no compaction.
ASSISTANT_CONTEXT_WINDOW = get_env("ASSISTANT_CONTEXT_WINDOW", "0", int)
# Inject a compact live-situation snapshot into each assistant query so answers
# are grounded in current traffic without spending a tool call. Disable on tiny
# models / RPi if the extra context hurts.
ASSISTANT_BRIEFING_ENABLED = get_env("ASSISTANT_BRIEFING_ENABLED", "True", bool)
# Optional override for the assistant's airframe photo <img> src (the app renders
# the photo from the fetch_airframe_photo tool call, not from LLM-emitted markdown,
# so the URL can't be hallucinated). Empty (default) auto-infers: a signed S3 URL
# when S3_ENABLED, else the same-origin /api/v1/photos/<hex> endpoint.
# Set to a public asset base (e.g. https://sky-spy-assets.s3.amazonaws.com/photos)
# to force <base>/<HEX>.jpg.
ASSISTANT_PHOTO_BASE_URL = get_env("ASSISTANT_PHOTO_BASE_URL", "")

# Auto-generated airframe type cards. A daily Celery task
# (generate_airframe_type_cards) discovers ICAO aircraft-type designators this
# station has actually tracked but that are absent from the curated static
# Airframes library, then has the LLM write a factual reference card + pick a
# diagram archetype (it never draws — the front-end <Planform> renders the
# blueprint). Requires LLM_ENABLED. Off by default. BATCH bounds LLM calls per
# run; MIN_TAILS skips one-off mis-decodes (only types with >= N distinct tails).
AIRFRAME_CARD_GEN_ENABLED = get_env("AIRFRAME_CARD_GEN_ENABLED", "False", bool)
AIRFRAME_CARD_GEN_BATCH = get_env("AIRFRAME_CARD_GEN_BATCH", "8", int)
AIRFRAME_CARD_GEN_MIN_TAILS = get_env("AIRFRAME_CARD_GEN_MIN_TAILS", "1", int)

# Runtime web search (services/web_search.py). Grounds LLM output in live web
# sources and supplies public type photos for the airframe card generator.
# Provider: wikipedia (default, keyless — MediaWiki search + Wikimedia lead
# image) | tavily | brave (keyed, set WEB_SEARCH_API_KEY) | searxng (self-host,
# set WEB_SEARCH_URL) | duckduckgo (keyless HTML scrape, brittle). Wikipedia is
# always consulted for the type photo regardless of the text provider.
WEB_SEARCH_ENABLED = get_env("WEB_SEARCH_ENABLED", "True", bool)
WEB_SEARCH_PROVIDER = get_env("WEB_SEARCH_PROVIDER", "wikipedia")
WEB_SEARCH_API_KEY = get_env("WEB_SEARCH_API_KEY", "")
WEB_SEARCH_URL = get_env("WEB_SEARCH_URL", "")  # SearXNG base URL
WEB_SEARCH_MAX_RESULTS = get_env("WEB_SEARCH_MAX_RESULTS", "5", int)
# Wikimedia 403s requests without a descriptive contact UA; set your own.
WEB_SEARCH_USER_AGENT = get_env("WEB_SEARCH_USER_AGENT", "skyspy/3 (+https://github.com/skyspy/skyspy)")

# OpenSky Database
OPENSKY_DB_PATH = get_env("OPENSKY_DB_PATH", "/data/opensky/aircraft-database.csv")
OPENSKY_DB_ENABLED = get_env("OPENSKY_DB_ENABLED", "True", bool)

# Sentry
SENTRY_DSN = get_env("SENTRY_DSN")
SENTRY_ENVIRONMENT = get_env("SENTRY_ENVIRONMENT", "development")
SENTRY_TRACES_SAMPLE_RATE = get_env("SENTRY_TRACES_SAMPLE_RATE", "0.1", float)
SENTRY_PROFILES_SAMPLE_RATE = get_env("SENTRY_PROFILES_SAMPLE_RATE", "0.1", float)

# Prometheus
PROMETHEUS_ENABLED = get_env("PROMETHEUS_ENABLED", "True", bool)

# =============================================================================
# Free Data Sources (New APIs)
# =============================================================================

# CheckWX Weather API (https://www.checkwxapi.com/)
# Free tier: 3,000 requests/day
CHECKWX_ENABLED = get_env("CHECKWX_ENABLED", "False", bool)
CHECKWX_API_KEY = get_env("CHECKWX_API_KEY", "")

# AVWX Weather API (https://avwx.rest/)
# Free tier: Unlimited basic requests
AVWX_ENABLED = get_env("AVWX_ENABLED", "True", bool)
AVWX_API_KEY = get_env("AVWX_API_KEY", "")

# OpenAIP Airspace (https://www.openaip.net/)
# Free tier: Unlimited with API key
OPENAIP_ENABLED = get_env("OPENAIP_ENABLED", "False", bool)
OPENAIP_API_KEY = get_env("OPENAIP_API_KEY", "")

# Aviation reference-data fetch radius (nm) around FEEDER_LAT/LON. Airspace
# boundaries (OpenAIP) and airports/navaids (AWC) are fetched in a box/disc of
# this radius so the map layers populate near the antenna instead of a sparse
# CONUS-wide sample. AIRSPACE_EXTRA_REGIONS is an optional JSON list of
# [lat, lon, radius_nm] for multi-site coverage.
AIRSPACE_FETCH_RADIUS_NM = get_env("AIRSPACE_FETCH_RADIUS_NM", "250", float)
GEODATA_FETCH_RADIUS_NM = get_env("GEODATA_FETCH_RADIUS_NM", "250", float)
AIRSPACE_EXTRA_REGIONS = json.loads(get_env("AIRSPACE_EXTRA_REGIONS", "[]"))

# Watch Duty wildfire overlay. When WILDFIRES_ENABLED, a Celery beat task polls
# the public api.watchduty.org geo_events feed via libwatchduty every
# WILDFIRES_REFRESH_INTERVAL seconds, keeps active wildfires within
# WILDFIRES_RADIUS_NM of FEEDER_LAT/LON (haversine — the API has no server-side
# bbox), scores each with libwatchduty.compute_threat, and caches them in
# CachedWildfire. Served to the map as threat-colored markers (Socket.IO
# `wildfires` request / REST /aviation/wildfires/) and to the assistant as the
# `get_nearby_wildfires` tool. Per-fire detail (reports/cameras/scanner feeds) is
# fetched on demand via get_fire_bundle. Watch Duty is US/CA-centric — a non-US
# feeder simply caches nothing. Read endpoints are public; WATCHDUTY_API_TOKEN is
# optional (raises the feeder rate limit only). Off by default.
WILDFIRES_ENABLED = get_env("WILDFIRES_ENABLED", "False", bool)
WILDFIRES_REFRESH_INTERVAL = get_env("WILDFIRES_REFRESH_INTERVAL", "300", float)
WILDFIRES_RADIUS_NM = get_env("WILDFIRES_RADIUS_NM", str(GEODATA_FETCH_RADIUS_NM), float)
# Max fire→camera distance for the detail panel. Watch Duty's camera list is the
# whole network (not fire-scoped), so cameras beyond this are dropped instead of
# showing a lookout too far away to see the fire (reads as the "wrong location").
WILDFIRES_CAMERA_RADIUS_NM = get_env("WILDFIRES_CAMERA_RADIUS_NM", "50", float)
WATCHDUTY_BASE_URL = get_env("WATCHDUTY_BASE_URL", "https://api.watchduty.org/api/v1")
# Watch Duty auth. Read endpoints (fires/reports/cameras) are public, but the
# global aircraft catalog (/aircraft/) and other user-scoped endpoints require a
# DRF token. Provide either a WATCHDUTY_API_TOKEN directly, or WATCHDUTY_USERNAME
# + WATCHDUTY_PASSWORD to log in — the service logs in once and caches the token.
WATCHDUTY_API_TOKEN = get_env("WATCHDUTY_API_TOKEN", "")
WATCHDUTY_USERNAME = get_env("WATCHDUTY_USERNAME", "")
WATCHDUTY_PASSWORD = get_env("WATCHDUTY_PASSWORD", "")

# FAA enroute structure (US airways + named waypoints/fixes) from the FAA
# Aeronautical Information Services ArcGIS FeatureServer (keyless, authoritative,
# 28-day cycle). Fetched as GeoJSON within GEODATA_FETCH_RADIUS_NM of the feeder
# (+ AIRSPACE_EXTRA_REGIONS) and cached in CachedGeoJSON as data_type
# `us_airways` (ATS_Route lines) / `us_fixes` (Designated_Point points); served by
# the generic /aviation/geojson/<type>/ endpoint and drawn as map layers. US-only:
# a non-US feeder simply fetches nothing. FAA_ENROUTE_MAX_FEATURES caps rows per
# layer (ArcGIS pages at 1000-2000/req; we paginate with resultOffset).
FAA_ENROUTE_ENABLED = get_env("FAA_ENROUTE_ENABLED", "True", bool)
FAA_AIRWAYS_URL = get_env(
    "FAA_AIRWAYS_URL",
    "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/ATS_Route/FeatureServer/0/query",
)
FAA_FIXES_URL = get_env(
    "FAA_FIXES_URL",
    "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/DesignatedPoints/FeatureServer/0/query",
)
FAA_ENROUTE_MAX_FEATURES = get_env("FAA_ENROUTE_MAX_FEATURES", "8000", int)

# Per-aircraft turbulence risk (services/turbulence.py + tasks/turbulence.py).
# Synthesizes a 0-100 risk score per tracked aircraft from G-AIRMET TURB
# forecast polygons, nearby turbulence PIREPs, and winds-aloft vertical shear.
# The scorer task runs off the aircraft hot path (TURB_SCORE_INTERVAL, seconds)
# and caches turb:by_hex for TURB_SCORE_TTL. TURB_PIREP_* bound the PIREP query;
# TURB_LEVEL_* are the score thresholds for the light/moderate/severe bands.
TURB_ENABLED = get_env("TURB_ENABLED", "True", bool)
TURB_SCORE_INTERVAL = get_env("TURB_SCORE_INTERVAL", "60", float)
TURB_SCORE_TTL = get_env("TURB_SCORE_TTL", "180", int)
# Per-point grid-cache TTL (seconds). Nearby aircraft share one assessment;
# also bounds how long an expired G-AIRMET keeps scoring, so keep it short.
TURB_GRID_TTL = get_env("TURB_GRID_TTL", "120", int)
TURB_PIREP_RADIUS_NM = get_env("TURB_PIREP_RADIUS_NM", "150", float)
TURB_PIREP_HOURS = get_env("TURB_PIREP_HOURS", "3", int)
TURB_LEVEL_LIGHT = get_env("TURB_LEVEL_LIGHT", "20", int)
TURB_LEVEL_MODERATE = get_env("TURB_LEVEL_MODERATE", "45", int)
TURB_LEVEL_SEVERE = get_env("TURB_LEVEL_SEVERE", "70", int)

# OpenSky Network Live API (https://opensky-network.org/)
# Free tier: 4,000 credits/day (8,000 for contributors)
OPENSKY_LIVE_ENABLED = get_env("OPENSKY_LIVE_ENABLED", "False", bool)
OPENSKY_USERNAME = get_env("OPENSKY_USERNAME", "")
OPENSKY_PASSWORD = get_env("OPENSKY_PASSWORD", "")

# ADS-B Exchange Live API (via RapidAPI)
# Free tier: Limited calls (check current limits)
ADSBX_LIVE_ENABLED = get_env("ADSBX_LIVE_ENABLED", "False", bool)
ADSBX_RAPIDAPI_KEY = get_env("ADSBX_RAPIDAPI_KEY", "")

# OpenSanctions owner screening (https://www.opensanctions.org/api/). Feeds a
# sanctions/PEP risk signal into ownership analysis. Requires an API key (free
# for non-commercial use); disabled by default so it is a no-op without a key.
OPENSANCTIONS_ENABLED = get_env("OPENSANCTIONS_ENABLED", "False", bool)
OPENSANCTIONS_API_URL = get_env("OPENSANCTIONS_API_URL", "https://api.opensanctions.org")
OPENSANCTIONS_API_KEY = get_env("OPENSANCTIONS_API_KEY", "")
OPENSANCTIONS_DATASET = get_env("OPENSANCTIONS_DATASET", "default")  # scope/collection to match against

# Aviationstack Flight Schedules (https://aviationstack.com/)
# Free tier: 100 requests/month
AVIATIONSTACK_ENABLED = get_env("AVIATIONSTACK_ENABLED", "False", bool)
AVIATIONSTACK_API_KEY = get_env("AVIATIONSTACK_API_KEY", "")

# FAA SWIM FNS (Flight NOTAM System)
# Provides real-time NOTAM updates via Solace messaging
# Register at: https://scds.faa.gov/
SWIM_FNS_ENABLED = get_env("SWIM_FNS_ENABLED", "False", bool)
SWIM_FNS_HOST = get_env("SWIM_FNS_HOST", "ems1.swim.faa.gov")
SWIM_FNS_PORT = get_env("SWIM_FNS_PORT", "55443", int)
SWIM_FNS_VPN = get_env("SWIM_FNS_VPN", "AIM_FNS")
SWIM_FNS_USERNAME = get_env("SWIM_FNS_USERNAME", "")
SWIM_FNS_PASSWORD = get_env("SWIM_FNS_PASSWORD", "")
SWIM_FNS_QUEUE = get_env("SWIM_FNS_QUEUE", "")


# =============================================================================
# Sentry Integration
# =============================================================================
if SENTRY_DSN and not BUILD_MODE:
    import sentry_sdk
    from sentry_sdk.integrations.celery import CeleryIntegration
    from sentry_sdk.integrations.django import DjangoIntegration
    from sentry_sdk.integrations.httpx import HttpxIntegration
    from sentry_sdk.integrations.logging import LoggingIntegration
    from sentry_sdk.integrations.redis import RedisIntegration

    # Configure logging integration
    logging_integration = LoggingIntegration(
        level=None,  # Capture all breadcrumbs
        event_level=None,  # Don't send log messages as events
    )

    sentry_sdk.init(
        dsn=SENTRY_DSN,
        environment=SENTRY_ENVIRONMENT,
        integrations=[
            DjangoIntegration(
                transaction_style="url",
                middleware_spans=True,
                signals_spans=True,
            ),
            CeleryIntegration(
                monitor_beat_tasks=True,
                propagate_traces=True,
            ),
            RedisIntegration(),
            logging_integration,
            HttpxIntegration(),
        ],
        traces_sample_rate=SENTRY_TRACES_SAMPLE_RATE,
        profiles_sample_rate=SENTRY_PROFILES_SAMPLE_RATE,
        send_default_pii=False,  # Privacy: don't send PII by default
        # Release tracking
        release="skyspy-django@2.6.0",
        # Additional context
        attach_stacktrace=True,
        # Performance monitoring
        enable_tracing=True,
    )


# =============================================================================
# Logging
# =============================================================================
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "{levelname} {asctime} {module} {process:d} {thread:d} {message}",
            "style": "{",
        },
        "simple": {
            "format": "{levelname} {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "simple",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": "INFO",
    },
    "loggers": {
        "django": {
            "handlers": ["console"],
            "level": get_env("DJANGO_LOG_LEVEL", "INFO"),
            "propagate": False,
        },
        "skyspy": {
            "handlers": ["console"],
            "level": "DEBUG" if DEBUG else "INFO",
            "propagate": False,
        },
        "celery": {
            "handlers": ["console"],
            "level": "INFO",
            "propagate": False,
        },
    },
}
