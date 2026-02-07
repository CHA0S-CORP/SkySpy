/**
 * useConflictProbe - Predictive Conflict Detection Hook
 *
 * Phase 3.4: Conflict Probe (Look-Ahead)
 *
 * Analyzes aircraft pairs for potential conflicts up to 5 minutes ahead.
 * Uses trajectory prediction based on current position, track, and ground speed.
 *
 * Alert Levels:
 * - RED: Conflict predicted in < 1 minute
 * - ORANGE: Conflict predicted in 1-2 minutes
 * - YELLOW: Conflict predicted in 2-5 minutes
 *
 * Separation Standards (FAA):
 * - Lateral: 3nm (within 40nm of radar), 5nm (beyond 40nm)
 * - Vertical: 1000ft below FL290, 2000ft at/above FL290
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { calculateCPA } from '../utils/cpaCalculation';

// Separation standards
const LATERAL_SEP_NEAR = 3; // nm within 40nm of radar
const LATERAL_SEP_FAR = 5; // nm beyond 40nm of radar
const VERTICAL_SEP_LOW = 1000; // ft below FL290
const VERTICAL_SEP_HIGH = 2000; // ft at/above FL290
const FL290 = 29000; // FL290 in feet
const RADAR_NEAR_THRESHOLD = 40; // nm

// Time thresholds in seconds
const RED_THRESHOLD = 60; // < 1 minute
const ORANGE_THRESHOLD = 120; // 1-2 minutes
const YELLOW_THRESHOLD = 300; // 2-5 minutes

// Minimum altitude for conflict detection (ignore ground traffic)
const MIN_ALTITUDE = 500;

// Update interval (ms)
const UPDATE_INTERVAL = 1000;

/**
 * Calculate predicted position at time T
 */
function predictPosition(aircraft, secondsAhead) {
  if (!aircraft.lat || !aircraft.lon || !aircraft.gs || !aircraft.track) {
    return { lat: aircraft.lat, lon: aircraft.lon };
  }

  // Convert speed from knots to nm/second
  const speedNmPerSec = aircraft.gs / 3600;
  const distanceNm = speedNmPerSec * secondsAhead;

  // Calculate new position using simple great circle approximation
  const R = 3440.065; // Earth radius in nm
  const d = distanceNm / R;
  const brng = (aircraft.track * Math.PI) / 180;
  const lat1 = (aircraft.lat * Math.PI) / 180;
  const lon1 = (aircraft.lon * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng)
  );

  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );

  return {
    lat: (lat2 * 180) / Math.PI,
    lon: (lon2 * 180) / Math.PI,
  };
}

/**
 * Calculate predicted altitude at time T
 */
function predictAltitude(aircraft, secondsAhead) {
  const currentAlt = aircraft.alt_baro || aircraft.alt_geom || aircraft.alt || 0;
  const verticalRate = aircraft.baro_rate || aircraft.geom_rate || aircraft.vr || 0;

  // Vertical rate is in ft/min, convert to ft/sec
  const altChange = (verticalRate / 60) * secondsAhead;

  return currentAlt + altChange;
}

/**
 * Calculate distance between two lat/lon points in nm
 */
function calculateDistanceNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // Earth radius in nm
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Get required lateral separation based on distance from radar
 */
function getRequiredLateralSeparation(distanceFromRadar) {
  return distanceFromRadar <= RADAR_NEAR_THRESHOLD ? LATERAL_SEP_NEAR : LATERAL_SEP_FAR;
}

/**
 * Get required vertical separation based on altitude
 */
function getRequiredVerticalSeparation(altitude) {
  return altitude >= FL290 ? VERTICAL_SEP_HIGH : VERTICAL_SEP_LOW;
}

/**
 * Determine alert level based on time to conflict
 */
function getAlertLevel(tCPASeconds) {
  if (tCPASeconds < RED_THRESHOLD) return 'red';
  if (tCPASeconds < ORANGE_THRESHOLD) return 'orange';
  if (tCPASeconds <= YELLOW_THRESHOLD) return 'yellow';
  return null;
}

/**
 * Check if two aircraft are in potential conflict
 */
