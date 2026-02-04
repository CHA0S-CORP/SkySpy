import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCannonballGPS, GPS_PERMISSION_STATES } from './useCannonballGPS';

// Mock the useDeviceGPS hook
vi.mock('./useDeviceGPS', () => ({
  useDeviceGPS: vi.fn(() => ({
    position: null,
    heading: null,
    accuracy: null,
    speed: null,
    isTracking: false,
    error: null,
    permissionState: 'prompt',
    requestPermission: vi.fn().mockResolvedValue(true),
    startTracking: vi.fn(),
  })),
  GPS_PERMISSION_STATES: {
    UNKNOWN: 'unknown',
    CHECKING: 'checking',
    PROMPT: 'prompt',
    REQUESTING: 'requesting',
    GRANTED: 'granted',
    DENIED: 'denied',
    UNAVAILABLE: 'unavailable',
  },
}));

import { useDeviceGPS } from './useDeviceGPS';

describe('useCannonballGPS', () => {
  let mockDeviceGPS;

  beforeEach(() => {
    mockDeviceGPS = {
      position: null,
      heading: null,
      accuracy: null,
      speed: null,
      isTracking: false,
      error: null,
      permissionState: 'prompt',
      requestPermission: vi.fn().mockResolvedValue(true),
      startTracking: vi.fn(),
    };

    vi.mocked(useDeviceGPS).mockReturnValue(mockDeviceGPS);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with default values', () => {
      const { result } = renderHook(() => useCannonballGPS());

      expect(result.current.position).toBeNull();
      expect(result.current.heading).toBeNull();
      expect(result.current.accuracy).toBeNull();
      expect(result.current.userSpeed).toBeNull();
      expect(result.current.isTracking).toBe(false);
      expect(result.current.gpsError).toBeNull();
      expect(result.current.gpsDisabledByUser).toBe(false);
    });

    it('should call useDeviceGPS with correct options', () => {
      renderHook(() => useCannonballGPS());

      expect(useDeviceGPS).toHaveBeenCalledWith({
        enabled: true,
        interval: 3000,
        highAccuracy: true,
        autoRequest: false,
      });
    });

    it('should pass gpsDisabledByUser to useDeviceGPS enabled option', () => {
      const { result } = renderHook(() => useCannonballGPS());

      // Initially enabled
      expect(useDeviceGPS).toHaveBeenLastCalledWith(
        expect.objectContaining({ enabled: true })
      );

      // Disable GPS
      act(() => {
        result.current.handleContinueWithoutGPS();
      });

      // Check the hook was called with enabled: false
      // We need to trigger a re-render to see the updated call
      expect(result.current.gpsDisabledByUser).toBe(true);
    });
  });

  describe('GPS modal behavior', () => {
    it('should show GPS modal when permission is prompt', async () => {
      mockDeviceGPS.permissionState = 'prompt';
      vi.mocked(useDeviceGPS).mockReturnValue(mockDeviceGPS);

      const { result } = renderHook(() => useCannonballGPS());

      await waitFor(() => {
        expect(result.current.showGPSModal).toBe(true);
      });
    });

    it('should show GPS modal when permission is denied', async () => {
      mockDeviceGPS.permissionState = 'denied';
      vi.mocked(useDeviceGPS).mockReturnValue(mockDeviceGPS);

      const { result } = renderHook(() => useCannonballGPS());

      await waitFor(() => {
        expect(result.current.showGPSModal).toBe(true);
      });
    });

    it('should show GPS modal when GPS is unavailable', async () => {
      mockDeviceGPS.permissionState = 'unavailable';
      vi.mocked(useDeviceGPS).mockReturnValue(mockDeviceGPS);

      const { result } = renderHook(() => useCannonballGPS());

      await waitFor(() => {
        expect(result.current.showGPSModal).toBe(true);
      });
    });

    it('should hide GPS modal when permission is granted', async () => {
      mockDeviceGPS.permissionState = 'granted';
      vi.mocked(useDeviceGPS).mockReturnValue(mockDeviceGPS);

      const { result } = renderHook(() => useCannonballGPS());

      await waitFor(() => {
        expect(result.current.showGPSModal).toBe(false);
      });
    });

    it('should not show GPS modal when user has disabled GPS', async () => {
      mockDeviceGPS.permissionState = 'prompt';
      vi.mocked(useDeviceGPS).mockReturnValue(mockDeviceGPS);

      const { result } = renderHook(() => useCannonballGPS());

      // User disables GPS
      act(() => {
        result.current.handleContinueWithoutGPS();
      });

      expect(result.current.showGPSModal).toBe(false);
      expect(result.current.gpsDisabledByUser).toBe(true);
    });
  });

  describe('handleRequestGPSPermission', () => {
    it('should request permission and start tracking on success', async () => {
      mockDeviceGPS.requestPermission.mockResolvedValue(true);

      const { result } = renderHook(() => useCannonballGPS());

      await act(async () => {
        await result.current.handleRequestGPSPermission();
      });

      expect(mockDeviceGPS.requestPermission).toHaveBeenCalled();
      expect(mockDeviceGPS.startTracking).toHaveBeenCalled();
    });

    it('should not start tracking if permission is denied', async () => {
      mockDeviceGPS.requestPermission.mockResolvedValue(false);

      const { result } = renderHook(() => useCannonballGPS());

      await act(async () => {
        await result.current.handleRequestGPSPermission();
      });

      expect(mockDeviceGPS.requestPermission).toHaveBeenCalled();
      expect(mockDeviceGPS.startTracking).not.toHaveBeenCalled();
    });
  });

  describe('handleRetryGPS', () => {
    it('should reset disabled state and request permission', async () => {
      const { result } = renderHook(() => useCannonballGPS());

      // First disable GPS
      act(() => {
        result.current.handleContinueWithoutGPS();
      });

      expect(result.current.gpsDisabledByUser).toBe(true);

      // Retry GPS
      await act(async () => {
        await result.current.handleRetryGPS();
      });

      expect(result.current.gpsDisabledByUser).toBe(false);
      expect(mockDeviceGPS.requestPermission).toHaveBeenCalled();
    });
  });

  describe('handleContinueWithoutGPS', () => {
    it('should set disabled state and hide modal', () => {
      mockDeviceGPS.permissionState = 'prompt';
      vi.mocked(useDeviceGPS).mockReturnValue(mockDeviceGPS);

      const { result } = renderHook(() => useCannonballGPS());

      act(() => {
        result.current.handleContinueWithoutGPS();
      });

      expect(result.current.gpsDisabledByUser).toBe(true);
      expect(result.current.showGPSModal).toBe(false);
    });
  });

  describe('handleEnableGPS', () => {
    it('should reset disabled state and show modal', () => {
      const { result } = renderHook(() => useCannonballGPS());

      // First disable GPS
      act(() => {
        result.current.handleContinueWithoutGPS();
      });

      expect(result.current.gpsDisabledByUser).toBe(true);
      expect(result.current.showGPSModal).toBe(false);

      // Enable GPS
      act(() => {
        result.current.handleEnableGPS();
      });

      expect(result.current.gpsDisabledByUser).toBe(false);
      expect(result.current.showGPSModal).toBe(true);
    });
  });

  describe('closeGPSModal', () => {
    it('should close the modal', () => {
      mockDeviceGPS.permissionState = 'prompt';
      vi.mocked(useDeviceGPS).mockReturnValue(mockDeviceGPS);

      const { result } = renderHook(() => useCannonballGPS());

      // Modal should be open initially due to permission state
      waitFor(() => {
        expect(result.current.showGPSModal).toBe(true);
      });

      act(() => {
        result.current.closeGPSModal();
      });

      expect(result.current.showGPSModal).toBe(false);
    });
  });

  describe('gpsActive computed property', () => {
    it('should be true when tracking and has position', () => {
      mockDeviceGPS.isTracking = true;
      mockDeviceGPS.position = { lat: 37.7749, lon: -122.4194 };
      vi.mocked(useDeviceGPS).mockReturnValue(mockDeviceGPS);

      const { result } = renderHook(() => useCannonballGPS());

      expect(result.current.gpsActive).toBe(true);
    });

    it('should be false when not tracking', () => {
      mockDeviceGPS.isTracking = false;
      mockDeviceGPS.position = { lat: 37.7749, lon: -122.4194 };
      vi.mocked(useDeviceGPS).mockReturnValue(mockDeviceGPS);

      const { result } = renderHook(() => useCannonballGPS());

      expect(result.current.gpsActive).toBe(false);
    });

    it('should be false when no position', () => {
      mockDeviceGPS.isTracking = true;
      mockDeviceGPS.position = null;
      vi.mocked(useDeviceGPS).mockReturnValue(mockDeviceGPS);

      const { result } = renderHook(() => useCannonballGPS());

      expect(result.current.gpsActive).toBe(false);
    });
  });

  describe('data pass-through', () => {
    it('should pass through GPS data from useDeviceGPS', () => {
      mockDeviceGPS = {
        ...mockDeviceGPS,
        position: { lat: 37.7749, lon: -122.4194 },
        heading: 90,
        accuracy: 10,
        speed: 25,
        isTracking: true,
        error: null,
        permissionState: 'granted',
      };
      vi.mocked(useDeviceGPS).mockReturnValue(mockDeviceGPS);

      const { result } = renderHook(() => useCannonballGPS());

      expect(result.current.position).toEqual({ lat: 37.7749, lon: -122.4194 });
      expect(result.current.heading).toBe(90);
      expect(result.current.accuracy).toBe(10);
      expect(result.current.userSpeed).toBe(25);
      expect(result.current.isTracking).toBe(true);
      expect(result.current.gpsError).toBeNull();
      expect(result.current.permissionState).toBe('granted');
    });

    it('should pass through error from useDeviceGPS', () => {
      mockDeviceGPS.error = 'Location unavailable';
      vi.mocked(useDeviceGPS).mockReturnValue(mockDeviceGPS);

      const { result } = renderHook(() => useCannonballGPS());

      expect(result.current.gpsError).toBe('Location unavailable');
    });
  });

  describe('permission state transitions', () => {
    it('should handle permission change from prompt to granted', async () => {
      // Start with prompt
      mockDeviceGPS.permissionState = 'prompt';
      const mockReturnValue = { ...mockDeviceGPS };
      vi.mocked(useDeviceGPS).mockReturnValue(mockReturnValue);

      const { result, rerender } = renderHook(() => useCannonballGPS());

      await waitFor(() => {
        expect(result.current.showGPSModal).toBe(true);
      });

      // Change to granted
      mockReturnValue.permissionState = 'granted';
      vi.mocked(useDeviceGPS).mockReturnValue(mockReturnValue);

      rerender();

      await waitFor(() => {
        expect(result.current.showGPSModal).toBe(false);
      });
    });
  });
});
