import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * useWatchList hook - manages aircraft watch list with localStorage persistence
 *
 * Features:
 * - Add/remove aircraft from watch list
 * - Persist across sessions via localStorage
 * - Audio notification on add (optional)
 * - Toggle panel visibility with W key
 */

const STORAGE_KEY = 'adsb-watch-list';
const PANEL_VISIBLE_KEY = 'adsb-watch-list-panel-visible';

/**
 * Load watch list from localStorage
 */
function loadWatchList() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Ensure it's an array of valid objects
      if (Array.isArray(parsed)) {
        return parsed.filter(item => item && typeof item.hex === 'string');
      }
    }
  } catch (e) {
    console.warn('Failed to load watch list from localStorage:', e);
  }
  return [];
}

/**
 * Save watch list to localStorage
 */
function saveWatchList(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('Failed to save watch list to localStorage:', e);
  }
}

/**
 * Load panel visibility from localStorage
 */
function loadPanelVisible() {
  try {
    const saved = localStorage.getItem(PANEL_VISIBLE_KEY);
    return saved === null ? false : saved === 'true';
  } catch {
    return false;
  }
}

/**
 * Save panel visibility to localStorage
 */
function savePanelVisible(visible) {
  try {
    localStorage.setItem(PANEL_VISIBLE_KEY, String(visible));
  } catch (e) {
    console.warn('Failed to save watch list panel visibility:', e);
  }
}

export function useWatchList({ enableAudio = true } = {}) {
  // Watch list state - array of { hex, callsign, addedAt }
  const [watchList, setWatchList] = useState(loadWatchList);

  // Panel visibility state
  const [panelVisible, setPanelVisible] = useState(loadPanelVisible);

  // Audio context for notification sound
  const audioContextRef = useRef(null);
  const audioInitializedRef = useRef(false);

  // Initialize audio context (called on first user interaction)
  const initializeAudio = useCallback(() => {
    if (audioInitializedRef.current || !enableAudio) return;
    try {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      audioInitializedRef.current = true;
    } catch (e) {
      console.warn('Failed to initialize audio context:', e);
    }
  }, [enableAudio]);

  // Play a short notification tone when aircraft is added
  const playAddSound = useCallback(() => {
    if (!audioContextRef.current || !enableAudio) return;

    try {
      const ctx = audioContextRef.current;
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      // Pleasant ascending two-tone sound
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, ctx.currentTime); // A5
      oscillator.frequency.setValueAtTime(1046.5, ctx.currentTime + 0.1); // C6

      gainNode.gain.setValueAtTime(0.15, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.2);
    } catch (e) {
      // Ignore audio errors
    }
  }, [enableAudio]);

  // Play a short descending tone when aircraft is removed
  const playRemoveSound = useCallback(() => {
    if (!audioContextRef.current || !enableAudio) return;

    try {
      const ctx = audioContextRef.current;
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      // Descending tone
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(660, ctx.currentTime); // E5
      oscillator.frequency.setValueAtTime(440, ctx.currentTime + 0.1); // A4

      gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.15);
    } catch (e) {
      // Ignore audio errors
    }
  }, [enableAudio]);

  // Persist watch list to localStorage on change
  useEffect(() => {
    saveWatchList(watchList);
  }, [watchList]);

  // Persist panel visibility to localStorage on change
  useEffect(() => {
    savePanelVisible(panelVisible);
  }, [panelVisible]);

  // Check if an aircraft is in the watch list
  const isWatched = useCallback((hex) => {
    if (!hex) return false;
    return watchList.some(item => item.hex?.toUpperCase() === hex?.toUpperCase());
  }, [watchList]);

  // Add an aircraft to the watch list
  const addToWatchList = useCallback((aircraft) => {
    if (!aircraft?.hex) return false;

    const hex = aircraft.hex.toUpperCase();

    // Don't add if already in list
    if (watchList.some(item => item.hex === hex)) {
      return false;
    }

    const entry = {
      hex,
      callsign: aircraft.flight?.trim() || null,
      type: aircraft.type || null,
      addedAt: Date.now(),
    };

    setWatchList(prev => [...prev, entry]);
    playAddSound();

    // Auto-show panel when first aircraft is added
    if (watchList.length === 0) {
      setPanelVisible(true);
    }

    return true;
  }, [watchList, playAddSound]);

  // Remove an aircraft from the watch list
  const removeFromWatchList = useCallback((hex) => {
    if (!hex) return false;

    const upperHex = hex.toUpperCase();
    const exists = watchList.some(item => item.hex === upperHex);

    if (exists) {
      setWatchList(prev => prev.filter(item => item.hex !== upperHex));
      playRemoveSound();
      return true;
    }

    return false;
  }, [watchList, playRemoveSound]);

  // Toggle an aircraft in the watch list
  const toggleWatchList = useCallback((aircraft) => {
    if (!aircraft?.hex) return;

    if (isWatched(aircraft.hex)) {
      removeFromWatchList(aircraft.hex);
    } else {
      addToWatchList(aircraft);
    }
  }, [isWatched, addToWatchList, removeFromWatchList]);

  // Clear the entire watch list
  const clearWatchList = useCallback(() => {
    setWatchList([]);
  }, []);

  // Toggle panel visibility
  const togglePanel = useCallback(() => {
    setPanelVisible(prev => !prev);
  }, []);

  // Show panel
  const showPanel = useCallback(() => {
    setPanelVisible(true);
  }, []);

  // Hide panel
  const hidePanel = useCallback(() => {
    setPanelVisible(false);
  }, []);

  // Get watch list with live aircraft data merged in
  const getWatchListWithLiveData = useCallback((aircraftList) => {
    return watchList.map(entry => {
      const liveAircraft = aircraftList?.find(
        ac => ac.hex?.toUpperCase() === entry.hex
      );

      return {
        ...entry,
        // Update callsign if we have live data and it's different
        callsign: liveAircraft?.flight?.trim() || entry.callsign,
        // Include live data if available
        live: liveAircraft || null,
        isLive: !!liveAircraft,
        // Calculate time since added
        addedAgo: Date.now() - entry.addedAt,
      };
    });
  }, [watchList]);

  return {
    // State
    watchList,
    panelVisible,
    count: watchList.length,

    // Actions
    addToWatchList,
    removeFromWatchList,
    toggleWatchList,
    clearWatchList,
    isWatched,

    // Panel controls
    togglePanel,
    showPanel,
    hidePanel,
    setPanelVisible,

    // Data helpers
    getWatchListWithLiveData,

    // Audio initialization (call on user interaction)
    initializeAudio,
  };
}

export default useWatchList;
