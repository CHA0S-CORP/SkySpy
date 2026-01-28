import { useState, useEffect, useCallback, useRef } from 'react';

// Helper to safely parse JSON from fetch response
const safeJson = async (res) => {
  if (!res.ok) return null;
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) return null;
  try { return await res.json(); } catch { return null; }
};

/**
 * Hook for fetching aviation data via WebSocket requests with HTTP fallback
 * Uses WebSocket when connected, falls back to HTTP API when not
 *
 * @param {Function} wsRequest - WebSocket request function from useChannelsSocket
 * @param {boolean} wsConnected - Whether WebSocket is connected
 * @param {number} feederLat - Feeder latitude
 * @param {number} feederLon - Feeder longitude
 * @param {number} radarRange - Radar range in nm
 * @param {object} overlays - Which overlays are enabled
 * @param {string} apiBaseUrl - API base URL for HTTP fallback
 */
export function useAviationData(wsRequest, wsConnected, feederLat, feederLon, radarRange, overlays, apiBaseUrl = '') {
  const [aviationData, setAviationData] = useState({
    navaids: [],
    airports: [],
    airspace: [],           // Static boundaries (Class B/C/D, MOAs)
    airspaceAdvisories: [], // Active G-AIRMETs
    metars: [],
    pireps: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const lastFetchRef = useRef(0);

  // Helper to normalize airport fields
  const normalizeAirport = useCallback((apt) => ({
    ...apt,
    icao: apt.icao || apt.icaoId || apt.faaId || apt.id || 'UNK',
    id: apt.id || apt.icaoId || apt.faaId || 'UNK',
    name: apt.name || apt.site || null,
    city: apt.city || apt.assocCity || null,
    state: apt.state || apt.stateProv || null,
    elev: apt.elev ?? apt.elev_ft ?? apt.elevation ?? null,
    class: apt.class || apt.airspaceClass || null,
  }), []);

  // Extract data from various response formats
  const extractData = useCallback((response) => {
    if (!response) return [];
    if (Array.isArray(response)) return response;
    if (response.data && Array.isArray(response.data)) return response.data;
    if (response.features) {
      // GeoJSON FeatureCollection
      return response.features.map(f => ({
        ...f.properties,
        lat: f.geometry?.coordinates?.[1],
        lon: f.geometry?.coordinates?.[0]
      }));
    }
    return [];
  }, []);

  // HTTP fallback helper for aviation data endpoints
  const fetchHttp = useCallback(async (endpoint, params = {}) => {
    const queryParams = new URLSearchParams(params);
    const url = `${apiBaseUrl}/api/v1/aviation/${endpoint}?${queryParams}`;
    const res = await fetch(url);
    const data = await safeJson(res);
    if (!data) throw new Error(`HTTP ${res.status}`);
    return data;
  }, [apiBaseUrl]);

  // Fetch all aviation data via WebSocket with HTTP fallback
  const fetchAviationData = useCallback(async () => {
    if (!feederLat || !feederLon) return;

    // Debounce - don't fetch more than once per 5 seconds
    const now = Date.now();
    if (now - lastFetchRef.current < 5000) return;
    lastFetchRef.current = now;

    setLoading(true);
    setError(null);

    const baseParams = { lat: feederLat, lon: feederLon };

    // Helper to make request - use WebSocket if connected, else HTTP
    const makeRequest = async (wsType, httpEndpoint, params, timeout = 10000) => {
      if (wsRequest && wsConnected) {
        return wsRequest(wsType, params, timeout);
      }
      return fetchHttp(httpEndpoint, params);
    };

    try {
      // Fetch all data in parallel using WebSocket requests with HTTP fallback
      // Use longer timeout (20s) for external API calls to aviationweather.gov
      const AVIATION_TIMEOUT = 20000;
      const promises = [];

      // NAVAIDs
      promises.push(
        makeRequest('navaids', 'navaids', { ...baseParams, radius: Math.round(radarRange * 1.5) }, AVIATION_TIMEOUT)
          .then(data => ({ type: 'navaids', data: extractData(data) }))
          .catch(err => ({ type: 'navaids', error: err.message }))
      );

      // Airports
      promises.push(
        makeRequest('airports', 'airports', { ...baseParams, radius: Math.round(radarRange * 1.2), limit: 50 }, AVIATION_TIMEOUT)
          .then(data => ({ type: 'airports', data: extractData(data).map(normalizeAirport) }))
          .catch(err => ({ type: 'airports', error: err.message }))
      );

      // Airspace boundaries (static) - from database, shorter timeout OK
      promises.push(
        makeRequest('airspace-boundaries', 'airspace-boundaries', { ...baseParams, radius: Math.round(radarRange * 1.5) })
          .then(data => ({ type: 'airspace', data: extractData(data) }))
          .catch(err => ({ type: 'airspace', error: err.message }))
      );

      // Airspace advisories (G-AIRMETs) - from database, shorter timeout OK
      promises.push(
        makeRequest('airspaces', 'airspaces', baseParams)
          .then(data => ({ type: 'airspaceAdvisories', data: data?.advisories || extractData(data) }))
          .catch(err => ({ type: 'airspaceAdvisories', error: err.message }))
      );

      // METARs (only if overlay enabled)
      if (overlays?.metars) {
        promises.push(
          makeRequest('metars', 'metars', { ...baseParams, radius: Math.round(radarRange) }, AVIATION_TIMEOUT)
            .then(data => ({ type: 'metars', data: extractData(data) }))
            .catch(err => ({ type: 'metars', error: err.message }))
        );
      }

      // PIREPs (only if overlay enabled)
      if (overlays?.pireps) {
        promises.push(
          makeRequest('pireps', 'pireps', { ...baseParams, radius: Math.round(radarRange * 1.5), hours: 3 }, AVIATION_TIMEOUT)
            .then(data => ({ type: 'pireps', data: extractData(data) }))
            .catch(err => ({ type: 'pireps', error: err.message }))
        );
      }

      // Wait for all requests
      const results = await Promise.all(promises);

      // Update state with results
      setAviationData(prev => {
        const updated = { ...prev };
        results.forEach(result => {
          if (!result.error && result.data) {
            updated[result.type] = result.data;
          }
        });
        return updated;
      });

      // Check for errors
      const errors = results.filter(r => r.error);
      if (errors.length > 0) {
        console.warn('Some aviation data requests failed:', errors);
      }
    } catch (err) {
      console.error('Aviation data fetch error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [wsRequest, wsConnected, apiBaseUrl, feederLat, feederLon, radarRange, overlays?.metars, overlays?.pireps, extractData, normalizeAirport, fetchHttp]);

  // Fetch when WebSocket connects or location changes, or on mount (for HTTP fallback)
  // Add a small delay after connection to ensure server is ready
  useEffect(() => {
    // Fetch on mount with small delay (works for both WebSocket and HTTP)
    const timeout = setTimeout(() => {
      fetchAviationData();
    }, wsConnected ? 500 : 100);
    return () => clearTimeout(timeout);
  }, [wsConnected, feederLat, feederLon, radarRange, fetchAviationData]);

  // Refresh weather data periodically (every 5 minutes)
  useEffect(() => {
    const interval = setInterval(() => {
      fetchAviationData();
    }, 300000); // 5 minutes

    return () => clearInterval(interval);
  }, [fetchAviationData]);

  // Fetch single METAR for a station (with HTTP fallback)
  const fetchMetar = useCallback(async (station) => {
    try {
      if (wsRequest && wsConnected) {
        return await wsRequest('metar', { station });
      }
      // HTTP fallback
      const res = await fetch(`${apiBaseUrl}/api/v1/aviation/metar/${encodeURIComponent(station)}`);
      return await safeJson(res);
    } catch (err) {
      console.error('METAR fetch error:', err);
      return null;
    }
  }, [wsRequest, wsConnected, apiBaseUrl]);

  // Fetch TAF for a station (with HTTP fallback)
  const fetchTaf = useCallback(async (station) => {
    try {
      if (wsRequest && wsConnected) {
        return await wsRequest('taf', { station });
      }
      // HTTP fallback
      const res = await fetch(`${apiBaseUrl}/api/v1/aviation/taf/${encodeURIComponent(station)}`);
      return await safeJson(res);
    } catch (err) {
      console.error('TAF fetch error:', err);
      return null;
    }
  }, [wsRequest, wsConnected, apiBaseUrl]);

  // Fetch aircraft info by ICAO (with HTTP fallback)
  const fetchAircraftInfo = useCallback(async (icao) => {
    try {
      if (wsRequest && wsConnected) {
        return await wsRequest('aircraft-info', { icao });
      }
      // HTTP fallback
      const res = await fetch(`${apiBaseUrl}/api/v1/aircraft/${encodeURIComponent(icao)}/info`);
      return await safeJson(res);
    } catch (err) {
      console.error('Aircraft info fetch error:', err);
      return null;
    }
  }, [wsRequest, wsConnected, apiBaseUrl]);

  return {
    aviationData,
    loading,
    error,
    refresh: fetchAviationData,
    // Individual data fetchers
    fetchMetar,
    fetchTaf,
    fetchAircraftInfo,
  };
}

export default useAviationData;
