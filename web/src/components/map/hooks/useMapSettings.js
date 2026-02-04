import { useState, useCallback } from 'react';
import {
  getOverlays,
  saveOverlays,
  getLayerOpacities,
  saveLayerOpacities,
} from '../../../utils';

/**
 * @typedef {Object} TrafficFilters
 * @property {boolean} showMilitary
 * @property {boolean} showCivil
 * @property {boolean} showGround
 * @property {boolean} showAirborne
 * @property {number} minAltitude
 * @property {number} maxAltitude
 * @property {boolean} showWithSquawk
 * @property {boolean} showWithoutSquawk
 * @property {boolean} safetyEventsOnly
 * @property {boolean} showGA
 * @property {boolean} showAirliners
 */

/**
 * @typedef {Object} AcarsFilters
 * @property {boolean} hideEmpty
 * @property {'all' | 'acars' | 'vdlm2'} sourceFilter
 * @property {string} labelFilter
 * @property {string} callsignFilter
 */

/**
 * @typedef {Object} AirspaceTypeFilters
 * @property {boolean} B
 * @property {boolean} C
 * @property {boolean} D
 * @property {boolean} E
 * @property {boolean} MOA
 * @property {boolean} RESTRICTED
 * @property {boolean} WARNING
 * @property {boolean} PROHIBITED
 * @property {boolean} TFR
 * @property {boolean} ALERT
 */

const DEFAULT_TRAFFIC_FILTERS = {
  showMilitary: true,
  showCivil: true,
  showGround: false,
  showAirborne: true,
  minAltitude: 0,
  maxAltitude: 60000,
  showWithSquawk: true,
  showWithoutSquawk: true,
  safetyEventsOnly: false,
  showGA: true,
  showAirliners: true,
};

const DEFAULT_ACARS_FILTERS = {
  hideEmpty: true,
  sourceFilter: 'all',
  labelFilter: '',
  callsignFilter: '',
};

const DEFAULT_AIRSPACE_TYPE_FILTERS = {
  B: true,
  C: true,
  D: true,
  E: false,
  MOA: true,
  RESTRICTED: true,
  WARNING: true,
  PROHIBITED: true,
  TFR: true,
  ALERT: true,
};

const DEFAULT_WEATHER_ADVISORY_FILTERS = {
  IFR: true,
  TURB: true,
  ICE: true,
  TS: true,
  MT_OBSC: true,
  VOLCANIC_ASH: true,
  LLWS: true,
  SFC_WND: true,
  FZLVL: true,
};

const STORAGE_KEYS = {
  trafficFilters: 'adsb-traffic-filters',
  acarsFilters: 'adsb-acars-filters',
  airspaceTypeFilters: 'adsb-airspace-type-filters',
  weatherAdvisoryFilters: 'adsb-weather-advisory-filters',
  showAirspaceLabels: 'adsb-show-airspace-labels',
  soundMuted: 'adsb-sound-muted',
  showShortTracks: 'adsb-show-short-tracks',
};

/**
 * Load a persisted object from localStorage with defaults
 * @param {string} key
 * @param {Object} defaults
 * @returns {Object}
 */
function loadFromStorage(key, defaults) {
  try {
    const saved = localStorage.getItem(key);
    return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
  } catch {
    return defaults;
  }
}

/**
 * Load a boolean from localStorage
 * @param {string} key
 * @param {boolean} defaultValue
 * @returns {boolean}
 */
function loadBoolFromStorage(key, defaultValue) {
  try {
    const saved = localStorage.getItem(key);
    if (saved === null) return defaultValue;
    return saved === 'true';
  } catch {
    return defaultValue;
  }
}

/**
 * Save to localStorage safely
 * @param {string} key
 * @param {*} value
 */
function saveToStorage(key, value) {
  try {
    if (typeof value === 'object') {
      localStorage.setItem(key, JSON.stringify(value));
    } else {
      localStorage.setItem(key, String(value));
    }
  } catch {
    // localStorage unavailable
  }
}

/**
 * Hook to manage map settings state with localStorage persistence
 * Handles traffic filters, overlays, layer opacities, and audio settings
 */
