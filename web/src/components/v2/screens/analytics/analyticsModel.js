/**
 * Pure derivations for the v2 Advanced Analytics screen: scatter SVG geometry,
 * correlation-strength labels, matrix heat grid, cross-domain rollup rows, and
 * generic bar / hour-heat helpers. No side effects, no fetching — all input is
 * REST payloads already shaped by the backend.
 */

/** Numeric fields the explorer can plot (mirrors backend CORRELATABLE_FIELDS). */
export const FIELD_FALLBACK = [
  { key: 'altitude_baro', label: 'Altitude', unit: 'ft' },
  { key: 'ground_speed', label: 'Ground Speed', unit: 'kts' },
  { key: 'distance_nm', label: 'Distance', unit: 'nm' },
  { key: 'rssi', label: 'Signal (RSSI)', unit: 'dBFS' },
  { key: 'vertical_rate', label: 'Vertical Rate', unit: 'ft/min' },
  { key: 'hour', label: 'Hour of Day', unit: 'h' },
];

/**
 * Map scatter points + regression into SVG coordinates for a w×h viewBox.
 * @param {{points: Array<{x:number,y:number}>, slope:number|null, intercept:number|null}} payload
 */
export function scatterGeometry(payload, w = 320, h = 210) {
  const pad = { l: 46, r: 14, t: 12, b: 28 };
  const plot = { x0: pad.l, x1: w - pad.r, y0: h - pad.b, y1: pad.t };
  const pts = payload?.points || [];
  if (!pts.length) {
    return { dots: [], reg: null, w, h, plot, xDomain: [0, 1], yDomain: [0, 1], empty: true };
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  let xmin = Math.min(...xs);
  let xmax = Math.max(...xs);
  let ymin = Math.min(...ys);
  let ymax = Math.max(...ys);
  if (xmin === xmax) {
    xmin -= 1;
    xmax += 1;
  }
  if (ymin === ymax) {
    ymin -= 1;
    ymax += 1;
  }
  const sx = (x) => plot.x0 + ((x - xmin) / (xmax - xmin)) * (plot.x1 - plot.x0);
  const sy = (y) => plot.y0 + ((y - ymin) / (ymax - ymin)) * (plot.y1 - plot.y0);
  const dots = pts.map((p) => ({ cx: +sx(p.x).toFixed(1), cy: +sy(p.y).toFixed(1) }));
  let reg = null;
  if (payload.slope != null && payload.intercept != null) {
    const ya = payload.intercept + payload.slope * xmin;
    const yb = payload.intercept + payload.slope * xmax;
    reg = {
      x1: +sx(xmin).toFixed(1),
      y1: +sy(ya).toFixed(1),
      x2: +sx(xmax).toFixed(1),
      y2: +sy(yb).toFixed(1),
    };
  }
  return { dots, reg, w, h, plot, xDomain: [xmin, xmax], yDomain: [ymin, ymax], empty: false };
}

/** Human label + color for a Pearson r. */
export function correlationStrength(r) {
  if (r == null) return { label: 'No data', color: 'var(--dim)', dir: null };
  const a = Math.abs(r);
  const dir = r > 0 ? 'positive' : 'negative';
  let strength = 'negligible';
  if (a >= 0.7) strength = 'strong';
  else if (a >= 0.4) strength = 'moderate';
  else if (a >= 0.2) strength = 'weak';
  const color =
    a >= 0.7
      ? r > 0
        ? 'var(--accent)'
        : 'var(--danger)'
      : a >= 0.4
        ? 'var(--warn)'
        : 'var(--dim)';
  return { label: strength === 'negligible' ? 'negligible' : `${strength} ${dir}`, color, dir };
}

/** Background color for a matrix cell given its r (cyan +, red −, opacity by |r|). */
export function heatColor(r) {
  if (r == null) return 'var(--bg2)';
  const a = Math.min(1, Math.abs(r));
  const base = r >= 0 ? 'var(--accent2)' : 'var(--danger)';
  return `color-mix(in srgb, ${base} ${Math.round(a * 85)}%, var(--bg1))`;
}

/** Structured grid for the correlation matrix heatmap. */
export function matrixGrid(payload) {
  const fields = payload?.fields || [];
  const matrix = payload?.matrix || [];
  return fields.map((rowF, i) => ({
    key: rowF.key,
    label: rowF.label,
    cells: fields.map((colF, j) => {
      const r = matrix[i]?.[j] ?? null;
      return { key: colF.key, r, self: i === j, color: heatColor(r) };
    }),
  }));
}

/** Cross-domain per-aircraft rows with a combined activity bar percentage. */
export function crossDomainRows(payload) {
  const rows = payload?.aircraft || [];
  const activityOf = (r) => (r.alerts || 0) + (r.safety_events || 0) + (r.acars || 0);
  const max = Math.max(1, ...rows.map(activityOf));
  return rows.map((r) => {
    const activity = activityOf(r);
    return {
      ...r,
      label: (r.registration || r.icao_hex || '').toUpperCase(),
      activity,
      pct: Math.round((activity / max) * 100),
    };
  });
}

/** Generic label/value bars scaled to the max value in the set. */
export function barsFrom(items, labelKey, valueKey) {
  const arr = items || [];
  const val = (it) => Number(it[valueKey]) || 0;
  const max = Math.max(1, ...arr.map(val));
  return arr.map((it) => ({
    label: String(it[labelKey] ?? '—'),
    value: val(it),
    pct: Math.round((val(it) / max) * 100),
  }));
}

/**
 * Frequent-route rows for a compact list. Each row carries a label (origin →
 * destination, or airline code), a count, a scaled bar percentage, and sample
 * callsigns. Guards partial payloads (routes may be ACARS pairs or callsign
 * airline codes with no origin/destination).
 *
 * @param {{routes?: Array<object>}} payload
 */
export function routeRows(payload) {
  const arr = payload?.routes || [];
  const max = Math.max(1, ...arr.map((r) => Number(r.count) || 0));
  return arr.map((r, i) => {
    const count = Number(r.count) || 0;
    const label =
      r.origin && r.destination
        ? `${r.origin} → ${r.destination}`
        : r.airline_code || r.route_key || '—';
    return {
      key: `${r.route_key || label}-${i}`,
      label,
      count,
      pct: Math.round((count / max) * 100),
      callsigns: Array.isArray(r.sample_callsigns) ? r.sample_callsigns.slice(0, 5) : [],
    };
  });
}

/**
 * Common aircraft-type rows. Prefers a human type name (falling back to the
 * ICAO type code) and a scaled bar keyed on session count. Manufacturer and
 * military percentage are surfaced when present.
 *
 * @param {{aircraft_types?: Array<object>}} payload
 */
export function aircraftTypeRows(payload) {
  const arr = payload?.aircraft_types || [];
  const max = Math.max(1, ...arr.map((t) => Number(t.session_count) || 0));
  return arr.map((t, i) => {
    const count = Number(t.session_count) || 0;
    return {
      key: `${t.type_code || i}`,
      code: t.type_code || '—',
      name: t.type_name || t.type_code || '—',
      manufacturer: t.manufacturer || null,
      count,
      unique: Number(t.unique_aircraft) || 0,
      militaryPct: t.military_pct != null ? Number(t.military_pct) : null,
      pct: Math.round((count / max) * 100),
    };
  });
}

/**
 * Military-vs-civilian split per country. Each row exposes the military and
 * civilian counts plus a 0-100 military share for a stacked bar.
 *
 * @param {{military_breakdown?: Array<object>}} payload
 */
export function militaryRows(payload) {
  const arr = payload?.military_breakdown || [];
  const max = Math.max(1, ...arr.map((r) => Number(r.total) || 0));
  return arr.map((r, i) => {
    const total = Number(r.total) || 0;
    return {
      key: `${r.country || i}`,
      country: r.country || '—',
      military: Number(r.military_count) || 0,
      civilian: Number(r.civilian_count) || 0,
      total,
      militaryPct: r.military_pct != null ? Number(r.military_pct) : null,
      pct: Math.round((total / max) * 100),
    };
  });
}

/** 24-cell hour heatmap from a busiest-hours payload. */
export function hourHeat(busiest) {
  const byHour = new Array(24).fill(0);
  for (const b of busiest || []) {
    const h = Number(b.hour);
    if (h >= 0 && h < 24) byHour[h] = Number(b.position_count ?? b.unique_aircraft ?? 0);
  }
  const max = Math.max(1, ...byHour);
  return byHour.map((v, i) => {
    const t = v / max;
    return {
      label: i,
      count: v,
      color: `color-mix(in srgb, var(--accent) ${Math.round(t * 100)}%, var(--bg3))`,
      fg: t > 0.5 ? 'var(--bg0)' : 'var(--dim2)',
    };
  });
}
