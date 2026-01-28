/**
 * GPSPermissionModal - GPS permission request and recovery UI
 *
 * Shows:
 * - Pre-request modal explaining why GPS is needed
 * - Recovery instructions when permission denied
 * - Retry and "Continue Without GPS" options
 */
import React, { memo } from 'react';
import {
  MapPin, MapPinOff, Navigation, Shield, AlertTriangle,
  RefreshCw, X, Smartphone, Settings, ExternalLink
} from 'lucide-react';
import { GPS_PERMISSION_STATES } from '../../hooks/useDeviceGPS';

/**
 * Get platform-specific instructions for enabling GPS
 */
function getRecoveryInstructions() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);

  if (isIOS) {
    return {
      platform: 'iOS',
      steps: [
        'Open the Settings app',
        'Scroll down and tap Safari (or your browser)',
        'Tap "Location"',
        'Select "Allow" or "Ask"',
        'Return here and tap "Retry"'
      ],
      note: 'You may also need to enable Location Services in Settings > Privacy > Location Services'
    };
  }

  if (isAndroid) {
    return {
      platform: 'Android',
      steps: [
        'Tap the lock icon in the address bar',
        'Tap "Permissions" or "Site settings"',
        'Find "Location" and set to "Allow"',
        'Return here and tap "Retry"'
      ],
      note: 'You can also go to Settings > Apps > [Your Browser] > Permissions > Location'
    };
  }

  return {
    platform: 'Desktop',
    steps: [
      'Click the lock/info icon in the address bar',
      'Find "Location" in site permissions',
      'Change to "Allow"',
      'Refresh the page'
    ],
    note: 'Location permissions vary by browser. Check your browser settings if needed.'
  };
}

/**
 * Pre-request modal - shown before requesting permission
 */
function PermissionRequestContent({ onRequestPermission, onContinueWithout }) {
  return (
    <div className="gps-modal-content">
      <div className="gps-modal-icon gps-modal-icon-request">
        <MapPin size={48} />
      </div>

      <h2 className="gps-modal-title">Enable Location</h2>

      <p className="gps-modal-description">
        Cannonball Mode uses your location to calculate distance and direction to aircraft.
      </p>

      <div className="gps-modal-features">
        <div className="gps-feature">
          <Navigation size={20} />
          <span>Real-time distance tracking</span>
        </div>
        <div className="gps-feature">
          <Shield size={20} />
          <span>Direction-based alerts</span>
        </div>
        <div className="gps-feature">
          <AlertTriangle size={20} />
          <span>Approach warnings</span>
        </div>
      </div>

      <div className="gps-modal-privacy">
        <span>Your location stays on your device and is never sent to any server.</span>
      </div>

      <div className="gps-modal-actions">
        <button
          className="gps-modal-btn gps-modal-btn-primary"
          onClick={onRequestPermission}
        >
          <MapPin size={20} />
          Enable Location
        </button>
        <button
          className="gps-modal-btn gps-modal-btn-secondary"
          onClick={onContinueWithout}
        >
          Continue Without GPS
        </button>
      </div>
    </div>
  );
}

/**
 * Denied modal - shown when permission is denied
 */
function PermissionDeniedContent({ onRetry, onContinueWithout }) {
  const instructions = getRecoveryInstructions();

  return (
    <div className="gps-modal-content">
      <div className="gps-modal-icon gps-modal-icon-denied">
        <MapPinOff size={48} />
      </div>

      <h2 className="gps-modal-title">Location Blocked</h2>

      <p className="gps-modal-description">
        Location access was denied. You can still use Cannonball Mode, but distance and direction features will be unavailable.
      </p>

      <div className="gps-modal-instructions">
        <h3>
          <Settings size={16} />
          To enable location ({instructions.platform}):
        </h3>
        <ol>
          {instructions.steps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
        {instructions.note && (
          <p className="gps-instructions-note">{instructions.note}</p>
        )}
      </div>

      <div className="gps-modal-actions">
        <button
          className="gps-modal-btn gps-modal-btn-primary"
          onClick={onRetry}
        >
          <RefreshCw size={20} />
          Retry
        </button>
        <button
          className="gps-modal-btn gps-modal-btn-secondary"
          onClick={onContinueWithout}
        >
          Continue Without GPS
        </button>
      </div>
    </div>
  );
}

/**
 * Requesting modal - shown while waiting for permission response
 */
function PermissionRequestingContent() {
  return (
    <div className="gps-modal-content">
      <div className="gps-modal-icon gps-modal-icon-requesting">
        <div className="gps-modal-spinner" />
      </div>

      <h2 className="gps-modal-title">Requesting Location Access</h2>

      <p className="gps-modal-description">
        Please respond to the browser permission prompt.
      </p>

      <div className="gps-modal-hint">
        <Smartphone size={16} />
        <span>Look for a popup asking to share your location</span>
      </div>
    </div>
  );
}

/**
 * Unavailable modal - shown when geolocation is not supported
 */
function PermissionUnavailableContent({ onContinueWithout }) {
  return (
    <div className="gps-modal-content">
      <div className="gps-modal-icon gps-modal-icon-unavailable">
        <MapPinOff size={48} />
      </div>

      <h2 className="gps-modal-title">Location Not Available</h2>

      <p className="gps-modal-description">
        Your browser or device doesn't support location services. Cannonball Mode will work without GPS, but distance and direction features will be unavailable.
      </p>

      <div className="gps-modal-actions">
        <button
          className="gps-modal-btn gps-modal-btn-primary"
          onClick={onContinueWithout}
        >
          Continue Without GPS
        </button>
      </div>
    </div>
  );
}

/**
 * Main GPS Permission Modal component
 */
export const GPSPermissionModal = memo(function GPSPermissionModal({
  permissionState,
  onRequestPermission,
  onRetry,
  onContinueWithout,
  onClose,
}) {
  // Don't show modal if permission is granted or checking
  if (permissionState === GPS_PERMISSION_STATES.GRANTED ||
      permissionState === GPS_PERMISSION_STATES.CHECKING ||
      permissionState === GPS_PERMISSION_STATES.UNKNOWN) {
    return null;
  }

  return (
    <div className="gps-modal-overlay" onClick={onClose}>
      <div className="gps-modal" onClick={(e) => e.stopPropagation()}>
        {permissionState === GPS_PERMISSION_STATES.REQUESTING && (
          <PermissionRequestingContent />
        )}

        {permissionState === GPS_PERMISSION_STATES.PROMPT && (
          <PermissionRequestContent
            onRequestPermission={onRequestPermission}
            onContinueWithout={onContinueWithout}
          />
        )}

        {permissionState === GPS_PERMISSION_STATES.DENIED && (
          <PermissionDeniedContent
            onRetry={onRetry}
            onContinueWithout={onContinueWithout}
          />
        )}

        {permissionState === GPS_PERMISSION_STATES.UNAVAILABLE && (
          <PermissionUnavailableContent
            onContinueWithout={onContinueWithout}
          />
        )}
      </div>
    </div>
  );
});

export default GPSPermissionModal;
