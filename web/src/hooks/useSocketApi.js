import { useState, useEffect, useCallback, useRef } from 'react';
import { parseDRFError } from './useApi';

/**
 * WebSocket-first API hook with HTTP fallback for Django REST Framework.
 * Uses WebSocket for data fetching when connected, with HTTP fallback.
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
  // Update refs synchronously to avoid stale values in callbacks
  const wsRequestRef = useRef(wsRequest);
  const wsConnectedRef = useRef(wsConnected);
  const socketParamsRef = useRef(socketParams);

  // Update refs synchronously on each render to ensure callbacks always have current values
  // This avoids the race condition where fetchData runs before the effect updates refs
  wsRequestRef.current = wsRequest;
  wsConnectedRef.current = wsConnected;
  socketParamsRef.current = socketParams;

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

      // Try WebSocket first if available and not disabled (use refs for current values)
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
        const baseUrl = (apiBase || '').replace(/\/$/, ''); // Strip trailing slash
        const res = await fetch(`${baseUrl}${endpoint}`);

        // Check content type before parsing JSON
        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          throw new Error('Invalid response format');
        }

        const json = await res.json();

        // Handle Django REST Framework error responses
        if (!res.ok) {
          const errorMessage = parseDRFError(json);
          throw new Error(errorMessage);
        }

        result = json;
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
    '/api/v1/history/top': 'history-top',
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
    '/api/v1/safety/stats': 'safety-stats',
    '/api/v1/safety/events': 'safety-events',
    '/api/v1/safety/monitor/status': 'safety-status',

    // Alerts endpoints (Django ViewSets with nested routes)
    '/api/v1/alerts/rules': 'alerts-rules',
    '/api/v1/alerts/history': 'alerts-history',
    '/api/v1/alerts/subscriptions': 'alerts-subscriptions',

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