export function useMapSettings() {
  // Traffic filters
  const [trafficFilters, setTrafficFiltersState] = useState(() =>
    loadFromStorage(STORAGE_KEYS.trafficFilters, DEFAULT_TRAFFIC_FILTERS)
  );

  // Overlay toggles (uses utility functions from config.js)
  const [overlays, setOverlaysState] = useState(getOverlays);

  // Layer opacities (uses utility functions from config.js)
  const [layerOpacities, setLayerOpacitiesState] = useState(getLayerOpacities);

  // ACARS filters
  const [acarsFilters, setAcarsFiltersState] = useState(() =>
    loadFromStorage(STORAGE_KEYS.acarsFilters, DEFAULT_ACARS_FILTERS)
  );

  // Airspace type filters
  const [airspaceTypeFilters, setAirspaceTypeFiltersState] = useState(() =>
    loadFromStorage(STORAGE_KEYS.airspaceTypeFilters, DEFAULT_AIRSPACE_TYPE_FILTERS)
  );

  // Weather advisory filters
  const [weatherAdvisoryFilters, setWeatherAdvisoryFiltersState] = useState(() =>
    loadFromStorage(STORAGE_KEYS.weatherAdvisoryFilters, DEFAULT_WEATHER_ADVISORY_FILTERS)
  );

  // Show airspace labels
  const [showAirspaceLabels, setShowAirspaceLabelsState] = useState(() =>
    loadBoolFromStorage(STORAGE_KEYS.showAirspaceLabels, true)
  );

  // Sound muted
  const [soundMuted, setSoundMutedState] = useState(() =>
    loadBoolFromStorage(STORAGE_KEYS.soundMuted, false)
  );

  // Show short tracks
  const [showShortTracks, setShowShortTracksState] = useState(() =>
    loadBoolFromStorage(STORAGE_KEYS.showShortTracks, false)
  );

  // Radar range (nm)
  const [radarRange, setRadarRange] = useState(50);

  // Setters with persistence

  const setTrafficFilters = useCallback((filters) => {
    const newFilters = typeof filters === 'function'
      ? filters(trafficFilters)
      : filters;
    setTrafficFiltersState(newFilters);
    saveToStorage(STORAGE_KEYS.trafficFilters, newFilters);
  }, [trafficFilters]);

  const setOverlays = useCallback((overlays) => {
    const newOverlays = typeof overlays === 'function'
      ? overlays(overlays)
      : overlays;
    setOverlaysState(newOverlays);
    saveOverlays(newOverlays);
  }, []);

  const setLayerOpacities = useCallback((opacities) => {
    const newOpacities = typeof opacities === 'function'
      ? opacities(layerOpacities)
      : opacities;
    setLayerOpacitiesState(newOpacities);
    saveLayerOpacities(newOpacities);
  }, [layerOpacities]);

  const setAcarsFilters = useCallback((filters) => {
    const newFilters = typeof filters === 'function'
      ? filters(acarsFilters)
      : filters;
    setAcarsFiltersState(newFilters);
    saveToStorage(STORAGE_KEYS.acarsFilters, newFilters);
  }, [acarsFilters]);

  const setAirspaceTypeFilters = useCallback((filters) => {
    const newFilters = typeof filters === 'function'
      ? filters(airspaceTypeFilters)
      : filters;
    setAirspaceTypeFiltersState(newFilters);
    saveToStorage(STORAGE_KEYS.airspaceTypeFilters, newFilters);
  }, [airspaceTypeFilters]);

  const setWeatherAdvisoryFilters = useCallback((filters) => {
    const newFilters = typeof filters === 'function'
      ? filters(weatherAdvisoryFilters)
      : filters;
    setWeatherAdvisoryFiltersState(newFilters);
    saveToStorage(STORAGE_KEYS.weatherAdvisoryFilters, newFilters);
  }, [weatherAdvisoryFilters]);

  const setShowAirspaceLabels = useCallback((value) => {
    setShowAirspaceLabelsState(value);
    saveToStorage(STORAGE_KEYS.showAirspaceLabels, value);
  }, []);

  const setSoundMuted = useCallback((value) => {
    setSoundMutedState(value);
    saveToStorage(STORAGE_KEYS.soundMuted, value);
  }, []);

  const setShowShortTracks = useCallback((value) => {
    setShowShortTracksState(value);
    saveToStorage(STORAGE_KEYS.showShortTracks, value);
  }, []);

  // Toggle a specific overlay
  const toggleOverlay = useCallback((name) => {
    setOverlays((prev) => {
      const next = { ...prev, [name]: !prev[name] };
      saveOverlays(next);
      return next;
    });
  }, [setOverlays]);

  // Toggle a traffic filter
  const toggleTrafficFilter = useCallback((name) => {
    setTrafficFilters((prev) => {
      const next = { ...prev, [name]: !prev[name] };
      saveToStorage(STORAGE_KEYS.trafficFilters, next);
      return next;
    });
  }, [setTrafficFilters]);

  // Toggle sound
  const toggleSound = useCallback(() => {
    setSoundMuted((prev) => !prev);
  }, [setSoundMuted]);

  // Reset traffic filters to defaults
  const resetTrafficFilters = useCallback(() => {
    setTrafficFilters(DEFAULT_TRAFFIC_FILTERS);
  }, [setTrafficFilters]);

  return {
    // Traffic filters
    trafficFilters,
    setTrafficFilters,
    toggleTrafficFilter,
    resetTrafficFilters,

    // Overlays
    overlays,
    setOverlays,
    toggleOverlay,

    // Layer opacities
    layerOpacities,
    setLayerOpacities,

    // ACARS filters
    acarsFilters,
    setAcarsFilters,

    // Airspace type filters
    airspaceTypeFilters,
    setAirspaceTypeFilters,

    // Weather advisory filters
    weatherAdvisoryFilters,
    setWeatherAdvisoryFilters,

    // Airspace labels
    showAirspaceLabels,
    setShowAirspaceLabels,

    // Sound
    soundMuted,
    setSoundMuted,
    toggleSound,

    // Short tracks
    showShortTracks,
    setShowShortTracks,

    // Radar range
    radarRange,
    setRadarRange,
  };
}

export default useMapSettings;
