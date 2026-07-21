import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSocketIO } from './useSocketIO';

// Mock socket.io-client
const mockSocket = {
  id: 'test-socket-id',
  connected: false,
  on: vi.fn(),
  off: vi.fn(),
  once: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
  io: {
    on: vi.fn(),
    off: vi.fn(),
  },
};

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}));

// Mock auth utility
vi.mock('../../utils/auth', () => ({
  getAccessToken: vi.fn(() => 'test-token'),
}));

import { io } from 'socket.io-client';
import { getAccessToken } from '../../utils/auth';

describe('useSocketIO', () => {
  let connectHandler;
  let disconnectHandler;
  let errorHandler;
  let reconnectAttemptHandler;
  let reconnectHandler;
  let reconnectErrorHandler;
  let reconnectFailedHandler;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mock socket state
    mockSocket.connected = false;
    mockSocket.id = 'test-socket-id';

    // Capture event handlers
    mockSocket.on.mockImplementation((event, handler) => {
      if (event === 'connect') connectHandler = handler;
      if (event === 'disconnect') disconnectHandler = handler;
      if (event === 'connect_error') errorHandler = handler;
    });

    mockSocket.io.on.mockImplementation((event, handler) => {
      if (event === 'reconnect_attempt') reconnectAttemptHandler = handler;
      if (event === 'reconnect') reconnectHandler = handler;
      if (event === 'reconnect_error') reconnectErrorHandler = handler;
      if (event === 'reconnect_failed') reconnectFailedHandler = handler;
    });

    io.mockReturnValue(mockSocket);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should start with disconnected state', () => {
      const { result } = renderHook(() => useSocketIO({ enabled: false }));

      expect(result.current.connected).toBe(false);
      expect(result.current.connecting).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.reconnectAttempt).toBe(0);
      expect(result.current.isReady).toBe(false);
    });

    it('should not connect when disabled', () => {
      renderHook(() => useSocketIO({ enabled: false }));

      expect(io).not.toHaveBeenCalled();
    });

    it('should connect automatically when enabled', () => {
      renderHook(() =>
        useSocketIO({
          enabled: true,
          apiBase: 'http://localhost:8000',
          namespace: '/',
          path: '/socket.io',
        })
      );

      expect(io).toHaveBeenCalledWith(
        'http://localhost:8000',
        expect.objectContaining({
          path: '/socket.io',
          // auth is a function so each reconnect attempt reads the current token
          auth: expect.any(Function),
          transports: ['polling', 'websocket'],
        })
      );

      // The auth function should provide the current token
      let authPayload;
      io.mock.calls[0][1].auth((payload) => {
        authPayload = payload;
      });
      expect(authPayload).toEqual(expect.objectContaining({ token: 'test-token' }));
    });

    it('should use namespace when provided', () => {
      renderHook(() =>
        useSocketIO({
          enabled: true,
          apiBase: 'http://localhost:8000',
          namespace: '/alerts',
        })
      );

      expect(io).toHaveBeenCalledWith('http://localhost:8000/alerts', expect.any(Object));
    });

    it('should use current origin when no apiBase provided', () => {
      // Mock window.location.origin
      const originalOrigin = window.location.origin;
      Object.defineProperty(window, 'location', {
        value: { origin: 'http://test.example.com' },
        writable: true,
      });

      renderHook(() =>
        useSocketIO({
          enabled: true,
          namespace: '/',
        })
      );

      expect(io).toHaveBeenCalledWith('http://test.example.com', expect.any(Object));

      window.location.origin = originalOrigin;
    });
  });

  describe('connection lifecycle', () => {
    it('should set connecting state when connecting', () => {
      const { result } = renderHook(() =>
        useSocketIO({
          enabled: true,
          apiBase: 'http://localhost:8000',
        })
      );

      expect(result.current.connecting).toBe(true);
    });

    it('should update state on successful connection', () => {
      const onConnect = vi.fn();

      const { result } = renderHook(() =>
        useSocketIO({
          enabled: true,
          apiBase: 'http://localhost:8000',
          onConnect,
        })
      );

      // Simulate successful connection
      mockSocket.connected = true;
      act(() => {
        connectHandler();
      });

      expect(result.current.connected).toBe(true);
      expect(result.current.connecting).toBe(false);
      expect(result.current.isReady).toBe(true);
      expect(result.current.error).toBeNull();
      expect(onConnect).toHaveBeenCalled();
    });

    it('should update state on disconnection', () => {
      const onDisconnect = vi.fn();

      const { result } = renderHook(() =>
        useSocketIO({
          enabled: true,
          apiBase: 'http://localhost:8000',
          onDisconnect,
        })
      );

      // First connect
      mockSocket.connected = true;
      act(() => {
        connectHandler();
      });

      expect(result.current.connected).toBe(true);

      // Then disconnect
      mockSocket.connected = false;
      act(() => {
        disconnectHandler('transport close');
      });

      expect(result.current.connected).toBe(false);
      expect(result.current.isReady).toBe(false);
      expect(onDisconnect).toHaveBeenCalledWith('transport close');
    });

    it('should handle connection errors', () => {
      const onError = vi.fn();

      const { result } = renderHook(() =>
        useSocketIO({
          enabled: true,
          apiBase: 'http://localhost:8000',
          onError,
        })
      );

      const error = new Error('Connection refused');
      act(() => {
        errorHandler(error);
      });

      expect(result.current.error).toBe(error);
      expect(result.current.connecting).toBe(false);
      expect(onError).toHaveBeenCalledWith(error);
    });
  });

  describe('reconnection', () => {
    it('should track reconnection attempts', () => {
      const { result } = renderHook(() =>
        useSocketIO({
          enabled: true,
          apiBase: 'http://localhost:8000',
        })
      );

      act(() => {
        reconnectAttemptHandler(1);
      });

      expect(result.current.reconnectAttempt).toBe(1);
      expect(result.current.connecting).toBe(true);

      act(() => {
        reconnectAttemptHandler(2);
      });

      expect(result.current.reconnectAttempt).toBe(2);
    });

    it('should call onReconnect after successful reconnection', () => {
      const onReconnect = vi.fn();

      const { result } = renderHook(() =>
        useSocketIO({
          enabled: true,
          apiBase: 'http://localhost:8000',
          onReconnect,
        })
      );

      act(() => {
        reconnectHandler(3);
      });

      expect(result.current.reconnectAttempt).toBe(0);
      expect(onReconnect).toHaveBeenCalledWith(3);
    });

    it('should handle reconnection errors', () => {
      const { result } = renderHook(() =>
        useSocketIO({
          enabled: true,
          apiBase: 'http://localhost:8000',
        })
      );

      const error = new Error('Reconnection failed');
      act(() => {
        reconnectErrorHandler(error);
      });

      expect(result.current.error).toBe(error);
    });

    it('should handle max reconnection attempts reached', () => {
      const { result } = renderHook(() =>
        useSocketIO({
          enabled: true,
          apiBase: 'http://localhost:8000',
        })
      );

      act(() => {
        reconnectFailedHandler();
      });

      expect(result.current.connecting).toBe(false);
      expect(result.current.error?.message).toBe('Max reconnection attempts reached');
    });
  });

  describe('manual connection control', () => {
    it('should disconnect when disconnect() is called', () => {
      const { result } = renderHook(() =>
        useSocketIO({
          enabled: true,
          apiBase: 'http://localhost:8000',
        })
      );

      // First connect
      mockSocket.connected = true;
      act(() => {
        connectHandler();
      });

      expect(result.current.connected).toBe(true);

      act(() => {
        result.current.disconnect();
      });

      expect(mockSocket.disconnect).toHaveBeenCalled();
      expect(result.current.connected).toBe(false);
      expect(result.current.isReady).toBe(false);
    });

    it('should reconnect when reconnect() is called', async () => {
      vi.useFakeTimers();

      const { result } = renderHook(() =>
        useSocketIO({
          enabled: true,
          apiBase: 'http://localhost:8000',
        })
      );

      // Reset call count after initial connection
      io.mockClear();

      act(() => {
        result.current.reconnect();
      });

      // Wait for the reconnect timeout
      await act(async () => {
        await vi.advanceTimersByTimeAsync(150);
      });

      expect(mockSocket.disconnect).toHaveBeenCalled();
      expect(io).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should allow manual connect when enabled', () => {
      const { result } = renderHook(() =>
        useSocketIO({
          enabled: true,
          apiBase: 'http://localhost:8000',
        })
      );

      // Reset after initial setup
      io.mockClear();

      // First disconnect
      act(() => {
        result.current.disconnect();
      });

      // Then manually reconnect
      act(() => {
        result.current.connect();
      });

      expect(io).toHaveBeenCalled();
    });

    it('should not connect when not enabled', () => {
      const { result } = renderHook(() =>
        useSocketIO({
          enabled: false,
          apiBase: 'http://localhost:8000',
        })
      );

      // Reset any initial calls
      io.mockClear();

      act(() => {
        result.current.connect();
      });

      expect(io).not.toHaveBeenCalled();
    });
  });

  describe('emit', () => {
    it('should emit events when connected', () => {
      mockSocket.connected = true;

      const { result } = renderHook(() =>
        useSocketIO({
          enabled: true,
          apiBase: 'http://localhost:8000',
        })
      );

      // Simulate connection
      act(() => {
        connectHandler();
      });

      const emitResult = result.current.emit('test-event', { data: 'test' });

      expect(mockSocket.emit).toHaveBeenCalledWith('test-event', { data: 'test' });
      expect(emitResult).toBe(true);
    });

    it('should emit with callback when provided', () => {
      mockSocket.connected = true;
      const callback = vi.fn();

      const { result } = renderHook(() =>
        useSocketIO({
          enabled: true,
          apiBase: 'http://localhost:8000',
        })
      );

      act(() => {
        connectHandler();
      });

      result.current.emit('test-event', { data: 'test' }, callback);

      expect(mockSocket.emit).toHaveBeenCalledWith('test-event', { data: 'test' }, callback);
    });

    it('should return false when not connected', () => {
      mockSocket.connected = false;

      const { result } = renderHook(() =>
        useSocketIO({
          enabled: true,
          apiBase: 'http://localhost:8000',
        })
      );

      const emitResult = result.current.emit('test-event', { data: 'test' });

      expect(mockSocket.emit).not.toHaveBeenCalled();
      expect(emitResult).toBe(false);
    });
  });

  describe('event subscription', () => {
    it('should subscribe to events with on()', () => {
      const handler = vi.fn();

      const { result } = renderHook(() =>
        useSocketIO({
          enabled: true,
          apiBase: 'http://localhost:8000',
        })
      );

      // Wait for socket to be set up
      act(() => {
        connectHandler();
      });

      const unsubscribe = result.current.on('custom-event', handler);

      expect(mockSocket.on).toHaveBeenCalledWith('custom-event', handler);
      expect(typeof unsubscribe).toBe('function');
    });

    it('should unsubscribe when returned function is called', () => {
      const handler = vi.fn();

      const { result } = renderHook(() =>
        useSocketIO({
          enabled: true,
          apiBase: 'http://localhost:8000',
        })
      );

      act(() => {
        connectHandler();
      });

      const unsubscribe = result.current.on('custom-event', handler);

      unsubscribe();

      expect(mockSocket.off).toHaveBeenCalledWith('custom-event', handler);
    });

    it('should return no-op unsubscribe when socket not ready', () => {
      const handler = vi.fn();

      const { result } = renderHook(() =>
        useSocketIO({
          enabled: false,
        })
      );

      const unsubscribe = result.current.on('custom-event', handler);

      expect(typeof unsubscribe).toBe('function');
      // Should not throw
      expect(() => unsubscribe()).not.toThrow();
    });

    it('should unsubscribe with off()', () => {
      const handler = vi.fn();

      const { result } = renderHook(() =>
        useSocketIO({
          enabled: true,
          apiBase: 'http://localhost:8000',
        })
      );

      act(() => {
        connectHandler();
      });

      result.current.off('custom-event', handler);

      expect(mockSocket.off).toHaveBeenCalledWith('custom-event', handler);
    });

    it('should unsubscribe all handlers when no handler provided to off()', () => {
      const { result } = renderHook(() =>
        useSocketIO({
          enabled: true,
          apiBase: 'http://localhost:8000',
        })
      );

      act(() => {
        connectHandler();
      });

      result.current.off('custom-event');

      expect(mockSocket.off).toHaveBeenCalledWith('custom-event');
    });

    it('should subscribe once with once()', () => {
      const handler = vi.fn();

      const { result } = renderHook(() =>
        useSocketIO({
          enabled: true,
          apiBase: 'http://localhost:8000',
        })
      );

      act(() => {
        connectHandler();
      });

      result.current.once('custom-event', handler);

      expect(mockSocket.once).toHaveBeenCalledWith('custom-event', handler);
    });
  });

  describe('cleanup', () => {
    it('should disconnect on unmount', () => {
      const { unmount } = renderHook(() =>
        useSocketIO({
          enabled: true,
          apiBase: 'http://localhost:8000',
        })
      );

      act(() => {
        connectHandler();
      });

      unmount();

      expect(mockSocket.disconnect).toHaveBeenCalled();
    });

    it('should clean up event listeners on unmount', () => {
      const { unmount } = renderHook(() =>
        useSocketIO({
          enabled: true,
          apiBase: 'http://localhost:8000',
        })
      );

      act(() => {
        connectHandler();
      });

      unmount();

      // Should clean up internal handlers
      expect(mockSocket.off).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(mockSocket.off).toHaveBeenCalledWith('disconnect', expect.any(Function));
      expect(mockSocket.off).toHaveBeenCalledWith('connect_error', expect.any(Function));
    });
  });

  describe('authentication', () => {
    /** Invoke the auth function passed to io() and capture its payload */
    const getAuthPayload = () => {
      const authFn = io.mock.calls[io.mock.calls.length - 1][1].auth;
      let authPayload;
      authFn((payload) => {
        authPayload = payload;
      });
      return authPayload;
    };

    it('should include auth token from getAccessToken', () => {
      getAccessToken.mockReturnValue('custom-jwt-token');

      renderHook(() =>
        useSocketIO({
          enabled: true,
          apiBase: 'http://localhost:8000',
        })
      );

      expect(getAuthPayload()).toEqual(expect.objectContaining({ token: 'custom-jwt-token' }));
    });

    it('should include additional auth data', () => {
      renderHook(() =>
        useSocketIO({
          enabled: true,
          apiBase: 'http://localhost:8000',
          auth: { customField: 'value' },
        })
      );

      expect(getAuthPayload()).toEqual(
        expect.objectContaining({
          token: 'test-token',
          customField: 'value',
        })
      );
    });

    it('should read the current token on each auth callback invocation', () => {
      getAccessToken.mockReturnValue('initial-token');

      renderHook(() =>
        useSocketIO({
          enabled: true,
          apiBase: 'http://localhost:8000',
        })
      );

      expect(getAuthPayload()).toEqual(expect.objectContaining({ token: 'initial-token' }));

      // Token refresh: subsequent (re)connection attempts get the new token
      getAccessToken.mockReturnValue('refreshed-token');
      expect(getAuthPayload()).toEqual(expect.objectContaining({ token: 'refreshed-token' }));
    });
  });

  describe('reconnection config', () => {
    it('should use default reconnection config', () => {
      renderHook(() =>
        useSocketIO({
          enabled: true,
          apiBase: 'http://localhost:8000',
        })
      );

      expect(io).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 30000,
          reconnectionAttempts: Infinity,
        })
      );
    });

    it('should allow custom reconnection config', () => {
      renderHook(() =>
        useSocketIO({
          enabled: true,
          apiBase: 'http://localhost:8000',
          reconnectConfig: {
            reconnectionDelay: 500,
            reconnectionAttempts: 5,
          },
        })
      );

      expect(io).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          reconnectionDelay: 500,
          reconnectionAttempts: 5,
        })
      );
    });
  });

  describe('socket ref access', () => {
    it('should expose socketRef for advanced use cases', () => {
      const { result } = renderHook(() =>
        useSocketIO({
          enabled: true,
          apiBase: 'http://localhost:8000',
        })
      );

      expect(result.current.socketRef).toBeDefined();
      expect(result.current.socketRef.current).toBe(mockSocket);
    });
  });
});
