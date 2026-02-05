import { useState, useEffect, useCallback, useMemo } from 'react';

/**
 * MSAW (Minimum Safe Altitude Warning) Thresholds
 */
export const MSAW_THRESHOLDS = {
  WARNING: 1000, // Yellow warning when within 1000ft of terrain
  ALERT: 500, // Red alert when within 500ft of terrain
};

/**
 * Airport exclusion zone constants
 * Aircraft near airports are excluded from MSAW warnings
 */
export const AIRPORT_EXCLUSION = {
  RADIUS_NM: 5, // Exclude aircraft within 5nm of airport
  MAX_ALTITUDE: 3000, // Only exclude if below 3000ft (likely approach/departure)
};

const STORAGE_KEY = 'pro-msaw-enabled';
const DEFAULT_TERRAIN_ELEVATION = 0; // Default terrain elevation in feet

/**
 * Calculate distance between two lat/lon points in nautical miles
 */
const calculateDistanceNm = (lat1, lon1, lat2, lon2) => {
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const latNm = dLat * 60;
  const lonNm = dLon * 60 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(latNm * latNm + lonNm * lonNm);
};

/**
 * Check if aircraft is near any airport (within exclusion zone)
 * @param {Object} aircraft - Aircraft object with lat, lon, alt
 * @param {Array} airports - Array of airport objects with lat, lon, elev
 * @returns {Object|null} - Nearest airport if in exclusion zone, null otherwise
 */
const findNearestAirport = (aircraft, airports) => {
  if (!aircraft?.lat || !aircraft?.lon || !airports?.length) return null;

  const alt =
    aircraft.alt_baro === 'ground'
      ? 0
      : aircraft.alt_baro || aircraft.alt_geom || aircraft.alt || 0;

  // Only check exclusion for aircraft below the altitude threshold
  if (alt > AIRPORT_EXCLUSION.MAX_ALTITUDE) return null;

  let nearest = null;
  let nearestDist = Infinity;

  for (const airport of airports) {
    if (!airport?.lat || !airport?.lon) continue;

    const dist = calculateDistanceNm(aircraft.lat, aircraft.lon, airport.lat, airport.lon);
    if (dist < AIRPORT_EXCLUSION.RADIUS_NM && dist < nearestDist) {
      nearestDist = dist;
      nearest = { ...airport, distance: dist };
    }
  }

  return nearest;
};

/**
 * Calculate AGL (Above Ground Level) altitude
 * Uses nearest airport elevation as terrain reference
 * @param {Object} aircraft - Aircraft object with altitude
 * @param {Array} airports - Array of airport objects with elevation
 * @returns {number} - Estimated AGL altitude in feet
 */
const calculateAGL = (aircraft, airports) => {
  if (!aircraft) return Infinity;

  const alt =
    aircraft.alt_baro === 'ground'
      ? 0
      : aircraft.alt_baro || aircraft.alt_geom || aircraft.alt || 0;

  // Find nearest airport to use its elevation as terrain reference
  let terrainElevation = DEFAULT_TERRAIN_ELEVATION;

  if (airports?.length && aircraft.lat && aircraft.lon) {
    let nearestDist = Infinity;

    for (const airport of airports) {
      if (!airport?.lat || !airport?.lon) continue;

      const dist = calculateDistanceNm(aircraft.lat, aircraft.lon, airport.lat, airport.lon);
      if (dist < nearestDist && airport.elev != null) {
        nearestDist = dist;
        terrainElevation = airport.elev;
      }
    }
  }

  return alt - terrainElevation;
};

/**
 * Get MSAW status for an aircraft
 * @param {number} agl - Above Ground Level altitude in feet
 * @returns {'alert'|'warning'|null} - MSAW status
 */
const getMSAWStatus = (agl) => {
  if (agl <= MSAW_THRESHOLDS.ALERT) return 'alert';
  if (agl <= MSAW_THRESHOLDS.WARNING) return 'warning';
  return null;
};

