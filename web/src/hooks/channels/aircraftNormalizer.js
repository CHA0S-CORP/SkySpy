/**
 * Aircraft data normalization utilities
 * Handles different API field names and formats
 */

// Emergency transponder codes: hijack, radio failure, general emergency
const EMERGENCY_SQUAWKS = new Set(['7500', '7600', '7700']);

/**
 * Normalize aircraft data to handle different API field names
 *
 * @param {Object} data - Raw aircraft data from the API/stream
 * @param {Object} [options]
 * @param {boolean} [options.partial=false] - Treat `data` as a partial (delta)
 *   payload: fields whose source keys are absent are emitted as null instead
 *   of defaults (false/0) so field-level merges preserve previously-known
 *   values (military, emergency, dbFlags, on_ground, seen).
 */
export function normalizeAircraft(data, { partial = false } = {}) {
  const hex = data.hex || data.icao || data.icao_hex || '';
  // Presence-aware reads for status/derived fields so partial payloads can
  // signal "unknown" (null) rather than clobbering known values.
  const dbFlagsRaw = data.dbFlags ?? data.db_flags ?? data.flags ?? null;
  const squawk = data.squawk ?? null;
  const militaryKnown = data.military !== undefined && data.military !== null;
  const emergencyKnown = data.emergency !== undefined && data.emergency !== null;
  const explicitEmergency =
    data.emergency === true ||
    (typeof data.emergency === 'string' && data.emergency !== 'none' && data.emergency !== '');
  const squawkEmergency = squawk !== null && EMERGENCY_SQUAWKS.has(String(squawk));
  return {
    hex: hex.toUpperCase(),
    // Client-side timestamp for staleness detection (when we last received an update)
    _clientTimestamp: Date.now(),
    flight: data.flight || data.callsign || data.call || null,
    // Registration / tail number
    r: data.r || data.registration || data.tail || null,
    registration: data.r || data.registration || data.tail || null,
    // Aircraft type - handle multiple formats
    t: data.t || data.aircraft_type || (data.type && !data.type.includes('_') ? data.type : null),
    type:
      data.t || data.aircraft_type || (data.type && !data.type.includes('_') ? data.type : null),
    aircraft_type: data.aircraft_type || data.t || null,
    // Database flags for aircraft characteristics (military, etc.)
    dbFlags: dbFlagsRaw ?? (partial ? null : 0),
    // Altitude fields (?? preserves legitimate zero values)
    alt: data.alt ?? data.altitude ?? data.alt_baro ?? data.alt_geom ?? null,
    alt_baro: data.alt_baro ?? data.baro_alt ?? null,
    alt_geom: data.alt_geom ?? data.geom_alt ?? null,
    // Speed fields
    gs: data.gs ?? data.ground_speed ?? data.speed ?? null,
    tas: data.tas ?? null,
    ias: data.ias ?? null,
    mach: data.mach ?? null,
    // Heading/track fields
    track: data.track ?? data.heading ?? data.trk ?? null,
    true_heading: data.true_heading ?? null,
    mag_heading: data.mag_heading ?? null,
    // Vertical rate fields
    vr: data.vr ?? data.vertical_rate ?? data.baro_rate ?? data.geom_rate ?? null,
    baro_rate: data.baro_rate ?? null,
    geom_rate: data.geom_rate ?? null,
    // Position fields (lat/lon of 0 are valid coordinates)
    lat: data.lat ?? data.latitude ?? null,
    lon: data.lon ?? data.longitude ?? data.lng ?? null,
    // Transponder/identification
    squawk,
    seen: data.seen ?? (partial ? null : 0),
    seen_pos: data.seen_pos ?? null,
    // Computed/derived fields
    distance_nm: data.distance_nm ?? data.distance ?? null,
    bearing: data.bearing ?? null,
    // Status flags (null when unknown in partial mode so merges keep priors)
    military:
      militaryKnown || dbFlagsRaw !== null
        ? Boolean(data.military) || (dbFlagsRaw & 1) !== 0
        : partial
          ? null
          : false,
    emergency:
      emergencyKnown || squawk !== null
        ? explicitEmergency || squawkEmergency
        : partial
          ? null
          : false,
    category: data.category || null,
    on_ground: data.on_ground ?? (partial ? null : false),
    // Ghost = non-ICAO (~) duplicate of a real ICAO track (TIS-B/ADS-R/anon).
    // Presence-aware so partial/delta merges preserve a prior ghost state.
    ghost: data.ghost ?? (partial ? null : false),
    ghost_of: data.ghost_of ?? null,
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

  aircraftList.forEach((ac) => {
    if (ac && typeof ac === 'object') {
      const normalized = normalizeAircraft(ac);
      if (normalized.hex) {
        result[normalized.hex] = normalized;
      }
    }
  });

  return result;
}
