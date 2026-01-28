"""
Object pooling for libacars binding.

Provides resource pooling to reduce allocation overhead:
- vstring object pool
- Input buffer pool
- Thread-local buffer reuse
"""

import ctypes
import logging
import threading
import time
from collections import deque
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Callable, Generator, Generic, Optional, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")


@dataclass
class PoolStats:
    """Statistics for pool operations."""

    total_acquires: int = 0
    total_releases: int = 0
    pool_hits: int = 0  # Acquired from pool
    pool_misses: int = 0  # Created new
    current_pool_size: int = 0
    max_pool_size: int = 0
    total_created: int = 0
    total_destroyed: int = 0

    @property
    def hit_rate(self) -> float:
        """Calculate pool hit rate as percentage."""
        total = self.pool_hits + self.pool_misses
        return (self.pool_hits / total * 100) if total > 0 else 0.0

    def to_dict(self) -> dict:
        """Convert to dictionary for serialization."""
        return {
            "total_acquires": self.total_acquires,
            "total_releases": self.total_releases,
            "pool_hits": self.pool_hits,
            "pool_misses": self.pool_misses,
            "current_pool_size": self.current_pool_size,
            "max_pool_size": self.max_pool_size,
            "total_created": self.total_created,
            "total_destroyed": self.total_destroyed,
            "hit_rate": round(self.hit_rate, 2),
        }


class ObjectPool(Generic[T]):
    """
    Generic thread-safe object pool.

    Reduces allocation overhead by reusing objects.
    Objects are acquired from the pool and released back after use.

    Usage:
        pool = ObjectPool(
            factory=lambda: create_object(),
            reset=lambda obj: obj.clear(),
            max_size=10
        )

        obj = pool.acquire()
        try:
            # Use object
            pass
        finally:
            pool.release(obj)

        # Or use context manager:
        with pool.acquire_context() as obj:
            # Use object
            pass
    """

    def __init__(
        self,
        factory: Callable[[], T],
        reset: Optional[Callable[[T], None]] = None,
        destroy: Optional[Callable[[T], None]] = None,
        max_size: int = 10,
        min_size: int = 0,
        name: str = "ObjectPool",
    ):
        """
        Initialize the object pool.

        Args:
            factory: Function to create new objects
            reset: Function to reset an object for reuse (optional)
            destroy: Function to destroy an object (optional)
            max_size: Maximum pool size
            min_size: Minimum pool size (pre-allocated)
            name: Pool name for logging
        """
        self._factory = factory
        self._reset = reset
        self._destroy = destroy
        self._max_size = max_size
        self._min_size = min_size
        self._name = name

        self._pool: deque[T] = deque()
        self._lock = threading.Lock()
        self._stats = PoolStats(max_pool_size=max_size)

        # Pre-allocate minimum objects
        for _ in range(min_size):
            try:
                obj = self._factory()
                self._pool.append(obj)
                self._stats.total_created += 1
            except Exception as e:
                logger.warning(
                    "pool_preallocate_failed",
                    extra={"pool": name, "error": str(e)},
                )
                break

        self._stats.current_pool_size = len(self._pool)

    def acquire(self) -> T:
        """
        Acquire an object from the pool.

        Returns a pooled object if available, otherwise creates a new one.

        Returns:
            An object of type T
        """
        with self._lock:
            self._stats.total_acquires += 1

            if self._pool:
                obj = self._pool.popleft()
                self._stats.pool_hits += 1
                self._stats.current_pool_size = len(self._pool)
                return obj

            self._stats.pool_misses += 1

        # Create new object outside lock
        obj = self._factory()
        with self._lock:
            self._stats.total_created += 1
        return obj

    def release(self, obj: T) -> None:
        """
        Release an object back to the pool.

        If the pool is full, the object is destroyed.

        Args:
            obj: Object to release
        """
        if obj is None:
            return

        # Reset object if reset function provided
        if self._reset:
            try:
                self._reset(obj)
            except Exception as e:
                logger.debug(
                    "pool_reset_failed",
                    extra={"pool": self._name, "error": str(e)},
                )
                # Destroy object if reset fails
                if self._destroy:
                    try:
                        self._destroy(obj)
                    except Exception:
                        pass
                with self._lock:
                    self._stats.total_destroyed += 1
                return

        with self._lock:
            self._stats.total_releases += 1

            if len(self._pool) < self._max_size:
                self._pool.append(obj)
                self._stats.current_pool_size = len(self._pool)
                return

        # Pool is full, destroy the object
        if self._destroy:
            try:
                self._destroy(obj)
            except Exception as e:
                logger.debug(
                    "pool_destroy_failed",
                    extra={"pool": self._name, "error": str(e)},
                )

        with self._lock:
            self._stats.total_destroyed += 1

    @contextmanager
    def acquire_context(self) -> Generator[T, None, None]:
        """
        Context manager for acquiring and releasing objects.

        Ensures object is released back to pool even if exception occurs.

        Usage:
            with pool.acquire_context() as obj:
                # Use object
                pass
        """
        obj = self.acquire()
        try:
            yield obj
        finally:
            self.release(obj)

    def clear(self) -> int:
        """
        Clear all objects from the pool.

        Returns:
            Number of objects cleared
        """
        with self._lock:
            count = len(self._pool)

            while self._pool:
                obj = self._pool.popleft()
                if self._destroy:
                    try:
                        self._destroy(obj)
                    except Exception:
                        pass
                self._stats.total_destroyed += 1

            self._stats.current_pool_size = 0
            return count

    def get_stats(self) -> dict:
        """Get pool statistics."""
        with self._lock:
            self._stats.current_pool_size = len(self._pool)
            return self._stats.to_dict()

    @property
    def size(self) -> int:
        """Get current pool size."""
        with self._lock:
            return len(self._pool)

    def __len__(self) -> int:
        """Return current pool size."""
        return self.size


