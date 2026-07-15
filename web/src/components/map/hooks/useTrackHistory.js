import { useEffect, useRef } from 'react';

// Helper to safely parse JSON from fetch response
const safeJson = async (res) => {
  if (!res.ok) return null;
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
};

/**
 * Custom hook for managing aircraft track history.
 *
 * Handles two concerns:
 * 1. Accumulating real-time position data into trackHistory (and shortTrackHistory)
 *    by iterating through aircraft on each render and saving lat/lon/alt/time per hex.
 * 2. Fetching historical short track data from the API on an interval and merging
 *    it with real-time positions.
 *
 * The hook modifies state exclusively via the setters passed in; it returns nothing.
 */
export function useTrackHistory({
  sortedAircraft,
  trackHistory,
  setTrackHistory,
  shortTrackHistory,
  setShortTrackHistory,
  showShortTracks,
  config,
  feederLat,
  feederLon,
  radarRange,
  shortTrackFetchedRef,
  positionsRef,
  mapRef,
  selectedAircraft,
  wsRequest,
  wsConnected,
}) {
  // Track aircraft position history for trails and profile charts
  // Faster updates for smoother trails
  useEffect(() => {
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes of history

    setTrackHistory((prev) => {
      const updated = { ...prev };

      // Add new positions for each aircraft
      sortedAircraft.forEach((ac) => {
        if (ac.lat && ac.lon && ac.hex) {
          if (!updated[ac.hex]) {
            updated[ac.hex] = [];
          }

          // Calculate distance from feeder
          const dLat = ac.lat - feederLat;
          const dLon = ac.lon - feederLon;
          const latNm = dLat * 60;
          const lonNm = dLon * 60 * Math.cos((feederLat * Math.PI) / 180);
          const dist = Math.sqrt(latNm * latNm + lonNm * lonNm);

          // Only add if position has changed significantly or enough time has passed
          // Reduced from 3s to 1s for faster updates, and tighter position threshold
          const lastPos = updated[ac.hex][updated[ac.hex].length - 1];
          const positionChanged =
            !lastPos ||
            Math.abs(lastPos.lat - ac.lat) > 0.0005 || // ~50m
            Math.abs(lastPos.lon - ac.lon) > 0.0005;
          const timeElapsed = !lastPos || now - lastPos.time > 1000; // 1 second minimum

          if (positionChanged && timeElapsed) {
            updated[ac.hex].push({
              lat: ac.lat,
              lon: ac.lon,
              alt: ac.alt_baro || ac.alt_geom || ac.alt,
              spd: ac.gs || ac.tas || ac.ias,
              vs: ac.vr ?? ac.baro_rate ?? ac.geom_rate ?? 0,
              trk: ac.track || ac.true_heading || ac.mag_heading,
              dist: dist,
              time: now,
            });
          }

          // Remove old positions
          updated[ac.hex] = updated[ac.hex].filter((p) => now - p.time < maxAge);
        }
      });

      // Bug fix #2: Improved cleanup logic for position history
      // Clean up aircraft that are no longer present more promptly
      const activeHexes = new Set(sortedAircraft.map((ac) => ac.hex));
      Object.keys(updated).forEach((hex) => {
        if (!activeHexes.has(hex)) {
          // Remove entries for aircraft gone for more than 30 seconds (reduced from 60s)
          // Also remove if the entry has no positions or all positions are stale
          if (
            updated[hex].length === 0 ||
            now - updated[hex][updated[hex].length - 1].time > 30000
          ) {
            delete updated[hex];
          }
        }
      });

      return updated;
    });

    // Also update short track history with real-time positions (when enabled)
    // This ensures smooth continuous trails between API refreshes
    if (showShortTracks) {
      setShortTrackHistory((prev) => {
        let hasChanges = false;
        const updated = { ...prev };

        sortedAircraft.forEach((ac) => {
          if (ac.lat && ac.lon && ac.hex) {
            // Bug fix #4: Initialize short track history for new aircraft
            // Previously only updated if entry already existed, new aircraft never got initialized
            if (!updated[ac.hex]) {
              updated[ac.hex] = [{ lat: ac.lat, lon: ac.lon, time: now }];
              hasChanges = true;
              return; // Skip to next aircraft after initialization
            }

            const existing = updated[ac.hex];
            const lastPos = existing[existing.length - 1];

            // Only add if position changed and time elapsed
            const positionChanged =
              !lastPos ||
              Math.abs(lastPos.lat - ac.lat) > 0.0003 ||
              Math.abs(lastPos.lon - ac.lon) > 0.0003;
            const timeElapsed = !lastPos || now - lastPos.time > 1500; // 1.5 second minimum

            if (positionChanged && timeElapsed) {
              updated[ac.hex] = [...existing, { lat: ac.lat, lon: ac.lon, time: now }].slice(-100);
              hasChanges = true;
            }
          }
        });

        return hasChanges ? updated : prev;
      });
    }
  }, [sortedAircraft, feederLat, feederLon, showShortTracks]);

  // Ref for aircraft list to avoid stale closures in interval
  const aircraftForShortTracksRef = useRef(sortedAircraft);
  useEffect(() => {
    aircraftForShortTracksRef.current = sortedAircraft;
  }, [sortedAircraft]);

  // Fetch historical positions for short tracks when enabled
  // Merges historical API data with real-time positions for complete trails
  // Uses an interval instead of re-running on aircraft changes to prevent API spam
  useEffect(() => {
    if (!showShortTracks) return;

    const baseUrl = config.apiBaseUrl || '';
    const REFRESH_INTERVAL = 60000; // Refresh historical data every 60 seconds to fill gaps
    const FETCH_INTERVAL = 2000; // Check for new aircraft to fetch every 2 seconds (reduced for lower latency)

    const fetchShortTracks = () => {
      const now = Date.now();
      const visibleAircraft = aircraftForShortTracksRef.current.filter(
        (ac) => ac.hex && ac.lat && ac.lon
      );

      // Prioritize aircraft: selected first, then near map center, then military
      let prioritized = visibleAircraft;
      if (mapRef.current) {
        try {
          const bounds = mapRef.current.getBounds();
          const center = mapRef.current.getCenter();

          // Only consider aircraft within the visible bounds
          prioritized = visibleAircraft
            .filter((ac) => bounds.contains([ac.lat, ac.lon]))
            .sort((a, b) => {
              // Selected aircraft first
              if (selectedAircraft?.hex === a.hex) return -1;
              if (selectedAircraft?.hex === b.hex) return 1;
              // Military second
              if (a.military && !b.military) return -1;
              if (!a.military && b.military) return 1;
              // Then by distance from center
              const distA = Math.hypot(a.lat - center.lat, a.lon - center.lng);
              const distB = Math.hypot(b.lat - center.lat, b.lon - center.lng);
              return distA - distB;
            });
        } catch (e) {
          // Map not ready
        }
      }

      // Fetch history for aircraft that need it:
      // - Never fetched before
      // - Last fetch was more than REFRESH_INTERVAL ago (to fill gaps)
      const toFetch = prioritized
        .filter((ac) => {
          const lastFetch = shortTrackFetchedRef.current.get(ac.hex);
          if (!lastFetch) return true; // Never fetched
          return now - lastFetch > REFRESH_INTERVAL; // Needs refresh
        })
        .slice(0, 6); // Fetch up to 6 at a time for faster initial loading

      if (toFetch.length > 0) {
        toFetch.forEach(async (ac) => {
          // Mark as "in progress" to prevent duplicate requests
          // Use a temporary marker that will be replaced on success or cleared on failure
          const inProgressMarker = now - REFRESH_INTERVAL + 5000; // Will retry in 5s on failure
          shortTrackFetchedRef.current.set(ac.hex, inProgressMarker);
          try {
            let data;
            // Use WebSocket when connected
            if (wsRequest && wsConnected) {
              const result = await wsRequest('sightings', {
                icao_hex: ac.hex,
                hours: 1,
                limit: 100,
              });
              if (result && (result.sightings || result.results)) {
                data = result;
              } else {
                // No data returned - mark for quick retry
                shortTrackFetchedRef.current.delete(ac.hex);
                return;
              }
            } else {
              // Django API uses /api/v1/sightings with query params (was /api/v1/history/sightings/{hex})
              const res = await fetch(
                `${baseUrl}/api/v1/sightings?icao_hex=${ac.hex}&hours=1&limit=100`
              );
              data = await safeJson(res);
              if (!data) {
                // Failed to parse - mark for quick retry
                shortTrackFetchedRef.current.delete(ac.hex);
                return;
              }
            }

            const sightings = data?.sightings || data?.results || [];
            if (sightings.length > 0) {
              // Success - mark as fully fetched
              shortTrackFetchedRef.current.set(ac.hex, Date.now());

              // Convert API data to our format
              const historicalPositions = sightings
                .map((s) => ({
                  lat: s.lat,
                  lon: s.lon,
                  time: new Date(s.timestamp).getTime(),
                }))
                .sort((a, b) => a.time - b.time); // Sort oldest to newest

              // Merge with existing positions
              setShortTrackHistory((prev) => {
                const existing = prev[ac.hex] || [];

                // Combine all positions
                const allPositions = [...historicalPositions];

                // Also preserve any existing positions not in the new data
                // (in case real-time captured something the API missed)
                existing.forEach((p) => {
                  const isDuplicate = allPositions.some(
                    (ap) =>
                      Math.abs(ap.time - p.time) < 2000 && // Within 2 seconds
                      Math.abs(ap.lat - p.lat) < 0.0001 &&
                      Math.abs(ap.lon - p.lon) < 0.0001
                  );
                  if (!isDuplicate) {
                    allPositions.push(p);
                  }
                });

                // Sort by time and keep last 100 positions for smooth trails
                const sorted = allPositions.sort((a, b) => a.time - b.time).slice(-100);

                return {
                  ...prev,
                  [ac.hex]: sorted,
                };
              });
            } else {
              // No sightings but successful response - still mark as fetched
              // (aircraft may not have history yet)
              shortTrackFetchedRef.current.set(ac.hex, Date.now());
            }
          } catch (e) {
            // Failed - allow retry sooner (clear the marker so it can be retried in 5s)
            shortTrackFetchedRef.current.delete(ac.hex);
            console.debug('Short track fetch failed:', ac.hex, e.message);
          }
        });
      }

      // Cleanup old entries when aircraft disappear
      const activeHexes = new Set(aircraftForShortTracksRef.current.map((a) => a.hex));
      setShortTrackHistory((prev) => {
        const hexesToRemove = Object.keys(prev).filter((hex) => !activeHexes.has(hex));
        if (hexesToRemove.length === 0) return prev;
        const updated = { ...prev };
        hexesToRemove.forEach((hex) => {
          delete updated[hex];
          shortTrackFetchedRef.current.delete(hex);
        });
        return updated;
      });
    };

    // Run once immediately, then on interval
    fetchShortTracks();
    const intervalId = setInterval(fetchShortTracks, FETCH_INTERVAL);

    return () => clearInterval(intervalId);
  }, [showShortTracks, config.apiBaseUrl, wsRequest, wsConnected, selectedAircraft?.hex]);
}