function analyzeConflict(ac1, ac2, feederLocation) {
  // Skip if either aircraft is on ground or very low
  const alt1 = ac1.alt_baro || ac1.alt_geom || ac1.alt || 0;
  const alt2 = ac2.alt_baro || ac2.alt_geom || ac2.alt || 0;

  if (alt1 < MIN_ALTITUDE || alt2 < MIN_ALTITUDE) {
    return null;
  }

  // Skip if aircraft don't have valid positions or velocities
  if (!ac1.lat || !ac1.lon || !ac2.lat || !ac2.lon) {
    return null;
  }

  // Calculate CPA
  const cpa = calculateCPA(ac1, ac2);

  // If CPA is in the past or parallel tracks, no future conflict
  if (cpa.isPast || cpa.isParallel) {
    return null;
  }

  // If CPA is beyond our look-ahead window (5 minutes), skip
  if (cpa.tCPASeconds > YELLOW_THRESHOLD) {
    return null;
  }

  // Predict altitudes at CPA time
  const alt1AtCPA = predictAltitude(ac1, cpa.tCPASeconds);
  const alt2AtCPA = predictAltitude(ac2, cpa.tCPASeconds);
  const verticalSeparation = Math.abs(alt1AtCPA - alt2AtCPA);

  // Determine required separations
  const avgAlt = (alt1AtCPA + alt2AtCPA) / 2;
  const reqVertical = getRequiredVerticalSeparation(avgAlt);

  // Calculate distance from radar (feeder) for lateral separation determination
  let distanceFromRadar = 0;
  if (feederLocation?.lat && feederLocation?.lon) {
    const midpoint = {
      lat: (cpa.cpa1.lat + cpa.cpa2.lat) / 2,
      lon: (cpa.cpa1.lon + cpa.cpa2.lon) / 2,
    };
    distanceFromRadar = calculateDistanceNm(
      feederLocation.lat,
      feederLocation.lon,
      midpoint.lat,
      midpoint.lon
    );
  }
  const reqLateral = getRequiredLateralSeparation(distanceFromRadar);

  // Check if separation standards will be violated
  const lateralLoss = cpa.distanceAtCPA < reqLateral;
  const verticalLoss = verticalSeparation < reqVertical;

  // Both separations must be lost for a conflict
  if (!lateralLoss || !verticalLoss) {
    return null;
  }

  // Determine alert level
  const alertLevel = getAlertLevel(cpa.tCPASeconds);
  if (!alertLevel) {
    return null;
  }

  return {
    id: `${ac1.hex}-${ac2.hex}`,
    aircraft1: {
      hex: ac1.hex,
      callsign: ac1.flight?.trim() || ac1.hex?.toUpperCase(),
      altitude: alt1,
      altitudeAtCPA: Math.round(alt1AtCPA),
      position: { lat: ac1.lat, lon: ac1.lon },
      positionAtCPA: cpa.cpa1,
      track: ac1.track,
      groundSpeed: ac1.gs,
    },
    aircraft2: {
      hex: ac2.hex,
      callsign: ac2.flight?.trim() || ac2.hex?.toUpperCase(),
      altitude: alt2,
      altitudeAtCPA: Math.round(alt2AtCPA),
      position: { lat: ac2.lat, lon: ac2.lon },
      positionAtCPA: cpa.cpa2,
      track: ac2.track,
      groundSpeed: ac2.gs,
    },
    cpa: {
      timeSeconds: Math.round(cpa.tCPASeconds),
      lateralNm: Math.round(cpa.distanceAtCPA * 10) / 10,
      verticalFt: Math.round(verticalSeparation),
      midpoint: {
        lat: (cpa.cpa1.lat + cpa.cpa2.lat) / 2,
        lon: (cpa.cpa1.lon + cpa.cpa2.lon) / 2,
      },
    },
    separation: {
      requiredLateral: reqLateral,
      requiredVertical: reqVertical,
      lateralLoss,
      verticalLoss,
    },
    alertLevel,
    timestamp: Date.now(),
  };
}

/**
 * useConflictProbe hook
 *
 * @param {Object} options
 * @param {Array} options.aircraft - Array of aircraft objects
 * @param {Object} options.feederLocation - Feeder location { lat, lon }
 * @param {boolean} options.enabled - Whether conflict probe is enabled
 * @param {number} options.maxDistance - Maximum distance between aircraft to consider (nm)
 * @returns {Object} { conflicts, conflictCount, getConflictForAircraft }
 */
