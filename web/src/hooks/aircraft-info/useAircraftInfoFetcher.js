import { useCallback, useRef, useEffect } from 'react';

/**
 * Helper to safely parse JSON from fetch response
 */
async function safeJson(res) {
  if (!res.ok) return null;
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * @typedef {Object} UseAircraftInfoFetcherOptions
 * @property {Function} wsRequest - WebSocket request function
 * @property {boolean} wsConnected - Whether WebSocket is connected
 * @property {string} [apiBaseUrl=''] - API base URL for HTTP fallback
 * @property {number} [maxRetries=3] - Max retry attempts for failed lookups
 * @property {function(string, Object): void} onSuccess - Called with (icao, data) on successful fetch
 * @property {function(string, Object): void} onError - Called with (icao, errorInfo) on final failure
 * @property {function(): void} [scheduleRetryProcessing] - Called to schedule retry processing
 */

/**
 * @typedef {Object} UseAircraftInfoFetcherReturn
 * @property {function(string): Promise<Object|null>} fetchSingle - Fetch single aircraft info
 * @property {function(string[]): Promise<Object>} fetchBulk - Fetch bulk aircraft info
 * @property {React.RefObject<Set>} pendingFetches - Set of ICAOs currently being fetched
 * @property {React.RefObject<Map>} retryQueue - Retry queue with backoff info
 * @property {function(): void} processRetryQueue - Process pending retries
 */

/**
 * Hook for fetching aircraft info via WebSocket or HTTP with retry logic
 *
 * @param {UseAircraftInfoFetcherOptions} options
 * @returns {UseAircraftInfoFetcherReturn}
 */
export function useAircraftInfoFetcher({
  wsRequest,
  wsConnected,
  apiBaseUrl = '',
  maxRetries = 3,
  bulkBatchSize = 50,
  onSuccess,
  onError,
  onCacheUpdate,
  getCached,
}) {
  // Set of ICAOs currently being fetched (deduplication)
  const pendingFetches = useRef(new Set());

  // Retry queue with backoff info: icao -> { retryCount, nextRetryAt }
  const retryQueue = useRef(new Map());
  const retryTimeoutRef = useRef(null);

  // Ref for processRetryQueue to break circular dependency
  const processRetryQueueRef = useRef(null);

  /**
   * Schedule retry processing - defined BEFORE fetchSingle to avoid circular dependency
   */
  const scheduleRetryProcessing = useCallback(() => {
    if (retryTimeoutRef.current) return;

    retryTimeoutRef.current = setTimeout(() => {
      retryTimeoutRef.current = null;
      processRetryQueueRef.current?.();
    }, 1000);
  }, []);

  /**
   * Fetch single aircraft info via WebSocket or HTTP
   */
  const fetchSingle = useCallback(
    async (icao) => {
      icao = icao.toUpperCase();

      // Skip TIS-B aircraft
      if (icao.startsWith('~')) return null;

      // Check if already fetching
      if (pendingFetches.current.has(icao)) return null;

      pendingFetches.current.add(icao);

      try {
        let data = null;

        // Use WebSocket exclusively when connected
        if (wsRequest && wsConnected) {
          try {
            data = await wsRequest('aircraft-info', { icao });
            // Backend returns null when not found, or {error: ...} on error
            if (!data) {
              data = { icao_hex: icao, found: false };
            } else if (data?.error) {
              if (data.error === 'not_found' || data.error_type === 'not_found') {
                data = { icao_hex: icao, found: false };
              } else {
                data = null;
              }
            }
          } catch (err) {
            console.debug('Aircraft info WS request failed:', icao, err.message);
            throw err;
          }
        } else {
          // HTTP fallback when socket is not connected
          try {
            let res = await fetch(`${apiBaseUrl}/api/v1/airframes/${icao}/`);
            if (res.status === 404) {
              res = await fetch(`${apiBaseUrl}/api/v1/lookup/aircraft/${icao}`);
            }
            if (res.status === 404) {
              data = { icao_hex: icao, found: false };
            } else {
              data = await safeJson(res);
            }
          } catch (err) {
            console.debug('Aircraft info HTTP fetch failed:', icao, err.message);
            throw err;
          }
        }

        if (data) {
          onSuccess?.(icao, data);
          retryQueue.current.delete(icao);
        }

        return data;
      } catch (err) {
        // Schedule retry with exponential backoff
        const currentRetry = retryQueue.current.get(icao) || { retryCount: 0 };
        if (currentRetry.retryCount < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, currentRetry.retryCount), 30000);
          retryQueue.current.set(icao, {
            retryCount: currentRetry.retryCount + 1,
            nextRetryAt: Date.now() + delay,
          });
          scheduleRetryProcessing();
        } else {
          retryQueue.current.delete(icao);
          onError?.(icao, {
            error_type: 'fetch_failed',
            error_message: `Failed to fetch aircraft info after ${maxRetries} retries`,
            source: 'useAircraftInfoFetcher',
          });
        }
        return null;
      } finally {
        pendingFetches.current.delete(icao);
      }
    },
    [wsRequest, wsConnected, apiBaseUrl, maxRetries, onSuccess, onError, scheduleRetryProcessing]
  );

  /**
   * Fetch bulk aircraft info
   */
  const fetchBulk = useCallback(
    async (icaos) => {
      if (!icaos || icaos.length === 0) return {};

      // Filter out TIS-B, already cached, and pending
      const toFetch = icaos
        .map((i) => i.toUpperCase())
        .filter(
          (icao) => !icao.startsWith('~') && !getCached?.(icao) && !pendingFetches.current.has(icao)
        );

      if (toFetch.length === 0) return {};

      // Mark as pending
      toFetch.forEach((icao) => pendingFetches.current.add(icao));

      try {
        const results = {};

        if (wsRequest && wsConnected) {
          // Split into batches for WebSocket
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
          // HTTP fallback
          const batches = [];
          for (let i = 0; i < toFetch.length; i += bulkBatchSize) {
            batches.push(toFetch.slice(i, i + bulkBatchSize));
          }

          for (const batch of batches) {
            try {
              const icaoList = batch.join(',');
              const res = await fetch(`${apiBaseUrl}/api/v1/airframes/bulk/?icao=${icaoList}`);
              const data = await safeJson(res);

              if (!data || res.status === 400 || res.status === 404) {
                // Fallback to individual lookups
                for (const icao of batch) {
                  try {
                    const singleRes = await fetch(`${apiBaseUrl}/api/v1/airframes/${icao}/`);
                    const singleData = await safeJson(singleRes);
                    if (singleData && singleData.icao_hex) {
                      results[singleData.icao_hex.toUpperCase()] = singleData;
                    }
                  } catch {
                    // Skip failed individual lookups
                  }
                }
                continue;
              }

              // Handle various response formats
              if (data?.aircraft && typeof data.aircraft === 'object') {
                Object.assign(results, data.aircraft);
              } else if (Array.isArray(data)) {
                data.forEach((af) => {
                  if (af?.icao_hex) {
                    results[af.icao_hex.toUpperCase()] = af;
                  }
                });
              } else if (data?.results) {
                data.results.forEach((af) => {
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

        // Notify about successful fetches
        if (Object.keys(results).length > 0) {
          onCacheUpdate?.(results);
        }

        return results;
      } finally {
        toFetch.forEach((icao) => pendingFetches.current.delete(icao));
      }
    },
    [wsRequest, wsConnected, apiBaseUrl, bulkBatchSize, getCached, onCacheUpdate]
  );

  /**
   * Process retry queue - defined AFTER fetchSingle
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
    toRetry.forEach((icao) => {
      fetchSingle(icao);
    });

    // Reschedule if there are pending retries
    if (retryQueue.current.size > 0) {
      scheduleRetryProcessing();
    }
  }, [fetchSingle, scheduleRetryProcessing]);

  // Keep ref updated for scheduleRetryProcessing to use
  useEffect(() => {
    processRetryQueueRef.current = processRetryQueue;
  }, [processRetryQueue]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    };
  }, []);

  return {
    fetchSingle,
    fetchBulk,
    pendingFetches,
    retryQueue,
    processRetryQueue,
    retryQueueSize: retryQueue.current.size,
  };
}

export default useAircraftInfoFetcher;
