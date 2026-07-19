/**
 * PIREP classification + heuristic raw-text parsing for the History → PIREPs tab.
 *
 * The backend CachedPirep serializer gives us some decoded columns from AWC, but
 * they're sparse — the station/OV, flight level, aircraft type, temperature and
 * wind often live only in the raw report string (e.g.
 * `UA /OV KMDW/TM 0354Z/FL022/TP B738/WX FV02SM FU/TA M03/WV 36004KT/TB MOD`).
 * `parsePirepRaw` extracts those slash-delimited contractions so we can build a
 * real station name (not the id hash), a rich decode grid, an accurate hazard
 * group + TYPE badge, and a severity/hazard sort. Everything downstream reads
 * `derivePirep`, which merges the AWC columns with the parsed fallback.
 */

/** Hazard group → display metadata (name + vivid meteorological color). */
export const PIREP_GROUPS = {
  turbulence: { name: 'Turbulence', color: '#f5a742', code: 'TURB' },
  icing: { name: 'Icing', color: '#5ec8ff', code: 'ICE' },
  windshear: { name: 'Wind shear', color: '#c88bff', code: 'LLWS' },
  sky: { name: 'Sky / Cloud', color: '#7c9cff', code: 'SKY' },
  weather: { name: 'Weather', color: '#57d9a3', code: 'WX' },
  routine: { name: 'Routine', color: 'var(--dim)', code: 'RTN' },
};

export const PIREP_GROUP_ORDER = ['turbulence', 'icing', 'windshear', 'sky', 'weather', 'routine'];

/** Intensity codes (longest first so MOD-SEV matches before MOD). */
const INTENSITY = [
  ['MOD-SEV', { tag: 'MOD-SEV', short: 'M-S', rank: 4 }],
  ['LGT-MOD', { tag: 'LGT-MOD', short: 'L-M', rank: 2 }],
  ['TRC-LGT', { tag: 'TRC-LGT', short: 'T-L', rank: 1 }],
  ['EXTRM', { tag: 'EXTREME', short: 'XTM', rank: 6 }],
  ['SEV', { tag: 'SEV', short: 'SEV', rank: 5 }],
  ['MOD', { tag: 'MOD', short: 'MOD', rank: 3 }],
  ['LGT', { tag: 'LGT', short: 'LGT', rank: 1 }],
  ['TRC', { tag: 'TRC', short: 'TRC', rank: 0 }],
  ['SMTH', { tag: 'SMTH', short: 'SMTH', rank: 0 }],
  ['NEG', { tag: 'NEG', short: 'NEG', rank: 0 }],
];
const HAZARD_TYPE = {
  CAT: 'Clear-air',
  CHOP: 'Chop',
  LLWS: 'Low-level wind shear',
  MWAVE: 'Mountain wave',
};

const HASH_RE = /^[0-9a-f]{16,}$/i;
const isHashLike = (v) => typeof v === 'string' && HASH_RE.test(v.trim());

/** Pull `intensity`, `type` and altitude band out of a TB/IC/WS fragment. */
function parseHazardFrag(frag) {
  if (!frag) return null;
  const up = frag.toUpperCase();
  let intensity = null;
  for (const [code, meta] of INTENSITY) {
    if (new RegExp(`\\b${code}\\b`).test(up)) {
      intensity = meta;
      break;
    }
  }
  let type = null;
  for (const [code, name] of Object.entries(HAZARD_TYPE)) {
    if (up.includes(code)) {
      type = name;
      break;
    }
  }
  const band = up.match(/(\d{3,5})\s*-\s*(\d{3,5})/);
  return {
    intensity,
    type,
    base: band ? Number(band[1]) : null,
    top: band ? Number(band[2]) : null,
    raw: frag.trim(),
  };
}

const SLASH_RE = /\/(OV|TM|FL|TP|SK|WX|TA|WV|TB|IC|WS|RM)\s*([^/]*)/g;

