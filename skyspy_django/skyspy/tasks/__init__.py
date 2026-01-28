"""
Celery tasks for SkysPy background processing.

Tasks:
- Aircraft polling (every 2 seconds)
- Session cleanup (every 5 minutes)
- Airspace refresh (every 5 minutes)
- Database sync (daily)
- Transcription processing
- Stats cache updates
"""

# Import all task modules so Celery autodiscover_tasks() registers them
from skyspy.tasks import aircraft
from skyspy.tasks import airspace
from skyspy.tasks import analytics
from skyspy.tasks import external_db
from skyspy.tasks import geodata
from skyspy.tasks import notams
from skyspy.tasks import notifications
from skyspy.tasks import openaip
from skyspy.tasks import transcription
