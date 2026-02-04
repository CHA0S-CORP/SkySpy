import { useCallback } from 'react';
import {
  useAircraftInfoCache,
  useAircraftInfoFetcher,
  useAircraftInfoBulk,
  useAircraftInfoErrors,
} from './aircraft-info';

/**
 * Normalize ICAO hex code to uppercase for consistent cache keys.
 * Backend compares case-insensitively, but we normalize to uppercase
 * throughout the frontend for consistent cache lookups.
 *
 * @param {string} icao - ICAO hex code
 * @returns {string|null} Normalized uppercase ICAO or null if invalid
 */
function normalizeIcao(icao) {
  if (!icao || typeof icao !== 'string') return null;
  return icao.toUpperCase();
}

/**
 * Robust aircraft info lookup hook with:
 * - Bulk lookups for multiple aircraft (uses backend bulk endpoint)
 * - Retry logic with exponential backoff for failed lookups
 * - Deduplication of concurrent requests
 * - Periodic refresh for visible aircraft
 * - Memory-efficient cache with TTL
 * - Integration with WebSocket airframe error events
 *
 * This hook composes smaller, focused hooks for better maintainability:
 * - useAircraftInfoCache: LRU cache with TTL
 * - useAircraftInfoFetcher: WebSocket/HTTP fetching with retries
 * - useAircraftInfoBulk: Batch queue management
 * - useAircraftInfoErrors: Error state management
 *
 * @param {Object} options
 * @param {Function} options.wsRequest - WebSocket request function
 * @param {boolean} options.wsConnected - Whether WebSocket is connected
 * @param {string} options.apiBaseUrl - API base URL for HTTP fallback
 * @param {number} options.cacheTTL - Cache TTL in ms (default: 30 minutes)
 * @param {number} options.bulkBatchSize - Max aircraft per bulk request (default: 50)
 * @param {number} options.maxRetries - Max retry attempts for failed lookups (default: 3)
 * @param {Function} options.getAirframeError - Function to get airframe error from WebSocket (optional)
 * @param {Function} options.clearAirframeError - Function to clear airframe error (optional)
 */
export function useAircraftInfo({
  wsRequest,
  wsConnected,
  apiBaseUrl = '',
  cacheTTL = 30 * 60 * 1000, // 30 minutes
  bulkBatchSize = 50,
  maxRetries = 3,
  getAirframeError,
  clearAirframeError,
} = {}) {
  // Cache management
  const cache = useAircraftInfoCache({
    cacheTTL,
    maxCacheSize: 1000,
    cleanupInterval: 5 * 60 * 1000,
  });

  // Error management
  const errors = useAircraftInfoErrors({
    getAirframeError,
    clearAirframeError,
  });

  // Fetching with retries
  const fetcher = useAircraftInfoFetcher({
    wsRequest,
    wsConnected,
    apiBaseUrl,
    maxRetries,
    bulkBatchSize,
    getCached: cache.getCached,
    onSuccess: useCallback((icao, data) => {
      cache.setCacheEntry(icao, data);
      errors.clearError(icao);
    }, [cache.setCacheEntry, errors.clearError]),
    onError: useCallback((icao, errorInfo) => {
      cache.deleteCacheEntry(icao);
      errors.recordError(icao, errorInfo);
    }, [cache.deleteCacheEntry, errors.recordError]),
    onCacheUpdate: useCallback((results) => {
      // Normalize all keys to uppercase before caching
      const normalizedResults = {};
      for (const [icao, data] of Object.entries(results)) {
        normalizedResults[icao.toUpperCase()] = data;
      }
      cache.setCacheEntries(normalizedResults);
      // Clear errors for successful fetches (already normalized)
      for (const icao of Object.keys(normalizedResults)) {
        errors.clearError(icao);
      }
    }, [cache.setCacheEntries, errors.clearError]),
  });

  // Bulk queue management
  const bulk = useAircraftInfoBulk({
    fetchBulk: fetcher.fetchBulk,
    fetchSingle: fetcher.fetchSingle,
    getCached: cache.getCached,
    isInCacheRef: cache.isInCacheRef,
    pendingFetches: fetcher.pendingFetches,
    debounceMs: 100,
    staggerMs: 50,
  });

  /**
   * Get info for an aircraft (returns cached or triggers fetch)
   */
  const getInfo = useCallback(
    (icao) => {
      const normalized = normalizeIcao(icao);
      if (!normalized) return null;

      const cached = cache.getCached(normalized);
      if (cached) return cached;

      // Queue for fetch if not cached
      bulk.queueForLookup(normalized);
      return null;
    },
    [cache.getCached, bulk.queueForLookup]
  );

  /**
   * Force refresh info for an aircraft
   */
  const refreshInfo = useCallback(
    async (icao) => {
      const normalized = normalizeIcao(icao);
      if (!normalized) return null;

      // Clear from cache to force refresh
      cache.deleteCacheEntry(normalized);

      return fetcher.fetchSingle(normalized);
    },
    [cache.deleteCacheEntry, fetcher.fetchSingle]
  );

  /**
   * Clear all cached data
   */
  const clearCache = useCallback(() => {
    cache.clearCache();
    bulk.clearBulkQueue();
  }, [cache.clearCache, bulk.clearBulkQueue]);

  return {
    // Get info for single aircraft
    getInfo,

    // Get cached info only (doesn't trigger fetch)
    getCached: cache.getCached,

    // Get all cached info as object
    cache: cache.allCached,

    // Prefetch for a list of aircraft (efficient bulk lookup)
    prefetchForAircraft: bulk.prefetchForAircraft,

    // Force refresh for an aircraft
    refreshInfo,

    // Clear all cached data
    clearCache,

    // Error handling
    getError: errors.getError,
    clearError: errors.clearError,
    errors: errors.errors,

    // Stats
    cacheSize: cache.cacheSize,
    pendingCount: fetcher.pendingFetches.current.size,
    retryQueueSize: fetcher.retryQueueSize,
    errorCount: errors.errorCount,
  };
}

export default useAircraftInfo;
