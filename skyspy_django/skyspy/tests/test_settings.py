"""
Test-specific Django settings for SkysPy.

These settings override the main settings for running tests in isolation.
"""

import os
from datetime import timedelta
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.gis",
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "django_filters",
    "corsheaders",
    "drf_spectacular",
    "django_celery_beat",
    "django_celery_results",
    "skyspy",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "skyspy.urls"
WSGI_APPLICATION = "skyspy.wsgi.application"
ASGI_APPLICATION = "skyspy.asgi.application"

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

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# REST Framework
# Use FeatureBasedPermission which dynamically checks AUTH_MODE and FeatureAccess at request time
# This allows tests to use override_settings(AUTH_MODE=...) and feature_access fixtures
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
        "skyspy.auth.authentication.APIKeyAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "skyspy.auth.permissions.FeatureBasedPermission",
    ],
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
    ],
    # Disable throttling in tests
    "DEFAULT_THROTTLE_CLASSES": [],
    "DEFAULT_THROTTLE_RATES": {
        "auth": None,
        "upload": None,
        "alert_write": None,
    },
}

# Simple JWT
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=60),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=1),
    "AUTH_HEADER_TYPES": ("Bearer",),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
}

# Enable API key authentication
API_KEY_ENABLED = True

# Auth mode for tests - 'public' allows all access without authentication
# This is appropriate for tests that aren't specifically testing authentication
AUTH_MODE = "public"

# Tests exercise production enforcement of the AI/sensitive auth gates, so the
# local-dev bypass stays off.
DEV_MODE = False

# =============================================================================
# Test Environment Configuration
# =============================================================================

# Force debug mode off in tests for more realistic behavior
DEBUG = False

# Use a separate test secret key
SECRET_KEY = "test-secret-key-for-skyspy-testing-only"

# =============================================================================
# Database Configuration
# =============================================================================


def parse_database_url(url):
    """Parse DATABASE_URL into Django database config."""
    import re

    pattern = r"postgresql://(?P<user>[^:]+):(?P<password>[^@]+)@(?P<host>[^:]+):(?P<port>\d+)/(?P<name>.+)"
    match = re.match(pattern, url)
    if not match:
        raise ValueError(f"Invalid DATABASE_URL format: {url}")

    return {
        # PostGIS backend — CI runs the combined postgis+pgvector image, so
        # spatial geom fields/lookups are exercised under test.
        "ENGINE": "django.contrib.gis.db.backends.postgis",
        "NAME": match.group("name"),
        "USER": match.group("user"),
        "PASSWORD": match.group("password"),
        "HOST": match.group("host"),
        "PORT": match.group("port"),
        "ATOMIC_REQUESTS": False,
        "AUTOCOMMIT": True,
        "CONN_MAX_AGE": 0,
        "CONN_HEALTH_CHECKS": False,
        "TIME_ZONE": "UTC",
        "OPTIONS": {},
        "TEST": {
            "NAME": match.group("name"),
        },
    }


# Use DATABASE_URL from environment if available, otherwise use SQLite file for local testing
DATABASE_URL = os.environ.get("DATABASE_URL")

if DATABASE_URL:
    DATABASES = {"default": parse_database_url(DATABASE_URL)}
else:
    # Use SQLite file for local testing (not in-memory to persist across connections)
    import tempfile

    _test_db_file = os.path.join(tempfile.gettempdir(), "skyspy_test.sqlite3")
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": _test_db_file,
            "TIME_ZONE": "UTC",
            "ATOMIC_REQUESTS": False,
            "AUTOCOMMIT": True,
            "CONN_MAX_AGE": 0,
            "CONN_HEALTH_CHECKS": False,
            "OPTIONS": {},
            "TEST": {"NAME": _test_db_file},
        }
    }

# =============================================================================
# Cache Configuration
# =============================================================================

# Use local memory cache for tests
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "skyspy-test-cache",
    }
}

# =============================================================================
# Socket.IO Configuration
# =============================================================================

# Note: Django Channels has been replaced with Socket.IO.
# Socket.IO uses Redis for pub/sub in production, but for tests we don't need
# a channel layer configuration. Socket.IO tests use python-socketio's test client.

