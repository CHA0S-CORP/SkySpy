/**
 * Safe fetch utility that handles non-JSON responses gracefully.
 * Prevents "Unexpected token '<'" errors when API returns HTML error pages.
 */

// Default network timeout in milliseconds
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Safely fetch JSON from an API endpoint.
 * @param {string} url - The URL to fetch
 * @param {RequestInit & {timeout?: number}} options - Fetch options with optional timeout
 * @returns {Promise<{data: any, error: string|null, ok: boolean, status: number}>}
 */
export async function safeFetchJson(url, options = {}) {
  const { timeout = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;

  // Create AbortController for timeout handling
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // Merge any existing signal with our abort controller
  // If options already has a signal, we need to respect both
  if (fetchOptions.signal) {
    const originalSignal = fetchOptions.signal;
    originalSignal.addEventListener('abort', () => controller.abort());
  }

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        data: null,
        error: `HTTP ${response.status}`,
        ok: false,
        status: response.status,
      };
    }

    // Check content type before parsing
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return {
        data: null,
        error: 'Invalid response format (not JSON)',
        ok: false,
        status: response.status,
      };
    }

    const data = await response.json();
    return {
      data,
      error: null,
      ok: true,
      status: response.status,
    };
  } catch (err) {
    clearTimeout(timeoutId);

    // Handle abort errors (from timeout or manual abort)
    if (err.name === 'AbortError') {
      return {
        data: null,
        error: 'Request timeout',
        ok: false,
        status: 0,
        aborted: true,
      };
    }

    return {
      data: null,
      error: err.message || 'Network error',
      ok: false,
      status: 0,
    };
  }
}

/**
 * Safely parse JSON from a fetch response.
 * Use this when you already have the response object.
 * @param {Response} response - Fetch response object
 * @returns {Promise<{data: any, error: string|null}>}
 */
export async function safeParseJson(response) {
  try {
    if (!response.ok) {
      return { data: null, error: `HTTP ${response.status}` };
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return { data: null, error: 'Invalid response format' };
    }

    const data = await response.json();
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export default safeFetchJson;
