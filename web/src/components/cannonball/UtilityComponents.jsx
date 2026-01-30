/**
 * UtilityComponents - Small utility components for Cannonball mode
 *
 * Contains:
 * - GestureHint - Shows feedback for gesture actions
 * - GPSDisabledBanner - Banner when GPS is disabled
 * - VoiceListeningIndicator - Shows when voice control is listening
 */
import React, { memo } from 'react';
import { MapPinOff } from 'lucide-react';

/**
 * GestureHint component - shows feedback for gesture actions
 */
export const GestureHint = memo(function GestureHint({ message }) {
  if (!message) return null;
  return <div className="gesture-hint">{message}</div>;
});

/**
 * GPSDisabledBanner component - shown when user continues without GPS
 */
export const GPSDisabledBanner = memo(function GPSDisabledBanner({ onEnableGPS }) {
  return (
    <div className="gps-disabled-banner">
      <MapPinOff size={16} />
      <span>GPS disabled - distance/direction unavailable</span>
      <button onClick={onEnableGPS}>Enable</button>
    </div>
  );
});

/**
 * VoiceListeningIndicator component - shows when voice control is active
 */
export const VoiceListeningIndicator = memo(function VoiceListeningIndicator({
  active,
  listening,
}) {
  if (!active || !listening) return null;

  return (
    <div className="voice-listening-indicator">
      <div className="voice-waves">
        <div className="voice-wave" />
        <div className="voice-wave" />
        <div className="voice-wave" />
      </div>
      <span>Listening...</span>
    </div>
  );
});

/**
 * GPSErrorDisplay component - shows GPS error message
 */
export const GPSErrorDisplay = memo(function GPSErrorDisplay({ error }) {
  if (!error) return null;

  return (
    <div className="gps-error">
      <MapPinOff size={16} />
      <span>{error}</span>
    </div>
  );
});

// Display modes constant
export const DISPLAY_MODES = ['single', 'grid', 'radar', 'headsUp'];

// Speed threshold for simplified UI (in m/s, ~50 mph)
export const HIGH_SPEED_THRESHOLD = 22;

// Storage key for settings persistence
export const SETTINGS_STORAGE_KEY = 'cannonball_settings';

export default {
  GestureHint,
  GPSDisabledBanner,
  VoiceListeningIndicator,
  GPSErrorDisplay,
  DISPLAY_MODES,
  HIGH_SPEED_THRESHOLD,
  SETTINGS_STORAGE_KEY,
};
