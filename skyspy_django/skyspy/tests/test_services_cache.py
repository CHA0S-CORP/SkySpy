"""
Tests for the caching utilities service.

Tests bounded cache, memory cache, rate limiting, decorators,
and cache cleanup functionality.
"""

import time
from unittest.mock import MagicMock, patch

import pytest
from django.test import TestCase, override_settings

from skyspy.services.cache import (
    BoundedCache,
    aircraft_info_cache,
    cache_delete,
    cache_get,
    cache_get_or_set,
    cache_set,
    cached_upstream_api,
    cached_with_ttl,
    check_rate_limit,
    cleanup_all_caches,
    cleanup_expired_memory_cache,
    cleanup_rate_limits,
    clear_memory_cache,
    clear_rate_limits,
    delete_from_memory_cache,
    generate_cache_key,
    get_cache_stats,
    get_from_memory_cache,
    get_rate_limit_remaining,
    photo_cache,
    rate_limited,
    reset_rate_limit,
    route_cache,
    set_in_memory_cache,
)


class GenerateCacheKeyTests(TestCase):
    """Tests for cache key generation."""

    def test_generate_key_consistent(self):
        """Test key generation is consistent."""
        key1 = generate_cache_key("arg1", "arg2", key="value")
        key2 = generate_cache_key("arg1", "arg2", key="value")

        self.assertEqual(key1, key2)

    def test_generate_key_different_args(self):
        """Test different args produce different keys."""
        key1 = generate_cache_key("arg1")
        key2 = generate_cache_key("arg2")

        self.assertNotEqual(key1, key2)

    def test_generate_key_different_kwargs(self):
        """Test different kwargs produce different keys."""
        key1 = generate_cache_key(key="value1")
        key2 = generate_cache_key(key="value2")

        self.assertNotEqual(key1, key2)

    def test_generate_key_order_independent_kwargs(self):
        """Test kwargs order doesn't affect key."""
        key1 = generate_cache_key(a="1", b="2")
        key2 = generate_cache_key(b="2", a="1")

        self.assertEqual(key1, key2)


class BoundedCacheTests(TestCase):
    """Tests for BoundedCache class."""

    def setUp(self):
        """Set up test fixtures."""
        self.cache = BoundedCache(maxsize=5, name="test")

    def tearDown(self):
        """Clean up."""
        self.cache.clear()

    def test_set_and_get(self):
        """Test basic set and get."""
        self.cache.set("key1", "value1", ttl=60)
        result = self.cache.get("key1")

        self.assertEqual(result, "value1")

    def test_get_missing_key(self):
        """Test get returns default for missing key."""
        result = self.cache.get("missing", default="default_value")

        self.assertEqual(result, "default_value")

    def test_get_expired_key(self):
        """Test get returns default for expired key."""
        self.cache.set("key1", "value1", ttl=0)  # Immediate expiry
        time.sleep(0.01)

        result = self.cache.get("key1", default="expired")

        self.assertEqual(result, "expired")

    def test_lru_eviction(self):
        """Test LRU eviction when cache is full."""
        # Fill cache beyond capacity
        for i in range(7):
            self.cache.set(f"key{i}", f"value{i}", ttl=60)

        # Oldest keys should be evicted
        self.assertEqual(len(self.cache), 5)
        self.assertIsNone(self.cache.get("key0"))
        self.assertIsNone(self.cache.get("key1"))
        self.assertIsNotNone(self.cache.get("key6"))

    def test_access_moves_to_end(self):
        """Test accessing key moves it to end (most recent)."""
        self.cache.set("key1", "value1", ttl=60)
        self.cache.set("key2", "value2", ttl=60)
        self.cache.set("key3", "value3", ttl=60)

        # Access key1 to make it most recent
        self.cache.get("key1")

        # Fill rest of cache
        self.cache.set("key4", "value4", ttl=60)
        self.cache.set("key5", "value5", ttl=60)
        self.cache.set("key6", "value6", ttl=60)  # This should evict key2

        # key1 should still exist (was accessed recently)
        self.assertIsNotNone(self.cache.get("key1"))
        # key2 should be evicted (oldest not accessed)
        self.assertIsNone(self.cache.get("key2"))

    def test_delete(self):
        """Test deleting a key."""
        self.cache.set("key1", "value1", ttl=60)
        self.cache.delete("key1")

        self.assertIsNone(self.cache.get("key1"))

    def test_clear(self):
        """Test clearing the cache."""
        self.cache.set("key1", "value1", ttl=60)
        self.cache.set("key2", "value2", ttl=60)
        self.cache.clear()

        self.assertEqual(len(self.cache), 0)

    def test_cleanup_expired(self):
        """Test cleanup of expired entries."""
        self.cache.set("key1", "value1", ttl=0)  # Expired
        self.cache.set("key2", "value2", ttl=60)  # Not expired
        time.sleep(0.01)

        removed = self.cache.cleanup_expired()

        self.assertEqual(removed, 1)
        self.assertEqual(len(self.cache), 1)

    def test_contains(self):
        """Test __contains__ method."""
        self.cache.set("key1", "value1", ttl=60)

        self.assertTrue("key1" in self.cache)
        self.assertFalse("missing" in self.cache)

    def test_get_stats(self):
        """Test getting cache statistics."""
        self.cache.set("key1", "value1", ttl=60)
        self.cache.get("key1")  # Hit
        self.cache.get("missing")  # Miss

        stats = self.cache.get_stats()

        self.assertEqual(stats["name"], "test")
        self.assertEqual(stats["size"], 1)
        self.assertEqual(stats["maxsize"], 5)
        self.assertEqual(stats["hits"], 1)
        self.assertEqual(stats["misses"], 1)
        self.assertEqual(stats["hit_rate_pct"], 50.0)


