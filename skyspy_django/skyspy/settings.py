"""
Django settings for SkysPy project.
"""
import os
import warnings
from pathlib import Path

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
        return value.lower() in ('true', '1', 'yes', 'on')
    return cast(value)


# Build mode - disables external services during Docker build (collectstatic, etc.)
BUILD_MODE = get_env('BUILD_MODE', 'False', bool)


# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = get_env('DEBUG', 'True', bool)

# SECURITY WARNING: keep the secret key used in production secret!
_env_secret_key = get_env('DJANGO_SECRET_KEY')
if _env_secret_key:
    SECRET_KEY = _env_secret_key
elif DEBUG:
    # Only generate a random key in DEBUG mode for development convenience
    from django.core.management.utils import get_random_secret_key
    SECRET_KEY = get_random_secret_key()
    warnings.warn(
        'DJANGO_SECRET_KEY not set - using randomly generated key. '
        'This is only acceptable in DEBUG mode.',
        UserWarning
    )
else:
    # Production mode requires an explicit secret key
    raise ImproperlyConfigured(
        'DJANGO_SECRET_KEY must be set in production (DEBUG=False). '
        'Generate a secure key with: python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"'
    )

_allowed_hosts_raw = get_env('ALLOWED_HOSTS', '')
ALLOWED_HOSTS = [h.strip() for h in _allowed_hosts_raw.split(',') if h.strip()]

# In DEBUG mode, allow localhost connections for development
if DEBUG and not ALLOWED_HOSTS:
    ALLOWED_HOSTS = ['localhost', '127.0.0.1', '[::1]']


# Application definition

INSTALLED_APPS = [
    'daphne',  # ASGI server (must be first for runserver override)
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    # Third-party apps
    'rest_framework',
    'rest_framework_simplejwt',
    'rest_framework_simplejwt.token_blacklist',
    'django_filters',
    'corsheaders',
    'django_celery_beat',
    'drf_spectacular',
    # SkysPy apps
    'skyspy',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'skyspy.auth.middleware.AuthModeMiddleware',
    'skyspy.auth.middleware.LastActiveMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'skyspy.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'skyspy.wsgi.application'
ASGI_APPLICATION = 'skyspy.asgi.application'


# Database
# https://docs.djangoproject.com/en/5.0/ref/settings/#databases

DATABASE_URL = get_env('DATABASE_URL', 'postgresql://adsb:adsb@postgres:5432/adsb')

# Parse DATABASE_URL
def parse_database_url(url):
    """Parse DATABASE_URL into Django database config."""
    import re
    pattern = r'postgresql://(?P<user>[^:]+):(?P<password>[^@]+)@(?P<host>[^:]+):(?P<port>\d+)/(?P<name>.+)'
    match = re.match(pattern, url)
    if match:
        return {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': match.group('name'),
            'USER': match.group('user'),
            'PASSWORD': match.group('password'),
            'HOST': match.group('host'),
            'PORT': match.group('port'),
            'CONN_MAX_AGE': 60,
            'ATOMIC_REQUESTS': False,
            'AUTOCOMMIT': True,
            'CONN_HEALTH_CHECKS': False,
            'TIME_ZONE': None,
            'OPTIONS': {
                'connect_timeout': 10,
            },
        }
    return {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
        'ATOMIC_REQUESTS': False,
        'AUTOCOMMIT': True,
        'CONN_MAX_AGE': 0,
        'CONN_HEALTH_CHECKS': False,
        'TIME_ZONE': None,
        'OPTIONS': {},
    }


if BUILD_MODE:
    # Use SQLite during build to avoid PostgreSQL connection
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'build.sqlite3',
            'ATOMIC_REQUESTS': False,
            'AUTOCOMMIT': True,
            'CONN_MAX_AGE': 0,
            'CONN_HEALTH_CHECKS': False,
            'TIME_ZONE': None,
            'OPTIONS': {},
        }
    }
else:
    DATABASES = {
        'default': parse_database_url(DATABASE_URL)
    }


# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]


# Internationalization
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True


# Static files (CSS, JavaScript, Images)
STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

# Additional locations for collectstatic to find static files
# In Docker, frontend build is placed in /app/static
# In local dev, frontend build is in ../web/dist
STATICFILES_DIRS = []
_frontend_static = BASE_DIR / 'static'
if _frontend_static.exists():
    STATICFILES_DIRS.append(_frontend_static)

