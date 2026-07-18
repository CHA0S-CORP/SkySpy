/**
 * Pure derivations for the v2 Aircraft Detail screen: flight-status pill,
 * trend sublines, schematic track projection, mini-graph polylines,
 * transponder log, external links.
 */

import { altitudeOf, compassDir, EMERGENCY_SQUAWKS } from '../list/listModel';

/** Flight-status pill from the live aircraft state. */
export function flightStatus(live) {
  if (!live) return { label: 'NOT TRACKING', color: 'var(--dim2)' };
  const alt = altitudeOf(live);
  const vr = live.vr ?? 0;
  if (alt <= 0) return { label: 'ON GROUND', color: 'var(--dim)' };
  if (EMERGENCY_SQUAWKS.includes(live.squawk))
    return { label: 'EMERGENCY', color: 'var(--danger)' };
  if (vr < -300 && alt < 4000) return { label: 'ON APPROACH', color: 'var(--accent)' };
  if (vr > 300) return { label: 'CLIMBING', color: 'var(--accent)' };
  if (vr < -300) return { label: 'DESCENDING', color: 'var(--warn)' };
  return { label: 'CRUISING', color: 'var(--accent2)' };
}

/** Trend subline for the stat strip (compares last two track samples). */
export function trendOf(points, key, { upLabel, downLabel, flatLabel }) {
  if (!points || points.length < 2) return { dir: 0, label: flatLabel };
  const a = points[points.length - 2]?.[key];
  const b = points[points.length - 1]?.[key];
  if (typeof a !== 'number' || typeof b !== 'number' || a === b)
    return { dir: 0, label: flatLabel };
  return b > a ? { dir: 1, label: upLabel } : { dir: -1, label: downLabel };
}

/**
 * Project lat/lon track points into a 0..100 viewBox polyline (schematic map).
 * Returns { points: 'x,y ...', at(frac): {x, y, deg} } or null when too short.
 */
export function projectTrack(points) {
  const pts = (points || []).filter((p) => typeof p.lat === 'number' && typeof p.lon === 'number');
  if (pts.length < 2) return null;
  const lats = pts.map((p) => p.lat);
  const lons = pts.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const latSpan = maxLat - minLat || 1e-6;
  const lonSpan = maxLon - minLon || 1e-6;
  const pad = 8;
  const toXY = (p) => ({
    x: pad + ((p.lon - minLon) / lonSpan) * (100 - pad * 2),
    y: pad + (1 - (p.lat - minLat) / latSpan) * (100 - pad * 2),
  });
  const xy = pts.map(toXY);
  const polyline = xy.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const at = (frac) => {
    const f = Math.max(0, Math.min(1, frac));
    const idx = Math.min(xy.length - 1, Math.max(0, Math.round(f * (xy.length - 1))));
    const cur = xy[idx];
    const next = xy[Math.min(xy.length - 1, idx + 1)] || cur;
    const deg = (Math.atan2(next.x - cur.x, cur.y - next.y) * 180) / Math.PI;
    return { x: cur.x, y: cur.y, deg, index: idx };
  };
  return { points: polyline, at, count: pts.length };
}

/**
 * Mini-graph polyline for a 160×46 viewBox from track samples.
 * Returns { points, min, max } or null.
 */
export function miniSeries(points, key) {
  const vals = (points || []).map((p) => p[key]).filter((v) => typeof v === 'number');
  if (vals.length < 2) return null;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const pts = vals
    .map(
      (v, i) =>
        `${((i / (vals.length - 1)) * 160).toFixed(1)},${(42 - ((v - min) / span) * 36 + 2).toFixed(1)}`
    )
    .join(' ');
  return { points: pts, min: Math.round(min), max: Math.round(max) };
}

/** Transponder log rows from track samples (newest first, squawk/alt milestones). */
export function transponderLog(points, limit = 5) {
  const rows = [];
  const pts = points || [];
  let lastSquawk = null;
  for (const p of pts) {
    if (p.squawk && p.squawk !== lastSquawk) {
      rows.push({
        t: p.timestamp,
        msg: `Squawk ${lastSquawk ? 'changed to' : 'reporting'} ${p.squawk}`,
      });
      lastSquawk = p.squawk;
    }
  }
  const step = Math.max(1, Math.floor(pts.length / 3));
  for (let i = pts.length - 1; i >= 0 && rows.length < limit + 2; i -= step) {
    const p = pts[i];
    if (typeof p.altitude === 'number') {
      rows.push({
        t: p.timestamp,
        msg: `Position report · ${p.altitude.toLocaleString('en-US')} ft${p.gs != null ? ` · ${Math.round(p.gs)} kts` : ''}`,
      });
    }
  }
  return rows
    .sort((a, b) => new Date(b.t || 0) - new Date(a.t || 0))
    .slice(0, limit)
    .map((r) => ({
      ...r,
      t: r.t ? new Date(r.t).toLocaleTimeString('en-US', { hour12: false }) : '—',
    }));
}

/** External tracker links from identity. */
export function externalLinks({ hex, callsign, registration }) {
  const cs = (callsign || '').trim();
  return [
    cs && { label: 'FlightAware', href: `https://www.flightaware.com/live/flight/${cs}` },
    hex && { label: 'ADSBexchange', href: `https://globe.adsbexchange.com/?icao=${hex}` },
    (registration || cs) && {
      label: 'Flightradar24',
      href: `https://www.flightradar24.com/data/aircraft/${(registration || cs).toLowerCase()}`,
    },
    registration && {
      label: 'Planespotters',
      href: `https://www.planespotters.net/search?q=${registration}`,
    },
  ].filter(Boolean);
}

/**
 * Convert an ISO 3166-1 alpha-2 country code to its flag emoji by mapping each
 * ASCII letter to its Unicode regional-indicator symbol (A=0x1F1E6 … Z=0x1F1FF),
 * e.g. "US" -> "🇺🇸". Case-insensitive. Returns '' unless `code` is exactly two
 * A–Z letters, so absent/invalid codes render nothing.
 *
 * @param {string|null|undefined} code - ISO 3166-1 alpha-2 country code.
 * @returns {string} the flag emoji, or '' when the code is absent/invalid.
 */
export function countryCodeToFlag(code) {
  if (typeof code !== 'string') return '';
  const cc = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return '';
  const base = 0x1f1e6; // regional indicator symbol letter A
  return String.fromCodePoint(base + (cc.charCodeAt(0) - 65), base + (cc.charCodeAt(1) - 65));
}

/** Track °/compass display. */
export function trackDisplay(track) {
  if (typeof track !== 'number') return { deg: '--', dir: '' };
  return { deg: Math.round(track), dir: compassDir(track) };
}
