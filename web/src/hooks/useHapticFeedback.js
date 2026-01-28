/**
 * useHapticFeedback - Vibration patterns for threat alerts
 *
 * Provides haptic feedback for different threat levels:
 * - Critical: Continuous strong vibration
 * - Warning: Double pulse
 * - Info: Short buzz
 * - New threat: Attention pattern
 * - Clear: Success pattern
 */
import { useCallback, useRef, useEffect } from 'react';

// Vibration patterns (duration in ms, pause in ms, ...)
const PATTERNS = {
  // Single short buzz
  info: [100],

  // Double pulse
  warning: [150, 100, 150],

  // Triple urgent pulse
  critical: [200, 100, 200, 100, 200],

  // Long attention-grabbing pattern
  newThreat: [100, 50, 100, 50, 300],

  // Approaching - escalating
  approaching: [100, 100, 150, 100, 200],

  // Departing - descending
  departing: [200, 100, 100],

  // All clear - gentle confirmation
  clear: [50, 100, 50],

  // Error/GPS lost
  error: [300, 100, 300],

  // UI feedback - very short
  tap: [30],

  // Selection feedback
  select: [50, 50, 50],
};

// Check if vibration API is supported
const supportsVibration = () => {
  return 'vibrate' in navigator;
};

export function useHapticFeedback({ enabled = true, intensity = 'normal' }) {
  const lastVibrationRef = useRef(0);
  const minInterval = 300; // Minimum ms between vibrations to avoid spam

  // Scale pattern based on intensity
  const scalePattern = useCallback((pattern) => {
    if (intensity === 'strong') {
      return pattern.map(d => Math.round(d * 1.5));
    } else if (intensity === 'gentle') {
      return pattern.map(d => Math.round(d * 0.6));
    }
    return pattern;
  }, [intensity]);

  // Core vibrate function with throttling
  const vibrate = useCallback((pattern) => {
    if (!enabled || !supportsVibration()) return false;

    const now = Date.now();
    if (now - lastVibrationRef.current < minInterval) {
      return false;
    }
    lastVibrationRef.current = now;

    try {
      const scaledPattern = scalePattern(pattern);
      return navigator.vibrate(scaledPattern);
    } catch (err) {
      console.warn('Vibration failed:', err);
      return false;
    }
  }, [enabled, scalePattern]);

  // Stop vibration
  const stop = useCallback(() => {
    if (supportsVibration()) {
      navigator.vibrate(0);
    }
  }, []);

  // Threat level feedback
  const vibrateForThreatLevel = useCallback((level) => {
    const pattern = PATTERNS[level] || PATTERNS.info;
    return vibrate(pattern);
  }, [vibrate]);

  // New threat detected
  const vibrateNewThreat = useCallback((threatLevel = 'info') => {
    // Combine new threat pattern with threat level
    if (threatLevel === 'critical') {
      return vibrate([...PATTERNS.newThreat, 200, ...PATTERNS.critical]);
    }
    return vibrate(PATTERNS.newThreat);
  }, [vibrate]);

  // Threat approaching
  const vibrateApproaching = useCallback(() => {
    return vibrate(PATTERNS.approaching);
  }, [vibrate]);

  // Threat departing
  const vibrateDeparting = useCallback(() => {
    return vibrate(PATTERNS.departing);
  }, [vibrate]);

  // All clear
  const vibrateClear = useCallback(() => {
    return vibrate(PATTERNS.clear);
  }, [vibrate]);

  // Error (GPS lost, connection lost)
  const vibrateError = useCallback(() => {
    return vibrate(PATTERNS.error);
  }, [vibrate]);

  // UI tap feedback
  const vibrateTap = useCallback(() => {
    if (!enabled || !supportsVibration()) return false;
    // Tap doesn't use throttling
    try {
      return navigator.vibrate(PATTERNS.tap);
    } catch {
      return false;
    }
  }, [enabled]);

  // Selection feedback
  const vibrateSelect = useCallback(() => {
    return vibrate(PATTERNS.select);
  }, [vibrate]);

  // Continuous vibration for critical threats
  const startContinuousVibration = useCallback((intervalMs = 2000) => {
    if (!enabled || !supportsVibration()) return null;

    const intervalId = setInterval(() => {
      vibrate(PATTERNS.critical);
    }, intervalMs);

    return intervalId;
  }, [enabled, vibrate]);

  const stopContinuousVibration = useCallback((intervalId) => {
    if (intervalId) {
      clearInterval(intervalId);
    }
    stop();
  }, [stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stop();
  }, [stop]);

  return {
    // Core functions
    vibrate,
    stop,
    supportsVibration: supportsVibration(),

    // Threat-specific
    vibrateForThreatLevel,
    vibrateNewThreat,
    vibrateApproaching,
    vibrateDeparting,
    vibrateClear,
    vibrateError,

    // UI feedback
    vibrateTap,
    vibrateSelect,

    // Continuous vibration
    startContinuousVibration,
    stopContinuousVibration,

    // Patterns for custom use
    patterns: PATTERNS,
  };
}

export default useHapticFeedback;
