/**
 * useDeviceGPS - Hook for tracking device GPS position
 *
 * Provides real-time GPS position tracking for mobile devices
 * with support for heading and accuracy information.
 * Includes permission state machine for proper UX flow.
 */
import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Permission states for GPS access
 * - unknown: Initial state, haven't checked yet
 * - checking: Currently checking permission status
 * - prompt: Permission will be requested (user hasn't decided)
 * - requesting: Actively requesting permission
 * - granted: Permission granted
 * - denied: Permission denied
 * - unavailable: Geolocation not supported
 */
export const GPS_PERMISSION_STATES = {
  UNKNOWN: 'unknown',
  CHECKING: 'checking',
  PROMPT: 'prompt',
  REQUESTING: 'requesting',
  GRANTED: 'granted',
  DENIED: 'denied',
  UNAVAILABLE: 'unavailable',
};

/**
 * GPS position tracking hook
 *
 * @param {Object} options Configuration options
 * @param {boolean} options.enabled Whether GPS tracking is enabled
 * @param {number} options.interval Update interval in milliseconds (for maximumAge)
 * @param {boolean} options.highAccuracy Request high accuracy positioning
 * @param {boolean} options.autoRequest Automatically request permission when enabled
 * @returns {Object} GPS state and controls
 */
export function useDeviceGPS({
  enabled = false,
  interval = 5000,
  highAccuracy = true,
  autoRequest = false,
} = {}) {
  const [position, setPosition] = useState(null);
  const [heading, setHeading] = useState(null);
  const [accuracy, setAccuracy] = useState(null);
  const [speed, setSpeed] = useState(null);
  const [error, setError] = useState(null);
  const [isTracking, setIsTracking] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [permissionState, setPermissionState] = useState(GPS_PERMISSION_STATES.UNKNOWN);

  const watchIdRef = useRef(null);
  const orientationRef = useRef(null);
  const permissionCheckedRef = useRef(false);

  // Check if geolocation is supported
  const isSupported = typeof navigator !== 'undefined' && 'geolocation' in navigator;

  // Check current permission status without triggering request
  const checkPermission = useCallback(async () => {
    if (!isSupported) {
      setPermissionState(GPS_PERMISSION_STATES.UNAVAILABLE);
      return GPS_PERMISSION_STATES.UNAVAILABLE;
    }

    setPermissionState(GPS_PERMISSION_STATES.CHECKING);

    // Use Permissions API if available
    if ('permissions' in navigator) {
      try {
        const result = await navigator.permissions.query({ name: 'geolocation' });
        const state = result.state === 'granted' ? GPS_PERMISSION_STATES.GRANTED
          : result.state === 'denied' ? GPS_PERMISSION_STATES.DENIED
          : GPS_PERMISSION_STATES.PROMPT;
        setPermissionState(state);

        // Listen for permission changes
        result.onchange = () => {
          const newState = result.state === 'granted' ? GPS_PERMISSION_STATES.GRANTED
            : result.state === 'denied' ? GPS_PERMISSION_STATES.DENIED
            : GPS_PERMISSION_STATES.PROMPT;
          setPermissionState(newState);
        };

        return state;
      } catch (err) {
        // Permissions API not supported for geolocation, assume prompt
        setPermissionState(GPS_PERMISSION_STATES.PROMPT);
        return GPS_PERMISSION_STATES.PROMPT;
      }
    }

    // Fallback: assume prompt state
    setPermissionState(GPS_PERMISSION_STATES.PROMPT);
    return GPS_PERMISSION_STATES.PROMPT;
  }, [isSupported]);

  // Check permission on mount
  useEffect(() => {
    if (!permissionCheckedRef.current) {
      permissionCheckedRef.current = true;
      checkPermission();
    }
  }, [checkPermission]);

  // Handle position update
  const handlePositionUpdate = useCallback((pos) => {
    setPosition({
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
    });
    setAccuracy(pos.coords.accuracy);
    setSpeed(pos.coords.speed);
    setLastUpdate(new Date());
    setError(null);

    // Use GPS heading if available, otherwise use device orientation
    if (pos.coords.heading !== null && !isNaN(pos.coords.heading)) {
      setHeading(pos.coords.heading);
    }
  }, []);

  // Handle position error
  const handlePositionError = useCallback((err) => {
    let message;
    switch (err.code) {
      case err.PERMISSION_DENIED:
        message = 'Location permission denied';
        break;
      case err.POSITION_UNAVAILABLE:
        message = 'Location unavailable';
        break;
      case err.TIMEOUT:
        message = 'Location request timed out';
        break;
      default:
        message = err.message || 'Unknown error';
    }
    setError(message);
    console.warn('GPS error:', message);
  }, []);

  // Handle device orientation for heading (fallback for devices without GPS heading)
  const handleOrientation = useCallback((event) => {
    // Use webkitCompassHeading for iOS, or calculate from alpha for Android
    let compassHeading;

    if (event.webkitCompassHeading !== undefined) {
      // iOS provides compass heading directly
      compassHeading = event.webkitCompassHeading;
    } else if (event.alpha !== null) {
      // Android: alpha is the compass direction
      // Need to adjust for device orientation
      compassHeading = 360 - event.alpha;
    }

    if (compassHeading !== undefined && !isNaN(compassHeading)) {
      // Only update heading from orientation if GPS didn't provide it
      setHeading(prev => prev === null ? compassHeading : prev);
    }
  }, []);

  // Request permission explicitly (for use with permission UI)
  const requestPermission = useCallback(async () => {
    if (!isSupported) {
      setPermissionState(GPS_PERMISSION_STATES.UNAVAILABLE);
      setError('Geolocation not supported');
      return false;
    }

    setPermissionState(GPS_PERMISSION_STATES.REQUESTING);
    setError(null);

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setPermissionState(GPS_PERMISSION_STATES.GRANTED);
          handlePositionUpdate(pos);
          resolve(true);
        },
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            setPermissionState(GPS_PERMISSION_STATES.DENIED);
            setError('Location permission denied');
          } else {
            setPermissionState(GPS_PERMISSION_STATES.GRANTED); // Permission granted but location error
            handlePositionError(err);
          }
          resolve(false);
        },
        {
          enableHighAccuracy: highAccuracy,
          timeout: 30000,
          maximumAge: 0,
        }
      );
    });
  }, [isSupported, highAccuracy, handlePositionUpdate, handlePositionError]);

  // Start tracking
  const startTracking = useCallback(async () => {
    if (!isSupported) {
      setError('Geolocation not supported');
      setPermissionState(GPS_PERMISSION_STATES.UNAVAILABLE);
      return;
    }

    // If permission is denied, don't try to track
    if (permissionState === GPS_PERMISSION_STATES.DENIED) {
      setError('Location permission denied');
      return;
    }

    // If permission state is unknown or prompt, request it first
    if (permissionState === GPS_PERMISSION_STATES.PROMPT ||
        permissionState === GPS_PERMISSION_STATES.UNKNOWN) {
      const granted = await requestPermission();
      if (!granted) return;
    }

    setIsTracking(true);
    setError(null);

    // Start watching position
    watchIdRef.current = navigator.geolocation.watchPosition(
      handlePositionUpdate,
      handlePositionError,
      {
        enableHighAccuracy: highAccuracy,
        maximumAge: interval,
        timeout: 30000,
      }
    );

    // Request device orientation for heading
    if (typeof DeviceOrientationEvent !== 'undefined') {
      // Check if we need to request permission (iOS 13+)
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
          .then((orientationPermState) => {
            if (orientationPermState === 'granted') {
              window.addEventListener('deviceorientationabsolute', handleOrientation, true);
              window.addEventListener('deviceorientation', handleOrientation, true);
              orientationRef.current = true;
            }
          })
          .catch(console.error);
      } else {
        window.addEventListener('deviceorientationabsolute', handleOrientation, true);
        window.addEventListener('deviceorientation', handleOrientation, true);
        orientationRef.current = true;
      }
    }
  }, [isSupported, highAccuracy, interval, permissionState, requestPermission, handlePositionUpdate, handlePositionError, handleOrientation]);

  // Stop tracking
  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    if (orientationRef.current) {
      window.removeEventListener('deviceorientationabsolute', handleOrientation, true);
      window.removeEventListener('deviceorientation', handleOrientation, true);
      orientationRef.current = false;
    }

    setIsTracking(false);
  }, [handleOrientation]);

  // Request single position update
  const getCurrentPosition = useCallback(() => {
    if (!isSupported) {
      setError('Geolocation not supported');
      return Promise.reject(new Error('Geolocation not supported'));
    }

    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          handlePositionUpdate(pos);
          resolve({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
          });
        },
        (err) => {
          handlePositionError(err);
          reject(err);
        },
        {
          enableHighAccuracy: highAccuracy,
          timeout: 30000,
          maximumAge: 0,
        }
      );
    });
  }, [isSupported, highAccuracy, handlePositionUpdate, handlePositionError]);

  // Auto-start/stop based on enabled prop
  useEffect(() => {
    // Only auto-start if autoRequest is true or permission is already granted
    const shouldAutoStart = enabled &&
      !isTracking &&
      (autoRequest || permissionState === GPS_PERMISSION_STATES.GRANTED);

    if (shouldAutoStart) {
      startTracking();
    } else if (!enabled && isTracking) {
      stopTracking();
    }

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (orientationRef.current) {
        window.removeEventListener('deviceorientationabsolute', handleOrientation, true);
        window.removeEventListener('deviceorientation', handleOrientation, true);
      }
    };
  }, [enabled, isTracking, autoRequest, permissionState, startTracking, stopTracking, handleOrientation]);

  // Retry tracking after permission change
  useEffect(() => {
    if (enabled && !isTracking && permissionState === GPS_PERMISSION_STATES.GRANTED) {
      startTracking();
    }
  }, [enabled, isTracking, permissionState, startTracking]);

  return {
    // Position data
    position,
    heading,
    accuracy,
    speed,

    // Status
    isSupported,
    isTracking,
    error,
    lastUpdate,

    // Permission
    permissionState,
    checkPermission,
    requestPermission,

    // Controls
    startTracking,
    stopTracking,
    getCurrentPosition,
  };
}

export default useDeviceGPS;
