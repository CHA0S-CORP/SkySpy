/**
 * Pure derivations for the v2 Statistics screen: sparkline/area math,
 * live-feed rails, distributions, antenna coverage polygon, RSSI scatter +
 * regression — all hand-built SVG point math lifted from the mock's spark()
 * and renderVals().
 */

import { altitudeOf, barsFromRssi, categoryOf, EMERGENCY_SQUAWKS } from '../list/listModel';

/** Mock spark(): polyline points for a 100-wide, h-tall viewBox. */
export function spark(vals, h = 40) {
  if (!vals || vals.length < 2) return { line: '', area: '' };
  const n = vals.length;
  const mx = Math.max(...vals);
  const mn = Math.min(...vals);
  const rg = mx - mn || 1;
  const line = vals
    .map(
      (v, i) =>
        `${((i / (n - 1)) * 100).toFixed(1)},${(h - ((v - mn) / rg) * (h - 4) - 2).toFixed(1)}`
    )
    .join(' ');
  return { line, area: `0,${h} ${line} 100,${h}` };
}

/** Top-3 rails: Closest / Fastest / Highest from the live aircraft array. */
export function liveFeeds(aircraft) {
  const named = aircraft.filter((a) => (a.flight || '').trim());
  const top = (arr, key, dir, fmt) =>
    arr
      .filter((a) => typeof a[key] === 'number')
      .sort((x, y) => (dir === 'asc' ? x[key] - y[key] : y[key] - x[key]))
      .slice(0, 3)
      .map((a, i) => ({ n: i + 1, hex: a.hex, cs: (a.flight || a.hex).trim(), val: fmt(a[key]) }));
  return [
    {
      key: 'closest',
      title: 'Closest',
      color: 'var(--accent2)',
      icon: 'map-pin',
      rows: top(named, 'distance_nm', 'asc', (v) => `${v.toFixed(1)} nm`),
    },
    {
      key: 'fastest',
      title: 'Fastest',
      color: 'var(--accent)',
      icon: 'zap',
      rows: top(named, 'gs', 'desc', (v) => `${Math.round(v)} kts`),
    },
    {
      key: 'highest',
      title: 'Highest',
      color: 'var(--purple)',
      icon: 'chevron-up',
      rows: top(
        named.map((a) => ({ ...a, _alt: altitudeOf(a) })),
        '_alt',
        'desc',
        (v) => `${(v / 1000).toFixed(1)}k ft`
      ),
    },
  ];
}

/** Emergency squawk watchlist entries. */
export function squawkWatchlist(aircraft) {
  return aircraft
    .filter((a) => EMERGENCY_SQUAWKS.includes(a.squawk) || a.emergency === true)
    .map((a) => ({ hex: a.hex, cs: (a.flight || a.hex || '').trim(), squawk: a.squawk }));
}

/** Altitude Distribution buckets (mock order). */
export function altitudeDistribution(aircraft) {
  const buckets = [
    { label: '> 30k ft', color: 'var(--purple)', test: (alt) => alt > 30000 },
    { label: '< 10k ft', color: 'var(--accent)', test: (alt) => alt > 0 && alt < 10000 },
    { label: '10-30k ft', color: 'var(--accent2)', test: (alt) => alt >= 10000 && alt <= 30000 },
    { label: 'Ground', color: 'var(--dim2)', test: (alt) => alt <= 0 },
  ];
  const total = aircraft.length || 1;
  return buckets.map((b) => {
    const count = aircraft.filter((a) => b.test(altitudeOf(a))).length;
    return { label: b.label, color: b.color, count, pct: Math.round((count / total) * 100) };
  });
}

