/**
 * Socket.IO request/response pattern hook (no HTTP fallback).
 *
 * Features:
 * - Provides request(type, params) -> Promise pattern
 * - Handles timeouts with configurable duration
 * - Rejects with clear error when socket unavailable
 * - Tracks pending requests
 *
 * @module useSocketIOApi
 */

import { useRef, useCallback, useEffect } from 'react';
import { useSocketIO } from './useSocketIO';

/**
 * Default request timeout in milliseconds
 */
const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Socket.IO request/response pattern hook.
 *
 * Provides a clean request(type, params) -> Promise interface for
 * making requests over Socket.IO with automatic timeout handling.
 * No HTTP fallback - requires socket connection.
 *
 * @param {Object} options - Configuration options
 * @param {boolean} options.enabled - Whether to connect (default: true)
 * @param {string} options.apiBase - API base URL
 * @param {number} options.defaultTimeout - Default timeout in ms (default: 10000)
 * @returns {Object} API state and methods
 */
export function useSocketIOApi({
  enabled = true,
  apiBase = '',
  defaultTimeout = DEFAULT_TIMEOUT_MS,
} = {}) {
  // Pending requests map
  const pendingRequests = useRef(new Map());
  const mountedRef = useRef(true);

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
   * Make a request over Socket.IO.
   *
   * @param {string} type - Request type (e.g., 'aircraft:list', 'safety:detail')
   * @param {Object} params - Request parameters
   * @param {Object} options - Request options
   * @param {number} options.timeout - Timeout in milliseconds
   * @returns {Promise<any>} Response data
   */
  const request = useCallback(
    async (type, params = {}, options = {}) => {
      const { timeout = defaultTimeout } = options;

      // If not connected, reject with clear error
      if (!connected) {
        return Promise.reject(new Error('Socket.IO not connected'));
      }

      return new Promise((resolve, reject) => {
        // Generate unique request ID
        const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Setup timeout
        const timeoutId = setTimeout(() => {
          if (pendingRequests.current.has(requestId)) {
            pendingRequests.current.delete(requestId);
            if (mountedRef.current) {
              reject(new Error(`Request timeout: ${type}`));
            }
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
    },
    [connected, defaultTimeout, emit]
  );

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
    cancelRequest,
    cancelAllRequests,
    getPendingCount,

    // Socket control
    reconnect,
  };
}

export default useSocketIOApi;
