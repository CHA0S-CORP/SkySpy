/**
 * useCannonballAPI - Hook for Cannonball Mode backend integration
 *
 * Provides:
 * - Socket.IO connection for real-time threat updates
 * - Socket.IO requests for session/pattern/alert management
 * - Location update sending
 * - All operations via Socket.IO (no HTTP fallback)
 */
import { useState, useCallback, useRef } from 'react';
import { useSocketIOCannonball } from './socket';

/**
 * Cannonball API hook - Socket.IO only
 *
 * @param {Object} options - Configuration options
 * @param {string} options.apiBase - API base URL
 * @param {boolean} options.enabled - Whether to enable the connection
 * @param {number} options.threatRadius - Maximum threat radius in NM (default: 25)
 * @returns {Object} API state and methods
 */
export function useCannonballAPI({ apiBase = '', enabled = true, threatRadius = 25 } = {}) {
  // Pattern and session data (fetched on demand)
  const [sessions, setSessions] = useState([]);
  const [patterns, setPatterns] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [stats, setStats] = useState(null);

  // Refs
  const userPositionRef = useRef(null);

  // Use Socket.IO hook for real-time threat updates
  const {
    threats,
    threatCount,
    connected,
    connecting,
    sessionId,
    error,
    lastUpdate,
    updatePosition: socketUpdatePosition,
    setThreatRadius: socketSetThreatRadius,
    requestThreats: socketRequestThreats,
    request,
    reconnect,
  } = useSocketIOCannonball({
    enabled,
    apiBase,
    threatRadius,
  });

  // Send location update via Socket.IO
  const updateLocation = useCallback(
    (lat, lon, heading = null, speed = null) => {
      userPositionRef.current = { lat, lon };

      if (connected) {
        return socketUpdatePosition(lat, lon, heading, speed);
      }

      return { ok: false, error: 'Not connected' };
    },
    [connected, socketUpdatePosition]
  );

  // Set threat radius via Socket.IO
  const setThreatRadius = useCallback(
    (radius) => {
      if (connected) {
        socketSetThreatRadius(radius);
      }
    },
    [connected, socketSetThreatRadius]
  );

  // Request current threats via Socket.IO
  const requestThreats = useCallback(() => {
    if (connected) {
      socketRequestThreats();
    }
  }, [connected, socketRequestThreats]);

  // Fetch sessions via Socket.IO request
  const fetchSessions = useCallback(
    async (activeOnly = true) => {
      if (!connected) {
        return { error: 'Not connected' };
      }

      try {
        const data = await request('sessions', { active_only: activeOnly });
        setSessions(data?.sessions || []);
        return data;
      } catch (err) {
        console.error('Failed to fetch sessions:', err);
        return { error: err.message };
      }
    },
    [connected, request]
  );

  // Fetch patterns via Socket.IO request
  const fetchPatterns = useCallback(
    async (hours = 24) => {
      if (!connected) {
        return { error: 'Not connected' };
      }

      try {
        const data = await request('patterns', { hours });
        setPatterns(data?.patterns || []);
        return data;
      } catch (err) {
        console.error('Failed to fetch patterns:', err);
        return { error: err.message };
      }
    },
    [connected, request]
  );

  // Fetch alerts via Socket.IO request
  const fetchAlerts = useCallback(
    async (unacknowledgedOnly = false) => {
      if (!connected) {
        return { error: 'Not connected' };
      }

      try {
        const data = await request('alerts', { unacknowledged: unacknowledgedOnly });
        setAlerts(data?.alerts || []);
        return data;
      } catch (err) {
        console.error('Failed to fetch alerts:', err);
        return { error: err.message };
      }
    },
    [connected, request]
  );

  // Acknowledge an alert via Socket.IO request
  const acknowledgeAlert = useCallback(
    async (alertId) => {
      if (!connected) {
        return { ok: false, error: 'Not connected' };
      }

      try {
        const data = await request('alert-acknowledge', { id: alertId });
        if (data?.success) {
          setAlerts((prev) =>
            prev.map((a) => (a.id === alertId ? { ...a, acknowledged: true } : a))
          );
        }
        return { ok: data?.success };
      } catch (err) {
        console.error('Failed to acknowledge alert:', err);
        return { ok: false, error: err.message };
      }
    },
    [connected, request]
  );

  // Acknowledge all alerts via Socket.IO request
  const acknowledgeAllAlerts = useCallback(async () => {
    if (!connected) {
      return { ok: false, error: 'Not connected' };
    }

    try {
      const data = await request('alert-acknowledge-all', {});
      if (data?.success) {
        setAlerts((prev) => prev.map((a) => ({ ...a, acknowledged: true })));
      }
      return { ok: data?.success };
    } catch (err) {
      console.error('Failed to acknowledge all alerts:', err);
      return { ok: false, error: err.message };
    }
  }, [connected, request]);

  // Fetch stats via Socket.IO request
  const fetchStats = useCallback(async () => {
    if (!connected) {
      return { error: 'Not connected' };
    }

    try {
      const data = await request('stats-summary', {});
      setStats(data);
      return data;
    } catch (err) {
      console.error('Failed to fetch stats:', err);
      return { error: err.message };
    }
  }, [connected, request]);

  // Check if ICAO is known LE aircraft via Socket.IO request
  const checkKnownAircraft = useCallback(
    async (icaoHex) => {
      if (!connected) {
        return null;
      }

      try {
        const data = await request('known-aircraft-check', { icao_hex: icaoHex });
        return data;
      } catch (err) {
        console.error('Failed to check known aircraft:', err);
        return null;
      }
    },
    [connected, request]
  );

  // Activate session (handled by Socket.IO connection)
  const activate = useCallback(async () => {
    // Socket.IO connection handles activation
    return { ok: connected, data: { session_id: sessionId } };
  }, [connected, sessionId]);

  // Deactivate session (handled by Socket.IO disconnection)
  const deactivate = useCallback(async () => {
    // Socket.IO disconnection handles deactivation
    return { ok: true };
  }, []);

  return {
    // Real-time threat data (from Socket.IO hook)
    threats,
    threatCount,
    connected,
    connecting,
    sessionId,
    error,
    lastUpdate,

    // Fetched data (from Socket.IO requests)
    sessions,
    patterns,
    alerts,
    stats,

    // Methods
    updateLocation,
    setThreatRadius,
    requestThreats,
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
