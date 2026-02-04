import { useState, useEffect, useCallback, useMemo } from 'react';

/**
 * Phase 7: Accessibility Hook
 *
 * Centralized accessibility state management for:
 * - High contrast mode (7.1)
 * - Screen reader announcements (7.2)
 * - Reduced motion preferences (7.3)
 *
 * Persists user preferences to localStorage while respecting system preferences.
 */

const STORAGE_KEYS = {
  HIGH_CONTRAST: 'adsb-pro-high-contrast',
  REDUCED_MOTION: 'adsb-pro-reduced-motion',
  SCREEN_READER: 'adsb-pro-screen-reader',
  SHAPE_MARKERS: 'adsb-pro-shape-markers',
};

/**
 * Hook for managing accessibility settings
 *
 * @returns {Object} Accessibility state and setters
 *
 * @example
 * ```jsx
 * const {
 *   highContrastMode,
 *   setHighContrastMode,
 *   reducedMotion,
 *   setReducedMotion,
 *   screenReaderEnabled,
 *   setScreenReaderEnabled,
 *   shapeMarkers,
 *   setShapeMarkers,
 *   accessibilityClasses,
 * } = useAccessibility();
 * ```
 */
export function useAccessibility() {
  // High Contrast Mode (7.1)
  const [highContrastMode, setHighContrastModeState] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem(STORAGE_KEYS.HIGH_CONTRAST);
    if (stored !== null) return stored === 'true';
    // Check system preference for high contrast
    return window.matchMedia?.('(prefers-contrast: more)')?.matches || false;
  });

  // Reduced Motion (7.3)
  const [reducedMotion, setReducedMotionState] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem(STORAGE_KEYS.REDUCED_MOTION);
    if (stored !== null) return stored === 'true';
    // Check system preference
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || false;
  });

  // Screen Reader Announcements (7.2)
  const [screenReaderEnabled, setScreenReaderEnabledState] = useState(() => {
    if (typeof window === 'undefined') return true; // Default enabled for accessibility
    const stored = localStorage.getItem(STORAGE_KEYS.SCREEN_READER);
    return stored === null ? true : stored === 'true';
  });

  // Shape-based markers for colorblind accessibility (7.1)
  // Triangle=civilian, Diamond=military, Circle+X=emergency
  const [shapeMarkers, setShapeMarkersState] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(STORAGE_KEYS.SHAPE_MARKERS) === 'true';
  });

  // Setters that persist to localStorage
  const setHighContrastMode = useCallback((value) => {
    const newValue = typeof value === 'function' ? value(highContrastMode) : value;
    setHighContrastModeState(newValue);
    localStorage.setItem(STORAGE_KEYS.HIGH_CONTRAST, String(newValue));
  }, [highContrastMode]);

  const setReducedMotion = useCallback((value) => {
    const newValue = typeof value === 'function' ? value(reducedMotion) : value;
    setReducedMotionState(newValue);
    localStorage.setItem(STORAGE_KEYS.REDUCED_MOTION, String(newValue));
  }, [reducedMotion]);

  const setScreenReaderEnabled = useCallback((value) => {
    const newValue = typeof value === 'function' ? value(screenReaderEnabled) : value;
    setScreenReaderEnabledState(newValue);
    localStorage.setItem(STORAGE_KEYS.SCREEN_READER, String(newValue));
  }, [screenReaderEnabled]);

  const setShapeMarkers = useCallback((value) => {
    const newValue = typeof value === 'function' ? value(shapeMarkers) : value;
    setShapeMarkersState(newValue);
    localStorage.setItem(STORAGE_KEYS.SHAPE_MARKERS, String(newValue));
  }, [shapeMarkers]);

  // Listen for system preference changes
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Reduced motion system preference
    const reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const handleReducedMotionChange = (e) => {
      // Only update if user hasn't set a manual preference
      if (localStorage.getItem(STORAGE_KEYS.REDUCED_MOTION) === null) {
        setReducedMotionState(e.matches);
      }
    };

    // High contrast system preference
    const contrastQuery = window.matchMedia?.('(prefers-contrast: more)');
    const handleContrastChange = (e) => {
      // Only update if user hasn't set a manual preference
      if (localStorage.getItem(STORAGE_KEYS.HIGH_CONTRAST) === null) {
        setHighContrastModeState(e.matches);
      }
    };

    reducedMotionQuery?.addEventListener?.('change', handleReducedMotionChange);
    contrastQuery?.addEventListener?.('change', handleContrastChange);

    return () => {
      reducedMotionQuery?.removeEventListener?.('change', handleReducedMotionChange);
      contrastQuery?.removeEventListener?.('change', handleContrastChange);
    };
  }, []);

  // Apply body classes for CSS-based accessibility features
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const body = document.body;

    // High contrast mode
    if (highContrastMode) {
      body.classList.add('high-contrast-mode');
    } else {
      body.classList.remove('high-contrast-mode');
    }

    // Reduced motion (also add class for JS-based animation control)
    if (reducedMotion) {
      body.classList.add('reduced-motion');
    } else {
      body.classList.remove('reduced-motion');
    }

    // Shape markers mode
    if (shapeMarkers) {
      body.classList.add('shape-markers-mode');
    } else {
      body.classList.remove('shape-markers-mode');
    }
  }, [highContrastMode, reducedMotion, shapeMarkers]);

  // Generate class string for components
  const accessibilityClasses = useMemo(() => {
    const classes = [];
    if (highContrastMode) classes.push('high-contrast-mode');
    if (reducedMotion) classes.push('reduced-motion');
    if (shapeMarkers) classes.push('shape-markers-mode');
    return classes.join(' ');
  }, [highContrastMode, reducedMotion, shapeMarkers]);

  // Toggle functions for keyboard shortcuts
  const toggleHighContrast = useCallback(() => {
    setHighContrastMode((prev) => !prev);
  }, [setHighContrastMode]);

  const toggleReducedMotion = useCallback(() => {
    setReducedMotion((prev) => !prev);
  }, [setReducedMotion]);

  const toggleScreenReader = useCallback(() => {
    setScreenReaderEnabled((prev) => !prev);
  }, [setScreenReaderEnabled]);

  const toggleShapeMarkers = useCallback(() => {
    setShapeMarkers((prev) => !prev);
  }, [setShapeMarkers]);

  // Reset all accessibility settings to defaults/system preferences
  const resetToDefaults = useCallback(() => {
    localStorage.removeItem(STORAGE_KEYS.HIGH_CONTRAST);
    localStorage.removeItem(STORAGE_KEYS.REDUCED_MOTION);
    localStorage.removeItem(STORAGE_KEYS.SCREEN_READER);
    localStorage.removeItem(STORAGE_KEYS.SHAPE_MARKERS);

    // Reset to system preferences
    setHighContrastModeState(
      window.matchMedia?.('(prefers-contrast: more)')?.matches || false
    );
    setReducedMotionState(
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || false
    );
    setScreenReaderEnabledState(true);
    setShapeMarkersState(false);
  }, []);

  return {
    // State
    highContrastMode,
    reducedMotion,
    screenReaderEnabled,
    shapeMarkers,

    // Setters
    setHighContrastMode,
    setReducedMotion,
    setScreenReaderEnabled,
    setShapeMarkers,

    // Toggles for keyboard shortcuts
    toggleHighContrast,
    toggleReducedMotion,
    toggleScreenReader,
    toggleShapeMarkers,

    // Utility
    accessibilityClasses,
    resetToDefaults,

    // Storage keys for external use
    STORAGE_KEYS,
  };
}

export default useAccessibility;
