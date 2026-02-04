import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHapticFeedback } from './useHapticFeedback';

describe('useHapticFeedback', () => {
  let vibrateMock;

  beforeEach(() => {
    vi.useFakeTimers();
    vibrateMock = vi.fn().mockReturnValue(true);

    // Mock navigator.vibrate
    Object.defineProperty(global.navigator, 'vibrate', {
      value: vibrateMock,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should detect vibration support', () => {
      const { result } = renderHook(() => useHapticFeedback({ enabled: true }));

      expect(result.current.supportsVibration).toBe(true);
    });

    it('should return all feedback functions', () => {
      const { result } = renderHook(() => useHapticFeedback({ enabled: true }));

      expect(typeof result.current.vibrate).toBe('function');
      expect(typeof result.current.stop).toBe('function');
      expect(typeof result.current.vibrateForThreatLevel).toBe('function');
      expect(typeof result.current.vibrateNewThreat).toBe('function');
      expect(typeof result.current.vibrateApproaching).toBe('function');
      expect(typeof result.current.vibrateDeparting).toBe('function');
      expect(typeof result.current.vibrateClear).toBe('function');
      expect(typeof result.current.vibrateError).toBe('function');
      expect(typeof result.current.vibrateTap).toBe('function');
      expect(typeof result.current.vibrateSelect).toBe('function');
      expect(typeof result.current.startContinuousVibration).toBe('function');
      expect(typeof result.current.stopContinuousVibration).toBe('function');
    });

    it('should expose patterns object', () => {
      const { result } = renderHook(() => useHapticFeedback({ enabled: true }));

      expect(result.current.patterns).toBeDefined();
      expect(result.current.patterns.info).toBeDefined();
      expect(result.current.patterns.warning).toBeDefined();
      expect(result.current.patterns.critical).toBeDefined();
    });
  });

  describe('vibrate function', () => {
    it('should call navigator.vibrate with pattern', () => {
      const { result } = renderHook(() => useHapticFeedback({ enabled: true }));

      act(() => {
        result.current.vibrate([100, 50, 100]);
      });

      expect(vibrateMock).toHaveBeenCalledWith([100, 50, 100]);
    });

    it('should not vibrate when disabled', () => {
      const { result } = renderHook(() => useHapticFeedback({ enabled: false }));

      act(() => {
        result.current.vibrate([100]);
      });

      expect(vibrateMock).not.toHaveBeenCalled();
    });

    it('should throttle vibrations', () => {
      const { result } = renderHook(() => useHapticFeedback({ enabled: true }));

      act(() => {
        result.current.vibrate([100]);
      });

      expect(vibrateMock).toHaveBeenCalledTimes(1);

      // Try to vibrate again immediately
      act(() => {
        result.current.vibrate([100]);
      });

      // Should still be only 1 call due to throttling
      expect(vibrateMock).toHaveBeenCalledTimes(1);

      // Advance time past throttle interval
      act(() => {
        vi.advanceTimersByTime(400);
      });

      act(() => {
        result.current.vibrate([100]);
      });

      expect(vibrateMock).toHaveBeenCalledTimes(2);
    });

    it('should handle vibration error gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vibrateMock.mockImplementation(() => {
        throw new Error('Vibration failed');
      });

      const { result } = renderHook(() => useHapticFeedback({ enabled: true }));

      let returnValue;
      act(() => {
        returnValue = result.current.vibrate([100]);
      });

      expect(returnValue).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith('Vibration failed:', expect.any(Error));
      consoleSpy.mockRestore();
    });
  });

  describe('intensity scaling', () => {
    it('should scale pattern for strong intensity', () => {
      const { result } = renderHook(() =>
        useHapticFeedback({ enabled: true, intensity: 'strong' })
      );

      act(() => {
        result.current.vibrate([100, 50, 100]);
      });

      // Strong scales by 1.5
      expect(vibrateMock).toHaveBeenCalledWith([150, 75, 150]);
    });

    it('should scale pattern for gentle intensity', () => {
      const { result } = renderHook(() =>
        useHapticFeedback({ enabled: true, intensity: 'gentle' })
      );

      act(() => {
        result.current.vibrate([100, 50, 100]);
      });

      // Gentle scales by 0.6
      expect(vibrateMock).toHaveBeenCalledWith([60, 30, 60]);
    });

    it('should not scale pattern for normal intensity', () => {
      const { result } = renderHook(() =>
        useHapticFeedback({ enabled: true, intensity: 'normal' })
      );

      act(() => {
        result.current.vibrate([100, 50, 100]);
      });

      expect(vibrateMock).toHaveBeenCalledWith([100, 50, 100]);
    });
  });

  describe('stop function', () => {
    it('should call navigator.vibrate with 0', () => {
      const { result } = renderHook(() => useHapticFeedback({ enabled: true }));

      act(() => {
        result.current.stop();
      });

      expect(vibrateMock).toHaveBeenCalledWith(0);
    });
  });

  describe('vibrateForThreatLevel', () => {
    it('should vibrate with info pattern', () => {
      const { result } = renderHook(() => useHapticFeedback({ enabled: true }));

      act(() => {
        result.current.vibrateForThreatLevel('info');
      });

      expect(vibrateMock).toHaveBeenCalledWith([100]);
    });

    it('should vibrate with warning pattern', () => {
      const { result } = renderHook(() => useHapticFeedback({ enabled: true }));

      act(() => {
        result.current.vibrateForThreatLevel('warning');
      });

      expect(vibrateMock).toHaveBeenCalledWith([150, 100, 150]);
    });

    it('should vibrate with critical pattern', () => {
      const { result } = renderHook(() => useHapticFeedback({ enabled: true }));

      act(() => {
        result.current.vibrateForThreatLevel('critical');
      });

      expect(vibrateMock).toHaveBeenCalledWith([200, 100, 200, 100, 200]);
    });

    it('should default to info pattern for unknown level', () => {
      const { result } = renderHook(() => useHapticFeedback({ enabled: true }));

      act(() => {
        result.current.vibrateForThreatLevel('unknown');
      });

      expect(vibrateMock).toHaveBeenCalledWith([100]);
    });
  });

  describe('vibrateNewThreat', () => {
    it('should vibrate with new threat pattern', () => {
      const { result } = renderHook(() => useHapticFeedback({ enabled: true }));

      act(() => {
        result.current.vibrateNewThreat();
      });

      expect(vibrateMock).toHaveBeenCalledWith([100, 50, 100, 50, 300]);
    });

    it('should combine with critical pattern for critical threats', () => {
      const { result } = renderHook(() => useHapticFeedback({ enabled: true }));

      act(() => {
        result.current.vibrateNewThreat('critical');
      });

      expect(vibrateMock).toHaveBeenCalledWith([100, 50, 100, 50, 300, 200, 200, 100, 200, 100, 200]);
    });
  });

  describe('specific vibration patterns', () => {
    it('should vibrate approaching pattern', () => {
      const { result } = renderHook(() => useHapticFeedback({ enabled: true }));

      act(() => {
        result.current.vibrateApproaching();
      });

      expect(vibrateMock).toHaveBeenCalledWith([100, 100, 150, 100, 200]);
    });

    it('should vibrate departing pattern', () => {
      const { result } = renderHook(() => useHapticFeedback({ enabled: true }));

      act(() => {
        result.current.vibrateDeparting();
      });

      expect(vibrateMock).toHaveBeenCalledWith([200, 100, 100]);
    });

    it('should vibrate clear pattern', () => {
      const { result } = renderHook(() => useHapticFeedback({ enabled: true }));

      act(() => {
        result.current.vibrateClear();
      });

      expect(vibrateMock).toHaveBeenCalledWith([50, 100, 50]);
    });

    it('should vibrate error pattern', () => {
      const { result } = renderHook(() => useHapticFeedback({ enabled: true }));

      act(() => {
        result.current.vibrateError();
      });

      expect(vibrateMock).toHaveBeenCalledWith([300, 100, 300]);
    });

    it('should vibrate select pattern', () => {
      const { result } = renderHook(() => useHapticFeedback({ enabled: true }));

      act(() => {
        result.current.vibrateSelect();
      });

      expect(vibrateMock).toHaveBeenCalledWith([50, 50, 50]);
    });
  });

  describe('vibrateTap', () => {
    it('should vibrate with tap pattern without throttling', () => {
      const { result } = renderHook(() => useHapticFeedback({ enabled: true }));

      // First tap
      act(() => {
        result.current.vibrateTap();
      });

      expect(vibrateMock).toHaveBeenCalledWith([30]);

      // Tap again immediately - should work because tap bypasses throttle
      act(() => {
        result.current.vibrateTap();
      });

      expect(vibrateMock).toHaveBeenCalledTimes(2);
    });

    it('should not tap when disabled', () => {
      const { result } = renderHook(() => useHapticFeedback({ enabled: false }));

      act(() => {
        result.current.vibrateTap();
      });

      expect(vibrateMock).not.toHaveBeenCalled();
    });
  });

  describe('continuous vibration', () => {
    it('should start continuous vibration', () => {
      const { result } = renderHook(() => useHapticFeedback({ enabled: true }));

      let intervalId;
      act(() => {
        intervalId = result.current.startContinuousVibration(1000);
      });

      expect(intervalId).toBeDefined();

      // Advance timer to first interval
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      // Should have vibrated at least once after the interval
      expect(vibrateMock).toHaveBeenCalled();
    });

    it('should stop continuous vibration', () => {
      const { result } = renderHook(() => useHapticFeedback({ enabled: true }));

      let intervalId;
      act(() => {
        intervalId = result.current.startContinuousVibration(1000);
      });

      act(() => {
        result.current.stopContinuousVibration(intervalId);
      });

      const callCount = vibrateMock.mock.calls.length;

      // Advance timer
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      // Should have stopped and called vibrate(0)
      expect(vibrateMock).toHaveBeenCalledWith(0);
    });

    it('should return null when disabled', () => {
      const { result } = renderHook(() => useHapticFeedback({ enabled: false }));

      let intervalId;
      act(() => {
        intervalId = result.current.startContinuousVibration(1000);
      });

      expect(intervalId).toBeNull();
    });
  });

  describe('cleanup', () => {
    it('should stop vibration on unmount', () => {
      const { unmount } = renderHook(() => useHapticFeedback({ enabled: true }));

      unmount();

      expect(vibrateMock).toHaveBeenCalledWith(0);
    });
  });

  describe('unsupported browsers', () => {
    it('should return false from vibrate when disabled', () => {
      // Test with enabled=false to verify the disabled path
      const { result } = renderHook(() => useHapticFeedback({ enabled: false }));

      // vibrate should return false when disabled
      let returnValue;
      act(() => {
        returnValue = result.current.vibrate([100]);
      });

      expect(returnValue).toBe(false);
    });

    it('should not throw when stop is called without active vibration', () => {
      const { result } = renderHook(() => useHapticFeedback({ enabled: false }));

      // Should not throw
      expect(() => {
        act(() => {
          result.current.stop();
        });
      }).not.toThrow();
    });
  });
});
