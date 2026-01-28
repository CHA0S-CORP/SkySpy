"""
SkysPy Django Application.

ADS-B aircraft tracking, ACARS messaging, and aviation data API.
"""
import os

__version__ = '2.6.0'

# Skip celery import during build mode (collectstatic, etc.)
if not os.environ.get('BUILD_MODE'):
    # This will make sure the app is always imported when
    # Django starts so that shared_task will use this app.
    from skyspy.celery import app as celery_app
    __all__ = ('celery_app',)
else:
    celery_app = None
    __all__ = ()
