/**
 * useCannonballAPI - Hook for Cannonball Mode backend integration
 *
 * Provides:
 * - Socket.IO connection for real-time threat updates
 * - REST API calls for session management
 * - Location update sending
 * - Pattern/alert fetching
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useSocketIOCannonball } from './socket';
import { safeFetchJson } from '../utils/safeFetch';

// API endpoints
const CANNONBALL_ENDPOINTS = {
  threats: '/api/v1/cannonball/threats',
  location: '/api/v1/cannonball/location',
  activate: '/api/v1/cannonball/activate',
  sessions: '/api/v1/cannonball/sessions/',
  patterns: '/api/v1/cannonball/patterns/',
  alerts: '/api/v1/cannonball/alerts/',
  knownAircraft: '/api/v1/cannonball/known-aircraft/',
  stats: '/api/v1/cannonball/stats/',
};

// Network timeout for API calls (ms)
const API_TIMEOUT_MS = 15000;

/**
 * Send a POST request with JSON body
 */
async function postJson(url, data, apiBase = '', timeout = API_TIMEOUT_MS) {
  return safeFetchJson(`${apiBase}${url}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
    timeout,
  });
}

/**
 * Send a DELETE request
 */
async function deleteRequest(url, apiBase = '', timeout = API_TIMEOUT_MS) {
  return safeFetchJson(`${apiBase}${url}`, {
    method: 'DELETE',
    timeout,
  });
}

/**
 * Cannonball API hook
 *
 * @param {Object} options - Configuration options
 * @param {string} options.apiBase - API base URL
 * @param {boolean} options.enabled - Whether to enable the connection
 * @param {boolean} options.useSocketIO - Use Socket.IO for real-time updates (default: true)
 * @param {number} options.pollingInterval - Fallback polling interval in ms (default: 5000)
 * @param {number} options.threatRadius - Maximum threat radius in NM (default: 25)
 * @returns {Object} API state and methods
 */
export function useCannonballAPI({
  apiBase = '',
  enabled = true,
  useSocketIO = true,
  pollingInterval = 5000,
  threatRadius = 25,
} = {}) {
  // Pattern and session data (fetched on demand)
  const [sessions, setSessions] = useState([]);
  const [patterns, setPatterns] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [stats, setStats] = useState(null);

  // Refs
  const pollingIntervalRef = useRef(null);
  const userPositionRef = useRef(null);

  // Use Socket.IO hook for real-time threat updates
  const {
    threats,
    threatCount,
    connected,
    sessionId,
    error,
    lastUpdate,
    updatePosition: socketUpdatePosition,
    setThreatRadius: socketSetThreatRadius,
    requestThreats: socketRequestThreats,
    reconnect,
  } = useSocketIOCannonball({
    enabled: enabled && useSocketIO,
    apiBase,
    threatRadius,
  });

  // Clean up function for polling
  const cleanup = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  // Fetch threats via REST API (fallback when not using Socket.IO)
  const fetchThreats = useCallback(async () => {
    const params = new URLSearchParams();
    if (threatRadius) {
      params.append('max_range', threatRadius);
    }

    const url = `${CANNONBALL_ENDPOINTS.threats}?${params}`;
    const { data, ok } = await safeFetchJson(`${apiBase}${url}`, {
      timeout: API_TIMEOUT_MS,
    });

    return ok ? data : null;
  }, [apiBase, threatRadius]);

  // Send location update - prefer Socket.IO, fallback to REST
  const updateLocation = useCallback(async (lat, lon, heading = null, speed = null) => {
    userPositionRef.current = { lat, lon };

    // If Socket.IO is connected, use it
    if (connected && useSocketIO) {
      return socketUpdatePosition(lat, lon, heading, speed);
    }

    // Otherwise, send via REST API
    const { ok, error: postError } = await postJson(
      CANNONBALL_ENDPOINTS.location,
      { lat, lon, heading, speed },
      apiBase
    );

    return { ok, error: postError };
  }, [apiBase, connected, useSocketIO, socketUpdatePosition]);

  // Activate Cannonball mode via REST API
  const activate = useCallback(async () => {
    const { data, error: postError, ok } = await postJson(
      CANNONBALL_ENDPOINTS.activate,
      {},
      apiBase
    );

    return { ok, data, error: postError };
  }, [apiBase]);

  // Deactivate Cannonball mode via REST API
  const deactivate = useCallback(async () => {
    const { ok, error: deleteError } = await deleteRequest(
      CANNONBALL_ENDPOINTS.activate,
      apiBase
    );

    return { ok, error: deleteError };
  }, [apiBase]);

  // Set threat radius - prefer Socket.IO
  const setThreatRadius = useCallback((radius) => {
    if (connected && useSocketIO) {
      socketSetThreatRadius(radius);
    }
  }, [connected, useSocketIO, socketSetThreatRadius]);

  // Request current threats - prefer Socket.IO, fallback to REST
  const requestThreats = useCallback(() => {
    if (connected && useSocketIO) {
      socketRequestThreats();
    } else {
      fetchThreats();
    }
  }, [connected, useSocketIO, socketRequestThreats, fetchThreats]);

  // Fetch sessions from API
  const fetchSessions = useCallback(async (activeOnly = true) => {
    const params = new URLSearchParams();
    if (activeOnly) {
      params.append('active_only', 'true');
    }

    const { data, ok } = await safeFetchJson(
      `${apiBase}${CANNONBALL_ENDPOINTS.sessions}?${params}`,
      { timeout: API_TIMEOUT_MS }
    );

    if (ok && data) {
      setSessions(data.sessions || []);
    }

    return data;
  }, [apiBase]);

  // Fetch patterns from API
  const fetchPatterns = useCallback(async (hours = 24) => {
    const params = new URLSearchParams({ hours: hours.toString() });

    const { data, ok } = await safeFetchJson(
      `${apiBase}${CANNONBALL_ENDPOINTS.patterns}?${params}`,
      { timeout: API_TIMEOUT_MS }
    );

    if (ok && data) {
      setPatterns(data.patterns || []);
    }

    return data;
  }, [apiBase]);

  // Fetch alerts from API
  const fetchAlerts = useCallback(async (unacknowledgedOnly = false) => {
    const params = new URLSearchParams();
    if (unacknowledgedOnly) {
      params.append('unacknowledged', 'true');
    }

    const { data, ok } = await safeFetchJson(
      `${apiBase}${CANNONBALL_ENDPOINTS.alerts}?${params}`,
      { timeout: API_TIMEOUT_MS }
    );

    if (ok && data) {
      setAlerts(data.alerts || []);
    }

    return data;
  }, [apiBase]);

  // Acknowledge an alert
  const acknowledgeAlert = useCallback(async (alertId) => {
    const { ok } = await postJson(
      `${CANNONBALL_ENDPOINTS.alerts}${alertId}/acknowledge/`,
      {},
      apiBase
    );

    if (ok) {
      setAlerts(prev => prev.map(a =>
        a.id === alertId ? { ...a, acknowledged: true } : a
      ));
    }

    return { ok };
  }, [apiBase]);

  // Acknowledge all alerts
  const acknowledgeAllAlerts = useCallback(async () => {
    const { ok } = await postJson(
      `${CANNONBALL_ENDPOINTS.alerts}acknowledge-all/`,
      {},
      apiBase
    );

    if (ok) {
      setAlerts(prev => prev.map(a => ({ ...a, acknowledged: true })));
    }

    return { ok };
  }, [apiBase]);

  // Fetch stats from API
  const fetchStats = useCallback(async () => {
    const { data, ok } = await safeFetchJson(
      `${apiBase}${CANNONBALL_ENDPOINTS.stats}summary/`,
      { timeout: API_TIMEOUT_MS }
    );

    if (ok && data) {
      setStats(data);
    }

    return data;
  }, [apiBase]);

  // Check if ICAO is known LE aircraft
  const checkKnownAircraft = useCallback(async (icaoHex) => {
    const { data, ok } = await safeFetchJson(
      `${apiBase}${CANNONBALL_ENDPOINTS.knownAircraft}check/${icaoHex}/`,
      { timeout: API_TIMEOUT_MS }
    );

    return ok ? data : null;
  }, [apiBase]);

  // Polling fallback when Socket.IO is disabled
  useEffect(() => {
    if (!enabled || useSocketIO) {
      cleanup();
      return;
    }

    // Use polling when Socket.IO is disabled
    fetchThreats();
    pollingIntervalRef.current = setInterval(fetchThreats, pollingInterval);

    return cleanup;
  }, [enabled, useSocketIO, pollingInterval, fetchThreats, cleanup]);

  // Activate session on mount
  useEffect(() => {
    if (enabled) {
      activate();
    }

    return () => {
      if (enabled) {
        deactivate();
      }
    };
  }, [enabled, activate, deactivate]);

  return {
    // Real-time threat data (from Socket.IO hook)
    threats,
    threatCount,
    connected,
    sessionId,
    error,
    lastUpdate,

    // Fetched data (from REST API)
    sessions,
    patterns,
    alerts,
    stats,

    // Methods
    updateLocation,
    setThreatRadius,
    requestThreats,
    fetchThreats,
    fetchSessions,
    fetchPatterns,
    fetchAlerts,
    fetchStats,
    acknowledgeAlert,
    acknowledgeAllAlerts,
    checkKnownAircraft,
    activate,
    deactivate,
    reconnect,
  };
}

export default useCannonballAPI;