/** Parse a raw PIREP string into its slash-delimited fields. */
export function parsePirepRaw(raw) {
  const out = {};
  if (!raw) return out;
  const s = String(raw).trim();
  const rt = s.match(/^\s*(UUA|UA)\b/i);
  if (rt) out.report_type = rt[1].toUpperCase();
  let m;
  SLASH_RE.lastIndex = 0;
  while ((m = SLASH_RE.exec(s))) out[m[1].toLowerCase()] = m[2].trim();
  return out;
}

/** `/FL180` → "FL180"; `DURC`/`DURD`/`UNKN` → readable phase. */
function fmtFlightLevel(fl) {
  if (!fl) return null;
  const up = fl.toUpperCase();
  if (/^\d{3}$/.test(up)) return `FL${up}`;
  if (/^\d{4,5}$/.test(up)) return `${Number(up).toLocaleString()} ft`;
  const phase = {
    DURC: 'During climb',
    DURD: 'During descent',
    DURGC: 'During climb',
    UNKN: 'Unknown',
    UNK: 'Unknown',
  };
  return phase[up] || up;
}

/** `/TA M03` → -3; `/TA 12` → 12. */
function parseTemp(ta) {
  if (!ta) return null;
  const m = ta.toUpperCase().match(/^(M|-)?(\d{1,2})/);
  if (!m) return null;
  const v = Number(m[2]);
  return m[1] ? -v : v;
}

/** `/WV 36004KT` → { dir: 360, kt: 4 }. */
function parseWind(wv) {
  if (!wv) return null;
  const m = wv.toUpperCase().match(/(\d{3})(\d{2,3})KT/);
  if (!m) return { dir: null, kt: null, raw: wv.trim() };
  return { dir: Number(m[1]), kt: Number(m[2]) };
}

/**
 * Merge AWC columns with the parsed raw text into one display object. Column
 * values win when present; the raw parse fills every gap (which is most of them).
 */
export function derivePirep(p) {
  const r = parsePirepRaw(p.raw_text);

  const station =
    (p.location && !isHashLike(p.location) ? p.location : null) ||
    (r.ov ? r.ov.split(/\s+/)[0] : null) ||
    (isHashLike(p.pirep_id) ? null : p.pirep_id) ||
    '—';

  const tb = p.turbulence_type ? parseHazardFrag(p.turbulence_type) : parseHazardFrag(r.tb);
  const ic = p.icing_type ? parseHazardFrag(p.icing_type) : parseHazardFrag(r.ic);
  const ws = r.ws ? parseHazardFrag(r.ws) : null;

  const wind = p.wind_speed_kt != null ? { dir: p.wind_dir, kt: p.wind_speed_kt } : parseWind(r.wv);

  return {
    reportType: (p.report_type || r.report_type || '').toUpperCase(),
    station,
    over: r.ov || p.location || null,
    aircraft: p.aircraft_type || r.tp || null,
    flightLevel:
      p.flight_level != null
        ? `FL${p.flight_level}`
        : fmtFlightLevel(r.fl) ||
          (p.altitude_ft != null ? `${Number(p.altitude_ft).toLocaleString()} ft` : null),
    turbulence: tb && (tb.intensity || tb.type || tb.raw) ? tb : null,
    turbBase: p.turbulence_base_ft ?? tb?.base ?? null,
    turbTop: p.turbulence_top_ft ?? tb?.top ?? null,
    icing: ic && (ic.intensity || ic.type || ic.raw) ? ic : null,
    icingBase: p.icing_base_ft ?? ic?.base ?? null,
    icingTop: p.icing_top_ft ?? ic?.top ?? null,
    windShear: ws && (ws.intensity || ws.type || ws.raw) ? ws : null,
    sky: p.sky_cover || r.sk || null,
    weather: p.weather || r.wx || null,
    temp: p.temperature_c != null ? p.temperature_c : parseTemp(r.ta),
    wind: wind && (wind.dir != null || wind.kt != null) ? wind : null,
    remarks: r.rm || null,
  };
}

