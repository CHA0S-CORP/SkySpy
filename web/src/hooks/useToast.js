import { useState, useCallback, useRef, useEffect, createContext, useContext } from 'react';

// Toast types
export const TOAST_TYPES = {
  SUCCESS: 'success',
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
};

// Generate unique ID
let toastId = 0;
const generateId = () => ++toastId;

/**
 * Custom hook for managing toast notifications
 * @returns {Object} Toast management functions and state
 */
export function useToast() {
  const [toasts, setToasts] = useState([]);

  // Track timeout IDs for cleanup on unmount
  const timeoutsRef = useRef(new Map());
  const mountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Clear all pending timeouts to prevent memory leaks
      timeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
      timeoutsRef.current.clear();
    };
  }, []);

  /**
   * Remove a toast by ID
   * @param {number} id - The toast ID to remove
   */
  const removeToast = useCallback((id) => {
    // Clear the timeout if it exists
    if (timeoutsRef.current.has(id)) {
      clearTimeout(timeoutsRef.current.get(id));
      timeoutsRef.current.delete(id);
    }
    if (mountedRef.current) {
      setToasts(prev => prev.filter(toast => toast.id !== id));
    }
  }, []);

  /**
   * Add a new toast notification
   * @param {string} message - The toast message
   * @param {string} type - Toast type (success, error, warning, info)
   * @param {number} duration - Auto-dismiss duration in ms (default 3000, 0 = no auto-dismiss)
   * @param {Object} options - Additional options
   * @param {Function} options.onClick - Click handler for the toast
   * @param {string} options.actionLabel - Label for action button
   * @param {Function} options.onAction - Handler for action button click
   * @returns {number} The toast ID
   */
  const addToast = useCallback((message, type = TOAST_TYPES.INFO, duration = 3000, options = {}) => {
    const id = generateId();
    const toast = {
      id,
      message,
      type,
      duration,
      createdAt: Date.now(),
      onClick: options.onClick,
      actionLabel: options.actionLabel,
      onAction: options.onAction,
    };

    setToasts(prev => [...prev, toast]);

    // Auto-dismiss after duration (if duration > 0)
    if (duration > 0) {
      const timeoutId = setTimeout(() => {
        timeoutsRef.current.delete(id);
        removeToast(id);
      }, duration);
      timeoutsRef.current.set(id, timeoutId);
    }

    return id;
  }, [removeToast]);

  /**
   * Remove all toasts
   */
  const clearToasts = useCallback(() => {
    setToasts([]);
  }, []);

  // Convenience methods for different toast types
  const success = useCallback((message, duration) => addToast(message, TOAST_TYPES.SUCCESS, duration), [addToast]);
  const error = useCallback((message, duration) => addToast(message, TOAST_TYPES.ERROR, duration), [addToast]);
  const warning = useCallback((message, duration) => addToast(message, TOAST_TYPES.WARNING, duration), [addToast]);
  const info = useCallback((message, duration) => addToast(message, TOAST_TYPES.INFO, duration), [addToast]);

  return {
    toasts,
    addToast,
    removeToast,
    clearToasts,
    success,
    error,
    warning,
    info,
  };
}

// Context for global toast access
export const ToastContext = createContext(null);

/**
 * Hook to access toast context from anywhere in the app
 * @returns {Object} Toast context value
 */
export function useToastContext() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToastContext must be used within a ToastProvider');
  }
  return context;
}

export default useToast;
