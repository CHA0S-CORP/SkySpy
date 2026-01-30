/**
 * Safety map utilities for Leaflet
 */
import L from 'leaflet';

/**
 * Create aircraft icon for map
 */
export function createAircraftIcon(track, color) {
  const rotation = track || 0;
  return L.divIcon({
    className: 'safety-aircraft-marker',
    html: `
      <svg width="24" height="24" viewBox="0 0 24 24" style="transform: rotate(${rotation}deg)">
        <path d="M12 2 L14 8 L20 10 L14 12 L14 18 L12 16 L10 18 L10 12 L4 10 L10 8 Z"
              fill="${color}" stroke="#000" stroke-width="0.5"/>
      </svg>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
}

/**
 * Get interpolated position for safety replay
 */
export function getInterpolatedPosition(positions, percentage) {
  if (!positions || positions.length === 0) return null;
  if (positions.length === 1) return positions[0];

  const ordered = [...positions].reverse();
  const exactIndex = (percentage / 100) * (ordered.length - 1);
  const lowerIndex = Math.floor(exactIndex);
  const upperIndex = Math.min(lowerIndex + 1, ordered.length - 1);
  const fraction = exactIndex - lowerIndex;

  if (lowerIndex === upperIndex || fraction === 0) return ordered[lowerIndex];

  const p1 = ordered[lowerIndex];
  const p2 = ordered[upperIndex];

  const lerp = (v1, v2, t) => {
    if (v1 == null) return v2;
    if (v2 == null) return v1;
    return v1 + (v2 - v1) * t;
  };

  const lerpAngle = (a1, a2, t) => {
    if (a1 == null || a2 == null) return a1;
    let diff = a2 - a1;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    return ((a1 + diff * t) + 360) % 360;
  };

  return {
    ...p1,
    lat: lerp(p1.lat, p2.lat, fraction),
    lon: lerp(p1.lon, p2.lon, fraction),
    altitude: Math.round(lerp(p1.altitude, p2.altitude, fraction)),
    gs: lerp(p1.gs, p2.gs, fraction),
    vr: Math.round(lerp(p1.vr, p2.vr, fraction)),
    track: lerpAngle(p1.track, p2.track, fraction),
  };
}

/**
 * Helper to safely parse JSON from fetch response
 */
export async function safeJson(res) {
  if (!res.ok) return null;
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) return null;
  try { return await res.json(); } catch { return null; }
}
