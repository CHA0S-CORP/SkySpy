"""
Caching utilities with thread-safe in-memory cache.
"""
import asyncio
import hashlib
import time
import threading
from functools import wraps
from typing import Any, Optional, Dict, Tuple

from app.core.config import get_settings

settings = get_settings()

_cache: Dict[str, Tuple[Any, float]] = {}
_cache_lock = threading.Lock()


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
