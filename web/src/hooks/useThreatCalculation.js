/**
 * useThreatCalculation - Hook for calculating threats from aircraft data
 *
 * Handles both backend mode (using API threats) and local calculation mode.
 * Includes:
 * - Threat identification and classification
 * - Distance/bearing calculation
 * - Trend detection (approaching/departing)
 * - Behavior detection (circling, loitering)
 * - Urgency scoring
 * - Voice and haptic alert triggering
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  identifyLawEnforcement,
  getThreatLevel,
  calculateDistanceNm,
  calculateBearing,
  getDirectionName,
} from '../utils/lawEnforcement';
import {
  calculateClosingSpeed,
  calculateETA,
  calculateUrgencyScore,
  detectCirclingBehavior,
  detectLoitering,
} from '../utils/threatPrediction';

/**
 * Transform backend threat to common format
 */
function transformBackendThreat(t) {
  return {
    hex: t.icao_hex || t.hex,
    callsign: t.callsign,
    category: t.category || (t.is_helicopter ? 'Helicopter' : 'Aircraft'),
    description: t.description || t.identification_reason,
    distance_nm: t.distance_nm,
    bearing: t.bearing,
    direction: t.direction || (t.bearing !== null ? getDirectionName(t.bearing) : null),
    altitude: t.altitude,
    ground_speed: t.ground_speed,
    track: t.track,
    trend: t.trend || 'unknown',
    threat_level: t.threat_level,
    is_law_enforcement: t.is_law_enforcement || t.is_known_le,
    is_helicopter: t.is_helicopter,
    lat: t.lat,
    lon: t.lon,
    closingSpeed: t.closing_speed,
    urgencyScore: t.urgency_score || t.urgencyScore,
    // Backend patterns data
    patterns: t.patterns || [],
    behavior: {
      isCircling: t.patterns?.some((p) => p.type === 'circling'),
      isLoitering: t.patterns?.some((p) => p.type === 'loitering'),
    },
    // Additional backend data
    agencyName: t.agency_name,
    agencyType: t.agency_type,
    operatorName: t.operator_name,
    knownLE: t.known_le || t.is_known_le,
  };
}

/**
 * Sort threats by urgency and threat level
 */
function sortThreats(threats) {
  const threatOrder = { critical: 0, warning: 1, info: 2 };
  return threats.sort((a, b) => {
    // First by urgency
    const urgencyDiff = (b.urgencyScore || 0) - (a.urgencyScore || 0);
    if (Math.abs(urgencyDiff) > 5) return urgencyDiff;

    // Then by threat level
    const levelDiff = (threatOrder[a.threat_level] || 3) - (threatOrder[b.threat_level] || 3);
    if (levelDiff !== 0) return levelDiff;

    // Finally by distance
    return (a.distance_nm ?? Infinity) - (b.distance_nm ?? Infinity);
  });
}

/**
 * useThreatCalculation hook
 */
