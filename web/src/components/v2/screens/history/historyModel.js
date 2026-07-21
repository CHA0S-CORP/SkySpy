/**
 * Pure model for the v2 History screen. Maps /api/v1/sessions records
 * (icao_hex, callsign, first_seen, last_seen, duration_min, positions,
 * min/max_alt, min/max_distance_nm, max_vr, max_rssi, is_military, category,
 * type) onto the design's session-card shape, plus KPI/activity derivations.
 */

import { barsFromRssi } from '../list/listModel';

const AIRLINE_PREFIXES = {
  AAL: 'American',
  UAL: 'United',
  DAL: 'Delta',
  ASA: 'Alaska',
  SWA: 'Southwest',
  FFT: 'Frontier',
  UPS: 'UPS',
  FDX: 'FedEx',
  WJA: 'WestJet',
  SKW: 'SkyWest',
  CMP: 'Copa',
  VOI: 'Volaris',
  JBU: 'JetBlue',
  NKS: 'Spirit',
};

export function categoryOfSession(s) {
  if (s.is_military) return 'military';
  if (['A1', 'A2', 'A7', 'B1', 'B2', 'B4', 'B6'].includes(s.category)) return 'ga';
  return 'commercial';
}

export function airlineOf(s) {
  const cs = (s.callsign || '').trim().toUpperCase();
  const byPrefix = AIRLINE_PREFIXES[cs.slice(0, 3)];
  if (byPrefix) return byPrefix;
  if (categoryOfSession(s) === 'military') return 'Military';
  return 'General Aviation';
}

export const SESSION_CATEGORY_COLORS = {
  commercial: 'var(--accent)',
  military: 'var(--mil)',
  ga: 'var(--accent2)',
};

function fmtClock(iso) {
  return iso ? new Date(iso).toLocaleTimeString() : '—';
}

/**
 * Format a sighting lat/lon pair as a compact coordinate string, or null when
 * either value is absent (position is optional on a sighting record).
 * @param {number|null|undefined} lat
 * @param {number|null|undefined} lon
 * @returns {string|null}
 */
