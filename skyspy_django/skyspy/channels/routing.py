"""
Django Channels URL routing for WebSocket connections.
"""
from django.urls import path, re_path
from skyspy.channels.consumers.aircraft import AircraftConsumer
from skyspy.channels.consumers.airspace import AirspaceConsumer
from skyspy.channels.consumers.safety import SafetyConsumer
from skyspy.channels.consumers.acars import AcarsConsumer
from skyspy.channels.consumers.audio import AudioConsumer
from skyspy.channels.consumers.alerts import AlertsConsumer
from skyspy.channels.consumers.notams import NotamConsumer
from skyspy.channels.consumers.cannonball import CannonballConsumer
from skyspy.channels.consumers.stats import StatsConsumer

websocket_urlpatterns = [
    # Main aircraft tracking WebSocket
    path('ws/aircraft/', AircraftConsumer.as_asgi()),

    # Airspace advisories and boundaries
    path('ws/airspace/', AirspaceConsumer.as_asgi()),

    # Safety events
    path('ws/safety/', SafetyConsumer.as_asgi()),

    # ACARS messages
    path('ws/acars/', AcarsConsumer.as_asgi()),

    # Audio transcription updates
    path('ws/audio/', AudioConsumer.as_asgi()),

    # Custom alert triggers
    path('ws/alerts/', AlertsConsumer.as_asgi()),

    # NOTAMs and TFRs
    path('ws/notams/', NotamConsumer.as_asgi()),

    # Cannonball mode (mobile threat detection)
    path('ws/cannonball/', CannonballConsumer.as_asgi()),

    # Statistics WebSocket
    path('ws/stats/', StatsConsumer.as_asgi()),

    # Combined feed (all topics)
    re_path(r'ws/all/$', AircraftConsumer.as_asgi()),
]