# =============================================================================
# Celery Configuration
# =============================================================================

# Execute tasks synchronously in tests
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
CELERY_BROKER_URL = "memory://"
CELERY_RESULT_BACKEND = "cache+memory://"

# =============================================================================
# SkysPy Application Settings (Test Defaults)
# =============================================================================

# ADS-B Sources - use mock URLs for tests
ULTRAFEEDER_HOST = "localhost"
ULTRAFEEDER_PORT = "18080"
DUMP978_HOST = "localhost"
DUMP978_PORT = "18081"

ULTRAFEEDER_URL = f"http://{ULTRAFEEDER_HOST}:{ULTRAFEEDER_PORT}"
DUMP978_URL = f"http://{DUMP978_HOST}:{DUMP978_PORT}"

# Feeder Location - test location
FEEDER_LAT = 47.9377
FEEDER_LON = -121.9687

# Aviation reference-data fetch radius around the feeder
AIRSPACE_FETCH_RADIUS_NM = 250.0
GEODATA_FETCH_RADIUS_NM = 250.0
AIRSPACE_EXTRA_REGIONS = []

# Watch Duty wildfire overlay — disabled in tests; the client is mocked.
WILDFIRES_ENABLED = False
WILDFIRES_REFRESH_INTERVAL = 300.0
WILDFIRES_RADIUS_NM = 250.0
WILDFIRES_CAMERA_RADIUS_NM = 50.0
WATCHDUTY_BASE_URL = "https://api.watchduty.example/api/v1"
WATCHDUTY_API_TOKEN = ""
WATCHDUTY_USERNAME = ""
WATCHDUTY_PASSWORD = ""

# FAA enroute structure (US airways + fixes) — disabled in tests; fetchers mock URLs.
FAA_ENROUTE_ENABLED = False
FAA_AIRWAYS_URL = "https://faa.example/ATS_Route/FeatureServer/0/query"
FAA_FIXES_URL = "https://faa.example/DesignatedPoints/FeatureServer/0/query"
FAA_ENROUTE_MAX_FEATURES = 8000

# Per-aircraft turbulence risk scoring
TURB_ENABLED = True
TURB_SCORE_INTERVAL = 60.0
TURB_SCORE_TTL = 180
TURB_GRID_TTL = 120
TURB_PIREP_RADIUS_NM = 150.0
TURB_PIREP_HOURS = 3
TURB_LEVEL_LIGHT = 20
TURB_LEVEL_MODERATE = 45
TURB_LEVEL_SEVERE = 70

# Polling - faster for tests
POLLING_INTERVAL = 1
DB_STORE_INTERVAL = 1

# Map server-side clustering
MAP_CLUSTER_ZOOM_THRESHOLD = 8
MAP_CLUSTER_EPS_BASE = 0.4
MAP_CLUSTER_MAX_POINTS = 2000
LIVE_POSITION_TTL = 90

# Aircraft Streaming - disabled by default for tests
AIRCRAFT_STREAM_ENABLED = False
AIRCRAFT_STREAM_HOST = "localhost"
AIRCRAFT_STREAM_PORT = 30047
AIRCRAFT_STREAM_RECONNECT_DELAY = 1
AIRCRAFT_STREAM_BATCH_MS = 100
AIRCRAFT_STREAM_ADSBLOL_INTERVAL = 2.0
AIRCRAFT_STREAM_ADSBLOL_RADIUS = 250
AIRCRAFT_STREAM_FREE_SOURCES = "adsb.lol,adsb.fi,airplanes.live"

# Session Management
SESSION_TIMEOUT_MINUTES = 5

# Safety Monitoring - enable for tests
SAFETY_MONITORING_ENABLED = True
SAFETY_VS_CHANGE_THRESHOLD = 2000
SAFETY_VS_EXTREME_THRESHOLD = 6000
SAFETY_PROXIMITY_NM = 0.5
SAFETY_ALTITUDE_DIFF_FT = 500
SAFETY_CLOSURE_RATE_KT = 200.0
SAFETY_TCAS_VS_THRESHOLD = 1500