class ThreadLocalPool(Generic[T]):
    """
    Thread-local object pool.

    Each thread gets its own object that is reused across calls.
    Useful for objects that are expensive to create but safe to reuse
    within a single thread.

    Usage:
        pool = ThreadLocalPool(factory=lambda: create_buffer())
        buffer = pool.get()  # Always returns same object for this thread
    """

    def __init__(
        self,
        factory: Callable[[], T],
        reset: Optional[Callable[[T], None]] = None,
        name: str = "ThreadLocalPool",
    ):
        """
        Initialize the thread-local pool.

        Args:
            factory: Function to create new objects
            reset: Function to reset object between uses
            name: Pool name for logging
        """
        self._factory = factory
        self._reset = reset
        self._name = name
        self._local = threading.local()
        self._stats_lock = threading.Lock()
        self._stats = PoolStats()

    def get(self) -> T:
        """
        Get the thread-local object.

        Creates one if it doesn't exist for this thread.

        Returns:
            The thread-local object
        """
        if not hasattr(self._local, "obj"):
            self._local.obj = self._factory()
            with self._stats_lock:
                self._stats.total_created += 1
                self._stats.pool_misses += 1
        else:
            with self._stats_lock:
                self._stats.pool_hits += 1

        with self._stats_lock:
            self._stats.total_acquires += 1

        obj = self._local.obj

        # Reset if function provided
        if self._reset:
            try:
                self._reset(obj)
            except Exception as e:
                logger.debug(
                    "thread_local_reset_failed",
                    extra={"pool": self._name, "error": str(e)},
                )
                # Recreate on reset failure
                self._local.obj = self._factory()
                with self._stats_lock:
                    self._stats.total_created += 1
                return self._local.obj

        return obj

    @contextmanager
    def get_context(self) -> Generator[T, None, None]:
        """Context manager for getting thread-local object."""
        yield self.get()

    def get_stats(self) -> dict:
        """Get pool statistics."""
        with self._stats_lock:
            return self._stats.to_dict()


