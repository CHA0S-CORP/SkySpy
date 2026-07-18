import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Parse Django REST Framework error responses.
 * DRF returns errors in various formats:
 * - { "detail": "Error message" }
 * - { "field_name": ["Error 1", "Error 2"] }
 * - { "non_field_errors": ["Error message"] }
 * - Plain string for some errors
 */
const parseDRFError = (data) => {
  if (!data) return 'Unknown error';
  if (typeof data === 'string') return data;

  // Handle standard DRF error format
  if (data.detail) {
    return typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
  }

  // Handle field errors
  if (data.non_field_errors) {
    return Array.isArray(data.non_field_errors)
      ? data.non_field_errors.join(', ')
      : data.non_field_errors;
  }

  // Handle validation errors (field: [errors])
  const fieldErrors = [];
  for (const [field, errors] of Object.entries(data)) {
    if (Array.isArray(errors)) {
      fieldErrors.push(`${field}: ${errors.join(', ')}`);
    } else if (typeof errors === 'string') {
      fieldErrors.push(`${field}: ${errors}`);
    }
  }
  if (fieldErrors.length > 0) {
    return fieldErrors.join('; ');
  }

  return JSON.stringify(data);
};

/**
 * Helper to safely parse JSON from fetch response.
 * Handles Django REST Framework response formats.
 */
const safeJson = async (res) => {
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) {
    return { ok: res.ok, data: null, status: res.status };
  }

  try {
    const data = await res.json();
    return { ok: res.ok, data, status: res.status };
  } catch {
    return { ok: res.ok, data: null, status: res.status };
  }
};

/**
 * Basic HTTP polling hook for Django REST Framework APIs.
 *
 * @param {string} endpoint - The API endpoint (e.g., '/api/v1/aircraft')
 * @param {number|null} interval - Polling interval in ms (null = no polling)
 * @param {string} apiBase - API base URL (defaults to relative)
 * @returns {Object} { data, loading, error, refetch }
 */
export function useApi(endpoint, interval = null, apiBase = '') {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Monotonic request id: only the most recently started request may commit
  // its result. This lets the effect fetch and a manual refetch share one
  // ordering, so a refetch response can't overwrite state after the endpoint
  // changed (and vice versa). A single shared abort ref cancels whatever
  // request is currently in flight when a newer one starts.
  const requestIdRef = useRef(0);
  const inFlightAbortRef = useRef(null);

  const startRequest = useCallback(() => {
    // Cancel any request still in flight (effect or prior refetch)
    if (inFlightAbortRef.current) inFlightAbortRef.current.abort();
    const abortController = new AbortController();
    inFlightAbortRef.current = abortController;
    return { signal: abortController.signal, requestId: ++requestIdRef.current };
  }, []);

  const fetchData = useCallback(
    async (signal, requestId) => {
      try {
        const baseUrl = apiBase || '';
        const res = await fetch(`${baseUrl}${endpoint}`, { signal });
        const { ok, data: json, status } = await safeJson(res);

        if (!ok) {
          // Parse Django REST Framework error response
          const errorMessage = json ? parseDRFError(json) : `HTTP ${status}`;
          throw new Error(errorMessage);
        }

        if (json === null) {
          throw new Error('Invalid response format');
        }

        // Drop stale responses: a newer request has since started
        if (requestId !== requestIdRef.current) return;
        setData(json);
        setError(null);
      } catch (err) {
        if (err.name === 'AbortError') return;
        if (requestId !== requestIdRef.current) return;
        setError(err.message);
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [endpoint, apiBase]
  );

  useEffect(() => {
    const { signal, requestId } = startRequest();
    fetchData(signal, requestId);

    let intervalId;
    if (interval) {
      intervalId = setInterval(() => {
        const next = startRequest();
        fetchData(next.signal, next.requestId);
      }, interval);
    }

    return () => {
      // Abort the in-flight request and clear interval on cleanup
      if (inFlightAbortRef.current) inFlightAbortRef.current.abort();
      if (intervalId) clearInterval(intervalId);
    };
  }, [fetchData, interval, startRequest]);

  const refetch = useCallback(() => {
    // Supersede any in-flight request (effect or prior refetch)
    const { signal, requestId } = startRequest();
    setLoading(true);
    fetchData(signal, requestId);
  }, [fetchData, startRequest]);

  return { data, loading, error, refetch };
}

// Export error parser for use in other hooks
export { parseDRFError };
