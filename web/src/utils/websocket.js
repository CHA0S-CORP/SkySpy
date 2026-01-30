/**
 * WebSocket utility functions for native WebSocket connections.
 *
 * Note: Most components should use Socket.IO hooks instead (from hooks/socket).
 * This module provides utilities for components that still need native WebSocket.
 */

/**
 * Default reconnection configuration
 */
export const RECONNECT_CONFIG = {
  maxAttempts: 10,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 1.5,
  jitterFactor: 0.3,
};

/**
 * Get WebSocket URL from API base URL
 *
 * @param {string} apiBase - API base URL (e.g., 'http://localhost:8000' or '')
 * @param {string} path - WebSocket path (e.g., 'cannonball')
 * @returns {string} WebSocket URL
 */
export function getWebSocketUrl(apiBase, path) {
  try {
    // Parse the base URL
    const url = apiBase ? new URL(apiBase, window.location.origin) : new URL(window.location.origin);

    // Convert protocol to WebSocket protocol
    const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

    // Build the WebSocket URL
    // Django Channels typically uses /ws/ prefix
    return `${wsProtocol}//${url.host}/ws/${path}/`;
  } catch {
    // Fallback to current origin
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${window.location.host}/ws/${path}/`;
  }
}

/**
 * Calculate reconnect delay with exponential backoff and jitter
 *
 * @param {number} attempt - Current reconnection attempt (0-indexed)
 * @param {Object} config - Reconnection configuration
 * @returns {number} Delay in milliseconds
 */
export function getReconnectDelay(attempt, config = RECONNECT_CONFIG) {
  const {
    initialDelay = 1000,
    maxDelay = 30000,
    backoffMultiplier = 1.5,
    jitterFactor = 0.3,
  } = config;

  // Calculate base delay with exponential backoff
  const baseDelay = initialDelay * Math.pow(backoffMultiplier, attempt);

  // Cap at max delay
  const cappedDelay = Math.min(baseDelay, maxDelay);

  // Add jitter to prevent thundering herd
  const jitter = cappedDelay * jitterFactor * (Math.random() * 2 - 1);

  return Math.round(cappedDelay + jitter);
}

export default {
  RECONNECT_CONFIG,
  getWebSocketUrl,
  getReconnectDelay,
};