/**
 * Classify one PIREP into a hazard group + TYPE badge, using derived data so a
 * turbulence report that only exists in the raw text is still coloured amber.
 */
export function classifyPirep(p, d = derivePirep(p)) {
  if (d.turbulence)
    return {
      group: 'turbulence',
      badge: d.turbulence.intensity ? `TURB·${d.turbulence.intensity.short}` : 'TURB',
    };
  if (d.icing)
    return { group: 'icing', badge: d.icing.intensity ? `ICE·${d.icing.intensity.short}` : 'ICE' };
  if (d.windShear) return { group: 'windshear', badge: 'LLWS' };
  if (d.sky) return { group: 'sky', badge: 'SKY' };
  if (d.weather || d.temp != null || d.wind) return { group: 'weather', badge: 'WX' };
  return { group: 'routine', badge: 'RTN' };
}

/** Report-type pill: the "PIREP type" — Urgent (UUA) vs Routine (UA). */
export function reportType(d) {
  const rt = (d.reportType || '').toUpperCase();
  if (rt === 'UUA') return { label: 'URGENT', kind: 'urgent' };
  if (rt === 'UA') return { label: 'ROUTINE', kind: 'routine' };
  return rt ? { label: rt, kind: 'routine' } : null;
}

export function isUrgent(d) {
  return (d.reportType || '').toUpperCase() === 'UUA';
}

/**
 * Combined severity rank — the max hazard intensity (parsed) blended with the
 * backend severity column and the UUA urgent flag, so the worst reports sort to
 * the top even when AWC left `severity` routine.
 */
const SEV_RANK = { severe: 5, hazardous: 4, caution: 2, routine: 0 };
export function severityRank(p, d = derivePirep(p)) {
  let rank = SEV_RANK[(p.severity || 'routine').toLowerCase()] ?? 0;
  for (const h of [d.turbulence, d.icing, d.windShear]) {
    if (h?.intensity) rank = Math.max(rank, h.intensity.rank);
  }
  if (isUrgent(d)) rank = Math.max(rank, 4);
  return rank;
}

/** Concise, human headline built from parsed data (no LLM run-on / "Not reported" spam). */
export function localHeadline(d) {
  const lead = isUrgent(d) ? 'Urgent PIREP' : 'Routine PIREP';
  const bits = [];
  if (d.aircraft) bits.push(d.aircraft);
  if (d.station && d.station !== '—') bits.push(`over ${d.station}`);
  if (d.flightLevel) bits.push(`at ${d.flightLevel}`);
  const hazards = [];
  if (d.turbulence) hazards.push(`${d.turbulence.intensity?.tag || ''} turbulence`.trim());
  if (d.icing) hazards.push(`${d.icing.intensity?.tag || ''} icing`.trim());
  if (d.windShear) hazards.push('wind shear');
  const tail = hazards.length ? ` — ${hazards.join(', ')}.` : '.';
  return `${lead}: ${bits.join(' ')}${tail}`.replace(/\s+/g, ' ').trim();
}

/** Reporting station / identifier for a PIREP (derived — never the id hash). */
export function pirepStation(p, d = derivePirep(p)) {
  return d.station;
}

/** Human hazard chips (turbulence / icing / wind / FL) for the row body. */
export function pirepChipsFor(d) {
  const band = (base, top) =>
    base != null || top != null ? ` ${base ?? '?'}–${top ?? '?'}ft` : '';
  const out = [];
  if (d.turbulence)
    out.push({
      k: 'turb',
      icon: 'wave',
      text: `Turb ${d.turbulence.intensity?.tag || d.turbulence.raw}${band(d.turbBase, d.turbTop)}`,
    });
  if (d.icing)
    out.push({
      k: 'ice',
      icon: 'thermometer',
      text: `Ice ${d.icing.intensity?.tag || d.icing.raw}${band(d.icingBase, d.icingTop)}`,
    });
  if (d.windShear) out.push({ k: 'wind', icon: 'activity', text: 'Wind shear' });
  else if (d.wind && d.wind.kt != null)
    out.push({ k: 'wind', icon: 'activity', text: `Wind ${d.wind.dir ?? '—'}°/${d.wind.kt}kt` });
  if (d.flightLevel) out.push({ k: 'fl', icon: 'layers', text: d.flightLevel });
  return out;
}

