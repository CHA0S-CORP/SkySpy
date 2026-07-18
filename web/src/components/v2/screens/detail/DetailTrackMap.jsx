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
 * @param {object} props
 * @param {Array<{lat:number, lon:number}>} props.points - track points (lat/lon)
 * @param {{lat:number, lon:number, track?:number}|null} props.replayPoint - scrubber position
 * @param {{lat:number, lon:number, track?:number}|null} props.livePoint - current live position
 */
export function DetailTrackMap({ points = [], replayPoint = null, livePoint = null }) {
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
    });
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

  // Draw / update the track polyline and fit bounds when points change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const latlngs = points
      .filter((p) => typeof p.lat === 'number' && typeof p.lon === 'number')
      .map((p) => [p.lat, p.lon]);
    if (trackRef.current) {
      trackRef.current.remove();
      trackRef.current = null;
    }
    if (latlngs.length < 2) return;
    trackRef.current = L.polyline(latlngs, {
      color:
        getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3ddc84',
      weight: 2.5,
      opacity: 0.95,
      lineJoin: 'round',
      lineCap: 'round',
    }).addTo(map);
    map.fitBounds(trackRef.current.getBounds(), { padding: [24, 24] });
  }, [points]);

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
