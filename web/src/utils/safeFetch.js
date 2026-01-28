/**
 * Safe fetch utility that handles non-JSON responses gracefully.
 * Prevents "Unexpected token '<'" errors when API returns HTML error pages.
 */

/**
 * Safely fetch JSON from an API endpoint.
 * @param {string} url - The URL to fetch
 * @param {RequestInit} options - Fetch options
 * @returns {Promise<{data: any, error: string|null, ok: boolean}>}
 */
export async function safeFetchJson(url, options = {}) {
  try {
    const response = await fetch(url, options);

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
