/**
 * useCannonballGPS - Hook for managing GPS state in Cannonball mode
 *
 * Wraps useDeviceGPS with Cannonball-specific permission handling and state
 */
import { useState, useEffect, useCallback } from 'react';
import { useDeviceGPS, GPS_PERMISSION_STATES } from './useDeviceGPS';

/**
 * useCannonballGPS hook
 */
export function useCannonballGPS() {
  const [showGPSModal, setShowGPSModal] = useState(false);
  const [gpsDisabledByUser, setGpsDisabledByUser] = useState(false);

  // GPS Hook
  const {
    position,
    heading,
    accuracy,
    speed: userSpeed,
    isTracking,
    error: gpsError,
    permissionState,
    requestPermission,
    startTracking,
  } = useDeviceGPS({
    enabled: !gpsDisabledByUser,
    interval: 3000,
    highAccuracy: true,
    autoRequest: false,
  });

  // Show GPS permission modal when needed
  useEffect(() => {
    if (permissionState === GPS_PERMISSION_STATES.PROMPT ||
        permissionState === GPS_PERMISSION_STATES.DENIED ||
        permissionState === GPS_PERMISSION_STATES.UNAVAILABLE) {
      if (!gpsDisabledByUser) {
        setShowGPSModal(true);
      }
    } else if (permissionState === GPS_PERMISSION_STATES.GRANTED) {
      setShowGPSModal(false);
    }
  }, [permissionState, gpsDisabledByUser]);

  // GPS Permission handlers
  const handleRequestGPSPermission = useCallback(async () => {
    await requestPermission();
    if (permissionState === GPS_PERMISSION_STATES.GRANTED) {
      startTracking();
    }
  }, [requestPermission, startTracking, permissionState]);

  const handleRetryGPS = useCallback(async () => {
    setGpsDisabledByUser(false);
    await requestPermission();
  }, [requestPermission]);

  const handleContinueWithoutGPS = useCallback(() => {
    setGpsDisabledByUser(true);
    setShowGPSModal(false);
  }, []);

  const handleEnableGPS = useCallback(() => {
    setGpsDisabledByUser(false);
    setShowGPSModal(true);
  }, []);

  const closeGPSModal = useCallback(() => {
    setShowGPSModal(false);
  }, []);

  return {
    // GPS data
    position,
    heading,
    accuracy,
    userSpeed,
    isTracking,
    gpsError,
    permissionState,

    // GPS modal state
    showGPSModal,
    gpsDisabledByUser,

    // GPS modal handlers
    handleRequestGPSPermission,
    handleRetryGPS,
    handleContinueWithoutGPS,
    handleEnableGPS,
    closeGPSModal,

    // Computed
    gpsActive: isTracking && !!position,
  };
}

export { GPS_PERMISSION_STATES };
export default useCannonballGPS;
