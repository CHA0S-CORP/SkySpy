import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { aircraftArrowIcon, cssColor } from '../../../../utils/mapMarkerIcon';

const CARTO_DARK = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png';
const CARTO_ATTR = '© OpenStreetMap contributors © CARTO';

// Per-role marker styling. Origin/destination read as airports, waypoints as
// small navaid dots; the reported position uses the shared aircraft dart so it
// matches every other map.
const ROLE_COLOR = {
  origin: '--accent2',
  destination: '--warn',
  waypoint: '--dim2',
  position: '--accent',
};

function dotIcon(color, size) {
  return L.divIcon({
    className: 'v2-acars__wpt',
    html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:50%;background:${color};box-shadow:0 0 0 2px #05070a"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/**
 * Small Leaflet map for one ACARS message's resolved route
 * (origin → waypoints → destination) plus any reported position. Vanilla
 * Leaflet + CARTO dark basemap, consistent with the Detail/Live maps.
 *
 * @param {object} props
 * @param {Array<{name:string, role:string, lat:number, lon:number, type:string, label:string}>} props.points
 */
export function AcarsRouteMap({ points = [] }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return undefined;
    const map = L.map(el, { zoomControl: false, attributionControl: true });
    mapRef.current = map;
    L.tileLayer(CARTO_DARK, { attribution: CARTO_ATTR, subdomains: 'abcd', maxZoom: 19 }).addTo(
      map
    );
    map.setView([33.94, -118.4], 6);

    // The map often mounts inside a just-expanded row whose height is still
    // animating/zero on first paint, so Leaflet caches a 0×0 size and renders
    // blank. Recompute after layout settles and whenever the box resizes.
    const invalidate = () => mapRef.current?.invalidateSize();
    const raf = requestAnimationFrame(invalidate);
    const t = setTimeout(invalidate, 200);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(invalidate) : null;
    ro?.observe(el);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      ro?.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (layerRef.current) {
      layerRef.current.remove();
      layerRef.current = null;
    }
    const valid = points.filter((p) => typeof p.lat === 'number' && typeof p.lon === 'number');
    if (!valid.length) return;

    const group = L.layerGroup().addTo(map);
    layerRef.current = group;

    // Route line through the flight-plan legs (skip the standalone position).
    const legs = valid.filter((p) => p.role !== 'position').map((p) => [p.lat, p.lon]);
    if (legs.length > 1) {
      L.polyline(legs, {
        color: cssColor('--accent'),
        weight: 2,
        opacity: 0.85,
        dashArray: '6, 5',
        lineJoin: 'round',
      }).addTo(group);
    }

    valid.forEach((p) => {
      const color = cssColor(ROLE_COLOR[p.role] || '--dim2');
      const icon =
        p.role === 'position'
          ? aircraftArrowIcon({ color, size: 22 })
          : dotIcon(color, p.role === 'waypoint' ? 8 : 12);
      L.marker([p.lat, p.lon], { icon })
        .addTo(group)
        .bindTooltip(`${p.name}${p.label && p.label !== p.name ? ` · ${p.label}` : ''}`, {
          direction: 'top',
          offset: [0, -6],
        });
    });

    const bounds = L.latLngBounds(valid.map((p) => [p.lat, p.lon]));
    map.fitBounds(bounds, { padding: [26, 26], maxZoom: 9 });
  }, [points]);

  return <div ref={containerRef} className="v2-acars__map" />;
}

export default AcarsRouteMap;
