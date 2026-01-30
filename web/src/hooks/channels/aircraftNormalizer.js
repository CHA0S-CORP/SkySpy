/**
 * Aircraft data normalization utilities
 * Handles different API field names and formats
 */

/**
 * Normalize aircraft data to handle different API field names
 */
export function normalizeAircraft(data) {
  const hex = data.hex || data.icao || data.icao_hex || '';
  return {
    hex: hex.toUpperCase(),
    flight: data.flight || data.callsign || data.call || null,
    type: data.t || data.aircraft_type || (data.type && !data.type.includes('_') ? data.type : null),
    alt: data.alt || data.altitude || data.alt_baro || data.alt_geom || null,
    alt_baro: data.alt_baro || data.baro_alt || null,
    alt_geom: data.alt_geom || data.geom_alt || null,
    gs: data.gs || data.ground_speed || data.speed || null,
    tas: data.tas || null,
    ias: data.ias || null,
    track: data.track || data.heading || data.trk || null,
    true_heading: data.true_heading || null,
    mag_heading: data.mag_heading || null,
    vr: data.vr || data.vertical_rate || data.baro_rate || data.geom_rate || null,
    baro_rate: data.baro_rate || null,
    geom_rate: data.geom_rate || null,
    lat: data.lat || data.latitude || null,
    lon: data.lon || data.longitude || data.lng || null,
    squawk: data.squawk || null,
    seen: data.seen || 0,
    distance_nm: data.distance_nm || data.distance || null,
    military: data.military || false,
    emergency: data.emergency === true || (typeof data.emergency === 'string' && data.emergency !== 'none' && data.emergency !== ''),
    category: data.category || null,
    on_ground: data.on_ground || false,
    rssi: data.rssi ?? data.signal ?? null,
  };
}

/**
 * Normalize a batch of aircraft data
 */
export function normalizeAircraftBatch(aircraftList) {
  const result = {};
  if (!Array.isArray(aircraftList)) return result;

  aircraftList.forEach(ac => {
    if (ac && typeof ac === 'object') {
      const normalized = normalizeAircraft(ac);
      if (normalized.hex) {
        result[normalized.hex] = normalized;
      }
    }
  });

  return result;
}
