import { useState, useEffect, useMemo, useCallback, useRef } from 'react';

// Default timeout for requests in milliseconds
const REQUEST_TIMEOUT_MS = 15000;

/**
 * Create a promise that rejects after a timeout
 */
function withTimeout(promise, timeoutMs, message = 'Request timeout') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(message)), timeoutMs)
    )
  ]);
}

/**
 * Hook for managing safety events (proximity conflicts, TCAS alerts, emergencies)
 * Uses WebSocket for both real-time events and on-demand fetching
 *
 * @param {Array} wsSafetyEvents - Safety events from WebSocket push
 * @param {Array} aircraft - Current aircraft list
 * @param {Function} wsRequest - WebSocket request function (optional)
 * @param {boolean} wsConnected - Whether WebSocket is connected
 */
export function useSafetyEvents(wsSafetyEvents = [], aircraft = [], wsRequest = null, wsConnected = false) {
  const [safetyEvents, setSafetyEvents] = useState([]);
  const [acknowledgedEvents, setAcknowledgedEvents] = useState(new Set());
  const [proximityConflicts, setProximityConflicts] = useState([]);
  const [acknowledgedConflicts, setAcknowledgedConflicts] = useState(new Set());
  const lastFetchRef = useRef(0);
  const mountedRef = useRef(true);

  // Merge WebSocket safety events with local state
  useEffect(() => {
    if (wsSafetyEvents && wsSafetyEvents.length > 0) {
      setSafetyEvents(prev => {
        const existingIds = new Set(prev.map(e => e.id));
        const newEvents = wsSafetyEvents.filter(e => !existingIds.has(e.id));
        if (newEvents.length === 0) return prev;
        return [...newEvents, ...prev].slice(0, 50);
      });
    }
  }, [wsSafetyEvents]);

  // Set mounted ref on mount/unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Fetch safety events via WebSocket on initial connect
  useEffect(() => {
    if (!wsRequest || !wsConnected) return;

    // AbortController for cancelling pending requests on cleanup
    const abortController = new AbortController();

    const fetchSafetyEvents = async () => {
      // Debounce
      const now = Date.now();
      if (now - lastFetchRef.current < 10000) return;
      lastFetchRef.current = now;

      // Don't fetch if aborted or unmounted
      if (abortController.signal.aborted || !mountedRef.current) return;

      try {
        // Wrap request with timeout to prevent hung requests
        const data = await withTimeout(
          wsRequest('safety-events', { limit: 20 }),
          REQUEST_TIMEOUT_MS,
          'Safety events request timeout'
        );

        // Check if aborted or unmounted before updating state
        if (abortController.signal.aborted || !mountedRef.current) return;

        // Handle various Django API response formats
        let events = [];
        if (Array.isArray(data)) {
          events = data;
        } else if (data?.results && Array.isArray(data.results)) {
          // Django REST Framework paginated response
          events = data.results;
        } else if (data?.data?.events && Array.isArray(data.data.events)) {
          events = data.data.events;
        } else if (data?.data && Array.isArray(data.data)) {
          events = data.data;
        } else if (data?.events && Array.isArray(data.events)) {
          events = data.events;
        }

        if (events.length > 0 && mountedRef.current) {
          setSafetyEvents(prev => {
            const existingIds = new Set(prev.map(e => e.id));
            const newEvents = events.filter(e => e && !existingIds.has(e.id));
            if (newEvents.length === 0) return prev;
            return [...newEvents, ...prev].slice(0, 50);
          });
        }
      } catch (err) {
        // Silent fail - real-time WebSocket push is primary
        // Only log if it's not a connection/timeout/abort error
        if (!err.message?.includes('timeout') &&
            !err.message?.includes('not connected') &&
            !err.message?.includes('abort') &&
            err.name !== 'AbortError') {
          console.debug('Safety events fetch failed:', err.message);
        }
      }
    };

    // Fetch on connect with a small delay to ensure server is ready
    const timeout = setTimeout(fetchSafetyEvents, 500);

    // Refresh every 30 seconds (less frequent since we have real-time push)
    const interval = setInterval(fetchSafetyEvents, 30000);
    return () => {
      abortController.abort();
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [wsRequest, wsConnected]);

  // Convert safety events to active conflicts with LIVE separation data
  const activeConflicts = useMemo(() => {
    const cutoff = Date.now() - 60000; // Last 60 seconds

    return safetyEvents.filter(event => {
      if (acknowledgedEvents.has(event.id)) return false;
      const eventTime = new Date(event.timestamp).getTime();
      return eventTime > cutoff;
    }).map(event => {
      let horizontalNm = event.details?.horizontal_nm?.toFixed(1) || '--';
      let verticalFt = event.details?.vertical_ft || event.details?.altitude || '--';

      // For two-aircraft events, calculate live separation
      if (event.icao && event.icao_2) {
        const ac1 = aircraft.find(a => a.hex?.toLowerCase() === event.icao?.toLowerCase());
        const ac2 = aircraft.find(a => a.hex?.toLowerCase() === event.icao_2?.toLowerCase());

        if (ac1?.lat && ac1?.lon && ac2?.lat && ac2?.lon) {
          const dLat = (ac2.lat - ac1.lat) * 60;
          const dLon = (ac2.lon - ac1.lon) * 60 * Math.cos(ac1.lat * Math.PI / 180);
          horizontalNm = Math.sqrt(dLat * dLat + dLon * dLon).toFixed(1);
        }

        if (ac1?.alt && ac2?.alt) {
          verticalFt = Math.round(Math.abs(ac2.alt - ac1.alt));
        }
      }
      // For single-aircraft events, show current altitude/vs
      else if (event.icao) {
        const ac = aircraft.find(a => a.hex?.toLowerCase() === event.icao?.toLowerCase());
        if (ac?.alt) {
          verticalFt = Math.round(ac.alt);
        }
        if (event.event_type?.includes('vs') || event.event_type?.includes('descent') || event.event_type?.includes('climb')) {
          const vs = ac?.baro_rate || ac?.geom_rate;
          if (vs !== undefined) {
            verticalFt = `${vs > 0 ? '+' : ''}${Math.round(vs)} fpm`;
          }
        }
      }

      return {
        ...event,
        ac1: event.callsign || event.icao,
        ac2: event.callsign_2 || event.icao_2 || null,
        hex1: event.icao,
        hex2: event.icao_2,
        horizontalNm,
        verticalFt,
      };
    });
  }, [safetyEvents, acknowledgedEvents, aircraft]);

  // Acknowledge a safety event
  const acknowledgeEvent = useCallback((eventId) => {
    setAcknowledgedEvents(prev => {
      const next = new Set(prev);
      next.add(eventId);
      return next;
    });
  }, []);

  // Acknowledge all events of a severity level
  const acknowledgeEventsBySeverity = useCallback((severity) => {
    setAcknowledgedEvents(prev => {
      const next = new Set(prev);
      safetyEvents
        .filter(e => e.severity === severity)
        .forEach(e => next.add(e.id));
      return next;
    });
  }, [safetyEvents]);

  // Acknowledge a proximity conflict
  const acknowledgeConflict = useCallback((conflict) => {
    const conflictKey = `${conflict.hex1}-${conflict.hex2}`;
    setAcknowledgedConflicts(prev => {
      const next = new Set(prev);
      next.add(conflictKey);
      return next;
    });
  }, []);

  // Clean up acknowledged conflicts when they're no longer active
  useEffect(() => {
    if (proximityConflicts.length === 0 && acknowledgedConflicts.size > 0) {
      setAcknowledgedConflicts(new Set());
    } else if (acknowledgedConflicts.size > 0) {
      const activeKeys = new Set(proximityConflicts.flatMap(c => [
        `${c.hex1}-${c.hex2}`,
        `${c.hex2}-${c.hex1}`
      ]));
      const stillRelevant = [...acknowledgedConflicts].filter(key => activeKeys.has(key));
      if (stillRelevant.length !== acknowledgedConflicts.size) {
        setAcknowledgedConflicts(new Set(stillRelevant));
      }
    }
  }, [proximityConflicts, acknowledgedConflicts]);

  // Get unacknowledged events
  const unacknowledgedEvents = useMemo(() => {
    return activeConflicts.filter(event => !acknowledgedEvents.has(event.id));
  }, [activeConflicts, acknowledgedEvents]);

  // Get unacknowledged conflicts
  const unacknowledgedConflicts = useMemo(() => {
    return proximityConflicts.filter(conflict => {
      const conflictKey = `${conflict.hex1}-${conflict.hex2}`;
      const reverseKey = `${conflict.hex2}-${conflict.hex1}`;
      return !acknowledgedConflicts.has(conflictKey) && !acknowledgedConflicts.has(reverseKey);
    });
  }, [proximityConflicts, acknowledgedConflicts]);

  // Check if aircraft is in a conflict
  const isAircraftInConflict = useCallback((hex) => {
    const upperHex = hex?.toUpperCase();
    return activeConflicts.some(e =>
      e.icao?.toUpperCase() === upperHex ||
      e.icao_2?.toUpperCase() === upperHex
    ) || proximityConflicts.some(c =>
      c.hex1?.toUpperCase() === upperHex ||
      c.hex2?.toUpperCase() === upperHex
    );
  }, [activeConflicts, proximityConflicts]);

  // Get conflict for aircraft
  const getAircraftConflict = useCallback((hex) => {
    const upperHex = hex?.toUpperCase();
    return activeConflicts.find(e =>
      e.icao?.toUpperCase() === upperHex ||
      e.icao_2?.toUpperCase() === upperHex
    ) || proximityConflicts.find(c =>
      c.hex1?.toUpperCase() === upperHex ||
      c.hex2?.toUpperCase() === upperHex
    );
  }, [activeConflicts, proximityConflicts]);

  return {
    safetyEvents,
    activeConflicts,
    proximityConflicts,
    unacknowledgedEvents,
    unacknowledgedConflicts,
    acknowledgedEvents,
    acknowledgedConflicts,
    acknowledgeEvent,
    acknowledgeEventsBySeverity,
    acknowledgeConflict,
    isAircraftInConflict,
    getAircraftConflict,
    setProximityConflicts,
  };
}

export default useSafetyEvents;
