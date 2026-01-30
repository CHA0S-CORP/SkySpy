/**
 * WebSocket configuration constants and utilities
 *
 * Note: Most socket functionality now uses Socket.IO hooks (from hooks/socket).
 * This module provides shared config that's re-exported from utils/websocket.js.
 */

import {
  RECONNECT_CONFIG,
  getWebSocketUrl,
  getReconnectDelay as getReconnectDelayWithBackoff,
} from '../../utils/websocket';

// Re-export the unified reconnection config
export { RECONNECT_CONFIG };

// Legacy exports for backward compatibility
export const MAX_RECONNECT_ATTEMPTS = RECONNECT_CONFIG.maxAttempts;

// Heartbeat settings (Socket.IO handles these automatically, but kept for native WS)
export const HEARTBEAT_INTERVAL = 30000;
export const HEARTBEAT_TIMEOUT = 10000;

// Request settings
export const DEFAULT_REQUEST_TIMEOUT = 30000;

/**
 * Build WebSocket URL from base URL and path
 * Re-exports from utils/websocket.js for consistency
 */
export function buildWebSocketUrl(apiBase, path = 'ws/channels') {
  if (!apiBase) return null;

  // Remove trailing slash
  const base = apiBase.replace(/\/$/, '');

  // Convert http(s) to ws(s)
  const wsBase = base.replace(/^http/, 'ws');

  // Build full URL
  return `${wsBase}/${path}/`;
}

/**
 * Calculate reconnection delay based on attempt number.
 * Uses exponential backoff with jitter from the unified config.
 */
export function getReconnectDelay(attempt) {
  return getReconnectDelayWithBackoff(attempt, RECONNECT_CONFIG);
}
