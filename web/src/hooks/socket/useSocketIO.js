/**
 * Core Socket.IO connection hook with authentication and reconnection.
 *
 * Features:
 * - Socket.IO client connection management
 * - JWT authentication via auth option
 * - Built-in reconnection with exponential backoff (handled by Socket.IO)
 * - Built-in heartbeat/ping-pong (handled by Socket.IO)
 * - Connection state tracking
 *
 * @module useSocketIO
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { getAccessToken } from '../../utils/auth';

/**
 * Get the Socket.IO server URL from API base.
 *
 * @param {string} apiBase - API base URL (e.g., 'http://localhost:8000' or '')
 * @returns {string} Socket.IO server URL
 */
function getSocketIOUrl(apiBase) {
  if (apiBase) {
    try {
      const url = new URL(apiBase, window.location.origin);
      return `${url.protocol}//${url.host}`;
    } catch {
      // Fallback to current origin
      return window.location.origin;
    }
  }
  // Use current origin
  return window.location.origin;
}

/**
 * Core Socket.IO connection hook.
 *
 * @param {Object} options - Configuration options
 * @param {boolean} options.enabled - Whether to connect (default: true)
 * @param {string} options.apiBase - API base URL
 * @param {string} options.namespace - Socket.IO namespace (default: '/')
 * @param {string} options.path - Socket.IO path (default: '/socket.io')
 * @param {Object} options.auth - Additional auth data to include
 * @param {Function} options.onConnect - Connection handler
 * @param {Function} options.onDisconnect - Disconnection handler
 * @param {Function} options.onError - Error handler
 * @param {Function} options.onReconnect - Reconnection handler
 * @param {Object} options.reconnectConfig - Reconnection config override
 * @returns {Object} Socket state and methods
 */
