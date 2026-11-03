import { useMemo } from 'react';

import { useFeatureQuery } from './queries/useFeatureQuery';

/**
 * Poll per-aircraft turbulence risk from the backend scorer.
 *
 * The backend Celery task scores currently-tracked aircraft off the hot path
 * and caches a compact `{ HEX: { score, level } }` map, served at
 * `/api/v1/aviation/turbulence/aircraft`. This hook polls it and returns a
 * lookup keyed by upper-case hex so the map/list can merge a turbulence badge
 * onto aircraft without enriching the 1MB position stream.
 *
 * @param {Object} [options]
 * @param {boolean} [options.enabled=true] - Poll only when true.
 * @param {number} [options.interval=60000] - Poll interval in ms.
 * @param {string} [options.apiBase=''] - API base URL.
 * @returns {{ byHex: Map<string, {score:number, level:string}>, loading: boolean, error: (Error|null) }}
 */
export function useAircraftTurbulence({ enabled = true, interval = 60000, apiBase = '' } = {}) {
  const {
    data,
    isLoading: loading,
    error,
  } = useFeatureQuery('weather', {
    queryKey: ['aircraft-turbulence', apiBase],
    enabled,
    refetchInterval: interval,
    retry: false,
    queryFn: async ({ fetch, signal }) => {
      const response = await fetch(`${apiBase}/api/v1/aviation/turbulence/aircraft/`, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    },
  });

  const byHex = useMemo(() => {
    const map = new Map();
    const aircraft = data?.aircraft;
    if (aircraft && typeof aircraft === 'object') {
      for (const [hex, risk] of Object.entries(aircraft)) {
        if (risk && typeof risk === 'object') {
          map.set(hex.toUpperCase(), { score: risk.score, level: risk.level });
        }
      }
    }
    return map;
  }, [data]);

  return { byHex, loading, error };
}
