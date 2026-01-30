/**
 * Main data stream hook using Socket.IO (replaces useChannelsSocket).
 *
 * Features:
 * - Uses useSocketIO for connection management
 * - Handles all event types: aircraft:*, safety:*, acars:*, alerts:*, etc.
 * - Manages state: aircraft, stats, safetyEvents, acarsMessages, alerts, airspaceData
 * - Handles batched messages
 * - Provides request/response pattern
 * - Demo mode fallback when backend unavailable
 *
 * @module useSocketIOData
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSocketIO } from './useSocketIO';
import {
  DEMO_AIRCRAFT,
  generateDemoAircraft,
  normalizeAircraft,
  processAircraftSnapshot,
  processAircraftUpdate,
  processAircraftNew,
  processAircraftRemove,
  processSafetySnapshot,
  processSafetyEvent,
  processSafetyEventUpdated,
  processSafetyEventResolved,
  processAlertTriggered,
  processAlertSnapshot,
  processAcarsMessage,
  processAcarsSnapshot,
  processAudioTransmission,
  processAirspaceData,
} from '../channels';

/**
 * Socket.IO data stream hook for all real-time data.
 *
 * @param {boolean} enabled - Whether to connect
 * @param {string} apiBase - API base URL
 * @param {string} topics - Comma-separated topics to subscribe to (default: 'all')
 * @returns {Object} Data state and methods
 */
