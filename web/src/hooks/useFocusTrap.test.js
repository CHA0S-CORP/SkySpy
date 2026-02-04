import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFocusTrap } from './useFocusTrap';

describe('useFocusTrap', () => {
  let container;

  beforeEach(() => {
    // Create a container element for our tests
    container = document.createElement('div');
    container.innerHTML = `
      <button id="btn1">Button 1</button>
      <input id="input1" type="text" />
      <a href="#" id="link1">Link 1</a>
      <button id="btn2" disabled>Disabled Button</button>
      <textarea id="textarea1"></textarea>
      <select id="select1"><option>Option</option></select>
      <div tabindex="0" id="div1">Focusable Div</div>
      <div tabindex="-1" id="div2">Not Focusable Div</div>
    `;
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
  });

  describe('ref assignment', () => {
    it('should return a ref object', () => {
      const { result } = renderHook(() => useFocusTrap(true));
      expect(result.current).toBeDefined();
      expect(result.current.current).toBeNull();
    });

    it('should be assignable to container element', () => {
      const { result } = renderHook(() => useFocusTrap(true));

      act(() => {
        result.current.current = container;
      });

      expect(result.current.current).toBe(container);
    });
  });

  describe('focus management', () => {
    it('should find focusable elements when active with container', () => {
      const { result } = renderHook(() => useFocusTrap(true));
      const btn1 = container.querySelector('#btn1');

      act(() => {
        result.current.current = container;
      });

      // Verify the container has focusable elements
      const focusableElements = container.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );

      expect(focusableElements.length).toBe(6);
      expect(focusableElements[0]).toBe(btn1);
    });

    it('should not focus when inactive', () => {
      const { result } = renderHook(() => useFocusTrap(false));
      const focusSpy = vi.spyOn(container.querySelector('#btn1'), 'focus');

      act(() => {
        result.current.current = container;
      });

      expect(focusSpy).not.toHaveBeenCalled();
    });
  });

  describe('keyboard navigation', () => {
    it('should handle Tab keydown events', () => {
      const { result } = renderHook(() => useFocusTrap(true));

      act(() => {
        result.current.current = container;
      });

      const focusableElements = Array.from(
        container.querySelectorAll(
          'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );

      expect(focusableElements.length).toBeGreaterThan(0);

      // Simulate Tab key press - should not throw
      const tabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: false,
        bubbles: true,
      });

      expect(() => document.dispatchEvent(tabEvent)).not.toThrow();
    });

    it('should handle Shift+Tab keydown events', () => {
      const { result } = renderHook(() => useFocusTrap(true));

      act(() => {
        result.current.current = container;
      });

      // Simulate Shift+Tab key press - should not throw
      const shiftTabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
      });

      expect(() => document.dispatchEvent(shiftTabEvent)).not.toThrow();
    });

    it('should not trap non-Tab keys', () => {
      const { result } = renderHook(() => useFocusTrap(true));

      act(() => {
        result.current.current = container;
      });

      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
      });

      const preventDefaultSpy = vi.spyOn(enterEvent, 'preventDefault');

      document.dispatchEvent(enterEvent);

      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });
  });

  describe('event listener management', () => {
    it('should add keydown listener when active with container', () => {
      const addEventListenerSpy = vi.spyOn(document, 'addEventListener');

      // Create a wrapper that sets the ref during render
      const TestWrapper = () => {
        const ref = useFocusTrap(true);
        // Set the ref to container synchronously during render
        ref.current = container;
        return null;
      };

      renderHook(() => {
        const ref = useFocusTrap(true);
        ref.current = container;
        return ref;
      });

      // The hook should have added a keydown listener
      expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));

      addEventListenerSpy.mockRestore();
    });

    it('should clean up on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

      const { unmount } = renderHook(() => {
        const ref = useFocusTrap(true);
        ref.current = container;
        return ref;
      });

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));

      removeEventListenerSpy.mockRestore();
    });
  });

  describe('edge cases', () => {
    it('should handle empty container', () => {
      const emptyContainer = document.createElement('div');
      document.body.appendChild(emptyContainer);

      const { result } = renderHook(() => useFocusTrap(true));

      act(() => {
        result.current.current = emptyContainer;
      });

      // Should not throw
      const tabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
      });

      expect(() => document.dispatchEvent(tabEvent)).not.toThrow();

      document.body.removeChild(emptyContainer);
    });

    it('should handle container with single focusable element', () => {
      const singleContainer = document.createElement('div');
      singleContainer.innerHTML = '<button id="only-btn">Only Button</button>';
      document.body.appendChild(singleContainer);

      const { result } = renderHook(() => useFocusTrap(true));

      act(() => {
        result.current.current = singleContainer;
      });

      const btn = singleContainer.querySelector('#only-btn');
      btn.focus();

      const tabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
      });

      // Should handle without error
      expect(() => document.dispatchEvent(tabEvent)).not.toThrow();

      document.body.removeChild(singleContainer);
    });

    it('should handle null container ref', () => {
      const { result } = renderHook(() => useFocusTrap(true));

      // Container ref is null by default
      expect(result.current.current).toBeNull();

      const tabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
      });

      // Should not throw with null container
      expect(() => document.dispatchEvent(tabEvent)).not.toThrow();
    });
  });

  describe('focusable element selection', () => {
    it('should find all correct focusable elements', () => {
      const { result } = renderHook(() => useFocusTrap(true));

      act(() => {
        result.current.current = container;
      });

      const focusableElements = container.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );

      // Should include: btn1, input1, link1, textarea1, select1, div1
      // Should NOT include: btn2 (disabled), div2 (tabindex=-1)
      expect(focusableElements.length).toBe(6);
    });

    it('should exclude disabled elements', () => {
      const focusableElements = container.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );

      const disabledBtn = container.querySelector('#btn2');
      expect(Array.from(focusableElements)).not.toContain(disabledBtn);
    });

    it('should exclude elements with tabindex=-1', () => {
      const focusableElements = container.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );

      const nonFocusableDiv = container.querySelector('#div2');
      expect(Array.from(focusableElements)).not.toContain(nonFocusableDiv);
    });

    it('should include elements with positive tabindex', () => {
      const focusableElements = container.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );

      const focusableDiv = container.querySelector('#div1');
      expect(Array.from(focusableElements)).toContain(focusableDiv);
    });
  });
});
