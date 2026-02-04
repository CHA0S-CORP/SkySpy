import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { useToast, useToastContext, useToastContextSafe, ToastContext, TOAST_TYPES } from './useToast';

describe('useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('TOAST_TYPES', () => {
    it('should export correct toast types', () => {
      expect(TOAST_TYPES.SUCCESS).toBe('success');
      expect(TOAST_TYPES.ERROR).toBe('error');
      expect(TOAST_TYPES.WARNING).toBe('warning');
      expect(TOAST_TYPES.INFO).toBe('info');
    });
  });

  describe('initial state', () => {
    it('should start with empty toasts array', () => {
      const { result } = renderHook(() => useToast());
      expect(result.current.toasts).toEqual([]);
    });

    it('should provide all required methods', () => {
      const { result } = renderHook(() => useToast());
      expect(typeof result.current.addToast).toBe('function');
      expect(typeof result.current.removeToast).toBe('function');
      expect(typeof result.current.clearToasts).toBe('function');
      expect(typeof result.current.success).toBe('function');
      expect(typeof result.current.error).toBe('function');
      expect(typeof result.current.warning).toBe('function');
      expect(typeof result.current.info).toBe('function');
    });
  });

  describe('addToast', () => {
    it('should add a toast with default type and duration', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.addToast('Test message');
      });

      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0].message).toBe('Test message');
      expect(result.current.toasts[0].type).toBe(TOAST_TYPES.INFO);
      expect(result.current.toasts[0].duration).toBe(3000);
    });

    it('should add a toast with custom type', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.addToast('Error message', TOAST_TYPES.ERROR);
      });

      expect(result.current.toasts[0].type).toBe(TOAST_TYPES.ERROR);
    });

    it('should add a toast with custom duration', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.addToast('Custom duration', TOAST_TYPES.INFO, 5000);
      });

      expect(result.current.toasts[0].duration).toBe(5000);
    });

    it('should add toast with onClick handler', () => {
      const { result } = renderHook(() => useToast());
      const onClick = vi.fn();

      act(() => {
        result.current.addToast('Clickable', TOAST_TYPES.INFO, 3000, { onClick });
      });

      expect(result.current.toasts[0].onClick).toBe(onClick);
    });

    it('should add toast with action button', () => {
      const { result } = renderHook(() => useToast());
      const onAction = vi.fn();

      act(() => {
        result.current.addToast('With action', TOAST_TYPES.INFO, 3000, {
          actionLabel: 'Undo',
          onAction,
        });
      });

      expect(result.current.toasts[0].actionLabel).toBe('Undo');
      expect(result.current.toasts[0].onAction).toBe(onAction);
    });

    it('should return toast ID', () => {
      const { result } = renderHook(() => useToast());

      let id;
      act(() => {
        id = result.current.addToast('Test');
      });

      expect(typeof id).toBe('number');
      expect(id).toBeGreaterThan(0);
    });

    it('should generate unique IDs for each toast', () => {
      const { result } = renderHook(() => useToast());

      let id1, id2;
      act(() => {
        id1 = result.current.addToast('Toast 1');
        id2 = result.current.addToast('Toast 2');
      });

      expect(id1).not.toBe(id2);
    });

    it('should include createdAt timestamp', () => {
      const { result } = renderHook(() => useToast());
      const beforeCreate = Date.now();

      act(() => {
        result.current.addToast('Test');
      });

      const afterCreate = Date.now();
      expect(result.current.toasts[0].createdAt).toBeGreaterThanOrEqual(beforeCreate);
      expect(result.current.toasts[0].createdAt).toBeLessThanOrEqual(afterCreate);
    });
  });

  describe('auto-dismiss', () => {
    it('should auto-dismiss toast after default duration', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.addToast('Auto dismiss');
      });

      expect(result.current.toasts).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(result.current.toasts).toHaveLength(0);
    });

    it('should auto-dismiss toast after custom duration', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.addToast('Custom dismiss', TOAST_TYPES.INFO, 5000);
      });

      expect(result.current.toasts).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(4999);
      });

      expect(result.current.toasts).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(1);
      });

      expect(result.current.toasts).toHaveLength(0);
    });

    it('should not auto-dismiss when duration is 0', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.addToast('No dismiss', TOAST_TYPES.INFO, 0);
      });

      expect(result.current.toasts).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(10000);
      });

      expect(result.current.toasts).toHaveLength(1);
    });
  });

  describe('removeToast', () => {
    it('should remove a specific toast by ID', () => {
      const { result } = renderHook(() => useToast());

      let id;
      act(() => {
        id = result.current.addToast('To remove', TOAST_TYPES.INFO, 0);
        result.current.addToast('To keep', TOAST_TYPES.INFO, 0);
      });

      expect(result.current.toasts).toHaveLength(2);

      act(() => {
        result.current.removeToast(id);
      });

      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0].message).toBe('To keep');
    });

    it('should clear timeout when removing toast early', () => {
      const { result } = renderHook(() => useToast());

      let id;
      act(() => {
        id = result.current.addToast('Early remove', TOAST_TYPES.INFO, 5000);
      });

      act(() => {
        result.current.removeToast(id);
      });

      expect(result.current.toasts).toHaveLength(0);

      // Advance time past original duration - should not cause errors
      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(result.current.toasts).toHaveLength(0);
    });

    it('should handle removing non-existent toast gracefully', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.addToast('Test');
      });

      act(() => {
        result.current.removeToast(99999); // Non-existent ID
      });

      expect(result.current.toasts).toHaveLength(1);
    });
  });

  describe('clearToasts', () => {
    it('should remove all toasts', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.addToast('Toast 1', TOAST_TYPES.INFO, 0);
        result.current.addToast('Toast 2', TOAST_TYPES.INFO, 0);
        result.current.addToast('Toast 3', TOAST_TYPES.INFO, 0);
      });

      expect(result.current.toasts).toHaveLength(3);

      act(() => {
        result.current.clearToasts();
      });

      expect(result.current.toasts).toHaveLength(0);
    });

    it('should work on empty toasts array', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.clearToasts();
      });

      expect(result.current.toasts).toHaveLength(0);
    });
  });

  describe('convenience methods', () => {
    it('success() should create success toast', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.success('Success message');
      });

      expect(result.current.toasts[0].type).toBe(TOAST_TYPES.SUCCESS);
      expect(result.current.toasts[0].message).toBe('Success message');
    });

    it('error() should create error toast', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.error('Error message');
      });

      expect(result.current.toasts[0].type).toBe(TOAST_TYPES.ERROR);
      expect(result.current.toasts[0].message).toBe('Error message');
    });

    it('warning() should create warning toast', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.warning('Warning message');
      });

      expect(result.current.toasts[0].type).toBe(TOAST_TYPES.WARNING);
      expect(result.current.toasts[0].message).toBe('Warning message');
    });

    it('info() should create info toast', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.info('Info message');
      });

      expect(result.current.toasts[0].type).toBe(TOAST_TYPES.INFO);
      expect(result.current.toasts[0].message).toBe('Info message');
    });

    it('convenience methods should accept custom duration', () => {
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.success('Success', 10000);
      });

      expect(result.current.toasts[0].duration).toBe(10000);
    });
  });

  describe('cleanup on unmount', () => {
    it('should clear pending timeouts on unmount', () => {
      const { result, unmount } = renderHook(() => useToast());

      act(() => {
        result.current.addToast('Toast 1', TOAST_TYPES.INFO, 5000);
        result.current.addToast('Toast 2', TOAST_TYPES.INFO, 5000);
      });

      unmount();

      // Should not throw when timers fire after unmount
      act(() => {
        vi.advanceTimersByTime(5000);
      });
    });
  });
});

describe('useToastContext', () => {
  it('should throw error when used outside provider', () => {
    expect(() => {
      renderHook(() => useToastContext());
    }).toThrow('useToastContext must be used within a ToastProvider');
  });

  it('should return context value when inside provider', () => {
    const mockToast = {
      toasts: [],
      addToast: vi.fn(),
      removeToast: vi.fn(),
      clearToasts: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    };

    const wrapper = ({ children }) => (
      <ToastContext.Provider value={mockToast}>{children}</ToastContext.Provider>
    );

    const { result } = renderHook(() => useToastContext(), { wrapper });

    expect(result.current).toBe(mockToast);
  });
});

describe('useToastContextSafe', () => {
  it('should return null when used outside provider', () => {
    const { result } = renderHook(() => useToastContextSafe());
    expect(result.current).toBeNull();
  });

  it('should return context value when inside provider', () => {
    const mockToast = { toasts: [] };

    const wrapper = ({ children }) => (
      <ToastContext.Provider value={mockToast}>{children}</ToastContext.Provider>
    );

    const { result } = renderHook(() => useToastContextSafe(), { wrapper });

    expect(result.current).toBe(mockToast);
  });
});
