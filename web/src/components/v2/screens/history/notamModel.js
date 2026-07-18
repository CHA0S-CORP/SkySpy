/**
 * NOTAM categorization + formatting for the History → NOTAMs archive and the
 * NOTAM detail page (handoff §4). The backend gives { notam_type, reason, text,
 * is_tfr, location, floor_ft, ceiling_ft, radius_nm, latitude, longitude,
 * effective_start, effective_end, ... }; we derive the display category (icon +
 * color) from the reason/type/text keywords.
 */

/** Category → display metadata (name, CSS color, icon, blurb). */
export const NOTAM_CATS = {
  security: {
    name: 'Security',
    short: 'SECURITY',
    color: 'var(--danger)',
    icon: 'shield',
    desc: 'National security flight restriction',
  },
  hazards: {
    name: 'Hazards',
    short: 'HAZARDS',
    color: 'var(--warn)',
    icon: 'alert-triangle',
    desc: 'Airspace hazard activity',
  },
  uas: {
    name: 'UAS',
    short: 'UAS PUBLIC GATHERING',
    color: 'var(--mil)',
    icon: 'radio',
    desc: 'UAS restriction over public gathering',
  },
  vip: {
    name: 'VIP',
    short: 'VIP',
    color: 'var(--accent2)',
    icon: 'star',
    desc: 'VIP / VVIP movement TFR',
  },
  airshow: {
    name: 'Air Shows',
    short: 'AIR SHOWS / SPORTS',
    color: 'var(--accent)',
    icon: 'send',
    desc: 'Air show / sporting event TFR',
  },
};

export const NOTAM_CAT_ORDER = ['security', 'hazards', 'uas', 'vip', 'airshow'];

/**
 * Classify a NOTAM into one of the five display categories.
 * Priority: explicit reason/keywords first, then falls back to hazards.
 */
export function classifyNotam(n) {
  const hay = `${n.reason || ''} ${n.text || ''} ${n.notam_type || ''} ${
    n.decoded?.category || ''
  }`.toUpperCase();

  if (/VIP|VVIP|PRESIDENT|HEAD OF STATE|POTUS/.test(hay)) return 'vip';
  if (/SECURITY|NATIONAL DEFENSE|40103|PROHIBITED/.test(hay)) return 'security';
  if (/UAS|UNMANNED|DRONE|UAV/.test(hay)) return 'uas';
  if (/AIR ?SHOW|AIRSHOW|SPORTING|STADIUM|SPEEDWAY|RACE|GAME|SUPER BOWL|AERIAL DEMO/.test(hay))
    return 'airshow';
  if (/PUBLIC GATHERING|CROWD/.test(hay)) return 'uas';
  if (/HAZARD|FIRE|DISASTER|LASER|ROCKET|LAUNCH|SPACE|VOLCAN|EXPLOSIVE/.test(hay)) return 'hazards';
  return 'hazards';
}

/** Feet value → compact label ("SFC", "18,000", "FL180", "—"). */
export function fmtAlt(ft, { surface = false } = {}) {
  if (ft == null) return surface ? 'SFC' : '—';
  if (ft <= 0) return 'SFC';
  if (ft >= 18000) return `FL${Math.round(ft / 100)}`;
  return ft.toLocaleString();
}

/** Floor–ceiling band string for a NOTAM card. */
export function altBand(n) {
  const floor = n.floor_ft == null ? 'SFC' : fmtAlt(n.floor_ft);
  const ceil = fmtAlt(n.ceiling_ft);
  return `${floor}–${ceil}`;
}

/** Radius string ("30 NM" or "—"). */
export function fmtRadius(n) {
  return n.radius_nm != null ? `${Math.round(n.radius_nm)} NM` : '—';
}

/** The ARTCC / center-or-location code shown as the card title. */
export function notamCenter(n) {
  return (n.location || n.center || n.notam_id || 'NOTAM').toString().toUpperCase();
}

/** Short id label ("6/6038"). */
export function notamShortId(n) {
  return (n.notam_id || n.id || '').toString();
}

/** Effective-window one-liner for a card / title bar. */
export function effectiveWindow(n) {
  const start = n.effective_start ? new Date(n.effective_start) : null;
  const end = n.effective_end ? new Date(n.effective_end) : null;
  const fmt = (d) =>
    d && !Number.isNaN(d.getTime())
      ? `${d.getUTCDate()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}Z`
      : null;
  if (n.is_permanent) return 'Permanent';
  const s = fmt(start);
  const e = fmt(end);
  if (s && e) return `${s} → ${e}`;
  if (s) return `Effective ${s}`;
  return '—';
}

/**
 * Archive stats over a NOTAM list: total active, TFR count, distinct centers.
 */
export function notamStats(list) {
  const active = list.filter((n) => n.is_active !== false);
  const tfrs = list.filter((n) => n.is_tfr || (n.notam_type || '').toUpperCase() === 'TFR');
  const centers = new Set(list.map((n) => notamCenter(n)).filter(Boolean));
  return { total: active.length, tfrs: tfrs.length, centers: centers.size };
}

/** Filter chips (All + one per category) with live counts. */
export function notamChips(rows, active) {
  const counts = {};
  for (const r of rows) counts[r.cat] = (counts[r.cat] || 0) + 1;
  const chips = [{ key: 'all', label: 'All', count: rows.length, color: 'var(--accent2)' }];
  for (const key of NOTAM_CAT_ORDER) {
    if (!counts[key]) continue; // hide empty categories to reduce noise
    chips.push({
      key,
      label: NOTAM_CATS[key].name,
      count: counts[key],
      color: NOTAM_CATS[key].color,
    });
  }
  return chips.map((c) => ({ ...c, on: c.key === active }));
}
