import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * useFlightStrips hook - manages ATC-style electronic flight strip panel
 *
 * Features:
 * - Add/remove aircraft to flight strips
 * - Drag-to-reorder strips
 * - Per-strip annotations/notes (scratchpad)
 * - Auto-remove when aircraft exits range (configurable)
 * - Color-coding by status (normal/watched/emergency/conflict)
 * - Persist strip order and notes across sessions
 */

const STORAGE_KEY = 'adsb-flight-strips';
const PANEL_VISIBLE_KEY = 'adsb-flight-strips-panel-visible';
const AUTO_REMOVE_KEY = 'adsb-flight-strips-auto-remove';

/**
 * Load flight strips from localStorage
 */
function loadFlightStrips() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return parsed.filter((item) => item && typeof item.hex === 'string');
      }
    }
  } catch (e) {
    console.warn('Failed to load flight strips from localStorage:', e);
  }
  return [];
}

/**
 * Save flight strips to localStorage
 */
function saveFlightStrips(strips) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(strips));
  } catch (e) {
    console.warn('Failed to save flight strips to localStorage:', e);
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
    console.warn('Failed to save flight strips panel visibility:', e);
  }
}

/**
 * Load auto-remove setting from localStorage
 */
function loadAutoRemove() {
  try {
    const saved = localStorage.getItem(AUTO_REMOVE_KEY);
    return saved === null ? true : saved === 'true';
  } catch {
    return true;
  }
}

/**
 * Save auto-remove setting to localStorage
 */
function saveAutoRemove(autoRemove) {
  try {
    localStorage.setItem(AUTO_REMOVE_KEY, String(autoRemove));
  } catch (e) {
    console.warn('Failed to save flight strips auto-remove setting:', e);
  }
}

/**
 * Get wake turbulence category based on aircraft type
 * @param {string} type - ICAO aircraft type code
 * @param {string} category - ADS-B category
 * @returns {string} Wake category (J/H/M/L/S)
 */
function getWakeCategory(type, category) {
  // Super heavy
  const superHeavy = ['A388', 'A380', 'A225', 'AN25'];
  if (superHeavy.some((t) => type?.toUpperCase()?.includes(t))) return 'J';

  // Heavy
  const heavy = [
    'B747',
    'B748',
    'B744',
    'B742',
    'B77W',
    'B77L',
    'B772',
    'B773',
    'B788',
    'B789',
    'B78X',
    'A340',
    'A330',
    'A350',
    'A359',
    'A35K',
    'MD11',
    'DC10',
    'IL96',
    'IL86',
    'AN12',
    'C5',
    'C17',
    'B52',
    'KC10',
    'KC46',
    'KC135',
  ];
  if (heavy.some((t) => type?.toUpperCase()?.includes(t))) return 'H';

  // Based on ADS-B category
  if (category) {
    // A5 = Heavy (>300,000 lbs)
    if (category === 'A5') return 'H';
    // A4 = Large (>75,000 to 300,000 lbs)
    if (category === 'A4') return 'M';
    // A3 = Large (>41,000 to 75,000 lbs)
    if (category === 'A3') return 'M';
    // A1, A2 = Light/Small
    if (category === 'A1' || category === 'A2') return 'L';
    // B1, B2 = Gliders/Balloons
    if (category?.startsWith('B')) return 'L';
  }

  // Default based on common types
  const medium = [
    'B737',
    'B738',
    'B739',
    'B38M',
    'B39M',
    'A320',
    'A321',
    'A319',
    'A318',
    'A20N',
    'A21N',
    'E190',
    'E195',
    'E170',
    'E175',
    'CRJ',
    'ERJ',
    'B757',
    'B752',
    'B753',
    'B767',
    'B762',
    'B763',
    'MD80',
    'MD90',
    'DC9',
  ];
  if (medium.some((t) => type?.toUpperCase()?.includes(t))) return 'M';

  const light = [
    'C172',
    'C182',
    'C152',
    'PA28',
    'PA32',
    'PA34',
    'DA40',
    'DA42',
    'SR22',
    'BE36',
    'BE58',
    'M20',
  ];
  if (light.some((t) => type?.toUpperCase()?.includes(t))) return 'L';

  // Default to Medium if we don't know
  return 'M';
}

