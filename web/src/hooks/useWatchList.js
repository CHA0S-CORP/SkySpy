import { useState, useCallback, useEffect, useRef } from 'react';
import { withAuth } from '../lib/authHeader';

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
        return parsed.filter((item) => item && typeof item.hex === 'string');
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

  // Sync with backend on mount
  useEffect(() => {
    const syncFromBackend = async () => {
      try {
        const res = await fetch('/api/v1/watchlist/', { headers: withAuth() });
        if (res.ok) {
          const data = await res.json();
          if (data.watchList?.length > 0) {
            const backendList = data.watchList.map((item) => ({
              hex: item.hex.toUpperCase(),
              callsign: item.callsign || null,
              type: item.type_code || null,
              registration: item.registration || null,
              notes: item.notes || '',
              addedAt: new Date(item.added_at).getTime(),
            }));
            setWatchList(backendList);
          } else if (watchList.length > 0) {
            // Backend is empty but we have local data - push to backend
            await fetch('/api/v1/watchlist/import/', {
              method: 'POST',
              headers: withAuth({ 'Content-Type': 'application/json' }),
              body: JSON.stringify({
                watchList: watchList.map((item) => ({
                  hex: item.hex,
                  callsign: item.callsign || '',
                  type_code: item.type || '',
                })),
              }),
            });
          }
        }
      } catch (err) {
        console.warn('[WatchList] Backend sync failed, using localStorage:', err);
      }
    };
    syncFromBackend();
  }, []); // Only on mount

  // Persist panel visibility to localStorage on change
  useEffect(() => {
    savePanelVisible(panelVisible);
  }, [panelVisible]);

  // Check if an aircraft is in the watch list
  const isWatched = useCallback(
    (hex) => {
      if (!hex) return false;
      return watchList.some((item) => item.hex?.toUpperCase() === hex?.toUpperCase());
    },
    [watchList]
  );

  // Add an aircraft to the watch list
  const addToWatchList = useCallback(
    (aircraft) => {
      if (!aircraft?.hex) return false;

      const hex = aircraft.hex.toUpperCase();

      // Don't add if already in list
      if (watchList.some((item) => item.hex === hex)) {
        return false;
      }

      const entry = {
        hex,
        callsign: aircraft.flight?.trim() || null,
        type: aircraft.type || null,
        addedAt: Date.now(),
      };

      setWatchList((prev) => [...prev, entry]);
      playAddSound();

      // Auto-show panel when first aircraft is added
      if (watchList.length === 0) {
        setPanelVisible(true);
      }

      // Sync to backend (fire and forget)
      fetch('/api/v1/watchlist/', {
        method: 'POST',
        headers: withAuth({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          hex,
          callsign: entry.callsign || '',
          type_code: entry.type || '',
        }),
      }).catch(() => {}); // Silent fail - localStorage is primary

      return true;
    },
    [watchList, playAddSound]
  );

  // Remove an aircraft from the watch list
  const removeFromWatchList = useCallback(
    (hex) => {
      if (!hex) return false;

      const upperHex = hex.toUpperCase();
      const exists = watchList.some((item) => item.hex === upperHex);

      if (exists) {
        setWatchList((prev) => prev.filter((item) => item.hex !== upperHex));
        playRemoveSound();

        // Sync to backend (fire and forget). Must send the auth header like
        // every other watchlist call — without it a signed-in user's DELETE
        // 401s and the item reappears on the next mount sync.
        fetch(`/api/v1/watchlist/${upperHex}/`, {
          method: 'DELETE',
          headers: withAuth(),
        }).catch(() => {});

        return true;
      }

      return false;
    },
    [watchList, playRemoveSound]
  );

  // Toggle an aircraft in the watch list
  const toggleWatchList = useCallback(
    (aircraft) => {
      if (!aircraft?.hex) return;

      if (isWatched(aircraft.hex)) {
        removeFromWatchList(aircraft.hex);
      } else {
        addToWatchList(aircraft);
      }
    },
    [isWatched, addToWatchList, removeFromWatchList]
  );

  // Clear the entire watch list
  const clearWatchList = useCallback(() => {
    setWatchList([]);
    fetch('/api/v1/watchlist/clear/', { method: 'DELETE', headers: withAuth() }).catch(() => {});
  }, []);

  // Toggle panel visibility
  const togglePanel = useCallback(() => {
    setPanelVisible((prev) => !prev);
  }, []);

  // Show panel
  const showPanel = useCallback(() => {
    setPanelVisible(true);
  }, []);

  // Hide panel
  const hidePanel = useCallback(() => {
    setPanelVisible(false);
  }, []);

  // Export watch list as JSON file download
  const exportWatchList = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/watchlist/export/', { headers: withAuth() });
      if (res.ok) {
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `skyspy-watchlist-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
      }
    } catch {
      // Fall through to local export
    }
    // Fallback to local export
    const data = {
      version: 1,
      exported: new Date().toISOString(),
      watchList: watchList.map((item) => ({
        hex: item.hex,
        callsign: item.callsign || item.flight,
        addedAt: item.addedAt,
      })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `skyspy-watchlist-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [watchList]);

  // Import watch list from JSON string
  const importWatchList = useCallback(
    async (jsonString) => {
      try {
        const data = JSON.parse(jsonString);
        const items = data.watchList || data;
        if (!Array.isArray(items)) throw new Error('Invalid format');

        let added = 0;
        const newItems = [];
        items.forEach((item) => {
          if (item.hex && !isWatched(item.hex)) {
            newItems.push(item);
            addToWatchList({ hex: item.hex, callsign: item.callsign, flight: item.callsign });
            added++;
          }
        });

        // Bulk import to backend
        if (newItems.length > 0) {
          fetch('/api/v1/watchlist/import/', {
            method: 'POST',
            headers: withAuth({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ watchList: newItems }),
          }).catch(() => {});
        }

        return { success: true, added };
      } catch (e) {
        console.error('Failed to import watch list:', e);
        return { success: false, error: e.message };
      }
    },
    [isWatched, addToWatchList]
  );

  // Get watch list with live aircraft data merged in
  const getWatchListWithLiveData = useCallback(
    (aircraftList) => {
      return watchList.map((entry) => {
        const liveAircraft = aircraftList?.find((ac) => ac.hex?.toUpperCase() === entry.hex);

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
    },
    [watchList]
  );

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

    // Import/Export
    exportWatchList,
    importWatchList,

    // Audio initialization (call on user interaction)
    initializeAudio,
  };
}

export default useWatchList;
