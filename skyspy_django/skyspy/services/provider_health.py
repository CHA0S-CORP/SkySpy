"""Shared cooldowns for unavailable external providers."""

import logging
import time

from django.core.cache import cache

logger = logging.getLogger(__name__)


def cooldown_remaining(source: str) -> float:
    return max(0, (cache.get(f"provider:cooldown:{source}") or 0) - time.time())


def pause_provider(source: str, seconds: float, reason: str) -> None:
    seconds = max(1, seconds)
    if cache.add(f"provider:cooldown:{source}", time.time() + seconds, timeout=int(seconds) + 1):
        cache.set(f"provider:degraded:{source}", True, timeout=86400)
        logger.warning("%s unavailable (%s); retrying in %.0fs", source, reason, seconds)


def provider_recovered(source: str) -> None:
    if cache.get(f"provider:degraded:{source}"):
        cache.delete(f"provider:degraded:{source}")
        logger.info("%s recovered", source)
    cache.delete(f"provider:cooldown:{source}")
