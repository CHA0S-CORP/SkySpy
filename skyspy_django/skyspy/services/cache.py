"""
Caching utilities with TTL and rate limiting support.

Provides:
- In-memory cache with TTL
- Memory-bounded caches with LRU eviction (RPi optimization)
- Rate limiting for upstream API calls
- MD5-based cache key generation
"""
import hashlib
import logging
import threading
import time
from collections import OrderedDict
from typing import Any, Callable, Optional

from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)


# =============================================================================
# Bounded Cache (RPi Optimization)
# =============================================================================

class BoundedCache:
    """
    Memory-bounded cache with LRU eviction and TTL support.

    Designed for RPi deployment where memory is limited.
    When the cache reaches maxsize, the oldest entries are evicted.

    Usage:
        cache = BoundedCache(maxsize=1000)
        cache.set('key', value, ttl=60)
        value = cache.get('key')
    """

    def __init__(self, maxsize: int = 1000, name: str = 'bounded'):
        """
        Initialize bounded cache.

        Args:
            maxsize: Maximum number of entries (default 1000)
            name: Cache name for logging
        """
        self._cache: OrderedDict = OrderedDict()
        self._maxsize = maxsize
        self._name = name
        self._lock = threading.RLock()
        self._hits = 0
        self._misses = 0

    def get(self, key: str, default: Any = None) -> Any:
        """Get value from cache, returning default if not found or expired."""
        with self._lock:
            if key not in self._cache:
                self._misses += 1
                return default

            value, expires_at = self._cache[key]
            if time.time() >= expires_at:
                # Expired, remove and return default
                del self._cache[key]
                self._misses += 1
                return default

            # Move to end (most recently used)
            self._cache.move_to_end(key)
            self._hits += 1
            return value

    def set(self, key: str, value: Any, ttl: int = None):
        """
        Set value in cache with optional TTL.

        Args:
            key: Cache key
            value: Value to store
            ttl: Time to live in seconds (default from settings)
        """
        if ttl is None:
            ttl = getattr(settings, 'CACHE_TTL', 300)

        expires_at = time.time() + ttl

        with self._lock:
            # Remove if exists (to update position)
            if key in self._cache:
                del self._cache[key]

            # Evict oldest if at capacity
            while len(self._cache) >= self._maxsize:
                self._cache.popitem(last=False)

            self._cache[key] = (value, expires_at)

    def delete(self, key: str):
        """Delete a key from the cache."""
        with self._lock:
            self._cache.pop(key, None)

    def clear(self):
        """Clear all entries from the cache."""
        with self._lock:
            self._cache.clear()
            self._hits = 0
            self._misses = 0

    def cleanup_expired(self):
        """Remove all expired entries."""
        now = time.time()
        with self._lock:
            expired_keys = [
                key for key, (_, expires_at) in self._cache.items()
                if now >= expires_at
            ]
            for key in expired_keys:
                del self._cache[key]
        return len(expired_keys)

    def __len__(self):
        """Return number of entries in cache."""
        return len(self._cache)

    def __contains__(self, key: str):
        """Check if key exists and is not expired."""
        with self._lock:
            if key not in self._cache:
                return False
            _, expires_at = self._cache[key]
            return time.time() < expires_at

    def get_stats(self) -> dict:
        """Get cache statistics."""
        with self._lock:
            total_requests = self._hits + self._misses
            hit_rate = (self._hits / total_requests * 100) if total_requests > 0 else 0
            return {
                'name': self._name,
                'size': len(self._cache),
                'maxsize': self._maxsize,
                'hits': self._hits,
                'misses': self._misses,
                'hit_rate_pct': round(hit_rate, 1),
            }


# Global bounded caches for common use cases
aircraft_info_cache = BoundedCache(maxsize=5000, name='aircraft_info')
route_cache = BoundedCache(maxsize=1000, name='routes')
photo_cache = BoundedCache(maxsize=2000, name='photos')

# In-memory cache for fast access (thread-safe)
_memory_cache: dict[str, tuple[Any, float]] = {}
_memory_cache_lock = threading.RLock()

# Rate limiting timestamps for upstream API calls
_rate_limit_timestamps: dict[str, float] = {}
_rate_limit_lock = threading.Lock()


def generate_cache_key(*args, **kwargs) -> str:
    """Generate MD5-based cache key from arguments."""
    key_data = str(args) + str(sorted(kwargs.items()))
    return hashlib.md5(key_data.encode()).hexdigest()


