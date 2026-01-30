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
import os

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'skyspy.settings')

import django
django.setup()

from django.core.asgi import get_asgi_application

# Import Socket.IO components
from skyspy.socketio import sio, socket_app
from skyspy.socketio.namespaces import register_all_namespaces

# Register all namespaces
register_all_namespaces()

# Get Django ASGI app
django_asgi_app = get_asgi_application()

# Create combined ASGI app - Socket.IO wraps Django app
# Socket.IO handles /socket.io/ path, everything else goes to Django
import socketio
application = socketio.ASGIApp(sio, django_asgi_app)
