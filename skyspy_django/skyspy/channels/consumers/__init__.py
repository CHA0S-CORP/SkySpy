"""
WebSocket consumers for real-time data streaming.
"""
from skyspy.channels.consumers.aircraft import AircraftConsumer
from skyspy.channels.consumers.airspace import AirspaceConsumer
from skyspy.channels.consumers.safety import SafetyConsumer
from skyspy.channels.consumers.acars import AcarsConsumer
from skyspy.channels.consumers.audio import AudioConsumer
from skyspy.channels.consumers.alerts import AlertsConsumer
from skyspy.channels.consumers.notams import NotamConsumer
from skyspy.channels.consumers.cannonball import CannonballConsumer

__all__ = [
    'AircraftConsumer',
    'AirspaceConsumer',
    'SafetyConsumer',
    'AcarsConsumer',
    'AudioConsumer',
    'AlertsConsumer',
    'NotamConsumer',
    'CannonballConsumer',
]