class BufferPool:
    """
    Pool of byte buffers for efficient string encoding.

    Pre-allocates buffers of common sizes to reduce allocation overhead
    when encoding strings for C library calls.

    Usage:
        pool = BufferPool()
        buffer = pool.get_buffer(1024)
        # Use buffer
        pool.release_buffer(buffer)
    """

    # Common buffer sizes (powers of 2)
    SIZES = [64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384]

    def __init__(self, buffers_per_size: int = 4):
        """
        Initialize the buffer pool.

        Args:
            buffers_per_size: Number of buffers to pre-allocate per size
        """
        self._pools: dict[int, deque[ctypes.Array]] = {}
        self._lock = threading.Lock()
        self._stats = PoolStats()

        # Initialize pools for each size
        for size in self.SIZES:
            self._pools[size] = deque()
            # Pre-allocate some buffers
            for _ in range(min(buffers_per_size, 2)):
                try:
                    buffer = ctypes.create_string_buffer(size)
                    self._pools[size].append(buffer)
                    self._stats.total_created += 1
                except Exception:
                    break

    def _get_pool_size(self, requested_size: int) -> int:
        """Get the appropriate pool size for requested size."""
        for size in self.SIZES:
            if size >= requested_size:
                return size
        # Return largest size if requested is bigger
        return self.SIZES[-1]

    def get_buffer(self, size: int) -> ctypes.Array:
        """
        Get a buffer of at least the requested size.

        Args:
            size: Minimum buffer size needed

        Returns:
            A ctypes string buffer
        """
        pool_size = self._get_pool_size(size)

        with self._lock:
            self._stats.total_acquires += 1
            pool = self._pools.get(pool_size)

            if pool and pool:
                self._stats.pool_hits += 1
                return pool.popleft()

            self._stats.pool_misses += 1

        # Create new buffer
        buffer = ctypes.create_string_buffer(pool_size)
        with self._lock:
            self._stats.total_created += 1
        return buffer

    def release_buffer(self, buffer: ctypes.Array) -> None:
        """
        Release a buffer back to the pool.

        Args:
            buffer: Buffer to release
        """
        if buffer is None:
            return

        size = ctypes.sizeof(buffer)
        pool_size = self._get_pool_size(size)

        with self._lock:
            self._stats.total_releases += 1
            pool = self._pools.get(pool_size)

            if pool is not None and len(pool) < 8:  # Max 8 per size
                # Clear buffer before returning to pool
                ctypes.memset(buffer, 0, size)
                pool.append(buffer)
            else:
                self._stats.total_destroyed += 1

    @contextmanager
    def buffer_context(self, size: int) -> Generator[ctypes.Array, None, None]:
        """Context manager for buffer acquisition."""
        buffer = self.get_buffer(size)
        try:
            yield buffer
        finally:
            self.release_buffer(buffer)

    def get_stats(self) -> dict:
        """Get pool statistics."""
        with self._lock:
            stats = self._stats.to_dict()
            stats["pool_sizes"] = {
                str(size): len(pool) for size, pool in self._pools.items()
            }
            return stats

    def clear(self) -> None:
        """Clear all buffers from pools."""
        with self._lock:
            for pool in self._pools.values():
                self._stats.total_destroyed += len(pool)
                pool.clear()


# Global pool instances
_vstring_pool: Optional[ObjectPool] = None
_buffer_pool: Optional[BufferPool] = None


def get_buffer_pool() -> BufferPool:
    """Get or create the global buffer pool."""
    global _buffer_pool
    if _buffer_pool is None:
        _buffer_pool = BufferPool()
    return _buffer_pool


def reset_pools() -> None:
    """Reset all global pool instances."""
    global _vstring_pool, _buffer_pool

    if _vstring_pool is not None:
        _vstring_pool.clear()
        _vstring_pool = None

    if _buffer_pool is not None:
        _buffer_pool.clear()
        _buffer_pool = None