export function useThreatCalculation({
  aircraft = [],
  position,
  settings,
  backendThreats = [],
  backendConnected = false,
  // Alert callbacks
  announceNewThreat,
  announceClear,
  vibrateNewThreat,
  vibrateClear,
  logThreat,
}) {
  const [threats, setThreats] = useState([]);
  const [connected, setConnected] = useState(false);

  // Store objects in refs to avoid triggering effect on every reference change
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const positionRef = useRef(position);
  positionRef.current = position;
  const aircraftRef = useRef(aircraft);
  aircraftRef.current = aircraft;
  const backendThreatsRef = useRef(backendThreats);
  backendThreatsRef.current = backendThreats;

  // Primitive deps for triggering effects
  const aircraftLength = aircraft.length;
  const backendThreatsLength = backendThreats.length;
  const positionLat = position?.lat;
  const positionLon = position?.lon;

  // Refs
  const lastThreatsRef = useRef([]);
  const prevPositionRef = useRef(null);
  const threatHistoryRef = useRef(new Map()); // For behavior detection
  const updateTimeRef = useRef(Date.now());

  // Store callback refs to avoid triggering effect on every reference change
  const announceNewThreatRef = useRef(announceNewThreat);
  announceNewThreatRef.current = announceNewThreat;
  const announceClearRef = useRef(announceClear);
  announceClearRef.current = announceClear;
  const vibrateNewThreatRef = useRef(vibrateNewThreat);
  vibrateNewThreatRef.current = vibrateNewThreat;
  const vibrateClearRef = useRef(vibrateClear);
  vibrateClearRef.current = vibrateClear;
  const logThreatRef = useRef(logThreat);
  logThreatRef.current = logThreat;

  // Process new threats and trigger alerts
  const processNewThreats = useCallback((newThreats, oldThreats) => {
    const currentSettings = settingsRef.current;
    // Check for new threats to announce
    for (const threat of newThreats) {
      const wasTracked = oldThreats.find((t) => t.hex === threat.hex);
      if (!wasTracked) {
        if (currentSettings.voiceEnabled && announceNewThreatRef.current) {
          announceNewThreatRef.current(threat);
        }
        if (currentSettings.hapticEnabled && vibrateNewThreatRef.current) {
          vibrateNewThreatRef.current(threat.threat_level);
        }
      }
    }

    // Announce if all clear
    if (newThreats.length === 0 && oldThreats.length > 0) {
      if (currentSettings.voiceEnabled && announceClearRef.current) {
        announceClearRef.current();
      }
      if (currentSettings.hapticEnabled && vibrateClearRef.current) {
        vibrateClearRef.current();
      }
    }

    // Log threats to history
    if (currentSettings.persistent && logThreatRef.current) {
      for (const threat of newThreats) {
        if (threat.is_law_enforcement || threat.threat_level === 'critical' || threat.knownLE) {
          logThreatRef.current(threat);
        }
      }
    }
  }, []);

  // Calculate threats from aircraft list
  useEffect(() => {
    const currentSettings = settingsRef.current;
    const currentAircraft = aircraftRef.current;
    const currentPosition = positionRef.current;
    const currentBackendThreats = backendThreatsRef.current;

    // If using backend threats, process them
    if (currentSettings.useBackend !== false && currentBackendThreats.length > 0) {
      const transformedThreats = currentBackendThreats.map(transformBackendThreat);
      const sortedThreats = sortThreats(transformedThreats);

      processNewThreats(sortedThreats, lastThreatsRef.current);

      lastThreatsRef.current = sortedThreats;
      setThreats(sortedThreats);
      setConnected(backendConnected);
      return;
    }

    // Debounce: only process every 250ms
    const now = Date.now();
    if (now - updateTimeRef.current < 250) return;
    updateTimeRef.current = now;

    // Can work without GPS, just won't have distance/bearing
    if (!currentAircraft.length) return;

    const calculatedThreats = [];
    const timeDelta = 3; // seconds between updates (approximate)

    for (const ac of currentAircraft) {
      if (!ac.lat || !ac.lon) continue;

      // Identify law enforcement
      const leInfo = identifyLawEnforcement(ac);

      // Apply filtering settings
      if (currentSettings.showLawEnforcementOnly && !leInfo.isLawEnforcement) {
        continue;
      }
      if (!currentSettings.showAllHelicopters && !leInfo.isLawEnforcement && !leInfo.isInterest) {
        continue;
      }

      // Only include interesting aircraft
      if (!leInfo.isInterest && !currentSettings.showAllHelicopters) continue;

      // If we have GPS, calculate distance and bearing
      let distanceNm = null;
      let bearing = null;

      if (currentPosition) {
        distanceNm = calculateDistanceNm(currentPosition.lat, currentPosition.lon, ac.lat, ac.lon);

        // FIX: Apply radius filter BEFORE threat level calculation
        if (distanceNm > currentSettings.threatRadius) continue;

        bearing = calculateBearing(currentPosition.lat, currentPosition.lon, ac.lat, ac.lon);
      }

      // FIX: Calculate threat level AFTER distance filter
      const threatLevel = getThreatLevel(ac, distanceNm ?? 10, leInfo);

      // Apply altitude filters
      const altitude = ac.alt_baro || ac.alt_geom || ac.alt || 0;
      if (altitude < currentSettings.altitudeFloor || altitude > currentSettings.altitudeCeiling)
        continue;
      if (altitude > currentSettings.ignoreAboveAltitude) continue;

      // Check whitelisted hexes
      if (currentSettings.whitelistedHexes?.includes(ac.hex)) continue;

      // Determine trend and calculate closing speed
      let trend = 'unknown';
      let closingSpeed = null;
      const prevThreat = lastThreatsRef.current.find((t) => t.hex === ac.hex);

      if (prevThreat && distanceNm !== null && prevThreat.distance_nm !== null) {
        const distDiff = distanceNm - prevThreat.distance_nm;
        if (distDiff < -0.05) trend = 'approaching';
        else if (distDiff > 0.05) trend = 'departing';
        else trend = 'holding';

        // Calculate closing speed
        if (currentPosition && prevPositionRef.current && prevThreat.lat && prevThreat.lon) {
          closingSpeed = calculateClosingSpeed(
            currentPosition,
            prevPositionRef.current,
            { lat: ac.lat, lon: ac.lon },
            { lat: prevThreat.lat, lon: prevThreat.lon },
            timeDelta
          );
        }
      }

      // Track position history for behavior detection
      const behavior = { isCircling: false, isLoitering: false };
      if (ac.hex) {
        const history = threatHistoryRef.current.get(ac.hex) || [];
        history.push({ lat: ac.lat, lon: ac.lon, timestamp: Date.now() });
        // Keep last 20 positions
        if (history.length > 20) history.shift();
        threatHistoryRef.current.set(ac.hex, history);

        // Detect circling behavior
        if (currentSettings.detectCircling && history.length >= 10) {
          const circlingResult = detectCirclingBehavior(history, 10);
          behavior.isCircling = circlingResult.isCircling;
          behavior.circleConfidence = circlingResult.confidence;
        }

        // Detect loitering
        if (currentSettings.detectLoitering && history.length >= 2) {
          const firstSeen = { timestamp: history[0].timestamp, distance_nm: distanceNm };
          const loiteringResult = detectLoitering(
            { distance_nm: distanceNm },
            firstSeen,
            currentSettings.loiterThreshold
          );
          behavior.isLoitering = loiteringResult.isLoitering;
          behavior.duration = loiteringResult.duration;
        }
      }

      // Calculate ETA prediction
      let prediction = null;
      if (closingSpeed !== null && distanceNm !== null) {
        prediction = calculateETA({ distance_nm: distanceNm, trend }, closingSpeed);
      }

      // Calculate urgency score
      const urgencyScore = calculateUrgencyScore(
        {
          distance_nm: distanceNm ?? 10,
          is_law_enforcement: leInfo.isLawEnforcement,
          trend,
          threat_level: threatLevel,
        },
        prediction || {},
        behavior
      );

      calculatedThreats.push({
        hex: ac.hex,
        callsign: (ac.flight || '').trim() || null,
        category: leInfo.category || (leInfo.isHelicopter ? 'Helicopter' : 'Aircraft'),
        description: leInfo.description,
        distance_nm: distanceNm,
        bearing,
        direction: bearing !== null ? getDirectionName(bearing) : null,
        altitude,
        ground_speed: ac.gs,
        track: ac.track,
        vertical_rate: ac.baro_rate || ac.geom_rate,
        trend,
        threat_level: threatLevel,
        is_law_enforcement: leInfo.isLawEnforcement,
        is_helicopter: leInfo.isHelicopter,
        lat: ac.lat,
        lon: ac.lon,
        closingSpeed,
        prediction,
        behavior,
        urgencyScore,
      });
    }

    // Sort threats
    const sortedThreats = sortThreats(calculatedThreats);

    // Process alerts
    processNewThreats(sortedThreats, lastThreatsRef.current);

    // Store previous position for closing speed calculation
    prevPositionRef.current = currentPosition ? { ...currentPosition } : null;
    lastThreatsRef.current = sortedThreats;
    setThreats(sortedThreats);
    setConnected(true);
  }, [
    positionLat,
    positionLon,
    aircraftLength,
    backendThreatsLength,
    backendConnected,
    processNewThreats,
  ]);

  return {
    threats,
    connected,
    threatCount: threats.length,
  };
}

export default useThreatCalculation;