/**
 * useMSAW - Hook for Minimum Safe Altitude Warning
 *
 * Features:
 * - Yellow warning when aircraft within 1000ft of terrain
 * - Red alert when within 500ft of terrain
 * - Excludes aircraft near airports (approach/departure phase)
 * - Uses nearest airport elevation as terrain reference
 * - Toggle with keyboard shortcut
 *
 * @param {Array} aircraft - Array of aircraft objects
 * @param {Array} airports - Array of airport objects with elevation data
 * @returns {Object} MSAW state and methods
 */
export function useMSAW(aircraft = [], airports = []) {
  // Initialize enabled state from localStorage
  const [enabled, setEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved === 'true';
    } catch {
      return false;
    }
  });

  // Persist enabled state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {
      // Ignore storage errors
    }
  }, [enabled]);

  /**
   * Toggle MSAW enabled state
   */
  const toggle = useCallback(() => {
    setEnabled((prev) => !prev);
  }, []);

  /**
   * Calculate MSAW warnings for all aircraft
   * Returns a Map of hex -> { status, agl, nearAirport }
   */
  const msawWarnings = useMemo(() => {
    const warnings = new Map();

    if (!enabled || !aircraft?.length) return warnings;

    for (const ac of aircraft) {
      if (!ac?.hex || !ac?.lat || !ac?.lon) continue;

      const alt = ac.alt_baro === 'ground' ? 0 : ac.alt_baro || ac.alt_geom || ac.alt || null;

      // Skip aircraft with no altitude data, negative altitude, on ground, or ground-indicated
      if (alt === null || alt < 0 || alt === 0 || ac.alt_baro === 'ground' || ac.on_ground) continue;

      // Check if near airport (excluded from MSAW)
      const nearAirport = findNearestAirport(ac, airports);
      if (nearAirport) continue; // Skip aircraft in airport exclusion zone

      // Calculate AGL and MSAW status
      const agl = calculateAGL(ac, airports);
      const status = getMSAWStatus(agl);

      if (status) {
        warnings.set(ac.hex, {
          status,
          agl: Math.round(agl),
          altitude: Math.round(alt),
          terrainRef: airports?.length ? 'airport' : 'default',
        });
      }
    }

    return warnings;
  }, [enabled, aircraft, airports]);

  /**
   * Check if a specific aircraft has MSAW warning
   * @param {string} hex - Aircraft ICAO hex
   * @returns {Object|null} - Warning info or null
   */
  const getWarning = useCallback(
    (hex) => {
      return msawWarnings.get(hex) || null;
    },
    [msawWarnings]
  );

  /**
   * Check if a specific aircraft has MSAW alert (red, < 500ft)
   */
  const hasAlert = useCallback(
    (hex) => {
      const warning = msawWarnings.get(hex);
      return warning?.status === 'alert';
    },
    [msawWarnings]
  );

  /**
   * Check if a specific aircraft has MSAW warning (yellow, < 1000ft)
   */
  const hasWarning = useCallback(
    (hex) => {
      const warning = msawWarnings.get(hex);
      return warning?.status === 'warning' || warning?.status === 'alert';
    },
    [msawWarnings]
  );

  /**
   * Get counts of warnings and alerts
   */
  const counts = useMemo(() => {
    let alerts = 0;
    let warnings = 0;

    for (const [, info] of msawWarnings) {
      if (info.status === 'alert') alerts++;
      else if (info.status === 'warning') warnings++;
    }

    return { alerts, warnings, total: alerts + warnings };
  }, [msawWarnings]);

  /**
   * Get all aircraft with MSAW status for rendering
   */
  const affectedAircraft = useMemo(() => {
    return Array.from(msawWarnings.entries()).map(([hex, info]) => ({
      hex,
      ...info,
    }));
  }, [msawWarnings]);

  return {
    enabled,
    toggle,
    setEnabled,
    msawWarnings,
    getWarning,
    hasAlert,
    hasWarning,
    counts,
    affectedAircraft,
    thresholds: MSAW_THRESHOLDS,
    exclusion: AIRPORT_EXCLUSION,
  };
}

export default useMSAW;
