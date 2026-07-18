import L from 'leaflet';

// Heading-rotated aircraft dart matching the Live Map canvas symbology
// (render/symbology.js drawDart): nose up, swept wings, tucked tail. Centered in
// a 0 0 24 24 viewBox so every map (Live, Detail, Safety) shows the same symbol.
const DART_PATH = 'M12 3.5 L19 20.5 L12 15.4 L5 20.5 Z';
// Heading tick / lead indicator extending off the nose (drawDart's nose tick).
const LEAD_LINE = { x1: 12, y1: 3.5, x2: 12, y2: 0.5 };

/**
 * Build a Leaflet divIcon of a heading-rotated aircraft dart.
 *
 * @param {object} opts
 * @param {number} [opts.track] - heading in degrees (0 = north/up)
 * @param {string} [opts.color] - fill color (resolved CSS value or hex)
 * @param {number} [opts.size] - icon box size in px
 * @param {boolean} [opts.pulse] - add the live pulsing glow
 * @param {string} [opts.className] - extra class(es)
 * @returns {L.DivIcon}
 */
export function aircraftArrowIcon({
  track = 0,
  color = '#3ddc84',
  size = 26,
  pulse = false,
  className = '',
} = {}) {
  const rot = Number.isFinite(track) ? track : 0;
  const cls = ['v2-map-arrow', pulse ? 'v2-map-arrow--live' : '', className]
    .filter(Boolean)
    .join(' ');
  return L.divIcon({
    className: cls,
    html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="transform: rotate(${rot}deg)"><line x1="${LEAD_LINE.x1}" y1="${LEAD_LINE.y1}" x2="${LEAD_LINE.x2}" y2="${LEAD_LINE.y2}" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/><path d="${DART_PATH}" fill="${color}" stroke="#05070a" stroke-width="1" stroke-linejoin="round"/></svg>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/** Resolve a CSS custom property to a concrete color (SVG fill can't use var()). */
export function cssColor(varName, fallback = '#3ddc84') {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return v || fallback;
}
