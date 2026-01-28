import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getWebSocketUrl,
  getReconnectDelay,
  RECONNECT_CONFIG,
  HEARTBEAT_CONFIG,
  WS_STATES,
} from '../utils/websocket';

/**
 * Low-level WebSocket hook with reconnection and heartbeat support.
 *
 * Features:
 * - Native WebSocket connection management
 * - Exponential backoff reconnection (1s -> 30s max)
 * - Heartbeat ping/pong every 30 seconds
 * - Message queuing during reconnection
 * - Connection state tracking
 *
 * @param {Object} options
 * @param {boolean} options.enabled - Whether to connect
 * @param {string} options.apiBase - API base URL
 * @param {string} options.path - WebSocket path (e.g., 'all', 'aircraft')
 * @param {Object} options.queryParams - Optional query parameters
 * @param {Function} options.onMessage - Message handler
 * @param {Function} options.onConnect - Connection handler
 * @param {Function} options.onDisconnect - Disconnection handler
 * @param {Function} options.onError - Error handler
 * @param {Object} options.reconnectConfig - Reconnection config override
 * @param {Object} options.heartbeatConfig - Heartbeat config override
 */
export function useNativeWebSocket({
  enabled = true,
  apiBase = '',
  path = 'all',
  queryParams = {},
  onMessage,
  onConnect,
  onDisconnect,
  onError,
  reconnectConfig = RECONNECT_CONFIG,
  heartbeatConfig = HEARTBEAT_CONFIG,
} = {}) {
  // Connection state
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  // Refs for WebSocket and timers
  const wsRef = useRef(null);
  const mountedRef = useRef(true);
  const reconnectTimeoutRef = useRef(null);
  const heartbeatIntervalRef = useRef(null);
  const heartbeatTimeoutRef = useRef(null);
  const messageQueueRef = useRef([]);
  const subscribersRef = useRef(new Set());

  // Store values in refs to avoid stale closures in reconnection logic
  const reconnectAttemptRef = useRef(0);
  const enabledRef = useRef(enabled);
  const apiBaseRef = useRef(apiBase);
  const pathRef = useRef(path);
  const queryParamsRef = useRef(queryParams);
  const reconnectConfigRef = useRef(reconnectConfig);

  // Store callbacks in refs to avoid stale closures
  const onMessageRef = useRef(onMessage);
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);
  const onErrorRef = useRef(onError);

  // Keep refs in sync with props
  useEffect(() => {
    enabledRef.current = enabled;
    apiBaseRef.current = apiBase;
    pathRef.current = path;
    queryParamsRef.current = queryParams;
    reconnectConfigRef.current = reconnectConfig;
  }, [enabled, apiBase, path, queryParams, reconnectConfig]);

  useEffect(() => {
    onMessageRef.current = onMessage;
    onConnectRef.current = onConnect;
    onDisconnectRef.current = onDisconnect;
    onErrorRef.current = onError;
  }, [onMessage, onConnect, onDisconnect, onError]);

  /**
   * Clear all timers
   */
  const clearTimers = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = null;
    }
  }, []);

  /**
   * Start heartbeat ping/pong
   */
  const startHeartbeat = useCallback(() => {
    // Clear existing heartbeat
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
    }
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
    }

    heartbeatIntervalRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WS_STATES.OPEN) {
        // Send ping
        try {
          wsRef.current.send(JSON.stringify({ action: 'ping' }));

          // Set timeout for pong response
          heartbeatTimeoutRef.current = setTimeout(() => {
            console.warn('WebSocket heartbeat timeout, reconnecting...');
            // Force close and reconnect
            if (wsRef.current) {
              wsRef.current.close(4000, 'Heartbeat timeout');
            }
          }, heartbeatConfig.timeout);
        } catch (err) {
          console.error('WebSocket heartbeat error:', err);
        }
      }
    }, heartbeatConfig.interval);
  }, [heartbeatConfig.interval, heartbeatConfig.timeout]);

  /**
   * Handle pong response - clear heartbeat timeout
   */
  const handlePong = useCallback(() => {
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = null;
    }
  }, []);

  /**
   * Flush message queue
   */
  const flushMessageQueue = useCallback(() => {
    if (wsRef.current?.readyState === WS_STATES.OPEN) {
      while (messageQueueRef.current.length > 0) {
        const message = messageQueueRef.current.shift();
        try {
          wsRef.current.send(JSON.stringify(message));
        } catch (err) {
          console.error('WebSocket send error:', err);
          // Put message back in queue
          messageQueueRef.current.unshift(message);
          break;
        }
      }
    }
  }, []);

  /**
   * Connect to WebSocket
   */
  const connect = useCallback(() => {
    if (!enabledRef.current || !mountedRef.current) return;
    if (wsRef.current?.readyState === WS_STATES.OPEN) return;
    if (wsRef.current?.readyState === WS_STATES.CONNECTING) return;

    const url = getWebSocketUrl(apiBaseRef.current, pathRef.current, queryParamsRef.current);
    console.log('WebSocket connecting to:', url);

    setConnecting(true);
    setError(null);

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) {
          ws.close();
          return;
        }

        console.log('WebSocket connected:', url);
        setConnected(true);
        setConnecting(false);
        reconnectAttemptRef.current = 0;
        setReconnectAttempt(0);
        setError(null);

        // Start heartbeat
        startHeartbeat();

        // Flush queued messages
        flushMessageQueue();

        // Call onConnect callback
        onConnectRef.current?.();
      };

      ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);

        if (!mountedRef.current) return;

        setConnected(false);
        setConnecting(false);
        clearTimers();

        // Call onDisconnect callback
        onDisconnectRef.current?.(event.code, event.reason);

        // Schedule reconnection if enabled and not a clean close
        // Code 1000 = normal closure, 1001 = going away (page unload)
        const shouldReconnect = enabledRef.current &&
                                mountedRef.current &&
                                event.code !== 1000 &&
                                event.code !== 1001;

        if (shouldReconnect) {
          const currentAttempt = reconnectAttemptRef.current;
          const delay = getReconnectDelay(currentAttempt, reconnectConfigRef.current);
          console.log(`WebSocket reconnecting in ${delay}ms (attempt ${currentAttempt + 1})`);

          reconnectAttemptRef.current = currentAttempt + 1;
          setReconnectAttempt(currentAttempt + 1);

          reconnectTimeoutRef.current = setTimeout(() => {
            if (mountedRef.current && enabledRef.current) {
              connect();
            }
          }, delay);
        }
      };

      ws.onerror = (event) => {
        console.error('WebSocket error:', event);

        if (!mountedRef.current) return;

        const err = new Error('WebSocket connection error');
        setError(err);
        onErrorRef.current?.(err);

        // Note: onerror is always followed by onclose, so reconnection
        // will be handled in onclose handler
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;

        try {
          const data = JSON.parse(event.data);

          // Handle pong response (can be type: 'pong' or action: 'pong')
          if (data.type === 'pong' || data.action === 'pong') {
            handlePong();
            return;
          }

          // Handle heartbeat from server (Django Channels may send these)
          if (data.type === 'heartbeat' || data.type === 'ping') {
            // Respond to server ping with pong
            if (wsRef.current?.readyState === WS_STATES.OPEN) {
              wsRef.current.send(JSON.stringify({ action: 'pong' }));
            }
            return;
          }

          // Notify all subscribers
          subscribersRef.current.forEach(handler => {
            try {
              handler(data);
            } catch (err) {
              console.error('WebSocket message handler error:', err);
            }
          });

          // Call onMessage callback
          onMessageRef.current?.(data);
        } catch (err) {
          console.error('WebSocket message parse error:', err);
        }
      };
    } catch (err) {
      console.error('WebSocket creation error:', err);
      setError(err);
      setConnecting(false);
      onErrorRef.current?.(err);

      // Schedule reconnection on creation error
      if (enabledRef.current && mountedRef.current) {
        const currentAttempt = reconnectAttemptRef.current;
        const delay = getReconnectDelay(currentAttempt, reconnectConfigRef.current);
        console.log(`WebSocket reconnecting after error in ${delay}ms (attempt ${currentAttempt + 1})`);

        reconnectAttemptRef.current = currentAttempt + 1;
        setReconnectAttempt(currentAttempt + 1);

        reconnectTimeoutRef.current = setTimeout(() => {
          if (mountedRef.current && enabledRef.current) {
            connect();
          }
        }, delay);
      }
    }
  }, [startHeartbeat, flushMessageQueue, clearTimers, handlePong]);

  /**
   * Close WebSocket connection
   */
  const close = useCallback(() => {
    clearTimers();

    if (wsRef.current) {
      wsRef.current.close(1000, 'Client closing');
      wsRef.current = null;
    }

    setConnected(false);
    setConnecting(false);
    reconnectAttemptRef.current = 0;
    setReconnectAttempt(0);
  }, [clearTimers]);

  /**
   * Manually trigger reconnection
   */
  const reconnect = useCallback(() => {
    close();
    reconnectAttemptRef.current = 0;
    setReconnectAttempt(0);
    // Small delay to allow close to complete
    setTimeout(() => {
      if (mountedRef.current && enabledRef.current) {
        connect();
      }
    }, 100);
  }, [close, connect]);

  /**
   * Send a message through WebSocket
   * @param {Object} message - Message object to send
   * @param {boolean} queue - Whether to queue if not connected (default: true)
   */
  const send = useCallback((message, queue = true) => {
    if (wsRef.current?.readyState === WS_STATES.OPEN) {
      try {
        wsRef.current.send(JSON.stringify(message));
        return true;
      } catch (err) {
        console.error('WebSocket send error:', err);
        if (queue) {
          messageQueueRef.current.push(message);
        }
        return false;
      }
    } else if (queue) {
      messageQueueRef.current.push(message);
      return false;
    }
    return false;
  }, []);

  /**
   * Subscribe to messages
   * @param {Function} handler - Message handler function
   * @returns {Function} Unsubscribe function
   */
  const subscribe = useCallback((handler) => {
    subscribersRef.current.add(handler);
    return () => {
      subscribersRef.current.delete(handler);
    };
  }, []);

  // Connect on mount and when enabled changes
  useEffect(() => {
    mountedRef.current = true;
    enabledRef.current = enabled;

    if (enabled) {
      connect();
    } else {
      // Disconnect if disabled
      close();
    }

    return () => {
      // Clear reconnect timeout FIRST to prevent race condition where
      // reconnect fires after mountedRef is set to false but before cleanup completes
      clearTimers();
      mountedRef.current = false;
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounting');
        wsRef.current = null;
      }
    };
  }, [enabled, connect, close, clearTimers]);

  // Update refs when apiBase or path changes (reconnection handled by main connect effect)
  useEffect(() => {
    apiBaseRef.current = apiBase;
    pathRef.current = path;
  }, [apiBase, path]);

  return {
    connected,
    connecting,
    error,
    reconnectAttempt,
    send,
    subscribe,
    reconnect,
    close,
    // Direct ref access for advanced use cases
    wsRef,
    messageQueueRef,
  };
}

export default useNativeWebSocket;
