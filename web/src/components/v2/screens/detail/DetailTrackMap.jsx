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
    const container = containerRef.current;
    if (!container || mapRef.current) return undefined;
    // Touch devices: a one-finger drag must scroll the PAGE, not pan this inline
    // preview — Leaflet otherwise stamps touch-action:none on the container and
    // traps the scroll gesture the moment it starts over the map.
    const isTouch =
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window);
    const map = L.map(container, {
      zoomControl: false,
      attributionControl: true,
      // Inline preview inside a scrollable page: a plain wheel must scroll the
      // page (never zoom-trap it), and on touch a one-finger drag must scroll it.
      scrollWheelZoom: false,
      dragging: !isTouch,
      touchZoom: !isTouch,
      doubleClickZoom: !isTouch,
      tap: false,
    });
    let wheelHandler = null;
    if (isTouch) {
      // Leaflet still stamps touch-action:none from its gesture setup; restore
      // vertical page scrolling for a finger that starts over the map.
      container.style.touchAction = 'pan-y';
    } else {
      // Desktop: Ctrl/Cmd + wheel zooms the map; a plain wheel scrolls the page
      // (mirrors the "ctrl-scroll to zoom" affordance of an embedded Google Map).
      wheelHandler = (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        L.DomEvent.preventDefault(e);
        const zoom = map.getZoom() + (e.deltaY < 0 ? 1 : -1);
        map.setZoomAround(map.mouseEventToContainerPoint(e), zoom, { animate: false });
      };
      L.DomEvent.on(container, 'wheel', wheelHandler);
    }
    mapRef.current = map;
    L.tileLayer(CARTO_DARK, { attribution: CARTO_ATTR, subdomains: 'abcd', maxZoom: 19 }).addTo(
      map
    );
    map.setView([32.8, -117.2], 8);
    // The map often mounts before the detail layout settles (the airframe/track
    // fetch reflows the two-column grid), so a one-shot invalidateSize raced and
    // left tiles covering only a sub-rectangle. Re-invalidate on every resize.
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => map.invalidateSize()) : null;
    ro?.observe(container);
    const raf = requestAnimationFrame(() => map.invalidateSize());
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      if (wheelHandler) L.DomEvent.off(container, 'wheel', wheelHandler);
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
