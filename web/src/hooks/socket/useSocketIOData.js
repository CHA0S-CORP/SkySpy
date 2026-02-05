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

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  forceFlushAircraftBatch,
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
    if (import.meta.env.DEV) {
      const count = Object.keys(aircraft).length;
      if (count > 0) {
        console.log('[useSocketIOData] Aircraft state updated:', count, 'aircraft in state');
      }
    }
  }, [aircraft]);

  /**
   * Handle incoming Socket.IO messages
   */
  const handleMessage = useCallback((type, data) => {
    if (!mountedRef.current) return;

    // Debug: Log all incoming messages (dev only - removed for production performance)
    if (import.meta.env.DEV) {
      console.log(
        '[useSocketIOData] Message received:',
        type,
        data?.aircraft?.length ?? data?.count ?? '',
        data
      );
    }

    try {
      // Handle batch messages
      if (type === 'batch' && Array.isArray(data?.messages)) {
        if (import.meta.env.DEV) {
          console.log('[useSocketIOData] Processing batch with', data.messages.length, 'messages');
        }
        data.messages.forEach((msg) => {
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
        setStats((prev) => ({
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

      // Airframe errors - use atomic operations to prevent race conditions
      // when multiple messages arrive simultaneously
      else if (type === 'airframe:error') {
        if (data?.icao_hex) {
          const hexKey = data.icao_hex.toUpperCase();
          const errorData = {
            error_type: data.error_type,
            error_message: data.error_message,
            source: data.source,
            details: data.details,
            timestamp: data.timestamp || new Date().toISOString(),
          };
          // Perform atomic update: create new Map to avoid concurrent modification issues
          const currentMap = airframeErrorsRef.current;
          const newMap = new Map(currentMap);
          newMap.set(hexKey, errorData);
          // Limit cache size - remove oldest entries if needed
          if (newMap.size > 100) {
            const keysToDelete = [];
            let count = 0;
            for (const key of newMap.keys()) {
              if (count >= newMap.size - 100) break;
              keysToDelete.push(key);
              count++;
            }
            keysToDelete.forEach((key) => newMap.delete(key));
          }
          airframeErrorsRef.current = newMap;
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
          setAirspaceData((prev) => ({ ...prev, advisories: data.advisories }));
        }
      } else if (type === 'airspace:boundary') {
        if (data?.boundaries) {
          setAirspaceData((prev) => ({ ...prev, boundaries: data.boundaries }));
        }
      }

      // Antenna analytics
      else if (type === 'antenna:analytics_update') {
        if (data) {
          setAntennaAnalytics(data);
        }
      }

      // Stats updates (pushed from backend)
      else if (type === 'stats:update') {
        if (data) {
          const { stats_type, data: statsData } = data;
          if (stats_type && statsData) {
            setExtendedStats((prev) => {
              const key = {
                flight_patterns: 'flightPatterns',
                geographic: 'geographic',
                tracking_quality: 'trackingQuality',
                engagement: 'engagement',
                time_comparison: 'timeComparison',
                antenna: 'antenna',
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

      // NOTAM events (backend sends notam:* singular)
      else if (type === 'notam:snapshot') {
        if (data?.notams) setNotams(data.notams);
        if (data?.tfrs) setTfrs(data.tfrs);
        if (data?.stats) setNotamStats(data.stats);
      } else if (type === 'notam:new' || type === 'notam:tfr_new') {
        if (data) {
          setNotams((prev) => [data, ...prev]);
          if (data.type === 'TFR') setTfrs((prev) => [data, ...prev]);
        }
      } else if (type === 'notam:update') {
        if (data?.notam_id) {
          setNotams((prev) =>
            prev.map((n) => (n.notam_id === data.notam_id ? { ...n, ...data } : n))
          );
          if (data.type === 'TFR') {
            setTfrs((prev) =>
              prev.map((t) => (t.notam_id === data.notam_id ? { ...t, ...data } : t))
            );
          }
        }
      } else if (type === 'notam:expired' || type === 'notam:tfr_expired') {
        if (data?.notam_id) {
          setNotams((prev) => prev.filter((n) => n.notam_id !== data.notam_id));
          setTfrs((prev) => prev.filter((t) => t.notam_id !== data.notam_id));
        }
      } else if (type === 'notam:stats') {
        if (data) setNotamStats(data);
      } else if (type === 'notam:refresh') {
        // Refresh triggered by backend - request new snapshot
        if (socketEmitRef.current) {
          socketEmitRef.current('request', {
            type: 'notam-snapshot',
            request_id: `notam-refresh-${Date.now()}`,
          });
        }
      }

      // Request/Response
      else if (type === 'response') {
        if (import.meta.env.DEV) {
          console.log('[useSocketIOData] Response received:', data?.request_type, data?.request_id);
        }
        // Handle aircraft-snapshot response specially - process as aircraft:snapshot event
        if (data?.request_type === 'aircraft-snapshot' && data?.data?.aircraft) {
          if (import.meta.env.DEV) {
            console.log(
              '[useSocketIOData] Processing aircraft-snapshot response with',
              data.data.aircraft.length,
              'aircraft'
            );
          }
          const wrappedData = { type: 'aircraft:snapshot', data: data.data };
          processAircraftSnapshot(wrappedData, setAircraft, setStats);
        }
        // Resolve pending request if exists
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
        if (import.meta.env.DEV) {
          console.log('[useSocketIOData] Subscribed to topics:', data?.topics);
        }
      } else if (type === 'unsubscribed') {
        if (import.meta.env.DEV) {
          console.log('[useSocketIOData] Unsubscribed from topics:', data?.topics);
        }
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('[useSocketIOData] Error processing message:', type, err);
      }
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
    if (import.meta.env.DEV) {
      console.log('[useSocketIOData] Socket.IO connected');
    }
    // Don't subscribe here - wait for event listeners to be set up first
  }, []);

  /**
   * Handle Socket.IO disconnection
   */
  const handleDisconnect = useCallback((reason) => {
    if (import.meta.env.DEV) {
      console.log('[useSocketIOData] Socket.IO disconnected:', reason);
    }

    // Flush any pending batched aircraft updates before clearing state
    forceFlushAircraftBatch();

    // Check mounted state before state updates to prevent React warnings
    if (mountedRef.current) {
      setAircraft({});
      setStats({ count: 0 });
    }

    // Reject all pending requests - always reject to prevent hanging promises
    // The .catch() handler in calling code should handle unmounted state
    // Note: We reject regardless of mount state to prevent memory leaks from hanging promises
    const pendingEntries = Array.from(pendingRequests.current.entries());
    pendingRequests.current.clear();
    pendingEntries.forEach(([, { reject, timeoutId }]) => {
      clearTimeout(timeoutId);
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
      const topicsList = topics.split(',').map((t) => t.trim());
      if (import.meta.env.DEV) {
        console.log('[useSocketIOData] Topics changed, re-subscribing:', topicsList);
      }
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
      'aircraft:snapshot',
      'aircraft:update',
      'aircraft:new',
      'aircraft:remove',
      'aircraft:heartbeat',
      // Safety
      'safety:snapshot',
      'safety:event',
      'safety:event_updated',
      'safety:event_resolved',
      // Alerts
      'alert:triggered',
      'alert:snapshot',
      // ACARS
      'acars:message',
      'acars:snapshot',
      // Audio
      'audio:transmission',
      // Airspace
      'airspace:snapshot',
      'airspace:update',
      'airspace:advisory',
      'airspace:boundary',
      // Antenna
      'antenna:analytics_update',
      // Airframe
      'airframe:error',
      // NOTAM (backend sends notam:* singular)
      'notam:snapshot',
      'notam:new',
      'notam:update',
      'notam:expired',
      'notam:tfr_new',
      'notam:tfr_expired',
      'notam:stats',
      'notam:refresh',
      // Stats
      'stats:update',
      // Request/Response
      'response',
      'error',
      // Subscription
      'subscribed',
      'unsubscribed',
      // Batch
      'batch',
    ];

    if (import.meta.env.DEV) {
      console.log(
        '[useSocketIOData] Setting up event listeners for',
        eventTypes.length,
        'event types'
      );
    }

    // Use a wrapper that calls the ref to avoid recreating listeners
    const unsubscribers = eventTypes.map((eventType) => {
      return on(eventType, (data) => {
        if (handleMessageRef.current) {
          handleMessageRef.current(eventType, data);
        }
      });
    });

    return () => {
      unsubscribers.forEach((unsub) => unsub && unsub());
    };
  }, [enabled, isReady, on]); // Re-run when socket becomes ready

  // Subscribe to topics when socket becomes ready
  useEffect(() => {
    if (!enabled || !isReady) return;

    const topicsList = topicsRef.current.split(',').map((t) => t.trim());
    if (import.meta.env.DEV) {
      console.log('[useSocketIOData] Socket ready, subscribing to topics:', topicsList);
    }
    emit('subscribe', { topics: topicsList });
    if (import.meta.env.DEV) {
      console.log('[useSocketIOData] Emitted subscribe event');
    }

    // Request initial aircraft snapshot after subscribing
    // This is needed because the backend sends the initial snapshot before our listeners are set up
    if (topicsList.includes('all') || topicsList.includes('aircraft')) {
      const requestId = `init-${Date.now()}`;
      if (import.meta.env.DEV) {
        console.log('[useSocketIOData] Requesting aircraft-snapshot with request_id:', requestId);
      }
      emit('request', {
        type: 'aircraft-snapshot',
        request_id: requestId,
        params: {},
      });
    }
  }, [enabled, isReady, emit]);

  // Mount/unmount cleanup
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Flush any pending batched aircraft updates on unmount
      forceFlushAircraftBatch();
      const pendingEntries = Array.from(pendingRequests.current.entries());
      pendingRequests.current.clear();
      pendingEntries.forEach(([, { timeoutId }]) => clearTimeout(timeoutId));
      if (demoIntervalRef.current) {
        clearInterval(demoIntervalRef.current);
        demoIntervalRef.current = null;
      }
    };
  }, []);

  // Stale aircraft cleanup - removes aircraft not updated in 60+ seconds
  // This is a safety net in case backend removal events are missed
  useEffect(() => {
    if (!enabled) return;

    const STALE_THRESHOLD_MS = 60000; // 60 seconds
    const CLEANUP_INTERVAL_MS = 10000; // Check every 10 seconds

    const cleanupStaleAircraft = () => {
      if (!mountedRef.current) return;

      const now = Date.now();
      setAircraft((prev) => {
        const staleHexes = [];
        Object.entries(prev).forEach(([hex, ac]) => {
          // Check if aircraft has a client timestamp and is stale
          if (ac._clientTimestamp && now - ac._clientTimestamp > STALE_THRESHOLD_MS) {
            staleHexes.push(hex);
          }
        });

        if (staleHexes.length === 0) return prev;

        if (import.meta.env.DEV) {
          console.log(
            '[useSocketIOData] Removing',
            staleHexes.length,
            'stale aircraft:',
            staleHexes
          );
        }

        const next = { ...prev };
        staleHexes.forEach((hex) => delete next[hex]);
        return next;
      });
    };

    const cleanupIntervalId = setInterval(cleanupStaleAircraft, CLEANUP_INTERVAL_MS);

    return () => {
      clearInterval(cleanupIntervalId);
    };
  }, [enabled]);

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
      initialData.forEach((ac) => {
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
        demoData.forEach((ac) => {
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
  const request = useCallback(
    (type, params = {}, timeoutMs = 10000) => {
      return new Promise((resolve, reject) => {
        // Use isReady to ensure socket is fully ready, not just connected state
        if (!isReady) {
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

        // Check if emit actually succeeded
        const emitted = emit('request', {
          type,
          request_id: requestId,
          params,
        });

        if (!emitted) {
          // Emit failed - socket not actually connected
          clearTimeout(timeoutId);
          pendingRequests.current.delete(requestId);
          reject(new Error('Socket.IO emit failed - not connected'));
        }
      });
    },
    [isReady, emit]
  );

  /**
   * Subscribe to additional topics
   *
   * @param {string|string[]} newTopics - Topics to subscribe to
   */
  const subscribe = useCallback(
    (newTopics) => {
      if (isReady) {
        emit('subscribe', {
          topics: Array.isArray(newTopics) ? newTopics : [newTopics],
        });
      }
    },
    [isReady, emit]
  );

  /**
   * Unsubscribe from topics
   *
   * @param {string|string[]} removeTopics - Topics to unsubscribe from
   */
  const unsubscribe = useCallback(
    (removeTopics) => {
      if (isReady) {
        emit('unsubscribe', {
          topics: Array.isArray(removeTopics) ? removeTopics : [removeTopics],
        });
      }
    },
    [isReady, emit]
  );

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
  const send = useCallback(
    (event, data) => {
      if (connected) {
        emit(event, data);
      }
    },
    [connected, emit]
  );

  // Memoize aircraft array to prevent new array on every render
  const aircraftArray = useMemo(() => Object.values(aircraft), [aircraft]);

  return {
    // Data
    aircraft: aircraftArray,
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
    isReady,
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
