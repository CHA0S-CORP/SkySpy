import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

/**
 * Phase 7.2: Screen Reader Support Component
 *
 * Provides ARIA live region announcements for:
 * - New aircraft entering range
 * - Safety alerts and emergencies
 * - Selected aircraft information
 * - Conflict warnings
 *
 * Uses aria-live="polite" for non-urgent updates and aria-live="assertive" for emergencies.
 * Announcements are debounced to avoid overwhelming screen reader users.
 */
export function ScreenReaderAnnouncements({
  aircraft = [],
  safetyEvents = [],
  selectedAircraft = null,
  conflicts = [],
  feederLocation = null,
  enabled = true,
}) {
  // Current announcements
  const [politeAnnouncement, setPoliteAnnouncement] = useState('');
  const [assertiveAnnouncement, setAssertiveAnnouncement] = useState('');

  // Track previous state for detecting changes
  const prevAircraftCountRef = useRef(0);
  const prevAircraftHexesRef = useRef(new Set());
  const prevSafetyEventsRef = useRef(new Set());
  const prevConflictsRef = useRef(new Set());
  const prevSelectedHexRef = useRef(null);

  // Debounce timers
  const newAircraftTimerRef = useRef(null);
  const newAircraftQueueRef = useRef([]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (newAircraftTimerRef.current) {
        clearTimeout(newAircraftTimerRef.current);
      }
    };
  }, []);

  // Format altitude for announcement
  const formatAltitude = useCallback((alt) => {
    if (alt === null || alt === undefined || alt === 'ground') {
      return 'on ground';
    }
    const altNum = parseInt(alt, 10);
    if (isNaN(altNum)) return 'unknown altitude';
    if (altNum >= 1000) {
      return `${Math.round(altNum / 100) * 100} feet`;
    }
    return `${altNum} feet`;
  }, []);

  // Format distance for announcement
  const formatDistance = useCallback((nm) => {
    if (nm === null || nm === undefined) return '';
    if (nm < 1) return 'less than 1 nautical mile away';
    return `${Math.round(nm)} nautical miles away`;
  }, []);

  // Get aircraft display name
  const getAircraftDisplayName = useCallback((ac) => {
    const callsign = ac.flight?.trim() || ac.callsign?.trim();
    const hex = ac.hex?.toUpperCase();
    if (callsign) {
      return `${callsign}`;
    }
    return `aircraft ${hex || 'unknown'}`;
  }, []);

  // Announce new aircraft entering range (debounced batch)
  useEffect(() => {
    if (!enabled || !aircraft.length) return;

    const currentHexes = new Set(aircraft.map((ac) => ac.hex));
    const prevHexes = prevAircraftHexesRef.current;

    // Find newly appearing aircraft
    const newAircraft = aircraft.filter((ac) => ac.hex && !prevHexes.has(ac.hex));

    if (newAircraft.length > 0) {
      // Add to queue
      newAircraftQueueRef.current.push(...newAircraft);

      // Debounce announcement (wait 2 seconds to batch multiple new aircraft)
      if (newAircraftTimerRef.current) {
        clearTimeout(newAircraftTimerRef.current);
      }

      newAircraftTimerRef.current = setTimeout(() => {
        const queue = newAircraftQueueRef.current;
        newAircraftQueueRef.current = [];

        if (queue.length === 0) return;

        let announcement;
        if (queue.length === 1) {
          const ac = queue[0];
          const name = getAircraftDisplayName(ac);
          const alt = formatAltitude(ac.alt_baro || ac.altitude);
          announcement = `New aircraft: ${name}, ${alt}`;

          // Add type info if available
          if (ac.t) {
            announcement = `New aircraft: ${name}, ${ac.t}, ${alt}`;
          }
        } else if (queue.length <= 5) {
          const names = queue.map(getAircraftDisplayName).join(', ');
          announcement = `${queue.length} new aircraft: ${names}`;
        } else {
          announcement = `${queue.length} new aircraft have entered range`;
        }

        setPoliteAnnouncement(announcement);
      }, 2000);
    }

    prevAircraftHexesRef.current = currentHexes;
    prevAircraftCountRef.current = aircraft.length;
  }, [aircraft, enabled, formatAltitude, getAircraftDisplayName]);

  // Announce safety alerts (assertive for emergencies)
  useEffect(() => {
    if (!enabled) return;

    const currentEventIds = new Set(safetyEvents.map((e) => e.id || `${e.type}-${e.hex}`));
    const prevEventIds = prevSafetyEventsRef.current;

    // Find new events
    const newEvents = safetyEvents.filter((e) => {
      const id = e.id || `${e.type}-${e.hex}`;
      return !prevEventIds.has(id);
    });

    if (newEvents.length > 0) {
      // Prioritize emergencies
      const emergencies = newEvents.filter(
        (e) => e.type === 'emergency' || e.severity === 'critical' || e.priority === 'critical'
      );
      const otherAlerts = newEvents.filter(
        (e) => e.type !== 'emergency' && e.severity !== 'critical' && e.priority !== 'critical'
      );

      // Announce emergencies assertively
      if (emergencies.length > 0) {
        const emergency = emergencies[0];
        const name = getAircraftDisplayName({ hex: emergency.hex, flight: emergency.callsign });
        let message = `Emergency alert: ${name}`;

        if (emergency.squawk) {
          if (emergency.squawk === '7500') {
            message += ', squawking 7500 hijack code';
          } else if (emergency.squawk === '7600') {
            message += ', squawking 7600 radio failure';
          } else if (emergency.squawk === '7700') {
            message += ', squawking 7700 general emergency';
          }
        }

        if (emergency.message) {
          message += `. ${emergency.message}`;
        }

        setAssertiveAnnouncement(message);
      }

      // Announce other alerts politely
      if (otherAlerts.length > 0) {
        const alert = otherAlerts[0];
        const name = getAircraftDisplayName({ hex: alert.hex, flight: alert.callsign });
        let message = `Safety alert: ${name}`;

        if (alert.type) {
          message += `, ${alert.type.replace(/_/g, ' ')}`;
        }

        setPoliteAnnouncement(message);
      }
    }

    prevSafetyEventsRef.current = currentEventIds;
  }, [safetyEvents, enabled, getAircraftDisplayName]);

  // Announce conflicts
  useEffect(() => {
    if (!enabled || !conflicts.length) return;

    const currentConflictKeys = new Set(
      conflicts.map((c) => `${c.aircraft1?.hex || c.hex1}-${c.aircraft2?.hex || c.hex2}`)
    );
    const prevConflictKeys = prevConflictsRef.current;

    // Find new conflicts
    const newConflicts = conflicts.filter((c) => {
      const key = `${c.aircraft1?.hex || c.hex1}-${c.aircraft2?.hex || c.hex2}`;
      return !prevConflictKeys.has(key);
    });

    if (newConflicts.length > 0) {
      const conflict = newConflicts[0];
      const ac1 = conflict.aircraft1 || { hex: conflict.hex1 };
      const ac2 = conflict.aircraft2 || { hex: conflict.hex2 };
      const name1 = getAircraftDisplayName(ac1);
      const name2 = getAircraftDisplayName(ac2);

      let message = `Conflict alert: ${name1} and ${name2}`;

      if (conflict.separation_nm !== undefined) {
        message += `, separation ${conflict.separation_nm.toFixed(1)} nautical miles`;
      }
      if (conflict.separation_ft !== undefined) {
        message += `, vertical separation ${Math.round(conflict.separation_ft)} feet`;
      }

      // Use assertive for critical conflicts
      if (conflict.severity === 'critical') {
        setAssertiveAnnouncement(message);
      } else {
        setPoliteAnnouncement(message);
      }
    }

    prevConflictsRef.current = currentConflictKeys;
  }, [conflicts, enabled, getAircraftDisplayName]);

  // Announce selected aircraft changes
  useEffect(() => {
    if (!enabled || !selectedAircraft) {
      prevSelectedHexRef.current = null;
      return;
    }

    const currentHex = selectedAircraft.hex;
    if (currentHex === prevSelectedHexRef.current) return;

    prevSelectedHexRef.current = currentHex;

    const name = getAircraftDisplayName(selectedAircraft);
    const alt = formatAltitude(selectedAircraft.alt_baro || selectedAircraft.altitude);
    const speed = selectedAircraft.gs ? `${Math.round(selectedAircraft.gs)} knots` : '';

    let message = `Selected: ${name}`;

    if (selectedAircraft.t) {
      message += `, ${selectedAircraft.t}`;
    }

    message += `, ${alt}`;

    if (speed) {
      message += `, ${speed}`;
    }

    // Add distance if feeder location available
    if (feederLocation && selectedAircraft.lat && selectedAircraft.lon) {
      const dist = calculateDistance(
        feederLocation.lat,
        feederLocation.lon,
        selectedAircraft.lat,
        selectedAircraft.lon
      );
      if (dist !== null) {
        message += `, ${formatDistance(dist)}`;
      }
    }

    setPoliteAnnouncement(message);
  }, [selectedAircraft, enabled, formatAltitude, formatDistance, getAircraftDisplayName, feederLocation]);

  // Calculate distance in nautical miles
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;

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
  };

  // Summary statistics for status
  const statusSummary = useMemo(() => {
    const emergencyCount = safetyEvents.filter(
      (e) => e.type === 'emergency' || e.severity === 'critical'
    ).length;
    const conflictCount = conflicts.length;

    let summary = `${aircraft.length} aircraft tracked`;

    if (emergencyCount > 0) {
      summary += `, ${emergencyCount} ${emergencyCount === 1 ? 'emergency' : 'emergencies'}`;
    }

    if (conflictCount > 0) {
      summary += `, ${conflictCount} ${conflictCount === 1 ? 'conflict' : 'conflicts'}`;
    }

    return summary;
  }, [aircraft.length, safetyEvents, conflicts]);

  if (!enabled) return null;

  return (
    <>
      {/* Polite announcements - for general updates */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {politeAnnouncement}
      </div>

      {/* Assertive announcements - for emergencies */}
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      >
        {assertiveAnnouncement}
      </div>

      {/* Status region - updated periodically */}
      <div
        role="status"
        aria-label="Radar status"
        className="sr-only"
      >
        {statusSummary}
      </div>
    </>
  );
}

export default ScreenReaderAnnouncements;