def get_from_memory_cache(key: str) -> tuple[bool, Any]:
    """
    Get value from in-memory cache.

    Returns:
        Tuple of (found, value). If found is False, value is None.
    """
    with _memory_cache_lock:
        if key in _memory_cache:
            value, expires_at = _memory_cache[key]
            if time.time() < expires_at:
                return True, value
            else:
                # Expired, remove it
                del _memory_cache[key]
        return False, None


def set_in_memory_cache(key: str, value: Any, ttl: int = None):
    """
    Set value in in-memory cache.

    Args:
        key: Cache key
        value: Value to store
        ttl: Time to live in seconds (default from settings)
    """
    if ttl is None:
        ttl = settings.CACHE_TTL

    expires_at = time.time() + ttl

    with _memory_cache_lock:
        _memory_cache[key] = (value, expires_at)


def delete_from_memory_cache(key: str):
    """Delete value from in-memory cache."""
    with _memory_cache_lock:
        _memory_cache.pop(key, None)


def clear_memory_cache():
    """Clear all entries from in-memory cache."""
    with _memory_cache_lock:
        _memory_cache.clear()


def cleanup_expired_memory_cache():
    """Remove expired entries from in-memory cache."""
    now = time.time()
    with _memory_cache_lock:
        expired_keys = [
            key for key, (_, expires_at) in _memory_cache.items()
            if now >= expires_at
        ]
        for key in expired_keys:
            del _memory_cache[key]


def check_rate_limit(key: str, min_interval: int = None) -> bool:
    """
    Check if an upstream API call is allowed based on rate limiting.

    Args:
        key: Unique identifier for the API/endpoint
        min_interval: Minimum seconds between calls (default from settings)

    Returns:
        True if the call is allowed, False if rate limited
    """
    if min_interval is None:
        min_interval = settings.UPSTREAM_API_MIN_INTERVAL

    now = time.time()

    with _rate_limit_lock:
        last_call = _rate_limit_timestamps.get(key, 0)
        if now - last_call < min_interval:
            return False
        _rate_limit_timestamps[key] = now
        return True


def get_rate_limit_remaining(key: str, min_interval: int = None) -> float:
    """
    Get remaining seconds until rate limit allows next call.

    Args:
        key: Unique identifier for the API/endpoint
        min_interval: Minimum seconds between calls

    Returns:
        Seconds remaining (0 if allowed now)
    """
    if min_interval is None:
        min_interval = settings.UPSTREAM_API_MIN_INTERVAL

    now = time.time()

    with _rate_limit_lock:
        last_call = _rate_limit_timestamps.get(key, 0)
        remaining = min_interval - (now - last_call)
        return max(0, remaining)


def reset_rate_limit(key: str):
    """Reset rate limit for a specific key."""
    with _rate_limit_lock:
        _rate_limit_timestamps.pop(key, None)


def clear_rate_limits():
    """Clear all rate limit timestamps."""
    with _rate_limit_lock:
        _rate_limit_timestamps.clear()


def cached_with_ttl(ttl: int = None, use_memory: bool = True):
    """
    Decorator for caching function results with TTL.

    Args:
        ttl: Time to live in seconds
        use_memory: Use in-memory cache (faster) vs Django cache

    Usage:
        @cached_with_ttl(ttl=60)
        def get_aircraft_info(icao_hex):
            # expensive operation
            return info
    """
    # Sentinel to distinguish "not found" from "stored None"
    _NOT_FOUND = object()

    def decorator(func: Callable):
        def wrapper(*args, **kwargs):
            cache_key = f"{func.__name__}:{generate_cache_key(*args, **kwargs)}"

            if use_memory:
                found, value = get_from_memory_cache(cache_key)
                if found:
                    return value
            else:
                # Use sentinel to distinguish missing key from stored None
                value = cache.get(cache_key, _NOT_FOUND)
                if value is not _NOT_FOUND:
                    return value

            result = func(*args, **kwargs)

            if use_memory:
                set_in_memory_cache(cache_key, result, ttl)
            else:
                cache.set(cache_key, result, timeout=ttl or settings.CACHE_TTL)

            return result

        return wrapper
    return decorator


def rate_limited(key_prefix: str, min_interval: int = None):
    """
    Decorator for rate limiting function calls.

    Args:
        key_prefix: Prefix for rate limit key
        min_interval: Minimum seconds between calls

    Usage:
        @rate_limited("planespotters_api", min_interval=60)
        def fetch_aircraft_photo(icao_hex):
            # API call
            return photo
    """
    def decorator(func: Callable):
        def wrapper(*args, **kwargs):
            # Generate unique key for this call
            rate_key = f"{key_prefix}:{generate_cache_key(*args, **kwargs)}"

            if not check_rate_limit(rate_key, min_interval):
                remaining = get_rate_limit_remaining(rate_key, min_interval)
                logger.debug(f"Rate limited: {rate_key}, retry in {remaining:.1f}s")
                return None

            return func(*args, **kwargs)

        return wrapper
    return decorator


