import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useWakeLock } from './useWakeLock';

describe('useWakeLock', () => {
  let mockWakeLockSentinel;
  let mockWakeLock;
  let visibilityChangeHandler = null;
  let originalDocumentAddEventListener;
  let originalDocumentRemoveEventListener;

  beforeEach(() => {
    // Mock WakeLockSentinel
    mockWakeLockSentinel = {
      released: false,
      type: 'screen',
      release: vi.fn().mockResolvedValue(undefined),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };

    // Mock WakeLock API
    mockWakeLock = {
      request: vi.fn().mockResolvedValue(mockWakeLockSentinel),
    };

    // Setup navigator.wakeLock
    Object.defineProperty(global.navigator, 'wakeLock', {
      value: mockWakeLock,
      writable: true,
      configurable: true,
    });

    // Track visibility change handlers
    visibilityChangeHandler = null;
    originalDocumentAddEventListener = document.addEventListener;
    originalDocumentRemoveEventListener = document.removeEventListener;

    document.addEventListener = vi.fn((event, handler) => {
      if (event === 'visibilitychange') {
        visibilityChangeHandler = handler;
      }
    });

    document.removeEventListener = vi.fn((event) => {
      if (event === 'visibilitychange') {
        visibilityChangeHandler = null;
      }
    });

    // Set document visible by default
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.addEventListener = originalDocumentAddEventListener;
    document.removeEventListener = originalDocumentRemoveEventListener;
  });

  describe('initialization', () => {
    it('should request wake lock on mount when enabled', async () => {
      renderHook(() => useWakeLock(true));

      await waitFor(() => {
        expect(mockWakeLock.request).toHaveBeenCalledWith('screen');
      });
    });

    it('should not request wake lock when disabled', () => {
      renderHook(() => useWakeLock(false));

      expect(mockWakeLock.request).not.toHaveBeenCalled();
    });

    it('should return isLocked status', async () => {
      const { result } = renderHook(() => useWakeLock(true));

      await waitFor(() => {
        expect(mockWakeLock.request).toHaveBeenCalled();
      });

      // The isLocked check happens synchronously but the internal ref is updated
      // after the async request resolves
      expect(typeof result.current.isLocked).toBe('boolean');
    });
  });

  describe('wake lock acquisition', () => {
    it('should acquire wake lock via request function', async () => {
      const { result } = renderHook(() => useWakeLock(true));

      await act(async () => {
        await result.current.request();
      });

      expect(mockWakeLock.request).toHaveBeenCalledWith('screen');
    });

    it('should not request if already locked', async () => {
      const { result } = renderHook(() => useWakeLock(true));

      await waitFor(() => {
        expect(mockWakeLock.request).toHaveBeenCalledTimes(1);
      });

      // Request again
      await act(async () => {
        await result.current.request();
      });

      // Should still be only 1 call since we're already locked
      expect(mockWakeLock.request).toHaveBeenCalledTimes(1);
    });

    it('should not request when disabled', async () => {
      const { result } = renderHook(() => useWakeLock(false));

      await act(async () => {
        await result.current.request();
      });

      expect(mockWakeLock.request).not.toHaveBeenCalled();
    });

    it('should handle wake lock request failure gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockWakeLock.request.mockRejectedValueOnce(new Error('Wake lock not allowed'));

      const { result } = renderHook(() => useWakeLock(true));

      // Should not throw
      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Wake lock failed:', expect.any(Error));
      });

      expect(result.current.isLocked).toBe(false);
      consoleSpy.mockRestore();
    });
  });

  describe('wake lock release', () => {
    it('should release wake lock via release function', async () => {
      const { result } = renderHook(() => useWakeLock(true));

      await waitFor(() => {
        expect(mockWakeLock.request).toHaveBeenCalled();
      });

      act(() => {
        result.current.release();
      });

      expect(mockWakeLockSentinel.release).toHaveBeenCalled();
    });

    it('should release wake lock on unmount', async () => {
      const { unmount } = renderHook(() => useWakeLock(true));

      await waitFor(() => {
        expect(mockWakeLock.request).toHaveBeenCalled();
      });

      unmount();

      expect(mockWakeLockSentinel.release).toHaveBeenCalled();
    });

    it('should not throw when releasing without lock', () => {
      const { result } = renderHook(() => useWakeLock(false));

      expect(() => {
        result.current.release();
      }).not.toThrow();
    });
  });

  describe('visibility change handling', () => {
    it('should add visibility change listener when enabled', () => {
      renderHook(() => useWakeLock(true));

      expect(document.addEventListener).toHaveBeenCalledWith(
        'visibilitychange',
        expect.any(Function)
      );
    });

    it('should not add visibility change listener when disabled', () => {
      renderHook(() => useWakeLock(false));

      expect(document.addEventListener).not.toHaveBeenCalledWith(
        'visibilitychange',
        expect.any(Function)
      );
    });

    it('should re-acquire wake lock when page becomes visible', async () => {
      const { result } = renderHook(() => useWakeLock(true));

      await waitFor(() => {
        expect(mockWakeLock.request).toHaveBeenCalledTimes(1);
      });

      // Release the lock (simulating browser releasing it when hidden)
      act(() => {
        result.current.release();
      });

      // Simulate page becoming visible
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      });

      act(() => {
        if (visibilityChangeHandler) {
          visibilityChangeHandler();
        }
      });

      await waitFor(() => {
        expect(mockWakeLock.request).toHaveBeenCalledTimes(2);
      });
    });

    it('should not re-acquire when page becomes hidden', async () => {
      renderHook(() => useWakeLock(true));

      await waitFor(() => {
        expect(mockWakeLock.request).toHaveBeenCalledTimes(1);
      });

      // Simulate page becoming hidden
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
        configurable: true,
      });

      act(() => {
        if (visibilityChangeHandler) {
          visibilityChangeHandler();
        }
      });

      // Should still be only 1 call
      expect(mockWakeLock.request).toHaveBeenCalledTimes(1);
    });

    it('should remove visibility change listener on unmount', async () => {
      const { unmount } = renderHook(() => useWakeLock(true));

      await waitFor(() => {
        expect(document.addEventListener).toHaveBeenCalled();
      });

      unmount();

      expect(document.removeEventListener).toHaveBeenCalledWith(
        'visibilitychange',
        expect.any(Function)
      );
    });
  });

  describe('enabled prop changes', () => {
    it('should request wake lock when enabled changes to true', async () => {
      const { rerender } = renderHook(({ enabled }) => useWakeLock(enabled), {
        initialProps: { enabled: false },
      });

      expect(mockWakeLock.request).not.toHaveBeenCalled();

      rerender({ enabled: true });

      await waitFor(() => {
        expect(mockWakeLock.request).toHaveBeenCalledWith('screen');
      });
    });

    it('should release wake lock when enabled changes to false', async () => {
      const { rerender } = renderHook(({ enabled }) => useWakeLock(enabled), {
        initialProps: { enabled: true },
      });

      await waitFor(() => {
        expect(mockWakeLock.request).toHaveBeenCalled();
      });

      rerender({ enabled: false });

      expect(mockWakeLockSentinel.release).toHaveBeenCalled();
    });
  });

  describe('unsupported browsers', () => {
    it('should handle browsers without Wake Lock API', async () => {
      // Remove wakeLock from navigator
      Object.defineProperty(global.navigator, 'wakeLock', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useWakeLock(true));

      // Should not throw and isLocked should be false
      expect(result.current.isLocked).toBe(false);

      // Manual request should also not throw
      await act(async () => {
        await result.current.request();
      });

      expect(result.current.isLocked).toBe(false);
    });
  });

  describe('return values', () => {
    it('should return request and release functions', () => {
      const { result } = renderHook(() => useWakeLock(false));

      expect(typeof result.current.request).toBe('function');
      expect(typeof result.current.release).toBe('function');
      expect(typeof result.current.isLocked).toBe('boolean');
    });
  });
});