# Local development: check for frontend dist directory
_local_frontend_dist = BASE_DIR.parent / 'web' / 'dist'
if _local_frontend_dist.exists() and _local_frontend_dist not in STATICFILES_DIRS:
    STATICFILES_DIRS.append(_local_frontend_dist)

# WhiteNoise configuration for serving static files in production
if BUILD_MODE:
    # Use simple storage during build for speed
    STATICFILES_STORAGE = 'django.contrib.staticfiles.storage.StaticFilesStorage'
else:
    STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'


# Default primary key field type
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'


# =============================================================================
# Authentication Configuration
# =============================================================================
# Auth Mode: 'public' | 'private' | 'hybrid'
# - public: No authentication required for any endpoint
# - private: Authentication required for all endpoints
# - hybrid: Per-feature configuration (default in production)
AUTH_MODE = get_env('AUTH_MODE', 'hybrid')  # Never default to public

# JWT Configuration
JWT_SECRET_KEY = get_env('JWT_SECRET_KEY', SECRET_KEY)

# Warn if JWT_SECRET_KEY is the same as SECRET_KEY
if JWT_SECRET_KEY == SECRET_KEY:
    warnings.warn(
        'JWT_SECRET_KEY is using the same value as SECRET_KEY. '
        'For better security, set a separate JWT_SECRET_KEY environment variable.',
        UserWarning
    )

if not DEBUG and JWT_SECRET_KEY == SECRET_KEY:
    import logging
    logging.warning("JWT_SECRET_KEY should not equal DJANGO_SECRET_KEY in production!")
JWT_ACCESS_TOKEN_LIFETIME_MINUTES = get_env('JWT_ACCESS_TOKEN_LIFETIME_MINUTES', '60', int)
JWT_REFRESH_TOKEN_LIFETIME_DAYS = get_env('JWT_REFRESH_TOKEN_LIFETIME_DAYS', '2', int)
JWT_AUTH_COOKIE = get_env('JWT_AUTH_COOKIE', 'False', bool)

# OIDC Configuration
OIDC_ENABLED = get_env('OIDC_ENABLED', 'False', bool)
OIDC_PROVIDER_URL = get_env('OIDC_PROVIDER_URL', '')
OIDC_PROVIDER_NAME = get_env('OIDC_PROVIDER_NAME', 'SSO')
OIDC_CLIENT_ID = get_env('OIDC_CLIENT_ID', '')
OIDC_CLIENT_SECRET = get_env('OIDC_CLIENT_SECRET', '')
OIDC_SCOPES = get_env('OIDC_SCOPES', 'openid profile email groups')
OIDC_DEFAULT_ROLE = get_env('OIDC_DEFAULT_ROLE', 'viewer')

# Local Auth
LOCAL_AUTH_ENABLED = get_env('LOCAL_AUTH_ENABLED', 'True', bool)

# API Key Auth
API_KEY_ENABLED = get_env('API_KEY_ENABLED', 'True', bool)

# Authentication Backends
AUTHENTICATION_BACKENDS = [
    'skyspy.auth.backends.LocalAuthenticationBackend',
    'django.contrib.auth.backends.ModelBackend',
]

if OIDC_ENABLED:
    AUTHENTICATION_BACKENDS.insert(0, 'skyspy.auth.backends.OIDCAuthenticationBackend')


# =============================================================================
# Django REST Framework
# =============================================================================
# Build auth classes based on configuration
_DRF_AUTH_CLASSES = []
if AUTH_MODE != 'public':
    _DRF_AUTH_CLASSES = [
        'rest_framework_simplejwt.authentication.JWTAuthentication',
        'skyspy.auth.authentication.APIKeyAuthentication',
    ]

_DRF_PERMISSION_CLASSES = ['rest_framework.permissions.AllowAny']
if AUTH_MODE == 'private':
    _DRF_PERMISSION_CLASSES = ['rest_framework.permissions.IsAuthenticated']
elif AUTH_MODE == 'hybrid':
    _DRF_PERMISSION_CLASSES = ['skyspy.auth.permissions.IsAuthenticatedOrPublic']