def cached_upstream_api(
    cache_ttl: int = None,
    rate_limit_interval: int = None,
    key_prefix: str = "upstream"
):
    """
    Combined decorator for caching and rate limiting upstream API calls.

    Args:
        cache_ttl: Cache time to live in seconds
        rate_limit_interval: Minimum seconds between API calls
        key_prefix: Prefix for cache and rate limit keys

    Usage:
        @cached_upstream_api(cache_ttl=300, rate_limit_interval=60)
        def fetch_aircraft_data(icao_hex):
            # API call
            return data
    """
    def decorator(func: Callable):
        def wrapper(*args, **kwargs):
            cache_key = f"{key_prefix}:{func.__name__}:{generate_cache_key(*args, **kwargs)}"
            rate_key = f"rate:{key_prefix}:{func.__name__}"

            # Check cache first
            found, value = get_from_memory_cache(cache_key)
            if found:
                return value

            # Check rate limit
            if rate_limit_interval and not check_rate_limit(rate_key, rate_limit_interval):
                logger.debug(f"Upstream API rate limited: {rate_key}")
                return None

            # Make the API call
            result = func(*args, **kwargs)

            # Cache the result if not None
            if result is not None:
                set_in_memory_cache(cache_key, result, cache_ttl or settings.CACHE_TTL)

            return result

        return wrapper
    return decorator


# Django cache helpers with default TTLs

def cache_set(key: str, value: Any, timeout: int = None):
    """Set value in Django cache with default timeout."""
    cache.set(key, value, timeout=timeout or settings.CACHE_TTL)


def cache_get(key: str, default: Any = None) -> Any:
    """Get value from Django cache."""
    return cache.get(key, default)


def cache_delete(key: str):
    """Delete value from Django cache."""
    cache.delete(key)


def cache_get_or_set(key: str, default_func: Callable, timeout: int = None) -> Any:
    """Get from cache or compute and set if not found."""
    value = cache.get(key)
    if value is None:
        value = default_func()
        cache.set(key, value, timeout=timeout or settings.CACHE_TTL)
    return value


def cleanup_rate_limits(max_age_seconds: int = 7200):
    """
    Clean up old rate limit entries to prevent memory growth.

    Args:
        max_age_seconds: Maximum age of rate limit entries (default 2 hours)
    """
    now = time.time()
    cutoff = now - max_age_seconds

    with _rate_limit_lock:
        stale_keys = [k for k, v in _rate_limit_timestamps.items() if v < cutoff]
        for k in stale_keys:
            del _rate_limit_timestamps[k]

    if stale_keys:
        logger.debug(f"Cleaned up {len(stale_keys)} rate limit entries")


def cleanup_all_caches():
    """
    Clean up all in-memory caches.

    Should be called periodically to prevent unbounded memory growth.
    Cleans:
    - Expired memory cache entries
    - Old rate limit timestamps
    - Notification cooldowns
    - Bounded caches (expired entries)
    """
    # Clean expired memory cache
    cleanup_expired_memory_cache()

    # Clean old rate limits
    cleanup_rate_limits()

    # Clean notification cooldowns
    try:
        from skyspy.services.notifications import cleanup_cooldowns
        cleanup_cooldowns()
    except ImportError:
        # notifications module not available
        pass
    except Exception as e:
        logger.debug(f"Could not cleanup notification cooldowns: {e}")

    # Clean expired entries from bounded caches
    try:
        expired_aircraft = aircraft_info_cache.cleanup_expired()
        expired_routes = route_cache.cleanup_expired()
        expired_photos = photo_cache.cleanup_expired()
        if expired_aircraft + expired_routes + expired_photos > 0:
            logger.debug(
                f"Bounded cache cleanup: aircraft_info={expired_aircraft}, "
                f"routes={expired_routes}, photos={expired_photos}"
            )
    except Exception as e:
        logger.debug(f"Could not cleanup bounded caches: {e}")

    logger.debug("Completed comprehensive cache cleanup")


def get_cache_stats() -> dict:
    """Get statistics about in-memory caches."""
    with _memory_cache_lock:
        memory_cache_size = len(_memory_cache)

    with _rate_limit_lock:
        rate_limit_size = len(_rate_limit_timestamps)

    return {
        'memory_cache_entries': memory_cache_size,
        'rate_limit_entries': rate_limit_size,
        'bounded_caches': {
            'aircraft_info': aircraft_info_cache.get_stats(),
            'routes': route_cache.get_stats(),
            'photos': photo_cache.get_stats(),
        }
    }
