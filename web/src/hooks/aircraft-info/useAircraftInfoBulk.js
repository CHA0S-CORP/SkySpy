import { useCallback, useRef, useEffect } from 'react';

/**
 * @typedef {Object} UseAircraftInfoBulkOptions
 * @property {function(string[]): Promise<Object>} fetchBulk - Bulk fetch function
 * @property {function(string): Promise<Object|null>} fetchSingle - Single fetch function
 * @property {function(string): Object|null} getCached - Get cached data
 * @property {function(string): boolean} isInCacheRef - Check if in cache using ref
 * @property {React.RefObject<Set>} pendingFetches - Set of pending fetches
 * @property {number} [debounceMs=100] - Debounce time for bulk queue processing
 * @property {number} [staggerMs=50] - Stagger time between individual fetches
 */

/**
 * @typedef {Object} UseAircraftInfoBulkReturn
 * @property {function(string): void} queueForLookup - Queue an ICAO for lookup
 * @property {function(Object[]): void} prefetchForAircraft - Prefetch for a list of aircraft
 * @property {function(): void} processBulkQueue - Process the bulk queue immediately
 */

/**
 * Hook for managing bulk aircraft info lookups with debouncing and staggering
 *
 * @param {UseAircraftInfoBulkOptions} options
 * @returns {UseAircraftInfoBulkReturn}
 */
export function useAircraftInfoBulk({
  fetchBulk,
  fetchSingle,
  getCached,
  isInCacheRef,
  pendingFetches,
  debounceMs = 100,
  staggerMs = 50,
}) {
  // Queue for bulk fetches
  const bulkQueue = useRef(new Set());
  const bulkTimeoutRef = useRef(null);

  // Track staggered fetch timeouts for cleanup
  const staggeredTimeoutIds = useRef([]);

  /**
   * Queue an aircraft for deferred bulk lookup
   */
  const queueForLookup = useCallback(
    (icao) => {
      icao = icao?.toUpperCase();
      if (!icao || icao.startsWith('~')) return;
      if (getCached?.(icao) || pendingFetches?.current?.has(icao)) return;

      bulkQueue.current.add(icao);

      // Debounce bulk processing
      if (bulkTimeoutRef.current) clearTimeout(bulkTimeoutRef.current);
      bulkTimeoutRef.current = setTimeout(() => {
        processBulkQueue();
      }, debounceMs);
    },
    [getCached, pendingFetches, debounceMs]
  );

  /**
   * Process the bulk queue
   */
  const processBulkQueue = useCallback(async () => {
    if (bulkQueue.current.size === 0) return;

    const icaos = Array.from(bulkQueue.current);
    bulkQueue.current.clear();

    // First try bulk fetch (for cached data on backend)
    await fetchBulk?.(icaos);

    // Then trigger individual fetches for remaining (will populate backend cache)
    const stillMissing = icaos.filter(
      (icao) => !isInCacheRef?.(icao) && !pendingFetches?.current?.has(icao)
    );

    // Fetch individually with small delays to avoid overwhelming the backend
    for (let i = 0; i < stillMissing.length; i++) {
      const icao = stillMissing[i];
      const timeoutId = setTimeout(() => {
        if (!isInCacheRef?.(icao) && !pendingFetches?.current?.has(icao)) {
          fetchSingle?.(icao);
        }
        // Remove completed timeout from array
        staggeredTimeoutIds.current = staggeredTimeoutIds.current.filter((id) => id !== timeoutId);
      }, i * staggerMs);

      staggeredTimeoutIds.current.push(timeoutId);
    }
  }, [fetchBulk, fetchSingle, isInCacheRef, pendingFetches, staggerMs]);

  /**
   * Prefetch info for a list of visible aircraft
   */
  const prefetchForAircraft = useCallback(
    (aircraftList) => {
      if (!aircraftList || aircraftList.length === 0) return;

      const icaos = aircraftList.map((a) => a.hex || a.icao).filter(Boolean);
      icaos.forEach((icao) => queueForLookup(icao));
    },
    [queueForLookup]
  );

  /**
   * Clear the bulk queue
   */
  const clearBulkQueue = useCallback(() => {
    bulkQueue.current.clear();
    if (bulkTimeoutRef.current) {
      clearTimeout(bulkTimeoutRef.current);
      bulkTimeoutRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (bulkTimeoutRef.current) clearTimeout(bulkTimeoutRef.current);

      // Clear all staggered fetch timeouts
      for (const timeoutId of staggeredTimeoutIds.current) {
        clearTimeout(timeoutId);
      }
      staggeredTimeoutIds.current = [];
    };
  }, []);

  return {
    queueForLookup,
    prefetchForAircraft,
    processBulkQueue,
    clearBulkQueue,
    bulkQueueSize: bulkQueue.current.size,
  };
}

export default useAircraftInfoBulk;