REST_FRAMEWORK = {
    'DEFAULT_PERMISSION_CLASSES': _DRF_PERMISSION_CLASSES,
    'DEFAULT_AUTHENTICATION_CLASSES': _DRF_AUTH_CLASSES,
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
    ],
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.LimitOffsetPagination',
    'PAGE_SIZE': 100,
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
    'EXCEPTION_HANDLER': 'rest_framework.views.exception_handler',
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '100/minute',
        'user': '1000/minute',
    }
}


# =============================================================================
# Simple JWT Configuration
# =============================================================================
from datetime import timedelta

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=JWT_ACCESS_TOKEN_LIFETIME_MINUTES),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=JWT_REFRESH_TOKEN_LIFETIME_DAYS),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
    'UPDATE_LAST_LOGIN': True,

    'ALGORITHM': 'HS256',
    'SIGNING_KEY': JWT_SECRET_KEY,
    'VERIFYING_KEY': None,

    'AUTH_HEADER_TYPES': ('Bearer',),
    'AUTH_HEADER_NAME': 'HTTP_AUTHORIZATION',
    'USER_ID_FIELD': 'id',
    'USER_ID_CLAIM': 'user_id',

    'AUTH_TOKEN_CLASSES': ('rest_framework_simplejwt.tokens.AccessToken',),
    'TOKEN_TYPE_CLAIM': 'token_type',
}


# =============================================================================
# DRF Spectacular (OpenAPI Schema)
# =============================================================================
SPECTACULAR_SETTINGS = {
    'TITLE': 'SkysPy ADS-B Tracking API',
    'DESCRIPTION': 'Real-time ADS-B aircraft tracking, ACARS messaging, and aviation data API',
    'VERSION': '2.6.0',
    'SERVE_INCLUDE_SCHEMA': False,
    'COMPONENT_SPLIT_REQUEST': True,
    'TAGS': [
        {'name': 'aircraft', 'description': 'Live aircraft tracking'},
        {'name': 'history', 'description': 'Historical sightings and sessions'},
        {'name': 'alerts', 'description': 'Alert rule management'},
        {'name': 'safety', 'description': 'Safety event monitoring'},
        {'name': 'acars', 'description': 'ACARS/VDL2 messages'},
        {'name': 'audio', 'description': 'Audio transmission management'},
        {'name': 'aviation', 'description': 'Aviation weather and data'},
        {'name': 'airframe', 'description': 'Aircraft information'},
        {'name': 'map', 'description': 'Map data and GeoJSON'},
        {'name': 'system', 'description': 'System health and status'},
        {'name': 'notifications', 'description': 'Notification configuration'},
    ],
}


# =============================================================================
# CORS
# =============================================================================
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOW_CREDENTIALS = True
_cors_origins_raw = get_env('CORS_ALLOWED_ORIGINS', '')
CORS_ALLOWED_ORIGINS = [o.strip() for o in _cors_origins_raw.split(',') if o.strip()]


# =============================================================================
# Security Headers (conditional on production mode)
# =============================================================================
SECURE_BROWSER_XSS_FILTER = True

# Cookie security flags - always set these for protection against XSS and CSRF
CSRF_COOKIE_HTTPONLY = True
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_SAMESITE = 'Lax'

CSRF_COOKIE_SECURE = not DEBUG or get_env('FORCE_SECURE_COOKIES', 'false', bool)
SESSION_COOKIE_SECURE = not DEBUG or get_env('FORCE_SECURE_COOKIES', 'false', bool)


# =============================================================================
# Django Channels (WebSocket/Real-time)
# =============================================================================
REDIS_URL = get_env('REDIS_URL', 'redis://redis:6379/0')

# =============================================================================
# Cache Configuration (Redis for shared aircraft data across processes)
# =============================================================================
if BUILD_MODE:
    CACHES = {
        'default': {
            'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
        }
    }
else:
    CACHES = {
        'default': {
            'BACKEND': 'django.core.cache.backends.redis.RedisCache',
            'LOCATION': REDIS_URL,
            'OPTIONS': {
                'db': '1',  # Use DB 1 for cache (DB 0 used by Celery)
            },
            'KEY_PREFIX': 'skyspy',
            'TIMEOUT': 300,  # 5 minute default timeout
        }
    }

