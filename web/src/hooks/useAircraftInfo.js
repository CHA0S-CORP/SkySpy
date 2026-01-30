import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  MAX_CACHE_SIZE,
  isCacheEntryValid,
  enforceMaxCacheSize,
  cleanupCache,
  safeJson,
  createBatches,
  isValidIcao,
  normalizeIcao,
  createErrorInfo,
} from './aircraftInfo';

/**
 * Robust aircraft info lookup hook with:
 * - Bulk lookups for multiple aircraft (uses backend bulk endpoint)
 * - Retry logic with exponential backoff for failed lookups
 * - Deduplication of concurrent requests
 * - Periodic refresh for visible aircraft
 * - Memory-efficient cache with TTL
 * - Integration with WebSocket airframe error events
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
  // Cache: { [icao]: { data, fetchedAt, error?, retryCount? } }
  const [cache, setCache] = useState({});

  // Ref to hold latest cache for use in async callbacks (avoids stale closures)
  const cacheRef = useRef(cache);
  cacheRef.current = cache;

  // Ref to hold latest cacheTTL for use in async callbacks (avoids stale closures)
  const cacheTTLRef = useRef(cacheTTL);
  cacheTTLRef.current = cacheTTL;

  // Max cache size for LRU eviction
  const MAX_CACHE_SIZE = 1000;

  // Errors received from WebSocket: { [icao]: { error_type, error_message, source, timestamp } }
  const [errors, setErrors] = useState({});

  // Set of ICAOs currently being fetched (deduplication)
  const pendingFetches = useRef(new Set());

  // Queue for bulk fetches
  const bulkQueue = useRef(new Set());
  const bulkTimeoutRef = useRef(null);

  // Retry queue with backoff info
  const retryQueue = useRef(new Map()); // icao -> { retryCount, nextRetryAt }
  const retryTimeoutRef = useRef(null);

  /**
   * Enforce max cache size with LRU eviction
   * Returns a new cache object with oldest entries removed if over limit
   */
  const enforceMaxCacheSize = useCallback((cacheObj) => {
    const entries = Object.entries(cacheObj);
    if (entries.length <= MAX_CACHE_SIZE) {
      return cacheObj;
    }
    // Sort by fetchedAt (oldest first) and keep only the most recent MAX_CACHE_SIZE entries
    entries.sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
    const toKeep = entries.slice(entries.length - MAX_CACHE_SIZE);
    const result = {};
    for (const [icao, entry] of toKeep) {
      result[icao] = entry;
    }
    return result;
  }, []);

  /**
   * Check if cached data is still valid
   */
  const isCacheValid = useCallback((entry) => {
    if (!entry || !entry.fetchedAt) return false;
    if (entry.error) return false; // Don't use errored entries
    return Date.now() - entry.fetchedAt < cacheTTL;
  }, [cacheTTL]);

  /**
   * Get error for an aircraft (from WebSocket or local state)
   * Returns: { error_type, error_message, source, details?, timestamp } or null
   */
  const getError = useCallback((icao) => {
    icao = icao?.toUpperCase();
    if (!icao) return null;

    // Check local errors state first
    if (errors[icao]) {
      return errors[icao];
    }

    // Check WebSocket errors if available
    if (getAirframeError) {
      return getAirframeError(icao);
    }

    return null;
  }, [errors, getAirframeError]);

  /**
   * Clear error for an aircraft
   */
  const clearError = useCallback((icao) => {
    icao = icao?.toUpperCase();
    if (!icao) return;

    // Clear from local state
    setErrors(prev => {
      if (!prev[icao]) return prev;
      const next = { ...prev };
      delete next[icao];
      return next;
    });

    // Clear from WebSocket if available
    if (clearAirframeError) {
      clearAirframeError(icao);
    }
  }, [clearAirframeError]);

  /**
   * Record an error for an aircraft
   */
  const recordError = useCallback((icao, errorInfo) => {
    icao = icao?.toUpperCase();
    if (!icao) return;

    setErrors(prev => ({
      ...prev,
      [icao]: {
        ...errorInfo,
        timestamp: errorInfo.timestamp || new Date().toISOString(),
      }
    }));
  }, []);

  /**
   * Get cached info for an aircraft (returns null if not cached or expired)
   */
  const getCached = useCallback((icao) => {
    const entry = cache[icao?.toUpperCase()];
    if (isCacheValid(entry)) {
      return entry.data;
    }
    return null;
  }, [cache, isCacheValid]);

  /**
   * Fetch single aircraft info via WebSocket or HTTP
   * When socket is connected, we only use WebSocket to reduce API calls
   */
  const fetchSingleInfo = useCallback(async (icao) => {
    icao = icao.toUpperCase();

    // Skip TIS-B aircraft
    if (icao.startsWith('~')) return null;

    // Check if already fetching
    if (pendingFetches.current.has(icao)) return null;

    pendingFetches.current.add(icao);

    try {
      let data = null;

      // Use WebSocket exclusively when connected to reduce HTTP calls
      if (wsRequest && wsConnected) {
        try {
          data = await wsRequest('aircraft-info', { icao });
          // Backend returns null when not found, or {error: ...} on error
          if (!data) {
            // Not found in database - cache as empty to avoid re-fetching
            data = { icao_hex: icao, found: false };
          } else if (data?.error) {
            // Explicit error response
            if (data.error === 'not_found' || data.error_type === 'not_found') {
              data = { icao_hex: icao, found: false };
            } else {
              data = null;
            }
          }
        } catch (err) {
          console.debug('Aircraft info WS request failed:', icao, err.message);
          // Don't fall back to HTTP when socket is connected - schedule retry instead
          throw err;
        }
      } else {
        // HTTP fallback only when socket is not connected
        try {
          // Try airframes endpoint first (most complete data)
          let res = await fetch(`${apiBaseUrl}/api/v1/airframes/${icao}/`);
          if (res.status === 404) {
            // Try lookup endpoint as fallback
            res = await fetch(`${apiBaseUrl}/api/v1/lookup/aircraft/${icao}`);
          }
          if (res.status === 404) {
            // No info found, cache as empty to avoid re-fetching
            data = { icao_hex: icao, found: false };
          } else {
            data = await safeJson(res);
          }
        } catch (err) {
          console.debug('Aircraft info HTTP fetch failed:', icao, err.message);
          throw err; // Trigger retry
        }
      }

      if (data) {
        setCache(prev => enforceMaxCacheSize({
          ...prev,
          [icao]: { data, fetchedAt: Date.now() }
        }));
        // Clear from retry queue on success
        retryQueue.current.delete(icao);
        // Clear any previous error state on success
        clearError(icao);
      }

      return data;
    } catch (err) {
      // Schedule retry with exponential backoff
      const currentRetry = retryQueue.current.get(icao) || { retryCount: 0 };
      if (currentRetry.retryCount < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, currentRetry.retryCount), 30000); // Max 30s
        retryQueue.current.set(icao, {
          retryCount: currentRetry.retryCount + 1,
          nextRetryAt: Date.now() + delay
        });
        scheduleRetryProcessing();
      } else {
        // Max retries exhausted - clear cache entry so it can be retried fresh later
        // and record the error for visibility
        setCache(prev => {
          const next = { ...prev };
          delete next[icao];
          return next;
        });
        retryQueue.current.delete(icao);
        recordError(icao, {
          error_type: 'fetch_failed',
          error_message: `Failed to fetch aircraft info after ${maxRetries} retries`,
          source: 'useAircraftInfo',
        });
      }
      return null;
    } finally {
      pendingFetches.current.delete(icao);
    }
  }, [wsRequest, wsConnected, apiBaseUrl, maxRetries, recordError, clearError, enforceMaxCacheSize]);

  /**
   * Fetch bulk aircraft info (cached data only from backend)
   * Uses WebSocket when available to reduce HTTP calls
   */
  const fetchBulkInfo = useCallback(async (icaos) => {
    if (!icaos || icaos.length === 0) return {};

    // Filter out TIS-B and already cached
    const toFetch = icaos
      .map(i => i.toUpperCase())
      .filter(icao => !icao.startsWith('~') && !getCached(icao) && !pendingFetches.current.has(icao));

    if (toFetch.length === 0) return {};

    // Mark as pending
    toFetch.forEach(icao => pendingFetches.current.add(icao));

    try {
      const results = {};

      // Prefer WebSocket for bulk lookups when connected
      if (wsRequest && wsConnected) {
        // Split into batches
        const batches = [];
        for (let i = 0; i < toFetch.length; i += bulkBatchSize) {
          batches.push(toFetch.slice(i, i + bulkBatchSize));
        }

        for (const batch of batches) {
          try {
            const data = await wsRequest('aircraft-info-bulk', { icaos: batch });
            if (data && !data.error && data.aircraft) {
              Object.assign(results, data.aircraft);
            }
          } catch (err) {
            console.debug('Bulk aircraft info WS request failed:', err.message);
          }
        }
      } else {
        // HTTP fallback only when socket is not connected
        const batches = [];
        for (let i = 0; i < toFetch.length; i += bulkBatchSize) {
          batches.push(toFetch.slice(i, i + bulkBatchSize));
        }

        for (const batch of batches) {
          try {
            // Django API: use /api/v1/airframes/bulk/?icao=A,B,C endpoint
            const icaoList = batch.join(',');
            let res = await fetch(`${apiBaseUrl}/api/v1/airframes/bulk/?icao=${icaoList}`);
            let data = await safeJson(res);

            // If that fails, try individual lookups for each ICAO
            if (!data || res.status === 400 || res.status === 404) {
              for (const icao of batch) {
                try {
                  const singleRes = await fetch(`${apiBaseUrl}/api/v1/airframes/${icao}/`);
                  const singleData = await safeJson(singleRes);
                  if (singleData && singleData.icao_hex) {
                    results[singleData.icao_hex.toUpperCase()] = singleData;
                  }
                } catch (e) {
                  // Individual lookup failed, skip
                }
              }
              continue;
            }

            // Response format: { aircraft: { ICAO: {...}, ... }, found: N, requested: M }
            if (data?.aircraft && typeof data.aircraft === 'object') {
              Object.assign(results, data.aircraft);
            } else if (Array.isArray(data)) {
              // Fallback: array of airframes
              data.forEach(af => {
                if (af?.icao_hex) {
                  results[af.icao_hex.toUpperCase()] = af;
                }
              });
            } else if (data?.results) {
              // Fallback: paginated response
              data.results.forEach(af => {
                if (af?.icao_hex) {
                  results[af.icao_hex.toUpperCase()] = af;
                }
              });
            }
          } catch (err) {
            console.debug('Bulk aircraft info HTTP fetch failed:', err.message);
          }
        }
      }

      // Update cache with results (with LRU eviction if needed)
      const now = Date.now();
      setCache(prev => {
        const updates = {};
        for (const [icao, data] of Object.entries(results)) {
          updates[icao.toUpperCase()] = { data, fetchedAt: now };
        }
        return enforceMaxCacheSize({ ...prev, ...updates });
      });

      // Clear any previous error state on success (outside state setter to avoid side effects)
      for (const icao of Object.keys(results)) {
        clearError(icao.toUpperCase());
      }

      // Queue individual lookups for aircraft not in bulk results (will trigger backend fetch)
      const notFound = toFetch.filter(icao => !results[icao]);
      notFound.forEach(icao => queueForLookup(icao));

      return results;
    } finally {
      toFetch.forEach(icao => pendingFetches.current.delete(icao));
    }
  }, [apiBaseUrl, bulkBatchSize, getCached, wsRequest, wsConnected, clearError, enforceMaxCacheSize]);

  /**
   * Queue an aircraft for deferred bulk lookup
   */
  const queueForLookup = useCallback((icao) => {
    icao = icao?.toUpperCase();
    if (!icao || icao.startsWith('~')) return;
    if (getCached(icao) || pendingFetches.current.has(icao)) return;

    bulkQueue.current.add(icao);

    // Debounce bulk processing
    if (bulkTimeoutRef.current) clearTimeout(bulkTimeoutRef.current);
    bulkTimeoutRef.current = setTimeout(() => {
      processBulkQueue();
    }, 100); // 100ms debounce
  }, [getCached]);

  /**
   * Check if icao is in cache using ref (for use in async callbacks to avoid stale closures)
   * Uses cacheTTLRef to always access current cacheTTL value
   */
  const isInCacheRef = (icao) => {
    const entry = cacheRef.current[icao?.toUpperCase()];
    if (!entry || !entry.fetchedAt) return false;
    if (entry.error) return false;
    return Date.now() - entry.fetchedAt < cacheTTLRef.current;
  };

  /**
   * Process the bulk queue
   * Uses refs (cacheRef, cacheTTLRef) to avoid stale closure issues in setTimeout callbacks
   */
  const processBulkQueue = useCallback(async () => {
    if (bulkQueue.current.size === 0) return;

    const icaos = Array.from(bulkQueue.current);
    bulkQueue.current.clear();

    // First try bulk fetch (for cached data)
    await fetchBulkInfo(icaos);

    // Then trigger individual fetches for remaining (will populate backend cache)
    // Use isInCacheRef to check latest cache state (avoids stale closure issue)
    const stillMissing = icaos.filter(icao => !isInCacheRef(icao) && !pendingFetches.current.has(icao));

    // Fetch individually with small delays to avoid overwhelming the backend
    for (let i = 0; i < stillMissing.length; i++) {
      const icao = stillMissing[i];
      // Use setTimeout to spread out requests
      // isInCacheRef uses refs internally, so no stale closure issues
      setTimeout(() => {
        // Use isInCacheRef for latest cache state inside timeout callback
        if (!isInCacheRef(icao) && !pendingFetches.current.has(icao)) {
          fetchSingleInfo(icao);
        }
      }, i * 50); // 50ms between requests
    }
  }, [fetchBulkInfo, fetchSingleInfo]);

  /**
   * Schedule retry processing
   */
  const scheduleRetryProcessing = useCallback(() => {
    if (retryTimeoutRef.current) return; // Already scheduled

    retryTimeoutRef.current = setTimeout(() => {
      retryTimeoutRef.current = null;
      processRetryQueue();
    }, 1000);
  }, []);

  /**
   * Process retry queue
   */
  const processRetryQueue = useCallback(() => {
    const now = Date.now();
    const toRetry = [];

    for (const [icao, info] of retryQueue.current.entries()) {
      if (info.nextRetryAt <= now && !pendingFetches.current.has(icao)) {
        toRetry.push(icao);
      }
    }

    // Process retries
    toRetry.forEach(icao => {
      fetchSingleInfo(icao);
    });

    // Reschedule if there are pending retries
    if (retryQueue.current.size > 0) {
      scheduleRetryProcessing();
    }
  }, [fetchSingleInfo, scheduleRetryProcessing]);

  /**
   * Prefetch info for a list of visible aircraft
   * Uses bulk endpoint for efficiency
   */
  const prefetchForAircraft = useCallback((aircraftList) => {
    if (!aircraftList || aircraftList.length === 0) return;

    const icaos = aircraftList
      .map(a => a.hex || a.icao)
      .filter(Boolean);

    // Queue all for lookup
    icaos.forEach(icao => queueForLookup(icao));
  }, [queueForLookup]);

  /**
   * Get info for an aircraft (returns cached or triggers fetch)
   */
  const getInfo = useCallback((icao) => {
    icao = icao?.toUpperCase();
    if (!icao) return null;

    const cached = getCached(icao);
    if (cached) return cached;

    // Queue for fetch if not cached
    queueForLookup(icao);
    return null;
  }, [getCached, queueForLookup]);

  /**
   * Force refresh info for an aircraft
   */
  const refreshInfo = useCallback(async (icao) => {
    icao = icao?.toUpperCase();
    if (!icao) return null;

    // Clear from cache to force refresh
    setCache(prev => {
      const next = { ...prev };
      delete next[icao];
      return next;
    });

    return fetchSingleInfo(icao);
  }, [fetchSingleInfo]);

  /**
   * Clear cache (useful for memory management)
   */
  const clearCache = useCallback(() => {
    setCache({});
    retryQueue.current.clear();
    bulkQueue.current.clear();
  }, []);

  /**
   * Get all cached info (for bulk access)
   */
  const getAllCached = useMemo(() => {
    const result = {};
    for (const [icao, entry] of Object.entries(cache)) {
      if (isCacheValid(entry)) {
        result[icao] = entry.data;
      }
    }
    return result;
  }, [cache, isCacheValid]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (bulkTimeoutRef.current) clearTimeout(bulkTimeoutRef.current);
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    };
  }, []);

  // Periodic cache cleanup (remove expired entries and enforce max size with LRU eviction)
  useEffect(() => {
    const cleanup = setInterval(() => {
      setCache(prev => {
        const now = Date.now();
        const entries = Object.entries(prev);

        // First pass: remove expired entries
        let validEntries = entries.filter(([, entry]) =>
          now - entry.fetchedAt < cacheTTLRef.current * 2
        );

        // Second pass: LRU eviction if still over max size
        if (validEntries.length > MAX_CACHE_SIZE) {
          // Sort by fetchedAt (oldest first) for LRU eviction
          validEntries.sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
          // Keep only the most recent MAX_CACHE_SIZE entries
          validEntries = validEntries.slice(validEntries.length - MAX_CACHE_SIZE);
        }

        // Convert back to object
        const next = {};
        for (const [icao, entry] of validEntries) {
          next[icao] = entry;
        }
        return next;
      });
    }, 5 * 60 * 1000); // Cleanup every 5 minutes

    return () => clearInterval(cleanup);
  }, []); // No dependencies needed - uses refs for current values

  return {
    // Get info for single aircraft
    getInfo,

    // Get cached info only (doesn't trigger fetch)
    getCached,

    // Get all cached info as object
    cache: getAllCached,

    // Prefetch for a list of aircraft (efficient bulk lookup)
    prefetchForAircraft,

    // Force refresh for an aircraft
    refreshInfo,

    // Clear all cached data
    clearCache,

    // Error handling
    getError,      // Get error for an aircraft (from WebSocket or local)
    clearError,    // Clear error for an aircraft
    errors,        // All current errors as object { [icao]: errorInfo }

    // Stats
    cacheSize: Object.keys(cache).length,
    pendingCount: pendingFetches.current.size,
    retryQueueSize: retryQueue.current.size,
    errorCount: Object.keys(errors).length,
  };
}

export default useAircraftInfo;
