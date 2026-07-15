/**
 * Socket.IO hook for Cannonball Mode threat detection.
 *
 * Replaces native WebSocket connection with Socket.IO for:
 * - Position updates from device GPS
 * - Real-time threat list updates
 * - Threat radius configuration
 *
 * @module useSocketIOCannonball
 */

import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { useSocketIO } from './useSocketIO';

/**
 * Socket.IO hook for Cannonball Mode.
 *
 * @param {Object} options - Configuration options
 * @param {boolean} options.enabled - Whether to connect
 * @param {string} options.apiBase - API base URL
 * @param {number} options.threatRadius - Initial threat radius in NM (default: 25)
 * @param {Function} options.onThreatsUpdate - Callback when threats update
 * @param {Function} options.onSessionStarted - Callback when session starts
 * @param {Function} options.onAlert - Callback when the server pushes a new alert
 * @returns {Object} Cannonball state and methods
 */
const MAX_ALERTS = 50;

export function useSocketIOCannonball({
  enabled = true,
  apiBase = '',
  threatRadius = 25,
  onThreatsUpdate,
  onSessionStarted,
  onAlert,
} = {}) {
  // State
  const [threats, setThreats] = useState([]);
  const [threatCount, setThreatCount] = useState(0);
  const [alerts, setAlerts] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [error, setError] = useState(null);

  // Refs - declare socketEmitRef early so it's available in handleConnect
  const mountedRef = useRef(true);
  const userPositionRef = useRef(null);
  const threatRadiusRef = useRef(threatRadius);
  const pendingRequests = useRef(new Map());
  const socketEmitRef = useRef(null);
  // Refs for callback stability - prevents listener churn on every render
  const onThreatsUpdateRef = useRef(onThreatsUpdate);
  const onSessionStartedRef = useRef(onSessionStarted);
  const onAlertRef = useRef(onAlert);
  // Flag to track if initial setup has been sent after connection
  const initialSetupSentRef = useRef(false);

  // Keep refs in sync
  useEffect(() => {
    threatRadiusRef.current = threatRadius;
  }, [threatRadius]);

  // Keep callback refs in sync
  useEffect(() => {
    onThreatsUpdateRef.current = onThreatsUpdate;
  }, [onThreatsUpdate]);

  useEffect(() => {
    onSessionStartedRef.current = onSessionStarted;
  }, [onSessionStarted]);

  useEffect(() => {
    onAlertRef.current = onAlert;
  }, [onAlert]);

  /**
   * Handle Socket.IO connection
   * Note: Uses refs for all values to avoid stale closures on reconnection
   */
  const handleConnect = useCallback(() => {
    // Mark that initial setup needs to be sent
    initialSetupSentRef.current = false;
  }, []);

  // Send initial setup after connection when emit is available
  // Uses useLayoutEffect to run synchronously after DOM updates,
  // ensuring emit ref is populated before we try to use it
  useLayoutEffect(() => {
    if (!initialSetupSentRef.current && socketEmitRef.current && mountedRef.current) {
      initialSetupSentRef.current = true;

      // Read current ref value at execution time to avoid stale closure on reconnection
      const currentRadius = threatRadiusRef.current;
      socketEmitRef.current('set_radius', { radius_nm: currentRadius });

      // Send initial position if available - read ref at execution time
      const currentPosition = userPositionRef.current;
      if (currentPosition) {
        socketEmitRef.current('position_update', {
          lat: currentPosition.lat,
          lon: currentPosition.lon,
          heading: currentPosition.heading,
        });
      }
    }
  });

  /**
   * Handle Socket.IO disconnection
   */
  const handleDisconnect = useCallback((reason) => {
    if (mountedRef.current) {
      setThreats([]);
      setThreatCount(0);
    }

    // Reject pending requests
    pendingRequests.current.forEach(({ reject, timeoutId }) => {
      clearTimeout(timeoutId);
      reject(new Error('Disconnected'));
    });
    pendingRequests.current.clear();
  }, []);

  // Setup Socket.IO connection to /cannonball namespace
  const {
    connected,
    connecting,
    error: socketError,
    emit,
    on,
    reconnect: socketReconnect,
  } = useSocketIO({
    enabled,
    apiBase,
    namespace: '/cannonball',
    path: '/socket.io',
    onConnect: handleConnect,
    onDisconnect: handleDisconnect,
  });

  // Keep emit ref in sync for use in callbacks
  useEffect(() => {
    socketEmitRef.current = emit;
  }, [emit]);

  // Setup event listeners
  // Note: Uses refs for callbacks (onThreatsUpdateRef, onSessionStartedRef) to avoid
  // listener churn when callback props change on every render
  useEffect(() => {
    if (!enabled) return;

    const unsubscribers = [];

    // Session started event
    unsubscribers.push(
      on('session_started', (data) => {
        if (!mountedRef.current) return;
        setSessionId(data.session_id);
        setError(null);
        onSessionStartedRef.current?.(data);
      })
    );

    // Threats update event
    unsubscribers.push(
      on('threats', (data) => {
        if (!mountedRef.current) return;
        const threatList = data.data || data.threats || [];
        setThreats(threatList);
        setThreatCount(data.count || threatList.length);
        setLastUpdate(data.timestamp || new Date().toISOString());
        onThreatsUpdateRef.current?.(threatList, data);
      })
    );

    // Radius updated confirmation
    unsubscribers.push(
      on('radius_updated', (data) => {
        // Radius update confirmed
      })
    );

    // Server-push threat updates (room broadcast from the analysis task)
    unsubscribers.push(
      on('threat_update', (data) => {
        if (!mountedRef.current) return;
        const threatList = data.threats || [];
        setThreats(threatList);
        setThreatCount(data.count ?? threatList.length);
        setLastUpdate(data.timestamp || new Date().toISOString());
        onThreatsUpdateRef.current?.(threatList, data);
      })
    );

    // Server-push alerts (room broadcast when a new CannonballAlert is created)
    unsubscribers.push(
      on('new_alert', (data) => {
        if (!mountedRef.current) return;
        setAlerts((prev) => [data, ...prev].slice(0, MAX_ALERTS));
        onAlertRef.current?.(data);
      })
    );

    // Threat refresh trigger
    unsubscribers.push(
      on('threat_refresh', () => {
        // Server is telling us to refresh - request current position-based threats
        if (userPositionRef.current && socketEmitRef.current) {
          socketEmitRef.current('get_threats');
        }
      })
    );

    // Response to request events
    unsubscribers.push(
      on('response', (data) => {
        if (!mountedRef.current) return;
        const { request_id, request_type, data: responseData } = data;

        if (request_id && pendingRequests.current.has(request_id)) {
          const { resolve, timeoutId } = pendingRequests.current.get(request_id);
          clearTimeout(timeoutId);
          pendingRequests.current.delete(request_id);
          resolve(responseData);
        }

        // Handle threats response
        if (request_type === 'threats' && responseData) {
          const threatList = responseData.threats || [];
          setThreats(threatList);
          setThreatCount(responseData.count || threatList.length);
        }
      })
    );

    // Error events
    unsubscribers.push(
      on('error', (data) => {
        console.error('[Cannonball Socket.IO] Error:', data.message);
        if (mountedRef.current) {
          setError(data.message);
        }

        // Reject pending request if applicable
        if (data.request_id && pendingRequests.current.has(data.request_id)) {
          const { reject, timeoutId } = pendingRequests.current.get(data.request_id);
          clearTimeout(timeoutId);
          pendingRequests.current.delete(data.request_id);
          reject(new Error(data.message));
        }
      })
    );

    return () => {
      unsubscribers.forEach((unsub) => unsub && unsub());
    };
  }, [enabled, on]);

  // Mount/unmount cleanup
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pendingRequests.current.forEach(({ timeoutId }) => clearTimeout(timeoutId));
      pendingRequests.current.clear();
    };
  }, []);

  // Sync socket error to state
  useEffect(() => {
    if (socketError && mountedRef.current) {
      setError(socketError.message || 'Connection error');
    }
  }, [socketError]);

  /**
   * Update user position and get threats
   *
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @param {number} heading - Heading in degrees (optional)
   * @param {number} speed - Speed (optional)
   * @returns {Object} Success status
   */
  const updatePosition = useCallback(
    (lat, lon, heading = null, speed = null) => {
      userPositionRef.current = { lat, lon, heading };

      // Use ref for emit to avoid stale closures during connection transitions
      if (connected && socketEmitRef.current) {
        socketEmitRef.current('position_update', {
          lat,
          lon,
          heading,
          speed,
        });
        return { ok: true };
      }

      return { ok: false, error: 'Not connected' };
    },
    [connected]
  );

  /**
   * Set threat detection radius
   *
   * @param {number} radiusNm - Radius in nautical miles
   */
  const setThreatRadiusNm = useCallback(
    (radiusNm) => {
      threatRadiusRef.current = radiusNm;

      if (connected && socketEmitRef.current) {
        socketEmitRef.current('set_radius', { radius_nm: radiusNm });
      }
    },
    [connected]
  );

  /**
   * Request current threats
   */
  const requestThreats = useCallback(() => {
    if (connected && socketEmitRef.current) {
      socketEmitRef.current('get_threats');
    }
  }, [connected]);

  /**
   * Send a request and wait for response
   *
   * @param {string} type - Request type
   * @param {Object} params - Request parameters
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Promise<any>} Response data
   */
  const request = useCallback(
    (type, params = {}, timeoutMs = 10000) => {
      return new Promise((resolve, reject) => {
        if (!connected || !socketEmitRef.current) {
          reject(new Error('Not connected'));
          return;
        }

        const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const timeoutId = setTimeout(() => {
          if (pendingRequests.current.has(requestId)) {
            pendingRequests.current.delete(requestId);
            reject(new Error(`Request timeout: ${type}`));
          }
        }, timeoutMs);

        pendingRequests.current.set(requestId, { resolve, reject, timeoutId });

        socketEmitRef.current('request', {
          type,
          request_id: requestId,
          params,
        });
      });
    },
    [connected]
  );

  return {
    // State
    threats,
    threatCount,
    alerts,
    connected,
    connecting,
    sessionId,
    error,
    lastUpdate,

    // Methods
    updatePosition,
    setThreatRadius: setThreatRadiusNm,
    requestThreats,
    request,
    reconnect: socketReconnect,
  };
}

export default useSocketIOCannonball;