export function useFlightStrips({ enableAudio = true } = {}) {
  // Flight strips state - array of strip data
  const [strips, setStrips] = useState(loadFlightStrips);

  // Panel visibility state
  const [panelVisible, setPanelVisible] = useState(loadPanelVisible);

  // Auto-remove setting
  const [autoRemove, setAutoRemove] = useState(loadAutoRemove);

  // Drag state for reordering
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  // Audio context for notification sound
  const audioContextRef = useRef(null);
  const audioInitializedRef = useRef(false);

  // Track last seen time for auto-removal
  const lastSeenRef = useRef({});

  // Initialize audio context
  const initializeAudio = useCallback(() => {
    if (audioInitializedRef.current || !enableAudio) return;
    try {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      audioInitializedRef.current = true;
    } catch (e) {
      console.warn('Failed to initialize audio context:', e);
    }
  }, [enableAudio]);

  // Play notification sound when strip is added
  const playAddSound = useCallback(() => {
    if (!audioContextRef.current || !enableAudio) return;

    try {
      const ctx = audioContextRef.current;
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      // Ascending three-tone sound
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      oscillator.frequency.setValueAtTime(659.25, ctx.currentTime + 0.08); // E5
      oscillator.frequency.setValueAtTime(783.99, ctx.currentTime + 0.16); // G5

      gainNode.gain.setValueAtTime(0.12, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.24);

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.24);
    } catch (e) {
      // Ignore audio errors
    }
  }, [enableAudio]);

  // Persist strips to localStorage on change
  useEffect(() => {
    saveFlightStrips(strips);
  }, [strips]);

  // Persist panel visibility to localStorage on change
  useEffect(() => {
    savePanelVisible(panelVisible);
  }, [panelVisible]);

  // Persist auto-remove setting to localStorage on change
  useEffect(() => {
    saveAutoRemove(autoRemove);
  }, [autoRemove]);

  // Check if an aircraft has a flight strip
  const hasStrip = useCallback(
    (hex) => {
      if (!hex) return false;
      return strips.some((s) => s.hex?.toUpperCase() === hex?.toUpperCase());
    },
    [strips]
  );

  // Add a flight strip for an aircraft
  const addStrip = useCallback(
    (aircraft, aircraftInfo = null) => {
      if (!aircraft?.hex) return false;

      const hex = aircraft.hex.toUpperCase();

      // Don't add if already exists
      if (strips.some((s) => s.hex === hex)) {
        return false;
      }

      const info = aircraftInfo?.[hex] || {};
      const type = info.type_code || info.type || aircraft.type || '';

      const strip = {
        hex,
        callsign: aircraft.flight?.trim() || null,
        squawk: aircraft.squawk || null,
        type: type,
        typeName: info.type_name || info.model || type,
        wakeCategory: getWakeCategory(type, aircraft.category),
        altitude: aircraft.alt_baro || aircraft.alt_geom || aircraft.alt || 0,
        speed: aircraft.gs || aircraft.tas || 0,
        origin: info.origin || aircraft.origin || null,
        destination: info.destination || aircraft.destination || null,
        registration: info.registration || null,
        operator: info.operator || info.owner || null,
        addedAt: Date.now(),
        note: '',
        // Status flags (updated from live data)
        isEmergency: false,
        isConflict: false,
        isWatched: false,
      };

      setStrips((prev) => [...prev, strip]);
      lastSeenRef.current[hex] = Date.now();
      playAddSound();

      // Auto-show panel when first strip is added
      if (strips.length === 0) {
        setPanelVisible(true);
      }

      return true;
    },
    [strips, playAddSound]
  );

  // Remove a flight strip
  const removeStrip = useCallback((hex) => {
    if (!hex) return false;

    const upperHex = hex.toUpperCase();
    setStrips((prev) => {
      const newStrips = prev.filter((s) => s.hex !== upperHex);
      if (newStrips.length !== prev.length) {
        delete lastSeenRef.current[upperHex];
        return newStrips;
      }
      return prev;
    });

    return true;
  }, []);

  // Toggle a flight strip
  const toggleStrip = useCallback(
    (aircraft, aircraftInfo = null) => {
      if (!aircraft?.hex) return;

      if (hasStrip(aircraft.hex)) {
        removeStrip(aircraft.hex);
      } else {
        addStrip(aircraft, aircraftInfo);
      }
    },
    [hasStrip, addStrip, removeStrip]
  );

  // Update strip note/annotation
  const updateNote = useCallback((hex, note) => {
    if (!hex) return;

    const upperHex = hex.toUpperCase();
    setStrips((prev) => prev.map((s) => (s.hex === upperHex ? { ...s, note: note || '' } : s)));
  }, []);

  // Clear all strips
  const clearStrips = useCallback(() => {
    setStrips([]);
    lastSeenRef.current = {};
  }, []);

  // Reorder strips (drag-drop)
  const reorderStrips = useCallback((fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;

    setStrips((prev) => {
      const newStrips = [...prev];
      const [moved] = newStrips.splice(fromIndex, 1);
      newStrips.splice(toIndex, 0, moved);
      return newStrips;
    });
  }, []);

  // Drag handlers for reordering
  const handleDragStart = useCallback((index) => {
    setDraggedIndex(index);
  }, []);

  const handleDragOver = useCallback((index) => {
    setDragOverIndex(index);
  }, []);

  const handleDragEnd = useCallback(() => {
    if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
      reorderStrips(draggedIndex, dragOverIndex);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  }, [draggedIndex, dragOverIndex, reorderStrips]);

  // Panel visibility controls
  const togglePanel = useCallback(() => {
    setPanelVisible((prev) => !prev);
  }, []);

  const showPanel = useCallback(() => {
    setPanelVisible(true);
  }, []);

  const hidePanel = useCallback(() => {
    setPanelVisible(false);
  }, []);

  // Toggle auto-remove setting
  const toggleAutoRemove = useCallback(() => {
    setAutoRemove((prev) => !prev);
  }, []);

  // Get strips with live aircraft data merged in
  const getStripsWithLiveData = useCallback(
    (aircraftList, safetyEvents = [], watchList = []) => {
      const now = Date.now();
      const watchSet = new Set(watchList.map((w) => w.hex?.toUpperCase()));
      const conflictHexes = new Set();

      // Build set of aircraft in active conflicts
      safetyEvents.forEach((event) => {
        if (event.icao) conflictHexes.add(event.icao.toUpperCase());
        if (event.icao_2) conflictHexes.add(event.icao_2.toUpperCase());
      });

      return strips.map((strip) => {
        const liveAircraft = aircraftList?.find((ac) => ac.hex?.toUpperCase() === strip.hex);

        // Update last seen time if aircraft is live
        if (liveAircraft) {
          lastSeenRef.current[strip.hex] = now;
        }

        const isEmergency = ['7500', '7600', '7700'].includes(liveAircraft?.squawk || strip.squawk);
        const isConflict = conflictHexes.has(strip.hex);
        const isWatched = watchSet.has(strip.hex);

        // Calculate time in range
        const timeInRange = now - strip.addedAt;
        const lastSeen = lastSeenRef.current[strip.hex] || strip.addedAt;
        const timeSinceLastSeen = now - lastSeen;

        return {
          ...strip,
          // Update with live data
          callsign: liveAircraft?.flight?.trim() || strip.callsign,
          squawk: liveAircraft?.squawk || strip.squawk,
          altitude:
            liveAircraft?.alt_baro || liveAircraft?.alt_geom || liveAircraft?.alt || strip.altitude,
          speed: liveAircraft?.gs || liveAircraft?.tas || strip.speed,
          verticalSpeed:
            liveAircraft?.vr || liveAircraft?.baro_rate || liveAircraft?.geom_rate || 0,
          track: liveAircraft?.track || liveAircraft?.true_heading || 0,
          // Status
          isLive: !!liveAircraft,
          isEmergency,
          isConflict,
          isWatched,
          // Timing
          timeInRange,
          timeSinceLastSeen,
          // Live data reference
          live: liveAircraft || null,
        };
      });
    },
    [strips]
  );

  // Auto-remove strips for aircraft that have left range
  const autoRemoveStaleStrips = useCallback(
    (aircraftList, maxStaleTime = 5 * 60 * 1000) => {
      if (!autoRemove) return;

      const now = Date.now();
      const liveHexes = new Set(aircraftList?.map((ac) => ac.hex?.toUpperCase()) || []);

      setStrips((prev) => {
        const newStrips = prev.filter((strip) => {
          // Keep if aircraft is still live
          if (liveHexes.has(strip.hex)) return true;

          // Check how long since we last saw it
          const lastSeen = lastSeenRef.current[strip.hex] || strip.addedAt;
          const staleTime = now - lastSeen;

          // Remove if stale for too long
          if (staleTime > maxStaleTime) {
            delete lastSeenRef.current[strip.hex];
            return false;
          }

          return true;
        });

        return newStrips.length !== prev.length ? newStrips : prev;
      });
    },
    [autoRemove]
  );

  return {
    // State
    strips,
    panelVisible,
    autoRemove,
    count: strips.length,

    // Drag state
    draggedIndex,
    dragOverIndex,

    // Strip actions
    addStrip,
    removeStrip,
    toggleStrip,
    hasStrip,
    updateNote,
    clearStrips,
    reorderStrips,

    // Drag handlers
    handleDragStart,
    handleDragOver,
    handleDragEnd,

    // Panel controls
    togglePanel,
    showPanel,
    hidePanel,
    setPanelVisible,

    // Settings
    toggleAutoRemove,
    setAutoRemove,

    // Data helpers
    getStripsWithLiveData,
    autoRemoveStaleStrips,

    // Audio initialization
    initializeAudio,
  };
}

export { getWakeCategory };
export default useFlightStrips;
