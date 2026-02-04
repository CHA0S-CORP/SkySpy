import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * @typedef {import('../../../types').Aircraft} Aircraft
 */

/**
 * @typedef {Object} UseMapAircraftSelectionOptions
 * @property {Function} [setHashParams] - Function to update URL hash params
 * @property {Object} [hashParams] - Current URL hash params
 */

/**
 * @typedef {Object} UseMapAircraftSelectionReturn
 * @property {Aircraft|null} selectedAircraft - Currently selected aircraft for popup
 * @property {function(Aircraft|null): void} setSelectedAircraft
 * @property {string|null} sidebarAircraftHex - ICAO hex for sidebar quick view
 * @property {function(string|null): void} setSidebarAircraftHex
 * @property {string|null} aircraftDetailHex - ICAO hex for full detail modal
 * @property {function(string|null): void} setAircraftDetailHex
 * @property {string|null} followingAircraft - ICAO hex of aircraft being followed
 * @property {function(string|null): void} setFollowingAircraft
 * @property {function(): void} clearAllSelections - Clear all selections
 * @property {function(Aircraft): void} selectAircraft - Select aircraft and update URL
 * @property {function(): void} deselectAircraft - Deselect aircraft and update URL
 */

/**
 * Hook to manage aircraft selection state
 * Handles popup selection, sidebar quick view, full detail modal, and aircraft following
 * Optionally syncs selection with URL hash params
 *
 * @param {UseMapAircraftSelectionOptions} options
 * @returns {UseMapAircraftSelectionReturn}
 */
export function useMapAircraftSelection({ setHashParams, hashParams } = {}) {
  // Aircraft selected for popup display
  const [selectedAircraft, setSelectedAircraftState] = useState(null);

  // Aircraft hex for sidebar quick view
  const [sidebarAircraftHex, setSidebarAircraftHex] = useState(null);

  // Aircraft hex for full detail modal
  const [aircraftDetailHex, setAircraftDetailHex] = useState(null);

  // Aircraft hex being followed (pro mode camera following)
  const [followingAircraft, setFollowingAircraft] = useState(null);

  // Track if user intentionally deselected (to prevent URL sync from re-selecting)
  const userDeselectedRef = useRef(false);

  // Popup position (for draggable popup)
  const [popupPosition, setPopupPosition] = useState({ x: 16, y: 16 });

  // Set selected aircraft with optional URL update
  const setSelectedAircraft = useCallback((aircraft) => {
    if (aircraft === null) {
      userDeselectedRef.current = true;
    }
    setSelectedAircraftState(aircraft);
  }, []);

  // Select aircraft and update URL hash
  const selectAircraft = useCallback((aircraft) => {
    if (!aircraft) return;

    userDeselectedRef.current = false;
    setSelectedAircraftState(aircraft);
    setPopupPosition({ x: 16, y: 16 });

    // Update URL hash if function provided
    if (setHashParams && aircraft.hex) {
      setHashParams({ selected: aircraft.hex });
    }
  }, [setHashParams]);

  // Deselect aircraft and update URL hash
  const deselectAircraft = useCallback(() => {
    userDeselectedRef.current = true;
    setSelectedAircraftState(null);

    // Update URL hash if function provided
    if (setHashParams) {
      setHashParams({ selected: undefined });
    }
  }, [setHashParams]);

  // Open aircraft in sidebar
  const openInSidebar = useCallback((hex) => {
    setSidebarAircraftHex(hex);
    setAircraftDetailHex(null); // Close detail modal if open
  }, []);

  // Open aircraft in full detail modal
  const openInDetail = useCallback((hex) => {
    setAircraftDetailHex(hex);
    setSidebarAircraftHex(null); // Close sidebar if open

    // Update URL hash if function provided
    if (setHashParams) {
      setHashParams({ aircraft: hex });
    }
  }, [setHashParams]);

  // Close sidebar
  const closeSidebar = useCallback(() => {
    setSidebarAircraftHex(null);
  }, []);

  // Close detail modal
  const closeDetail = useCallback(() => {
    setAircraftDetailHex(null);

    // Update URL hash if function provided
    if (setHashParams) {
      setHashParams({ aircraft: undefined });
    }
  }, [setHashParams]);

  // Clear all selections
  const clearAllSelections = useCallback(() => {
    userDeselectedRef.current = true;
    setSelectedAircraftState(null);
    setSidebarAircraftHex(null);
    setAircraftDetailHex(null);
    setFollowingAircraft(null);
  }, []);

  // Toggle following for an aircraft
  const toggleFollow = useCallback((hex) => {
    setFollowingAircraft((prev) => (prev === hex ? null : hex));
  }, []);

  // Sync aircraft detail from URL hash on mount
  useEffect(() => {
    if (hashParams?.aircraft && !aircraftDetailHex) {
      setAircraftDetailHex(hashParams.aircraft);
    }
  }, [hashParams?.aircraft]);

  return {
    // Selected aircraft (for popup)
    selectedAircraft,
    setSelectedAircraft,
    selectAircraft,
    deselectAircraft,
    popupPosition,
    setPopupPosition,

    // Sidebar quick view
    sidebarAircraftHex,
    setSidebarAircraftHex,
    openInSidebar,
    closeSidebar,

    // Full detail modal
    aircraftDetailHex,
    setAircraftDetailHex,
    openInDetail,
    closeDetail,

    // Following
    followingAircraft,
    setFollowingAircraft,
    toggleFollow,

    // Actions
    clearAllSelections,

    // Internal refs (for advanced use cases)
    userDeselectedRef,
  };
}

export default useMapAircraftSelection;
