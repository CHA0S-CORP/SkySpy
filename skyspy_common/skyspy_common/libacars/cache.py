"""
LRU decode cache for libacars binding.

Provides caching for decoded ACARS messages to improve performance
for retry logic, duplicate messages, and high-throughput scenarios.
"""

import hashlib
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Optional

from .exceptions import LibacarsError


@dataclass
class CacheEntry:
    """A single cache entry with metadata."""

    value: Any
    timestamp: float
    hits: int = 0
    size_bytes: int = 0

    def is_expired(self, ttl: float) -> bool:
        """Check if entry has expired."""
        return time.time() - self.timestamp > ttl


@dataclass
class CacheStats:
    """Statistics for cache operations."""

    hits: int = 0
    misses: int = 0
    evictions: int = 0
    expirations: int = 0
    current_size: int = 0
    max_size: int = 0

    @property
    def hit_rate(self) -> float:
        """Calculate cache hit rate as percentage."""
        total = self.hits + self.misses
        return (self.hits / total * 100) if total > 0 else 0.0

    def to_dict(self) -> dict:
        """Convert to dictionary for serialization."""
        return {
            "hits": self.hits,
            "misses": self.misses,
            "evictions": self.evictions,
            "expirations": self.expirations,
            "current_size": self.current_size,
            "max_size": self.max_size,
            "hit_rate": round(self.hit_rate, 2),
        }


class DecodeCache:
    """
    LRU cache for decoded ACARS messages.

    Features:
    - LRU eviction policy
    - TTL-based expiration
    - Thread-safe operations
    - Configurable size limits
    - Statistics tracking

    Usage:
        cache = DecodeCache(maxsize=1000, ttl=300)

        # Try cache first
        result = cache.get(label, text, direction)
        if result is None:
            result = decode_acars_apps(label, text, direction)
            cache.set(label, text, direction, result)
    """

    def __init__(
        self,
        maxsize: int = 1000,
        ttl: float = 300.0,
        enabled: bool = True,
    ):
        """
        Initialize the decode cache.

        Args:
            maxsize: Maximum number of entries to cache
            ttl: Time-to-live in seconds for cache entries
            enabled: Whether caching is enabled
        """
        self._maxsize = maxsize
        self._ttl = ttl
        self._enabled = enabled
        self._cache: OrderedDict[str, CacheEntry] = OrderedDict()
        self._lock = threading.Lock()
        self._stats = CacheStats(max_size=maxsize)

    @staticmethod
    def _make_key(label: str, text: str, direction: int) -> str:
        """
        Create a cache key from message components.

        Uses MD5 hash of text to keep keys short while maintaining uniqueness.
        """
        text_hash = hashlib.md5(text.encode("utf-8", errors="replace")).hexdigest()[:12]
        return f"{label}:{text_hash}:{direction}"

    @staticmethod
    def _estimate_size(value: Any) -> int:
        """Estimate memory size of cached value in bytes."""
        if value is None:
            return 0
        if isinstance(value, dict):
            # Rough estimate for dict
            import json

            try:
                return len(json.dumps(value))
            except (TypeError, ValueError):
                return 1000  # Default estimate
        if isinstance(value, str):
            return len(value)
        return 100  # Default estimate

    def get(
        self,
        label: str,
        text: str,
        direction: int,
    ) -> Optional[Any]:
        """
        Get a cached decode result.

        Args:
            label: ACARS message label
            text: Message text
            direction: Message direction (MsgDir value)

        Returns:
            Cached result or None if not found/expired
        """
        if not self._enabled:
            return None

        key = self._make_key(label, text, direction)

        with self._lock:
            entry = self._cache.get(key)

            if entry is None:
                self._stats.misses += 1
                return None

            # Check expiration
            if entry.is_expired(self._ttl):
                del self._cache[key]
                self._stats.expirations += 1
                self._stats.misses += 1
                self._stats.current_size = len(self._cache)
                return None

            # Move to end (most recently used)
            self._cache.move_to_end(key)
            entry.hits += 1
            self._stats.hits += 1
            return entry.value

    def set(
        self,
        label: str,
        text: str,
        direction: int,
        value: Any,
    ) -> None:
        """
        Cache a decode result.

        Args:
            label: ACARS message label
            text: Message text
            direction: Message direction (MsgDir value)
            value: Decoded result to cache
        """
        if not self._enabled:
            return

        # Don't cache None values or errors
        if value is None:
            return

        key = self._make_key(label, text, direction)
        size = self._estimate_size(value)

        with self._lock:
            # If key exists, update it
            if key in self._cache:
                self._cache[key] = CacheEntry(
                    value=value,
                    timestamp=time.time(),
                    size_bytes=size,
                )
                self._cache.move_to_end(key)
                return

            # Evict oldest entries if at capacity
            while len(self._cache) >= self._maxsize:
                oldest_key = next(iter(self._cache))
                del self._cache[oldest_key]
                self._stats.evictions += 1

            # Add new entry
            self._cache[key] = CacheEntry(
                value=value,
                timestamp=time.time(),
                size_bytes=size,
            )
            self._stats.current_size = len(self._cache)

    def invalidate(self, label: str, text: str, direction: int) -> bool:
        """
        Invalidate a specific cache entry.

        Returns:
            True if entry was found and removed, False otherwise
        """
        key = self._make_key(label, text, direction)

        with self._lock:
            if key in self._cache:
                del self._cache[key]
                self._stats.current_size = len(self._cache)
                return True
            return False

    def clear(self) -> int:
        """
        Clear all cache entries.

        Returns:
            Number of entries cleared
        """
        with self._lock:
            count = len(self._cache)
            self._cache.clear()
            self._stats.current_size = 0
            return count

    def cleanup_expired(self) -> int:
        """
        Remove all expired entries.

        Returns:
            Number of entries removed
        """
        with self._lock:
            expired_keys = [
                key
                for key, entry in self._cache.items()
                if entry.is_expired(self._ttl)
            ]

            for key in expired_keys:
                del self._cache[key]
                self._stats.expirations += 1

            self._stats.current_size = len(self._cache)
            return len(expired_keys)

    def get_stats(self) -> dict:
        """Get cache statistics."""
        with self._lock:
            self._stats.current_size = len(self._cache)
            return self._stats.to_dict()

    def reset_stats(self) -> None:
        """Reset cache statistics (but keep cached entries)."""
        with self._lock:
            self._stats = CacheStats(
                max_size=self._maxsize,
                current_size=len(self._cache),
            )

    @property
    def enabled(self) -> bool:
        """Check if cache is enabled."""
        return self._enabled

    @enabled.setter
    def enabled(self, value: bool) -> None:
        """Enable or disable the cache."""
        self._enabled = value

    @property
    def size(self) -> int:
        """Get current number of cached entries."""
        with self._lock:
            return len(self._cache)

    def __len__(self) -> int:
        """Return number of cached entries."""
        return self.size

    def __contains__(self, key: tuple) -> bool:
        """Check if a message is cached (label, text, direction)."""
        if len(key) != 3:
            return False
        label, text, direction = key
        cache_key = self._make_key(label, text, direction)
        with self._lock:
            return cache_key in self._cache


