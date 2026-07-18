/**
 * Pure data model for the v2 Aircraft List screen.
 * Maps the live socket aircraft payload (hex/flight/alt/gs/track/vr/rssi/squawk/…)
 * onto the design's row shape, and implements the mock's filter/sort/search logic.
 */

export const EMERGENCY_SQUAWKS = ['7500', '7600', '7700'];

/** @param {object} a - socket aircraft entry */
export function altitudeOf(a) {
  const alt = a.alt ?? a.alt_baro ?? a.alt_geom;
  return typeof alt === 'number' ? alt : 0; // 'ground' → 0
}

/** @param {object} a */
export function isAirborne(a) {
  return altitudeOf(a) > 0;
}

/**
 * Design category: commercial | military | ga.
 * @param {object} a
 */
export function categoryOf(a) {
  if (a.military) return 'military';
  // ADS-B emitter categories A1/A2 = light/small aircraft; rotorcraft A7
  if (['A1', 'A2', 'A7', 'B1', 'B2', 'B4', 'B6'].includes(a.category)) return 'ga';
  return 'commercial';
}

export const CATEGORY_COLORS = {
  commercial: 'var(--accent)',
  military: 'var(--mil)',
  ga: 'var(--accent2)',
};

/**
 * Signal strength 1..4 bars from RSSI (readsb-style dBFS, ~0 strong … -35 weak).
 * @param {number|undefined} rssi
 */
export function barsFromRssi(rssi) {
  if (typeof rssi !== 'number') return 1;
  if (rssi >= -10) return 4;
  if (rssi >= -18) return 3;
  if (rssi >= -26) return 2;
  return 1;
}

const COMPASS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
];

/** @param {number} track degrees */
export function compassDir(track) {
  return COMPASS[Math.round((track || 0) / 22.5) % 16];
}

/** Chip filter predicates (from the mock's `tests`). */
export const FILTER_TESTS = {
  emergency: (a) => EMERGENCY_SQUAWKS.includes(a.squawk) || a.emergency === true,
  military: (a) => categoryOf(a) === 'military',
  climbing: (a) => (a.vr ?? 0) > 0,
  descending: (a) => (a.vr ?? 0) < 0,
  ground: (a) => !isAirborne(a),
  interesting: (a) => categoryOf(a) === 'military' || EMERGENCY_SQUAWKS.includes(a.squawk),
  highalt: (a) => altitudeOf(a) >= 10000,
  lowalt: (a) => altitudeOf(a) > 0 && altitudeOf(a) < 2000,
  strong: (a) => barsFromRssi(a.rssi) >= 3,
  weak: (a) => barsFromRssi(a.rssi) <= 2,
};

export const CHIP_DEFS = [
  { key: 'emergency', label: 'Emergency', dot: 'var(--danger)', hasCount: false },
  { key: 'military', label: 'Military', dot: 'var(--mil)', hasCount: true },
  { key: 'climbing', label: 'Climbing', dot: 'var(--accent)', hasCount: true },
  { key: 'descending', label: 'Descending', dot: 'var(--warn)', hasCount: true },
  { key: 'ground', label: 'On Ground', dot: 'var(--dim)', hasCount: true },
  { key: 'interesting', label: 'Interesting', dot: 'var(--accent2)', hasCount: true },
  { key: 'highalt', label: 'High Alt', dot: 'var(--accent2)', hasCount: true },
  { key: 'lowalt', label: 'Low Alt', dot: 'var(--warn)', hasCount: true },
  { key: 'strong', label: 'Strong Signal', dot: 'var(--accent)', hasCount: true },
  { key: 'weak', label: 'Weak Signal', dot: 'var(--dim)', hasCount: true },
];

export const COLUMNS = [
  { key: 'icao', label: 'ICAO' },
  { key: 'cs', label: 'Callsign' },
  { key: 'type', label: 'Type' },
  { key: 'alt', label: 'Altitude' },
  { key: 'spd', label: 'Speed' },
  { key: 'vs', label: 'V/S' },
  { key: 'hdg', label: 'Heading' },
  { key: 'dist', label: 'Distance' },
  { key: 'sig', label: 'Signal' },
  { key: 'sqk', label: 'Squawk' },
];

const SORT_KEYS = {
  icao: (a) => a.hex || '',
  cs: (a) => (a.flight || '').trim(),
  type: (a) => a.t || '',
  alt: (a) => altitudeOf(a),
  spd: (a) => a.gs ?? 0,
  vs: (a) => a.vr ?? 0,
  hdg: (a) => a.track ?? 0,
  dist: (a) => a.distance_nm ?? Infinity,
  sig: (a) => barsFromRssi(a.rssi),
  sqk: (a) => a.squawk || '',
};

