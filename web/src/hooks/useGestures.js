/**
 * useGestures - Hook for detecting touch gestures
 *
 * Supports:
 * - Swipe left/right/up/down
 * - Double-tap
 * - Long press
 */
import { useCallback, useRef } from 'react';

const SWIPE_THRESHOLD = 50; // Minimum distance for swipe
const SWIPE_TIMEOUT = 300; // Max time for swipe gesture
const DOUBLE_TAP_DELAY = 300; // Max time between taps
const LONG_PRESS_DELAY = 500; // Time for long press

export function useGestures({
  onSwipeLeft,
  onSwipeRight,
  onSwipeUp,
  onSwipeDown,
  onDoubleTap,
  onLongPress,
  enabled = true,
} = {}) {
  const touchStartRef = useRef(null);
  const touchTimeRef = useRef(null);
  const lastTapRef = useRef(0);
  const longPressTimerRef = useRef(null);

  const handleTouchStart = useCallback((e) => {
    if (!enabled) return;

    const touch = e.touches[0];
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    };
    touchTimeRef.current = Date.now();

    // Start long press timer
    if (onLongPress) {
      longPressTimerRef.current = setTimeout(() => {
        onLongPress();
        touchStartRef.current = null; // Prevent swipe after long press
      }, LONG_PRESS_DELAY);
    }
  }, [enabled, onLongPress]);

  const handleTouchMove = useCallback(() => {
    // Cancel long press on move
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleTouchEnd = useCallback((e) => {
    if (!enabled) return;

    // Cancel long press timer
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (!touchStartRef.current) return;

    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    const deltaTime = Date.now() - touchTimeRef.current;

    // Check for double tap (small movement, quick taps)
    const isQuickTap = deltaTime < SWIPE_TIMEOUT &&
      Math.abs(deltaX) < 20 &&
      Math.abs(deltaY) < 20;

    if (isQuickTap && onDoubleTap) {
      const now = Date.now();
      if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
        onDoubleTap();
        lastTapRef.current = 0; // Reset to prevent triple-tap
        touchStartRef.current = null;
        return;
      }
      lastTapRef.current = now;
    }

    // Check for swipe
    if (deltaTime < SWIPE_TIMEOUT) {
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      // Horizontal swipe
      if (absX > SWIPE_THRESHOLD && absX > absY) {
        if (deltaX > 0 && onSwipeRight) {
          onSwipeRight();
        } else if (deltaX < 0 && onSwipeLeft) {
          onSwipeLeft();
        }
      }
      // Vertical swipe
      else if (absY > SWIPE_THRESHOLD && absY > absX) {
        if (deltaY > 0 && onSwipeDown) {
          onSwipeDown();
        } else if (deltaY < 0 && onSwipeUp) {
          onSwipeUp();
        }
      }
    }

    touchStartRef.current = null;
  }, [enabled, onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown, onDoubleTap]);

  const handleTouchCancel = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartRef.current = null;
  }, []);

  // Return handlers to attach to element
  return {
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onTouchEnd: handleTouchEnd,
    onTouchCancel: handleTouchCancel,
  };
}

export default useGestures;
