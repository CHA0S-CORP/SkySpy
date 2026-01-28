"""
ASGI config for SkysPy project.

Configures Django Channels for WebSocket support with routing for:
- Aircraft position updates
- Airspace advisories
- Safety events
- ACARS messages
- Audio transcription updates

Includes JWT token authentication for WebSocket connections.
"""
import os

from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import AllowedHostsOriginValidator
from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'skyspy.settings')

# Initialize Django ASGI application early to ensure the AppRegistry
# is populated before importing code that may import ORM models.
django_asgi_app = get_asgi_application()

# Import websocket routing after Django setup
from skyspy.channels.routing import websocket_urlpatterns
from skyspy.auth.websocket import TokenAuthMiddlewareStack

application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": AllowedHostsOriginValidator(
        TokenAuthMiddlewareStack(
            URLRouter(websocket_urlpatterns)
        )
    ),
})
