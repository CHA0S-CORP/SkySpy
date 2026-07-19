import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { aircraftArrowIcon, cssColor } from '../../../../utils/mapMarkerIcon';
import { parseAdvisoryCoords, getTurbulenceSeverity } from '../../../../hooks/useTurbulenceOverlay';
import { getFlightCategory, FLIGHT_CATEGORIES } from '../../../../utils/metarUtils';

const CARTO_DARK = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png';
const CARTO_ATTR = '© OpenStreetMap contributors © CARTO';

const PIREP_COLOR = (level) => {
  if (level >= 5) return cssColor('--danger') || '#f2585d';
  if (level >= 3) return cssColor('--warn') || '#f5b544';
  if (level >= 1) return cssColor('--accent2') || '#4cc9f0';
  return cssColor('--dim') || '#8b98a7';
};

/**
 * Compact weather situation map for the Weather screen. Vanilla Leaflet (the
 * project ships `leaflet`, not `react-leaflet`), CARTO dark basemap to match
 * every other map. Layers: G-AIRMET turbulence polygons (amber), METAR stations
 * (flight-category dots), PIREPs (severity circles), and aircraft the tracker
 * has flagged at moderate+ turbulence risk (heading darts).
 *
 * @param {object} props
 * @param {number|null} props.feederLat
 * @param {number|null} props.feederLon
 * @param {object[]} props.turbAdvisories - G-AIRMET TURB advisories (polygon)
 * @param {object[]} props.metars
 * @param {object[]} props.pireps
 * @param {object[]} props.atRisk - aircraft with turbulenceLevel moderate/severe
 * @param {(hex:string)=>void} [props.onSelectAircraft]
 */
export function WeatherMap({
  feederLat,
  feederLon,
  turbAdvisories = [],
  metars = [],
  pireps = [],
  atRisk = [],
  onSelectAircraft,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const onSelectRef = useRef(onSelectAircraft);
  onSelectRef.current = onSelectAircraft;

  // Init once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
      scrollWheelZoom: false,
    });
    map.on('focus click', () => map.scrollWheelZoom.enable());
    map.on('blur mouseout', () => map.scrollWheelZoom.disable());
    mapRef.current = map;
    L.tileLayer(CARTO_DARK, { attribution: CARTO_ATTR, subdomains: 'abcd', maxZoom: 12 }).addTo(
      map
    );
    map.setView([feederLat || 39, feederLon || -98], 6);
    setTimeout(() => map.invalidateSize(), 80);
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // feeder coords only seed the initial view; redraw effect reframes.
    // eslint-disable-next-line
  }, []);

  // Redraw all layers when data changes. Guarded end-to-end: fast tab-nav can
  // unmount the map mid-effect, so bail if the container is gone and swallow any
  // Leaflet teardown race (_leaflet_pos) rather than surfacing a page error.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map._container) return;
    try {
      redraw(map);
    } catch {
      /* map torn down mid-render — ignore */
    }
  }, [turbAdvisories, metars, pireps, atRisk, feederLat, feederLon]);

  function redraw(map) {
    if (layerRef.current) {
      layerRef.current.remove();
      layerRef.current = null;
    }
    const group = L.layerGroup();
    const bounds = [];

    // 1. Turbulence advisory polygons (amber, dashed).
    turbAdvisories.forEach((a) => {
      const coords = parseAdvisoryCoords(a);
      if (coords.length < 3) return;
      const sev = getTurbulenceSeverity(a);
      const latlngs = coords.map((c) => [c.lat, c.lon]);
      L.polygon(latlngs, {
        color: sev.stroke,
        weight: 1.5,
        opacity: 0.9,
        fillColor: sev.color,
        fillOpacity: 0.18,
        dashArray: '6 4',
      }).addTo(group);
      bounds.push(...latlngs);
    });

    // 2. METAR stations (flight-category dots).
    metars.forEach((m) => {
      const lat = m.lat ?? m.latitude;
      const lon = m.lon ?? m.longitude;
      if (typeof lat !== 'number' || typeof lon !== 'number') return;
      const cat = getFlightCategory(m) || 'VFR';
      const color = FLIGHT_CATEGORIES[cat]?.color || '#3ddc84';
      L.circleMarker([lat, lon], {
        radius: 3.5,
        color,
        weight: 1,
        fillColor: color,
        fillOpacity: 0.85,
      })
        .bindTooltip(`${m.icaoId || m.stationId || '—'} · ${cat}`, { direction: 'top' })
        .addTo(group);
      bounds.push([lat, lon]);
    });

    // 3. PIREPs (severity circles).
    pireps.forEach((p) => {
      const lat = p.lat ?? p.latitude;
      const lon = p.lon ?? p.longitude;
      if (typeof lat !== 'number' || typeof lon !== 'number') return;
      const info = p.turbType
        ? { LGT: 1, 'LGT-MOD': 2, MOD: 3, 'MOD-SEV': 4, SEV: 5, EXTRM: 6 }
        : {};
      const level = info[(p.turbType || '').toUpperCase()] || 0;
      const color = PIREP_COLOR(level);
      L.circleMarker([lat, lon], {
        radius: 4.5,
        color,
        weight: 1.5,
        fillColor: color,
        fillOpacity: 0.35,
      })
        .bindTooltip(`PIREP ${p.location || ''} ${p.turbType ? `· TURB ${p.turbType}` : ''}`, {
          direction: 'top',
        })
        .addTo(group);
      bounds.push([lat, lon]);
    });

    // 4. At-risk aircraft (heading darts).
    atRisk.forEach((ac) => {
      if (typeof ac.lat !== 'number' || typeof ac.lon !== 'number') return;
      const color =
        ac.turbulenceLevel === 'severe'
          ? cssColor('--danger') || '#f2585d'
          : cssColor('--warn') || '#f5b544';
      const marker = L.marker([ac.lat, ac.lon], {
        icon: aircraftArrowIcon({ track: ac.track || 0, color, size: 22 }),
        zIndexOffset: 500,
      }).bindTooltip(
        `${(ac.flight || '').trim() || ac.hex} · ${ac.turbulenceLevel} (${ac.turbulenceRisk ?? '?'})`,
        { direction: 'top' }
      );
      if (onSelectRef.current) marker.on('click', () => onSelectRef.current(ac.hex));
      marker.addTo(group);
      bounds.push([ac.lat, ac.lon]);
    });

    // 5. Feeder center reticle.
    if (typeof feederLat === 'number' && typeof feederLon === 'number') {
      L.circleMarker([feederLat, feederLon], {
        radius: 5,
        color: cssColor('--accent') || '#3ddc84',
        weight: 2,
        fillColor: 'transparent',
        fillOpacity: 0,
      })
        .bindTooltip('Receiver', { direction: 'top' })
        .addTo(group);
      bounds.push([feederLat, feederLon]);
    }

    group.addTo(map);
    layerRef.current = group;

    if (bounds.length >= 2) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [26, 26], maxZoom: 9 });
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 7);
    }
  }

  return <div ref={containerRef} className="v2-wx__map-leaflet" />;
}

export default WeatherMap;
