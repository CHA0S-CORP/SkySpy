import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Default request timeout in milliseconds
 */
const DEFAULT_TIMEOUT = 30000;

/**
 * WebSocket-first API hook for Django REST Framework.
 * Uses WebSocket for data fetching with HTTP fallback for unmapped endpoints.
 *
 * @param {string} endpoint - The API endpoint (e.g., '/api/v1/aircraft/stats')
 * @param {number} interval - Polling interval in ms (null = no polling, 0 = one-time fetch)
 * @param {string} apiBase - API base URL for HTTP fallback
 * @param {Object} options - Additional options
 * @param {Function} options.wsRequest - WebSocket request function (required)
 * @param {boolean} options.wsConnected - Whether WebSocket is connected (required)
 * @param {string} options.socketEvent - Socket event name to use (derived from endpoint if not provided)
 * @param {Object} options.socketParams - Parameters to pass to socket request
 * @param {boolean} options.disableSocket - Force HTTP fallback
 * @param {number} options.timeout - Request timeout in ms (default: 30000)
 */
export function useSocketApi(endpoint, interval = null, apiBase = '', options = {}) {
  const {
    wsRequest,
    wsConnected,
    socketEvent,
    socketParams = {},
    disableSocket = false,
    timeout = DEFAULT_TIMEOUT,
  } = options;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  const lastFetchRef = useRef(0);
  // Trailing-edge debounce timer for rapid fetch calls
  const debounceTimerRef = useRef(null);
  // Monotonic request version - stale responses (older versions) are discarded
  const requestVersionRef = useRef(0);
  // Latest fetchData, so a debounced trailing call uses current endpoint/options
  const fetchDataRef = useRef(null);

  // Store options in refs to avoid triggering re-fetches when they change
  // Update refs synchronously to avoid stale values in callbacks
  const wsRequestRef = useRef(wsRequest);
  const wsConnectedRef = useRef(wsConnected);
  const socketParamsRef = useRef(socketParams);
  const timeoutRef = useRef(timeout);
  const apiBaseRef = useRef(apiBase);

  // Update refs synchronously on each render to ensure callbacks always have current values
  // This avoids the race condition where fetchData runs before the effect updates refs
  wsRequestRef.current = wsRequest;
  wsConnectedRef.current = wsConnected;
  socketParamsRef.current = socketParams;
  timeoutRef.current = timeout;
  apiBaseRef.current = apiBase;

  // Derive socket event from endpoint if not provided
  // e.g., '/api/v1/aircraft/stats' -> 'aircraft-stats'
  const derivedSocketEvent = socketEvent || deriveSocketEvent(endpoint);

  /**
   * HTTP fallback for endpoints without socket mapping
   */
  const fetchHttp = useCallback(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutRef.current);

    try {
      // Build full URL
      const url = endpoint.startsWith('http') ? endpoint : `${apiBaseRef.current}${endpoint}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // Check for CORS issues
        if (response.type === 'opaque' || response.status === 0) {
          throw new Error(
            'CORS error: Unable to access the API. Check that the server allows requests from this origin.'
          );
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      }
      return null;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeoutRef.current}ms`);
      }
      // Detect CORS errors (typically show as TypeError: Failed to fetch)
      if (err.name === 'TypeError' && err.message.includes('Failed to fetch')) {
        throw new Error(
          'CORS error: Unable to access the API. Check that the server allows requests from this origin with credentials.'
        );
      }
      throw err;
    }
  }, [endpoint]);

  const fetchData = useCallback(async () => {
    // Debounce rapid fetches (min 500ms between fetches) with a trailing
    // call, so the last request in a burst is never silently dropped
    const now = Date.now();
    const elapsed = now - lastFetchRef.current;
    if (elapsed < 500) {
      if (!debounceTimerRef.current) {
        debounceTimerRef.current = setTimeout(() => {
          debounceTimerRef.current = null;
          if (mountedRef.current) {
            fetchDataRef.current?.();
          }
        }, 500 - elapsed);
      }
      return;
    }
    lastFetchRef.current = now;

    // Latest-wins: responses from older requests (e.g. a slow request for a
    // previous endpoint) must not overwrite newer data
    const version = ++requestVersionRef.current;
    const isCurrent = () => mountedRef.current && version === requestVersionRef.current;

    // Determine if we should use socket or HTTP
    const useSocket =
      !disableSocket && wsRequestRef.current && wsConnectedRef.current && derivedSocketEvent;

    if (useSocket) {
      try {
        // Parse query params from endpoint to include in socket request
        const params = { ...socketParamsRef.current, ...parseQueryParams(endpoint) };
        const result = await wsRequestRef.current(derivedSocketEvent, params);

        if (result?.error) {
          throw new Error(result.error);
        }

        if (isCurrent()) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        console.warn(
          `[useSocketApi] Socket request failed for ${derivedSocketEvent}:`,
          err.message
        );
        if (isCurrent()) {
          setError(err.message || 'Socket request failed');
        }
      } finally {
        if (isCurrent()) {
          setLoading(false);
        }
      }
    } else {
      // HTTP fallback for unmapped endpoints or when socket is unavailable
      try {
        const result = await fetchHttp();

        if (isCurrent()) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (isCurrent()) {
          setError(err.message || 'HTTP request failed');
        }
      } finally {
        if (isCurrent()) {
          setLoading(false);
        }
      }
    }
  }, [endpoint, derivedSocketEvent, disableSocket, fetchHttp]);

  // Keep ref pointing at the latest fetchData so trailing debounce calls
  // use the current endpoint/options
  fetchDataRef.current = fetchData;

  useEffect(() => {
    mountedRef.current = true;

    // Invalidate any in-flight request from a previous endpoint so its
    // response can't overwrite data for the new endpoint
    requestVersionRef.current++;

    fetchData();

    return () => {
      mountedRef.current = false;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [fetchData]);

  useEffect(() => {
    if (interval && interval > 0) {
      const id = setInterval(() => fetchDataRef.current?.(), interval);
      return () => clearInterval(id);
    }
  }, [interval]);

  return { data, loading, error, refetch: fetchData };
}

/**
 * Derive socket event name from API endpoint.
 * Maps Django REST Framework URL patterns to WebSocket event names.
 *
 * Django uses DRF ViewSets with router-generated URLs:
 * - /api/v1/aircraft/ -> list action
 * - /api/v1/aircraft/{pk}/ -> retrieve action
 * - /api/v1/aircraft/top/ -> custom action
 * - /api/v1/aircraft/stats/ -> custom action
 */
function deriveSocketEvent(endpoint) {
  if (!endpoint) return null;

  // Remove query string and trailing slash for pattern matching
  let path = endpoint.split('?')[0];
  if (path.endsWith('/') && path.length > 1) {
    path = path.slice(0, -1);
  }

  // Map Django REST Framework endpoints to socket events
  const eventMap = {
    // Aircraft endpoints
    '/api/v1/aircraft/stats': 'aircraft-stats',
    '/api/v1/aircraft/top': 'aircraft-top',
    '/api/v1/aircraft': 'aircraft-list',

    // History endpoints (Django ViewSets)
    '/api/v1/history/stats': 'history-stats',
    '/api/v1/history/sessions': 'history-sessions',
    '/api/v1/history/trends': 'history-trends',
    '/api/v1/history/top-performers': 'history-top',
    '/api/v1/history/analytics/distance': 'history-analytics-distance',
    '/api/v1/history/analytics/speed': 'history-analytics-speed',
    '/api/v1/history/analytics/correlation': 'history-analytics-correlation',
    '/api/v1/history': 'history-list',
    // Separate router endpoints for sessions and sightings
    '/api/v1/sessions': 'history-sessions',
    '/api/v1/sightings': 'sightings',

    // ACARS endpoints
    '/api/v1/acars/stats': 'acars-stats',
    '/api/v1/acars/messages': 'acars-messages',
    '/api/v1/acars/messages/recent': 'acars-recent',
    '/api/v1/acars/labels': 'acars-labels',
    '/api/v1/acars': 'acars-list',

    // Safety endpoints
    '/api/v1/safety/events/stats': 'safety-stats',
    '/api/v1/safety/events': 'safety-events',
    '/api/v1/safety/events/monitor/status': 'safety-status',

    // Alerts endpoints intentionally unmapped so they use HTTP: the socket
    // 'alert-rules' handler serves ALL users' rules with no owner scoping,
    // while the REST endpoint filters by owner/visibility. Do not remap
    // until the socket handler is owner-scoped.

    // Audio endpoints
    '/api/v1/audio/stats': 'audio-stats',
    '/api/v1/audio/status': 'audio-status',
    '/api/v1/audio': 'audio-list',
    '/api/v1/audio/transmissions': 'audio-transmissions',
    '/api/v1/audio/matched': 'audio-matched',

    // System endpoints
    '/api/v1/system/status': 'system-status',
    '/api/v1/system/health': 'system-health',
    '/api/v1/system/info': 'system-info',
    '/api/v1/system/databases': 'system-databases',
    '/api/v1/system/geodata': 'geodata-stats',
    '/api/v1/system/weather': 'weather-stats',
    // Legacy aliases (point to system endpoints)
    '/api/v1/status': 'system-status',
    '/api/v1/health': 'system-health',
    '/health': 'system-health',

    // Notifications endpoints
    '/api/v1/notifications/config': 'notifications-config',
    '/api/v1/notifications/channels': 'notifications-channels',
    '/api/v1/notifications': 'notifications-list',

    // Stats endpoints (Django ViewSets)
    '/api/v1/stats/tracking-quality': 'stats-tracking-quality',
    '/api/v1/stats/engagement': 'stats-engagement',
    '/api/v1/stats/favorites': 'stats-favorites',
    '/api/v1/stats/flight-patterns': 'stats-flight-patterns',
    '/api/v1/stats/geographic': 'stats-geographic',
    '/api/v1/stats/combined': 'stats-combined',
    '/api/v1/stats/session-analytics': 'stats-session-analytics',
    '/api/v1/stats/time-comparison': 'stats-time-comparison',
    '/api/v1/stats/achievements': 'stats-achievements',

    // Other endpoints
    '/api/v1/aviation': 'aviation-list',
    '/api/v1/airframes': 'airframes-list',
    '/api/v1/map': 'map-data',
    '/api/v1/antenna': 'antenna-analytics',
    '/api/v1/notams': 'notams-list',
    '/api/v1/archive': 'archive-list',
  };

  // Check for exact match first
  if (eventMap[path]) {
    return eventMap[path];
  }

  // Check for pattern matches (e.g., /api/v1/aircraft/{hex})
  // Aircraft detail: /api/v1/aircraft/{hex}
  if (path.match(/^\/api\/v1\/aircraft\/[^/]+$/)) {
    return 'aircraft-detail';
  }
  // Aircraft info: /api/v1/aircraft/{hex}/info
  if (path.match(/^\/api\/v1\/aircraft\/[^/]+\/info$/)) {
    return 'aircraft-info';
  }
  // Aircraft photo: /api/v1/aircraft/{hex}/photo
  if (path.match(/^\/api\/v1\/aircraft\/[^/]+\/photo/)) {
    return 'photo-cache';
  }
  // Sightings patterns (both /history/sightings and /sightings)
  if (path.match(/^\/api\/v1\/(history\/)?sightings/)) {
    return 'sightings';
  }
  // Safety event detail: /api/v1/safety/events/{id}
  if (path.match(/^\/api\/v1\/safety\/events\/[^/]+$/)) {
    return 'safety-event-detail';
  }
  // Alert rule detail: /api/v1/alerts/rules/{id}
  if (path.match(/^\/api\/v1\/alerts\/rules\/[^/]+$/)) {
    return 'alert-rule-detail';
  }
  // Audio detail: /api/v1/audio/{id}
  if (path.match(/^\/api\/v1\/audio\/[^/]+$/)) {
    return 'audio-detail';
  }
  // Audio match-airframes: /api/v1/audio/{id}/match-airframes
  if (path.match(/^\/api\/v1\/audio\/[^/]+\/match-airframes$/)) {
    return 'audio-match-airframes';
  }
  // Lookup endpoints
  if (path.match(/^\/api\/v1\/lookup\/aircraft\/[^/]+$/)) {
    return 'lookup-aircraft';
  }
  if (path.match(/^\/api\/v1\/lookup\/opensky\/[^/]+$/)) {
    return 'lookup-opensky';
  }
  if (path.match(/^\/api\/v1\/lookup\/route\/[^/]+$/)) {
    return 'lookup-route';
  }

  return null;
}

/**
 * Parse query parameters from endpoint URL.
 * Converts URL query string to object with proper type coercion.
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
      } else if (/^-?\d+\.\d+$/.test(value)) {
        params[key] = parseFloat(value);
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
