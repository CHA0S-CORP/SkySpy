/**
 * Request tracking utilities for WebSocket request/response pattern
 */

/**
 * Creates a request tracker for managing pending WebSocket requests
 */
export function createRequestTracker() {
  let requestCounter = 0;
  const pendingRequests = new Map();

  /**
   * Generate a unique request ID
   */
  function generateRequestId() {
    return `req_${++requestCounter}_${Date.now()}`;
  }

  /**
   * Create a tracked request that can be resolved/rejected later
   * @param {number} timeout - Timeout in milliseconds
   * @returns {{ requestId: string, promise: Promise<any> }}
   */
  function createRequest(timeout = 30000) {
    const requestId = generateRequestId();

    const promise = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, timeout);

      pendingRequests.set(requestId, { resolve, reject, timeoutId });
    });

    return { requestId, promise };
  }

  /**
   * Resolve a pending request
   * @param {string} requestId - The request ID
   * @param {any} data - The response data
   * @returns {boolean} Whether the request was found and resolved
   */
  function resolveRequest(requestId, data) {
    const pending = pendingRequests.get(requestId);
    if (!pending) return false;

    clearTimeout(pending.timeoutId);
    pendingRequests.delete(requestId);
    pending.resolve(data);
    return true;
  }

  /**
   * Reject a pending request
   * @param {string} requestId - The request ID
   * @param {Error} error - The error
   * @returns {boolean} Whether the request was found and rejected
   */
  function rejectRequest(requestId, error) {
    const pending = pendingRequests.get(requestId);
    if (!pending) return false;

    clearTimeout(pending.timeoutId);
    pendingRequests.delete(requestId);
    pending.reject(error);
    return true;
  }

  /**
   * Clear all pending requests (e.g., on disconnect)
   * @param {Error} error - The error to reject with
   */
  function clearAll(error = new Error('Connection closed')) {
    for (const [requestId, pending] of pendingRequests) {
      clearTimeout(pending.timeoutId);
      pending.reject(error);
    }
    pendingRequests.clear();
  }

  /**
   * Get number of pending requests
   */
  function getPendingCount() {
    return pendingRequests.size;
  }

  return {
    createRequest,
    resolveRequest,
    rejectRequest,
    clearAll,
    getPendingCount,
  };
}
