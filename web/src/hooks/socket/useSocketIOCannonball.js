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

import { useState, useEffect, useRef, useCallback } from 'react';
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
 * @returns {Object} Cannonball state and methods
 */
export function useSocketIOCannonball({
  enabled = true,
  apiBase = '',
  threatRadius = 25,
  onThreatsUpdate,
  onSessionStarted,
} = {}) {
  // State
  const [threats, setThreats] = useState([]);
  const [threatCount, setThreatCount] = useState(0);
  const [sessionId, setSessionId] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [error, setError] = useState(null);

  // Refs - declare socketEmitRef early so it's available in handleConnect
  const mountedRef = useRef(true);
  const userPositionRef = useRef(null);
  const threatRadiusRef = useRef(threatRadius);
  const pendingRequests = useRef(new Map());
  const socketEmitRef = useRef(null);

  // Keep refs in sync
  useEffect(() => {
    threatRadiusRef.current = threatRadius;
  }, [threatRadius]);

  /**
   * Handle Socket.IO connection
   */
  const handleConnect = useCallback(() => {
    console.log('[Cannonball Socket.IO] Connected');

    // Set initial radius - use setTimeout to ensure emit ref is populated
    // This handles the case where connection happens before emit ref is set
    setTimeout(() => {
      if (socketEmitRef.current) {
        socketEmitRef.current('set_radius', { radius_nm: threatRadiusRef.current });

        // Send initial position if available
        if (userPositionRef.current) {
          socketEmitRef.current('position_update', {
            lat: userPositionRef.current.lat,
            lon: userPositionRef.current.lon,
            heading: userPositionRef.current.heading,
          });
        }
      }
    }, 0);
  }, []);

  /**
   * Handle Socket.IO disconnection
   */
  const handleDisconnect = useCallback((reason) => {
    console.log('[Cannonball Socket.IO] Disconnected:', reason);

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
  useEffect(() => {
    if (!enabled) return;

    const unsubscribers = [];

    // Session started event
    unsubscribers.push(on('session_started', (data) => {
      if (!mountedRef.current) return;
      console.log('[Cannonball Socket.IO] Session started:', data.session_id);
      setSessionId(data.session_id);
      setError(null);
      onSessionStarted?.(data);
    }));

    // Threats update event
    unsubscribers.push(on('threats', (data) => {
      if (!mountedRef.current) return;
      const threatList = data.data || data.threats || [];
      setThreats(threatList);
      setThreatCount(data.count || threatList.length);
      setLastUpdate(data.timestamp || new Date().toISOString());
      onThreatsUpdate?.(threatList, data);
    }));

    // Radius updated confirmation
    unsubscribers.push(on('radius_updated', (data) => {
      console.log('[Cannonball Socket.IO] Radius updated:', data.radius_nm);
    }));

    // Threat refresh trigger
    unsubscribers.push(on('threat_refresh', () => {
      // Server is telling us to refresh - request current position-based threats
      if (userPositionRef.current && socketEmitRef.current) {
        socketEmitRef.current('get_threats');
      }
    }));

    // Response to request events
    unsubscribers.push(on('response', (data) => {
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
    }));

    // Error events
    unsubscribers.push(on('error', (data) => {
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
    }));

    return () => {
      unsubscribers.forEach(unsub => unsub && unsub());
    };
  }, [enabled, on, onThreatsUpdate, onSessionStarted]);

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
  const updatePosition = useCallback((lat, lon, heading = null, speed = null) => {
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
  }, [connected]);

  /**
   * Set threat detection radius
   *
   * @param {number} radiusNm - Radius in nautical miles
   */
  const setThreatRadiusNm = useCallback((radiusNm) => {
    threatRadiusRef.current = radiusNm;

    if (connected && socketEmitRef.current) {
      socketEmitRef.current('set_radius', { radius_nm: radiusNm });
    }
  }, [connected]);

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
  const request = useCallback((type, params = {}, timeoutMs = 10000) => {
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
  }, [connected]);

  return {
    // State
    threats,
    threatCount,
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
