"""
ASGI config for SkysPy project.

Configures Socket.IO for WebSocket support with namespaces for:
- Aircraft position updates
- Airspace advisories
- Safety events
- ACARS messages
- Audio transcription updates

Socket.IO handles /socket.io/ path, everything else goes to Django.
"""
import logging
import os

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'skyspy.settings')

import django
django.setup()

from django.core.asgi import get_asgi_application

# Import Socket.IO components
from skyspy.socketio import sio, socket_app
from skyspy.socketio.namespaces import register_all_namespaces

logger = logging.getLogger(__name__)

# Register all namespaces
register_all_namespaces()

# Get Django ASGI app
django_asgi_app = get_asgi_application()

# Create combined ASGI app - Socket.IO wraps Django app
# Socket.IO handles /socket.io/ path, everything else goes to Django
import socketio
application = socketio.ASGIApp(sio, django_asgi_app)


# =============================================================================
# Startup Data Initialization
# =============================================================================
def _ensure_aviation_data():
    """
    Check if aviation data is populated and queue refresh if empty.

    This runs on server startup to ensure airspace boundaries, advisories,
    and geodata (airports, navaids) are available. If the database is empty,
    it queues Celery tasks to populate the data asynchronously.
    """
    try:
        from skyspy.models import AirspaceBoundary, AirspaceAdvisory

        # Check airspace boundaries
        boundary_count = AirspaceBoundary.objects.count()
        if boundary_count == 0:
            logger.info("Airspace boundaries empty - queuing initial population")
            try:
                from skyspy.tasks.airspace import refresh_airspace_boundaries
                refresh_airspace_boundaries.delay()
                logger.info("Queued refresh_airspace_boundaries task")
            except Exception as e:
                logger.warning(f"Failed to queue airspace boundary refresh: {e}")
        else:
            logger.debug(f"Airspace data present: {boundary_count} boundaries")

        # Check advisories
        advisory_count = AirspaceAdvisory.objects.count()
        if advisory_count == 0:
            logger.info("Airspace advisories empty - queuing initial fetch")
            try:
                from skyspy.tasks.airspace import refresh_airspace_advisories
                refresh_airspace_advisories.delay()
                logger.info("Queued refresh_airspace_advisories task")
            except Exception as e:
                logger.warning(f"Failed to queue airspace advisory refresh: {e}")

        # Check geodata (airports, navaids)
        try:
            from skyspy.services import geodata
            if geodata.should_refresh():
                logger.info("Geodata needs refresh - queuing initial population")
                try:
                    from skyspy.tasks.geodata import refresh_all_geodata
                    refresh_all_geodata.delay()
                    logger.info("Queued refresh_all_geodata task")
                except Exception as e:
                    logger.warning(f"Failed to queue geodata refresh: {e}")
        except Exception as e:
            logger.warning(f"Error checking geodata: {e}")

    except Exception as e:
        logger.warning(f"Error checking aviation data on startup: {e}")


# Run startup initialization (non-blocking via Celery)
_ensure_aviation_data()