/** Sort comparator factory. mode: 'severity' | 'recent' | 'type'. */
export function pirepSorter(mode) {
  if (mode === 'recent') return (a, b) => (b.ts || 0) - (a.ts || 0);
  if (mode === 'type') return (a, b) => a.group.localeCompare(b.group) || (b.ts || 0) - (a.ts || 0);
  // severity: urgent + worst hazard first, then most recent
  return (a, b) => b.sevRank - a.sevRank || (b.ts || 0) - (a.ts || 0);
}

/**
 * Build the filter-chip descriptors (All + one per non-empty group) with counts.
 * @param {object[]} rows classified rows (must carry `.group`)
 * @param {string} active current group key or 'all'
 */
export function pirepChips(rows, active) {
  const counts = {};
  for (const r of rows) counts[r.group] = (counts[r.group] || 0) + 1;
  const chips = [{ key: 'all', label: 'All', count: rows.length, color: 'var(--accent2)' }];
  for (const key of PIREP_GROUP_ORDER) {
    if (!counts[key]) continue;
    chips.push({
      key,
      label: PIREP_GROUPS[key].name,
      count: counts[key],
      color: PIREP_GROUPS[key].color,
    });
  }
  return chips.map((c) => ({ ...c, on: c.key === active }));
}

// ---------------------------------------------------------------------------
// Geo helpers — shared by the detail screen (adjacent PIREPs + closest planes)
// and the mini-map, so distance math lives in one place.
// ---------------------------------------------------------------------------

function num(...vals) {
  for (const v of vals) {
    const n = typeof v === 'string' ? Number(v) : v;
    if (typeof n === 'number' && Number.isFinite(n)) return n;
  }
  return null;
}

/** Great-circle distance in nautical miles. */
export function distNm(aLat, aLon, bLat, bLon) {
  const R = 3440.065; // Earth radius, nm
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Initial bearing (deg, 0=N) from A→B, as a compass point. */
export function bearingTo(aLat, aLon, bLat, bLon) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(bLon - aLon)) * Math.cos(toRad(bLat));
  const x =
    Math.cos(toRad(aLat)) * Math.sin(toRad(bLat)) -
    Math.sin(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.cos(toRad(bLon - aLon));
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return { deg: (deg + 360) % 360, point: compass[Math.round(((deg + 360) % 360) / 45) % 8] };
}

/** Pull a lat/lon pair off a PIREP row (serializer gives lat/lon + latitude/longitude). */
export function pirepCoord(p) {
  const lat = num(p?.lat, p?.latitude);
  const lon = num(p?.lon, p?.longitude);
  return lat != null && lon != null ? { lat, lon } : null;
}

/**
 * Normalize + distance-filter the live `/aircraft` list around a point.
 * @returns {Array<{hex,flight,lat,lon,track,alt,gs,nm,bearing}>} sorted nearest-first
 */
export function nearbyAircraft(list, lat, lon, radiusNm = 60) {
  if (lat == null || lon == null) return [];
  return (list || [])
    .map((ac) => {
      const aLat = num(ac.lat, ac.latitude);
      const aLon = num(ac.lon, ac.longitude);
      if (aLat == null || aLon == null) return null;
      const nm = distNm(lat, lon, aLat, aLon);
      return {
        hex: (ac.hex || ac.icao_hex || '').toString(),
        flight: (ac.flight || ac.callsign || '').toString().trim(),
        lat: aLat,
        lon: aLon,
        track: num(ac.track, ac.heading) ?? 0,
        alt: num(ac.alt_baro, ac.altitude, ac.alt_geom),
        gs: num(ac.gs, ac.speed),
        nm,
        bearing: bearingTo(lat, lon, aLat, aLon),
      };
    })
    .filter((a) => a && a.nm <= radiusNm)
    .sort((a, b) => a.nm - b.nm);
}

