import { useCallback, useMemo } from 'react';
import { isPointInPolygon } from './useTurbulenceOverlay';

/**
 * AIRMET hazard vocabulary — colour + label per hazard code as stored on
 * AirspaceAdvisory (G-AIRMET products TANGO/ZULU/SIERRA). Altitude-band suffixes
 * (-LO/-HI) share the base hazard colour.
 */
export const AIRMET_HAZARDS = {
  'TURB-LO': { color: '#ffb84d', label: 'Turbulence (low)', short: 'TURB LO' },
  'TURB-HI': { color: '#ff8c1a', label: 'Turbulence (high)', short: 'TURB HI' },
  TURB: { color: '#ffa500', label: 'Turbulence', short: 'TURB' },
  ICE: { color: '#4cc9f0', label: 'Icing', short: 'ICE' },
  FZLVL: { color: '#7ad7ff', label: 'Freezing level', short: 'FZLVL' },
  IFR: { color: '#9aa7b4', label: 'IFR', short: 'IFR' },
  MT_OBSC: { color: '#b0b0b0', label: 'Mtn obscuration', short: 'MT OBSC' },
  MTN_OBSCN: { color: '#b0b0b0', label: 'Mtn obscuration', short: 'MT OBSC' },
  LLWS: { color: '#ff6a00', label: 'Low-level wind shear', short: 'LLWS' },
  SFC_WND: { color: '#e0b93c', label: 'Surface wind', short: 'SFC WND' },
};

const DEFAULT_HAZARD = { color: '#9aa7b4', label: 'AIRMET', short: 'AIRMET' };

/** Resolve hazard metadata, matching an exact code then a base-hazard prefix. */
export function airmetHazardMeta(hazard) {
  const key = (hazard || '').toUpperCase();
  if (AIRMET_HAZARDS[key]) return AIRMET_HAZARDS[key];
  const base = key.split('-')[0];
  return AIRMET_HAZARDS[base] || DEFAULT_HAZARD;
}

/**
 * Parse an advisory's GeoJSON geometry into screen-agnostic vertices plus whether
 * it's a closed AREA (filled polygon) or an open LINE (polyline, e.g. freezing
 * level). Handles Polygon, LineString, MultiPolygon, and legacy flat arrays.
 *
 * @returns {{ points: {lat:number, lon:number}[], closed: boolean }}
 */
export function parseAirmetGeometry(advisory) {
  const poly = advisory.polygon;
  const toPts = (arr) =>
    (arr || []).map((c) =>
      Array.isArray(c) ? { lat: c[1], lon: c[0] } : { lat: c.lat, lon: c.lon ?? c.lng }
    );

  if (poly && typeof poly === 'object' && !Array.isArray(poly)) {
    if (poly.type === 'LineString' && Array.isArray(poly.coordinates)) {
      return { points: toPts(poly.coordinates), closed: false };
    }
    if (poly.type === 'Polygon' && Array.isArray(poly.coordinates?.[0])) {
      return { points: toPts(poly.coordinates[0]), closed: true };
    }
    if (poly.type === 'MultiPolygon' && Array.isArray(poly.coordinates?.[0]?.[0])) {
      return { points: toPts(poly.coordinates[0][0]), closed: true };
    }
  }
  if (Array.isArray(poly)) return { points: toPts(poly), closed: true };
  if (Array.isArray(advisory.coords)) return { points: toPts(advisory.coords), closed: true };
  return { points: [], closed: true };
}

/**
 * Derive a full AIRMET map layer from the G-AIRMET advisories already fetched by
 * the app — all hazards (turbulence, icing, freezing level, IFR, mountain
 * obscuration, LLWS, surface wind), colour-coded, drawing AREA hazards as filled
 * polygons and LINE hazards as open polylines. Consumed by the Live Map radar
 * overlay. Mirrors useTurbulenceOverlay's API (drawOnCanvas + point hit-test).
 *
 * @param {object} options
 * @param {boolean} options.enabled
 * @param {Array} options.advisories - Airspace advisories (all hazards).
 * @returns {{ airmets: Array, count: number, drawOnCanvas: Function, getAirmetAtPoint: Function }}
 */
export function useAirmetOverlay({ enabled = false, advisories = [] } = {}) {
  const airmets = useMemo(() => {
    if (!enabled || !Array.isArray(advisories)) return [];
    return advisories
      .filter((a) => {
        const type = (a.advisory_type || '').toUpperCase();
        const hz = (a.hazard || '').toUpperCase();
        // G-AIRMET / AIRMET records, or anything with a known AIRMET hazard.
        return (
          type.includes('AIRMET') || !!AIRMET_HAZARDS[hz] || !!AIRMET_HAZARDS[hz.split('-')[0]]
        );
      })
      .map((a) => {
        const geom = parseAirmetGeometry(a);
        return {
          id: a.advisory_id || a.id,
          hazard: a.hazard,
          meta: airmetHazardMeta(a.hazard),
          points: geom.points,
          closed: geom.closed,
          severity: a.severity,
          lowerAltFt: a.lower_alt_ft,
          upperAltFt: a.upper_alt_ft,
          validFrom: a.valid_from,
          validTo: a.valid_to,
          rawText: a.raw_text,
        };
      })
      .filter((a) => a.points.length >= 2);
  }, [enabled, advisories]);

  const getAirmetAtPoint = useCallback(
    (lat, lon) => {
      // Only closed AREAs are clickable (a LINE has no interior).
      for (const a of airmets) {
        if (a.closed && a.points.length >= 3 && isPointInPolygon(lat, lon, a.points)) return a;
      }
      return null;
    },
    [airmets]
  );

  const drawOnCanvas = useCallback(
    (ctx, latLonToScreen, opacity = 1.0) => {
      if (!airmets.length) return;
      airmets.forEach((a) => {
        const { points, closed, meta } = a;
        if (points.length < 2) return;
        const screen = points.map((p) => latLonToScreen(p.lat, p.lon));
        const visible = screen.some(
          (p) =>
            p.x >= -120 &&
            p.x <= ctx.canvas.width + 120 &&
            p.y >= -120 &&
            p.y <= ctx.canvas.height + 120
        );
        if (!visible) return;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(screen[0].x, screen[0].y);
        screen.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
        if (closed) ctx.closePath();

        const col = meta.color;
        if (closed) {
          ctx.fillStyle = hexA(col, 0.14 * opacity);
          ctx.fill();
        }
        ctx.strokeStyle = hexA(col, 0.95 * opacity);
        ctx.lineWidth = closed ? 1.75 : 2.25;
        ctx.setLineDash(closed ? [7, 4] : [2, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Centroid label.
        const cx = screen.reduce((s, p) => s + p.x, 0) / screen.length;
        const cy = screen.reduce((s, p) => s + p.y, 0) / screen.length;
        if (cx >= 0 && cx <= ctx.canvas.width && cy >= 0 && cy <= ctx.canvas.height) {
          ctx.font = 'bold 10px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const label = meta.short;
          const w = ctx.measureText(label).width + 8;
          ctx.fillStyle = `rgba(0, 0, 0, ${0.65 * opacity})`;
          ctx.fillRect(cx - w / 2, cy - 7, w, 14);
          ctx.fillStyle = hexA(col, opacity);
          ctx.fillText(label, cx, cy);
        }
        ctx.restore();
      });
    },
    [airmets]
  );

  return { airmets, count: airmets.length, getAirmetAtPoint, drawOnCanvas };
}

/** #rrggbb + alpha (0-1) → rgba() string. */
function hexA(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

export default useAirmetOverlay;
