import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

/**
 * Normalize aircraft data to handle different API field names
 */
const normalizeAircraft = (data) => {
  const hex = data.hex || data.icao || data.icao_hex || '';
  return {
    hex: hex.toUpperCase(),
    flight: data.flight || data.callsign || data.call || null,
    type: data.t || data.aircraft_type || (data.type && !data.type.includes('_') ? data.type : null),
    alt: data.alt || data.altitude || data.alt_baro || data.alt_geom || null,
    alt_baro: data.alt_baro || data.baro_alt || null,
    alt_geom: data.alt_geom || data.geom_alt || null,
    gs: data.gs || data.ground_speed || data.speed || null,
    tas: data.tas || null,
    ias: data.ias || null,
    track: data.track || data.heading || data.trk || null,
    true_heading: data.true_heading || null,
    mag_heading: data.mag_heading || null,
    vr: data.vr || data.vertical_rate || data.baro_rate || data.geom_rate || null,
    baro_rate: data.baro_rate || null,
    geom_rate: data.geom_rate || null,
    lat: data.lat || data.latitude || null,
    lon: data.lon || data.longitude || data.lng || null,
    squawk: data.squawk || null,
    seen: data.seen || 0,
    distance_nm: data.distance_nm || data.distance || null,
    military: data.military || false,
    emergency: data.emergency === true || (typeof data.emergency === 'string' && data.emergency !== 'none' && data.emergency !== ''),
    category: data.category || null,
    on_ground: data.on_ground || false,
    rssi: data.rssi ?? data.signal ?? null,
  };
};

/**
 * Handle alert triggered - store in localStorage and show notification
 */
const handleAlertTriggered = (alertData) => {
  const history = JSON.parse(localStorage.getItem('alert-history') || '[]');
  history.unshift({
    ...alertData,
    id: Date.now(),
    timestamp: new Date().toISOString()
  });
  localStorage.setItem('alert-history', JSON.stringify(history.slice(0, 100)));

  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(alertData.rule_name || 'ADS-B Alert', {
      body: alertData.message || `Aircraft ${alertData.icao} triggered alert`,
      icon: '/static/favicon.svg',
      tag: `alert-${alertData.icao}`,
      requireInteraction: alertData.priority === 'emergency'
    });
  }
};

/**
 * Socket.IO hook for all real-time data (aircraft, safety, alerts, etc.)
 *
 * Supports:
 * - Real-time push events (aircraft updates, safety events, alerts)
 * - Request/response pattern for on-demand data fetching
 *
 * @param {boolean} enabled - Whether to connect
 * @param {string} apiBase - API base URL
 * @param {string} topics - Topics to subscribe to (default: 'all')
 */