class MemoryCacheTests(TestCase):
    """Tests for in-memory cache functions."""

    def setUp(self):
        """Set up test fixtures."""
        clear_memory_cache()

    def tearDown(self):
        """Clean up."""
        clear_memory_cache()

    @override_settings(CACHE_TTL=60)
    def test_set_and_get(self):
        """Test basic set and get."""
        set_in_memory_cache("key1", "value1")
        found, value = get_from_memory_cache("key1")

        self.assertTrue(found)
        self.assertEqual(value, "value1")

    def test_get_missing(self):
        """Test get returns not found for missing key."""
        found, value = get_from_memory_cache("missing")

        self.assertFalse(found)
        self.assertIsNone(value)

    def test_get_expired(self):
        """Test get returns not found for expired key."""
        set_in_memory_cache("key1", "value1", ttl=0)
        time.sleep(0.01)

        found, value = get_from_memory_cache("key1")

        self.assertFalse(found)

    def test_delete(self):
        """Test deleting a key."""
        set_in_memory_cache("key1", "value1", ttl=60)
        delete_from_memory_cache("key1")

        found, value = get_from_memory_cache("key1")
        self.assertFalse(found)

    def test_cleanup_expired(self):
        """Test cleanup of expired entries."""
        set_in_memory_cache("key1", "value1", ttl=0)
        set_in_memory_cache("key2", "value2", ttl=60)
        time.sleep(0.01)

        cleanup_expired_memory_cache()

        found1, _ = get_from_memory_cache("key1")
        found2, _ = get_from_memory_cache("key2")

        self.assertFalse(found1)
        self.assertTrue(found2)