export function useSocketIOData(enabled, apiBase, topics = 'all') {
  // Data state
  const [aircraft, setAircraft] = useState({});
  const [stats, setStats] = useState({ count: 0 });
  const [safetyEvents, setSafetyEvents] = useState([]);
  const [acarsMessages, setAcarsMessages] = useState([]);
  const [audioTransmissions, setAudioTransmissions] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [airspaceData, setAirspaceData] = useState({ advisories: [], boundaries: [] });
  const [antennaAnalytics, setAntennaAnalytics] = useState(null);
  const [notams, setNotams] = useState([]);
  const [tfrs, setTfrs] = useState([]);
  const [notamStats, setNotamStats] = useState(null);
  // Extended stats from backend broadcasts
  const [extendedStats, setExtendedStats] = useState({
    flightPatterns: null,
    geographic: null,
    trackingQuality: null,
    engagement: null,
    timeComparison: null,
  });

  // Refs
  const mountedRef = useRef(true);
  const pendingRequests = useRef(new Map());
  const airframeErrorsRef = useRef(new Map());
  const topicsRef = useRef(topics);
  const socketEmitRef = useRef(null);
  const handleMessageRef = useRef(null);

  // Demo mode refs
  const demoTickRef = useRef(0);
  const demoActiveRef = useRef(false);
  const demoIntervalRef = useRef(null);

  // Track previous topics for re-subscription logic
  const prevTopicsRef = useRef(topics);

  // Debug: Log aircraft state changes
  useEffect(() => {
    const count = Object.keys(aircraft).length;
    if (count > 0) {
      console.log('[useSocketIOData] Aircraft state updated:', count, 'aircraft in state');
    }
  }, [aircraft]);

  /**
   * Handle incoming Socket.IO messages
   */
  const handleMessage = useCallback((type, data) => {
    if (!mountedRef.current) return;

    // Debug: Log all incoming messages
    console.log('[useSocketIOData] Message received:', type, data?.aircraft?.length ?? data?.count ?? '');

    try {
      // Handle batch messages
      if (type === 'batch' && Array.isArray(data?.messages)) {
        console.log('[useSocketIOData] Processing batch with', data.messages.length, 'messages');
        data.messages.forEach(msg => {
          if (msg && msg.type) {
            handleMessage(msg.type, msg.data || msg);
          }
        });
        return;
      }

      // Wrap data in expected format for processors
      const wrappedData = { type, data };

      // Aircraft events
      if (type === 'aircraft:snapshot') {
        processAircraftSnapshot(wrappedData, setAircraft, setStats);
      } else if (type === 'aircraft:update') {
        processAircraftUpdate(wrappedData, setAircraft);
      } else if (type === 'aircraft:new') {
        processAircraftNew(wrappedData, setAircraft);
      } else if (type === 'aircraft:remove') {
        processAircraftRemove(wrappedData, setAircraft);
      } else if (type === 'aircraft:heartbeat') {
        setStats(prev => ({
          ...prev,
          count: data?.count ?? data?.aircraft_count ?? prev.count,
          timestamp: data?.timestamp,
        }));
      }

      // Safety events
      else if (type === 'safety:snapshot') {
        processSafetySnapshot(wrappedData, setSafetyEvents);
      } else if (type === 'safety:event') {
        processSafetyEvent(wrappedData, setSafetyEvents);
      } else if (type === 'safety:event_updated') {
        processSafetyEventUpdated(wrappedData, setSafetyEvents);
      } else if (type === 'safety:event_resolved') {
        processSafetyEventResolved(wrappedData, setSafetyEvents);
      }

      // Airframe errors
      else if (type === 'airframe:error') {
        if (data?.icao_hex) {
          airframeErrorsRef.current.set(data.icao_hex.toUpperCase(), {
            error_type: data.error_type,
            error_message: data.error_message,
            source: data.source,
            details: data.details,
            timestamp: data.timestamp || new Date().toISOString(),
          });
          // Limit cache size
          if (airframeErrorsRef.current.size > 100) {
            const oldest = airframeErrorsRef.current.keys().next().value;
            airframeErrorsRef.current.delete(oldest);
          }
        }
      }

      // Alerts
      else if (type === 'alert:triggered') {
        processAlertTriggered(wrappedData, setAlerts);
      } else if (type === 'alert:snapshot') {
        processAlertSnapshot(wrappedData, setAlerts);
      }

      // ACARS
      else if (type === 'acars:message') {
        processAcarsMessage(wrappedData, setAcarsMessages);
      } else if (type === 'acars:snapshot') {
        processAcarsSnapshot(wrappedData, setAcarsMessages);
      }

      // Audio
      else if (type === 'audio:transmission') {
        processAudioTransmission(wrappedData, setAudioTransmissions);
      }

      // Airspace
      else if (type === 'airspace:snapshot' || type === 'airspace:update') {
        processAirspaceData(wrappedData, setAirspaceData);
      } else if (type === 'airspace:advisory') {
        if (data?.advisories) {
          setAirspaceData(prev => ({ ...prev, advisories: data.advisories }));
        }
      } else if (type === 'airspace:boundary') {
        if (data?.boundaries) {
          setAirspaceData(prev => ({ ...prev, boundaries: data.boundaries }));
        }
      }

      // Antenna analytics
      else if (type === 'antenna:analytics') {
        if (data) {
          setAntennaAnalytics(data);
        }
      }

      // Stats updates (pushed from backend)
      else if (type === 'stats:update') {
        if (data) {
          const { stats_type, data: statsData } = data;
          if (stats_type && statsData) {
            setExtendedStats(prev => {
              const key = {
                'flight_patterns': 'flightPatterns',
                'geographic': 'geographic',
                'tracking_quality': 'trackingQuality',
                'engagement': 'engagement',
                'time_comparison': 'timeComparison',
                'antenna': 'antenna',
              }[stats_type];
              if (key) {
                return { ...prev, [key]: statsData };
              }
              return prev;
            });
            // Also update antenna analytics if it's antenna type
            if (stats_type === 'antenna') {
              setAntennaAnalytics(statsData);
            }
          }
        }
      }

      // NOTAMS events
      else if (type === 'notams:snapshot') {
        if (data?.notams) setNotams(data.notams);
        if (data?.tfrs) setTfrs(data.tfrs);
        if (data?.stats) setNotamStats(data.stats);
      } else if (type === 'notams:new' || type === 'notams:tfr_new') {
        if (data) {
          setNotams(prev => [data, ...prev]);
          if (data.type === 'TFR') setTfrs(prev => [data, ...prev]);
        }
      } else if (type === 'notams:update') {
        if (data?.notam_id) {
          setNotams(prev => prev.map(n =>
            n.notam_id === data.notam_id ? { ...n, ...data } : n
          ));
          if (data.type === 'TFR') {
            setTfrs(prev => prev.map(t =>
              t.notam_id === data.notam_id ? { ...t, ...data } : t
            ));
          }
        }
      } else if (type === 'notams:expired' || type === 'notams:tfr_expired') {
        if (data?.notam_id) {
          setNotams(prev => prev.filter(n => n.notam_id !== data.notam_id));
          setTfrs(prev => prev.filter(t => t.notam_id !== data.notam_id));
        }
      } else if (type === 'notams:stats') {
        if (data) setNotamStats(data);
      }

      // Request/Response
      else if (type === 'response') {
        if (data?.request_id && pendingRequests.current.has(data.request_id)) {
          const { resolve, timeoutId } = pendingRequests.current.get(data.request_id);
          clearTimeout(timeoutId);
          pendingRequests.current.delete(data.request_id);
          resolve(data.data ?? data);
        }
      } else if (type === 'error' && data?.request_id) {
        if (pendingRequests.current.has(data.request_id)) {
          const { reject, timeoutId } = pendingRequests.current.get(data.request_id);
          clearTimeout(timeoutId);
          pendingRequests.current.delete(data.request_id);
          reject(new Error(data.message || 'Request failed'));
        }
      }

      // Subscription confirmations
      else if (type === 'subscribed') {
        console.log('[useSocketIOData] Subscribed to topics:', data?.topics);
      } else if (type === 'unsubscribed') {
        console.log('[useSocketIOData] Unsubscribed from topics:', data?.topics);
      }
    } catch (err) {
      console.error('[useSocketIOData] Error processing message:', type, err);
    }
  }, []);

  // Keep handleMessage ref in sync to avoid listener churn
  useEffect(() => {
    handleMessageRef.current = handleMessage;
  }, [handleMessage]);

  /**
   * Handle Socket.IO connection
   * Note: Topic subscription is deferred to the event listener setup effect
   * to ensure listeners are attached before data starts flowing
   */
  const handleConnect = useCallback(() => {
    console.log('[useSocketIOData] Socket.IO connected');
    // Don't subscribe here - wait for event listeners to be set up first
  }, []);

  /**
   * Handle Socket.IO disconnection
   */
  const handleDisconnect = useCallback((reason) => {
    console.log('[useSocketIOData] Socket.IO disconnected:', reason);

    if (mountedRef.current) {
      setAircraft({});
      setStats({ count: 0 });
    }

    // Reject all pending requests - always reject to prevent hanging promises
    // The .catch() handler in calling code should handle unmounted state
    const pendingEntries = Array.from(pendingRequests.current.entries());
    pendingRequests.current.clear();
    pendingEntries.forEach(([, { reject, timeoutId }]) => {
      clearTimeout(timeoutId);
      // Always reject to prevent memory leaks from hanging promises
      reject(new Error('Socket.IO disconnected'));
    });
  }, []);

  // Setup Socket.IO connection
  const {
    connected,
    connecting,
    error: socketError,
    emit,
    on,
    reconnect: socketReconnect,
    isReady,
  } = useSocketIO({
    enabled,
    apiBase,
    namespace: '/',
    path: '/socket.io',
    onConnect: handleConnect,
    onDisconnect: handleDisconnect,
  });

  // Store emit ref for use in callbacks
  useEffect(() => {
    socketEmitRef.current = emit;
  }, [emit]);

  // Keep topics ref in sync and re-subscribe when topics change while connected
  useEffect(() => {
    const prevTopics = prevTopicsRef.current;
    topicsRef.current = topics;
    prevTopicsRef.current = topics;

    // Re-subscribe if topics changed while connected
    if (isReady && socketEmitRef.current && prevTopics !== topics) {
      const topicsList = topics.split(',').map(t => t.trim());
      console.log('[useSocketIOData] Topics changed, re-subscribing:', topicsList);
      socketEmitRef.current('subscribe', { topics: topicsList });
    }
  }, [topics, isReady]);

  // Setup event listeners when socket is ready
  // Re-runs when isReady changes to set up listeners after socket connects
  useEffect(() => {
    if (!enabled || !isReady) return;

    // Define all event handlers
    const eventTypes = [
      // Aircraft
      'aircraft:snapshot', 'aircraft:update', 'aircraft:new', 'aircraft:remove', 'aircraft:heartbeat',
      // Safety
      'safety:snapshot', 'safety:event', 'safety:event_updated', 'safety:event_resolved',
      // Alerts
      'alert:triggered', 'alert:snapshot',
      // ACARS
      'acars:message', 'acars:snapshot',
      // Audio
      'audio:transmission',
      // Airspace
      'airspace:snapshot', 'airspace:update', 'airspace:advisory', 'airspace:boundary',
      // Antenna
      'antenna:analytics',
      // Airframe
      'airframe:error',
      // NOTAMS
      'notams:snapshot', 'notams:new', 'notams:update', 'notams:expired',
      'notams:tfr_new', 'notams:tfr_expired', 'notams:stats',
      // Stats
      'stats:update',
      // Request/Response
      'response', 'error',
      // Subscription
      'subscribed', 'unsubscribed',
      // Batch
      'batch',
    ];

    console.log('[useSocketIOData] Setting up event listeners for', eventTypes.length, 'event types');

    // Use a wrapper that calls the ref to avoid recreating listeners
    const unsubscribers = eventTypes.map(eventType => {
      return on(eventType, (data) => {
        if (handleMessageRef.current) {
          handleMessageRef.current(eventType, data);
        }
      });
    });

    return () => {
      unsubscribers.forEach(unsub => unsub && unsub());
    };
  }, [enabled, on]); // Subscriptions are queued by useSocketIO

  // Subscribe to topics when socket becomes ready
  useEffect(() => {
    if (!enabled || !isReady) return;

    const topicsList = topicsRef.current.split(',').map(t => t.trim());
    console.log('[useSocketIOData] Socket ready, subscribing to topics:', topicsList);
    emit('subscribe', { topics: topicsList });
  }, [enabled, isReady, emit]);

  // Mount/unmount cleanup
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const pendingEntries = Array.from(pendingRequests.current.entries());
      pendingRequests.current.clear();
      pendingEntries.forEach(([, { timeoutId }]) => clearTimeout(timeoutId));
      if (demoIntervalRef.current) {
        clearInterval(demoIntervalRef.current);
        demoIntervalRef.current = null;
      }
    };
  }, []);

  // Demo mode for development
  useEffect(() => {
    if (import.meta.env.PROD) return;

    if (connected) {
      if (demoActiveRef.current) {
        console.log('[useSocketIOData] Backend connected - stopping demo mode');
        demoActiveRef.current = false;
        if (demoIntervalRef.current) {
          clearInterval(demoIntervalRef.current);
          demoIntervalRef.current = null;
        }
      }
      return;
    }

    const demoTimeout = setTimeout(() => {
      if (connected || demoActiveRef.current || !mountedRef.current) return;

      console.log('[useSocketIOData] Backend unavailable - starting demo mode');
      demoActiveRef.current = true;

      // Initialize with demo aircraft
      const initialData = generateDemoAircraft(DEMO_AIRCRAFT, 0);
      const initialAircraft = {};
      initialData.forEach(ac => {
        const n = normalizeAircraft(ac);
        if (n.hex) initialAircraft[n.hex] = n;
      });
      setAircraft(initialAircraft);
      setStats({ count: Object.keys(initialAircraft).length, demo: true });

      // Update demo data periodically
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
          const n = normalizeAircraft(ac);
          if (n.hex) newAircraft[n.hex] = n;
        });
        setAircraft(newAircraft);
        setStats({ count: Object.keys(newAircraft).length, demo: true });
      }, 2000);
    }, 3000);

    return () => clearTimeout(demoTimeout);
  }, [connected]);

  /**
   * Send a request and wait for response
   *
   * @param {string} type - Request type
   * @param {Object} params - Request parameters
   * @param {number} timeoutMs - Timeout in milliseconds (default: 10000)
   * @returns {Promise<any>} Response data
   */
  const request = useCallback((type, params = {}, timeoutMs = 10000) => {
    return new Promise((resolve, reject) => {
      if (!connected) {
        reject(new Error('Socket.IO not connected'));
        return;
      }

      const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const timeoutId = setTimeout(() => {
        if (pendingRequests.current.has(requestId)) {
          pendingRequests.current.delete(requestId);
          if (mountedRef.current) {
            reject(new Error(`Request timeout: ${type}`));
          }
        }
      }, timeoutMs);

      pendingRequests.current.set(requestId, { resolve, reject, timeoutId });

      emit('request', {
        type,
        request_id: requestId,
        params,
      });
    });
  }, [connected, emit]);

  /**
   * Subscribe to additional topics
   *
   * @param {string|string[]} newTopics - Topics to subscribe to
   */
  const subscribe = useCallback((newTopics) => {
    if (connected) {
      emit('subscribe', {
        topics: Array.isArray(newTopics) ? newTopics : [newTopics],
      });
    }
  }, [connected, emit]);

  /**
   * Unsubscribe from topics
   *
   * @param {string|string[]} removeTopics - Topics to unsubscribe from
   */
  const unsubscribe = useCallback((removeTopics) => {
    if (connected) {
      emit('unsubscribe', {
        topics: Array.isArray(removeTopics) ? removeTopics : [removeTopics],
      });
    }
  }, [connected, emit]);

  /**
   * Get airframe error by ICAO hex
   */
  const getAirframeError = useCallback((icao) => {
    return icao ? airframeErrorsRef.current.get(icao.toUpperCase()) || null : null;
  }, []);

  /**
   * Clear airframe error by ICAO hex
   */
  const clearAirframeError = useCallback((icao) => {
    if (icao) {
      airframeErrorsRef.current.delete(icao.toUpperCase());
    }
  }, []);

  /**
   * Get all airframe errors
   */
  const getAirframeErrors = useCallback(() => {
    return new Map(airframeErrorsRef.current);
  }, []);

  /**
   * Send a raw message through the socket
   *
   * @param {string} event - Event name
   * @param {any} data - Data to send
   */
  const send = useCallback((event, data) => {
    if (connected) {
      emit(event, data);
    }
  }, [connected, emit]);

  return {
    // Data
    aircraft: Object.values(aircraft),
    aircraftMap: aircraft,
    stats,
    safetyEvents,
    acarsMessages,
    audioTransmissions,
    alerts,
    airspaceData,
    antennaAnalytics,
    extendedStats,
    notams,
    tfrs,
    notamStats,

    // Connection state
    connected,
    connecting,
    error: socketError,

    // Methods
    request,
    subscribe,
    unsubscribe,
    reconnect: socketReconnect,
    send,

    // Airframe error helpers
    getAirframeError,
    clearAirframeError,
    getAirframeErrors,
  };
}

export default useSocketIOData;
