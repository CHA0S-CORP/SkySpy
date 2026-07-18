import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { aircraftArrowIcon, cssColor } from '../../../../utils/mapMarkerIcon';

/**
 * Inline Leaflet map for assistant answers, rendered from a ```map fenced block.
 * Vanilla Leaflet (the project ships `leaflet`, not `react-leaflet`), matching
 * DetailTrackMap's CARTO dark basemap + shared aircraftArrowIcon.
 *
 * Spec shape:
 *   { title?: string, center?: [lat, lon], zoom?: number,
 *     points: [ { lat, lon, label?, hex?, callsign?, track?,
 *                 kind?: 'aircraft'|'airport'|'pirep'|'event' } ] }
 *
 * Aircraft points get the heading dart + a popup linking to #airframe?icao=…;
 * other kinds get a colored dot. The view fits all points.
 */

const CARTO_DARK = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png';
const CARTO_ATTR = '© OpenStreetMap contributors © CARTO';

const KIND_COLOR = {
  airport: '--accent',
  pirep: '--warn',
  event: '--danger',
  default: '--accent',
};

function popupHtml(p) {
  const title = p.callsign || p.hex || p.label || 'Point';
  const bits = [];
  if (p.hex) bits.push(`hex ${p.hex}`);
  if (p.altitude != null) bits.push(`alt ${p.altitude}`);
  if (p.distance_nm != null) bits.push(`${Number(p.distance_nm).toFixed(0)} nm`);
  const link = p.hex
    ? `<a href="#airframe?icao=${p.hex}">open detail</a>`
    : p.callsign
      ? `<a href="#airframe?call=${p.callsign}">open detail</a>`
      : '';
  return `<b>${title}</b><br>${bits.join(' · ')}${link ? `<br>${link}` : ''}`;
}

export function AssistantMap({ spec }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: false, attributionControl: true });
    mapRef.current = map;
    L.tileLayer(CARTO_DARK, { attribution: CARTO_ATTR, subdomains: 'abcd', maxZoom: 18 }).addTo(
      map
    );
    map.setView(spec?.center || [39, -98], spec?.zoom || 4);
    setTimeout(() => map.invalidateSize(), 60);
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Init once — subsequent point changes handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const points = (spec?.points || []).filter(
      (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon))
    );
    if (!points.length) return;
    const group = L.featureGroup();
    for (const p of points) {
      const lat = Number(p.lat);
      const lon = Number(p.lon);
      const isAircraft = !p.kind || p.kind === 'aircraft';
      const marker = isAircraft
        ? L.marker([lat, lon], {
            icon: aircraftArrowIcon({
              track: Number(p.track) || 0,
              color: p.military ? cssColor('--danger', '#e0774a') : cssColor('--accent', '#3ddc84'),
              size: 20,
            }),
          })
        : L.circleMarker([lat, lon], {
            radius: 6,
            color: cssColor(KIND_COLOR[p.kind] || KIND_COLOR.default, '#3ddc84'),
            fillOpacity: 0.7,
            weight: 1.5,
          });
      marker.bindPopup(popupHtml(p));
      marker.addTo(group);
    }
    group.addTo(map);
    if (group.getLayers().length) {
      if (group.getLayers().length === 1) map.setView(group.getBounds().getCenter(), 9);
      else map.fitBounds(group.getBounds(), { padding: [24, 24], maxZoom: 11 });
    }
    return () => group.remove();
  }, [spec]);

  return (
    <figure className="v2-asst-map">
      {spec?.title ? <figcaption className="v2-asst-chart__title">{spec.title}</figcaption> : null}
      <div ref={containerRef} className="v2-asst-map__canvas" />
    </figure>
  );
}

export default AssistantMap;
