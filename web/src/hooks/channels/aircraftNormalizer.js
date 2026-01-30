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
    // Registration / tail number
    r: data.r || data.registration || data.tail || null,
    registration: data.r || data.registration || data.tail || null,
    // Aircraft type - handle multiple formats
    t: data.t || data.aircraft_type || (data.type && !data.type.includes('_') ? data.type : null),
    type: data.t || data.aircraft_type || (data.type && !data.type.includes('_') ? data.type : null),
    aircraft_type: data.aircraft_type || data.t || null,
    // Database flags for aircraft characteristics (military, etc.)
    dbFlags: data.dbFlags || data.db_flags || data.flags || 0,
    // Altitude fields
    alt: data.alt || data.altitude || data.alt_baro || data.alt_geom || null,
    alt_baro: data.alt_baro || data.baro_alt || null,
    alt_geom: data.alt_geom || data.geom_alt || null,
    // Speed fields
    gs: data.gs || data.ground_speed || data.speed || null,
    tas: data.tas || null,
    ias: data.ias || null,
    mach: data.mach || null,
    // Heading/track fields
    track: data.track || data.heading || data.trk || null,
    true_heading: data.true_heading || null,
    mag_heading: data.mag_heading || null,
    // Vertical rate fields
    vr: data.vr || data.vertical_rate || data.baro_rate || data.geom_rate || null,
    baro_rate: data.baro_rate || null,
    geom_rate: data.geom_rate || null,
    // Position fields
    lat: data.lat || data.latitude || null,
    lon: data.lon || data.longitude || data.lng || null,
    // Transponder/identification
    squawk: data.squawk || null,
    seen: data.seen || 0,
    seen_pos: data.seen_pos || null,
    // Computed/derived fields
    distance_nm: data.distance_nm || data.distance || null,
    bearing: data.bearing || null,
    // Status flags
    military: data.military || ((data.dbFlags || data.db_flags || 0) & 1) !== 0,
    emergency: data.emergency === true || (typeof data.emergency === 'string' && data.emergency !== 'none' && data.emergency !== ''),
    category: data.category || null,
    on_ground: data.on_ground || false,
    // Signal strength
    rssi: data.rssi ?? data.signal ?? null,
    // Additional metadata
    desc: data.desc || data.description || null,
    ownOp: data.ownOp || data.owner_operator || null,
    year: data.year || null,
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
