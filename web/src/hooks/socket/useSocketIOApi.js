/**
 * Socket.IO request/response pattern hook with HTTP fallback.
 *
 * Features:
 * - Provides request(type, params) -> Promise pattern
 * - Handles timeouts with configurable duration
 * - Falls back to HTTP when socket unavailable
 * - Tracks pending requests
 *
 * @module useSocketIOApi
 */

import { useRef, useCallback, useEffect } from 'react';
import { useSocketIO } from './useSocketIO';
import { getAccessToken } from '../../utils/auth';

/**
 * Default request timeout in milliseconds
 */
const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Build API URL for HTTP fallback
 *
 * @param {string} apiBase - API base URL
 * @param {string} endpoint - API endpoint
 * @returns {string} Full API URL
 */
function buildApiUrl(apiBase, endpoint) {
  const base = apiBase || window.location.origin;
  // Ensure endpoint starts with /
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  // Ensure base doesn't end with /
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${cleanBase}${path}`;
}

/**
 * Make HTTP request as fallback
 *
 * @param {string} apiBase - API base URL
 * @param {string} type - Request type
 * @param {Object} params - Request parameters
 * @returns {Promise<any>} Response data
 */
async function httpFallback(apiBase, type, params) {
  // Map request types to API endpoints
  const endpointMap = {
    // Aircraft
    'aircraft:list': '/api/aircraft/',
    'aircraft:detail': `/api/aircraft/${params.hex}/`,
    'aircraft:history': `/api/aircraft/${params.hex}/history/`,

    // Safety
    'safety:list': '/api/safety/events/',
    'safety:detail': `/api/safety/events/${params.id}/`,

    // Alerts
    'alert:list': '/api/alerts/',
    'alert:detail': `/api/alerts/${params.id}/`,
    'alert:test': `/api/alerts/${params.id}/test/`,

    // ACARS
    'acars:list': '/api/acars/',
    'acars:detail': `/api/acars/${params.id}/`,

    // Audio
    'audio:list': '/api/audio/',
    'audio:detail': `/api/audio/${params.id}/`,

    // Airspace
    'airspace:advisories': '/api/airspace/advisories/',
    'airspace:boundaries': '/api/airspace/boundaries/',

    // Stats
    'stats:overview': '/api/stats/',
    'stats:aircraft': '/api/stats/aircraft/',

    // System
    'system:status': '/api/system/status/',
    'system:health': '/api/system/health/',
  };

  const endpoint = endpointMap[type];
  if (!endpoint) {
    throw new Error(`Unknown request type: ${type}`);
  }

  const url = buildApiUrl(apiBase, endpoint);
  const token = getAccessToken();

  const headers = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Determine HTTP method and body based on request type
  let method = 'GET';
  let body = null;

  if (type.includes(':create') || type.includes(':test')) {
    method = 'POST';
    body = JSON.stringify(params);
  } else if (type.includes(':update')) {
    method = 'PUT';
    body = JSON.stringify(params);
  } else if (type.includes(':delete')) {
    method = 'DELETE';
  }

  const response = await fetch(url, {
    method,
    headers,
    body,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Socket.IO request/response pattern hook.
 *
 * Provides a clean request(type, params) -> Promise interface for
 * making requests over Socket.IO with automatic timeout handling
 * and HTTP fallback when the socket is unavailable.
 *
 * @param {Object} options - Configuration options
 * @param {boolean} options.enabled - Whether to connect (default: true)
 * @param {string} options.apiBase - API base URL
 * @param {number} options.defaultTimeout - Default timeout in ms (default: 10000)
 * @param {boolean} options.autoFallback - Auto fallback to HTTP (default: true)
 * @returns {Object} API state and methods
 */
export function useSocketIOApi({
  enabled = true,
  apiBase = '',
  defaultTimeout = DEFAULT_TIMEOUT_MS,
  autoFallback = true,
} = {}) {
  // Pending requests map
  const pendingRequests = useRef(new Map());
  const mountedRef = useRef(true);
  const apiBaseRef = useRef(apiBase);
  const autoFallbackRef = useRef(autoFallback);

  // Keep refs in sync
  useEffect(() => {
    apiBaseRef.current = apiBase;
    autoFallbackRef.current = autoFallback;
  }, [apiBase, autoFallback]);

  /**
   * Handle response events
   */
  const handleResponse = useCallback((data) => {
    const requestId = data?.request_id;
    if (!requestId || !pendingRequests.current.has(requestId)) {
      return;
    }

    const { resolve, timeoutId } = pendingRequests.current.get(requestId);
    clearTimeout(timeoutId);
    pendingRequests.current.delete(requestId);

    resolve(data.data ?? data);
  }, []);

  /**
   * Handle error events
   */
  const handleError = useCallback((data) => {
    const requestId = data?.request_id;
    if (!requestId || !pendingRequests.current.has(requestId)) {
      return;
    }

    const { reject, timeoutId } = pendingRequests.current.get(requestId);
    clearTimeout(timeoutId);
    pendingRequests.current.delete(requestId);

    reject(new Error(data.message || data.error || 'Request failed'));
  }, []);

  // Setup Socket.IO connection
  const {
    connected,
    connecting,
    error: socketError,
    emit,
    on,
    reconnect,
  } = useSocketIO({
    enabled,
    apiBase,
    namespace: '/',
    path: '/socket.io',
  });

  // Setup event listeners for response/error
  useEffect(() => {
    if (!enabled) return;

    const unsubResponse = on('response', handleResponse);
    const unsubError = on('error', handleError);

    return () => {
      unsubResponse?.();
      unsubError?.();
    };
  }, [enabled, on, handleResponse, handleError]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      // Clear all pending requests
      pendingRequests.current.forEach(({ reject, timeoutId }) => {
        clearTimeout(timeoutId);
        reject(new Error('Component unmounted'));
      });
      pendingRequests.current.clear();
    };
  }, []);

  /**
   * Make a request over Socket.IO with optional HTTP fallback.
   *
   * @param {string} type - Request type (e.g., 'aircraft:list', 'safety:detail')
   * @param {Object} params - Request parameters
   * @param {Object} options - Request options
   * @param {number} options.timeout - Timeout in milliseconds
   * @param {boolean} options.fallback - Use HTTP fallback if socket unavailable
   * @returns {Promise<any>} Response data
   */
  const request = useCallback(async (type, params = {}, options = {}) => {
    const { timeout = defaultTimeout, fallback = autoFallbackRef.current } = options;

    // If not connected and fallback enabled, use HTTP
    if (!connected && fallback) {
      console.log('[useSocketIOApi] Socket not connected, using HTTP fallback for:', type);
      return httpFallback(apiBaseRef.current, type, params);
    }

    // If not connected and no fallback, reject
    if (!connected) {
      throw new Error('Socket.IO not connected');
    }

    return new Promise((resolve, reject) => {
      // Generate unique request ID
      const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Setup timeout
      const timeoutId = setTimeout(() => {
        if (pendingRequests.current.has(requestId)) {
          pendingRequests.current.delete(requestId);

          // Try HTTP fallback on timeout if enabled
          if (fallback && mountedRef.current) {
            console.log('[useSocketIOApi] Socket request timeout, trying HTTP fallback for:', type);
            httpFallback(apiBaseRef.current, type, params)
              .then((result) => {
                // Guard against unmounted component
                if (mountedRef.current) {
                  resolve(result);
                }
              })
              .catch((err) => {
                // Guard against unmounted component
                if (mountedRef.current) {
                  reject(err);
                }
              });
          } else if (mountedRef.current) {
            reject(new Error(`Request timeout: ${type}`));
          }
          // If not mounted and no fallback, promise stays pending (will be GC'd)
        }
      }, timeout);

      // Store pending request
      pendingRequests.current.set(requestId, { resolve, reject, timeoutId });

      // Send request
      emit('request', {
        type,
        request_id: requestId,
        params,
      });
    });
  }, [connected, defaultTimeout, emit]);

  /**
   * Make a request that only uses HTTP (bypasses socket).
   *
   * @param {string} type - Request type
   * @param {Object} params - Request parameters
   * @returns {Promise<any>} Response data
   */
  const httpRequest = useCallback((type, params = {}) => {
    return httpFallback(apiBaseRef.current, type, params);
  }, []);

  /**
   * Cancel a pending request.
   *
   * @param {string} requestId - Request ID to cancel
   */
  const cancelRequest = useCallback((requestId) => {
    if (pendingRequests.current.has(requestId)) {
      const { reject, timeoutId } = pendingRequests.current.get(requestId);
      clearTimeout(timeoutId);
      pendingRequests.current.delete(requestId);
      reject(new Error('Request cancelled'));
    }
  }, []);

  /**
   * Cancel all pending requests.
   */
  const cancelAllRequests = useCallback(() => {
    pendingRequests.current.forEach(({ reject, timeoutId }) => {
      clearTimeout(timeoutId);
      reject(new Error('All requests cancelled'));
    });
    pendingRequests.current.clear();
  }, []);

  /**
   * Get count of pending requests.
   *
   * @returns {number} Number of pending requests
   */
  const getPendingCount = useCallback(() => {
    return pendingRequests.current.size;
  }, []);

  return {
    // Connection state
    connected,
    connecting,
    error: socketError,

    // Request methods
    request,
    httpRequest,
    cancelRequest,
    cancelAllRequests,
    getPendingCount,

    // Socket control
    reconnect,
  };
}

export default useSocketIOApi;
