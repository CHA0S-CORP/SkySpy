import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAlertNotifications } from './useAlertNotifications';

// Mock useToast
vi.mock('./useToast', () => ({
  useToastContextSafe: vi.fn(() => null),
}));

describe('useAlertNotifications', () => {
  let mockWsRequest;
  let mockFetch;
  let mockToast;
  let mockLocalStorage;
  let mockNotification;

  beforeEach(() => {
    vi.useFakeTimers();
    mockWsRequest = vi.fn();
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    mockToast = {
      addToast: vi.fn(() => 'toast-id-1'),
    };

    // Mock localStorage with fresh object each time
    mockLocalStorage = {};
    const localStorageMock = {
      getItem: vi.fn((key) => mockLocalStorage[key] ?? null),
      setItem: vi.fn((key, value) => {
        mockLocalStorage[key] = value;
      }),
      removeItem: vi.fn((key) => {
        delete mockLocalStorage[key];
      }),
      clear: vi.fn(() => {
        mockLocalStorage = {};
      }),
    };
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    });

    // Mock Notification API
    mockNotification = vi.fn();
    global.Notification = mockNotification;
    Object.defineProperty(global.Notification, 'permission', {
      value: 'granted',
      writable: true,
    });
    global.Notification.requestPermission = vi.fn().mockResolvedValue('granted');

    // Mock Audio
    global.Audio = vi.fn().mockImplementation(() => ({
      play: vi.fn().mockResolvedValue(undefined),
      volume: 0,
      src: '',
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('should initialize with default values', () => {
      const { result } = renderHook(() => useAlertNotifications());

      expect(result.current.unacknowledgedCount).toBe(0);
      expect(result.current.recentAlerts).toEqual([]);
    });

    it('should load unacknowledged alerts from localStorage', () => {
      const storedAlerts = [
        { id: 1, rule_name: 'Test Alert' },
        { id: 2, rule_name: 'Another Alert' },
      ];
      window.localStorage.getItem.mockImplementation((key) => {
        if (key === 'unacknowledged-alerts') return JSON.stringify(storedAlerts);
        return null;
      });

      const { result } = renderHook(() => useAlertNotifications());

      expect(result.current.unacknowledgedCount).toBe(2);
      expect(result.current.recentAlerts).toHaveLength(2);
    });

    it('should limit recentAlerts to 20 items from localStorage', () => {
      const storedAlerts = Array.from({ length: 30 }, (_, i) => ({
        id: i,
        rule_name: `Alert ${i}`,
      }));
      window.localStorage.getItem.mockImplementation((key) => {
        if (key === 'unacknowledged-alerts') return JSON.stringify(storedAlerts);
        return null;
      });

      const { result } = renderHook(() => useAlertNotifications());

      expect(result.current.recentAlerts).toHaveLength(20);
    });
  });

  describe('fetching unacknowledged count', () => {
    it('should fetch count via HTTP even when WebSocket connected', async () => {
      // Regression: there is no WS 'alert-count' request type and no
      // /alerts/count route. The count must come from the alert-history list
      // endpoint over HTTP regardless of socket state (previously it called a
      // dead WS type that rejected, so the badge never reflected the server).
      vi.useRealTimers();

      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ count: 5 }),
      });

      const { result } = renderHook(() =>
        useAlertNotifications({
          apiBase: 'http://localhost:8000',
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      await waitFor(() => {
        expect(result.current.unacknowledgedCount).toBe(5);
      });

      expect(mockWsRequest).not.toHaveBeenCalledWith('alert-count', expect.anything());
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/v1/alerts/history/?acknowledged=false&hours=720'
      );
    });

    it('should fetch count via HTTP when WebSocket not available', async () => {
      vi.useRealTimers();

      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ count: 3 }),
      });

      const { result } = renderHook(() =>
        useAlertNotifications({
          apiBase: 'http://localhost:8000',
        })
      );

      await waitFor(() => {
        expect(result.current.unacknowledgedCount).toBe(3);
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/v1/alerts/history/?acknowledged=false&hours=720'
      );
    });

    it('should rate limit fetch requests', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ count: 5 }),
      });

      const { result } = renderHook(() =>
        useAlertNotifications({
          apiBase: 'http://localhost:8000',
        })
      );

      // Wait for initial fetch
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      // Try to fetch multiple times rapidly
      result.current.fetchUnacknowledgedCount();
      result.current.fetchUnacknowledgedCount();
      result.current.fetchUnacknowledgedCount();

      // Should only have called once due to rate limiting
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should periodically refresh count', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ count: 5 }),
      });

      renderHook(() =>
        useAlertNotifications({
          apiBase: 'http://localhost:8000',
        })
      );

      // Initial fetch
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Wait past rate limit (5s) then to refresh interval (30s)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30000);
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('handling alert triggered events', () => {
    it('should update count when alert is triggered', () => {
      const { result } = renderHook(() => useAlertNotifications({ toast: mockToast }));

      expect(result.current.unacknowledgedCount).toBe(0);

      act(() => {
        result.current.handleAlertTriggered({
          id: 123,
          rule_name: 'Test Rule',
          callsign: 'UAL123',
          severity: 'high',
        });
      });

      expect(result.current.unacknowledgedCount).toBe(1);
      expect(result.current.recentAlerts).toHaveLength(1);
    });

    it('should show toast notification for triggered alert', () => {
      const { result } = renderHook(() => useAlertNotifications({ toast: mockToast }));

      act(() => {
        result.current.handleAlertTriggered({
          id: 123,
          rule_name: 'Test Rule',
          callsign: 'UAL123',
          severity: 'high',
        });
      });

      expect(mockToast.addToast).toHaveBeenCalledWith(
        'Test Rule: UAL123',
        'warning',
        expect.any(Number),
        expect.any(Object)
      );
    });

    it('should play sound for triggered alert', () => {
      const mockAudio = { play: vi.fn().mockResolvedValue(undefined), src: '', volume: 0 };
      global.Audio = vi.fn().mockImplementation(() => mockAudio);

      const { result } = renderHook(() =>
        useAlertNotifications({ toast: mockToast, soundEnabled: true })
      );

      act(() => {
        result.current.handleAlertTriggered({
          id: 123,
          rule_name: 'Test Rule',
          severity: 'high',
        });
      });

      expect(mockAudio.play).toHaveBeenCalled();
    });

    it('should not play sound when soundEnabled is false', () => {
      const mockAudio = { play: vi.fn().mockResolvedValue(undefined), src: '', volume: 0 };
      global.Audio = vi.fn().mockImplementation(() => mockAudio);

      const { result } = renderHook(() =>
        useAlertNotifications({ toast: mockToast, soundEnabled: false })
      );

      act(() => {
        result.current.playAlertSound('high');
      });

      expect(mockAudio.play).not.toHaveBeenCalled();
    });

    it('should show browser notification when permission granted', () => {
      const { result } = renderHook(() => useAlertNotifications({ toast: mockToast }));

      act(() => {
        result.current.handleAlertTriggered({
          id: 123,
          rule_name: 'Test Rule',
          callsign: 'UAL123',
        });
      });

      expect(mockNotification).toHaveBeenCalledWith(
        'Test Rule',
        expect.objectContaining({
          body: expect.any(String),
          icon: expect.any(String),
        })
      );
    });

    it('should persist alerts to localStorage', () => {
      const { result } = renderHook(() => useAlertNotifications({ toast: mockToast }));

      act(() => {
        result.current.handleAlertTriggered({
          id: 123,
          rule_name: 'Test Rule',
          callsign: 'UAL123',
        });
      });

      expect(window.localStorage.setItem).toHaveBeenCalledWith(
        'unacknowledged-alerts',
        expect.any(String)
      );
    });

    it('should listen for custom window events', async () => {
      vi.useRealTimers();

      const { result } = renderHook(() => useAlertNotifications({ toast: mockToast }));

      act(() => {
        window.dispatchEvent(
          new CustomEvent('skyspy:alert:triggered', {
            detail: {
              id: 456,
              rule_name: 'Event Alert',
              callsign: 'DAL789',
            },
          })
        );
      });

      await waitFor(() => {
        expect(result.current.recentAlerts).toHaveLength(1);
      });
    });
  });

  describe('acknowledging alerts', () => {
    it('should acknowledge single alert via HTTP even when WebSocket connected', async () => {
      // Regression: there is no WS 'acknowledge-alert' request type. When the
      // socket was connected the code awaited it, the promise rejected, and the
      // HTTP POST was skipped — so the ack was only ever local and reappeared
      // unacknowledged after reload. The acknowledge action must always POST.
      vi.useRealTimers();

      mockFetch.mockResolvedValue({ ok: true });

      const { result } = renderHook(() =>
        useAlertNotifications({
          toast: mockToast,
          apiBase: 'http://localhost:8000',
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      act(() => {
        result.current.handleAlertTriggered({ id: 123, rule_name: 'Test' });
      });

      expect(result.current.unacknowledgedCount).toBe(1);

      await act(async () => {
        await result.current.acknowledgeAlert(123);
      });

      expect(result.current.unacknowledgedCount).toBe(0);
      expect(result.current.recentAlerts.find((a) => a.id === 123)).toBeUndefined();
      expect(mockWsRequest).not.toHaveBeenCalledWith('acknowledge-alert', expect.anything());
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/v1/alerts/history/123/acknowledge/',
        { method: 'POST' }
      );
    });

    it('should acknowledge via HTTP when WebSocket not available', async () => {
      vi.useRealTimers();

      mockFetch.mockResolvedValue({ ok: true });

      const { result } = renderHook(() =>
        useAlertNotifications({
          toast: mockToast,
          apiBase: 'http://localhost:8000',
        })
      );

      act(() => {
        result.current.handleAlertTriggered({ id: 123, rule_name: 'Test' });
      });

      await act(async () => {
        await result.current.acknowledgeAlert(123);
      });

      // DRF DefaultRouter only registers the trailing-slash route; a slashless
      // POST cannot be redirected with its body, so the ack would be dropped
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/v1/alerts/history/123/acknowledge/',
        { method: 'POST' }
      );
    });

    it('should acknowledge all via HTTP with trailing slash when WebSocket not available', async () => {
      vi.useRealTimers();

      mockFetch.mockResolvedValue({ ok: true });

      const { result } = renderHook(() =>
        useAlertNotifications({
          toast: mockToast,
          apiBase: 'http://localhost:8000',
        })
      );

      act(() => {
        result.current.handleAlertTriggered({ id: 1, rule_name: 'Test 1' });
      });

      await act(async () => {
        await result.current.acknowledgeAll();
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/v1/alerts/history/acknowledge-all/',
        { method: 'POST' }
      );
    });

    it('should acknowledge all via HTTP even when WebSocket connected', async () => {
      // Regression: no WS 'acknowledge-all-alerts' type; when connected the code
      // awaited it, rejected, and skipped the HTTP POST — so the clear was only
      // local and every alert returned unacknowledged after reload.
      vi.useRealTimers();

      mockFetch.mockResolvedValue({ ok: true });

      const { result } = renderHook(() =>
        useAlertNotifications({
          toast: mockToast,
          apiBase: 'http://localhost:8000',
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      act(() => {
        result.current.handleAlertTriggered({ id: 1, rule_name: 'Test 1' });
      });

      await act(async () => {
        await result.current.acknowledgeAll();
      });

      expect(mockWsRequest).not.toHaveBeenCalledWith('acknowledge-all-alerts', expect.anything());
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/v1/alerts/history/acknowledge-all/',
        { method: 'POST' }
      );
    });

    it('should acknowledge all alerts', async () => {
      vi.useRealTimers();

      mockWsRequest.mockResolvedValue({ success: true });

      const { result } = renderHook(() =>
        useAlertNotifications({
          toast: mockToast,
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      act(() => {
        result.current.handleAlertTriggered({ id: 1, rule_name: 'Test 1' });
        result.current.handleAlertTriggered({ id: 2, rule_name: 'Test 2' });
      });

      expect(result.current.unacknowledgedCount).toBe(2);

      await act(async () => {
        await result.current.acknowledgeAll();
      });

      expect(result.current.unacknowledgedCount).toBe(0);
      expect(result.current.recentAlerts).toHaveLength(0);
      expect(mockLocalStorage['unacknowledged-alerts']).toBeUndefined();
    });

    it('should provide markAllAsRead alias', async () => {
      const { result } = renderHook(() => useAlertNotifications({ toast: mockToast }));

      expect(result.current.markAllAsRead).toBe(result.current.acknowledgeAll);
    });
  });

  describe('notification permissions', () => {
    it('should request notification permission', async () => {
      vi.useRealTimers();

      // Create a fresh Notification mock with configurable permission
      const MockNotification = vi.fn();
      MockNotification.permission = 'default';
      MockNotification.requestPermission = vi.fn().mockResolvedValue('granted');
      global.Notification = MockNotification;

      const { result } = renderHook(() => useAlertNotifications());

      const permission = await result.current.requestNotificationPermission();

      expect(permission).toBe('granted');
      expect(MockNotification.requestPermission).toHaveBeenCalled();
    });

    it('should return current permission status', () => {
      const { result } = renderHook(() => useAlertNotifications());

      expect(result.current.getNotificationPermission()).toBe('granted');
    });

    it('should return unsupported when Notification API not available', () => {
      const originalNotification = global.Notification;
      delete global.Notification;

      const { result } = renderHook(() => useAlertNotifications());

      expect(result.current.getNotificationPermission()).toBe('unsupported');

      global.Notification = originalNotification;
    });

    it('should return existing permission without requesting', async () => {
      vi.useRealTimers();

      Object.defineProperty(global.Notification, 'permission', {
        value: 'granted',
        writable: true,
      });

      const { result } = renderHook(() => useAlertNotifications());

      const permission = await result.current.requestNotificationPermission();

      expect(permission).toBe('granted');
      expect(global.Notification.requestPermission).not.toHaveBeenCalled();
    });

    it('should return denied without requesting when previously denied', async () => {
      vi.useRealTimers();

      Object.defineProperty(global.Notification, 'permission', {
        value: 'denied',
        writable: true,
      });

      const { result } = renderHook(() => useAlertNotifications());

      const permission = await result.current.requestNotificationPermission();

      expect(permission).toBe('denied');
    });
  });

  describe('severity mapping', () => {
    it('should map critical severity to error toast', () => {
      const { result } = renderHook(() => useAlertNotifications({ toast: mockToast }));

      act(() => {
        result.current.handleAlertTriggered({
          id: 1,
          rule_name: 'Critical Alert',
          severity: 'critical',
        });
      });

      expect(mockToast.addToast).toHaveBeenCalledWith(
        expect.any(String),
        'error',
        expect.any(Number),
        expect.any(Object)
      );
    });

    it('should map high severity to warning toast', () => {
      const { result } = renderHook(() => useAlertNotifications({ toast: mockToast }));

      act(() => {
        result.current.handleAlertTriggered({
          id: 1,
          rule_name: 'High Alert',
          severity: 'high',
        });
      });

      expect(mockToast.addToast).toHaveBeenCalledWith(
        expect.any(String),
        'warning',
        expect.any(Number),
        expect.any(Object)
      );
    });

    it('should map low severity to info toast', () => {
      const { result } = renderHook(() => useAlertNotifications({ toast: mockToast }));

      act(() => {
        result.current.handleAlertTriggered({
          id: 1,
          rule_name: 'Info Alert',
          severity: 'info',
        });
      });

      expect(mockToast.addToast).toHaveBeenCalledWith(
        expect.any(String),
        'info',
        expect.any(Number),
        expect.any(Object)
      );
    });
  });

  describe('cleanup', () => {
    it('should cleanup event listeners on unmount', async () => {
      vi.useRealTimers();

      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

      const { unmount } = renderHook(() => useAlertNotifications({ toast: mockToast }));

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'skyspy:alert:triggered',
        expect.any(Function)
      );
    });
  });
});
