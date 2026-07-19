/**
 * Live Map filter + overlay state (pure). Traffic filters gate which aircraft
 * the canvas draws; overlay toggles gate Leaflet/canvas layers. Persisted to
 * localStorage so the operator's map setup survives reloads.
 */

import { altitudeOf, categoryOf, AIRSPACE_CLASSES } from './render/symbology';
import { FILTER_TESTS } from '../v2/screens/list/listModel';

/** Default per-class airspace visibility (all on). */
export const DEFAULT_AIRSPACE_CLASSES = Object.fromEntries(
  AIRSPACE_CLASSES.map((c) => [c.key, true])
);

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
  airspaceClasses: DEFAULT_AIRSPACE_CLASSES, // per-class visibility when airspace is on
  navaids: false,
  airports: false,
  notams: false,
  pireps: false,
  airmets: false, // G-AIRMET/AIRMET hazard polygons (turbulence, icing, IFR, etc.)
  wildfires: false, // Watch Duty active-fire markers
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

// `feature` (optional) RBAC-gates a layer toggle: it is hidden unless the user
// can read that FeatureAccess feature (weather / wildfires). Ungated toggles
// always show. canAccessFeature() returns true in public/dev mode, so this is a
// no-op there.
export const OVERLAY_DEFS = [
  { key: 'rangeRings', label: 'Range Rings' },
  { key: 'trails', label: 'Aircraft Trails' },
  { key: 'weatherRadar', label: 'Weather Radar', feature: 'weather' },
  { key: 'airspace', label: 'Airspace' },
  { key: 'navaids', label: 'Navaids (VOR/NDB)' },
  { key: 'airports', label: 'Airports' },
  { key: 'notams', label: 'NOTAMs / TFRs' },
  { key: 'pireps', label: 'PIREPs', feature: 'weather' },
  { key: 'airmets', label: 'AIRMETs', feature: 'weather' },
  { key: 'wildfires', label: 'Wildfires', feature: 'wildfires' },
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

const EMERGENCY_SQUAWKS = new Set(['7500', '7600', '7700']);

function distanceNm(a, feeder) {
  if (typeof a.distance_nm === 'number') return a.distance_nm;
  if (!feeder || typeof a.lat !== 'number' || typeof a.lon !== 'number') return null;
  const dLat = a.lat - feeder.lat;
  const dLon = a.lon - feeder.lon;
  const nmY = dLat * 60;
  const nmX = dLon * 60 * Math.cos((feeder.lat * Math.PI) / 180);
  return Math.sqrt(nmX * nmX + nmY * nmY);
}

/**
 * Build a predicate from an assistant radar-filter match spec (mirrors the
 * backend `_match_live_aircraft`). Every present key is an AND condition. This
 * is what makes the docked assistant's "show all GA / LE / military / emergency"
 * requests live-filter the radar, re-evaluated as aircraft update.
 *
 * @param {object|null} match - { hexes?, military?, emergency?, ga?, categories?, types?, callsigns?, callsignPrefix?, altMin?, altMax?, distMax? }
 * @param {{lat:number,lon:number}|null} [feeder] - for distMax when aircraft lack distance
 * @returns {((a: object) => boolean)|null} null when there is no match spec
 */
export function makeRadarMatchFn(match, feeder = null) {
  if (!match || typeof match !== 'object' || !Object.keys(match).length) return null;
  const hexes = match.hexes ? new Set(match.hexes.map((h) => String(h).toUpperCase())) : null;
  const cats = match.categories
    ? new Set(match.categories.map((c) => String(c).toUpperCase()))
    : null;
  const types = match.types ? new Set(match.types.map((t) => String(t).toUpperCase())) : null;
  const calls = match.callsigns
    ? new Set(match.callsigns.map((c) => String(c).toUpperCase()))
    : null;
  const prefixes = match.callsignPrefix
    ? match.callsignPrefix.map((p) => String(p).toUpperCase())
    : null;

  return (a) => {
    if (hexes && !hexes.has(String(a.hex || '').toUpperCase())) return false;
    if (typeof match.military === 'boolean') {
      const isMil = categoryOf(a) === 'military';
      if (isMil !== match.military) return false;
    }
    if (match.emergency) {
      const sq = String(a.squawk || '');
      if (!(a.emergency || EMERGENCY_SQUAWKS.has(sq))) return false;
    }
    if (match.ga && categoryOf(a) !== 'ga') return false;
    if (cats && !cats.has(String(a.category || '').toUpperCase())) return false;
    const typ = String(a.t || a.type || '').toUpperCase();
    if (types && !types.has(typ)) return false;
    if (
      match.typePrefixes &&
      !match.typePrefixes.some((p) => typ.startsWith(String(p).toUpperCase()))
    )
      return false;
    // Fuzzy class: category-match OR type-prefix-match against any listed condition.
    if (match.anyOf) {
      const cat = String(a.category || '').toUpperCase();
      const ok = match.anyOf.some(
        (c) =>
          (c.cat && cat === String(c.cat).toUpperCase()) ||
          (c.tp && typ.startsWith(String(c.tp).toUpperCase()))
      );
      if (!ok) return false;
    }
    const cs = String(a.flight || a.callsign || '')
      .trim()
      .toUpperCase();
    if (calls && !calls.has(cs)) return false;
    if (prefixes && !prefixes.some((p) => cs.startsWith(p))) return false;
    if (match.altMin != null || match.altMax != null) {
      const alt = altitudeOf(a);
      if (match.altMax != null && alt > match.altMax) return false;
      if (match.altMin != null && alt < match.altMin) return false;
    }
    if (match.distMax != null) {
      const d = distanceNm(a, feeder);
      if (d == null || d > match.distMax) return false;
    }
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
