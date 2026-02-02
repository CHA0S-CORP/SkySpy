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
  overlays,
  apiBaseUrl = ''
) {
  const [aviationData, setAviationData] = useState({
    navaids: [],
    airports: [],
    airspace: [], // Static boundaries (Class B/C/D, MOAs)
    airspaceAdvisories: [], // Active G-AIRMETs
    metars: [],
    pireps: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const lastFetchRef = useRef(0);
  const fetchAviationDataRef = useRef(null);

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

      // NAVAIDs
      promises.push(
        makeRequest(
          'navaids',
          { ...baseParams, radius: Math.round(radarRange * 1.5) },
          AVIATION_TIMEOUT
        )
          .then((data) => ({ type: 'navaids', data: extractData(data) }))
          .catch((err) => ({ type: 'navaids', error: err.message }))
      );

      // Airports
      promises.push(
        makeRequest(
          'airports',
          { ...baseParams, radius: Math.round(radarRange * 1.2), limit: 50 },
          AVIATION_TIMEOUT
        )
          .then((data) => ({ type: 'airports', data: extractData(data).map(normalizeAirport) }))
          .catch((err) => ({ type: 'airports', error: err.message }))
      );

      // Airspace boundaries (static) - from database
      promises.push(
        makeRequest('airspace-boundaries', { ...baseParams, radius: Math.round(radarRange * 1.5) })
          .then((data) => ({ type: 'airspace', data: extractData(data) }))
          .catch((err) => ({ type: 'airspace', error: err.message }))
      );

      // Airspace advisories (G-AIRMETs) - from database
      promises.push(
        makeRequest('airspaces', baseParams)
          .then((data) => ({
            type: 'airspaceAdvisories',
            data: data?.advisories || extractData(data),
          }))
          .catch((err) => ({ type: 'airspaceAdvisories', error: err.message }))
      );

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

      // Check for errors
      const errors = results.filter((r) => r.error);
      if (errors.length > 0) {
        console.warn('Some aviation data requests failed:', errors);
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
    overlays?.metars,
    overlays?.pireps,
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

    // Fetch with small delay after connection
    const timeout = setTimeout(() => {
      fetchAviationData();
    }, 500);
    return () => clearTimeout(timeout);
  }, [wsConnected, wsRequest, feederLat, feederLon, radarRange, fetchAviationData]);

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