class RateLimitTests(TestCase):
    """Tests for rate limiting functions."""

    def setUp(self):
        """Set up test fixtures."""
        clear_rate_limits()

    def tearDown(self):
        """Clean up."""
        clear_rate_limits()

    @override_settings(UPSTREAM_API_MIN_INTERVAL=1)
    def test_check_rate_limit_allowed(self):
        """Test rate limit allows first call."""
        result = check_rate_limit("test_api")

        self.assertTrue(result)

    @override_settings(UPSTREAM_API_MIN_INTERVAL=60)
    def test_check_rate_limit_blocked(self):
        """Test rate limit blocks rapid calls."""
        check_rate_limit("test_api")
        result = check_rate_limit("test_api")

        self.assertFalse(result)

    def test_check_rate_limit_different_keys(self):
        """Test different keys have independent limits."""
        check_rate_limit("api1", min_interval=60)
        result = check_rate_limit("api2", min_interval=60)

        self.assertTrue(result)

    def test_get_rate_limit_remaining(self):
        """Test getting remaining time."""
        check_rate_limit("test_api", min_interval=60)
        remaining = get_rate_limit_remaining("test_api", min_interval=60)

        self.assertGreater(remaining, 0)
        self.assertLessEqual(remaining, 60)

    def test_get_rate_limit_remaining_no_limit(self):
        """Test remaining is 0 when not rate limited."""
        remaining = get_rate_limit_remaining("new_api", min_interval=60)

        self.assertEqual(remaining, 0)

    def test_reset_rate_limit(self):
        """Test resetting rate limit."""
        check_rate_limit("test_api", min_interval=60)
        reset_rate_limit("test_api")
        result = check_rate_limit("test_api", min_interval=60)

        self.assertTrue(result)

    def test_cleanup_rate_limits(self):
        """Test cleanup of old rate limit entries."""
        # This is hard to test without manipulating timestamps
        # Just verify it runs without error
        cleanup_rate_limits(max_age_seconds=0)


class CachedWithTtlDecoratorTests(TestCase):
    """Tests for cached_with_ttl decorator."""

    def setUp(self):
        """Set up test fixtures."""
        clear_memory_cache()

    def tearDown(self):
        """Clean up."""
        clear_memory_cache()

    def test_caches_result(self):
        """Test decorator caches function result."""
        call_count = {"count": 0}

        @cached_with_ttl(ttl=60)
        def expensive_function(arg):
            call_count["count"] += 1
            return f"result_{arg}"

        result1 = expensive_function("test")
        result2 = expensive_function("test")

        self.assertEqual(result1, "result_test")
        self.assertEqual(result2, "result_test")
        self.assertEqual(call_count["count"], 1)

    def test_different_args_different_cache(self):
        """Test different args produce different cache entries."""
        call_count = {"count": 0}

        @cached_with_ttl(ttl=60)
        def func(arg):
            call_count["count"] += 1
            return f"result_{arg}"

        func("a")
        func("b")

        self.assertEqual(call_count["count"], 2)


class RateLimitedDecoratorTests(TestCase):
    """Tests for rate_limited decorator."""

    def setUp(self):
        """Set up test fixtures."""
        clear_rate_limits()

    def tearDown(self):
        """Clean up."""
        clear_rate_limits()

    def test_allows_first_call(self):
        """Test decorator allows first call."""

        @rate_limited("test_api", min_interval=60)
        def api_call():
            return "success"

        result = api_call()

        self.assertEqual(result, "success")

    def test_blocks_rapid_calls(self):
        """Test decorator blocks rapid calls."""

        @rate_limited("test_api2", min_interval=60)
        def api_call():
            return "success"

        result1 = api_call()
        result2 = api_call()

        self.assertEqual(result1, "success")
        self.assertIsNone(result2)


