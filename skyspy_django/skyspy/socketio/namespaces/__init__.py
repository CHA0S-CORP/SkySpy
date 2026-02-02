"""
Socket.IO namespaces for SkysPy.

Namespaces provide logical separation for different types of
real-time events (aircraft, alerts, stats, etc.).
"""

from .audio import (
    AudioNamespace,
    audio_namespace,
    broadcast_transcription_completed,
    broadcast_transcription_failed,
    broadcast_transcription_started,
    broadcast_transmission,
    register_audio_namespace,
)
from .cannonball import (
    CannonballNamespace,
    broadcast_threat_update,
    cannonball_namespace,
    register_cannonball_namespace,
)
from .main import MainNamespace, main_namespace

__all__ = [
    # Main namespace (default '/')
    "MainNamespace",
    "main_namespace",
    # Audio namespace
    "AudioNamespace",
    "audio_namespace",
    "register_audio_namespace",
    "broadcast_transmission",
    "broadcast_transcription_started",
    "broadcast_transcription_completed",
    "broadcast_transcription_failed",
    # Cannonball namespace
    "CannonballNamespace",
    "cannonball_namespace",
    "register_cannonball_namespace",
    "broadcast_threat_update",
]


def register_all_namespaces():
    """Register all Socket.IO namespaces with the server.

    Note: MainNamespace is auto-registered on import.
    """
    register_audio_namespace()
    register_cannonball_namespace()