/**
 * Filter + search + sort the live aircraft array.
 * @param {object[]} aircraft
 * @param {{query?: string, filter?: string|null, sortBy?: string, sortDir?: 'asc'|'desc'}} opts
 */
export function selectAircraft(
  aircraft,
  { query = '', filter = null, sortBy = 'dist', sortDir = 'asc' } = {}
) {
  let list = aircraft.slice();
  const q = query.trim().toLowerCase();
  if (q) {
    list = list.filter((a) =>
      `${a.hex || ''}${a.flight || ''}${a.t || ''}${a.squawk || ''}${a.r || ''}`
        .toLowerCase()
        .includes(q)
    );
  }
  if (filter && FILTER_TESTS[filter]) list = list.filter(FILTER_TESTS[filter]);
  const kf = SORT_KEYS[sortBy] || SORT_KEYS.dist;
  list.sort((x, y) => {
    const a = kf(x);
    const b = kf(y);
    const r =
      typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
    return sortDir === 'asc' ? r : -r;
  });
  return list;
}

/**
 * Derive the display row (mock renderVals row shape) for one aircraft.
 * @param {object} a
 */
export function toRow(a) {
  const alt = altitudeOf(a);
  const air = alt > 0;
  const cat = categoryOf(a);
  const cc = CATEGORY_COLORS[cat];
  const barCount = barsFromRssi(a.rssi);
  const barColor =
    barCount >= 3 ? 'var(--accent)' : barCount === 2 ? 'var(--warn)' : 'var(--danger)';
  const bars = [7, 10, 13, 16].map((h, i) => ({
    h,
    color: i < barCount ? barColor : 'var(--bord2)',
  }));
  const vr = a.vr ?? null;
  let vsDisp = '—';
  let vsColor = 'var(--dim2)';
  if (vr > 0) {
    vsDisp = `↑ +${vr}`;
    vsColor = 'var(--accent)';
  } else if (vr < 0) {
    vsDisp = `↓ ${vr}`;
    vsColor = 'var(--warn)';
  }
  const emerg = EMERGENCY_SQUAWKS.includes(a.squawk) || a.emergency === true;
  const track = Math.round(a.track ?? 0);
  // Registration / tail number (tar1090 `r`, normalizer aliases to `registration`).
  // Delivered by the live stream but previously only searchable — surface it as a
  // secondary line under the callsign when present and distinct from the callsign.
  const tail = (a.r || a.registration || '').trim() || null;
  const cs = (a.flight || '').trim() || '--';
  // Operator / owner-operator (normalizer aliases owner_operator → ownOp).
  // Delivered by the live stream when the feeder provides it; render as a
  // secondary line under the callsign, distinct from the registration tail.
  const operator = (a.ownOp || '').trim() || null;
  // Full type name (normalizer aliases description → desc), e.g. "Airbus A321neo".
  // Surface as the Type-column title/tooltip and a secondary line when present.
  const typeFull = (a.desc || '').trim() || null;
  // Build year (normalizer aliases to `year`; fall back to backend `year_built`).
  const yearBuilt = a.year ?? a.year_built ?? null;
  return {
    hex: a.hex,
    icao: (a.hex || '').toUpperCase(),
    cs,
    tail: tail && tail.toUpperCase() !== cs.toUpperCase() ? tail : null,
    operator,
    typeFull,
    year: typeof yearBuilt === 'number' || typeof yearBuilt === 'string' ? String(yearBuilt) : null,
    type: a.t || '--',
    isMil: cat === 'military',
    accent: air ? cc : 'transparent',
    icaoColor: air ? 'var(--txt)' : 'var(--dim)',
    csColor: air ? cc : 'var(--dim)',
    altDisp: air ? alt.toLocaleString('en-US') : 'ground',
    altUnit: air ? 'ft' : '',
    altColor: air ? 'var(--txt)' : 'var(--dim2)',
    spd: Math.round(a.gs ?? 0),
    spdColor: air ? 'var(--txt)' : 'var(--dim2)',
    vsDisp,
    vsColor,
    hdgDisp: `${track}°`,
    hdgDir: compassDir(track),
    dist: typeof a.distance_nm === 'number' ? a.distance_nm.toFixed(1) : '--',
    bars,
    sigColor: barColor,
    sqk: a.squawk || '--',
    sqkColor: emerg ? 'var(--danger)' : a.squawk ? 'var(--txt)' : 'var(--dim2)',
  };
}
