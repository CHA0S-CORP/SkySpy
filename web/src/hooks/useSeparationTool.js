/**
 * Separation Tool Hook
 * Phase 8.5 Implementation - Pro Radar Mode
 *
 * Manages state and logic for measuring separation between aircraft pairs.
 * Click first aircraft, then Ctrl+Click second aircraft to measure.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { checkSeparation, getSeparationColor, SEPARATION_STATUS } from '../utils/separationRules';

/**
 * Hook to manage separation tool state and calculations
 *
 * @param {Object} options
 * @param {Array} options.aircraft - Array of aircraft objects
 * @param {Object} options.selectedAircraft - Currently selected aircraft
 * @param {number} options.feederLat - Feeder station latitude
 * @param {number} options.feederLon - Feeder station longitude
 * @returns {Object} Separation tool state and handlers
 */
export function useSeparationTool({
  aircraft = [],
  selectedAircraft = null,
  feederLat,
  feederLon,
}) {
  // State for separation pair
  const [separationPair, setSeparationPair] = useState(null); // { aircraft1: hex, aircraft2: hex }

  // Find aircraft objects from hex codes
  const aircraft1 = useMemo(() => {
    if (!separationPair?.aircraft1 || !aircraft?.length) return null;
    return aircraft.find((a) => a.hex === separationPair.aircraft1);
  }, [separationPair?.aircraft1, aircraft]);

  const aircraft2 = useMemo(() => {
    if (!separationPair?.aircraft2 || !aircraft?.length) return null;
    return aircraft.find((a) => a.hex === separationPair.aircraft2);
  }, [separationPair?.aircraft2, aircraft]);

  // Calculate separation data
  const separationData = useMemo(() => {
    if (!aircraft1 || !aircraft2) return null;
    return checkSeparation(aircraft1, aircraft2, { radarLat: feederLat, radarLon: feederLon });
  }, [aircraft1, aircraft2, feederLat, feederLon]);

  // Get color based on separation status
  const separationColor = useMemo(() => {
    if (!separationData?.status?.overall) return null;
    return getSeparationColor(separationData.status.overall);
  }, [separationData?.status?.overall]);

  // Clear separation pair if either aircraft is no longer tracked
  useEffect(() => {
    if (separationPair && (!aircraft1 || !aircraft2)) {
      setSeparationPair(null);
    }
  }, [separationPair, aircraft1, aircraft2]);

  // Clear separation pair when selected aircraft changes (unless it's one of the pair)
  useEffect(() => {
    if (separationPair && selectedAircraft) {
      const selectedHex = selectedAircraft.hex;
      if (selectedHex !== separationPair.aircraft1 && selectedHex !== separationPair.aircraft2) {
        // User selected a different aircraft, clear the pair
        setSeparationPair(null);
      }
    }
  }, [selectedAircraft?.hex, separationPair]);

  /**
   * Set the second aircraft in the separation pair
   * Called on Ctrl+Click
   */
  const setSecondAircraft = useCallback(
    (aircraft2Hex) => {
      if (!selectedAircraft) return;
      if (aircraft2Hex === selectedAircraft.hex) return; // Can't measure separation with self

      setSeparationPair({
        aircraft1: selectedAircraft.hex,
        aircraft2: aircraft2Hex,
      });
    },
    [selectedAircraft]
  );

  /**
   * Clear the separation measurement
   */
  const clearSeparation = useCallback(() => {
    setSeparationPair(null);
  }, []);

  /**
   * Check if a click event is a Ctrl+Click that should trigger separation measurement
   */
  const isCtrlClick = useCallback((event) => {
    return event.ctrlKey || event.metaKey;
  }, []);

  /**
   * Handle potential separation tool click
   * Returns true if the click was handled, false otherwise
   */
  const handleSeparationClick = useCallback(
    (event, clickedAircraft) => {
      if (!isCtrlClick(event) || !selectedAircraft) return false;
      if (!clickedAircraft) {
        // Ctrl+clicked on empty area - clear separation
        clearSeparation();
        return true;
      }
      if (clickedAircraft.hex === selectedAircraft.hex) return false;

      setSecondAircraft(clickedAircraft.hex);
      return true;
    },
    [isCtrlClick, selectedAircraft, setSecondAircraft, clearSeparation]
  );

  return {
    // State
    separationPair,
    aircraft1,
    aircraft2,
    separationData,
    separationColor,

    // Actions
    setSecondAircraft,
    clearSeparation,
    handleSeparationClick,
    isCtrlClick,

    // Helpers
    isActive: !!separationPair && !!aircraft1 && !!aircraft2,
    status: separationData?.status?.overall || null,
    isViolation: separationData?.status?.overall === SEPARATION_STATUS.VIOLATION,
    isMarginal: separationData?.status?.overall === SEPARATION_STATUS.MARGINAL,
    isAdequate: separationData?.status?.overall === SEPARATION_STATUS.ADEQUATE,
  };
}

export default useSeparationTool;
