import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Hook for fetching aviation data via Socket.IO requests (no HTTP fallback)
 * Uses Socket.IO when connected, throws error when not
 *
 * @param {Function} wsRequest - Request function from useSocketIOData
 * @param {boolean} wsConnected - Whether Socket.IO is connected
 * @param {number} feederLat - Feeder latitude
 * @param {number} feederLon - Feeder longitude
 * @param {number} radarRange - Radar range in nm
 * @param {object} overlays - Which overlays are enabled
 * @param {string} apiBaseUrl - API base URL (unused, kept for compatibility)
 */
export function useAviationData(
  wsRequest,
  wsConnected,
  feederLat,
  feederLon,
  radarRange,
  overlays
) {
  const [aviationData, setAviationData] = useState({
    navaids: [],
    airports: [],
    airspace: [], // Static boundaries (Class B/C/D, MOAs)
    airspaceAdvisories: [], // Active G-AIRMETs
    metars: [],
    pireps: [],
    wildfires: [], // Watch Duty active fires
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const lastFetchRef = useRef(0);
  const fetchAviationDataRef = useRef(null);
  const gotDataRef = useRef(false);

  // Helper to normalize airport fields
  const normalizeAirport = useCallback(
    (apt) => ({
      ...apt,
      icao: apt.icao || apt.icaoId || apt.faaId || apt.id || 'UNK',
      id: apt.id || apt.icaoId || apt.faaId || 'UNK',
      name: apt.name || apt.site || null,
      city: apt.city || apt.assocCity || null,
      state: apt.state || apt.stateProv || null,
      elev: apt.elev ?? apt.elev_ft ?? apt.elevation ?? null,
      class: apt.class || apt.airspaceClass || null,
    }),
    []
  );

  // Extract data from various response formats
  const extractData = useCallback((response) => {
    if (!response) return [];
    if (Array.isArray(response)) return response;
    if (response.data && Array.isArray(response.data)) return response.data;
    if (response.features) {
      // GeoJSON FeatureCollection
      return response.features.map((f) => ({
        ...f.properties,
        lat: f.geometry?.coordinates?.[1],
        lon: f.geometry?.coordinates?.[0],
      }));
    }
    return [];
  }, []);

  // Fetch all aviation data via WebSocket
  const fetchAviationData = useCallback(async () => {
    if (!feederLat || !feederLon) return;

    // Check socket connection
    if (!wsRequest || !wsConnected) {
      setError('Socket not connected');
      setLoading(false);
      return;
    }

    // Debounce - don't fetch more than once per 5 seconds
    const now = Date.now();
    if (now - lastFetchRef.current < 5000) return;
    lastFetchRef.current = now;

    setLoading(true);
    setError(null);

    const baseParams = { lat: feederLat, lon: feederLon };

    // Helper to make WebSocket request
    const makeRequest = async (wsType, params, timeout = 20000) => {
      return wsRequest(wsType, params, timeout);
    };

    try {
      // Fetch all data in parallel using WebSocket requests
      const AVIATION_TIMEOUT = 20000;
      const promises = [];

      // NAVAIDs (only if overlay enabled)
      if (overlays?.navaids) {
        promises.push(
          makeRequest(
            'navaids',
            { ...baseParams, radius: Math.round(radarRange * 1.5) },
            AVIATION_TIMEOUT
          )
            .then((data) => ({ type: 'navaids', data: extractData(data) }))
            .catch((err) => ({ type: 'navaids', error: err.message }))
        );
      }

      // Airports (only if overlay enabled)
      if (overlays?.airports) {
        promises.push(
          makeRequest(
            'airports',
            { ...baseParams, radius: Math.round(radarRange * 1.2), limit: 50 },
            AVIATION_TIMEOUT
          )
            .then((data) => ({ type: 'airports', data: extractData(data).map(normalizeAirport) }))
            .catch((err) => ({ type: 'airports', error: err.message }))
        );
      }

      // Airspace boundaries + advisories (only if overlay enabled). The boundary
      // payload is large (full polygons); fetching it unconditionally on every
      // connect chokes the socket transport, so gate it behind the overlay flag.
      if (overlays?.airspace) {
        promises.push(
          makeRequest('airspace-boundaries', { ...baseParams, radius: Math.round(radarRange) })
            .then((data) => ({ type: 'airspace', data: extractData(data) }))
            .catch((err) => ({ type: 'airspace', error: err.message }))
        );
      }
      // G-AIRMET/AIRMET advisories feed both the airspace layer and the dedicated
      // AIRMETs layer, so fetch them when either is enabled.
      if (overlays?.airspace || overlays?.airmets) {
        promises.push(
          makeRequest('airspaces', baseParams)
            .then((data) => ({
              type: 'airspaceAdvisories',
              data: data?.advisories || extractData(data),
            }))
            .catch((err) => ({ type: 'airspaceAdvisories', error: err.message }))
        );
      }

      // METARs (only if overlay enabled)
      if (overlays?.metars) {
        promises.push(
          makeRequest('metars', { ...baseParams, radius: Math.round(radarRange) }, AVIATION_TIMEOUT)
            .then((data) => ({ type: 'metars', data: extractData(data) }))
            .catch((err) => ({ type: 'metars', error: err.message }))
        );
      }

      // PIREPs (only if overlay enabled)
      if (overlays?.pireps) {
        promises.push(
          makeRequest(
            'pireps',
            { ...baseParams, radius: Math.round(radarRange * 1.5), hours: 3 },
            AVIATION_TIMEOUT
          )
            .then((data) => ({ type: 'pireps', data: extractData(data) }))
            .catch((err) => ({ type: 'pireps', error: err.message }))
        );
      }

      // Wildfires (only if overlay enabled) — cached Watch Duty markers. Fires are
      // sparse and spread over hundreds of nm (unlike dense-local airports/navaids),
      // so use a generous floor instead of the tight radar range or the layer looks
      // empty when zoomed in. Capped at 500nm to match the backend cache fill.
      if (overlays?.wildfires) {
        const fireRadius = Math.min(500, Math.max(250, Math.round(radarRange * 1.5)));
        promises.push(
          makeRequest('wildfires', { ...baseParams, radius: fireRadius }, AVIATION_TIMEOUT)
            .then((data) => ({ type: 'wildfires', data: extractData(data) }))
            .catch((err) => ({ type: 'wildfires', error: err.message }))
        );
      }

      // Wait for all requests
      const results = await Promise.all(promises);

      // Update state with results
      setAviationData((prev) => {
        const updated = { ...prev };
        results.forEach((result) => {
          if (!result.error && result.data) {
            updated[result.type] = result.data;
          }
        });
        return updated;
      });

      // Mark success once the fetch completes with at least one non-error
      // result (stops the startup retry loop). Using non-error rather than
      // non-empty so legitimately-empty layers (no navaids/airspace in range)
      // don't keep the retry loop hammering the socket.
      if (results.some((r) => !r.error)) {
        gotDataRef.current = true;
      }

      // Check for errors
      const errors = results.filter((r) => r.error);
      if (errors.length > 0) {
        console.warn('Some aviation data requests failed:', errors);
        // A transient disconnect (e.g. reconnect, StrictMode remount) rejects the
        // in-flight requests. Clear the debounce so the next connect refetches
        // immediately instead of blackholing aviation data until the 5-min timer.
        if (errors.some((e) => /disconnect/i.test(e.error || ''))) {
          lastFetchRef.current = 0;
        }
      }
    } catch (err) {
      console.error('Aviation data fetch error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [
    wsRequest,
    wsConnected,
    feederLat,
    feederLon,
    radarRange,
    overlays?.navaids,
    overlays?.airports,
    overlays?.airspace,
    overlays?.airmets,
    overlays?.metars,
    overlays?.pireps,
    overlays?.wildfires,
    extractData,
    normalizeAirport,
  ]);

  // Keep ref updated with latest fetchAviationData
  fetchAviationDataRef.current = fetchAviationData;

  // Fetch when WebSocket connects or location changes
  useEffect(() => {
    if (!wsConnected || !wsRequest) {
      return;
    }

    // Fetch with small delay after connection. This effect also re-runs when
    // an overlay is toggled (fetchAviationData identity changes) - reset the
    // debounce window so the toggle isn't silently dropped when another fetch
    // ran within the last 5s (the layer would stay empty for 5 minutes).
    gotDataRef.current = false;
    lastFetchRef.current = 0;
    const timeout = setTimeout(() => {
      fetchAviationData();
    }, 500);
    return () => clearTimeout(timeout);
  }, [wsConnected, wsRequest, feederLat, feederLon, radarRange, fetchAviationData]);

  // Bounded startup retry: the socket transport can flap during startup
  // (StrictMode remount / WS upgrade → polling fallback) and reject the one-shot
  // fetch while `wsConnected` stays true, which would otherwise blackhole
  // aviation data until the 5-min refresh. Retry a few times until data lands.
  useEffect(() => {
    if (!wsConnected || !wsRequest) return undefined;
    let tries = 0;
    const id = setInterval(() => {
      tries += 1;
      if (gotDataRef.current || tries > 3) {
        clearInterval(id);
        return;
      }
      lastFetchRef.current = 0; // bypass debounce
      fetchAviationDataRef.current?.();
    }, 6000);
    return () => clearInterval(id);
  }, [wsConnected, wsRequest, feederLat, feederLon]);

  // Refresh weather data periodically (every 5 minutes)
  // Use ref to avoid resetting interval when fetchAviationData changes
  useEffect(() => {
    if (!wsConnected || !wsRequest) {
      return;
    }

    const interval = setInterval(() => {
      fetchAviationDataRef.current?.();
    }, 300000); // 5 minutes

    return () => clearInterval(interval);
  }, [wsConnected, wsRequest]);

  // Fetch single METAR for a station
  const fetchMetar = useCallback(
    async (station) => {
      if (!wsRequest || !wsConnected) {
        console.error('Socket not connected');
        return null;
      }

      try {
        return await wsRequest('metar', { station });
      } catch (err) {
        console.error('METAR fetch error:', err);
        return null;
      }
    },
    [wsRequest, wsConnected]
  );

  // Fetch TAF for a station
  const fetchTaf = useCallback(
    async (station) => {
      if (!wsRequest || !wsConnected) {
        console.error('Socket not connected');
        return null;
      }

      try {
        return await wsRequest('taf', { station });
      } catch (err) {
        console.error('TAF fetch error:', err);
        return null;
      }
    },
    [wsRequest, wsConnected]
  );

  // Fetch aircraft info by ICAO
  const fetchAircraftInfo = useCallback(
    async (icao) => {
      if (!wsRequest || !wsConnected) {
        console.error('Socket not connected');
        return null;
      }

      try {
        return await wsRequest('aircraft-info', { icao });
      } catch (err) {
        console.error('Aircraft info fetch error:', err);
        return null;
      }
    },
    [wsRequest, wsConnected]
  );

  return {
    aviationData,
    loading,
    error,
    connected: wsConnected,
    refresh: fetchAviationData,
    // Individual data fetchers
    fetchMetar,
    fetchTaf,
    fetchAircraftInfo,
  };
}

export default useAviationData;
