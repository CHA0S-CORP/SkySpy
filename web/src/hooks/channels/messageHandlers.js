/**
 * Message handling utilities for WebSocket
 */

/**
 * Process an incoming WebSocket message
 * @param {MessageEvent} event - The WebSocket message event
 * @returns {object|null} Parsed message data or null if invalid
 */
export function parseMessage(event) {
  try {
    const data = JSON.parse(event.data);
    return data;
  } catch (err) {
    console.error('Failed to parse WebSocket message:', err);
    return null;
  }
}

/**
 * Create a subscription message
 */
export function createSubscribeMessage(channels) {
  return {
    action: 'subscribe',
    channels: Array.isArray(channels) ? channels : [channels],
  };
}

/**
 * Create an unsubscription message
 */
export function createUnsubscribeMessage(channels) {
  return {
    action: 'unsubscribe',
    channels: Array.isArray(channels) ? channels : [channels],
  };
}

/**
 * Create a request message with tracking ID
 */
export function createRequestMessage(type, params = {}, requestId) {
  return {
    action: 'request',
    type,
    request_id: requestId,
    params,
  };
}

/**
 * Create a heartbeat (ping) message
 */
export function createPingMessage() {
  return { action: 'ping' };
}
