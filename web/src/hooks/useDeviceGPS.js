/**
 * useDeviceGPS - Hook for tracking device GPS position
 *
 * Provides real-time GPS position tracking for mobile devices
 * with support for heading and accuracy information.
 */
import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * GPS position tracking hook
 *
 * @param {Object} options Configuration options
 * @param {boolean} options.enabled Whether GPS tracking is enabled
 * @param {number} options.interval Update interval in milliseconds (for maximumAge)
 * @param {boolean} options.highAccuracy Request high accuracy positioning
 * @returns {Object} GPS state and controls
 */
export function useDeviceGPS({
  enabled = false,
  interval = 5000,
  highAccuracy = true,
} = {}) {
  const [position, setPosition] = useState(null);
  const [heading, setHeading] = useState(null);
  const [accuracy, setAccuracy] = useState(null);
  const [speed, setSpeed] = useState(null);
  const [error, setError] = useState(null);
  const [isTracking, setIsTracking] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  const watchIdRef = useRef(null);
  const orientationRef = useRef(null);

  // Check if geolocation is supported
  const isSupported = typeof navigator !== 'undefined' && 'geolocation' in navigator;

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

  // Start tracking
  const startTracking = useCallback(() => {
    if (!isSupported) {
      setError('Geolocation not supported');
      return;
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
          .then((permissionState) => {
            if (permissionState === 'granted') {
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
  }, [isSupported, highAccuracy, interval, handlePositionUpdate, handlePositionError, handleOrientation]);

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
    if (enabled && !isTracking) {
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
  }, [enabled, isTracking, startTracking, stopTracking, handleOrientation]);

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

    // Controls
    startTracking,
    stopTracking,
    getCurrentPosition,
  };
}

export default useDeviceGPS;
