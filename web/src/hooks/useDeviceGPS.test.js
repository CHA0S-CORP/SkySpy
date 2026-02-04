import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDeviceGPS, GPS_PERMISSION_STATES } from './useDeviceGPS';

describe('useDeviceGPS', () => {
  let originalNavigator;
  let mockGeolocation;
  let mockPermissions;
  let mockPermissionStatus;
  let watchPositionCallback;
  let watchPositionErrorCallback;

  beforeEach(() => {
    // Reset mocks
    watchPositionCallback = null;
    watchPositionErrorCallback = null;

    // Mock PermissionStatus
    mockPermissionStatus = {
      state: 'prompt',
      onchange: null,
    };

    // Mock Permissions API
    mockPermissions = {
      query: vi.fn().mockResolvedValue(mockPermissionStatus),
    };

    // Mock Geolocation API
    mockGeolocation = {
      getCurrentPosition: vi.fn((success, error) => {
        // Store callbacks for manual triggering
        success({
          coords: {
            latitude: 37.7749,
            longitude: -122.4194,
            accuracy: 10,
            speed: 5,
            heading: 90,
          },
        });
      }),
      watchPosition: vi.fn((success, error) => {
        watchPositionCallback = success;
        watchPositionErrorCallback = error;
        return 123; // watch ID
      }),
      clearWatch: vi.fn(),
    };

    // Store original and set up mocks
    originalNavigator = { ...navigator };

    Object.defineProperty(global.navigator, 'geolocation', {
      value: mockGeolocation,
      writable: true,
      configurable: true,
    });

    Object.defineProperty(global.navigator, 'permissions', {
      value: mockPermissions,
      writable: true,
      configurable: true,
    });

    // Mock DeviceOrientationEvent
    global.DeviceOrientationEvent = class {
      static requestPermission = vi.fn().mockResolvedValue('granted');
    };

    // Mock window event listeners
    vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
    vi.spyOn(window, 'removeEventListener').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should detect geolocation support', async () => {
      const { result } = renderHook(() => useDeviceGPS());
      expect(result.current.isSupported).toBe(true);
    });

    it('should return unsupported when geolocation is not available', async () => {
      delete global.navigator.geolocation;

      const { result } = renderHook(() => useDeviceGPS());
      expect(result.current.isSupported).toBe(false);
    });

    it('should check permission on mount', async () => {
      renderHook(() => useDeviceGPS());

      await waitFor(() => {
        expect(mockPermissions.query).toHaveBeenCalledWith({ name: 'geolocation' });
      });
    });

    it('should set permission state to granted when already granted', async () => {
      mockPermissionStatus.state = 'granted';

      const { result } = renderHook(() => useDeviceGPS());

      await waitFor(() => {
        expect(result.current.permissionState).toBe(GPS_PERMISSION_STATES.GRANTED);
      });
    });

    it('should set permission state to denied when denied', async () => {
      mockPermissionStatus.state = 'denied';

      const { result } = renderHook(() => useDeviceGPS());

      await waitFor(() => {
        expect(result.current.permissionState).toBe(GPS_PERMISSION_STATES.DENIED);
      });
    });

    it('should set permission state to prompt when not yet decided', async () => {
      mockPermissionStatus.state = 'prompt';

      const { result } = renderHook(() => useDeviceGPS());

      await waitFor(() => {
        expect(result.current.permissionState).toBe(GPS_PERMISSION_STATES.PROMPT);
      });
    });
  });

  describe('position updates', () => {
    it('should update position when watchPosition succeeds', async () => {
      mockPermissionStatus.state = 'granted';

      const { result } = renderHook(() =>
        useDeviceGPS({ enabled: true, autoRequest: true })
      );

      await waitFor(() => {
        expect(result.current.permissionState).toBe(GPS_PERMISSION_STATES.GRANTED);
      });

      // Wait for tracking to start
      await waitFor(() => {
        expect(result.current.isTracking).toBe(true);
      });

      // Simulate position update
      act(() => {
        if (watchPositionCallback) {
          watchPositionCallback({
            coords: {
              latitude: 40.7128,
              longitude: -74.006,
              accuracy: 15,
              speed: 10,
              heading: 180,
            },
          });
        }
      });

      await waitFor(() => {
        expect(result.current.position).toEqual({
          lat: 40.7128,
          lon: -74.006,
        });
        expect(result.current.accuracy).toBe(15);
        expect(result.current.speed).toBe(10);
        expect(result.current.heading).toBe(180);
      });
    });

    it('should clear error when position update succeeds', async () => {
      mockPermissionStatus.state = 'granted';

      const { result } = renderHook(() =>
        useDeviceGPS({ enabled: true, autoRequest: true })
      );

      await waitFor(() => {
        expect(result.current.isTracking).toBe(true);
      });

      // Trigger error first
      act(() => {
        if (watchPositionErrorCallback) {
          watchPositionErrorCallback({
            code: 2,
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
            message: 'Position unavailable',
          });
        }
      });

      await waitFor(() => {
        expect(result.current.error).toBe('Location unavailable');
      });

      // Then trigger success
      act(() => {
        if (watchPositionCallback) {
          watchPositionCallback({
            coords: {
              latitude: 40.7128,
              longitude: -74.006,
              accuracy: 15,
              speed: 10,
              heading: 180,
            },
          });
        }
      });

      await waitFor(() => {
        expect(result.current.error).toBeNull();
      });
    });
  });

  describe('error handling', () => {
    it('should handle permission denied error', async () => {
      mockPermissionStatus.state = 'granted';

      const { result } = renderHook(() =>
        useDeviceGPS({ enabled: true, autoRequest: true })
      );

      await waitFor(() => {
        expect(result.current.isTracking).toBe(true);
      });

      act(() => {
        if (watchPositionErrorCallback) {
          watchPositionErrorCallback({
            code: 1,
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
            message: 'User denied geolocation',
          });
        }
      });

      await waitFor(() => {
        expect(result.current.error).toBe('Location permission denied');
      });
    });

    it('should handle position unavailable error', async () => {
      mockPermissionStatus.state = 'granted';

      const { result } = renderHook(() =>
        useDeviceGPS({ enabled: true, autoRequest: true })
      );

      await waitFor(() => {
        expect(result.current.isTracking).toBe(true);
      });

      act(() => {
        if (watchPositionErrorCallback) {
          watchPositionErrorCallback({
            code: 2,
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
            message: 'Position unavailable',
          });
        }
      });

      await waitFor(() => {
        expect(result.current.error).toBe('Location unavailable');
      });
    });

    it('should handle timeout error', async () => {
      mockPermissionStatus.state = 'granted';

      const { result } = renderHook(() =>
        useDeviceGPS({ enabled: true, autoRequest: true })
      );

      await waitFor(() => {
        expect(result.current.isTracking).toBe(true);
      });

      act(() => {
        if (watchPositionErrorCallback) {
          watchPositionErrorCallback({
            code: 3,
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
            message: 'Timeout',
          });
        }
      });

      await waitFor(() => {
        expect(result.current.error).toBe('Location request timed out');
      });
    });
  });

  describe('tracking controls', () => {
    it('should call watchPosition when startTracking is called', async () => {
      mockPermissionStatus.state = 'granted';

      // Remove DeviceOrientationEvent to avoid async permission request
      const savedDeviceOrientationEvent = global.DeviceOrientationEvent;
      delete global.DeviceOrientationEvent;

      const { result } = renderHook(() => useDeviceGPS());

      await waitFor(() => {
        expect(result.current.permissionState).toBe(GPS_PERMISSION_STATES.GRANTED);
      });

      await act(async () => {
        await result.current.startTracking();
      });

      // Verify watchPosition was called (the core functionality)
      expect(mockGeolocation.watchPosition).toHaveBeenCalled();

      // Restore
      global.DeviceOrientationEvent = savedDeviceOrientationEvent;
    });

    it('should call clearWatch when stopTracking is called', async () => {
      mockPermissionStatus.state = 'granted';

      // Remove DeviceOrientationEvent to avoid async permission request
      const savedDeviceOrientationEvent = global.DeviceOrientationEvent;
      delete global.DeviceOrientationEvent;

      const { result } = renderHook(() => useDeviceGPS());

      await waitFor(() => {
        expect(result.current.permissionState).toBe(GPS_PERMISSION_STATES.GRANTED);
      });

      // Start tracking first
      await act(async () => {
        await result.current.startTracking();
      });

      // Now stop
      act(() => {
        result.current.stopTracking();
      });

      // Verify clearWatch was called with the watch ID
      expect(mockGeolocation.clearWatch).toHaveBeenCalledWith(123);

      // Restore
      global.DeviceOrientationEvent = savedDeviceOrientationEvent;
    });

    it('should not start tracking when permission is denied', async () => {
      mockPermissionStatus.state = 'denied';

      const { result } = renderHook(() => useDeviceGPS());

      await waitFor(() => {
        expect(result.current.permissionState).toBe(GPS_PERMISSION_STATES.DENIED);
      });

      await act(async () => {
        await result.current.startTracking();
      });

      expect(result.current.isTracking).toBe(false);
      expect(result.current.error).toBe('Location permission denied');
    });
  });

  describe('getCurrentPosition', () => {
    it('should get current position successfully', async () => {
      const { result } = renderHook(() => useDeviceGPS());

      let position;
      await act(async () => {
        position = await result.current.getCurrentPosition();
      });

      expect(position).toEqual({
        lat: 37.7749,
        lon: -122.4194,
      });
    });

    it('should reject when geolocation is not supported', async () => {
      delete global.navigator.geolocation;

      const { result } = renderHook(() => useDeviceGPS());

      await expect(result.current.getCurrentPosition()).rejects.toThrow(
        'Geolocation not supported'
      );
    });

    it('should handle getCurrentPosition error', async () => {
      mockGeolocation.getCurrentPosition = vi.fn((success, error) => {
        error({
          code: 2,
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
          message: 'Position unavailable',
        });
      });

      const { result } = renderHook(() => useDeviceGPS());

      await expect(result.current.getCurrentPosition()).rejects.toBeDefined();
    });
  });

  describe('permission request', () => {
    it('should request permission and return true on success', async () => {
      mockPermissionStatus.state = 'prompt';

      const { result } = renderHook(() => useDeviceGPS());

      await waitFor(() => {
        expect(result.current.permissionState).toBe(GPS_PERMISSION_STATES.PROMPT);
      });

      let granted;
      await act(async () => {
        granted = await result.current.requestPermission();
      });

      expect(granted).toBe(true);
      expect(result.current.permissionState).toBe(GPS_PERMISSION_STATES.GRANTED);
    });

    it('should set permission denied on rejection', async () => {
      mockPermissionStatus.state = 'prompt';
      mockGeolocation.getCurrentPosition = vi.fn((success, error) => {
        error({
          code: 1,
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
          message: 'Permission denied',
        });
      });

      const { result } = renderHook(() => useDeviceGPS());

      await waitFor(() => {
        expect(result.current.permissionState).toBe(GPS_PERMISSION_STATES.PROMPT);
      });

      let granted;
      await act(async () => {
        granted = await result.current.requestPermission();
      });

      expect(granted).toBe(false);
      expect(result.current.permissionState).toBe(GPS_PERMISSION_STATES.DENIED);
    });

    it('should return false when geolocation is unavailable', async () => {
      delete global.navigator.geolocation;

      const { result } = renderHook(() => useDeviceGPS());

      let granted;
      await act(async () => {
        granted = await result.current.requestPermission();
      });

      expect(granted).toBe(false);
      expect(result.current.permissionState).toBe(GPS_PERMISSION_STATES.UNAVAILABLE);
    });
  });

  describe('auto-tracking', () => {
    it('should auto-start tracking when enabled and autoRequest is true', async () => {
      mockPermissionStatus.state = 'granted';

      const { result } = renderHook(() =>
        useDeviceGPS({ enabled: true, autoRequest: true })
      );

      await waitFor(() => {
        expect(result.current.isTracking).toBe(true);
      });

      expect(mockGeolocation.watchPosition).toHaveBeenCalled();
    });

    it('should not auto-start when autoRequest is false and permission is not granted', async () => {
      mockPermissionStatus.state = 'prompt';

      const { result } = renderHook(() =>
        useDeviceGPS({ enabled: true, autoRequest: false })
      );

      await waitFor(() => {
        expect(result.current.permissionState).toBe(GPS_PERMISSION_STATES.PROMPT);
      });

      // Give some time for any auto-start to occur
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(result.current.isTracking).toBe(false);
    });

    it('should stop tracking when enabled changes to false', async () => {
      mockPermissionStatus.state = 'granted';

      const { result, rerender } = renderHook(
        ({ enabled }) => useDeviceGPS({ enabled, autoRequest: true }),
        { initialProps: { enabled: true } }
      );

      await waitFor(() => {
        expect(result.current.isTracking).toBe(true);
      });

      rerender({ enabled: false });

      await waitFor(() => {
        expect(result.current.isTracking).toBe(false);
      });
    });
  });

  describe('cleanup', () => {
    it('should clean up watch on unmount', async () => {
      mockPermissionStatus.state = 'granted';

      const { result, unmount } = renderHook(() =>
        useDeviceGPS({ enabled: true, autoRequest: true })
      );

      await waitFor(() => {
        expect(result.current.isTracking).toBe(true);
      });

      unmount();

      expect(mockGeolocation.clearWatch).toHaveBeenCalledWith(123);
    });

    it('should clean up permission status listener on unmount', async () => {
      const { unmount } = renderHook(() => useDeviceGPS());

      await waitFor(() => {
        expect(mockPermissionStatus.onchange).not.toBeNull();
      });

      unmount();

      // The onchange should be set to null after unmount
      expect(mockPermissionStatus.onchange).toBeNull();
    });
  });

  describe('permission state changes', () => {
    it('should react to permission state changes', async () => {
      mockPermissionStatus.state = 'prompt';

      const { result } = renderHook(() => useDeviceGPS());

      await waitFor(() => {
        expect(result.current.permissionState).toBe(GPS_PERMISSION_STATES.PROMPT);
      });

      // Simulate permission granted
      act(() => {
        mockPermissionStatus.state = 'granted';
        if (mockPermissionStatus.onchange) {
          mockPermissionStatus.onchange();
        }
      });

      await waitFor(() => {
        expect(result.current.permissionState).toBe(GPS_PERMISSION_STATES.GRANTED);
      });
    });
  });
});
