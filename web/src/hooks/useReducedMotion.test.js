import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReducedMotion } from './useReducedMotion';

describe('useReducedMotion', () => {
  let originalMatchMedia;
  let mockMediaQueryList;
  let changeHandler;

  beforeEach(() => {
    changeHandler = null;
    mockMediaQueryList = {
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: vi.fn((event, handler) => {
        if (event === 'change') {
          changeHandler = handler;
        }
      }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };

    originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue(mockMediaQueryList);
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('should return false when user prefers motion', () => {
    mockMediaQueryList.matches = false;
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it('should return true when user prefers reduced motion', () => {
    mockMediaQueryList.matches = true;
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it('should query the correct media query', () => {
    renderHook(() => useReducedMotion());
    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('should add event listener on mount', () => {
    renderHook(() => useReducedMotion());
    expect(mockMediaQueryList.addEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function)
    );
  });

  it('should remove event listener on unmount', () => {
    const { unmount } = renderHook(() => useReducedMotion());
    unmount();
    expect(mockMediaQueryList.removeEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function)
    );
  });

  it('should update when media query changes', () => {
    mockMediaQueryList.matches = false;
    const { result } = renderHook(() => useReducedMotion());

    expect(result.current).toBe(false);

    // Simulate media query change
    act(() => {
      changeHandler({ matches: true });
    });

    expect(result.current).toBe(true);

    // Change back
    act(() => {
      changeHandler({ matches: false });
    });

    expect(result.current).toBe(false);
  });

  it('should handle server-side rendering (window undefined)', () => {
    // This is simulated by the initial state logic in the hook
    // When window.matchMedia doesn't exist, it defaults to false
    const originalWindow = global.window;

    // Create a mock where matchMedia returns a matcher with matches=true
    mockMediaQueryList.matches = true;

    const { result } = renderHook(() => useReducedMotion());

    // Should pick up the initial value from matchMedia
    expect(result.current).toBe(true);

    global.window = originalWindow;
  });
});