# Default Alerts
WATCH_ICAO_LIST = ""
WATCH_FLIGHT_LIST = ""

# ACARS Settings - test ports
ACARS_PORT = 15555
VDLM2_PORT = 15556
ACARS_ENABLED = True

# Airframes.io live ACARS feed - disabled in tests (no network)
AIRFRAMES_ACARS_ENABLED = False

# OpenSanctions owner screening - disabled in tests (no network / no key)
OPENSANCTIONS_ENABLED = False
OPENSANCTIONS_API_URL = "https://api.opensanctions.org"
OPENSANCTIONS_API_KEY = ""
OPENSANCTIONS_DATASET = "default"
AIRFRAMES_ACARS_URL = "https://api.airframes.io/v1/messages"
AIRFRAMES_ACARS_API_KEY = ""
AIRFRAMES_ACARS_POLL_INTERVAL = 4
AIRFRAMES_ACARS_AIRPORTS = "KLAX,KVNY,KBUR,KSNA,KLGB,KONT,KHHR,KNKX"
AIRFRAMES_ACARS_CENTER_LAT = 33.9416
AIRFRAMES_ACARS_CENTER_LON = -118.4085
AIRFRAMES_ACARS_RADIUS_NM = 100.0

# Notifications - disabled for tests
APPRISE_URLS = ""
NOTIFICATION_COOLDOWN = 60
NOTIFICATION_WEBHOOK_ALLOWED_PRIVATE_CIDRS = ""

# Caching - short TTL for tests
CACHE_TTL = 1
UPSTREAM_API_MIN_INTERVAL = 5

# Photo Cache - disabled for tests
PHOTO_CACHE_ENABLED = False
PHOTO_CACHE_DIR = "/tmp/skyspy-test-photos"
PHOTO_AUTO_DOWNLOAD = False
PHOTO_PLANESPOTTERS_USER_AGENT = "skyspy-test/1.0 (+https://example.com/contact)"

# S3 Storage - disabled for tests
S3_ENABLED = False
S3_BUCKET = ""
S3_REGION = "us-east-1"
S3_ACCESS_KEY = None
S3_SECRET_KEY = None
S3_ENDPOINT_URL = None
S3_PREFIX = "test-aircraft-photos"
S3_PUBLIC_URL = None

# Radio/Audio - use temp directory
RADIO_ENABLED = True
RADIO_AUDIO_DIR = "/tmp/skyspy-test-radio"
RADIO_MAX_FILE_SIZE_MB = 10
RADIO_RETENTION_DAYS = 1
RADIO_S3_PREFIX = "test-radio-transmissions"

# Transcription - disabled for tests
TRANSCRIPTION_ENABLED = False
TRANSCRIPTION_SERVICE_URL = None
TRANSCRIPTION_MODEL = None
TRANSCRIPTION_API_KEY = None

# Whisper - disabled for tests
WHISPER_ENABLED = False
WHISPER_URL = "http://localhost:19000"

# ATC Whisper - disabled for tests
ATC_WHISPER_ENABLED = False
ATC_WHISPER_MAX_CONCURRENT = 1
ATC_WHISPER_SEGMENT_BY_VAD = True
ATC_WHISPER_PREPROCESS = True
ATC_WHISPER_NOISE_REDUCE = True
ATC_WHISPER_POSTPROCESS = True

# OpenSky Database - disabled for tests
OPENSKY_DB_PATH = "/tmp/skyspy-test-opensky/aircraft-database.csv"
OPENSKY_DB_ENABLED = False

# LLM - disabled for tests
LLM_ENABLED = False
LLM_API_URL = "http://localhost:11434"
LLM_API_KEY = ""
LLM_MODEL = "test-model"
LLM_TIMEOUT = 30
LLM_MAX_RETRIES = 3
LLM_CACHE_TTL = 300
LLM_MAX_TOKENS = 1000
LLM_TEMPERATURE = 0.7

# Embeddings / airframe RAG - disabled for tests
EMBEDDING_API_URL = ""
EMBEDDING_API_KEY = ""
EMBEDDING_MODEL = "test-embedding-model"
EMBEDDING_DIM = 1536