class CachedUpstreamApiDecoratorTests(TestCase):
    """Tests for cached_upstream_api decorator."""

    def setUp(self):
        """Set up test fixtures."""
        clear_memory_cache()
        clear_rate_limits()

    def tearDown(self):
        """Clean up."""
        clear_memory_cache()
        clear_rate_limits()

    @override_settings(CACHE_TTL=60)
    def test_caches_and_rate_limits(self):
        """Test decorator applies both caching and rate limiting."""
        call_count = {"count": 0}

        @cached_upstream_api(cache_ttl=60, rate_limit_interval=60, key_prefix="test")
        def api_call(arg):
            call_count["count"] += 1
            return f"data_{arg}"

        # First call should execute and cache
        result1 = api_call("test")
        # Second call should use cache
        result2 = api_call("test")

        self.assertEqual(result1, "data_test")
        self.assertEqual(result2, "data_test")
        self.assertEqual(call_count["count"], 1)

    @override_settings(CACHE_TTL=60)
    def test_does_not_cache_none(self):
        """Test decorator doesn't cache None results."""
        call_count = {"count": 0}

        @cached_upstream_api(cache_ttl=60, key_prefix="test2")
        def api_call():
            call_count["count"] += 1
            return None

        api_call()
        api_call()

        self.assertEqual(call_count["count"], 2)


class DjangoCacheHelpersTests(TestCase):
    """Tests for Django cache helper functions."""

    @override_settings(CACHE_TTL=60)
    def test_cache_set_and_get(self):
        """Test cache_set and cache_get."""
        cache_set("test_key", "test_value")
        result = cache_get("test_key")

        self.assertEqual(result, "test_value")

    def test_cache_get_default(self):
        """Test cache_get returns default for missing key."""
        result = cache_get("missing_key", default="default")

        self.assertEqual(result, "default")

    @override_settings(CACHE_TTL=60)
    def test_cache_delete(self):
        """Test cache_delete."""
        cache_set("test_key", "test_value")
        cache_delete("test_key")
        result = cache_get("test_key")

        self.assertIsNone(result)

    @override_settings(CACHE_TTL=60)
    def test_cache_get_or_set(self):
        """Test cache_get_or_set."""
        call_count = {"count": 0}

        def compute():
            call_count["count"] += 1
            return "computed_value"

        result1 = cache_get_or_set("test_key_gor", compute)
        result2 = cache_get_or_set("test_key_gor", compute)

        self.assertEqual(result1, "computed_value")
        self.assertEqual(result2, "computed_value")
        self.assertEqual(call_count["count"], 1)


class CleanupAllCachesTests(TestCase):
    """Tests for cleanup_all_caches function."""

    def test_cleanup_runs_without_error(self):
        """Test cleanup_all_caches runs without error."""
        # This function coordinates cleanup across multiple caches
        # Just verify it runs without raising
        cleanup_all_caches()


class GetCacheStatsTests(TestCase):
    """Tests for get_cache_stats function."""

    def test_get_stats_structure(self):
        """Test stats have expected structure."""
        stats = get_cache_stats()

        # memory_cache is now a BoundedCache with its own stats
        self.assertIn("memory_cache", stats)
        self.assertIn("size", stats["memory_cache"])
        self.assertIn("maxsize", stats["memory_cache"])

        # rate_limiter is now a BoundedRateLimitCache with its own stats
        self.assertIn("rate_limiter", stats)
        self.assertIn("size", stats["rate_limiter"])
        self.assertIn("maxsize", stats["rate_limiter"])

        self.assertIn("bounded_caches", stats)
        self.assertIn("aircraft_info", stats["bounded_caches"])
        self.assertIn("routes", stats["bounded_caches"])
        self.assertIn("photos", stats["bounded_caches"])


class GlobalBoundedCachesTests(TestCase):
    """Tests for global bounded cache instances."""

    def test_aircraft_info_cache_exists(self):
        """Test aircraft_info_cache is configured."""
        stats = aircraft_info_cache.get_stats()

        self.assertEqual(stats["name"], "aircraft_info")
        self.assertEqual(stats["maxsize"], 5000)

    def test_route_cache_exists(self):
        """Test route_cache is configured."""
        stats = route_cache.get_stats()

        self.assertEqual(stats["name"], "routes")
        self.assertEqual(stats["maxsize"], 1000)

    def test_photo_cache_exists(self):
        """Test photo_cache is configured."""
        stats = photo_cache.get_stats()

        self.assertEqual(stats["name"], "photos")
        self.assertEqual(stats["maxsize"], 2000)
