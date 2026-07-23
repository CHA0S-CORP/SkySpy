import { useEffect, useRef } from 'react';
import L from 'leaflet';

const CARTO_DARK = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png';
const CARTO_ATTR = '© OpenStreetMap contributors © CARTO';
const RING_NM = [25, 50, 100];
const NM_TO_M = 1852;
const VIEW_KEY = 'skyspy:livemap:view';

/** Load a persisted {lat, lon, zoom} map view, or null if none/invalid. */
function loadSavedView() {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (typeof v?.lat === 'number' && typeof v?.lon === 'number' && typeof v?.zoom === 'number') {
      return v;
    }
  } catch {
    // ignore corrupt/blocked storage
  }
  return null;
}

function saveView(map) {
  try {
    const c = map.getCenter();
    localStorage.setItem(VIEW_KEY, JSON.stringify({ lat: c.lat, lon: c.lng, zoom: map.getZoom() }));
  } catch {
    // ignore quota/blocked storage
  }
}

/**
 * Live Map Leaflet setup: CARTO dark basemap, feeder-centered range rings in
 * a dedicated pane, and a cyan sensor dot. Returns refs the view wires markers
 * and overlays onto.
 *
 * @param {object} opts
 * @param {React.RefObject<HTMLElement>} opts.containerRef
 * @param {{lat: number, lon: number}} opts.feeder
 * @param {boolean} opts.active - only init while the map tab is active
 */
export function useLiveLeafletMap({ containerRef, feeder, active }) {
  const mapRef = useRef(null);
  const ringsRef = useRef([]);
  const sensorRef = useRef(null);
  const centeredOnFeederRef = useRef(false);

  useEffect(() => {
    if (!active || !containerRef.current || mapRef.current) return undefined;

    const saved = loadSavedView();
    // rings/sensor always sit on the feeder; only the *view* honors saved state
    const center = [feeder?.lat ?? 32.8, feeder?.lon ?? -117.2];
    const map = L.map(containerRef.current, {
      center: saved ? [saved.lat, saved.lon] : center,
      zoom: saved ? saved.zoom : 9,
      zoomControl: true,
      attributionControl: true,
    });
    mapRef.current = map;

    // persist center + zoom so a refresh restores the user's view
    map.on('moveend', () => saveView(map));

    L.tileLayer(CARTO_DARK, { attribution: CARTO_ATTR, subdomains: 'abcd', maxZoom: 19 }).addTo(
      map
    );

    // range rings pane (below markers, non-interactive)
    map.createPane('lm-rings');
    map.getPane('lm-rings').style.zIndex = 450;
    map.getPane('lm-rings').style.pointerEvents = 'none';

    ringsRef.current = RING_NM.map((nm, i) =>
      L.circle(center, {
        pane: 'lm-rings',
        radius: nm * NM_TO_M,
        fill: false,
        color: '#3ddc84',
        weight: 1,
        opacity: i === 0 ? 0.22 : 0.12,
        dashArray: i === 0 ? null : '4 6',
      }).addTo(map)
    );

    // sensor dot
    const sensor = L.divIcon({
      className: 'lm-sensor',
      html: '<span></span>',
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });
    sensorRef.current = L.marker(center, {
      icon: sensor,
      interactive: false,
      pane: 'lm-rings',
    }).addTo(map);
    // a restored view already positions the map — don't let the async feeder
    // resolve yank it back to the antenna
    centeredOnFeederRef.current = saved != null || feeder?.lat != null;

    setTimeout(() => map.invalidateSize(), 100);

    return () => {
      map.remove();
      mapRef.current = null;
      ringsRef.current = [];
      sensorRef.current = null;
    };
    // feeder only used for the initial center; re-centering handled separately
  }, [active]);

  // keep rings + sensor dot centered when the feeder location resolves after
  // init (status arrives async, so first mount uses the fallback center)
  useEffect(() => {
    if (!mapRef.current || feeder?.lat == null) return;
    const c = [feeder.lat, feeder.lon];
    ringsRef.current.forEach((ring) => ring.setLatLng(c));
    sensorRef.current?.setLatLng(c);
    if (!centeredOnFeederRef.current) {
      // one-time recenter off the hardcoded fallback; never yank the view
      // after the user has a real center
      centeredOnFeederRef.current = true;
      mapRef.current.setView(c, mapRef.current.getZoom());
    }
  }, [feeder]);

  return { mapRef };
}