export function useWebSocket(enabled, apiBase, topics = 'all') {
  const [aircraft, setAircraft] = useState({});
  const [connected, setConnected] = useState(false);
  const [stats, setStats] = useState({ count: 0 });
  const [safetyEvents, setSafetyEvents] = useState([]);
  const [acarsMessages, setAcarsMessages] = useState([]);
  const [airspaceData, setAirspaceData] = useState({ advisories: [], boundaries: [] });
  const [antennaAnalytics, setAntennaAnalytics] = useState(null);
  const socketRef = useRef(null);
  const mountedRef = useRef(true);
  const pendingRequests = useRef(new Map());

  // Airframe lookup errors map: icao_hex -> { error_type, error_message, source, details, timestamp }
  const airframeErrorsRef = useRef(new Map());

  useEffect(() => {
    if (!enabled) return;

    mountedRef.current = true;

    // Build Socket.IO URL
    let socketUrl;
    if (apiBase) {
      try {
        const url = new URL(apiBase, window.location.origin);
        socketUrl = `${url.protocol}//${url.host}`;
      } catch (e) {
        socketUrl = window.location.origin;
      }
    } else {
      socketUrl = window.location.origin;
    }

    console.log('Socket.IO connecting to:', socketUrl);

    // Create Socket.IO connection
    const socket = io(socketUrl, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      timeout: 20000,
      query: { topics },
    });

    socketRef.current = socket;

    // Connection events
    socket.on('connect', () => {
      console.log('Socket.IO connected:', socket.id);
      setConnected(true);

      // Subscribe to topics
      socket.emit('subscribe', { topics: topics.split(',').map(t => t.trim()) });
    });

    socket.on('disconnect', (reason) => {
      console.log('Socket.IO disconnected:', reason);
      setConnected(false);
    });

    socket.on('connect_error', (error) => {
      console.error('Socket.IO connection error:', error);
    });

    // Aircraft events - backend uses colon format (aircraft:snapshot)
    socket.on('aircraft:snapshot', (data) => {
      console.log('Aircraft snapshot received:', data?.aircraft?.length || 0, 'aircraft');
      if (data?.aircraft && Array.isArray(data.aircraft)) {
        const newAircraft = {};
        data.aircraft.forEach(ac => {
          const normalized = normalizeAircraft(ac);
          if (normalized.hex) {
            newAircraft[normalized.hex] = normalized;
          }
        });
        setAircraft(newAircraft);
        setStats(prev => ({ ...prev, count: Object.keys(newAircraft).length }));
      }
    });

    socket.on('aircraft:update', (data) => {
      if (data?.aircraft && Array.isArray(data.aircraft)) {
        setAircraft(prev => {
          const updated = { ...prev };
          data.aircraft.forEach(ac => {
            const normalized = normalizeAircraft(ac);
            if (normalized.hex) {
              updated[normalized.hex] = { ...updated[normalized.hex], ...normalized };
            }
          });
          return updated;
        });
      } else if (data) {
        const normalized = normalizeAircraft(data);
        if (normalized.hex) {
          setAircraft(prev => ({
            ...prev,
            [normalized.hex]: { ...prev[normalized.hex], ...normalized }
          }));
        }
      }
    });

    socket.on('aircraft:new', (data) => {
      if (data?.aircraft && Array.isArray(data.aircraft)) {
        data.aircraft.forEach(ac => {
          const normalized = normalizeAircraft(ac);
          if (normalized.hex) {
            setAircraft(prev => ({ ...prev, [normalized.hex]: normalized }));
          }
        });
      } else if (data) {
        const normalized = normalizeAircraft(data);
        if (normalized.hex) {
          setAircraft(prev => ({ ...prev, [normalized.hex]: normalized }));
        }
      }
    });

    socket.on('aircraft:remove', (data) => {
      const hexList = data?.icaos || data?.icao_list || data?.hex_list ||
                     (data?.hex ? [data.hex] : []);
      if (hexList.length > 0) {
        setAircraft(prev => {
          const next = { ...prev };
          hexList.forEach(hex => {
            if (hex) delete next[hex.toUpperCase()];
          });
          return next;
        });
      }
    });

    // Heartbeat
    socket.on('aircraft:heartbeat', (data) => {
      setStats(prev => ({
        ...prev,
        count: data?.count ?? data?.aircraft_count ?? prev.count,
        timestamp: data?.timestamp
      }));
    });

    // Safety events
    socket.on('safety:event', (data) => {
      if (data) {
        console.log('Socket.IO safety event:', data);
        setSafetyEvents(prev => [data, ...prev].slice(0, 100));
      }
    });

    // Airframe lookup errors
    socket.on('airframe:error', (data) => {
      if (data?.icao_hex) {
        // Store in ref for useAircraftInfo to consume
        airframeErrorsRef.current.set(data.icao_hex.toUpperCase(), {
          error_type: data.error_type,
          error_message: data.error_message,
          source: data.source,
          details: data.details,
          timestamp: data.timestamp || new Date().toISOString(),
        });
        // Keep only last 100 errors to prevent memory leaks
        if (airframeErrorsRef.current.size > 100) {
          const oldest = airframeErrorsRef.current.keys().next().value;
          airframeErrorsRef.current.delete(oldest);
        }
      }
    });

    // Alerts
    socket.on('alert:triggered', (data) => {
      if (data) {
        console.log('Socket.IO alert:', data);
        handleAlertTriggered(data);
      }
    });

    // ACARS messages - prepend new messages and keep last 100
    socket.on('acars:message', (data) => {
      if (data) {
        // Handle both single message and array of messages
        const newMessages = Array.isArray(data) ? data : [data];
        setAcarsMessages(prev => [...newMessages, ...prev].slice(0, 100));
      }
    });

    // ACARS snapshot - initial batch of recent messages
    socket.on('acars:snapshot', (data) => {
      if (data?.messages && Array.isArray(data.messages)) {
        setAcarsMessages(data.messages.slice(0, 100));
      }
    });

    // Airspace events
    socket.on('airspace:snapshot', (data) => {
      if (data) {
        setAirspaceData({
          advisories: data.advisories || [],
          boundaries: data.boundaries || [],
        });
      }
    });

    socket.on('airspace:update', (data) => {
      if (data) {
        setAirspaceData({
          advisories: data.advisories || [],
          boundaries: data.boundaries || [],
        });
      }
    });

    socket.on('airspace:advisory', (data) => {
      if (data?.advisories) {
        setAirspaceData(prev => ({
          ...prev,
          advisories: data.advisories,
        }));
      }
    });

    socket.on('airspace:boundary', (data) => {
      if (data?.boundaries) {
        setAirspaceData(prev => ({
          ...prev,
          boundaries: data.boundaries,
        }));
      }
    });

    // Antenna analytics (periodic broadcast from server)
    socket.on('antenna:analytics', (data) => {
      if (data) {
        setAntennaAnalytics(data);
      }
    });

    // Request/Response pattern - backend emits 'response' and 'error' events
    socket.on('response', (data) => {
      if (data?.request_id && pendingRequests.current.has(data.request_id)) {
        const { resolve, timeoutId } = pendingRequests.current.get(data.request_id);
        clearTimeout(timeoutId);
        pendingRequests.current.delete(data.request_id);
        resolve(data.data);
      }
    });

    socket.on('error', (data) => {
      if (data?.request_id && pendingRequests.current.has(data.request_id)) {
        const { reject, timeoutId } = pendingRequests.current.get(data.request_id);
        clearTimeout(timeoutId);
        pendingRequests.current.delete(data.request_id);
        reject(new Error(data.error || 'Request failed'));
      }
    });

    // Cleanup
    return () => {
      console.log('Socket.IO cleanup');
      mountedRef.current = false;
      // Clear pending requests
      pendingRequests.current.forEach(({ reject, timeoutId }) => {
        clearTimeout(timeoutId);
        reject(new Error('Socket disconnected'));
      });
      pendingRequests.current.clear();
      if (socket) {
        socket.disconnect();
        socketRef.current = null;
      }
    };
  }, [enabled, apiBase, topics]);

  /**
   * Send a request to the server and wait for response.
   * Backend emits 'response' or 'error' events with matching request_id.
   */
  const request = useCallback((type, params = {}, timeoutMs = 10000) => {
    return new Promise((resolve, reject) => {
      if (!socketRef.current || !socketRef.current.connected) {
        reject(new Error('Socket.IO not connected'));
        return;
      }

      const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Set timeout for request
      const timeoutId = setTimeout(() => {
        if (pendingRequests.current.has(requestId)) {
          pendingRequests.current.delete(requestId);
          reject(new Error(`Request timeout: ${type}`));
        }
      }, timeoutMs);

      // Store pending request
      pendingRequests.current.set(requestId, { resolve, reject, timeoutId });

      // Emit request - backend will emit 'response' or 'error' event
      socketRef.current.emit('request', {
        type,
        request_id: requestId,
        params,
      });
    });
  }, []);

  /**
   * Subscribe to additional topics.
   */
  const subscribe = useCallback((newTopics) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('subscribe', {
        topics: Array.isArray(newTopics) ? newTopics : [newTopics],
      });
    }
  }, []);

  /**
   * Unsubscribe from topics.
   */
  const unsubscribe = useCallback((removeTopics) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('unsubscribe', {
        topics: Array.isArray(removeTopics) ? removeTopics : [removeTopics],
      });
    }
  }, []);

  /**
   * Get airframe error for an ICAO hex (if any).
   * @param {string} icao - ICAO hex code
   * @returns {object|null} Error info or null
   */
  const getAirframeError = useCallback((icao) => {
    if (!icao) return null;
    return airframeErrorsRef.current.get(icao.toUpperCase()) || null;
  }, []);

  /**
   * Clear airframe error for an ICAO hex.
   * @param {string} icao - ICAO hex code
   */
  const clearAirframeError = useCallback((icao) => {
    if (icao) {
      airframeErrorsRef.current.delete(icao.toUpperCase());
    }
  }, []);

  /**
   * Get all current airframe errors.
   * @returns {Map} Map of icao -> error info
   */
  const getAirframeErrors = useCallback(() => {
    return new Map(airframeErrorsRef.current);
  }, []);

  return {
    // Real-time data
    aircraft: Object.values(aircraft),
    aircraftMap: aircraft,
    connected,
    stats,
    safetyEvents,
    acarsMessages,
    airspaceData,
    antennaAnalytics,

    // Request/response methods
    request,

    // Airframe error handling
    getAirframeError,
    clearAirframeError,
    getAirframeErrors,

    // Subscription management
    subscribe,
    unsubscribe,
  };
}

export default useWebSocket;
