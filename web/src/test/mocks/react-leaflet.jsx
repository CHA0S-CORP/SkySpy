// Mock for react-leaflet used in tests
import React from 'react';

export const MapContainer = ({ children, ...props }) => (
  <div data-testid="map-container" {...props}>{children}</div>
);

export const TileLayer = () => <div data-testid="tile-layer" />;

export const Polyline = ({ eventHandlers, pathOptions }) => (
  <div
    data-testid="polyline"
    data-color={pathOptions?.color}
    onClick={eventHandlers?.click}
  />
);

export const CircleMarker = ({ children }) => (
  <div data-testid="circle-marker">{children}</div>
);

export const Marker = ({ position }) => (
  <div
    data-testid="marker"
    data-lat={position?.[0]}
    data-lon={position?.[1]}
  />
);

export const useMap = () => ({
  fitBounds: () => {},
});