# =============================================================================
# Socket.IO Configuration
# =============================================================================
# Socket.IO uses Redis for multi-process pub/sub (configured via REDIS_URL)
# Rate limits for WebSocket broadcasts (messages per second)
WS_RATE_LIMITS = {
    'aircraft:update': 10,      # Max 10 Hz
    'aircraft:position': 5,     # Max 5 Hz for position-only updates
    'aircraft:delta': 10,       # Max 10 Hz for delta updates
    'stats:update': 0.5,        # Max 0.5 Hz (2 second minimum)
    'default': 5,               # Default rate limit
}

# Message batching configuration
WS_BATCH_WINDOW_MS = 50         # Collect messages for 50ms before sending
WS_MAX_BATCH_SIZE = 50          # Maximum messages per batch
# Immediate types bypass batching entirely for real-time feel
WS_IMMEDIATE_TYPES = [
    'alert', 'safety', 'emergency',                         # Critical events
    'aircraft:update', 'aircraft:new', 'aircraft:position', # Real-time aircraft updates
]


# =============================================================================
# Celery Configuration
# =============================================================================
if BUILD_MODE:
    # Use memory broker during build to avoid Redis connection
    CELERY_BROKER_URL = 'memory://'
    CELERY_RESULT_BACKEND = 'cache+memory://'
else:
    CELERY_BROKER_URL = REDIS_URL
    CELERY_RESULT_BACKEND = REDIS_URL
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = 'UTC'
CELERY_TASK_TRACK_STARTED = True
CELERY_TASK_TIME_LIMIT = 30 * 60  # 30 minutes
CELERY_BEAT_SCHEDULER = 'django_celery_beat.schedulers:DatabaseScheduler'


# =============================================================================
# SkysPy Application Settings
# =============================================================================

# ADS-B Sources
ULTRAFEEDER_HOST = get_env('ULTRAFEEDER_HOST', 'ultrafeeder')
ULTRAFEEDER_PORT = get_env('ULTRAFEEDER_PORT', '80')
DUMP978_HOST = get_env('DUMP978_HOST', 'dump978')
DUMP978_PORT = get_env('DUMP978_PORT', '80')

ULTRAFEEDER_URL = f"http://{ULTRAFEEDER_HOST}:{ULTRAFEEDER_PORT}"
DUMP978_URL = f"http://{DUMP978_HOST}:{DUMP978_PORT}"

# Feeder Location
FEEDER_LAT = get_env('FEEDER_LAT', '47.9377', float)
FEEDER_LON = get_env('FEEDER_LON', '-121.9687', float)

# Polling
POLLING_INTERVAL = get_env('POLLING_INTERVAL', '2', int)
DB_STORE_INTERVAL = get_env('DB_STORE_INTERVAL', '5', int)

# Session Management
SESSION_TIMEOUT_MINUTES = get_env('SESSION_TIMEOUT_MINUTES', '30', int)

# Safety Monitoring
SAFETY_MONITORING_ENABLED = get_env('SAFETY_MONITORING_ENABLED', 'True', bool)
SAFETY_VS_CHANGE_THRESHOLD = get_env('SAFETY_VS_CHANGE_THRESHOLD', '2000', int)
SAFETY_VS_EXTREME_THRESHOLD = get_env('SAFETY_VS_EXTREME_THRESHOLD', '6000', int)
SAFETY_PROXIMITY_NM = get_env('SAFETY_PROXIMITY_NM', '0.5', float)
SAFETY_ALTITUDE_DIFF_FT = get_env('SAFETY_ALTITUDE_DIFF_FT', '500', int)
SAFETY_CLOSURE_RATE_KT = get_env('SAFETY_CLOSURE_RATE_KT', '200', float)
SAFETY_TCAS_VS_THRESHOLD = get_env('SAFETY_TCAS_VS_THRESHOLD', '1500', int)

# Default Alerts
PROXIMITY_ALERT_NM = get_env('PROXIMITY_ALERT_NM', '5.0', float)
WATCH_ICAO_LIST = get_env('WATCH_ICAO_LIST', '')
WATCH_FLIGHT_LIST = get_env('WATCH_FLIGHT_LIST', '')
ALERT_MILITARY = get_env('ALERT_MILITARY', 'True', bool)
ALERT_EMERGENCY = get_env('ALERT_EMERGENCY', 'True', bool)

# ACARS Settings
ACARS_PORT = get_env('ACARS_PORT', '5555', int)
VDLM2_PORT = get_env('VDLM2_PORT', '5556', int)
ACARS_ENABLED = get_env('ACARS_ENABLED', 'True', bool)

