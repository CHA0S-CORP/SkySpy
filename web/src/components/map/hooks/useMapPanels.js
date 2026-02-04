import { useState, useCallback } from 'react';

/**
 * @typedef {Object} MapPanelState
 * @property {boolean} showAircraftList - Aircraft list panel visibility
 * @property {boolean} showLegend - Legend panel visibility
 * @property {boolean} showAcarsPanel - ACARS panel visibility
 * @property {boolean} showFilterMenu - Traffic filter menu visibility
 * @property {boolean} showOverlayMenu - Overlay settings menu visibility
 * @property {boolean} showMobileControls - Mobile controls dropdown visibility
 * @property {boolean} showAdvisoryPanel - Airspace advisories panel visibility
 * @property {boolean} showNotamPanel - NOTAM panel visibility
 * @property {boolean} showRangeControl - Range control visibility
 * @property {boolean} listExpanded - Aircraft list expanded state
 * @property {boolean} legendCollapsed - Legend content collapsed state
 */

/**
 * @typedef {Object} UseMapPanelsReturn
 * @property {boolean} showAircraftList
 * @property {function(boolean): void} setShowAircraftList
 * @property {boolean} showLegend
 * @property {function(boolean): void} setShowLegend
 * @property {boolean} showAcarsPanel
 * @property {function(boolean): void} setShowAcarsPanel
 * @property {boolean} showFilterMenu
 * @property {function(boolean): void} setShowFilterMenu
 * @property {boolean} showOverlayMenu
 * @property {function(boolean): void} setShowOverlayMenu
 * @property {boolean} showMobileControls
 * @property {function(boolean): void} setShowMobileControls
 * @property {boolean} showAdvisoryPanel
 * @property {function(boolean): void} setShowAdvisoryPanel
 * @property {boolean} showNotamPanel
 * @property {function(boolean): void} setShowNotamPanel
 * @property {boolean} showRangeControl
 * @property {function(boolean): void} setShowRangeControl
 * @property {boolean} listExpanded
 * @property {function(boolean): void} setListExpanded
 * @property {boolean} legendCollapsed
 * @property {function(boolean): void} setLegendCollapsed
 * @property {function(): void} closeAllPanels - Close all panels except persistent ones
 * @property {function(string): void} togglePanel - Toggle a specific panel by name
 */

const STORAGE_KEYS = {
  showAircraftList: 'adsb-show-aircraft-list',
  listExpanded: 'adsb-list-expanded',
};

/**
 * Hook to manage map panel visibility state
 * Handles localStorage persistence for user preferences
 *
 * @returns {UseMapPanelsReturn}
 */
export function useMapPanels() {
  // Persisted panel states (restored from localStorage)
  const [showAircraftList, setShowAircraftListState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.showAircraftList);
      return saved === null ? false : saved === 'true';
    } catch {
      return false;
    }
  });

  const [listExpanded, setListExpandedState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.listExpanded);
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });

  // Transient panel states (not persisted)
  const [showLegend, setShowLegend] = useState(false);
  const [legendCollapsed, setLegendCollapsed] = useState(false);
  const [showAcarsPanel, setShowAcarsPanel] = useState(false);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showOverlayMenu, setShowOverlayMenu] = useState(false);
  const [showMobileControls, setShowMobileControls] = useState(false);
  const [showAdvisoryPanel, setShowAdvisoryPanel] = useState(false);
  const [showNotamPanel, setShowNotamPanel] = useState(false);
  const [showRangeControl, setShowRangeControl] = useState(false);

  // Persist showAircraftList to localStorage
  const setShowAircraftList = useCallback((value) => {
    setShowAircraftListState(value);
    try {
      localStorage.setItem(STORAGE_KEYS.showAircraftList, String(value));
    } catch {
      // localStorage unavailable
    }
  }, []);

  // Persist listExpanded to localStorage
  const setListExpanded = useCallback((value) => {
    setListExpandedState(value);
    try {
      localStorage.setItem(STORAGE_KEYS.listExpanded, String(value));
    } catch {
      // localStorage unavailable
    }
  }, []);

  // Close all transient panels
  const closeAllPanels = useCallback(() => {
    setShowLegend(false);
    setShowAcarsPanel(false);
    setShowFilterMenu(false);
    setShowOverlayMenu(false);
    setShowMobileControls(false);
    setShowAdvisoryPanel(false);
    setShowNotamPanel(false);
    setShowRangeControl(false);
  }, []);

  // Toggle a specific panel by name
  const togglePanel = useCallback(
    (panelName) => {
      switch (panelName) {
        case 'aircraftList':
          setShowAircraftList((prev) => !prev);
          break;
        case 'legend':
          setShowLegend((prev) => !prev);
          break;
        case 'acars':
          setShowAcarsPanel((prev) => !prev);
          break;
        case 'filter':
          setShowFilterMenu((prev) => !prev);
          break;
        case 'overlay':
          setShowOverlayMenu((prev) => !prev);
          break;
        case 'mobile':
          setShowMobileControls((prev) => !prev);
          break;
        case 'advisory':
          setShowAdvisoryPanel((prev) => !prev);
          break;
        case 'notam':
          setShowNotamPanel((prev) => !prev);
          break;
        case 'range':
          setShowRangeControl((prev) => !prev);
          break;
        default:
          console.warn(`Unknown panel: ${panelName}`);
      }
    },
    [setShowAircraftList]
  );

  return {
    // Aircraft list
    showAircraftList,
    setShowAircraftList,
    listExpanded,
    setListExpanded,

    // Legend
    showLegend,
    setShowLegend,
    legendCollapsed,
    setLegendCollapsed,

    // ACARS
    showAcarsPanel,
    setShowAcarsPanel,

    // Filters
    showFilterMenu,
    setShowFilterMenu,

    // Overlays
    showOverlayMenu,
    setShowOverlayMenu,

    // Mobile
    showMobileControls,
    setShowMobileControls,

    // Advisories
    showAdvisoryPanel,
    setShowAdvisoryPanel,

    // NOTAMs
    showNotamPanel,
    setShowNotamPanel,

    // Range control
    showRangeControl,
    setShowRangeControl,

    // Actions
    closeAllPanels,
    togglePanel,
  };
}

export default useMapPanels;