export function useConflictProbe({
  aircraft = [],
  feederLocation,
  enabled = true,
  maxDistance = 100, // Only analyze aircraft within 100nm of each other
  safetyEvents = [], // Backend safety events with CPA data
}) {
  const [conflicts, setConflicts] = useState([]);
  const lastUpdateRef = useRef(0);
  const aircraftMapRef = useRef(new Map());
  // Store aircraft in ref to avoid triggering effect on every array reference change
  const aircraftRef = useRef(aircraft);
  aircraftRef.current = aircraft;
  const safetyEventsRef = useRef(safetyEvents);
  safetyEventsRef.current = safetyEvents;

  // Build aircraft map for quick lookups - use length as dependency to avoid unnecessary rebuilds
  const aircraftLength = aircraft.length;
  const safetyEventsLength = safetyEvents?.length || 0;
  useEffect(() => {
    const currentAircraft = aircraftRef.current;
    const map = new Map();
    currentAircraft.forEach((ac) => {
      if (ac.hex) {
        map.set(ac.hex.toUpperCase(), ac);
      }
    });
    aircraftMapRef.current = map;
  }, [aircraftLength]);

  // Analyze conflicts using interval-based approach to avoid O(n²) recalculations on every render
  useEffect(() => {
    if (!enabled) {
      setConflicts([]);
      return;
    }

    const analyzeConflicts = () => {
      const currentAircraft = aircraftRef.current;
      if (currentAircraft.length < 2) {
        setConflicts([]);
        return;
      }

      // Throttle updates
      const now = Date.now();
      if (now - lastUpdateRef.current < UPDATE_INTERVAL) {
        return;
      }
      lastUpdateRef.current = now;

      const newConflicts = [];
      const analyzedPairs = new Set();

      // Filter to aircraft with valid position data
      const validAircraft = currentAircraft.filter(
        (ac) =>
          ac.lat != null && ac.lon != null && (ac.alt_baro || ac.alt_geom || ac.alt) >= MIN_ALTITUDE
      );

      // O(n^2) comparison - consider spatial indexing for large numbers of aircraft
      for (let i = 0; i < validAircraft.length; i++) {
        for (let j = i + 1; j < validAircraft.length; j++) {
          const ac1 = validAircraft[i];
          const ac2 = validAircraft[j];

          // Skip if we've already analyzed this pair
          const pairKey = [ac1.hex, ac2.hex].sort().join('-');
          if (analyzedPairs.has(pairKey)) continue;
          analyzedPairs.add(pairKey);

          // Quick distance check to avoid expensive CPA calculation
          const quickDist = calculateDistanceNm(ac1.lat, ac1.lon, ac2.lat, ac2.lon);
          if (quickDist > maxDistance) continue;

          // Analyze potential conflict
          const conflict = analyzeConflict(ac1, ac2, feederLocation);
          if (conflict) {
            newConflicts.push(conflict);
          }
        }
      }

      // Sort by urgency (alert level and time to CPA)
      newConflicts.sort((a, b) => {
        const levelOrder = { red: 0, orange: 1, yellow: 2 };
        const levelDiff = levelOrder[a.alertLevel] - levelOrder[b.alertLevel];
        if (levelDiff !== 0) return levelDiff;
        return a.cpa.timeSeconds - b.cpa.timeSeconds;
      });

      // Merge backend CPA data from safety events (more authoritative)
      const currentSafetyEvents = safetyEventsRef.current;
      if (currentSafetyEvents?.length > 0) {
        for (const conflict of newConflicts) {
          const matchingEvent = currentSafetyEvents.find(
            (e) =>
              e.event_type === 'proximity_conflict' &&
              e.details?.cpa &&
              ((e.icao_hex === conflict.aircraft1.hex && e.icao_hex_2 === conflict.aircraft2.hex) ||
                (e.icao_hex === conflict.aircraft2.hex && e.icao_hex_2 === conflict.aircraft1.hex))
          );

          if (matchingEvent?.details?.cpa) {
            const backendCPA = matchingEvent.details.cpa;
            conflict.cpa = {
              ...conflict.cpa,
              // Prefer backend CPA data
              lateralNm: Math.round(backendCPA.cpa_distance_nm * 10) / 10,
              timeSeconds: Math.round(backendCPA.cpa_time_seconds),
              midpoint:
                backendCPA.cpa_lat && backendCPA.cpa_lon
                  ? { lat: backendCPA.cpa_lat, lon: backendCPA.cpa_lon }
                  : conflict.cpa.midpoint,
              source: 'backend',
            };
          }
        }
      }

      setConflicts(newConflicts);
    };

    // Run initial analysis
    analyzeConflicts();

    // Set up interval for periodic analysis
    const intervalId = setInterval(analyzeConflicts, UPDATE_INTERVAL);

    return () => clearInterval(intervalId);
  }, [enabled, feederLocation, maxDistance, safetyEventsLength]);

  // Get conflict involving a specific aircraft
  const getConflictForAircraft = useCallback(
    (hex) => {
      if (!hex) return null;
      const upperHex = hex.toUpperCase();
      return conflicts.find(
        (c) =>
          c.aircraft1.hex?.toUpperCase() === upperHex || c.aircraft2.hex?.toUpperCase() === upperHex
      );
    },
    [conflicts]
  );

  // Get all conflicts involving a specific aircraft
  const getConflictsForAircraft = useCallback(
    (hex) => {
      if (!hex) return [];
      const upperHex = hex.toUpperCase();
      return conflicts.filter(
        (c) =>
          c.aircraft1.hex?.toUpperCase() === upperHex || c.aircraft2.hex?.toUpperCase() === upperHex
      );
    },
    [conflicts]
  );

  // Conflict statistics
  const stats = useMemo(() => {
    const byLevel = { red: 0, orange: 0, yellow: 0 };
    conflicts.forEach((c) => {
      byLevel[c.alertLevel]++;
    });
    return {
      total: conflicts.length,
      ...byLevel,
    };
  }, [conflicts]);

  return {
    conflicts,
    conflictCount: conflicts.length,
    stats,
    getConflictForAircraft,
    getConflictsForAircraft,
  };
}

export default useConflictProbe;

// Export constants for external use
export {
  RED_THRESHOLD,
  ORANGE_THRESHOLD,
  YELLOW_THRESHOLD,
  LATERAL_SEP_NEAR,
  LATERAL_SEP_FAR,
  VERTICAL_SEP_LOW,
  VERTICAL_SEP_HIGH,
  FL290,
  predictPosition,
  predictAltitude,
  getAlertLevel,
};
