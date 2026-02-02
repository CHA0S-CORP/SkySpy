"""
Django signals for cache invalidation.

These signals automatically invalidate relevant caches when models change,
ensuring data consistency without manual cache management.
"""

import logging

from django.core.cache import cache
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

logger = logging.getLogger(__name__)


def _connect_signals():
    """Connect all signals. Called from settings after models are loaded."""
    from skyspy.models import AircraftSession, AlertRule

    # Alert-related cache invalidation
    @receiver([post_save, post_delete], sender=AlertRule)
    def invalidate_alert_cache(sender, instance, **kwargs):
        """Invalidate alert-related caches when rules change."""
        cache.delete("alert_rules_active")
        cache.delete("alert_rules_count")
        logger.debug(f"Invalidated alert cache for rule {instance.id}")

    # Session stats cache invalidation
    @receiver(post_save, sender=AircraftSession)
    def invalidate_session_stats_cache(sender, instance, created, **kwargs):
        """Invalidate stats cache when new sessions are created."""
        if created:
            # Only invalidate on new sessions, not updates
            cache.delete("stats:aircraft")
            cache.delete("stats:history")
            logger.debug(f"Invalidated stats cache for new session {instance.icao_hex}")


# Flag to prevent double connection
_signals_connected = False


def connect_cache_signals():
    """
    Connect cache invalidation signals.

    Should be called once during app initialization.
    Safe to call multiple times (idempotent).
    """
    global _signals_connected
    if _signals_connected:
        return

    try:
        _connect_signals()
        _signals_connected = True
        logger.info("Cache invalidation signals connected")
    except Exception as e:
        logger.warning(f"Failed to connect cache signals: {e}")
