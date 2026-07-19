import { useCallback, useMemo } from 'react';

/**
 * Turbulence severity styling (amber family, distinct from the red convective
 * SIGMET hatching so the two layers read separately on the scope).
 */
export const TURB_SEVERITY = {
  severe: {
    level: 3,
    color: 'rgba(255, 80, 0, 0.35)',
    stroke: 'rgba(255, 80, 0, 0.9)',
    label: 'Severe',
  },
  moderate: {
    level: 2,
    color: 'rgba(255, 165, 0, 0.30)',
    stroke: 'rgba(255, 165, 0, 0.85)',
    label: 'Moderate',
  },
  light: {
    level: 1,
    color: 'rgba(255, 210, 90, 0.25)',
    stroke: 'rgba(255, 210, 90, 0.75)',
    label: 'Light',
  },
  default: {
    level: 1,
    color: 'rgba(255, 210, 90, 0.22)',
    stroke: 'rgba(255, 210, 90, 0.7)',
    label: 'Turbulence',
  },
};

/**
 * Map a G-AIRMET advisory's severity/hazard to a TURB_SEVERITY entry.
 */
export function getTurbulenceSeverity(advisory) {
  // Intensity comes from the `severity` field (LGT/MOD/SEV). hazard TURB-LO /
  // TURB-HI is an *altitude band* (below/above FL180), NOT an intensity — don't
  // conflate it with severity.
  const sev = (advisory.severity || '').toUpperCase();
  if (sev.includes('SEV')) return TURB_SEVERITY.severe;
  if (sev.includes('MOD')) return TURB_SEVERITY.moderate;
  if (sev.includes('LGT') || sev.includes('LIGHT')) return TURB_SEVERITY.light;
  return TURB_SEVERITY.default;
}

/**
 * Parse an advisory polygon (GeoJSON dict or coords array) into {lat, lon} verts.
 */
export function parseAdvisoryCoords(advisory) {
  const poly = advisory.polygon;
  if (poly && poly.type === 'Polygon' && Array.isArray(poly.coordinates?.[0])) {
    return poly.coordinates[0].map((c) => ({ lat: c[1], lon: c[0] }));
  }
  if (Array.isArray(advisory.coords)) {
    return advisory.coords.map((c) =>
      Array.isArray(c) ? { lat: c[1], lon: c[0] } : { lat: c.lat, lon: c.lon ?? c.lng }
    );
  }
  if (Array.isArray(poly)) {
    return poly.map((c) =>
      Array.isArray(c) ? { lat: c[1], lon: c[0] } : { lat: c.lat, lon: c.lon ?? c.lng }
    );
  }
  return [];
}

/** Ray-casting point-in-polygon over an array of {lat, lon} vertices. */
export function isPointInPolygon(lat, lon, polygon) {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].lon;
    const yi = polygon[i].lat;
    const xj = polygon[j].lon;
    const yj = polygon[j].lat;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Derive a turbulence map layer from the G-AIRMET advisories already in the app.
 *
 * Unlike useSigmetData this does NOT fetch — it filters the `advisories` array
 * (from useAirspaceAdvisories / useAviationData) down to the TURB* hazard slice
 * and exposes a canvas painter + point hit-test, mirroring useSigmetData's API.
 *
 * @param {Object} options
 * @param {boolean} options.enabled
 * @param {Array} options.advisories - Airspace advisories (all hazards).
 * @returns {{ turbulenceAreas: Array, count: number, drawOnCanvas: Function, getTurbulenceAtPoint: Function }}
 */
export function useTurbulenceOverlay({ enabled = false, advisories = [] } = {}) {
  const turbulenceAreas = useMemo(() => {
    if (!enabled || !Array.isArray(advisories)) return [];
    return advisories
      .filter((a) => (a.hazard || '').toUpperCase().startsWith('TURB'))
      .map((a) => ({
        id: a.advisory_id || a.id,
        hazard: a.hazard,
        severity: getTurbulenceSeverity(a),
        coords: parseAdvisoryCoords(a),
        lowerAltFt: a.lower_alt_ft,
        upperAltFt: a.upper_alt_ft,
        validFrom: a.valid_from,
        validTo: a.valid_to,
        rawText: a.raw_text,
      }))
      .filter((a) => a.coords.length >= 3);
  }, [enabled, advisories]);

  const getTurbulenceAtPoint = useCallback(
    (lat, lon) => {
      for (const area of turbulenceAreas) {
        if (isPointInPolygon(lat, lon, area.coords)) return area;
      }
      return null;
    },
    [turbulenceAreas]
  );

  const drawOnCanvas = useCallback(
    (ctx, latLonToScreen, opacity = 1.0) => {
      if (!turbulenceAreas.length) return;
      turbulenceAreas.forEach((area) => {
        const { coords, severity } = area;
        if (coords.length < 3) return;
        const screen = coords.map((c) => latLonToScreen(c.lat, c.lon));
        const visible = screen.some(
          (p) =>
            p.x >= -100 &&
            p.x <= ctx.canvas.width + 100 &&
            p.y >= -100 &&
            p.y <= ctx.canvas.height + 100
        );
        if (!visible) return;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(screen[0].x, screen[0].y);
        screen.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
        ctx.closePath();

        ctx.fillStyle = severity.color.replace(/[\d.]+\)$/, `${opacity * 0.3})`);
        ctx.fill();
        ctx.strokeStyle = severity.stroke.replace(/[\d.]+\)$/, `${opacity * 0.9})`);
        ctx.lineWidth = severity.level >= 3 ? 3 : 2;
        ctx.setLineDash([6, 4]); // dashed amber, distinct from convective solid red
        ctx.stroke();
        ctx.setLineDash([]);

        // Centroid label
        const cx = screen.reduce((s, p) => s + p.x, 0) / screen.length;
        const cy = screen.reduce((s, p) => s + p.y, 0) / screen.length;
        if (cx >= 0 && cx <= ctx.canvas.width && cy >= 0 && cy <= ctx.canvas.height) {
          ctx.font = 'bold 11px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const label = `TURB ${severity.label}`;
          const w = ctx.measureText(label).width + 8;
          ctx.fillStyle = `rgba(0, 0, 0, ${opacity * 0.7})`;
          ctx.fillRect(cx - w / 2, cy - 8, w, 16);
          ctx.fillStyle = severity.stroke.replace(/[\d.]+\)$/, `${opacity})`);
          ctx.fillText(label, cx, cy);
        }
        ctx.restore();
      });
    },
    [turbulenceAreas]
  );

  return {
    turbulenceAreas,
    count: turbulenceAreas.length,
    getTurbulenceAtPoint,
    drawOnCanvas,
  };
}

export default useTurbulenceOverlay;