# Notifications
APPRISE_URLS = get_env('APPRISE_URLS', '')
NOTIFICATION_COOLDOWN = get_env('NOTIFICATION_COOLDOWN', '300', int)

# Caching
CACHE_TTL = get_env('CACHE_TTL', '5', int)
UPSTREAM_API_MIN_INTERVAL = get_env('UPSTREAM_API_MIN_INTERVAL', '60', int)

# Photo Cache
PHOTO_CACHE_ENABLED = get_env('PHOTO_CACHE_ENABLED', 'True', bool)
PHOTO_CACHE_DIR = get_env('PHOTO_CACHE_DIR', '/data/photos')
PHOTO_AUTO_DOWNLOAD = get_env('PHOTO_AUTO_DOWNLOAD', 'True', bool)

# S3 Storage
S3_ENABLED = get_env('S3_ENABLED', 'False', bool)
S3_BUCKET = get_env('S3_BUCKET', '')
S3_REGION = get_env('S3_REGION', 'us-east-1')
S3_ACCESS_KEY = get_env('S3_ACCESS_KEY')
S3_SECRET_KEY = get_env('S3_SECRET_KEY')
S3_ENDPOINT_URL = get_env('S3_ENDPOINT_URL')
S3_PREFIX = get_env('S3_PREFIX', 'aircraft-photos')
S3_PUBLIC_URL = get_env('S3_PUBLIC_URL')

# Radio/Audio
RADIO_ENABLED = get_env('RADIO_ENABLED', 'True', bool)
RADIO_AUDIO_DIR = get_env('RADIO_AUDIO_DIR', '/data/radio')
RADIO_MAX_FILE_SIZE_MB = get_env('RADIO_MAX_FILE_SIZE_MB', '50', int)
RADIO_RETENTION_DAYS = get_env('RADIO_RETENTION_DAYS', '7', int)
RADIO_S3_PREFIX = get_env('RADIO_S3_PREFIX', 'radio-transmissions')

# Transcription
TRANSCRIPTION_ENABLED = get_env('TRANSCRIPTION_ENABLED', 'False', bool)
TRANSCRIPTION_SERVICE_URL = get_env('TRANSCRIPTION_SERVICE_URL')
TRANSCRIPTION_MODEL = get_env('TRANSCRIPTION_MODEL')
TRANSCRIPTION_API_KEY = get_env('TRANSCRIPTION_API_KEY')

# Whisper
WHISPER_ENABLED = get_env('WHISPER_ENABLED', 'False', bool)
WHISPER_URL = get_env('WHISPER_URL', 'http://whisper:9000')

# ATC Whisper
ATC_WHISPER_ENABLED = get_env('ATC_WHISPER_ENABLED', 'False', bool)
ATC_WHISPER_MAX_CONCURRENT = get_env('ATC_WHISPER_MAX_CONCURRENT', '2', int)
ATC_WHISPER_SEGMENT_BY_VAD = get_env('ATC_WHISPER_SEGMENT_BY_VAD', 'True', bool)
ATC_WHISPER_PREPROCESS = get_env('ATC_WHISPER_PREPROCESS', 'True', bool)
ATC_WHISPER_NOISE_REDUCE = get_env('ATC_WHISPER_NOISE_REDUCE', 'True', bool)
ATC_WHISPER_POSTPROCESS = get_env('ATC_WHISPER_POSTPROCESS', 'True', bool)

# LLM API Configuration (for enhanced transcript analysis)
LLM_ENABLED = get_env('LLM_ENABLED', 'False', bool)
LLM_API_URL = get_env('LLM_API_URL', 'https://api.openai.com/v1')
LLM_API_KEY = get_env('LLM_API_KEY', '')
LLM_MODEL = get_env('LLM_MODEL', 'gpt-4o-mini')
LLM_TIMEOUT = get_env('LLM_TIMEOUT', '30', int)
LLM_MAX_RETRIES = get_env('LLM_MAX_RETRIES', '3', int)
LLM_CACHE_TTL = get_env('LLM_CACHE_TTL', '3600', int)
LLM_MAX_TOKENS = get_env('LLM_MAX_TOKENS', '500', int)
LLM_TEMPERATURE = get_env('LLM_TEMPERATURE', '0.1', float)

