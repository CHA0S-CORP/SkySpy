import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAircraftInfoCache } from './useAircraftInfoCache';

describe('useAircraftInfoCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('basic cache operations', () => {
    it('should start with empty cache', () => {
      const { result } = renderHook(() => useAircraftInfoCache());
      expect(result.current.cacheSize).toBe(0);
      expect(result.current.allCached).toEqual({});
    });

    it('should set and get cache entries', () => {
      const { result } = renderHook(() => useAircraftInfoCache());

      act(() => {
        result.current.setCacheEntry('ABC123', { icao_hex: 'ABC123', registration: 'N12345' });
      });

      expect(result.current.cacheSize).toBe(1);
      expect(result.current.getCached('ABC123')).toEqual({
        icao_hex: 'ABC123',
        registration: 'N12345',
      });
    });

    it('should normalize ICAO to uppercase', () => {
      const { result } = renderHook(() => useAircraftInfoCache());

      act(() => {
        result.current.setCacheEntry('abc123', { icao_hex: 'ABC123' });
      });

      expect(result.current.getCached('abc123')).toEqual({ icao_hex: 'ABC123' });
      expect(result.current.getCached('ABC123')).toEqual({ icao_hex: 'ABC123' });
    });

    it('should delete cache entries', () => {
      const { result } = renderHook(() => useAircraftInfoCache());

      act(() => {
        result.current.setCacheEntry('ABC123', { icao_hex: 'ABC123' });
        result.current.setCacheEntry('DEF456', { icao_hex: 'DEF456' });
      });

      expect(result.current.cacheSize).toBe(2);

      act(() => {
        result.current.deleteCacheEntry('ABC123');
      });

      expect(result.current.cacheSize).toBe(1);
      expect(result.current.getCached('ABC123')).toBeNull();
      expect(result.current.getCached('DEF456')).toBeDefined();
    });

    it('should clear all cache entries', () => {
      const { result } = renderHook(() => useAircraftInfoCache());

      act(() => {
        result.current.setCacheEntry('ABC123', { icao_hex: 'ABC123' });
        result.current.setCacheEntry('DEF456', { icao_hex: 'DEF456' });
      });

      expect(result.current.cacheSize).toBe(2);

      act(() => {
        result.current.clearCache();
      });

      expect(result.current.cacheSize).toBe(0);
    });

    it('should set multiple cache entries at once', () => {
      const { result } = renderHook(() => useAircraftInfoCache());

      act(() => {
        result.current.setCacheEntries({
          ABC123: { icao_hex: 'ABC123' },
          DEF456: { icao_hex: 'DEF456' },
          GHI789: { icao_hex: 'GHI789' },
        });
      });

      expect(result.current.cacheSize).toBe(3);
      expect(result.current.getCached('ABC123')).toBeDefined();
      expect(result.current.getCached('DEF456')).toBeDefined();
      expect(result.current.getCached('GHI789')).toBeDefined();
    });
  });

  describe('cache TTL', () => {
    it('should return null for expired entries', () => {
      const { result } = renderHook(() =>
        useAircraftInfoCache({ cacheTTL: 1000 }) // 1 second TTL
      );

      act(() => {
        result.current.setCacheEntry('ABC123', { icao_hex: 'ABC123' });
      });

      expect(result.current.getCached('ABC123')).toBeDefined();

      // Advance time past TTL
      act(() => {
        vi.advanceTimersByTime(1500);
      });

      expect(result.current.getCached('ABC123')).toBeNull();
    });

    it('should validate cache with isCacheValid', () => {
      const { result } = renderHook(() =>
        useAircraftInfoCache({ cacheTTL: 1000 })
      );

      // Valid entry
      const validEntry = { data: {}, fetchedAt: Date.now() };
      expect(result.current.isCacheValid(validEntry)).toBe(true);

      // Expired entry
      const expiredEntry = { data: {}, fetchedAt: Date.now() - 2000 };
      expect(result.current.isCacheValid(expiredEntry)).toBe(false);

      // Entry with error
      const errorEntry = { data: {}, fetchedAt: Date.now(), error: true };
      expect(result.current.isCacheValid(errorEntry)).toBe(false);

      // Null entry
      expect(result.current.isCacheValid(null)).toBe(false);
    });

    it('should check cache using ref for async callbacks', () => {
      const { result } = renderHook(() =>
        useAircraftInfoCache({ cacheTTL: 1000 })
      );

      act(() => {
        result.current.setCacheEntry('ABC123', { icao_hex: 'ABC123' });
      });

      expect(result.current.isInCacheRef('ABC123')).toBe(true);
      expect(result.current.isInCacheRef('NOTFOUND')).toBe(false);

      // Advance time past TTL
      act(() => {
        vi.advanceTimersByTime(1500);
      });

      expect(result.current.isInCacheRef('ABC123')).toBe(false);
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest entries when max size exceeded', () => {
      const { result } = renderHook(() =>
        useAircraftInfoCache({ maxCacheSize: 3 })
      );

      // Add 3 entries
      act(() => {
        result.current.setCacheEntry('A', { icao_hex: 'A' });
      });
      act(() => {
        vi.advanceTimersByTime(10);
        result.current.setCacheEntry('B', { icao_hex: 'B' });
      });
      act(() => {
        vi.advanceTimersByTime(10);
        result.current.setCacheEntry('C', { icao_hex: 'C' });
      });

      expect(result.current.cacheSize).toBe(3);

      // Add 4th entry - should evict oldest (A)
      act(() => {
        vi.advanceTimersByTime(10);
        result.current.setCacheEntry('D', { icao_hex: 'D' });
      });

      expect(result.current.cacheSize).toBe(3);
      expect(result.current.getCached('A')).toBeNull();
      expect(result.current.getCached('B')).toBeDefined();
      expect(result.current.getCached('C')).toBeDefined();
      expect(result.current.getCached('D')).toBeDefined();
    });

    it('should enforce max size correctly', () => {
      const { result } = renderHook(() =>
        useAircraftInfoCache({ maxCacheSize: 5 })
      );

      const cache = { A: { data: {}, fetchedAt: 1 }, B: { data: {}, fetchedAt: 2 } };
      expect(result.current.enforceMaxCacheSize(cache)).toEqual(cache);

      // Test with more than max
      const largeCache = {};
      for (let i = 0; i < 10; i++) {
        largeCache[`ICAO${i}`] = { data: {}, fetchedAt: i * 100 };
      }

      const evicted = result.current.enforceMaxCacheSize(largeCache);
      expect(Object.keys(evicted).length).toBe(5);
    });
  });

  describe('periodic cleanup', () => {
    it('should clean up expired entries on interval', () => {
      const { result } = renderHook(() =>
        useAircraftInfoCache({
          cacheTTL: 1000,
          cleanupInterval: 500,
        })
      );

      act(() => {
        result.current.setCacheEntry('ABC123', { icao_hex: 'ABC123' });
      });

      expect(result.current.cacheSize).toBe(1);

      // Entry expires after 1000ms, cleanup runs at 500ms intervals
      // After 2500ms, the entry should be expired (past 2x TTL grace period)
      act(() => {
        vi.advanceTimersByTime(2500);
      });

      // The entry should be cleaned up (either via TTL check or periodic cleanup)
      expect(result.current.getCached('ABC123')).toBeNull();
    });
  });

  describe('allCached computed property', () => {
    it('should return only valid entries', () => {
      const { result } = renderHook(() =>
        useAircraftInfoCache({ cacheTTL: 1000 })
      );

      act(() => {
        result.current.setCacheEntry('A', { icao_hex: 'A' });
        result.current.setCacheEntry('B', { icao_hex: 'B' });
      });

      expect(Object.keys(result.current.allCached).length).toBe(2);

      // Expire entries by advancing time
      act(() => {
        vi.advanceTimersByTime(1500);
      });

      // getCached should return null for expired entries (uses Date.now() on each call)
      expect(result.current.getCached('A')).toBeNull();
      expect(result.current.getCached('B')).toBeNull();

      // allCached is memoized - it filters on recalculation when cache state changes
      // Trigger recalculation by adding a new entry
      act(() => {
        result.current.setCacheEntry('C', { icao_hex: 'C' });
      });

      // Now allCached should only have the new valid entry
      expect(Object.keys(result.current.allCached).length).toBe(1);
      expect(result.current.allCached['C']).toEqual({ icao_hex: 'C' });
    });
  });
});
