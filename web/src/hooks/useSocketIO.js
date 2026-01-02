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
    type: data.type || data.t || data.aircraft_type || null,
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
    emergency: data.emergency || false,
    category: data.category || null,
    on_ground: data.on_ground || false,
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
 * Uses Socket.IO for robust real-time communication with:
 * - Automatic reconnection with exponential backoff
 * - Room-based subscriptions
 * - Request/response pattern for on-demand data fetching
 *
 * @param {boolean} enabled - Whether to connect
 * @param {string} apiBase - API base URL
 * @param {string} topics - Topics to subscribe to (default: 'all')
 *
 * @example
 * // Basic usage for real-time updates
 * const { aircraft, connected } = useSocketIO(true, '', 'aircraft');
 *
 * @example
 * // Request data on-demand
 * const { request } = useSocketIO(true, '', 'all');
 * const pireps = await request('pireps', { lat: 47.5, lon: -122.3, radius: 100 });
 * const airspaces = await request('airspaces', { lat: 47.5, lon: -122.3 });
 */
export function useSocketIO(enabled, apiBase, topics = 'all') {
  const [aircraft, setAircraft] = useState({});
  const [connected, setConnected] = useState(false);
  const [stats, setStats] = useState({ count: 0 });
  const [filteredStats, setFilteredStats] = useState(null);
  const [safetyEvents, setSafetyEvents] = useState([]);
  const [airspaceData, setAirspaceData] = useState({ advisories: [], boundaries: [] });
  const socketRef = useRef(null);
  const mountedRef = useRef(true);
  const statsFiltersRef = useRef(null);

  // Pending requests map: request_id -> { resolve, reject, timeout }
  const pendingRequests = useRef(new Map());

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
      path: '/socket.io/socket.io',
      query: { topics },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      timeout: 20000,
    });

    socketRef.current = socket;

    // Connection events
    socket.on('connect', () => {
      console.log('Socket.IO connected');
      setConnected(true);
    });

    socket.on('disconnect', (reason) => {
      console.log('Socket.IO disconnected:', reason);
      setConnected(false);
    });

    socket.on('connect_error', (error) => {
      console.error('Socket.IO connection error:', error.message);
    });

    // Aircraft events
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

    socket.on('aircraft:new', (data) => {
      if (data?.aircraft && Array.isArray(data.aircraft)) {
        data.aircraft.forEach(ac => {
          const normalized = normalizeAircraft(ac);
          if (normalized.hex) {
            setAircraft(prev => ({ ...prev, [normalized.hex]: normalized }));
          }
        });
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
      }
    });

    socket.on('aircraft:remove', (data) => {
      const icaos = data?.icaos || [];
      if (icaos.length > 0) {
        setAircraft(prev => {
          const next = { ...prev };
          icaos.forEach(icao => {
            if (icao) delete next[icao.toUpperCase()];
          });
          return next;
        });
      }
    });

    socket.on('aircraft:heartbeat', (data) => {
      setStats(prev => ({
        ...prev,
        count: data?.count ?? prev.count,
        timestamp: data?.timestamp
      }));
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

    // Safety events
    socket.on('safety:event', (data) => {
      if (data) {
        console.log('Socket.IO safety event:', data);
        setSafetyEvents(prev => [data, ...prev].slice(0, 100));
      }
    });

    // Alert events
    socket.on('alert:triggered', (data) => {
      if (data) {
        console.log('Socket.IO alert:', data);
        handleAlertTriggered(data);
      }
    });

    // ACARS events
    socket.on('acars:message', (data) => {
      console.log('Socket.IO ACARS:', data);
      // Could be handled separately if needed
    });

    // Stats events (filtered)
    socket.on('stats:update', (data) => {
      if (data) {
        setFilteredStats(data);
      }
    });

    // Request/response events
    socket.on('response', (data) => {
      if (data.request_id && pendingRequests.current.has(data.request_id)) {
        const { resolve, timeout } = pendingRequests.current.get(data.request_id);
        clearTimeout(timeout);
        pendingRequests.current.delete(data.request_id);
        resolve(data.data);
      }
    });

    socket.on('error', (data) => {
      if (data.request_id && pendingRequests.current.has(data.request_id)) {
        const { reject, timeout } = pendingRequests.current.get(data.request_id);
        clearTimeout(timeout);
        pendingRequests.current.delete(data.request_id);
        reject(new Error(data.error || 'Request failed'));
      }
    });

    // Pong for keepalive
    socket.on('pong', () => {
      // Keepalive response received
    });

    return () => {
      console.log('Socket.IO cleanup');
      mountedRef.current = false;
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [enabled, apiBase, topics]);

  /**
   * Send a request to the server and wait for response.
   *
   * Supported request types:
   * - airspaces: G-AIRMET advisories (params: lat, lon, hazard?)
   * - airspace-boundaries: Static boundaries (params: lat?, lon?, radius?, class?)
   * - pireps: Pilot reports (params: lat, lon, radius?, hours?)
   * - metars: METAR observations (params: lat, lon, radius?, hours?, limit?)
   * - metar: Single station METAR (params: station)
   * - taf: Terminal forecast (params: station)
   * - sigmets: SIGMETs (params: hazard?, lat?, lon?, radius?)
   * - airports: Nearby airports (params: lat, lon, radius?, limit?)
   * - navaids: Navigation aids (params: lat, lon, radius?, limit?, type?)
   * - safety-events: Recent safety events (params: limit?, event_type?, severity?)
   * - aircraft-info: Aircraft info (params: icao)
   *
   * @param {string} type - Request type
   * @param {object} params - Request parameters
   * @param {number} timeoutMs - Timeout in milliseconds (default: 10000)
   * @returns {Promise<object>} Response data
   *
   * @example
   * const pireps = await request('pireps', { lat: 47.5, lon: -122.3, radius: 100 });
   * const metar = await request('metar', { station: 'KSEA' });
   */
  const request = useCallback((type, params = {}, timeoutMs = 10000) => {
    return new Promise((resolve, reject) => {
      if (!socketRef.current || !socketRef.current.connected) {
        reject(new Error('Socket.IO not connected'));
        return;
      }

      const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Set timeout for request
      const timeout = setTimeout(() => {
        if (pendingRequests.current.has(requestId)) {
          pendingRequests.current.delete(requestId);
          reject(new Error(`Request timeout: ${type}`));
        }
      }, timeoutMs);

      // Store pending request
      pendingRequests.current.set(requestId, { resolve, reject, timeout });

      // Send request via Socket.IO
      socketRef.current.emit('request', {
        type,
        request_id: requestId,
        params,
      });
    });
  }, []);

  /**
   * Subscribe to additional topics.
   * @param {string[]} newTopics - Topics to subscribe to
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
   * @param {string[]} removeTopics - Topics to unsubscribe from
   */
  const unsubscribe = useCallback((removeTopics) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('unsubscribe', {
        topics: Array.isArray(removeTopics) ? removeTopics : [removeTopics],
      });
    }
  }, []);

  /**
   * Subscribe to filtered stats updates.
   * @param {object} filters - Filter parameters
   * @param {boolean} filters.military_only - Only military aircraft
   * @param {string} filters.category - Aircraft category filter (comma-separated)
   * @param {number} filters.min_altitude - Minimum altitude in feet
   * @param {number} filters.max_altitude - Maximum altitude in feet
   * @param {number} filters.min_distance - Minimum distance in nautical miles
   * @param {number} filters.max_distance - Maximum distance in nautical miles
   * @param {string} filters.aircraft_type - Aircraft type filter
   */
  const subscribeStats = useCallback((filters = {}) => {
    if (socketRef.current?.connected) {
      statsFiltersRef.current = filters;
      socketRef.current.emit('subscribe_stats', filters);
    }
  }, []);

  /**
   * Update stats filter preferences.
   * @param {object} filters - Updated filter parameters
   */
  const updateStatsFilters = useCallback((filters = {}) => {
    if (socketRef.current?.connected) {
      statsFiltersRef.current = { ...statsFiltersRef.current, ...filters };
      socketRef.current.emit('update_stats_filters', filters);
    }
  }, []);

  return {
    // Real-time data
    aircraft: Object.values(aircraft),
    aircraftMap: aircraft,
    connected,
    stats,
    filteredStats,
    safetyEvents,
    airspaceData,

    // Request/response methods
    request,

    // Subscription management
    subscribe,
    unsubscribe,
    subscribeStats,
    updateStatsFilters,
  };
}

export default useSocketIO;