/** Flight category distribution. */
export function categoryDistribution(aircraft) {
  const total = aircraft.length || 1;
  const counts = { Commercial: 0, GA: 0, Military: 0 };
  for (const a of aircraft) {
    const c = categoryOf(a);
    if (c === 'military') counts.Military += 1;
    else if (c === 'ga') counts.GA += 1;
    else counts.Commercial += 1;
  }
  const colors = { Commercial: 'var(--accent2)', GA: 'var(--accent)', Military: 'var(--danger)' };
  return Object.entries(counts)
    .map(([label, count]) => ({
      label,
      count,
      pct: Math.round((count / total) * 100),
      color: colors[label],
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Antenna coverage polygon points from max_range_by_direction
 * ({sectorDeg: maxNm}) for a 200×200 viewBox with r=80 max.
 */
export function coveragePolygon(maxRangeByDirection, sectorSize = 30) {
  const entries = Object.entries(maxRangeByDirection || {});
  if (!entries.length) return '';
  const maxRange = Math.max(...entries.map(([, v]) => v || 0)) || 1;
  const sectors = 360 / sectorSize;
  const points = [];
  for (let i = 0; i < sectors; i++) {
    const deg = i * sectorSize;
    const val = maxRangeByDirection[deg] ?? maxRangeByDirection[String(deg)] ?? 0;
    const r = (val / maxRange) * 80;
    const a = (deg / 360) * 2 * Math.PI;
    points.push(`${(100 + r * Math.sin(a)).toFixed(1)},${(100 - r * Math.cos(a)).toFixed(1)}`);
  }
  return points.join(' ');
}

/**
 * RSSI-vs-distance scatter (mock geometry: dist 0..200 → x 34..214,
 * rssi 0..-30 → y 10..150) + least-squares regression endpoints.
 * @param {Array<{distance_nm: number, rssi: number}>} samples
 */
export function rssiScatter(samples) {
  const pts = (samples || []).filter(
    (s) => typeof s.distance_nm === 'number' && typeof s.rssi === 'number'
  );
  const scatter = pts.slice(0, 80).map((s) => {
    const x = 34 + (Math.min(200, s.distance_nm) / 200) * 180;
    const y = 10 + (-s.rssi / 30) * 140;
    return { x: x.toFixed(1), y: Math.max(10, Math.min(150, y)).toFixed(1) };
  });
  if (pts.length < 2) return { scatter, regY0: null, regY1: null, r: null };
  // least squares over (distance, rssi)
  const n = pts.length;
  const sx = pts.reduce((a, p) => a + p.distance_nm, 0);
  const sy = pts.reduce((a, p) => a + p.rssi, 0);
  const sxx = pts.reduce((a, p) => a + p.distance_nm * p.distance_nm, 0);
  const sxy = pts.reduce((a, p) => a + p.distance_nm * p.rssi, 0);
  const syy = pts.reduce((a, p) => a + p.rssi * p.rssi, 0);
  const denom = n * sxx - sx * sx;
  if (!denom) return { scatter, regY0: null, regY1: null, r: null };
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const rDenom = Math.sqrt(denom * (n * syy - sy * sy));
  const r = rDenom ? (n * sxy - sx * sy) / rDenom : 0;
  const yAt = (d) => {
    const rssi = intercept + slope * d;
    return Math.max(10, Math.min(150, 10 + (-rssi / 30) * 140));
  };
  return { scatter, regY0: yAt(0).toFixed(1), regY1: yAt(200).toFixed(1), r: Number(r.toFixed(2)) };
}

/** Severity counters for the right-rail Safety Events card. */
export function safetySeverityCounts(events) {
  const counts = { critical: 0, warning: 0, info: 0 };
  for (const e of events || []) {
    const sev = (e.severity || '').toLowerCase();
    if (sev === 'critical' || sev === 'emergency' || sev === 'high') counts.critical += 1;
    else if (sev === 'warning' || sev === 'medium') counts.warning += 1;
    else counts.info += 1;
  }
  return counts;
}

/** Group safety events by type for the bars panel (top N). */
export function safetyTypeBars(events, topN = 4) {
  const byType = new Map();
  for (const e of events || []) {
    const t = e.event_type || e.type || 'other';
    byType.set(t, (byType.get(t) || 0) + 1);
  }
  const total = (events || []).length || 1;
  return [...byType.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([type, count], i) => ({
      label: type.replaceAll('_', ' '),
      count,
      pct: Math.round((count / total) * 100),
      color: i === 0 ? 'var(--purple)' : i === 1 ? 'var(--warn)' : 'var(--accent2)',
    }));
}

/** Historical bars panels computed from session records. */
export function historyBars(sessions, tab) {
  const mk = (arr) => {
    const m = Math.max(...arr.map((a) => a.v), 1);
    return arr.map((a) => ({
      label: a.label,
      disp: a.disp ?? a.v,
      pct: Math.round((a.v / m) * 100),
    }));
  };
  if (tab === 'Top Performers') {
    return mk(
      sessions
        .slice()
        .sort((a, b) => (b.positions ?? 0) - (a.positions ?? 0))
        .slice(0, 6)
        .map((s) => ({ label: (s.callsign || s.icao_hex || '').trim(), v: s.positions ?? 0 }))
    );
  }
  if (tab === 'Distance') {
    const buckets = [
      ['0-25 nm', 0, 25],
      ['25-50 nm', 25, 50],
      ['50-100 nm', 50, 100],
      ['100-150 nm', 100, 150],
      ['150+ nm', 150, Infinity],
    ];
    return mk(
      buckets.map(([label, lo, hi]) => ({
        label,
        v: sessions.filter((s) => (s.max_distance_nm ?? 0) >= lo && (s.max_distance_nm ?? 0) < hi)
          .length,
      }))
    );
  }
  if (tab === 'Duration') {
    const buckets = [
      ['0-10 min', 0, 10],
      ['10-20 min', 10, 20],
      ['20-40 min', 20, 40],
      ['40+ min', 40, Infinity],
    ];
    return mk(
      buckets.map(([label, lo, hi]) => ({
        label,
        v: sessions.filter((s) => (s.duration_min ?? 0) >= lo && (s.duration_min ?? 0) < hi).length,
      }))
    );
  }
  if (tab === 'Patterns') {
    const buckets = [
      ['Morning', 5, 11],
      ['Midday', 11, 17],
      ['Evening', 17, 23],
      ['Night', 23, 5],
    ];
    return mk(
      buckets.map(([label, lo, hi]) => ({
        label,
        v: sessions.filter((s) => {
          const h = new Date(s.first_seen || 0).getHours();
          return lo < hi ? h >= lo && h < hi : h >= lo || h < hi;
        }).length,
      }))
    );
  }
  return [];
}

/** Activity-by-hour heatmap cells from sessions. */
export function activityByHour(sessions) {
  const counts = new Array(24).fill(0);
  for (const s of sessions) {
    const h = new Date(s.first_seen || s.last_seen || 0).getHours();
    if (!Number.isNaN(h)) counts[h] += 1;
  }
  const max = Math.max(...counts, 1);
  return counts.map((v, i) => {
    const t = v / max;
    return {
      label: i,
      count: v,
      color: `color-mix(in srgb, var(--accent) ${Math.round(t * 100)}%, var(--bg3))`,
      fg: t > 0.5 ? 'var(--bg0)' : 'var(--dim2)',
    };
  });
}

/**
 * Session-quality grade rows from the tracking-quality `quality_breakdown`
 * map ({excellent, good, fair, poor} counts). Returns ordered bar rows with a
 * grade color, plus the dominant grade + total for a headline. Null when the
 * breakdown is absent/empty so the panel can conditionally render.
 * @param {{excellent?: number, good?: number, fair?: number, poor?: number}} [breakdown]
 */
export function qualityGradeRows(breakdown) {
  if (!breakdown) return null;
  const order = [
    { key: 'excellent', label: 'Excellent', color: 'var(--accent)' },
    { key: 'good', label: 'Good', color: 'var(--accent2)' },
    { key: 'fair', label: 'Fair', color: 'var(--warn)' },
    { key: 'poor', label: 'Poor', color: 'var(--danger)' },
  ];
  const total = order.reduce((sum, g) => sum + (breakdown[g.key] || 0), 0);
  if (total === 0) return null;
  const rows = order.map((g) => {
    const count = breakdown[g.key] || 0;
    return {
      label: g.label,
      key: g.key,
      count,
      pct: Math.round((count / total) * 100),
      color: g.color,
    };
  });
  const dominant = rows.reduce((best, r) => (r.count > best.count ? r : best), rows[0]);
  return { rows, total, dominant };
}

/**
 * Coverage-gap summary tiles from the tracking-quality `gaps` payload.
 * Returns completeness (100 − sessions-with-gaps %), the gap counts, and a
 * formatted average gap duration. Null when the payload is absent.
 * @param {object} [gaps]
 */
export function coverageGapSummary(gaps) {
  if (!gaps || typeof gaps.sessions_analyzed !== 'number') return null;
  const analyzed = gaps.sessions_analyzed;
  const withGaps = gaps.sessions_with_gaps ?? 0;
  const gapPct =
    gaps.sessions_with_gaps_pct ?? (analyzed > 0 ? Math.round((withGaps / analyzed) * 100) : 0);
  const avgGap = gaps.avg_gap_seconds;
  return {
    analyzed,
    withGaps,
    gapPct,
    completenessPct: Math.max(0, Math.round(100 - gapPct)),
    totalGaps: gaps.total_gaps_found ?? 0,
    avgGapDisp: typeof avgGap === 'number' ? `${Math.round(avgGap)}s` : '--',
  };
}

/**
 * Common aircraft-type bars from the flight-patterns `aircraft_types` payload
 * (each {type_code, type_name?, session_count, military_pct?}). Scaled to the
 * busiest type. Empty array when absent so the panel can hide.
 * @param {Array<object>} [types]
 * @param {number} [topN]
 */
export function commonTypeBars(types, topN = 6) {
  const list = (types || []).filter((t) => t && t.type_code);
  if (!list.length) return [];
  const top = list.slice(0, topN);
  const max = Math.max(...top.map((t) => t.session_count ?? 0), 1);
  return top.map((t) => ({
    label: t.type_name ? `${t.type_code} · ${t.type_name}` : t.type_code,
    count: t.session_count ?? 0,
    pct: Math.round(((t.session_count ?? 0) / max) * 100),
    militaryPct: typeof t.military_pct === 'number' ? t.military_pct : null,
    color: t.military_pct >= 50 ? 'var(--danger)' : 'var(--accent2)',
  }));
}

/** Aircraft type counts / avg duration by type from sessions (top 5). */
export function typeBreakdown(sessions) {
  const counts = new Map();
  const durations = new Map();
  for (const s of sessions) {
    const t = s.type || s.aircraft_type;
    if (!t) continue;
    counts.set(t, (counts.get(t) || 0) + 1);
    const d = durations.get(t) || { sum: 0, n: 0 };
    d.sum += s.duration_min ?? 0;
    d.n += 1;
    durations.set(t, d);
  }
  const topTypes = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const tMax = Math.max(...topTypes.map(([, v]) => v), 1);
  const types = topTypes.map(([type, count]) => ({
    type,
    count,
    pct: Math.round((count / tMax) * 100),
  }));
  const avg = [...durations.entries()]
    .map(([type, d]) => ({ type, min: Math.round(d.sum / (d.n || 1)) }))
    .sort((a, b) => b.min - a.min)
    .slice(0, 5);
  const dMax = Math.max(...avg.map((d) => d.min), 1);
  const durationsOut = avg.map((d) => ({ ...d, pct: Math.round((d.min / dMax) * 100) }));
  return { types, durations: durationsOut };
}

export { barsFromRssi };
