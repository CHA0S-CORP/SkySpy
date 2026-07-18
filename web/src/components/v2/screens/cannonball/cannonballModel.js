/**
 * Pure model for the v2 Cannonball screen (car-headunit sky-watch mode).
 * Threat-level derivation, scope blip positioning, unit conversions.
 */

export const THREAT_CONFIG = {
  clear: {
    color: 'var(--cb-clear)',
    title: 'SKY CLEAR',
    sub: 'No law-enforcement air units in range',
  },
  caution: {
    color: 'var(--cb-caution)',
    title: 'CAUTION',
    sub: 'Unidentified aircraft loitering nearby',
  },
  alert: {
    color: 'var(--cb-alert)',
    title: 'AIR UNIT ALERT',
    sub: 'Law-enforcement air unit tracking your route',
  },
};

/**
 * Overall threat level from the threat list (useThreatCalculation shape:
 * {threat_level: 'critical'|'high'|'medium'|'low', is_law_enforcement, …}).
 */
export function threatLevelOf(threats) {
  if (!threats || threats.length === 0) return 'clear';
  if (
    threats.some(
      (t) => t.threat_level === 'critical' || t.threat_level === 'high' || t.is_law_enforcement
    )
  ) {
    return 'alert';
  }
  return 'caution';
}

/**
 * Human labels for backend `pattern_type` values (services/cannonball detector).
 * Unknown types fall back to an upper-cased raw value.
 */
export const PATTERN_LABELS = {
  circling: 'CIRCLING',
  loitering: 'LOITERING',
  grid_search: 'GRID SEARCH',
  speed_trap: 'SPEED TRAP',
  stakeout: 'STAKEOUT',
  racetrack: 'RACETRACK',
  highway_tracking: 'HWY TRACK',
  area_search: 'AREA SEARCH',
};

/**
 * Trend from closing speed (kts): + = range decreasing (closing). The realtime
 * threat cache has no `trend` field, so derive it; fall back to any provided
 * `trend` string (local-threat path).
 */
function trendFrom(t) {
  const cs = t.closing_speed ?? t.closing_speed_kts;
  if (typeof cs === 'number') {
    if (cs > 1) return { trend: 'CLOSING', closing: true };
    if (cs < -1) return { trend: 'DEPARTING', closing: false };
    return { trend: 'HOLDING', closing: false };
  }
  const raw = (t.trend || '').toLowerCase();
  return {
    trend: (t.trend || 'unknown').toUpperCase(),
    closing: raw === 'closing' || raw === 'approaching',
  };
}

/** Nearest (highest-priority) threat display fields. */
export function nearestThreat(threats) {
  const t = threats?.[0];
  if (!t) return null;
  const { trend, closing } = trendFrom(t);
  const closingKts = t.closing_speed ?? t.closing_speed_kts;
  const patterns = Array.isArray(t.patterns)
    ? t.patterns
        .map((p) => {
          const type = p.pattern_type ?? p.type;
          const raw = p.confidence_score ?? p.confidence;
          return {
            type,
            label:
              PATTERN_LABELS[type] ||
              String(type ?? '')
                .replace(/_/g, ' ')
                .toUpperCase(),
            // confidence may arrive as 0-1 or 0-100; normalize to 0-100
            confidence: typeof raw === 'number' ? Math.round(raw <= 1 ? raw * 100 : raw) : null,
          };
        })
        .filter((p) => p.type)
    : [];
  return {
    cs: (t.callsign || t.icao_hex || '').trim().toUpperCase() || '—',
    tag: t.is_law_enforcement ? 'LAW ENFORCEMENT' : (t.threat_level || 'unverified').toUpperCase(),
    dist: typeof t.distance_nm === 'number' ? `${t.distance_nm.toFixed(1)} nm` : '—',
    alt: typeof t.altitude === 'number' ? `${t.altitude.toLocaleString('en-US')} ft` : '—',
    trend,
    closing,
    // enrichment surfaced from the realtime threat cache (CannonballThreatSerializer)
    agency: t.agency_name || null,
    agencyType: t.agency_type ? String(t.agency_type).toUpperCase() : null,
    urgency: typeof t.urgency_score === 'number' ? Math.round(t.urgency_score) : null,
    closingKts: typeof closingKts === 'number' ? Math.round(Math.abs(closingKts)) : null,
    idReason: t.identification_reason || null,
    patterns,
  };
}

/**
 * Scope blip position from bearing (deg) + distance (nm) within rangeNm.
 * Returns {x, y} percentages centered at 50/50.
 */
/**
 * Initial bearing (deg true) from origin to target.
 * @param {{lat: number, lon: number}} from
 * @param {{lat: number, lon: number}} to
 */
export function bearingTo(from, to) {
  const f1 = (from.lat * Math.PI) / 180;
  const f2 = (to.lat * Math.PI) / 180;
  const dl = ((to.lon - from.lon) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export function blipPosition(threat, rangeNm = 15) {
  const bearing = threat.bearing;
  const dist = threat.distance_nm;
  if (typeof bearing !== 'number' || typeof dist !== 'number') return null;
  const r = Math.min(1, dist / rangeNm) * 44; // 44% = scope edge padding
  const a = (bearing / 360) * 2 * Math.PI;
  return {
    x: 50 + r * Math.sin(a),
    y: 50 - r * Math.cos(a),
  };
}

/** m/s (Geolocation speed) → display speed in the chosen unit. */
export function displaySpeed(metersPerSecond, units) {
  if (typeof metersPerSecond !== 'number' || Number.isNaN(metersPerSecond)) return 0;
  const factor = units === 'kmh' ? 3.6 : 2.23694;
  return Math.max(0, Math.round(metersPerSecond * factor));
}

/** Speedometer arc dash length (mock: 75-length arc, clamped to max speed). */
export function speedDash(speed, units) {
  const max = units === 'kmh' ? 220 : 140;
  return (Math.min(speed / max, 1) * 75).toFixed(1);
}

/** h:mm:ss elapsed formatter. */
export function fmtElapsed(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
