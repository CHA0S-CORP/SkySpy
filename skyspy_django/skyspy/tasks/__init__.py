"""
Celery tasks for SkysPy background processing.

Tasks:
- Aircraft polling (every 2 seconds)
- Session cleanup (every 5 minutes)
- Airspace refresh (every 5 minutes)
- Database sync (daily)
- Transcription processing
- ACARS message decoding
- Stats cache updates
"""

# Import all task modules so Celery autodiscover_tasks() registers them
from skyspy.tasks import (
    acars,
    aircraft,
    aircraft_stream,
    airspace,
    analytics,
    external_db,
    geodata,
    notams,
    notifications,
    openaip,
    transcription,
)
