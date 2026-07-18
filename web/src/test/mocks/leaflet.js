// Mock for vanilla `leaflet` (L) used in tests. jsdom has no layout, so real
// Leaflet crashes on init/render (null renderer). This provides chainable
// no-op stand-ins for the handful of factory + layer methods the app uses.
const chainable = () => {
  const obj = {
    addTo: () => obj,
    remove: () => obj,
    setLatLng: () => obj,
    setIcon: () => obj,
    setView: () => obj,
    panTo: () => obj,
    fitBounds: () => obj,
    getBounds: () => ({ pad: () => ({ contains: () => true }) }),
    invalidateSize: () => obj,
    on: () => obj,
    off: () => obj,
    setZIndex: () => obj,
    createPane: () => ({ style: {} }),
    getPane: () => ({ style: {} }),
    getZoom: () => 8,
  };
  return obj;
};

const L = {
  map: () => chainable(),
  tileLayer: () => chainable(),
  polyline: () => chainable(),
  marker: () => chainable(),
  circle: () => chainable(),
  circleMarker: () => chainable(),
  divIcon: () => ({}),
};

export default L;
export const map = L.map;
export const tileLayer = L.tileLayer;
export const polyline = L.polyline;
export const marker = L.marker;
export const circle = L.circle;
export const circleMarker = L.circleMarker;
export const divIcon = L.divIcon;
