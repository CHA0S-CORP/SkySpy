/**
 * Retry queue management for failed aircraft lookups
 */

/**
 * Create a retry queue manager
 */
export function createRetryQueue(maxRetries = 3) {
  const queue = new Map(); // icao -> { retryCount, nextRetryAt }
  let timeoutRef = null;
  let processCallback = null;

  /**
   * Calculate delay for retry attempt (exponential backoff)
   */
  function getRetryDelay(retryCount) {
    return Math.min(1000 * Math.pow(2, retryCount), 30000); // Max 30s
  }

  /**
   * Schedule queue processing
   */
  function scheduleProcessing() {
    if (timeoutRef) return; // Already scheduled

    timeoutRef = setTimeout(() => {
      timeoutRef = null;
      if (processCallback) {
        processCallback();
      }
    }, 1000);
  }

  return {
    /**
     * Set the process callback
     */
    setProcessCallback(callback) {
      processCallback = callback;
    },

    /**
     * Add an item to retry queue
     * Returns true if added, false if max retries exceeded
     */
    addToRetry(icao) {
      icao = icao?.toUpperCase();
      if (!icao) return false;

      const current = queue.get(icao) || { retryCount: 0 };

      if (current.retryCount >= maxRetries) {
        queue.delete(icao);
        return false; // Max retries exceeded
      }

      const delay = getRetryDelay(current.retryCount);
      queue.set(icao, {
        retryCount: current.retryCount + 1,
        nextRetryAt: Date.now() + delay
      });

      scheduleProcessing();
      return true;
    },

    /**
     * Remove from retry queue (on success)
     */
    remove(icao) {
      queue.delete(icao?.toUpperCase());
    },

    /**
     * Get items ready for retry
     */
    getReadyForRetry() {
      const now = Date.now();
      const ready = [];

      for (const [icao, info] of queue.entries()) {
        if (info.nextRetryAt <= now) {
          ready.push(icao);
        }
      }

      return ready;
    },

    /**
     * Get queue size
     */
    size() {
      return queue.size;
    },

    /**
     * Clear the queue
     */
    clear() {
      queue.clear();
      if (timeoutRef) {
        clearTimeout(timeoutRef);
        timeoutRef = null;
      }
    },

    /**
     * Cleanup (clear timeout)
     */
    cleanup() {
      if (timeoutRef) {
        clearTimeout(timeoutRef);
        timeoutRef = null;
      }
    },
  };
}
