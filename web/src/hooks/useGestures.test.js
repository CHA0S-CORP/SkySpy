import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGestures } from './useGestures';

describe('useGestures', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // Helper to create touch event
  const createTouchEvent = (clientX, clientY) => ({
    touches: [{ clientX, clientY }],
    changedTouches: [{ clientX, clientY }],
  });

  describe('initialization', () => {
    it('should return touch event handlers', () => {
      const { result } = renderHook(() => useGestures());

      expect(result.current.onTouchStart).toBeDefined();
      expect(result.current.onTouchMove).toBeDefined();
      expect(result.current.onTouchEnd).toBeDefined();
      expect(result.current.onTouchCancel).toBeDefined();
    });
  });

  describe('swipe detection', () => {
    it('should detect swipe right', () => {
      const onSwipeRight = vi.fn();
      const { result } = renderHook(() => useGestures({ onSwipeRight }));

      // Start touch at (100, 100)
      act(() => {
        result.current.onTouchStart(createTouchEvent(100, 100));
      });

      // End touch at (200, 100) - 100px to the right
      act(() => {
        result.current.onTouchEnd(createTouchEvent(200, 100));
      });

      expect(onSwipeRight).toHaveBeenCalled();
    });

    it('should detect swipe left', () => {
      const onSwipeLeft = vi.fn();
      const { result } = renderHook(() => useGestures({ onSwipeLeft }));

      act(() => {
        result.current.onTouchStart(createTouchEvent(200, 100));
      });

      act(() => {
        result.current.onTouchEnd(createTouchEvent(100, 100));
      });

      expect(onSwipeLeft).toHaveBeenCalled();
    });

    it('should detect swipe up', () => {
      const onSwipeUp = vi.fn();
      const { result } = renderHook(() => useGestures({ onSwipeUp }));

      act(() => {
        result.current.onTouchStart(createTouchEvent(100, 200));
      });

      act(() => {
        result.current.onTouchEnd(createTouchEvent(100, 100));
      });

      expect(onSwipeUp).toHaveBeenCalled();
    });

    it('should detect swipe down', () => {
      const onSwipeDown = vi.fn();
      const { result } = renderHook(() => useGestures({ onSwipeDown }));

      act(() => {
        result.current.onTouchStart(createTouchEvent(100, 100));
      });

      act(() => {
        result.current.onTouchEnd(createTouchEvent(100, 200));
      });

      expect(onSwipeDown).toHaveBeenCalled();
    });

    it('should not detect swipe if movement is too small', () => {
      const onSwipeRight = vi.fn();
      const { result } = renderHook(() => useGestures({ onSwipeRight }));

      act(() => {
        result.current.onTouchStart(createTouchEvent(100, 100));
      });

      // Only move 30px (less than 50px threshold)
      act(() => {
        result.current.onTouchEnd(createTouchEvent(130, 100));
      });

      expect(onSwipeRight).not.toHaveBeenCalled();
    });

    it('should not detect swipe if time exceeds threshold', () => {
      const onSwipeRight = vi.fn();
      const { result } = renderHook(() => useGestures({ onSwipeRight }));

      act(() => {
        result.current.onTouchStart(createTouchEvent(100, 100));
      });

      // Advance time past the 300ms threshold
      act(() => {
        vi.advanceTimersByTime(400);
      });

      act(() => {
        result.current.onTouchEnd(createTouchEvent(200, 100));
      });

      expect(onSwipeRight).not.toHaveBeenCalled();
    });

    it('should prioritize horizontal swipe when x > y movement', () => {
      const onSwipeRight = vi.fn();
      const onSwipeDown = vi.fn();
      const { result } = renderHook(() => useGestures({ onSwipeRight, onSwipeDown }));

      act(() => {
        result.current.onTouchStart(createTouchEvent(100, 100));
      });

      // Move more horizontally than vertically
      act(() => {
        result.current.onTouchEnd(createTouchEvent(200, 140));
      });

      expect(onSwipeRight).toHaveBeenCalled();
      expect(onSwipeDown).not.toHaveBeenCalled();
    });

    it('should prioritize vertical swipe when y > x movement', () => {
      const onSwipeRight = vi.fn();
      const onSwipeDown = vi.fn();
      const { result } = renderHook(() => useGestures({ onSwipeRight, onSwipeDown }));

      act(() => {
        result.current.onTouchStart(createTouchEvent(100, 100));
      });

      // Move more vertically than horizontally
      act(() => {
        result.current.onTouchEnd(createTouchEvent(140, 200));
      });

      expect(onSwipeDown).toHaveBeenCalled();
      expect(onSwipeRight).not.toHaveBeenCalled();
    });
  });

  describe('double tap detection', () => {
    it('should detect double tap', () => {
      const onDoubleTap = vi.fn();
      const { result } = renderHook(() => useGestures({ onDoubleTap }));

      // First tap
      act(() => {
        result.current.onTouchStart(createTouchEvent(100, 100));
      });
      act(() => {
        result.current.onTouchEnd(createTouchEvent(100, 100));
      });

      // Advance time slightly (but within double tap threshold)
      act(() => {
        vi.advanceTimersByTime(200);
      });

      // Second tap
      act(() => {
        result.current.onTouchStart(createTouchEvent(100, 100));
      });
      act(() => {
        result.current.onTouchEnd(createTouchEvent(100, 100));
      });

      expect(onDoubleTap).toHaveBeenCalled();
    });

    it('should not detect double tap if taps are too far apart in time', () => {
      const onDoubleTap = vi.fn();
      const { result } = renderHook(() => useGestures({ onDoubleTap }));

      // First tap
      act(() => {
        result.current.onTouchStart(createTouchEvent(100, 100));
      });
      act(() => {
        result.current.onTouchEnd(createTouchEvent(100, 100));
      });

      // Advance time past double tap threshold (300ms)
      act(() => {
        vi.advanceTimersByTime(400);
      });

      // Second tap
      act(() => {
        result.current.onTouchStart(createTouchEvent(100, 100));
      });
      act(() => {
        result.current.onTouchEnd(createTouchEvent(100, 100));
      });

      expect(onDoubleTap).not.toHaveBeenCalled();
    });

    it('should not detect double tap if there is significant movement', () => {
      const onDoubleTap = vi.fn();
      const { result } = renderHook(() => useGestures({ onDoubleTap }));

      // First tap with movement
      act(() => {
        result.current.onTouchStart(createTouchEvent(100, 100));
      });
      act(() => {
        result.current.onTouchEnd(createTouchEvent(130, 100)); // Move 30px
      });

      // Second tap
      act(() => {
        result.current.onTouchStart(createTouchEvent(100, 100));
      });
      act(() => {
        result.current.onTouchEnd(createTouchEvent(100, 100));
      });

      expect(onDoubleTap).not.toHaveBeenCalled();
    });
  });

  describe('long press detection', () => {
    it('should detect long press', () => {
      const onLongPress = vi.fn();
      const { result } = renderHook(() => useGestures({ onLongPress }));

      act(() => {
        result.current.onTouchStart(createTouchEvent(100, 100));
      });

      // Advance time past long press threshold (500ms)
      act(() => {
        vi.advanceTimersByTime(600);
      });

      expect(onLongPress).toHaveBeenCalled();
    });

    it('should cancel long press on touch move', () => {
      const onLongPress = vi.fn();
      const { result } = renderHook(() => useGestures({ onLongPress }));

      act(() => {
        result.current.onTouchStart(createTouchEvent(100, 100));
      });

      // Move before long press triggers
      act(() => {
        vi.advanceTimersByTime(200);
        result.current.onTouchMove(createTouchEvent(150, 100));
      });

      // Advance past long press threshold
      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(onLongPress).not.toHaveBeenCalled();
    });

    it('should cancel long press on touch end', () => {
      const onLongPress = vi.fn();
      const { result } = renderHook(() => useGestures({ onLongPress }));

      act(() => {
        result.current.onTouchStart(createTouchEvent(100, 100));
      });

      // End touch before long press triggers
      act(() => {
        vi.advanceTimersByTime(200);
        result.current.onTouchEnd(createTouchEvent(100, 100));
      });

      // Advance past long press threshold
      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(onLongPress).not.toHaveBeenCalled();
    });

    it('should cancel long press on touch cancel', () => {
      const onLongPress = vi.fn();
      const { result } = renderHook(() => useGestures({ onLongPress }));

      act(() => {
        result.current.onTouchStart(createTouchEvent(100, 100));
      });

      act(() => {
        vi.advanceTimersByTime(200);
        result.current.onTouchCancel();
      });

      // Advance past long press threshold
      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(onLongPress).not.toHaveBeenCalled();
    });

    it('should prevent swipe after long press', () => {
      const onLongPress = vi.fn();
      const onSwipeRight = vi.fn();
      const { result } = renderHook(() => useGestures({ onLongPress, onSwipeRight }));

      act(() => {
        result.current.onTouchStart(createTouchEvent(100, 100));
      });

      // Trigger long press
      act(() => {
        vi.advanceTimersByTime(600);
      });

      // End touch with swipe-like movement
      act(() => {
        result.current.onTouchEnd(createTouchEvent(200, 100));
      });

      expect(onLongPress).toHaveBeenCalled();
      expect(onSwipeRight).not.toHaveBeenCalled();
    });
  });

  describe('enabled prop', () => {
    it('should not detect gestures when disabled', () => {
      const onSwipeRight = vi.fn();
      const onDoubleTap = vi.fn();
      const onLongPress = vi.fn();
      const { result } = renderHook(() =>
        useGestures({
          onSwipeRight,
          onDoubleTap,
          onLongPress,
          enabled: false,
        })
      );

      // Try swipe
      act(() => {
        result.current.onTouchStart(createTouchEvent(100, 100));
      });
      act(() => {
        result.current.onTouchEnd(createTouchEvent(200, 100));
      });

      expect(onSwipeRight).not.toHaveBeenCalled();
      expect(onDoubleTap).not.toHaveBeenCalled();
    });
  });

  describe('multiple callbacks', () => {
    it('should support multiple gesture callbacks simultaneously', () => {
      const onSwipeLeft = vi.fn();
      const onSwipeRight = vi.fn();
      const onSwipeUp = vi.fn();
      const onSwipeDown = vi.fn();

      const { result } = renderHook(() =>
        useGestures({
          onSwipeLeft,
          onSwipeRight,
          onSwipeUp,
          onSwipeDown,
        })
      );

      // Test swipe right
      act(() => {
        result.current.onTouchStart(createTouchEvent(100, 100));
      });
      act(() => {
        result.current.onTouchEnd(createTouchEvent(200, 100));
      });
      expect(onSwipeRight).toHaveBeenCalledTimes(1);

      // Test swipe left
      act(() => {
        result.current.onTouchStart(createTouchEvent(200, 100));
      });
      act(() => {
        result.current.onTouchEnd(createTouchEvent(100, 100));
      });
      expect(onSwipeLeft).toHaveBeenCalledTimes(1);
    });
  });

  describe('edge cases', () => {
    it('should handle touch end without touch start', () => {
      const onSwipeRight = vi.fn();
      const { result } = renderHook(() => useGestures({ onSwipeRight }));

      // Should not throw
      expect(() => {
        act(() => {
          result.current.onTouchEnd(createTouchEvent(200, 100));
        });
      }).not.toThrow();

      expect(onSwipeRight).not.toHaveBeenCalled();
    });

    it('should handle missing callbacks gracefully', () => {
      const { result } = renderHook(() => useGestures());

      // Should not throw
      expect(() => {
        act(() => {
          result.current.onTouchStart(createTouchEvent(100, 100));
        });
        act(() => {
          result.current.onTouchEnd(createTouchEvent(200, 100));
        });
      }).not.toThrow();
    });

    it('should reset state on touch cancel', () => {
      const onSwipeRight = vi.fn();
      const { result } = renderHook(() => useGestures({ onSwipeRight }));

      act(() => {
        result.current.onTouchStart(createTouchEvent(100, 100));
      });

      act(() => {
        result.current.onTouchCancel();
      });

      // Start a new gesture
      act(() => {
        result.current.onTouchStart(createTouchEvent(100, 100));
      });
      act(() => {
        result.current.onTouchEnd(createTouchEvent(200, 100));
      });

      expect(onSwipeRight).toHaveBeenCalledTimes(1);
    });
  });
});
