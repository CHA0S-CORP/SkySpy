import { useState, useCallback, useRef, useMemo, useEffect } from 'react';

/**
 * @typedef {Object} CacheEntry
 * @property {Object} data - The cached aircraft info data
 * @property {number} fetchedAt - Timestamp when data was fetched
 * @property {boolean} [error] - Whether this entry has an error
 */

/**
 * @typedef {Object} UseAircraftInfoCacheOptions
 * @property {number} [cacheTTL=1800000] - Cache TTL in ms (default: 30 minutes)
 * @property {number} [maxCacheSize=1000] - Max cache size for LRU eviction
 * @property {number} [cleanupInterval=300000] - Cleanup interval in ms (default: 5 minutes)
 */

/**
 * @typedef {Object} UseAircraftInfoCacheReturn
 * @property {Object} cache - Current cache state
 * @property {React.RefObject<Object>} cacheRef - Ref to latest cache (for async callbacks)
 * @property {function(Object): Object} enforceMaxCacheSize - Enforce max size with LRU eviction
 * @property {function(CacheEntry): boolean} isCacheValid - Check if entry is still valid
 * @property {function(string): Object|null} getCached - Get cached data for an ICAO
 * @property {function(string, Object): void} setCacheEntry - Set cache entry for an ICAO
 * @property {function(string): void} deleteCacheEntry - Delete cache entry for an ICAO
 * @property {function(): void} clearCache - Clear all cached data
 * @property {function(string): boolean} isInCacheRef - Check if ICAO is in cache using ref
 * @property {Object} allCached - All valid cached data as object
 * @property {number} cacheSize - Current cache size
 */

/**
 * Hook for managing aircraft info cache with LRU eviction and TTL
 *
 * @param {UseAircraftInfoCacheOptions} options
 * @returns {UseAircraftInfoCacheReturn}
 */
export function useAircraftInfoCache({
  cacheTTL = 30 * 60 * 1000, // 30 minutes
  maxCacheSize = 1000,
  cleanupInterval = 5 * 60 * 1000, // 5 minutes
} = {}) {
  // Cache: { [icao]: { data, fetchedAt, error? } }
  const [cache, setCache] = useState({});

  // Ref to hold latest cache for use in async callbacks (avoids stale closures)
  const cacheRef = useRef(cache);
  cacheRef.current = cache;

  // Ref to hold latest cacheTTL for use in async callbacks
  const cacheTTLRef = useRef(cacheTTL);
  cacheTTLRef.current = cacheTTL;

  /**
   * Enforce max cache size with LRU eviction
   * Returns a new cache object with oldest entries removed if over limit
   */
  const enforceMaxCacheSize = useCallback(
    (cacheObj) => {
      const entries = Object.entries(cacheObj);
      if (entries.length <= maxCacheSize) {
        return cacheObj;
      }
      // Sort by fetchedAt (oldest first) and keep only the most recent entries
      entries.sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
      const toKeep = entries.slice(entries.length - maxCacheSize);
      const result = {};
      for (const [icao, entry] of toKeep) {
        result[icao] = entry;
      }
      return result;
    },
    [maxCacheSize]
  );

  /**
   * Check if cached data is still valid
   */
  const isCacheValid = useCallback(
    (entry) => {
      if (!entry || !entry.fetchedAt) return false;
      if (entry.error) return false; // Don't use errored entries
      return Date.now() - entry.fetchedAt < cacheTTL;
    },
    [cacheTTL]
  );

  /**
   * Get cached info for an aircraft (returns null if not cached or expired)
   */
  const getCached = useCallback(
    (icao) => {
      const entry = cache[icao?.toUpperCase()];
      if (isCacheValid(entry)) {
        return entry.data;
      }
      return null;
    },
    [cache, isCacheValid]
  );

  /**
   * Check if icao is in cache using ref (for use in async callbacks to avoid stale closures)
   */
  const isInCacheRef = useCallback((icao) => {
    const entry = cacheRef.current[icao?.toUpperCase()];
    if (!entry || !entry.fetchedAt) return false;
    if (entry.error) return false;
    return Date.now() - entry.fetchedAt < cacheTTLRef.current;
  }, []);

  /**
   * Set cache entry for an ICAO
   */
  const setCacheEntry = useCallback(
    (icao, data) => {
      icao = icao?.toUpperCase();
      if (!icao) return;

      setCache((prev) =>
        enforceMaxCacheSize({
          ...prev,
          [icao]: { data, fetchedAt: Date.now() },
        })
      );
    },
    [enforceMaxCacheSize]
  );

  /**
   * Set multiple cache entries at once
   */
  const setCacheEntries = useCallback(
    (entries) => {
      if (!entries || Object.keys(entries).length === 0) return;

      const now = Date.now();
      setCache((prev) => {
        const updates = {};
        for (const [icao, data] of Object.entries(entries)) {
          updates[icao.toUpperCase()] = { data, fetchedAt: now };
        }
        return enforceMaxCacheSize({ ...prev, ...updates });
      });
    },
    [enforceMaxCacheSize]
  );

  /**
   * Delete cache entry for an ICAO
   */
  const deleteCacheEntry = useCallback((icao) => {
    icao = icao?.toUpperCase();
    if (!icao) return;

    setCache((prev) => {
      if (!prev[icao]) return prev;
      const next = { ...prev };
      delete next[icao];
      return next;
    });
  }, []);

  /**
   * Clear all cached data
   */
  const clearCache = useCallback(() => {
    setCache({});
  }, []);

  /**
   * Get all cached info (for bulk access)
   */
  const allCached = useMemo(() => {
    const result = {};
    for (const [icao, entry] of Object.entries(cache)) {
      if (isCacheValid(entry)) {
        result[icao] = entry.data;
      }
    }
    return result;
  }, [cache, isCacheValid]);

  // Periodic cache cleanup (remove expired entries and enforce max size)
  useEffect(() => {
    const cleanup = setInterval(() => {
      setCache((prev) => {
        const now = Date.now();
        const entries = Object.entries(prev);

        // First pass: remove expired entries (with 2x TTL grace period)
        let validEntries = entries.filter(
          ([, entry]) => now - entry.fetchedAt < cacheTTLRef.current * 2
        );

        // Second pass: LRU eviction if still over max size
        if (validEntries.length > maxCacheSize) {
          validEntries.sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
          validEntries = validEntries.slice(validEntries.length - maxCacheSize);
        }

        // Convert back to object
        const next = {};
        for (const [icao, entry] of validEntries) {
          next[icao] = entry;
        }
        return next;
      });
    }, cleanupInterval);

    return () => clearInterval(cleanup);
  }, [maxCacheSize, cleanupInterval]);

  return {
    // State
    cache,
    cacheRef,

    // Utilities
    enforceMaxCacheSize,
    isCacheValid,

    // Operations
    getCached,
    isInCacheRef,
    setCacheEntry,
    setCacheEntries,
    deleteCacheEntry,
    clearCache,

    // Derived
    allCached,
    cacheSize: Object.keys(cache).length,
  };
}

export default useAircraftInfoCache;