class LabelFormatCache:
    """
    Cache for label → supported format mapping.

    Tracks which labels are supported by libacars to avoid
    unnecessary decode attempts on unsupported labels.
    """

    def __init__(self, maxsize: int = 200):
        """
        Initialize the label format cache.

        Args:
            maxsize: Maximum number of labels to track
        """
        self._maxsize = maxsize
        self._supported: OrderedDict[str, str] = OrderedDict()  # label -> format name
        self._unsupported: set[str] = set()
        self._lock = threading.Lock()
        self._stats = {
            "supported_hits": 0,
            "unsupported_hits": 0,
            "unknown": 0,
        }

    def is_supported(self, label: str) -> Optional[bool]:
        """
        Check if a label is known to be supported or unsupported.

        Returns:
            True if supported, False if unsupported, None if unknown
        """
        with self._lock:
            if label in self._supported:
                self._supported.move_to_end(label)
                self._stats["supported_hits"] += 1
                return True
            if label in self._unsupported:
                self._stats["unsupported_hits"] += 1
                return False
            self._stats["unknown"] += 1
            return None

    def mark_supported(self, label: str, format_name: str = "unknown") -> None:
        """Mark a label as supported by libacars."""
        with self._lock:
            # Remove from unsupported if present
            self._unsupported.discard(label)

            # Add to supported
            if label in self._supported:
                self._supported.move_to_end(label)
            else:
                # Evict oldest if at capacity
                while len(self._supported) >= self._maxsize:
                    self._supported.popitem(last=False)
                self._supported[label] = format_name

    def mark_unsupported(self, label: str) -> None:
        """Mark a label as unsupported by libacars."""
        with self._lock:
            # Remove from supported if present
            if label in self._supported:
                del self._supported[label]

            # Add to unsupported (limited size)
            if len(self._unsupported) < self._maxsize:
                self._unsupported.add(label)

    def get_format(self, label: str) -> Optional[str]:
        """Get the format name for a supported label."""
        with self._lock:
            return self._supported.get(label)

    def get_stats(self) -> dict:
        """Get cache statistics."""
        with self._lock:
            return {
                **self._stats,
                "supported_count": len(self._supported),
                "unsupported_count": len(self._unsupported),
            }

    def clear(self) -> None:
        """Clear all cached data."""
        with self._lock:
            self._supported.clear()
            self._unsupported.clear()
            self._stats = {
                "supported_hits": 0,
                "unsupported_hits": 0,
                "unknown": 0,
            }


# Global cache instances (can be replaced/configured)
_decode_cache: Optional[DecodeCache] = None
_label_cache: Optional[LabelFormatCache] = None


def get_decode_cache(
    maxsize: int = 1000,
    ttl: float = 300.0,
) -> DecodeCache:
    """
    Get or create the global decode cache instance.

    Args:
        maxsize: Maximum cache size (only used on first call)
        ttl: Time-to-live in seconds (only used on first call)

    Returns:
        The global DecodeCache instance
    """
    global _decode_cache
    if _decode_cache is None:
        _decode_cache = DecodeCache(maxsize=maxsize, ttl=ttl)
    return _decode_cache


def get_label_cache(maxsize: int = 200) -> LabelFormatCache:
    """
    Get or create the global label format cache instance.

    Args:
        maxsize: Maximum cache size (only used on first call)

    Returns:
        The global LabelFormatCache instance
    """
    global _label_cache
    if _label_cache is None:
        _label_cache = LabelFormatCache(maxsize=maxsize)
    return _label_cache


def reset_caches() -> None:
    """Reset all global cache instances."""
    global _decode_cache, _label_cache
    _decode_cache = None
    _label_cache = None