export function fmtCoord(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

/**
 * Format ground speed + track heading for a sighting row, e.g. "180 kt @ 045°".
 * Either half is optional: renders whichever fields are present, null when neither.
 * @param {number|null|undefined} gs - ground speed in knots
 * @param {number|null|undefined} track - heading in degrees (0..359.9)
 * @returns {string|null}
 */
export function fmtSpeedTrack(gs, track) {
  const hasGs = typeof gs === 'number' && Number.isFinite(gs);
  const hasTrack = typeof track === 'number' && Number.isFinite(track);
  const speed = hasGs ? `${Math.round(gs)} kt` : '';
  const heading = hasTrack ? `@ ${String(Math.round(track) % 360).padStart(3, '0')}°` : '';
  const out = [speed, heading].filter(Boolean).join(' ');
  return out || null;
}

/**
 * Derive one session card (mock card shape).
 * @param {object} s session record
 * @param {Map<string, number>} [safetyByHex] - safety event counts per icao_hex
 */
export function toSessionCard(s, safetyByHex) {
  const cat = categoryOfSession(s);
  const cc = SESSION_CATEGORY_COLORS[cat];
  const barCount = barsFromRssi(s.max_rssi);
  const barColor =
    barCount >= 3 ? 'var(--accent)' : barCount === 2 ? 'var(--warn)' : 'var(--danger)';
  const bars = [6, 9, 12, 15].map((h, i) => ({
    h,
    color: i < barCount ? barColor : 'var(--bord2)',
  }));
  const maxAlt = s.max_alt ?? s.max_altitude ?? 0;
  const altK = Math.round(maxAlt / 1000);
  const vr = s.max_vr ?? s.max_vertical_rate;
  const safety = safetyByHex?.get((s.icao_hex || '').toUpperCase()) ?? 0;
  return {
    key: s.id ?? `${s.icao_hex}-${s.first_seen}`,
    hex: (s.icao_hex || '').toUpperCase(),
    cs: (s.callsign || '').trim() || (s.icao_hex || '').toUpperCase(),
    type: s.type || s.aircraft_type || '--',
    cat,
    dur: Math.round(s.duration_min ?? 0),
    altk: `${altK}k`,
    altPct: Math.max(4, Math.min(100, (altK / 45) * 100)),
    dMin: typeof s.min_distance_nm === 'number' ? s.min_distance_nm.toFixed(1) : '--',
    dMax: typeof s.max_distance_nm === 'number' ? s.max_distance_nm.toFixed(1) : '--',
    vs: typeof vr === 'number' ? (vr > 0 ? `+${vr}` : String(vr)) : '--',
    msg: s.positions ?? s.total_positions ?? 0,
    sqk: s.squawk || '--',
    sqkColor: 'var(--dim2)',
    first: fmtClock(s.first_seen),
    last: fmtClock(s.last_seen),
    bars,
    db: typeof s.max_rssi === 'number' ? Math.round(s.max_rssi) : '--',
    dbMin: typeof s.min_rssi === 'number' ? Math.round(s.min_rssi) : null,
    hasSafety: safety > 0,
    safety,
    accent: safety > 0 ? 'var(--warn)' : cc,
    typeFg: cc,
  };
}

/**
 * Filter + sort sessions (mock semantics).
 */
export function selectSessions(
  sessions,
  {
    query = '',
    cat = 'All category',
    type = 'All types',
    airline = 'All airlines',
    mil = false,
    safe = false,
    fav = false,
    sortBy = 'time',
    sortDir = 'desc',
  } = {},
  safetyByHex,
  favoriteHexes
) {
  let list = sessions.slice();
  const q = query.trim().toLowerCase();
  if (q) {
    list = list.filter((s) =>
      `${s.callsign || ''}${s.icao_hex || ''}${s.type || s.aircraft_type || ''}`
        .toLowerCase()
        .includes(q)
    );
  }
  if (cat !== 'All category') {
    const key = cat.toLowerCase() === 'ga' ? 'ga' : cat.toLowerCase();
    list = list.filter((s) => categoryOfSession(s) === key);
  }
  if (type !== 'All types') list = list.filter((s) => (s.type || s.aircraft_type) === type);
  if (airline !== 'All airlines') list = list.filter((s) => airlineOf(s) === airline);
  if (mil) list = list.filter((s) => categoryOfSession(s) === 'military');
  if (safe && safetyByHex)
    list = list.filter((s) => (safetyByHex.get((s.icao_hex || '').toUpperCase()) ?? 0) > 0);
  if (fav && favoriteHexes)
    list = list.filter((s) => favoriteHexes.has((s.icao_hex || '').toUpperCase()));

  const kf =
    {
      time: (s) => new Date(s.last_seen || 0).getTime(),
      callsign: (s) => (s.callsign || '').trim(),
      type: (s) => s.type || s.aircraft_type || '',
      duration: (s) => s.duration_min ?? 0,
      distance: (s) => s.max_distance_nm ?? 0,
      signal: (s) => s.max_rssi ?? -99,
      altitude: (s) => s.max_alt ?? s.max_altitude ?? 0,
      safety: (s) => safetyByHex?.get((s.icao_hex || '').toUpperCase()) ?? 0,
    }[sortBy] || ((s) => new Date(s.last_seen || 0).getTime());

  list.sort((x, y) => {
    const a = kf(x);
    const b = kf(y);
    const r =
      typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
    return sortDir === 'asc' ? r : -r;
  });
  return list;
}

/** KPI strip values. */
export function historyKpis(sessions, safetyCount) {
  const aircraft = new Set(sessions.map((s) => s.icao_hex)).size;
  const durations = sessions.map((s) => s.duration_min ?? 0).filter((d) => d > 0);
  const avgDur = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;
  const maxRange = sessions.reduce((m, s) => Math.max(m, s.max_distance_nm ?? 0), 0);
  return {
    sessions: sessions.length,
    aircraft,
    avgDur,
    maxRange: Math.round(maxRange),
    safety: safetyCount,
  };
}

/**
 * Rows for the History Stats summary panel, derived from the
 * /api/v1/history/stats response. Only rows whose backing field is present in
 * the payload are returned (payloads are frequently partial). Each row is
 * `{ label, value, unit? }` with value pre-formatted for display.
 *
 * @param {object|undefined} stats history/stats payload
 * @returns {Array<{label: string, value: string|number, unit?: string}>}
 */
export function historyStatRows(stats) {
  if (!stats || typeof stats !== 'object') return [];
  const rows = [];
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  const push = (field, label, unit) => {
    if (num(stats[field])) rows.push({ label, value: stats[field], unit });
  };
  push('total_sightings', 'TOTAL SIGHTINGS');
  push('total_sessions', 'TOTAL SESSIONS');
  push('unique_aircraft', 'UNIQUE AIRCRAFT');
  push('military_sessions', 'MILITARY SESSIONS');
  push('avg_altitude', 'AVG ALTITUDE', 'ft');
  push('max_altitude', 'MAX ALTITUDE', 'ft');
  push('min_altitude', 'MIN ALTITUDE', 'ft');
  push('avg_distance_nm', 'AVG DISTANCE', 'nm');
  push('max_distance_nm', 'MAX DISTANCE', 'nm');
  push('avg_speed', 'AVG SPEED', 'kt');
  push('max_speed', 'MAX SPEED', 'kt');
  return rows;
}

/**
 * 48-bin activity histogram over the window from session first_seen times.
 * @returns {Array<{h: number, recent: boolean}>}
 */
export function activityBins(sessions, windowHours) {
  const bins = new Array(48).fill(0);
  const now = Date.now();
  const windowMs = windowHours * 3600 * 1000;
  for (const s of sessions) {
    const t = new Date(s.first_seen || s.last_seen || 0).getTime();
    const age = now - t;
    if (age < 0 || age > windowMs) continue;
    const idx = 47 - Math.min(47, Math.floor((age / windowMs) * 48));
    bins[idx] += 1;
  }
  const peak = Math.max(...bins, 1);
  return bins.map((v, i) => ({
    h: Math.max(4, Math.round((v / peak) * 100)),
    recent: i > 40,
    count: v,
    peak,
  }));
}
