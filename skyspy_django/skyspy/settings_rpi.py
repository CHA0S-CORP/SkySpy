"""
Raspberry Pi 5 optimized settings for SkysPy.

This module extends the base settings with RPi-specific optimizations for:
- Reduced polling frequency
- Disabled resource-heavy features
- Increased cache TTLs
- Limited in-memory structures
- Optimized database connections

Usage:
    export DJANGO_SETTINGS_MODULE=skyspy.settings_rpi

Or in Docker Compose:
    environment:
      - DJANGO_SETTINGS_MODULE=skyspy.settings_rpi
"""
from .settings import *

# =============================================================================
# Polling & Storage Intervals
# =============================================================================
# Reduce polling frequency to save CPU
POLLING_INTERVAL = 3  # Was 2 seconds - reduces CPU load by ~33%
DB_STORE_INTERVAL = 10  # Was 5 seconds - halves database write frequency

# =============================================================================
# Disable Resource-Heavy Features
# =============================================================================
# These features are CPU/memory intensive and may not be needed on RPi
TRANSCRIPTION_ENABLED = False
WHISPER_ENABLED = False
ATC_WHISPER_ENABLED = False
PHOTO_AUTO_DOWNLOAD = False  # Disable automatic photo downloads
LLM_ENABLED = False

# =============================================================================
# Cache Configuration
# =============================================================================
# Increase cache TTLs to reduce computation frequency
CACHE_TTL = 10  # Was 5 seconds - doubles cache effectiveness
STATS_CACHE_TTL = 120  # 2 minutes for stats (new setting)
ANTENNA_ANALYTICS_CACHE_TTL = 180  # 3 minutes for antenna data

# =============================================================================
# In-Memory Structure Limits
# =============================================================================
# Limit memory usage for in-memory data structures
MAX_SEEN_AIRCRAFT = 5000  # Was 10000 - halves memory for seen aircraft tracking
ACARS_BUFFER_SIZE = 30  # Was 50 - reduces ACARS message buffer
WEBSOCKET_CAPACITY = 1000  # Was 1500 - limit channel layer capacity

# =============================================================================
# Database Connection Optimization
# =============================================================================
# Keep connections open longer to reduce connection overhead
CONN_MAX_AGE = 120  # Was 60 - doubles connection lifetime
DATABASE_OPTIONS = {
    'connect_timeout': 5,  # Faster timeout for connection attempts
}

# Update database config with new options
if not BUILD_MODE and 'default' in DATABASES:
    DATABASES['default']['CONN_MAX_AGE'] = CONN_MAX_AGE
    DATABASES['default'].setdefault('OPTIONS', {}).update(DATABASE_OPTIONS)

# =============================================================================
# WebSocket/Channel Layer Optimization
# =============================================================================
# Reduce channel layer capacity for lower memory usage
if not BUILD_MODE:
    CHANNEL_LAYERS['default']['CONFIG']['capacity'] = WEBSOCKET_CAPACITY

# =============================================================================
# Celery Beat Schedule Adjustments
# =============================================================================
# Reduce frequency of expensive background tasks
# These overrides are applied in celery.py when this settings module is used

# Task interval overrides (in seconds or crontab)
RPI_TASK_INTERVALS = {
    # Stats tasks - reduce frequency
    'flight_pattern_geographic_stats': 600,  # Was 120s (2min) -> 10min
    'time_comparison_stats': 900,  # Was 300s (5min) -> 15min
    'tracking_quality_stats': 600,  # Was 120s (2min) -> 10min
    'engagement_stats': 600,  # Was 120s (2min) -> 10min
    'antenna_analytics': 600,  # Was 300s (5min) -> 10min

    # Other expensive tasks
    'acars_stats': 120,  # Was 60s -> 2min
    'stats_cache': 90,  # Was 60s -> 90s
    'safety_stats': 60,  # Was 30s -> 60s
}

# =============================================================================
# Data Retention (shorter for RPi storage constraints)
# =============================================================================
# Can be overridden via environment variables
import os

SIGHTING_RETENTION_DAYS = int(os.getenv('SIGHTING_RETENTION_DAYS', '7'))  # Was 30
SESSION_RETENTION_DAYS = int(os.getenv('SESSION_RETENTION_DAYS', '14'))  # Was 90
ALERT_HISTORY_DAYS = int(os.getenv('ALERT_HISTORY_DAYS', '7'))  # Was 30
ANTENNA_SNAPSHOT_RETENTION_DAYS = int(os.getenv('ANTENNA_SNAPSHOT_RETENTION_DAYS', '3'))  # Was 7

# =============================================================================
# Query Limits
# =============================================================================
# Hard limits to prevent runaway queries
MAX_HISTORY_HOURS = 72  # Limit history queries to 3 days
MAX_QUERY_RESULTS = 10000  # Hard cap on result sets
MAX_STATS_SAMPLE_SIZE = 1000  # Limit for stats calculations

# =============================================================================
# WebSocket Rate Limiting
# =============================================================================
# Rate limits for WebSocket broadcasts (messages per second)
WS_RATE_LIMITS = {
    'aircraft:update': 10,  # Max 10 Hz
    'aircraft:position': 5,  # Max 5 Hz for position-only updates
    'aircraft:delta': 10,  # Max 10 Hz for delta updates
    'stats:update': 0.5,  # Max 0.5 Hz (2 second minimum)
    'default': 5,  # Default rate limit
}

# Message batching configuration
WS_BATCH_WINDOW_MS = 50  # Collect messages for 50ms before sending (reduced from 200ms for responsiveness)
WS_MAX_BATCH_SIZE = 50  # Maximum messages per batch
# Immediate types bypass batching entirely for real-time feel
WS_IMMEDIATE_TYPES = [
    'alert', 'safety', 'emergency',  # Critical events
    'aircraft:update', 'aircraft:new', 'aircraft:position',  # Real-time aircraft updates
]

# =============================================================================
# Logging (reduce verbosity for RPi)
# =============================================================================
LOGGING['root']['level'] = 'WARNING'
LOGGING['loggers']['skyspy']['level'] = 'INFO'
LOGGING['loggers']['django']['level'] = 'WARNING'

# =============================================================================
# Lite Mode Flag
# =============================================================================
# Enable lite mode for stats calculations
RPI_LITE_MODE = True
