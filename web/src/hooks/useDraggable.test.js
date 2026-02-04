import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDraggable } from './useDraggable';

describe('useDraggable', () => {
  let addEventListenerSpy;
  let removeEventListenerSpy;
  let mouseMoveCb;
  let mouseUpCb;
  let touchMoveCb;
  let touchEndCb;

  beforeEach(() => {
    // Track event listeners
    mouseMoveCb = null;
    mouseUpCb = null;
    touchMoveCb = null;
    touchEndCb = null;

    addEventListenerSpy = vi.spyOn(window, 'addEventListener').mockImplementation((event, handler) => {
      if (event === 'mousemove') mouseMoveCb = handler;
      if (event === 'mouseup') mouseUpCb = handler;
      if (event === 'touchmove') touchMoveCb = handler;
      if (event === 'touchend') touchEndCb = handler;
    });

    removeEventListenerSpy = vi.spyOn(window, 'removeEventListener').mockImplementation(() => {});

    // Mock window dimensions
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: 768, writable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper to create mouse event
  const createMouseEvent = (clientX, clientY, target = document.createElement('div')) => ({
    clientX,
    clientY,
    target,
    currentTarget: {
      getBoundingClientRect: () => ({
        left: 100,
        top: 100,
        width: 300,
        height: 400,
      }),
    },
    preventDefault: vi.fn(),
  });

  // Helper to create touch event
  const createTouchEvent = (clientX, clientY) => ({
    touches: [{ clientX, clientY }],
  });

  describe('initialization', () => {
    it('should initialize with null position by default', () => {
      const { result } = renderHook(() => useDraggable());

      expect(result.current.position).toEqual({ x: null, y: null });
      expect(result.current.isDragging).toBe(false);
    });

    it('should initialize with provided initial position', () => {
      const { result } = renderHook(() => useDraggable({ x: 50, y: 100 }));

      expect(result.current.position).toEqual({ x: 50, y: 100 });
    });

    it('should return drag props', () => {
      const { result } = renderHook(() => useDraggable());

      expect(result.current.dragProps.onMouseDown).toBeDefined();
      expect(result.current.dragProps.onTouchStart).toBeDefined();
    });

    it('should return style in dragProps when position is set', () => {
      const { result } = renderHook(() => useDraggable({ x: 50, y: 100 }));

      expect(result.current.dragProps.style).toEqual({
        position: 'fixed',
        left: 50,
        top: 100,
      });
    });

    it('should return undefined style when position is null', () => {
      const { result } = renderHook(() => useDraggable());

      expect(result.current.dragProps.style).toBeUndefined();
    });
  });

  describe('mouse drag', () => {
    it('should start dragging on mouse down', () => {
      const { result } = renderHook(() => useDraggable());

      act(() => {
        result.current.handleMouseDown(createMouseEvent(200, 200));
      });

      expect(result.current.isDragging).toBe(true);
    });

    it('should not start dragging on button click', () => {
      const button = document.createElement('button');
      const target = document.createElement('div');
      target.appendChild(button);

      const { result } = renderHook(() => useDraggable());

      const event = {
        ...createMouseEvent(200, 200, button),
        target: button,
      };

      act(() => {
        result.current.handleMouseDown(event);
      });

      expect(result.current.isDragging).toBe(false);
    });

    it('should not start dragging on input click', () => {
      const input = document.createElement('input');

      const { result } = renderHook(() => useDraggable());

      const event = {
        ...createMouseEvent(200, 200, input),
        target: input,
      };

      act(() => {
        result.current.handleMouseDown(event);
      });

      expect(result.current.isDragging).toBe(false);
    });

    it('should not start dragging on no-drag class element', () => {
      const noDrag = document.createElement('div');
      noDrag.classList.add('no-drag');

      const { result } = renderHook(() => useDraggable());

      const event = {
        ...createMouseEvent(200, 200, noDrag),
        target: noDrag,
      };

      act(() => {
        result.current.handleMouseDown(event);
      });

      expect(result.current.isDragging).toBe(false);
    });

    it('should update position on mouse move', () => {
      const { result } = renderHook(() => useDraggable({ x: 100, y: 100 }));

      act(() => {
        result.current.handleMouseDown(createMouseEvent(200, 200));
      });

      act(() => {
        if (mouseMoveCb) {
          mouseMoveCb({ clientX: 250, clientY: 250 });
        }
      });

      expect(result.current.position.x).toBeGreaterThan(100);
      expect(result.current.position.y).toBeGreaterThan(100);
    });

    it('should stop dragging on mouse up', () => {
      const { result } = renderHook(() => useDraggable());

      act(() => {
        result.current.handleMouseDown(createMouseEvent(200, 200));
      });

      expect(result.current.isDragging).toBe(true);

      act(() => {
        if (mouseUpCb) {
          mouseUpCb();
        }
      });

      expect(result.current.isDragging).toBe(false);
    });

    it('should add event listeners when dragging starts', () => {
      const { result } = renderHook(() => useDraggable());

      act(() => {
        result.current.handleMouseDown(createMouseEvent(200, 200));
      });

      expect(addEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
    });

    it('should remove event listeners when dragging stops', () => {
      const { result } = renderHook(() => useDraggable());

      act(() => {
        result.current.handleMouseDown(createMouseEvent(200, 200));
      });

      act(() => {
        if (mouseUpCb) {
          mouseUpCb();
        }
      });

      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
    });
  });

  describe('touch drag', () => {
    it('should update position on touch move', () => {
      const { result } = renderHook(() => useDraggable({ x: 100, y: 100 }));

      act(() => {
        result.current.handleMouseDown(createMouseEvent(200, 200));
      });

      act(() => {
        if (touchMoveCb) {
          touchMoveCb(createTouchEvent(250, 250));
        }
      });

      expect(result.current.position.x).toBeGreaterThan(100);
      expect(result.current.position.y).toBeGreaterThan(100);
    });

    it('should stop dragging on touch end', () => {
      const { result } = renderHook(() => useDraggable());

      act(() => {
        result.current.handleMouseDown(createMouseEvent(200, 200));
      });

      expect(result.current.isDragging).toBe(true);

      act(() => {
        if (touchEndCb) {
          touchEndCb();
        }
      });

      expect(result.current.isDragging).toBe(false);
    });

    it('should add touch event listeners when dragging starts', () => {
      const { result } = renderHook(() => useDraggable());

      act(() => {
        result.current.handleMouseDown(createMouseEvent(200, 200));
      });

      expect(addEventListenerSpy).toHaveBeenCalledWith('touchmove', expect.any(Function), { passive: true });
      expect(addEventListenerSpy).toHaveBeenCalledWith('touchend', expect.any(Function), { passive: true });
    });
  });

  describe('bounds checking', () => {
    it('should constrain position to viewport bounds', () => {
      const { result } = renderHook(() => useDraggable({ x: 100, y: 100 }, { width: 300, height: 400 }));

      act(() => {
        result.current.handleMouseDown(createMouseEvent(200, 200));
      });

      // Try to drag way off screen to the right
      act(() => {
        if (mouseMoveCb) {
          mouseMoveCb({ clientX: 2000, clientY: 200 });
        }
      });

      // Should be constrained to max X (viewport width - element width)
      expect(result.current.position.x).toBeLessThanOrEqual(1024 - 300);
    });

    it('should not allow negative position', () => {
      const { result } = renderHook(() => useDraggable({ x: 100, y: 100 }));

      act(() => {
        result.current.handleMouseDown(createMouseEvent(200, 200));
      });

      // Try to drag to negative position
      act(() => {
        if (mouseMoveCb) {
          mouseMoveCb({ clientX: -100, clientY: -100 });
        }
      });

      expect(result.current.position.x).toBeGreaterThanOrEqual(0);
      expect(result.current.position.y).toBeGreaterThanOrEqual(0);
    });
  });

  describe('setPosition', () => {
    it('should allow manual position setting', () => {
      const { result } = renderHook(() => useDraggable());

      act(() => {
        result.current.setPosition({ x: 200, y: 300 });
      });

      expect(result.current.position).toEqual({ x: 200, y: 300 });
    });
  });

  describe('resetPosition', () => {
    it('should reset to initial position', () => {
      const initialPosition = { x: 50, y: 75 };
      const { result } = renderHook(() => useDraggable(initialPosition));

      // Change position
      act(() => {
        result.current.setPosition({ x: 200, y: 300 });
      });

      expect(result.current.position).toEqual({ x: 200, y: 300 });

      // Reset
      act(() => {
        result.current.resetPosition();
      });

      expect(result.current.position).toEqual(initialPosition);
    });
  });

  describe('cleanup', () => {
    it('should remove event listeners on unmount', () => {
      const { result, unmount } = renderHook(() => useDraggable());

      act(() => {
        result.current.handleMouseDown(createMouseEvent(200, 200));
      });

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('touchmove', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('touchend', expect.any(Function));
    });

    it('should remove event listeners even when not dragging on unmount', () => {
      const { unmount } = renderHook(() => useDraggable());

      unmount();

      // Should still call removeEventListener for cleanup
      expect(removeEventListenerSpy).toHaveBeenCalled();
    });
  });

  describe('element size', () => {
    it('should use custom element size for bounds calculation', () => {
      const customSize = { width: 500, height: 600 };
      const { result } = renderHook(() => useDraggable({ x: 100, y: 100 }, customSize));

      act(() => {
        result.current.handleMouseDown(createMouseEvent(200, 200));
      });

      // Try to drag to right edge
      act(() => {
        if (mouseMoveCb) {
          mouseMoveCb({ clientX: 2000, clientY: 200 });
        }
      });

      // Max X should be viewport width minus element width
      expect(result.current.position.x).toBeLessThanOrEqual(1024 - 500);
    });
  });
});
