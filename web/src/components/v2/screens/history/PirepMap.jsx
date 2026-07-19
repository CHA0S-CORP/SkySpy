import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { aircraftArrowIcon, cssColor } from '../../../../utils/mapMarkerIcon';

const CARTO_DARK = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png';
const CARTO_ATTR = '© OpenStreetMap contributors © CARTO';
const NM_TO_M = 1852;

/**
 * Presentational mini-map for one PIREP: the reported position (hazard marker +
 * range ring) with the supplied nearby aircraft drawn as the shared
 * heading-rotated dart (matches every other SkySpy map — never dots). Data is
 * owned by the caller (the detail screen) and passed in via `nearby`.
 *
 * @param {object} props
 * @param {number} props.lat
 * @param {number} props.lon
 * @param {string} [props.station]
 * @param {string} [props.color]  hazard group color (hex) for the position marker
 * @param {number} [props.radiusNm]
 * @param {Array<{hex,flight,lat,lon,track,alt,nm}>} [props.nearby]
 * @param {(hex: string) => void} [props.onSelectAircraft]
 */
export function PirepMap({
  lat,
  lon,
  station,
  color,
  radiusNm = 60,
  nearby = [],
  onSelectAircraft,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const acRef = useRef(null);

  // Init map once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current || lat == null || lon == null) return undefined;
    const map = L.map(el, { zoomControl: false, attributionControl: true });
    mapRef.current = map;
    L.tileLayer(CARTO_DARK, { attribution: CARTO_ATTR, subdomains: 'abcd', maxZoom: 19 }).addTo(
      map
    );
    map.setView([lat, lon], 8);

    const hazard = color && color.startsWith('#') ? color : cssColor('--warn', '#f5b544');
    const base = L.layerGroup().addTo(map);
    L.circle([lat, lon], {
      radius: radiusNm * NM_TO_M,
      color: hazard,
      weight: 1,
      opacity: 0.5,
      fillColor: hazard,
      fillOpacity: 0.05,
      dashArray: '5, 5',
    }).addTo(base);
    L.marker([lat, lon], {
      icon: L.divIcon({
        className: 'v2-pirep__map-pin',
        html: `<span style="--c:${hazard}"></span>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      }),
      zIndexOffset: 1000,
    })
      .addTo(base)
      .bindTooltip(`PIREP · ${station || 'position'}`, { direction: 'top', offset: [0, -8] });

    map.fitBounds(L.latLng(lat, lon).toBounds(radiusNm * NM_TO_M * 2), { maxZoom: 9 });

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
      acRef.current = null;
    };
  }, [lat, lon, color, radiusNm, station]);

  // Redraw nearby aircraft whenever the list changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    acRef.current?.remove();
    const group = L.layerGroup().addTo(map);
    acRef.current = group;
    const acColor = cssColor('--accent2', '#7cc4ff');
    (nearby || []).forEach((a) => {
      L.marker([a.lat, a.lon], {
        icon: aircraftArrowIcon({ color: acColor, size: 20, track: a.track }),
      })
        .addTo(group)
        .bindTooltip(
          `${a.flight || a.hex?.toUpperCase() || 'unknown'} · ${
            a.alt != null ? `${Number(a.alt).toLocaleString()} ft` : '—'
          } · ${a.nm != null ? `${a.nm.toFixed(0)} nm` : ''}`,
          { direction: 'top', offset: [0, -6] }
        )
        .on('click', () => a.hex && onSelectAircraft?.(a.hex.toLowerCase()));
    });
  }, [nearby, onSelectAircraft]);

  if (lat == null || lon == null) return null;
  return <div ref={containerRef} className="v2-acars__map v2-pirep__map" />;
}

export default PirepMap;
