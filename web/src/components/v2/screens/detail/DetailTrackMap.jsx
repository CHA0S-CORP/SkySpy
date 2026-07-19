import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { aircraftArrowIcon, cssColor } from '../../../../utils/mapMarkerIcon';

const CARTO_DARK = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png';
const CARTO_ATTR = '© OpenStreetMap contributors © CARTO';

/**
 * Geographic track map for the Aircraft Detail screen. Vanilla Leaflet (the
 * project ships `leaflet`, not `react-leaflet`) with the same CARTO dark
 * basemap as the Live Map, an accent-colored track polyline fit to its bounds,
 * and a playback marker driven by the detail screen's scrubber.
 *
 * Aircraft positions render as the same heading-rotated dart the Live Map uses
 * (via aircraftArrowIcon) so every map is visually consistent.
 *
 * When `flights` (a list of per-leg point arrays) is supplied, every leg is drawn
 * as a faint gray line and the `activeIndex` leg is highlighted in accent, so the
 * whole recorded history stays framed while one flight is played back.
 *
 * @param {object} props
 * @param {Array<{lat:number, lon:number}>} props.points - active leg track points (lat/lon)
 * @param {Array<Array<{lat:number, lon:number}>>} [props.flights] - all legs (dimmed backdrop)
 * @param {number} [props.activeIndex] - index of the highlighted leg in `flights`
 * @param {{lat:number, lon:number, track?:number}|null} props.replayPoint - scrubber position
 * @param {{lat:number, lon:number, track?:number}|null} props.livePoint - current live position
 */
export function DetailTrackMap({
  points = [],
  flights = null,
  activeIndex = 0,
  replayPoint = null,
  livePoint = null,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const trackRef = useRef(null);
  const markerRef = useRef(null);
  const liveMarkerRef = useRef(null);

  // Init map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
      // Inline preview inside a scrollable detail page — don't trap the page
      // scroll when the pointer is over the map. Wheel zoom only after click.
      scrollWheelZoom: false,
    });
    // Enable wheel-zoom once the user clicks into the map, disable on leave so
    // scrolling past it keeps moving the page.
    map.on('focus click', () => map.scrollWheelZoom.enable());
    map.on('blur mouseout', () => map.scrollWheelZoom.disable());
    mapRef.current = map;
    L.tileLayer(CARTO_DARK, { attribution: CARTO_ATTR, subdomains: 'abcd', maxZoom: 19 }).addTo(
      map
    );
    map.setView([32.8, -117.2], 8);
    setTimeout(() => map.invalidateSize(), 80);
    return () => {
      map.remove();
      mapRef.current = null;
      trackRef.current = null;
      markerRef.current = null;
      liveMarkerRef.current = null;
    };
  }, []);

  // Draw the flight legs (dim backdrop + highlighted active leg) and fit bounds
  // to the whole recorded history when the tracks change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (trackRef.current) {
      trackRef.current.remove();
      trackRef.current = null;
    }
    const accent = cssColor('--accent') || '#3ddc84';
    const dim = cssColor('--dim2') || '#5a6472';
    const toLatLngs = (leg) =>
      (leg || [])
        .filter((p) => typeof p.lat === 'number' && typeof p.lon === 'number')
        .map((p) => [p.lat, p.lon]);
    // Prefer the per-leg list; fall back to the single active track.
    const legs = Array.isArray(flights) && flights.length ? flights : points.length ? [points] : [];
    const group = L.layerGroup();
    const allLatLngs = [];
    // Inactive legs first (underneath), active leg last so it draws on top.
    const drawLeg = (leg, active) => {
      const latlngs = toLatLngs(leg);
      if (latlngs.length < 2) return;
      L.polyline(latlngs, {
        color: active ? accent : dim,
        weight: active ? 2.5 : 1.5,
        opacity: active ? 0.95 : 0.35,
        lineJoin: 'round',
        lineCap: 'round',
      }).addTo(group);
      allLatLngs.push(...latlngs);
    };
    legs.forEach((leg, i) => {
      if (i === activeIndex && legs.length > 1) return;
      drawLeg(leg, legs.length === 1);
    });
    if (legs.length > 1 && legs[activeIndex]) drawLeg(legs[activeIndex], true);
    if (allLatLngs.length < 2) return;
    group.addTo(map);
    trackRef.current = group;
    map.fitBounds(L.latLngBounds(allLatLngs), { padding: [24, 24] });
  }, [points, flights, activeIndex]);

  // Move the playback marker; create it lazily.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (
      !replayPoint ||
      typeof replayPoint.lat !== 'number' ||
      typeof replayPoint.lon !== 'number'
    ) {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      return;
    }
    const pos = [replayPoint.lat, replayPoint.lon];
    const icon = aircraftArrowIcon({
      track: replayPoint.track,
      color: cssColor('--accent'),
      size: 22,
    });
    if (!markerRef.current) {
      markerRef.current = L.marker(pos, { icon, interactive: false }).addTo(map);
    } else {
      markerRef.current.setLatLng(pos);
      markerRef.current.setIcon(icon);
    }
  }, [replayPoint]);

  // Live position marker: the pulsing heading dart. Pans the map only when the
  // aircraft drifts out of view so it doesn't fight the track framing.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!livePoint || typeof livePoint.lat !== 'number' || typeof livePoint.lon !== 'number') {
      if (liveMarkerRef.current) {
        liveMarkerRef.current.remove();
        liveMarkerRef.current = null;
      }
      return;
    }
    const pos = [livePoint.lat, livePoint.lon];
    const icon = aircraftArrowIcon({
      track: livePoint.track,
      color: cssColor('--accent'),
      size: 28,
      pulse: true,
    });
    if (!liveMarkerRef.current) {
      liveMarkerRef.current = L.marker(pos, {
        icon,
        interactive: false,
        zIndexOffset: 1000,
      }).addTo(map);
    } else {
      liveMarkerRef.current.setLatLng(pos);
      liveMarkerRef.current.setIcon(icon);
    }
    if (!map.getBounds().pad(-0.08).contains(pos)) {
      map.panTo(pos, { animate: true });
    }
  }, [livePoint]);

  return <div ref={containerRef} className="v2-det__map-leaflet" />;
}
