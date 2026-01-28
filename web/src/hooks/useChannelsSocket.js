import { useState, useEffect, useRef, useCallback } from 'react';
import { useNativeWebSocket } from './useNativeWebSocket';

// Demo/mock aircraft data for development when backend is unavailable
const DEMO_AIRCRAFT = [
  { hex: 'A12345', flight: 'UAL123', lat: 47.45, lon: -122.30, alt: 35000, gs: 450, track: 180, t: 'B738', squawk: '1200', military: false, category: 'A3' },
  { hex: 'A67890', flight: 'DAL456', lat: 47.50, lon: -122.20, alt: 28000, gs: 380, track: 90, t: 'A320', squawk: '2345', military: false, category: 'A3' },
  { hex: 'AE1234', flight: 'EVAC01', lat: 47.55, lon: -122.35, alt: 5000, gs: 120, track: 270, t: 'H60', squawk: '7700', military: true, emergency: true, category: 'A7' },
  { hex: 'A11111', flight: 'SWA789', lat: 47.40, lon: -122.40, alt: 15000, gs: 280, track: 45, t: 'B737', squawk: '3456', military: false, category: 'A3' },
  { hex: 'A22222', flight: 'AAL321', lat: 47.60, lon: -122.25, alt: 38000, gs: 480, track: 135, t: 'B789', squawk: '4567', military: false, category: 'A5' },
  { hex: 'AE5678', flight: 'RCH001', lat: 47.35, lon: -122.50, alt: 25000, gs: 420, track: 315, t: 'C17', squawk: '5678', military: true, category: 'A5' },
  { hex: 'A33333', flight: 'ASA555', lat: 47.48, lon: -122.15, alt: 12000, gs: 250, track: 200, t: 'E75L', squawk: '6789', military: false, category: 'A3' },
  { hex: 'A44444', flight: 'N12345', lat: 47.52, lon: -122.45, alt: 3500, gs: 95, track: 60, t: 'C172', squawk: '1200', military: false, category: 'A1' },
];

// Generate animated demo data
const generateDemoAircraft = (baseAircraft, tick) => {
  return baseAircraft.map(ac => {
    const moveSpeed = (ac.gs || 300) / 3600 / 60; // degrees per second approx
    const radians = (ac.track || 0) * Math.PI / 180;
    return {
      ...ac,
      lat: ac.lat + Math.sin(radians) * moveSpeed * tick * 0.1,
      lon: ac.lon + Math.cos(radians) * moveSpeed * tick * 0.1,
      seen: 0,
      distance_nm: Math.random() * 50 + 5,
    };
  });
};

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
 * Handle alert triggered - store in localStorage and emit custom event
 */
const handleAlertTriggered = (alertData) => {
  const history = JSON.parse(localStorage.getItem('alert-history') || '[]');
  history.unshift({
    ...alertData,
    id: Date.now(),
    timestamp: new Date().toISOString()
  });
  localStorage.setItem('alert-history', JSON.stringify(history.slice(0, 100)));

  // Emit custom event for useAlertNotifications to handle toasts and sounds
  window.dispatchEvent(new CustomEvent('skyspy:alert:triggered', {
    detail: alertData
  }));
};

/**
 * Django Channels WebSocket hook for all real-time data.
 * High-level Django Channels WebSocket hook for all real-time data.
 *
 * @param {boolean} enabled - Whether to connect
 * @param {string} apiBase - API base URL
 * @param {string} topics - Topics to subscribe to (default: 'all')
 */
