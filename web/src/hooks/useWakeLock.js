/**
 * useWakeLock - Hook for managing screen wake lock
 *
 * Prevents the screen from sleeping while the app is active.
 * Automatically handles reacquiring the lock when the page
 * becomes visible again.
 */
import { useEffect, useRef, useCallback } from 'react';

/**
 * Request wake lock from the browser
 */
async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      return await navigator.wakeLock.request('screen');
    } catch (err) {
      console.warn('Wake lock failed:', err);
    }
  }
  return null;
}

/**
 * useWakeLock hook
 *
 * @param {boolean} enabled - Whether wake lock should be active
 * @returns {Object} - { isLocked: boolean, request: function, release: function }
 */
export function useWakeLock(enabled = true) {
  const wakeLockRef = useRef(null);

  // Request wake lock
  const request = useCallback(async () => {
    if (!enabled) return;
    if (wakeLockRef.current) return; // Already have a lock

    wakeLockRef.current = await requestWakeLock();
  }, [enabled]);

  // Release wake lock
  const release = useCallback(() => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
  }, []);

  // Request wake lock on mount, release on unmount
  useEffect(() => {
    if (enabled) {
      request();
    }

    return () => {
      release();
    };
  }, [enabled, request, release]);

  // Re-acquire wake lock when page becomes visible
  useEffect(() => {
    if (!enabled) return;

    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && !wakeLockRef.current) {
        wakeLockRef.current = await requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled]);

  return {
    isLocked: !!wakeLockRef.current,
    request,
    release,
  };
}

export default useWakeLock;
