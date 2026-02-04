import { useState, useCallback } from 'react';

/**
 * @typedef {Object} AircraftInfoError
 * @property {string} error_type - Type of error
 * @property {string} error_message - Error message
 * @property {string} source - Source of the error
 * @property {Object} [details] - Additional error details
 * @property {string} timestamp - ISO timestamp
 */

/**
 * @typedef {Object} UseAircraftInfoErrorsOptions
 * @property {Function} [getAirframeError] - External function to get errors (from WebSocket)
 * @property {Function} [clearAirframeError] - External function to clear errors
 */

/**
 * @typedef {Object} UseAircraftInfoErrorsReturn
 * @property {Object} errors - Current errors by ICAO
 * @property {function(string): AircraftInfoError|null} getError - Get error for an ICAO
 * @property {function(string, Object): void} recordError - Record an error for an ICAO
 * @property {function(string): void} clearError - Clear error for an ICAO
 * @property {function(): void} clearAllErrors - Clear all errors
 * @property {number} errorCount - Number of current errors
 */

/**
 * Hook for managing aircraft info error state
 *
 * @param {UseAircraftInfoErrorsOptions} options
 * @returns {UseAircraftInfoErrorsReturn}
 */
export function useAircraftInfoErrors({ getAirframeError, clearAirframeError } = {}) {
  // Errors: { [icao]: { error_type, error_message, source, timestamp } }
  const [errors, setErrors] = useState({});

  /**
   * Get error for an aircraft (from local state or external source)
   */
  const getError = useCallback(
    (icao) => {
      icao = icao?.toUpperCase();
      if (!icao) return null;

      // Check local errors state first
      if (errors[icao]) {
        return errors[icao];
      }

      // Check external errors if available
      if (getAirframeError) {
        return getAirframeError(icao);
      }

      return null;
    },
    [errors, getAirframeError]
  );

  /**
   * Record an error for an aircraft
   */
  const recordError = useCallback((icao, errorInfo) => {
    icao = icao?.toUpperCase();
    if (!icao) return;

    setErrors((prev) => ({
      ...prev,
      [icao]: {
        ...errorInfo,
        timestamp: errorInfo.timestamp || new Date().toISOString(),
      },
    }));
  }, []);

  /**
   * Clear error for an aircraft
   */
  const clearError = useCallback(
    (icao) => {
      icao = icao?.toUpperCase();
      if (!icao) return;

      // Clear from local state
      setErrors((prev) => {
        if (!prev[icao]) return prev;
        const next = { ...prev };
        delete next[icao];
        return next;
      });

      // Clear from external source if available
      if (clearAirframeError) {
        clearAirframeError(icao);
      }
    },
    [clearAirframeError]
  );

  /**
   * Clear all errors
   */
  const clearAllErrors = useCallback(() => {
    setErrors({});
  }, []);

  return {
    errors,
    getError,
    recordError,
    clearError,
    clearAllErrors,
    errorCount: Object.keys(errors).length,
  };
}

export default useAircraftInfoErrors;
