/**
 * useWakeLock - Hook for managing screen wake lock
 *
 * Prevents the screen from sleeping while the app is active.
 * Automatically handles reacquiring the lock when the page
 * becomes visible again.
 */
import { useEffect, useRef, useCallback } from 'react';

/**
 * Return type for useWakeLock hook
 */
interface UseWakeLockReturn {
  /** Whether the wake lock is currently held */
  isLocked: boolean;
  /** Request a new wake lock */
  request: () => Promise<void>;
  /** Release the current wake lock */
  release: () => void;
}

/**
 * Wake Lock Sentinel interface
 * Note: This is available in modern browsers but not in TypeScript's lib.dom.d.ts
 */
interface WakeLockSentinel extends EventTarget {
  readonly released: boolean;
  readonly type: 'screen';
  release(): Promise<void>;
}

/**
 * Navigator with Wake Lock API
 */
interface NavigatorWithWakeLock extends Navigator {
  wakeLock?: {
    request(type: 'screen'): Promise<WakeLockSentinel>;
  };
}

/**
 * Request wake lock from the browser
 */
async function requestWakeLock(): Promise<WakeLockSentinel | null> {
  const nav = navigator as NavigatorWithWakeLock;
  if ('wakeLock' in nav && nav.wakeLock) {
    try {
      return await nav.wakeLock.request('screen');
    } catch (err) {
      console.warn('Wake lock failed:', err);
    }
  }
  return null;
}

/**
 * Hook to manage screen wake lock
 *
 * Prevents the device screen from sleeping while enabled. Useful for
 * dashboards, maps, or any application that should stay visible.
 *
 * @param enabled - Whether wake lock should be active (default: true)
 * @returns Object with isLocked status and request/release functions
 *
 * @example
 * ```tsx
 * function Dashboard() {
 *   const { isLocked, request, release } = useWakeLock(true);
 *
 *   return (
 *     <div>
 *       <p>Screen wake lock: {isLocked ? 'Active' : 'Inactive'}</p>
 *       <button onClick={request}>Request Lock</button>
 *       <button onClick={release}>Release Lock</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useWakeLock(enabled: boolean = true): UseWakeLockReturn {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  // Track visibility change listener for proper cleanup
  const visibilityListenerRef = useRef<(() => void) | null>(null);

  // Request wake lock
  const request = useCallback(async (): Promise<void> => {
    if (!enabled) return;
    if (wakeLockRef.current) return; // Already have a lock

    wakeLockRef.current = await requestWakeLock();
  }, [enabled]);

  // Release wake lock
  const release = useCallback((): void => {
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
    // Clean up any existing listener before adding a new one
    if (visibilityListenerRef.current) {
      document.removeEventListener('visibilitychange', visibilityListenerRef.current);
      visibilityListenerRef.current = null;
    }

    if (!enabled) return;

    const handleVisibilityChange = async (): Promise<void> => {
      if (document.visibilityState === 'visible' && !wakeLockRef.current) {
        wakeLockRef.current = await requestWakeLock();
      }
    };

    // Store reference to the listener for cleanup
    visibilityListenerRef.current = handleVisibilityChange;

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      visibilityListenerRef.current = null;
    };
  }, [enabled]);

  return {
    isLocked: !!wakeLockRef.current,
    request,
    release,
  };
}

export default useWakeLock;
