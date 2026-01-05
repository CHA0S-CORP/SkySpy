import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Socket-first API hook that replaces useApi.
 * Uses socket.io for data fetching when connected, with HTTP fallback.
 *
 * @param {string} endpoint - The API endpoint (e.g., '/api/v1/aircraft/stats')
 * @param {number} interval - Polling interval in ms (null = no polling, 0 = one-time fetch)
 * @param {string} apiBase - API base URL for HTTP fallback
 * @param {Object} options - Additional options
 * @param {Function} options.wsRequest - WebSocket request function
 * @param {boolean} options.wsConnected - Whether WebSocket is connected
 * @param {string} options.socketEvent - Socket event name to use (derived from endpoint if not provided)
 * @param {Object} options.socketParams - Parameters to pass to socket request
 * @param {boolean} options.disableSocket - Force HTTP-only mode
 */
export function useSocketApi(endpoint, interval = null, apiBase = '', options = {}) {
  const { wsRequest, wsConnected, socketEvent, socketParams = {}, disableSocket = false } = options;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  const lastFetchRef = useRef(0);

  // Store options in refs to avoid triggering re-fetches when they change
  const wsRequestRef = useRef(wsRequest);
  const wsConnectedRef = useRef(wsConnected);
  const socketParamsRef = useRef(socketParams);

  // Update refs when values change (without triggering re-render)
  useEffect(() => {
    wsRequestRef.current = wsRequest;
    wsConnectedRef.current = wsConnected;
    socketParamsRef.current = socketParams;
  }, [wsRequest, wsConnected, socketParams]);

  // Derive socket event from endpoint if not provided
  // e.g., '/api/v1/aircraft/stats' -> 'aircraft-stats'
  const derivedSocketEvent = socketEvent || deriveSocketEvent(endpoint);

  const fetchData = useCallback(async () => {
    // Debounce rapid fetches (min 500ms between fetches)
    const now = Date.now();
    if (now - lastFetchRef.current < 500) {
      return;
    }
    lastFetchRef.current = now;

    try {
      let result = null;

      // Try socket.io first if available and not disabled (use refs for current values)
      if (!disableSocket && wsRequestRef.current && wsConnectedRef.current && derivedSocketEvent) {
        try {
          // Parse query params from endpoint to include in socket request
          const params = { ...socketParamsRef.current, ...parseQueryParams(endpoint) };
          result = await wsRequestRef.current(derivedSocketEvent, params);

          if (result?.error) {
            // Socket returned error, fall through to HTTP
            result = null;
          }
        } catch (err) {
          // Socket request failed, fall through to HTTP
          console.debug(`Socket request failed for ${derivedSocketEvent}:`, err.message);
        }
      }

      // HTTP fallback if socket didn't work or isn't available
      if (result === null) {
        const baseUrl = apiBase || '';
        const res = await fetch(`${baseUrl}${endpoint}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        result = await res.json();
      }

      if (mountedRef.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err.message);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [endpoint, apiBase, derivedSocketEvent, disableSocket]);

  useEffect(() => {
    mountedRef.current = true;

    fetchData();

    if (interval && interval > 0) {
      const id = setInterval(fetchData, interval);
      return () => {
        mountedRef.current = false;
        clearInterval(id);
      };
    }

    return () => {
      mountedRef.current = false;
    };
  }, [fetchData, interval]);

  return { data, loading, error, refetch: fetchData };
}

/**
 * Derive socket event name from API endpoint
 * Maps common API patterns to socket event names
 */
function deriveSocketEvent(endpoint) {
  if (!endpoint) return null;

  // Remove query string for pattern matching
  const path = endpoint.split('?')[0];

  // Map common endpoints to socket events
  const eventMap = {
    '/api/v1/aircraft/stats': 'aircraft-stats',
    '/api/v1/aircraft/top': 'aircraft-top',
    '/api/v1/aircraft': 'aircraft-list',
    '/api/v1/history/stats': 'history-stats',
    '/api/v1/history/sessions': 'history-sessions',
    '/api/v1/history/trends': 'history-trends',
    '/api/v1/history/top': 'history-top',
    '/api/v1/history/analytics/distance': 'history-analytics-distance',
    '/api/v1/history/analytics/speed': 'history-analytics-speed',
    '/api/v1/history/analytics/correlation': 'history-analytics-correlation',
    '/api/v1/acars/stats': 'acars-stats',
    '/api/v1/acars/messages': 'acars-messages',
    '/api/v1/acars/messages/recent': 'acars-recent',
    '/api/v1/acars/labels': 'acars-labels',
    '/api/v1/safety/stats': 'safety-stats',
    '/api/v1/safety/events': 'safety-events',
    '/api/v1/system/status': 'system-status',
    '/api/v1/status': 'status',
    '/api/v1/ws/status': 'ws-status',
    '/api/v1/alerts/history': 'alerts-history',
  };

  // Check for exact match first
  if (eventMap[path]) {
    return eventMap[path];
  }

  // Check for pattern matches (e.g., /api/v1/aircraft/{hex}/info)
  if (path.match(/^\/api\/v1\/aircraft\/[^/]+\/info$/)) {
    return 'aircraft-info';
  }
  if (path.match(/^\/api\/v1\/aircraft\/[^/]+\/photo/)) {
    return 'photo-cache';
  }
  if (path.match(/^\/api\/v1\/history\/sightings/)) {
    return 'sightings';
  }
  if (path.match(/^\/api\/v1\/safety\/events\/[^/]+$/)) {
    return 'safety-event-detail';
  }

  return null;
}

/**
 * Parse query parameters from endpoint URL
 */
function parseQueryParams(endpoint) {
  const params = {};
  const queryString = endpoint.split('?')[1];

  if (queryString) {
    const searchParams = new URLSearchParams(queryString);
    for (const [key, value] of searchParams) {
      // Convert numeric strings to numbers
      if (/^\d+$/.test(value)) {
        params[key] = parseInt(value, 10);
      } else if (value === 'true') {
        params[key] = true;
      } else if (value === 'false') {
        params[key] = false;
      } else {
        params[key] = value;
      }
    }
  }

  return params;
}

export default useSocketApi;