export function useChannelsSocket(enabled, apiBase, topics = 'all') {
  const [aircraft, setAircraft] = useState({});
  const [stats, setStats] = useState({ count: 0 });
  const [safetyEvents, setSafetyEvents] = useState([]);
  const [acarsMessages, setAcarsMessages] = useState([]);
  const [audioTransmissions, setAudioTransmissions] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [airspaceData, setAirspaceData] = useState({ advisories: [], boundaries: [] });
  const [antennaAnalytics, setAntennaAnalytics] = useState(null);

  const mountedRef = useRef(true);
  const pendingRequests = useRef(new Map());
  const airframeErrorsRef = useRef(new Map());
  const topicsRef = useRef(topics);

  // Ref for wsSend to avoid stale closure in handleConnect
  const wsSendRef = useRef(null);

  // Demo mode refs
  const demoTickRef = useRef(0);
  const demoActiveRef = useRef(false);
  const demoIntervalRef = useRef(null);

  // Update topics ref
  useEffect(() => {
    topicsRef.current = topics;
  }, [topics]);

  /**
   * Handle incoming WebSocket messages
   */
  const handleMessage = useCallback((data) => {
    if (!mountedRef.current) return;

    const { type } = data;

    try {
      // Aircraft events
      if (type === 'aircraft:snapshot') {
        if (data?.data?.aircraft && Array.isArray(data.data.aircraft)) {
          console.log('Aircraft snapshot received:', data.data.aircraft.length, 'aircraft');
          const newAircraft = {};
          data.data.aircraft.forEach(ac => {
            if (ac && typeof ac === 'object') {
              const normalized = normalizeAircraft(ac);
              if (normalized.hex) {
                newAircraft[normalized.hex] = normalized;
              }
            }
          });
          setAircraft(newAircraft);
          setStats(prev => ({ ...prev, count: Object.keys(newAircraft).length }));
        }
      } else if (type === 'aircraft:update') {
        const aircraftData = data?.data?.aircraft || (data?.data ? [data.data] : []);
        if (Array.isArray(aircraftData)) {
          setAircraft(prev => {
            const updated = { ...prev };
            aircraftData.forEach(ac => {
              if (ac && typeof ac === 'object') {
                const normalized = normalizeAircraft(ac);
                if (normalized.hex) {
                  updated[normalized.hex] = { ...updated[normalized.hex], ...normalized };
                }
              }
            });
            return updated;
          });
        }
      } else if (type === 'aircraft:new') {
        const aircraftData = data?.data?.aircraft || (data?.data ? [data.data] : []);
        if (Array.isArray(aircraftData)) {
          setAircraft(prev => {
            const updated = { ...prev };
            aircraftData.forEach(ac => {
              if (ac && typeof ac === 'object') {
                const normalized = normalizeAircraft(ac);
                if (normalized.hex) {
                  updated[normalized.hex] = normalized;
                }
              }
            });
            return updated;
          });
        }
      } else if (type === 'aircraft:remove') {
        const hexList = data?.data?.icaos || data?.data?.icao_list || data?.data?.hex_list ||
                       (data?.data?.hex ? [data.data.hex] : []);
        if (Array.isArray(hexList) && hexList.length > 0) {
          setAircraft(prev => {
            const next = { ...prev };
            hexList.forEach(hex => {
              if (hex && typeof hex === 'string') {
                delete next[hex.toUpperCase()];
              }
            });
            return next;
          });
        }
      } else if (type === 'aircraft:heartbeat') {
        setStats(prev => ({
          ...prev,
          count: data?.data?.count ?? data?.data?.aircraft_count ?? prev.count,
          timestamp: data?.data?.timestamp
        }));
      }

      // Safety events
      else if (type === 'safety:snapshot') {
        if (data?.data?.events && Array.isArray(data.data.events)) {
          console.log('Safety snapshot received:', data.data.events.length, 'events');
          setSafetyEvents(data.data.events.slice(0, 100));
        }
      } else if (type === 'safety:event') {
        if (data?.data && typeof data.data === 'object') {
          console.log('Safety event received:', data.data);
          setSafetyEvents(prev => [data.data, ...prev].slice(0, 100));
        }
      } else if (type === 'safety:event_updated') {
        if (data?.data && typeof data.data === 'object') {
          console.log('Safety event updated:', data.data);
          setSafetyEvents(prev => {
            const eventId = data.data.id || data.data.event_id;
            if (!eventId) return prev;
            return prev.map(event =>
              (event.id === eventId || event.event_id === eventId)
                ? { ...event, ...data.data }
                : event
            );
          });
          // Dispatch custom event for SafetyEventPage to listen
          window.dispatchEvent(new CustomEvent('skyspy:safety:event_updated', {
            detail: data.data
          }));
        }
      } else if (type === 'safety:event_resolved') {
        if (data?.data && typeof data.data === 'object') {
          console.log('Safety event resolved:', data.data);
          const eventId = data.data.id || data.data.event_id;
          if (eventId) {
            setSafetyEvents(prev =>
              prev.map(event =>
                (event.id === eventId || event.event_id === eventId)
                  ? { ...event, ...data.data, resolved: true }
                  : event
              )
            );
            // Dispatch custom event for SafetyEventPage to listen
            window.dispatchEvent(new CustomEvent('skyspy:safety:event_resolved', {
              detail: { ...data.data, resolved: true }
            }));
          }
        }
      }

      // Airframe errors
      else if (type === 'airframe:error') {
        if (data?.data?.icao_hex) {
          airframeErrorsRef.current.set(data.data.icao_hex.toUpperCase(), {
            error_type: data.data.error_type,
            error_message: data.data.error_message,
            source: data.data.source,
            details: data.data.details,
            timestamp: data.data.timestamp || new Date().toISOString(),
          });
          if (airframeErrorsRef.current.size > 100) {
            const oldest = airframeErrorsRef.current.keys().next().value;
            airframeErrorsRef.current.delete(oldest);
          }
        }
      }

      // Alerts
      else if (type === 'alert:triggered') {
        if (data?.data) {
          console.log('Alert triggered:', data.data);
          handleAlertTriggered(data.data);
          // Also add to alerts state
          setAlerts(prev => [data.data, ...prev].slice(0, 100));
        }
      } else if (type === 'alert:snapshot') {
        if (data?.data?.alerts && Array.isArray(data.data.alerts)) {
          console.log('Alert snapshot received:', data.data.alerts.length, 'alerts');
          setAlerts(data.data.alerts.slice(0, 100));
        }
      }

      // ACARS messages
      else if (type === 'acars:message') {
        if (data?.data) {
          const newMessages = Array.isArray(data.data) ? data.data : [data.data];
          const validMessages = newMessages.filter(m => m && typeof m === 'object');
          if (validMessages.length > 0) {
            setAcarsMessages(prev => [...validMessages, ...prev].slice(0, 100));
          }
        }
      } else if (type === 'acars:snapshot') {
        if (data?.data?.messages && Array.isArray(data.data.messages)) {
          setAcarsMessages(data.data.messages.slice(0, 100));
        }
      }

      // Audio transmissions
      else if (type === 'audio:transmission') {
        if (data?.data) {
          console.log('Audio transmission received:', data.data);
          const transmission = data.data;
          setAudioTransmissions(prev => [transmission, ...prev].slice(0, 50));
          // Emit custom event for AudioPlaybackControl to handle
          window.dispatchEvent(new CustomEvent('skyspy:audio:transmission', {
            detail: transmission
          }));
        }
      }

      // Airspace events
      else if (type === 'airspace:snapshot' || type === 'airspace:update') {
        if (data?.data) {
          setAirspaceData({
            advisories: Array.isArray(data.data.advisories) ? data.data.advisories : [],
            boundaries: Array.isArray(data.data.boundaries) ? data.data.boundaries : [],
          });
        }
      } else if (type === 'airspace:advisory') {
        if (data?.data?.advisories && Array.isArray(data.data.advisories)) {
          setAirspaceData(prev => ({
            ...prev,
            advisories: data.data.advisories,
          }));
        }
      } else if (type === 'airspace:boundary') {
        if (data?.data?.boundaries && Array.isArray(data.data.boundaries)) {
          setAirspaceData(prev => ({
            ...prev,
            boundaries: data.data.boundaries,
          }));
        }
      }

      // Antenna analytics
      else if (type === 'antenna:analytics') {
        if (data?.data && typeof data.data === 'object') {
          setAntennaAnalytics(data.data);
        }
      }

      // Request/Response pattern
      else if (type === 'response') {
        if (data?.request_id && pendingRequests.current.has(data.request_id)) {
          const { resolve, timeoutId } = pendingRequests.current.get(data.request_id);
          clearTimeout(timeoutId);
          pendingRequests.current.delete(data.request_id);
          resolve(data.data);
        }
      } else if (type === 'error' && data?.request_id) {
        if (pendingRequests.current.has(data.request_id)) {
          const { reject, timeoutId } = pendingRequests.current.get(data.request_id);
          clearTimeout(timeoutId);
          pendingRequests.current.delete(data.request_id);
          reject(new Error(data.message || 'Request failed'));
        }
      }

      // Subscription confirmation
      else if (type === 'subscribed') {
        console.log('Subscribed to topics:', data.topics);
      } else if (type === 'unsubscribed') {
        console.log('Unsubscribed from topics:', data.topics);
      }
    } catch (err) {
      console.error('Error processing message:', type, err);
    }
  }, []);

  /**
   * Handle connection
   */
  const handleConnect = useCallback(() => {
    console.log('Channels WebSocket connected');
    // Subscribe to topics using ref to avoid stale closure
    const topicsList = topicsRef.current.split(',').map(t => t.trim());
    if (wsSendRef.current) {
      wsSendRef.current({ action: 'subscribe', topics: topicsList });
    }
  }, []);

  /**
   * Handle disconnection
   */
  const handleDisconnect = useCallback((code, reason) => {
    console.log('Channels WebSocket disconnected:', code, reason);
    if (mountedRef.current) {
      // Clear stale data on disconnect
      setAircraft({});
      setStats({ count: 0 });
    }
    // Clear pending requests - store entries to process, then clear map first
    // to prevent double-rejection if timeout fires during iteration
    const pendingEntries = Array.from(pendingRequests.current.entries());
    pendingRequests.current.clear();
    pendingEntries.forEach(([, { reject, timeoutId }]) => {
      clearTimeout(timeoutId);
      if (mountedRef.current) {
        reject(new Error('WebSocket disconnected'));
      }
    });
  }, []);

  // Use native WebSocket
  const {
    connected,
    connecting,
    error: wsError,
    send: wsSend,
    reconnect: wsReconnect,
  } = useNativeWebSocket({
    enabled,
    apiBase,
    path: 'all',
    queryParams: { topics },
    onMessage: handleMessage,
    onConnect: handleConnect,
    onDisconnect: handleDisconnect,
  });

  // Keep wsSendRef in sync
  useEffect(() => {
    wsSendRef.current = wsSend;
  }, [wsSend]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Clear pending requests - store entries to process, then clear map first
      // to prevent double-rejection if timeout fires during iteration
      const pendingEntries = Array.from(pendingRequests.current.entries());
      pendingRequests.current.clear();
      pendingEntries.forEach(([, { timeoutId }]) => {
        clearTimeout(timeoutId);
        // Don't reject on unmount - component is gone, no one to handle the rejection
      });
      // Clean up demo interval
      if (demoIntervalRef.current) {
        clearInterval(demoIntervalRef.current);
        demoIntervalRef.current = null;
      }
    };
  }, []);

  // Demo mode: provide mock data when backend is unavailable (dev only)
  useEffect(() => {
    // Only enable demo mode in development
    if (import.meta.env.PROD) return;

    // If connected, stop demo mode
    if (connected) {
      if (demoActiveRef.current) {
        console.log('Backend connected - stopping demo mode');
        demoActiveRef.current = false;
        if (demoIntervalRef.current) {
          clearInterval(demoIntervalRef.current);
          demoIntervalRef.current = null;
        }
      }
      return;
    }

    // Wait 3 seconds before starting demo mode
    const demoTimeout = setTimeout(() => {
      if (connected || demoActiveRef.current || !mountedRef.current) return;

      console.log('Backend unavailable - starting demo mode with mock aircraft data');
      demoActiveRef.current = true;

      // Initial data
      const initialData = generateDemoAircraft(DEMO_AIRCRAFT, 0);
      const initialAircraft = {};
      initialData.forEach(ac => {
        const normalized = normalizeAircraft(ac);
        if (normalized.hex) initialAircraft[normalized.hex] = normalized;
      });
      setAircraft(initialAircraft);
      setStats({ count: Object.keys(initialAircraft).length, demo: true });

      // Update positions periodically
      demoIntervalRef.current = setInterval(() => {
        if (!mountedRef.current || connected) {
          demoActiveRef.current = false;
          clearInterval(demoIntervalRef.current);
          demoIntervalRef.current = null;
          return;
        }
        demoTickRef.current += 1;
        const demoData = generateDemoAircraft(DEMO_AIRCRAFT, demoTickRef.current);
        const newAircraft = {};
        demoData.forEach(ac => {
          const normalized = normalizeAircraft(ac);
          if (normalized.hex) newAircraft[normalized.hex] = normalized;
        });
        setAircraft(newAircraft);
        setStats({ count: Object.keys(newAircraft).length, demo: true });
      }, 2000);
    }, 3000);

    return () => {
      clearTimeout(demoTimeout);
    };
  }, [connected]);

  /**
   * Send a request to the server and wait for response.
   */
  const request = useCallback((type, params = {}, timeoutMs = 10000) => {
    return new Promise((resolve, reject) => {
      if (!connected) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const timeoutId = setTimeout(() => {
        if (pendingRequests.current.has(requestId)) {
          pendingRequests.current.delete(requestId);
          // Only reject if component is still mounted to avoid React warnings
          if (mountedRef.current) {
            reject(new Error(`Request timeout: ${type}`));
          }
        }
      }, timeoutMs);

      pendingRequests.current.set(requestId, { resolve, reject, timeoutId });

      wsSend({
        action: 'request',
        type,
        request_id: requestId,
        params,
      });
    });
  }, [connected, wsSend]);

  /**
   * Subscribe to additional topics.
   */
  const subscribe = useCallback((newTopics) => {
    if (connected) {
      wsSend({
        action: 'subscribe',
        topics: Array.isArray(newTopics) ? newTopics : [newTopics],
      });
    }
  }, [connected, wsSend]);

  /**
   * Unsubscribe from topics.
   */
  const unsubscribe = useCallback((removeTopics) => {
    if (connected) {
      wsSend({
        action: 'unsubscribe',
        topics: Array.isArray(removeTopics) ? removeTopics : [removeTopics],
      });
    }
  }, [connected, wsSend]);

  /**
   * Get airframe error for an ICAO hex (if any).
   */
  const getAirframeError = useCallback((icao) => {
    if (!icao) return null;
    return airframeErrorsRef.current.get(icao.toUpperCase()) || null;
  }, []);

  /**
   * Clear airframe error for an ICAO hex.
   */
  const clearAirframeError = useCallback((icao) => {
    if (icao) {
      airframeErrorsRef.current.delete(icao.toUpperCase());
    }
  }, []);

  /**
   * Get all current airframe errors.
   */
  const getAirframeErrors = useCallback(() => {
    return new Map(airframeErrorsRef.current);
  }, []);

  return {
    // Real-time data
    aircraft: Object.values(aircraft),
    aircraftMap: aircraft,
    connected,
    connecting,
    error: wsError,
    stats,
    safetyEvents,
    acarsMessages,
    audioTransmissions,
    alerts,
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

    // Reconnection
    reconnect: wsReconnect,

    // Send raw message
    send: wsSend,
  };
}

export default useChannelsSocket;
