import { useState, useEffect, useMemo, useCallback } from 'react';

/**
 * Calculate distance between two points in nautical miles using Haversine formula
 */
function calculateDistanceNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // Earth radius in nautical miles
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
 * Calculate bearing from point 1 to point 2 in degrees
 */
function calculateBearing(lat1, lon1, lat2, lon2) {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;

  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

/**
 * Normalize angle difference to [-180, 180]
 */
function normalizeAngleDiff(diff) {
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  return diff;
}

/**
 * Check if aircraft is heading towards airport
 * Returns true if aircraft track is within threshold degrees of bearing to airport
 */
function isHeadingTowards(aircraft, airport, threshold = 45) {
  if (!aircraft.lat || !aircraft.lon || !airport.lat || !airport.lon) return false;
  if (!aircraft.track && aircraft.track !== 0) return false;

  const bearingToAirport = calculateBearing(
    aircraft.lat,
    aircraft.lon,
    airport.lat,
    airport.lon
  );

  const diff = Math.abs(normalizeAngleDiff(aircraft.track - bearingToAirport));
  return diff <= threshold;
}

/**
 * Check if aircraft is descending (vertical rate < -100 fpm)
 */
function isDescending(aircraft) {
  const vr = aircraft.vr ?? aircraft.baro_rate ?? aircraft.geom_rate;
  return vr !== undefined && vr !== null && vr < -100;
}

/**
 * Check if aircraft is climbing (vertical rate > 100 fpm)
 */
function isClimbing(aircraft) {
  const vr = aircraft.vr ?? aircraft.baro_rate ?? aircraft.geom_rate;
  return vr !== undefined && vr !== null && vr > 100;
}

/**
 * Calculate ETA in minutes based on distance and ground speed
 */
function calculateETA(distanceNm, speedKts) {
  if (!speedKts || speedKts < 10) return null;
  return (distanceNm / speedKts) * 60; // Convert to minutes
}

/**
 * Hook for tracking aircraft arriving at and departing from selected airports
 *
 * @param {Array} aircraft - Array of aircraft objects from socket
 * @param {Array} airports - Array of airport objects from aviation data
 * @param {Object} options - Configuration options
 * @param {Array} options.selectedAirports - Array of airport ICAOs to monitor
 * @param {number} options.arrivalRadius - Maximum distance in nm to consider for arrivals (default: 50)
 * @param {number} options.departureRadius - Maximum distance in nm to consider for departures (default: 20)
 * @param {number} options.timeWindowMinutes - Time window for filtering (default: 60)
 * @param {number} options.feederLat - Feeder latitude for distance calculations
 * @param {number} options.feederLon - Feeder longitude for distance calculations
 */
export function useAirportTraffic(aircraft = [], airports = [], options = {}) {
  const {
    selectedAirports = [],
    arrivalRadius = 50,
    departureRadius = 20,
    timeWindowMinutes = 60,
    // feederLat and feederLon reserved for future use (e.g., sorting by distance from feeder)
    feederLat: _feederLat,
    feederLon: _feederLon,
  } = options;

  // Track recently departed aircraft with their departure time
  const [departedAircraft, setDepartedAircraft] = useState(new Map());

  // Get airport objects for selected ICAOs
  const monitoredAirports = useMemo(() => {
    if (!selectedAirports.length || !airports.length) return [];
    return airports.filter(
      (apt) =>
        selectedAirports.includes(apt.icao) ||
        selectedAirports.includes(apt.id) ||
        selectedAirports.includes(apt.icaoId) ||
        selectedAirports.includes(apt.faaId)
    );
  }, [selectedAirports, airports]);

  // Calculate inbound aircraft for each monitored airport
  const inboundAircraft = useMemo(() => {
    if (!monitoredAirports.length || !aircraft.length) return {};

    const result = {};

    monitoredAirports.forEach((airport) => {
      const airportCode = airport.icao || airport.id || airport.icaoId;
      const inbound = [];

      aircraft.forEach((ac) => {
        if (!ac.lat || !ac.lon) return;

        const distance = calculateDistanceNm(ac.lat, ac.lon, airport.lat, airport.lon);

        // Skip if too far
        if (distance > arrivalRadius) return;

        // Check if heading towards airport and descending (or at least not climbing rapidly)
        const headingTowards = isHeadingTowards(ac, airport, 60);
        const descending = isDescending(ac);
        const altitude = ac.alt_baro || ac.alt_geom || ac.alt || 0;
        const speed = ac.gs || ac.tas || 0;

        // Consider as inbound if:
        // 1. Heading towards airport AND descending, OR
        // 2. Heading towards airport AND below 10000ft AND within 30nm
        const isInbound =
          (headingTowards && descending) ||
          (headingTowards && altitude < 10000 && distance < 30);

        if (isInbound) {
          const eta = calculateETA(distance, speed);

          // Only include if ETA is within time window
          if (eta !== null && eta <= timeWindowMinutes) {
            inbound.push({
              ...ac,
              airport: airportCode,
              distanceToAirport: distance,
              eta,
              bearingToAirport: calculateBearing(ac.lat, ac.lon, airport.lat, airport.lon),
            });
          }
        }
      });

      // Sort by ETA
      inbound.sort((a, b) => (a.eta || 999) - (b.eta || 999));

      result[airportCode] = inbound;
    });

    return result;
  }, [aircraft, monitoredAirports, arrivalRadius, timeWindowMinutes]);

  // Track departures - look for aircraft climbing away from airport
  useEffect(() => {
    if (!monitoredAirports.length || !aircraft.length) return;

    const now = Date.now();
    const updates = new Map(departedAircraft);
    let hasChanges = false;

    monitoredAirports.forEach((airport) => {
      const airportCode = airport.icao || airport.id || airport.icaoId;

      aircraft.forEach((ac) => {
        if (!ac.lat || !ac.lon) return;

        const distance = calculateDistanceNm(ac.lat, ac.lon, airport.lat, airport.lon);
        const altitude = ac.alt_baro || ac.alt_geom || ac.alt || 0;
        const climbing = isClimbing(ac);
        const key = `${ac.hex}-${airportCode}`;

        // Detect departures: within departure radius, climbing, altitude < 5000ft
        if (distance <= departureRadius && climbing && altitude < 5000) {
          // Only add if not already tracked for this airport
          if (!updates.has(key)) {
            updates.set(key, {
              hex: ac.hex,
              airport: airportCode,
              departureTime: now,
              callsign: ac.flight?.trim(),
              type: ac.type,
            });
            hasChanges = true;
          }
        }
      });
    });

    // Clean up old departures (older than time window)
    const cutoff = now - timeWindowMinutes * 60 * 1000;
    for (const [key, value] of updates.entries()) {
      if (value.departureTime < cutoff) {
        updates.delete(key);
        hasChanges = true;
      }
    }

    if (hasChanges) {
      setDepartedAircraft(updates);
    }
  }, [aircraft, monitoredAirports, departureRadius, timeWindowMinutes, departedAircraft]);

  // Build outbound list with current aircraft data
  const outboundAircraft = useMemo(() => {
    if (!monitoredAirports.length) return {};

    const result = {};

    monitoredAirports.forEach((airport) => {
      const airportCode = airport.icao || airport.id || airport.icaoId;
      const outbound = [];

      // Get departed aircraft for this airport
      for (const [_key, departed] of departedAircraft.entries()) {
        if (departed.airport !== airportCode) continue;

        // Find current aircraft data
        const currentAc = aircraft.find((ac) => ac.hex === departed.hex);

        if (currentAc) {
          const distance = calculateDistanceNm(
            currentAc.lat,
            currentAc.lon,
            airport.lat,
            airport.lon
          );

          outbound.push({
            ...currentAc,
            airport: airportCode,
            distanceFromAirport: distance,
            departureTime: departed.departureTime,
            minutesSinceDeparture: (Date.now() - departed.departureTime) / 60000,
          });
        } else {
          // Aircraft no longer in range but was recently departed
          outbound.push({
            hex: departed.hex,
            flight: departed.callsign,
            type: departed.type,
            airport: airportCode,
            departureTime: departed.departureTime,
            minutesSinceDeparture: (Date.now() - departed.departureTime) / 60000,
            outOfRange: true,
          });
        }
      }

      // Sort by departure time (most recent first)
      outbound.sort((a, b) => (b.departureTime || 0) - (a.departureTime || 0));

      result[airportCode] = outbound;
    });

    return result;
  }, [aircraft, monitoredAirports, departedAircraft]);

  // Get combined counts
  const counts = useMemo(() => {
    const inboundCount = Object.values(inboundAircraft).reduce(
      (sum, arr) => sum + arr.length,
      0
    );
    const outboundCount = Object.values(outboundAircraft).reduce(
      (sum, arr) => sum + arr.length,
      0
    );

    return {
      inbound: inboundCount,
      outbound: outboundCount,
      total: inboundCount + outboundCount,
    };
  }, [inboundAircraft, outboundAircraft]);

  // Clear departed aircraft for an airport
  const clearDepartures = useCallback((airportCode) => {
    setDepartedAircraft((prev) => {
      const next = new Map(prev);
      for (const key of next.keys()) {
        if (key.endsWith(`-${airportCode}`)) {
          next.delete(key);
        }
      }
      return next;
    });
  }, []);

  return {
    monitoredAirports,
    inboundAircraft,
    outboundAircraft,
    counts,
    clearDepartures,
  };
}

export default useAirportTraffic;
