/**
 * WebSocket configuration constants and utilities
 */

// Reconnection settings
export const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000];
export const MAX_RECONNECT_ATTEMPTS = 10;

// Heartbeat settings
export const HEARTBEAT_INTERVAL = 30000;
export const HEARTBEAT_TIMEOUT = 10000;

// Request settings
export const DEFAULT_REQUEST_TIMEOUT = 30000;

/**
 * Build WebSocket URL from base URL and path
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
 * Calculate reconnection delay based on attempt number
 */
export function getReconnectDelay(attempt) {
  const index = Math.min(attempt, RECONNECT_DELAYS.length - 1);
  return RECONNECT_DELAYS[index];
}
