import { useQuery } from '@tanstack/react-query';

async function getJson(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type');
    if (!ct || !ct.includes('application/json')) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * REST data for the Aircraft Detail screen (all keyed by hex).
 * Airframe info (with lookup fallback), 24h track sightings, per-aircraft
 * safety events, sighting-history sessions, and route lookup.
 *
 * @param {string} apiBase
 * @param {string} hex - ICAO 24-bit hex (lowercase ok)
 * @param {string} [callsign]
 */
export function useDetailData(apiBase, hex, callsign) {
  // DB stores icao_hex uppercase and the sightings/sessions/safety filters
  // are case-sensitive exact matches; navigation sources pass lowercase.
  const hexUC = (hex || '').toUpperCase();

  const info = useQuery({
    queryKey: ['v2-detail-info', apiBase, hex],
    enabled: !!hex,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const airframe = await getJson(`${apiBase}/api/v1/airframes/${hex}/`);
      if (airframe) return airframe;
      // Lookup nests the useful fields under .data - unwrap the envelope
      const lookup = await getJson(`${apiBase}/api/v1/lookup/aircraft/${hex}`);
      return lookup?.data || {};
    },
  });

  const track = useQuery({
    queryKey: ['v2-detail-track', apiBase, hex],
    enabled: !!hex,
    refetchInterval: 30000,
    queryFn: async () => {
      const data = await getJson(`${apiBase}/api/v1/sightings?icao_hex=${hexUC}&hours=24&limit=200`);
      const list = data?.sightings || data?.results || (Array.isArray(data) ? data : []);
      return list.slice().sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
    },
  });

  const safety = useQuery({
    queryKey: ['v2-detail-safety', apiBase, hex],
    enabled: !!hex,
    queryFn: async () => {
      const data = await getJson(
        `${apiBase}/api/v1/safety/events?icao_hex=${hexUC}&hours=24&limit=50`
      );
      return data?.events || data?.results || (Array.isArray(data) ? data : []);
    },
  });

  const sessions = useQuery({
    queryKey: ['v2-detail-sessions', apiBase, hex],
    enabled: !!hex,
    queryFn: async () => {
      const data = await getJson(`${apiBase}/api/v1/sessions?icao_hex=${hexUC}&limit=10`);
      return data?.sessions || data?.results || (Array.isArray(data) ? data : []);
    },
  });

  const route = useQuery({
    queryKey: ['v2-detail-route', apiBase, callsign],
    enabled: !!callsign,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => getJson(`${apiBase}/api/v1/lookup/route/${encodeURIComponent(callsign)}`),
  });

  return { info, track, safety, sessions, route };
}