# LLM assistant - disabled for tests (tool-selection tests stub the model)
ASSISTANT_ENABLED = False
ASSISTANT_MODEL = "test-model"
ASSISTANT_MAX_STEPS = 6
ASSISTANT_MAX_STEPS_COMPACT = 4
ASSISTANT_TIMEOUT = 60
ASSISTANT_MAX_RESULT_CHARS = 6000
ASSISTANT_MAX_HISTORY_MSGS = 16
ASSISTANT_MAX_HISTORY_CHARS = 3000
ASSISTANT_CONTEXT_WINDOW = 0
# Off in tests: no probing a (nonexistent) endpoint for the model window.
ASSISTANT_CONTEXT_WINDOW_AUTO = False
# The assistant's web_search tool stays off in tests (gating asserted explicitly).
ASSISTANT_WEB_SEARCH_ENABLED = False
# Off in tests so tool-selection assertions see a clean query (no live snapshot).
ASSISTANT_BRIEFING_ENABLED = False
ASSISTANT_PHOTO_BASE_URL = ""

# Metered flight-schedule API (AviationStack). Off in tests — the flight_schedule
# assistant tool no-ops without it.
AVIATIONSTACK_ENABLED = False
AVIATIONSTACK_API_KEY = ""

# Auto-generated airframe type cards (daily LLM back-fill). Off in tests.
AIRFRAME_CARD_GEN_ENABLED = False
AIRFRAME_CARD_GEN_BATCH = 8
AIRFRAME_CARD_GEN_MIN_TAILS = 1

# Runtime web search. Off in tests (no live network); providers mocked per-test.
WEB_SEARCH_ENABLED = False
WEB_SEARCH_PROVIDER = "wikipedia"
WEB_SEARCH_API_KEY = ""
WEB_SEARCH_URL = ""
WEB_SEARCH_MAX_RESULTS = 5
WEB_SEARCH_USER_AGENT = "skyspy-test/3 (+https://example.test)"

# Sentry - disabled for tests
SENTRY_DSN = None
SENTRY_ENVIRONMENT = "test"
SENTRY_TRACES_SAMPLE_RATE = 0.0

# Prometheus - disabled for tests
PROMETHEUS_ENABLED = False

# Redis - disabled for tests
REDIS_URL = ""

# Version
VERSION = "1.0.0-test"

# Embedding dimension for the pgvector VectorField on AirframeDocument. Mirrors the
# main settings default (text-embedding-3-small = 1536); required or model import
# fails at django.setup().
EMBEDDING_DIM = int(os.environ.get("EMBEDDING_DIM", "1536"))

# Celery heartbeat
CELERY_HEARTBEAT_KEY = "celery_heartbeat"

# ACARS UDP ports
ACARS_UDP_PORT = 5550
VDLM2_UDP_PORT = 5555

# CORS
CORS_ALLOW_ALL_ORIGINS = True
ALLOWED_HOSTS = ["*"]

# =============================================================================
# Logging Configuration
# =============================================================================

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "{levelname} {asctime} {module} {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "verbose",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": "WARNING",  # Reduce noise in tests
    },
    "loggers": {
        "django": {
            "handlers": ["console"],
            "level": "WARNING",
            "propagate": False,
        },
        "skyspy": {
            "handlers": ["console"],
            "level": "WARNING",  # Can set to DEBUG for test debugging
            "propagate": False,
        },
        "sio": {
            "handlers": ["console"],
            "level": "WARNING",
            "propagate": False,
        },
    },
}

# =============================================================================
# Password Hashers - use fast hasher for tests
# =============================================================================

PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.MD5PasswordHasher",
]

# =============================================================================
# Additional Test-Specific Settings
# =============================================================================

# Disable migrations for faster tests (optional)
# Uncomment if you want to skip migrations in tests
# class DisableMigrations:
#     def __contains__(self, item):
#         return True
#     def __getitem__(self, item):
#         return None
# MIGRATION_MODULES = DisableMigrations()

# Test runner configuration
TEST_RUNNER = "django.test.runner.DiscoverRunner"
