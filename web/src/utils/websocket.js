// ============================================================================
// WebSocket URL Utilities for Django Channels
// ============================================================================

import { getAccessToken } from './auth';

/**
 * Build a WebSocket URL for Django Channels endpoints.
 *
 * @param {string} apiBase - API base URL (e.g., 'http://localhost:8000' or '')
 * @param {string} path - WebSocket path (e.g., 'all', 'aircraft', 'safety')
 * @param {Object} queryParams - Optional query parameters (e.g., { topics: 'positions' })
 * @param {boolean} includeAuth - Whether to include auth token (default: true)
 * @returns {string} Full WebSocket URL
 */
export function getWebSocketUrl(apiBase, path = 'all', queryParams = {}, includeAuth = true) {
  let wsUrl;

  if (apiBase) {
    try {
      const url = new URL(apiBase, window.location.origin);
      const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${url.host}/ws/${path}/`;
    } catch (e) {
      // Fallback to current origin
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${window.location.host}/ws/${path}/`;
    }
  } else {
    // Use current origin
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl = `${protocol}//${window.location.host}/ws/${path}/`;
  }

  // Add query parameters
  const params = new URLSearchParams();

  // Note: Auth token is passed via query params for WebSocket connections because
  // the WebSocket API doesn't support custom headers. Django Channels handles this
  // securely via its TokenAuthMiddleware. The token is transmitted over WSS (TLS)
  // in production, mitigating exposure risks. For enhanced security in highly
  // sensitive environments, consider using ticket-based authentication.
  if (includeAuth) {
    const token = getAccessToken();
    if (token) {
      params.append('token', token);
    }
  }

  for (const [key, value] of Object.entries(queryParams)) {
    if (value !== null && value !== undefined) {
      params.append(key, Array.isArray(value) ? value.join(',') : value);
    }
  }

  const queryString = params.toString();
  if (queryString) {
    wsUrl += `?${queryString}`;
  }

  return wsUrl;
}

/**
 * Check if WebSocket is supported in this browser.
 * @returns {boolean}
 */
export function isWebSocketSupported() {
  return typeof WebSocket !== 'undefined';
}

/**
 * WebSocket connection states
 */
export const WS_STATES = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
};

/**
 * Reconnection configuration
 */
export const RECONNECT_CONFIG = {
  initialDelay: 1000,      // Start with 1 second
  maxDelay: 30000,         // Cap at 30 seconds
  multiplier: 2,           // Double the delay each attempt
  jitter: 0.3,             // Add 0-30% random jitter
  maxAttempts: Infinity,   // Keep trying forever
};

/**
 * Calculate next reconnection delay with exponential backoff and jitter.
 *
 * @param {number} attempt - Current attempt number (0-based)
 * @param {Object} config - Reconnection config
 * @returns {number} Delay in milliseconds
 */
export function getReconnectDelay(attempt, config = RECONNECT_CONFIG) {
  const baseDelay = Math.min(
    config.initialDelay * Math.pow(config.multiplier, attempt),
    config.maxDelay
  );

  // Add jitter: random value between 0 and jitter * baseDelay
  const jitterAmount = baseDelay * config.jitter * Math.random();

  return Math.floor(baseDelay + jitterAmount);
}

/**
 * Heartbeat configuration
 */
export const HEARTBEAT_CONFIG = {
  interval: 30000,         // Send ping every 30 seconds
  timeout: 10000,          // Wait 10 seconds for pong
};
