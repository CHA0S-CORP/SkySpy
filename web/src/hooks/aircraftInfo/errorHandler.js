/**
 * Error handling utilities for aircraft info
 */

/**
 * Create an error info object
 */
export function createErrorInfo(errorType, errorMessage, source, details = null) {
  return {
    error_type: errorType,
    error_message: errorMessage,
    source,
    details,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create error manager for tracking aircraft lookup errors
 */
export function createErrorManager(initialErrors = {}) {
  let errors = { ...initialErrors };
  const listeners = new Set();

  function notifyListeners() {
    listeners.forEach(cb => cb({ ...errors }));
  }

  return {
    /**
     * Get error for an aircraft
     */
    getError(icao) {
      return errors[icao?.toUpperCase()] || null;
    },

    /**
     * Record an error for an aircraft
     */
    recordError(icao, errorInfo) {
      icao = icao?.toUpperCase();
      if (!icao) return;

      errors = {
        ...errors,
        [icao]: {
          ...errorInfo,
          timestamp: errorInfo.timestamp || new Date().toISOString(),
        }
      };
      notifyListeners();
    },

    /**
     * Clear error for an aircraft
     */
    clearError(icao) {
      icao = icao?.toUpperCase();
      if (!icao || !errors[icao]) return;

      const next = { ...errors };
      delete next[icao];
      errors = next;
      notifyListeners();
    },

    /**
     * Get all errors
     */
    getAllErrors() {
      return { ...errors };
    },

    /**
     * Get error count
     */
    getErrorCount() {
      return Object.keys(errors).length;
    },

    /**
     * Subscribe to error changes
     */
    subscribe(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
}
