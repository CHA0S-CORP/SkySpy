import { useState, useEffect, useCallback } from 'react';

/**
 * Hook for tracking aircraft position history for trails and profile charts
 * @param {Array} aircraft - Array of aircraft objects
 * @param {number} feederLat - Feeder latitude
 * @param {number} feederLon - Feeder longitude
 * @param {number} maxAge - Maximum age of history in milliseconds (default 5 minutes)
 */
export function useTrackHistory(aircraft, feederLat, feederLon, maxAge = 5 * 60 * 1000) {
  const [trackHistory, setTrackHistory] = useState({});

  // Calculate distance from feeder
  const getDistanceNm = useCallback(
    (lat, lon) => {
      const dLat = lat - feederLat;
      const dLon = lon - feederLon;
      const latNm = dLat * 60;
      const lonNm = dLon * 60 * Math.cos((feederLat * Math.PI) / 180);
      return Math.sqrt(latNm * latNm + lonNm * lonNm);
    },
    [feederLat, feederLon]
  );

  // Update track history when aircraft positions change
  useEffect(() => {
    const now = Date.now();

    setTrackHistory((prev) => {
      // Skip update if there's nothing to process
      if (aircraft.length === 0 && Object.keys(prev).length === 0) {
        return prev;
      }

      const updated = { ...prev };
      let changed = false;

      // Add new positions for each aircraft
      aircraft.forEach((ac) => {
        if (ac.lat && ac.lon && ac.hex) {
          if (!updated[ac.hex]) {
            updated[ac.hex] = [];
            changed = true;
          }

          // Calculate distance from feeder
          const dist = getDistanceNm(ac.lat, ac.lon);

          // Only add if position has changed or enough time has passed
          const lastPos = updated[ac.hex][updated[ac.hex].length - 1];
          if (
            !lastPos ||
            now - lastPos.time > 3000 || // At least 3 seconds between points
            Math.abs(lastPos.lat - ac.lat) > 0.001 ||
            Math.abs(lastPos.lon - ac.lon) > 0.001
          ) {
            updated[ac.hex].push({
              lat: ac.lat,
              lon: ac.lon,
              alt: ac.alt_baro || ac.alt_geom || ac.alt,
              spd: ac.gs || ac.tas || ac.ias,
              vs: ac.baro_rate || ac.geom_rate || 0,
              trk: ac.track || ac.true_heading || ac.mag_heading,
              dist: dist,
              time: now,
            });
            changed = true;
          }

          // Remove old positions
          const beforeLen = updated[ac.hex].length;
          updated[ac.hex] = updated[ac.hex].filter((p) => now - p.time < maxAge);
          if (updated[ac.hex].length !== beforeLen) changed = true;
        }
      });

      // Clean up aircraft that are no longer present
      const activeHexes = new Set(aircraft.map((ac) => ac.hex));
      Object.keys(updated).forEach((hex) => {
        if (!activeHexes.has(hex)) {
          // Keep for a bit after aircraft disappears, then remove
          if (updated[hex].length > 0 && now - updated[hex][updated[hex].length - 1].time > 60000) {
            delete updated[hex];
            changed = true;
          }
        }
      });

      // Return prev reference if nothing changed to avoid unnecessary re-renders
      return changed ? updated : prev;
    });
  }, [aircraft, getDistanceNm, maxAge]);

  // Get history for a specific aircraft
  const getHistory = useCallback(
    (hex) => {
      return trackHistory[hex] || [];
    },
    [trackHistory]
  );

  // Get all track histories
  const getAllHistory = useCallback(() => {
    return trackHistory;
  }, [trackHistory]);

  // Clear history for a specific aircraft
  const clearHistory = useCallback((hex) => {
    setTrackHistory((prev) => {
      const updated = { ...prev };
      delete updated[hex];
      return updated;
    });
  }, []);

  // Clear all history
  const clearAllHistory = useCallback(() => {
    setTrackHistory({});
  }, []);

  return {
    trackHistory,
    getHistory,
    getAllHistory,
    clearHistory,
    clearAllHistory,
    getDistanceNm,
  };
}

export default useTrackHistory;
