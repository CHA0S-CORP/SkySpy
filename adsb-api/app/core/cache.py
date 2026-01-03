"""
Caching utilities with thread-safe in-memory cache.
"""
import asyncio
import hashlib
import logging
import time
import threading
from functools import wraps
from typing import Any, Optional, Dict, Tuple

from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

_cache: Dict[str, Tuple[Any, float]] = {}
_cache_lock = threading.Lock()

# Global upstream API rate limiter
_upstream_last_request: float = 0
_upstream_lock = threading.Lock()


async def check_upstream_rate_limit() -> bool:
    """
    Check if enough time has passed since the last upstream API call.
    Returns True if a request is allowed, False if rate limited.
    """
    global _upstream_last_request
    now = time.time()
    min_interval = settings.upstream_api_min_interval

    with _upstream_lock:
        elapsed = now - _upstream_last_request
        if elapsed < min_interval:
            logger.debug(f"Upstream rate limited: {min_interval - elapsed:.1f}s remaining")
            return False
        return True


async def mark_upstream_request():
    """Mark that an upstream API request was made."""
    global _upstream_last_request
    with _upstream_lock:
        _upstream_last_request = time.time()


async def wait_for_upstream_rate_limit() -> bool:
    """
    Wait until an upstream API call is allowed, then mark the request.
    Returns True when ready to proceed.
    """
    global _upstream_last_request
    min_interval = settings.upstream_api_min_interval

    with _upstream_lock:
        now = time.time()
        elapsed = now - _upstream_last_request
        wait_time = max(0, min_interval - elapsed)

    if wait_time > 0:
        logger.info(f"Upstream rate limit: waiting {wait_time:.1f}s before API call")
        await asyncio.sleep(wait_time)

    await mark_upstream_request()
    return True


def get_upstream_rate_limit_status() -> dict:
    """Get current upstream rate limit status for monitoring."""
    global _upstream_last_request
    now = time.time()
    min_interval = settings.upstream_api_min_interval

    with _upstream_lock:
        elapsed = now - _upstream_last_request
        time_remaining = max(0, min_interval - elapsed)

    return {
        "min_interval_seconds": min_interval,
        "last_request_ago_seconds": round(elapsed, 1),
        "time_until_allowed_seconds": round(time_remaining, 1),
        "is_allowed": time_remaining == 0
    }


def make_cache_key(func_name: str, args: tuple, kwargs: dict) -> str:
    """Create a reliable cache key using hashing."""
    try:
        key_parts = [func_name]
        for arg in args:
            key_parts.append(repr(arg))
        for k, v in sorted(kwargs.items()):
            key_parts.append(f"{k}={repr(v)}")
        key_str = ":".join(key_parts)
        return hashlib.md5(key_str.encode()).hexdigest()
    except Exception:
        return f"{func_name}:{time.time()}"


def cached(ttl_seconds: Optional[int] = None):
    """Decorator for caching function results."""
    if ttl_seconds is None:
        ttl_seconds = settings.cache_ttl
    
    def decorator(func):
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            cache_key = make_cache_key(func.__name__, args, kwargs)
            now = time.time()
            
            with _cache_lock:
                if cache_key in _cache:
                    data, timestamp = _cache[cache_key]
                    if now - timestamp < ttl_seconds:
                        return data
            
            result = await func(*args, **kwargs)
            
            with _cache_lock:
                _cache[cache_key] = (result, now)
            
            return result
        
        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            cache_key = make_cache_key(func.__name__, args, kwargs)
            now = time.time()
            
            with _cache_lock:
                if cache_key in _cache:
                    data, timestamp = _cache[cache_key]
                    if now - timestamp < ttl_seconds:
                        return data
            
            result = func(*args, **kwargs)
            
            with _cache_lock:
                _cache[cache_key] = (result, now)
            
            return result
        
        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return sync_wrapper
    
    return decorator


def clear_cache():
    """Clear all cached data."""
    with _cache_lock:
        _cache.clear()
