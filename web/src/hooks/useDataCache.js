import { useState, useCallback, useRef, useEffect } from 'react';

// Default TTL values in milliseconds
const DEFAULT_TTL = {
  sessions: 60000, // 60 seconds
  sightings: 30000, // 30 seconds
  analytics: 300000, // 5 minutes
  default: 60000, // 1 minute
};

// Maximum items per cache type
const DEFAULT_MAX_ITEMS = {
  sessions: 200,
  sightings: 500,
  analytics: 50,
  default: 100,
};

// LRU Cache implementation
class LRUCache {
  constructor(maxItems = 100) {
    this.cache = new Map();
    this.maxItems = maxItems;
  }

  get(key) {
    if (!this.cache.has(key)) return undefined;

    // Move to end (most recently used)
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value) {
    // Remove if exists to update position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxItems) {
      // Evict oldest (first) item
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, value);
  }

  has(key) {
    return this.cache.has(key);
  }

  delete(key) {
    return this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }

  keys() {
    return Array.from(this.cache.keys());
  }
}

// Global cache store (persists across component remounts)
const cacheStore = new Map();

/**
 * Create or get a cache for a specific type
 */
function getCache(type) {
  if (!cacheStore.has(type)) {
    cacheStore.set(type, new LRUCache(DEFAULT_MAX_ITEMS[type] || DEFAULT_MAX_ITEMS.default));
  }
  return cacheStore.get(type);
}

/**
 * useDataCache hook - Client-side caching with TTL and stale-while-revalidate
 *
 * @param {string} type - Cache type (sessions, sightings, analytics)
 * @param {Object} options - Cache options
 * @param {number} options.ttl - Time-to-live in milliseconds
 * @param {number} options.maxItems - Maximum cached items
 * @param {boolean} options.staleWhileRevalidate - Return stale data while fetching fresh
 */
export function useDataCache(type = 'default', options = {}) {
  const ttl = options.ttl || DEFAULT_TTL[type] || DEFAULT_TTL.default;
  const staleWhileRevalidate = options.staleWhileRevalidate !== false;

  const cache = useRef(getCache(type));
  const pendingRequests = useRef(new Map());

  /**
   * Generate cache key from request parameters
   */
  const getCacheKey = useCallback((key) => {
    if (typeof key === 'string') return key;
    if (typeof key === 'object') return JSON.stringify(key);
    return String(key);
  }, []);

  /**
   * Get cached data
   */
  const get = useCallback((key) => {
    const cacheKey = getCacheKey(key);
    const entry = cache.current.get(cacheKey);

    if (!entry) return null;

    const now = Date.now();
    const isExpired = now - entry.timestamp > ttl;
    const isStale = isExpired;

    return {
      data: entry.data,
      isStale,
      isExpired,
      timestamp: entry.timestamp,
      age: now - entry.timestamp,
    };
  }, [getCacheKey, ttl]);

  /**
   * Set cached data
   */
  const set = useCallback((key, data) => {
    const cacheKey = getCacheKey(key);
    cache.current.set(cacheKey, {
      data,
      timestamp: Date.now(),
    });
  }, [getCacheKey]);

  /**
   * Invalidate cache entry
   */
  const invalidate = useCallback((key) => {
    const cacheKey = getCacheKey(key);
    cache.current.delete(cacheKey);
  }, [getCacheKey]);

  /**
   * Clear entire cache
   */
  const clear = useCallback(() => {
    cache.current.clear();
  }, []);

  /**
   * Fetch with caching - supports stale-while-revalidate pattern
   *
   * @param {string|Object} key - Cache key
   * @param {Function} fetcher - Async function to fetch data
   * @param {Object} fetchOptions - Additional options
   * @returns {Promise<{ data, fromCache, isStale }>}
   */
  const fetchWithCache = useCallback(async (key, fetcher, fetchOptions = {}) => {
    const cacheKey = getCacheKey(key);
    const forceRefresh = fetchOptions.forceRefresh === true;

    // Check cache first (unless forcing refresh)
    if (!forceRefresh) {
      const cached = get(key);

      if (cached && !cached.isExpired) {
        // Fresh data, return immediately
        return { data: cached.data, fromCache: true, isStale: false };
      }

      if (cached && staleWhileRevalidate) {
        // Stale data - return immediately but trigger background refresh
        if (!pendingRequests.current.has(cacheKey)) {
          // Background refresh
          const refreshPromise = fetcher()
            .then(newData => {
              set(key, newData);
              return newData;
            })
            .finally(() => {
              pendingRequests.current.delete(cacheKey);
            });

          pendingRequests.current.set(cacheKey, refreshPromise);
        }

        return { data: cached.data, fromCache: true, isStale: true };
      }
    }

    // Check for pending request (dedupe)
    if (pendingRequests.current.has(cacheKey)) {
      const data = await pendingRequests.current.get(cacheKey);
      return { data, fromCache: false, isStale: false };
    }

    // Fetch fresh data
    const fetchPromise = fetcher()
      .then(data => {
        set(key, data);
        return data;
      })
      .finally(() => {
        pendingRequests.current.delete(cacheKey);
      });

    pendingRequests.current.set(cacheKey, fetchPromise);

    const data = await fetchPromise;
    return { data, fromCache: false, isStale: false };
  }, [getCacheKey, get, set, staleWhileRevalidate]);

  /**
   * Get cache stats
   */
  const getStats = useCallback(() => {
    return {
      type,
      size: cache.current.size(),
      keys: cache.current.keys(),
      ttl,
    };
  }, [type, ttl]);

  return {
    get,
    set,
    invalidate,
    clear,
    fetchWithCache,
    getStats,
  };
}

/**
 * Hook for managing multiple cache types together
 */
export function useCacheManager() {
  const sessionCache = useDataCache('sessions');
  const sightingsCache = useDataCache('sightings');
  const analyticsCache = useDataCache('analytics');

  const clearAll = useCallback(() => {
    sessionCache.clear();
    sightingsCache.clear();
    analyticsCache.clear();
  }, [sessionCache, sightingsCache, analyticsCache]);

  const getAllStats = useCallback(() => ({
    sessions: sessionCache.getStats(),
    sightings: sightingsCache.getStats(),
    analytics: analyticsCache.getStats(),
  }), [sessionCache, sightingsCache, analyticsCache]);

  return {
    sessions: sessionCache,
    sightings: sightingsCache,
    analytics: analyticsCache,
    clearAll,
    getAllStats,
  };
}

export default useDataCache;
