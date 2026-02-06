import React, { memo } from 'react';
import { useWeatherRadar, RADAR_COLOR_SCALE } from '../../../hooks/useWeatherRadar';

/**
 * Weather Radar Overlay Component
 *
 * Renders NEXRAD weather radar data on the Pro mode canvas.
 * Uses Iowa State Mesonet as the data source with auto-refresh.
 *
 * Features:
 * - Composite NEXRAD radar mosaic (CONUS)
 * - Standard NWS color scale (green -> yellow -> orange -> red -> purple)
 * - Configurable opacity (0-100%)
 * - Auto-refresh every 5 minutes
 * - Timestamp display
 *
 * @param {Object} props
 * @param {boolean} props.enabled - Whether radar is enabled
 * @param {Object} props.feederLocation - { lat, lon } receiver location
 * @param {number} props.radarRange - Current radar range in nm
 * @param {number} props.opacity - Overlay opacity (0-1)
 * @param {CanvasRenderingContext2D} props.ctx - Canvas context to draw on
 * @param {Function} props.latLonToScreen - Coordinate conversion function
 */
export const WeatherRadarOverlay = memo(function WeatherRadarOverlay({
  enabled,
  feederLocation,
  radarRange,
  opacity = 0.5,
  ctx,
  latLonToScreen,
}) {
  const {
    radarImage,
    radarBounds: _radarBounds,
    loading,
    error,
    timestampDisplay,
    drawOnCanvas,
    refresh,
  } = useWeatherRadar({
    enabled,
    feederLocation,
    radarRange,
    refreshInterval: 5 * 60 * 1000, // 5 minutes
  });

  // Draw radar on canvas when available
  React.useEffect(() => {
    if (!enabled || !ctx || !latLonToScreen || !radarImage) return;

    drawOnCanvas(ctx, latLonToScreen, opacity);
  }, [enabled, ctx, latLonToScreen, radarImage, opacity, drawOnCanvas]);

  // Return status info for parent component
  return {
    loading,
    error,
    timestampDisplay,
    refresh,
    hasData: !!radarImage,
  };
});

/**
 * Hook wrapper for weather radar in MapView
 * This makes it easier to integrate without major refactoring
 */
export function useWeatherRadarOverlay({ enabled, feederLocation, radarRange }) {
  const radar = useWeatherRadar({
    enabled,
    feederLocation,
    radarRange,
    refreshInterval: 5 * 60 * 1000,
  });

  return {
    // State
    radarImage: radar.radarImage,
    radarBounds: radar.radarBounds,
    loading: radar.loading,
    error: radar.error,
    timestampDisplay: radar.timestampDisplay,

    // Drawing function
    drawOnCanvas: radar.drawOnCanvas,

    // Actions
    refresh: radar.refresh,

    // Leaflet integration (for non-Pro mode)
    tileLayerUrl: radar.tileLayerUrl,
    wmsConfig: radar.wmsConfig,
  };
}

/**
 * Radar Legend Component
 * Shows color scale and current timestamp
 */
export const WeatherRadarLegend = memo(function WeatherRadarLegend({
  visible,
  timestamp,
  loading,
  onRefresh,
}) {
  if (!visible) return null;

  return (
    <div className="weather-radar-legend">
      <div className="radar-legend-header">
        <span>Weather Radar</span>
        {loading && <span className="radar-loading">Updating...</span>}
        {onRefresh && (
          <button
            className="radar-refresh-btn"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh radar"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        )}
      </div>

      <div className="radar-color-scale">
        {RADAR_COLOR_SCALE.map((scale, i) => {
          const { r, g, b } = scale.color;
          return (
            <div
              key={i}
              className="radar-color-swatch"
              style={{ backgroundColor: `rgb(${r}, ${g}, ${b})` }}
              title={`${scale.min}-${scale.max} dBZ: ${scale.label}`}
            />
          );
        })}
      </div>
      <div className="radar-scale-labels">
        <span>Light</span>
        <span>Heavy</span>
        <span>Extreme</span>
      </div>

      {timestamp && <div className="radar-timestamp">Data: {timestamp}</div>}
    </div>
  );
});

/**
 * CSS for Weather Radar components (inject via style tag or import)
 */
export const weatherRadarStyles = `
.weather-radar-legend {
  position: absolute;
  bottom: 60px;
  left: 16px;
  background: rgba(20, 30, 40, 0.95);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(80, 140, 200, 0.3);
  border-radius: 8px;
  padding: 10px 12px;
  min-width: 140px;
  z-index: 1000;
  font-size: 11px;
}

.radar-legend-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  color: rgba(150, 200, 255, 0.9);
  font-weight: 600;
}

.radar-loading {
  font-size: 10px;
  color: rgba(150, 200, 255, 0.5);
  animation: pulse 1s ease-in-out infinite;
}

.radar-refresh-btn {
  background: transparent;
  border: none;
  color: rgba(150, 200, 255, 0.6);
  cursor: pointer;
  padding: 2px;
  display: flex;
  align-items: center;
}

.radar-refresh-btn:hover {
  color: rgba(150, 200, 255, 1);
}

.radar-refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.radar-color-scale {
  display: flex;
  height: 12px;
  border-radius: 2px;
  overflow: hidden;
}

.radar-color-swatch {
  flex: 1;
}

.radar-scale-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  color: rgba(150, 200, 255, 0.6);
  font-size: 9px;
}

.radar-timestamp {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid rgba(80, 140, 200, 0.2);
  color: rgba(150, 200, 255, 0.5);
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
`;

export default WeatherRadarOverlay;