/**
 * Other PIREPs within `radiusNm` of a reference report, nearest-first, tagged
 * with their derived group/badge/station and distance/bearing.
 * @returns {Array<{raw,group,badge,station,nm,bearing}>}
 */
export function adjacentPireps(list, record, radiusNm = 150) {
  const ref = pirepCoord(record);
  if (!ref) return [];
  const out = [];
  for (const p of list || []) {
    if (p === record || p.pirep_id === record.pirep_id) continue;
    const c = pirepCoord(p);
    if (!c) continue;
    const nm = distNm(ref.lat, ref.lon, c.lat, c.lon);
    if (nm > radiusNm) continue;
    const d = derivePirep(p);
    out.push({
      raw: p,
      derived: d,
      group: classifyPirep(p, d).group,
      badge: classifyPirep(p, d).badge,
      station: d.station,
      nm,
      bearing: bearingTo(ref.lat, ref.lon, c.lat, c.lon),
    });
  }
  return out.sort((a, b) => a.nm - b.nm);
}

// ---------------------------------------------------------------------------
// Decode presentation — moved here from PirepAiAnalysis so the detail briefing
// and any future consumer share one implementation.
// ---------------------------------------------------------------------------

/** Rich decode grid ([{label,value}]) from the derived (raw-text-parsed) fields. */
export function decodeFields(d) {
  const rows = [];
  const push = (label, value) =>
    value != null && value !== '' && rows.push({ label, value: String(value) });
  const band = (base, top) =>
    base != null || top != null ? ` · ${base ?? '?'}–${top ?? '?'} ft` : '';
  push(
    'Report',
    d.reportType === 'UUA' ? 'Urgent (UUA)' : d.reportType === 'UA' ? 'Routine (UA)' : d.reportType
  );
  push('Over', d.over);
  push('Aircraft', d.aircraft);
  push('Altitude', d.flightLevel);
  if (d.turbulence)
    push(
      'Turbulence',
      `${[d.turbulence.intensity?.tag, d.turbulence.type].filter(Boolean).join(' ') || d.turbulence.raw}${band(d.turbBase, d.turbTop)}`
    );
  if (d.icing)
    push(
      'Icing',
      `${[d.icing.intensity?.tag, d.icing.type].filter(Boolean).join(' ') || d.icing.raw}${band(d.icingBase, d.icingTop)}`
    );
  if (d.windShear)
    push(
      'Wind shear',
      `${[d.windShear.intensity?.tag, d.windShear.type].filter(Boolean).join(' ') || d.windShear.raw}`
    );
  push('Sky', d.sky);
  push('Weather', d.weather);
  push('Temp', d.temp != null ? `${d.temp}°C` : null);
  push('Wind', d.wind ? `${d.wind.dir ?? '—'}° @ ${d.wind.kt ?? '—'} kt` : null);
  push('Remarks', d.remarks);
  return rows;
}

/**
 * Strip the LLM's markdown + "Not reported / None" filler so the plain-English
 * blurb reads clean instead of a run-on wall. Returns '' when nothing useful is
 * left (then callers fall back to the deterministic localHeadline).
 */
export function cleanSummary(text) {
  if (!text) return '';
  let s = String(text)
    .replace(/\*\*/g, '')
    .replace(/[\r\n]+/g, ' ');
  s = s
    .split(/\s+[-–—]\s+/)
    .map((seg) => seg.trim())
    .filter((seg) => seg && !/:\s*(not reported|none|n\/?a|not decoded|unknown)\.?$/i.test(seg))
    .join(' · ');
  s = s
    .replace(/\bNote:.*$/is, '')
    .replace(/All requested fields.*$/is, '')
    .trim();
  return s.length > 400 ? `${s.slice(0, 397).trimEnd()}…` : s;
}