export function useSocketIO({
  enabled = true,
  apiBase = '',
  namespace = '/',
  path = '/socket.io',
  auth = {},
  onConnect,
  onDisconnect,
  onError,
  onReconnect,
  reconnectConfig = {},
} = {}) {
  // Connection state
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  // Refs for socket and mount state
  const socketRef = useRef(null);
  const mountedRef = useRef(true);
  const subscribersRef = useRef(new Map());
  // Store internal event handlers for cleanup
  const internalHandlersRef = useRef(null);

  // Store callbacks in refs to avoid stale closures
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);
  const onErrorRef = useRef(onError);
  const onReconnectRef = useRef(onReconnect);
  const enabledRef = useRef(enabled);
  const apiBaseRef = useRef(apiBase);
  const namespaceRef = useRef(namespace);
  const pathRef = useRef(path);
  const authRef = useRef(auth);

  // Keep refs in sync with props
  useEffect(() => {
    onConnectRef.current = onConnect;
    onDisconnectRef.current = onDisconnect;
    onErrorRef.current = onError;
    onReconnectRef.current = onReconnect;
  }, [onConnect, onDisconnect, onError, onReconnect]);

  useEffect(() => {
    enabledRef.current = enabled;
    apiBaseRef.current = apiBase;
    namespaceRef.current = namespace;
    pathRef.current = path;
    authRef.current = auth;
  }, [enabled, apiBase, namespace, path, auth]);

  /**
   * Connect to Socket.IO server
   */
  const connect = useCallback(() => {
    if (!enabledRef.current || !mountedRef.current) return;
    if (socketRef.current?.connected) return;

    const serverUrl = getSocketIOUrl(apiBaseRef.current);
    const nsPath = namespaceRef.current === '/' ? '' : namespaceRef.current;
    const fullUrl = `${serverUrl}${nsPath}`;

    console.log('[useSocketIO] Connecting to:', fullUrl);

    setConnecting(true);
    setError(null);

    try {
      // Get current auth token
      const accessToken = getAccessToken();

      // Default reconnection config
      const defaultReconnectConfig = {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 30000,
        reconnectionAttempts: Infinity,
        randomizationFactor: 0.3,
      };

      // Create socket with merged config
      const socket = io(fullUrl, {
        path: pathRef.current,
        auth: {
          token: accessToken,
          ...authRef.current,
        },
        transports: ['websocket'],
        ...defaultReconnectConfig,
        ...reconnectConfig,
      });

      socketRef.current = socket;

      // Define event handlers so we can clean them up later
      const handleConnect = () => {
        if (!mountedRef.current) {
          socket.disconnect();
          return;
        }

        console.log('[useSocketIO] Connected, socket id:', socket.id);
        setConnected(true);
        setConnecting(false);
        setReconnectAttempt(0);
        setError(null);

        onConnectRef.current?.();
      };

      const handleDisconnect = (reason) => {
        console.log('[useSocketIO] Disconnected:', reason);

        if (!mountedRef.current) return;

        setConnected(false);

        // Notify disconnect callback
        onDisconnectRef.current?.(reason);
      };

      const handleConnectError = (err) => {
        console.error('[useSocketIO] Connection error:', err.message);

        if (!mountedRef.current) return;

        setConnecting(false);
        setError(err);

        onErrorRef.current?.(err);
      };

      const handleReconnectAttempt = (attempt) => {
        console.log('[useSocketIO] Reconnection attempt:', attempt);
        if (mountedRef.current) {
          setReconnectAttempt(attempt);
          setConnecting(true);
        }
      };

      const handleReconnect = (attempt) => {
        console.log('[useSocketIO] Reconnected after', attempt, 'attempts');
        if (mountedRef.current) {
          setReconnectAttempt(0);
          onReconnectRef.current?.(attempt);
        }
      };

      const handleReconnectError = (err) => {
        console.error('[useSocketIO] Reconnection error:', err.message);
        if (mountedRef.current) {
          setError(err);
        }
      };

      const handleReconnectFailed = () => {
        console.error('[useSocketIO] Reconnection failed - max attempts reached');
        if (mountedRef.current) {
          setConnecting(false);
          setError(new Error('Max reconnection attempts reached'));
        }
      };

      // Store handlers for cleanup
      internalHandlersRef.current = {
        handleConnect,
        handleDisconnect,
        handleConnectError,
        handleReconnectAttempt,
        handleReconnect,
        handleReconnectError,
        handleReconnectFailed,
      };

      // Connection events
      socket.on('connect', handleConnect);
      socket.on('disconnect', handleDisconnect);
      socket.on('connect_error', handleConnectError);

      // Reconnection events (Socket.IO handles these automatically)
      socket.io.on('reconnect_attempt', handleReconnectAttempt);
      socket.io.on('reconnect', handleReconnect);
      socket.io.on('reconnect_error', handleReconnectError);
      socket.io.on('reconnect_failed', handleReconnectFailed);

    } catch (err) {
      console.error('[useSocketIO] Socket creation error:', err);
      setError(err);
      setConnecting(false);
      onErrorRef.current?.(err);
    }
  }, [reconnectConfig]);

  /**
   * Clean up internal event handlers from socket
   */
  const cleanupInternalHandlers = useCallback(() => {
    const socket = socketRef.current;
    const handlers = internalHandlersRef.current;
    if (socket && handlers) {
      socket.off('connect', handlers.handleConnect);
      socket.off('disconnect', handlers.handleDisconnect);
      socket.off('connect_error', handlers.handleConnectError);
      socket.io?.off('reconnect_attempt', handlers.handleReconnectAttempt);
      socket.io?.off('reconnect', handlers.handleReconnect);
      socket.io?.off('reconnect_error', handlers.handleReconnectError);
      socket.io?.off('reconnect_failed', handlers.handleReconnectFailed);
    }
    internalHandlersRef.current = null;
  }, []);

  /**
   * Disconnect from Socket.IO server
   */
  const disconnect = useCallback(() => {
    if (socketRef.current) {
      cleanupInternalHandlers();
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    setConnected(false);
    setConnecting(false);
    setReconnectAttempt(0);
  }, [cleanupInternalHandlers]);

  /**
   * Manually trigger reconnection
   */
  const reconnect = useCallback(() => {
    disconnect();
    // Small delay to allow disconnect to complete
    setTimeout(() => {
      if (mountedRef.current && enabledRef.current) {
        connect();
      }
    }, 100);
  }, [disconnect, connect]);

  // Store connect/disconnect in refs to avoid dependency issues in main effect
  const connectRef = useRef(connect);
  const disconnectRef = useRef(disconnect);
  useEffect(() => {
    connectRef.current = connect;
    disconnectRef.current = disconnect;
  }, [connect, disconnect]);

  /**
   * Emit an event through the socket
   *
   * @param {string} event - Event name
   * @param {any} data - Data to send
   * @param {Function} callback - Optional acknowledgment callback
   * @returns {boolean} Whether the emit was successful
   */
  const emit = useCallback((event, data, callback) => {
    if (socketRef.current?.connected) {
      if (callback) {
        socketRef.current.emit(event, data, callback);
      } else {
        socketRef.current.emit(event, data);
      }
      return true;
    }
    // Silently return false - callers should check isReady before emitting
    // or handle the false return value
    return false;
  }, []);

  /**
   * Subscribe to a socket event
   *
   * @param {string} event - Event name
   * @param {Function} handler - Event handler
   * @returns {Function} Unsubscribe function
   */
  const on = useCallback((event, handler) => {
    if (!socketRef.current) {
      // Return no-op unsubscribe if socket not ready
      return () => {};
    }

    socketRef.current.on(event, handler);

    // Track subscriber for cleanup
    if (!subscribersRef.current.has(event)) {
      subscribersRef.current.set(event, new Set());
    }
    subscribersRef.current.get(event).add(handler);

    // Return unsubscribe function
    return () => {
      socketRef.current?.off(event, handler);
      subscribersRef.current.get(event)?.delete(handler);
    };
  }, []);

  /**
   * Unsubscribe from a socket event
   *
   * @param {string} event - Event name
   * @param {Function} handler - Event handler (optional, removes all if not provided)
   */
  const off = useCallback((event, handler) => {
    if (!socketRef.current) return;

    if (handler) {
      socketRef.current.off(event, handler);
      subscribersRef.current.get(event)?.delete(handler);
    } else {
      socketRef.current.off(event);
      subscribersRef.current.delete(event);
    }
  }, []);

  /**
   * Subscribe to an event once
   *
   * @param {string} event - Event name
   * @param {Function} handler - Event handler
   */
  const once = useCallback((event, handler) => {
    if (!socketRef.current) {
      console.warn('[useSocketIO] Cannot subscribe - socket not initialized');
      return;
    }
    socketRef.current.once(event, handler);
  }, []);

  // Connect on mount and when enabled changes
  // Uses refs for connect/disconnect to avoid triggering effect when functions change
  useEffect(() => {
    mountedRef.current = true;
    enabledRef.current = enabled;

    let connectTimeout = null;

    if (enabled) {
      // Small delay to handle React StrictMode double-mount
      connectTimeout = setTimeout(() => {
        if (mountedRef.current && enabledRef.current) {
          connectRef.current();
        }
      }, 100);
    } else {
      disconnectRef.current();
    }

    return () => {
      if (connectTimeout) {
        clearTimeout(connectTimeout);
      }
      mountedRef.current = false;

      // Clean up all user-subscribed event listeners
      subscribersRef.current.forEach((handlers, event) => {
        handlers.forEach(handler => {
          socketRef.current?.off(event, handler);
        });
      });
      subscribersRef.current.clear();

      // Clean up internal event handlers
      const socket = socketRef.current;
      const handlers = internalHandlersRef.current;
      if (socket && handlers) {
        socket.off('connect', handlers.handleConnect);
        socket.off('disconnect', handlers.handleDisconnect);
        socket.off('connect_error', handlers.handleConnectError);
        socket.io?.off('reconnect_attempt', handlers.handleReconnectAttempt);
        socket.io?.off('reconnect', handlers.handleReconnect);
        socket.io?.off('reconnect_error', handlers.handleReconnectError);
        socket.io?.off('reconnect_failed', handlers.handleReconnectFailed);
      }
      internalHandlersRef.current = null;

      // Disconnect socket
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [enabled]); // Only depend on enabled, use refs for functions

  // Check if socket is actually ready (connected AND socket object exists)
  const isReady = connected && socketRef.current?.connected;

  return {
    // Connection state
    socket: socketRef.current,
    connected,
    connecting,
    error,
    reconnectAttempt,
    // True only when socket is fully ready to use
    isReady,

    // Methods
    connect,
    disconnect,
    reconnect,
    emit,
    on,
    off,
    once,

    // Direct ref access for advanced use cases
    socketRef,
  };
}

export default useSocketIO;
