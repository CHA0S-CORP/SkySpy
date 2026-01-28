/**
 * useCannonballAPI - Hook for Cannonball Mode backend integration
 *
 * Provides:
 * - WebSocket connection for real-time threat updates
 * - REST API calls for session management
 * - Location update sending
 * - Pattern/alert fetching
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { getWebSocketUrl, getReconnectDelay, RECONNECT_CONFIG } from '../utils/websocket';
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
 * @param {boolean} options.useWebSocket - Use WebSocket for real-time updates (default: true)
 * @param {number} options.pollingInterval - Fallback polling interval in ms (default: 5000)
 * @param {number} options.threatRadius - Maximum threat radius in NM (default: 25)
 * @returns {Object} API state and methods
 */
export function useCannonballAPI({
  apiBase = '',
  enabled = true,
  useWebSocket = true,
  pollingInterval = 5000,
  threatRadius = 25,
} = {}) {
  // State
  const [threats, setThreats] = useState([]);
  const [threatCount, setThreatCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  // Pattern and session data (fetched on demand)
  const [sessions, setSessions] = useState([]);
  const [patterns, setPatterns] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [stats, setStats] = useState(null);

  // Refs
  const wsRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef(null);
  const pollingIntervalRef = useRef(null);
  const userPositionRef = useRef(null);

  // Clean up function
  const cleanup = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  // Fetch threats via REST API
  const fetchThreats = useCallback(async () => {
    const params = new URLSearchParams();
    if (threatRadius) {
      params.append('max_range', threatRadius);
    }

    const url = `${CANNONBALL_ENDPOINTS.threats}?${params}`;
    const { data, error: fetchError, ok } = await safeFetchJson(`${apiBase}${url}`, {
      timeout: API_TIMEOUT_MS,
    });

    if (ok && data) {
      setThreats(data.threats || []);
      setThreatCount(data.count || 0);
      setLastUpdate(data.timestamp || new Date().toISOString());
      setConnected(true);
      setError(null);
    } else if (fetchError) {
      setError(fetchError);
    }

    return data;
  }, [apiBase, threatRadius]);

  // Send location update
  const updateLocation = useCallback(async (lat, lon, heading = null, speed = null) => {
    userPositionRef.current = { lat, lon };

    // If WebSocket is connected, send via WebSocket
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'position_update',
        lat,
        lon,
        heading,
        speed,
      }));
      return { ok: true };
    }

    // Otherwise, send via REST API
    const { ok, error: postError } = await postJson(
      CANNONBALL_ENDPOINTS.location,
      { lat, lon, heading, speed },
      apiBase
    );

    if (postError) {
      setError(postError);
    }

    return { ok, error: postError };
  }, [apiBase]);

  // Activate Cannonball mode
  const activate = useCallback(async () => {
    const { data, error: postError, ok } = await postJson(
      CANNONBALL_ENDPOINTS.activate,
      {},
      apiBase
    );

    if (ok && data) {
      setSessionId(data.user_id || 'anonymous');
    } else if (postError) {
      setError(postError);
    }

    return { ok, data, error: postError };
  }, [apiBase]);

  // Deactivate Cannonball mode
  const deactivate = useCallback(async () => {
    const { ok, error: deleteError } = await deleteRequest(
      CANNONBALL_ENDPOINTS.activate,
      apiBase
    );

    if (ok) {
      setSessionId(null);
    } else if (deleteError) {
      setError(deleteError);
    }

    return { ok, error: deleteError };
  }, [apiBase]);

  // Set threat radius
  const setThreatRadius = useCallback((radius) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'set_radius',
        radius_nm: radius,
      }));
    }
  }, []);

  // Request current threats (via WebSocket)
  const requestThreats = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'get_threats',
      }));
    } else {
      fetchThreats();
    }
  }, [fetchThreats]);

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

  // WebSocket connection management
  useEffect(() => {
    if (!enabled) {
      cleanup();
      return;
    }

    if (!useWebSocket) {
      // Use polling instead
      fetchThreats();
      pollingIntervalRef.current = setInterval(fetchThreats, pollingInterval);
      setConnected(true);
      return () => {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
        }
      };
    }

    // WebSocket connection
    const connect = () => {
      const wsUrl = getWebSocketUrl(apiBase, 'cannonball');

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[Cannonball WS] Connected');
        setConnected(true);
        setError(null);
        reconnectAttemptRef.current = 0;

        // Set initial radius
        ws.send(JSON.stringify({
          type: 'set_radius',
          radius_nm: threatRadius,
        }));

        // Send initial position if available
        if (userPositionRef.current) {
          ws.send(JSON.stringify({
            type: 'position_update',
            lat: userPositionRef.current.lat,
            lon: userPositionRef.current.lon,
          }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          switch (message.type) {
            case 'session_started':
              setSessionId(message.session_id);
              break;

            case 'threats':
              setThreats(message.data || []);
              setThreatCount(message.count || 0);
              setLastUpdate(message.timestamp || new Date().toISOString());
              break;

            case 'radius_updated':
              console.log('[Cannonball WS] Radius updated:', message.radius_nm);
              break;

            case 'error':
              console.error('[Cannonball WS] Error:', message.message);
              setError(message.message);
              break;

            case 'response':
              // Handle request/response pattern
              if (message.request_type === 'threats') {
                setThreats(message.data?.threats || []);
                setThreatCount(message.data?.count || 0);
              }
              break;

            default:
              console.log('[Cannonball WS] Unknown message type:', message.type);
          }
        } catch (err) {
          console.error('[Cannonball WS] Parse error:', err);
        }
      };

      ws.onclose = (event) => {
        console.log('[Cannonball WS] Disconnected:', event.code, event.reason);
        setConnected(false);
        wsRef.current = null;

        // Attempt reconnection if not intentionally closed
        if (enabled && event.code !== 1000) {
          const delay = getReconnectDelay(reconnectAttemptRef.current, RECONNECT_CONFIG);
          console.log(`[Cannonball WS] Reconnecting in ${delay}ms (attempt ${reconnectAttemptRef.current + 1})`);

          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptRef.current++;
            connect();
          }, delay);
        }
      };

      ws.onerror = (event) => {
        console.error('[Cannonball WS] Error:', event);
        setError('WebSocket connection error');
      };
    };

    connect();

    return cleanup;
  }, [enabled, useWebSocket, apiBase, threatRadius, pollingInterval, fetchThreats, cleanup]);

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
    // Real-time threat data
    threats,
    threatCount,
    connected,
    sessionId,
    error,
    lastUpdate,

    // Fetched data
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
  };
}

export default useCannonballAPI;
