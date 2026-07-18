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

// Identity fields that make an airframe record worth showing. A cold record
// carries only icao_hex/is_military and nulls elsewhere - treat that as empty.
const AIRFRAME_IDENTITY_FIELDS = [
  'registration',
  'type_code',
  'aircraft_type',
  'type_name',
  'manufacturer',
  'model',
  'operator',
  'owner',
];

/** True when an airframe record has at least one meaningful identity field. */
export function isPopulatedAirframe(airframe) {
  if (!airframe || typeof airframe !== 'object') return false;
  return AIRFRAME_IDENTITY_FIELDS.some((k) => {
    const v = airframe[k];
    return v != null && v !== '';
  });
}

/**
 * REST data for the Aircraft Detail screen (all keyed by hex).
 * Airframe info (with lookup fallback), 24h track sightings, per-aircraft
 * safety events, sighting-history sessions, and route lookup.
 *
 * @param {string} apiBase
 * @param {string} hex - ICAO 24-bit hex (lowercase ok)
 * @param {string} [callsign]
 * @param {boolean} [liveTrack] - when true, refresh the track faster for live view
 */
export function useDetailData(apiBase, hex, callsign, liveTrack = false) {
  // DB stores icao_hex uppercase and the sightings/sessions/safety filters
  // are case-sensitive exact matches; navigation sources pass lowercase.
  // Key every query on the normalized hex so callers arriving with different
  // casing (map vs list vs radio) share one cache entry instead of splitting it.
  const hexUC = (hex || '').toUpperCase();

  const info = useQuery({
    queryKey: ['v2-detail-info', apiBase, hexUC],
    enabled: !!hex,
    staleTime: 10 * 60 * 1000,
    // A cold airframe row exists but is unpopulated (a background fetch fills
    // it in seconds later). Poll while the record has no useful fields so the
    // card fills in without a manual reload; stop once populated.
    refetchInterval: (query) => (isPopulatedAirframe(query.state.data) ? false : 8000),
    queryFn: async () => {
      const airframe = await getJson(`${apiBase}/api/v1/airframes/${hexUC}/`);
      if (isPopulatedAirframe(airframe)) return airframe;
      // Lookup nests the useful fields under .data - unwrap the envelope
      const lookup = await getJson(`${apiBase}/api/v1/lookup/aircraft/${hexUC}`);
      if (isPopulatedAirframe(lookup?.data)) return lookup.data;
      // Prefer whatever partial record we have over an empty object so the
      // ICAO/registration we do know still shows.
      return airframe || lookup?.data || {};
    },
  });

  const track = useQuery({
    queryKey: ['v2-detail-track', apiBase, hexUC],
    enabled: !!hex,
    refetchInterval: liveTrack ? 5000 : 30000,
    queryFn: async () => {
      const data = await getJson(
        `${apiBase}/api/v1/sightings/?icao_hex=${hexUC}&hours=24&limit=1000`
      );
      const list = data?.sightings || data?.results || (Array.isArray(data) ? data : []);
      return list.slice().sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
    },
  });

  const safety = useQuery({
    queryKey: ['v2-detail-safety', apiBase, hexUC],
    enabled: !!hex,
    queryFn: async () => {
      const data = await getJson(
        `${apiBase}/api/v1/safety/events/?icao_hex=${hexUC}&hours=24&limit=50`
      );
      return data?.events || data?.results || (Array.isArray(data) ? data : []);
    },
  });

  const sessions = useQuery({
    queryKey: ['v2-detail-sessions', apiBase, hexUC],
    enabled: !!hex,
    queryFn: async () => {
      // Sighting history spans the full retention window (server caps at
      // MAX_HISTORY_HOURS); without hours it silently defaulted to 24h and
      // hid every prior visit, breaking the "seen N× here" count.
      const data = await getJson(
        `${apiBase}/api/v1/sessions/?icao_hex=${hexUC}&hours=168&limit=50`
      );
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