# OpenSky Database
OPENSKY_DB_PATH = get_env('OPENSKY_DB_PATH', '/data/opensky/aircraft-database.csv')
OPENSKY_DB_ENABLED = get_env('OPENSKY_DB_ENABLED', 'True', bool)

# Sentry
SENTRY_DSN = get_env('SENTRY_DSN')
SENTRY_ENVIRONMENT = get_env('SENTRY_ENVIRONMENT', 'development')
SENTRY_TRACES_SAMPLE_RATE = get_env('SENTRY_TRACES_SAMPLE_RATE', '0.1', float)
SENTRY_PROFILES_SAMPLE_RATE = get_env('SENTRY_PROFILES_SAMPLE_RATE', '0.1', float)

# Prometheus
PROMETHEUS_ENABLED = get_env('PROMETHEUS_ENABLED', 'True', bool)

# =============================================================================
# Free Data Sources (New APIs)
# =============================================================================

# CheckWX Weather API (https://www.checkwxapi.com/)
# Free tier: 3,000 requests/day
CHECKWX_ENABLED = get_env('CHECKWX_ENABLED', 'False', bool)
CHECKWX_API_KEY = get_env('CHECKWX_API_KEY', '')

# AVWX Weather API (https://avwx.rest/)
# Free tier: Unlimited basic requests
AVWX_ENABLED = get_env('AVWX_ENABLED', 'True', bool)
AVWX_API_KEY = get_env('AVWX_API_KEY', '')

# OpenAIP Airspace (https://www.openaip.net/)
# Free tier: Unlimited with API key
OPENAIP_ENABLED = get_env('OPENAIP_ENABLED', 'False', bool)
OPENAIP_API_KEY = get_env('OPENAIP_API_KEY', '')

# OpenSky Network Live API (https://opensky-network.org/)
# Free tier: 4,000 credits/day (8,000 for contributors)
OPENSKY_LIVE_ENABLED = get_env('OPENSKY_LIVE_ENABLED', 'False', bool)
OPENSKY_USERNAME = get_env('OPENSKY_USERNAME', '')
OPENSKY_PASSWORD = get_env('OPENSKY_PASSWORD', '')

# ADS-B Exchange Live API (via RapidAPI)
# Free tier: Limited calls (check current limits)
ADSBX_LIVE_ENABLED = get_env('ADSBX_LIVE_ENABLED', 'False', bool)
ADSBX_RAPIDAPI_KEY = get_env('ADSBX_RAPIDAPI_KEY', '')

# Aviationstack Flight Schedules (https://aviationstack.com/)
# Free tier: 100 requests/month
AVIATIONSTACK_ENABLED = get_env('AVIATIONSTACK_ENABLED', 'False', bool)
AVIATIONSTACK_API_KEY = get_env('AVIATIONSTACK_API_KEY', '')


# =============================================================================
# Sentry Integration
# =============================================================================
if SENTRY_DSN and not BUILD_MODE:
    import sentry_sdk
    from sentry_sdk.integrations.django import DjangoIntegration
    from sentry_sdk.integrations.celery import CeleryIntegration
    from sentry_sdk.integrations.redis import RedisIntegration
    from sentry_sdk.integrations.logging import LoggingIntegration
    from sentry_sdk.integrations.httpx import HttpxIntegration

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
                transaction_style='url',
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
        release=f"skyspy-django@2.6.0",
        # Additional context
        attach_stacktrace=True,
        # Performance monitoring
        enable_tracing=True,
    )


# =============================================================================
# Logging
# =============================================================================
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format': '{levelname} {asctime} {module} {process:d} {thread:d} {message}',
            'style': '{',
        },
        'simple': {
            'format': '{levelname} {message}',
            'style': '{',
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'simple',
        },
    },
    'root': {
        'handlers': ['console'],
        'level': 'INFO',
    },
    'loggers': {
        'django': {
            'handlers': ['console'],
            'level': get_env('DJANGO_LOG_LEVEL', 'INFO'),
            'propagate': False,
        },
        'skyspy': {
            'handlers': ['console'],
            'level': 'DEBUG' if DEBUG else 'INFO',
            'propagate': False,
        },
        'celery': {
            'handlers': ['console'],
            'level': 'INFO',
            'propagate': False,
        },
    },
}
