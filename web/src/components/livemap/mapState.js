/**
 * Live Map filter + overlay state (pure). Traffic filters gate which aircraft
 * the canvas draws; overlay toggles gate Leaflet/canvas layers. Persisted to
 * localStorage so the operator's map setup survives reloads.
 */

import { altitudeOf, categoryOf } from './render/symbology';
import { FILTER_TESTS } from '../v2/screens/list/listModel';

const FILTER_KEY = 'skyspy-lm-filters';
const OVERLAY_KEY = 'skyspy-lm-overlays';

export const DEFAULT_FILTERS = {
  showMilitary: true,
  showCivil: true,
  showAirborne: true,
  showGround: true,
  showWithSquawk: true,
  showWithoutSquawk: true,
  minAltitude: 0,
  maxAltitude: 60000,
  quick: null, // one of listModel FILTER_TESTS keys, or null
};

export const DEFAULT_OVERLAYS = {
  rangeRings: true,
  trails: false,
  weatherRadar: false,
  airspace: false,
  navaids: false,
  airports: false,
  notams: false,
  pireps: false,
  showGhosts: false, // reveal non-ICAO (~) TIS-B/ADS-R duplicate tracks (hidden by default)
  // display prefs (persisted alongside overlays)
  trailSeconds: 300, // trail history window / length
  colorMode: 'category', // 'category' | 'altitude'
  showPredictor: true, // curved velocity/turn-rate predictor
  predictorSeconds: 60, // predictor look-ahead horizon
  showLeaders: true, // data-block leader lines
  showCoast: true, // coast markers for stale targets
};

export const TRAIL_LENGTH_OPTIONS = [
  { value: 30, label: '30s' },
  { value: 60, label: '1m' },
  { value: 120, label: '2m' },
  { value: 300, label: '5m' },
  { value: 600, label: '10m' },
];

export const PREDICTOR_LENGTH_OPTIONS = [
  { value: 30, label: '30s' },
  { value: 60, label: '1m' },
  { value: 120, label: '2m' },
];

export const QUICK_CHIPS = [
  { key: 'emergency', label: 'Emergency', color: 'var(--danger)' },
  { key: 'military', label: 'Military', color: 'var(--mil)' },
  { key: 'climbing', label: 'Climbing', color: 'var(--accent)' },
  { key: 'descending', label: 'Descending', color: 'var(--warn)' },
  { key: 'ground', label: 'On Ground', color: 'var(--dim)' },
  { key: 'highalt', label: 'High Alt', color: 'var(--accent2)' },
  { key: 'lowalt', label: 'Low Alt', color: 'var(--warn)' },
];

export const OVERLAY_DEFS = [
  { key: 'rangeRings', label: 'Range Rings' },
  { key: 'trails', label: 'Aircraft Trails' },
  { key: 'weatherRadar', label: 'Weather Radar' },
  { key: 'airspace', label: 'Airspace' },
  { key: 'navaids', label: 'Navaids (VOR/NDB)' },
  { key: 'airports', label: 'Airports' },
  { key: 'notams', label: 'NOTAMs / TFRs' },
  { key: 'pireps', label: 'PIREPs' },
  { key: 'showGhosts', label: 'Ghost Tracks (TIS-B/ADS-R)' },
];

function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v && typeof v === 'object' ? { ...fallback, ...v } : fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // best-effort persistence
  }
}

export const loadFilters = () => load(FILTER_KEY, DEFAULT_FILTERS);
export const saveFilters = (f) => save(FILTER_KEY, f);
export const loadOverlays = () => load(OVERLAY_KEY, DEFAULT_OVERLAYS);
export const saveOverlays = (o) => save(OVERLAY_KEY, o);

/**
 * Build a predicate from the current filter state.
 * @param {typeof DEFAULT_FILTERS} f
 * @returns {(a: object) => boolean}
 */
export function makeFilterFn(f) {
  const quickTest = f.quick && FILTER_TESTS[f.quick] ? FILTER_TESTS[f.quick] : null;
  return (a) => {
    if (quickTest && !quickTest(a)) return false;
    const cat = categoryOf(a);
    if (cat === 'military' && !f.showMilitary) return false;
    if (cat !== 'military' && !f.showCivil) return false;
    const alt = altitudeOf(a);
    const airborne = alt > 0;
    if (airborne && !f.showAirborne) return false;
    if (!airborne && !f.showGround) return false;
    const hasSquawk = !!a.squawk;
    if (hasSquawk && !f.showWithSquawk) return false;
    if (!hasSquawk && !f.showWithoutSquawk) return false;
    if (airborne && (alt < f.minAltitude || alt > f.maxAltitude)) return false;
    return true;
  };
}

/** True when filters differ from defaults (to badge the Filters button). */
export function filtersActive(f) {
  return (
    !f.showMilitary ||
    !f.showCivil ||
    !f.showAirborne ||
    !f.showGround ||
    !f.showWithSquawk ||
    !f.showWithoutSquawk ||
    f.minAltitude > 0 ||
    f.maxAltitude < 60000 ||
    !!f.quick
  );
}

/** Count of enabled non-default overlays (for the Layers button badge). */
export function overlaysActiveCount(o) {
  return OVERLAY_DEFS.reduce((n, d) => n + (o[d.key] && d.key !== 'rangeRings' ? 1 : 0), 0);
}
