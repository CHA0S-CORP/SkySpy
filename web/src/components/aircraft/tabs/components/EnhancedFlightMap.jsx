import { useMemo, useRef, useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * EnhancedFlightMap - Track colored by altitude/speed with click-to-jump and range rings
 */
export function EnhancedFlightMap({
  sightings = [],
  feederLocation,
  colorBy = 'altitude', // 'altitude', 'speed', 'time'
  showRangeRings = true,
  // showWaypoints = false, // Reserved for future use
  // selectedPosition = null, // Reserved for future use
  onPositionClick,
  replayPosition = null,
  height = 300,
  className = '',
}) {
  const mapRef = useRef(null);

  // Process sightings into track segments with colors
  const { trackSegments, bounds, startPos, endPos, minAlt, maxAlt, minSpeed, maxSpeed } =
    useMemo(() => {
      if (!sightings.length) {
        return {
          trackSegments: [],
          bounds: null,
          startPos: null,
          endPos: null,
          minAlt: 0,
          maxAlt: 45000,
          minSpeed: 0,
          maxSpeed: 500,
        };
      }

      const validSightings = sightings.filter((s) => s.lat && s.lon);
      if (!validSightings.length) {
        return {
          trackSegments: [],
          bounds: null,
          startPos: null,
          endPos: null,
          minAlt: 0,
          maxAlt: 45000,
          minSpeed: 0,
          maxSpeed: 500,
        };
      }

      // Calculate bounds
      const lats = validSightings.map((s) => s.lat);
      const lons = validSightings.map((s) => s.lon);
      const boundsObj = [
        [Math.min(...lats) - 0.05, Math.min(...lons) - 0.05],
        [Math.max(...lats) + 0.05, Math.max(...lons) + 0.05],
      ];

      // Include feeder location in bounds
      if (feederLocation) {
        boundsObj[0][0] = Math.min(boundsObj[0][0], feederLocation.lat - 0.05);
        boundsObj[0][1] = Math.min(boundsObj[0][1], feederLocation.lon - 0.05);
        boundsObj[1][0] = Math.max(boundsObj[1][0], feederLocation.lat + 0.05);
        boundsObj[1][1] = Math.max(boundsObj[1][1], feederLocation.lon + 0.05);
      }

      // Calculate min/max values
      const altitudes = validSightings.map((s) => s.altitude || 0).filter((a) => a > 0);
      const speeds = validSightings.map((s) => s.gs || 0).filter((s) => s > 0);
      const minA = altitudes.length ? Math.min(...altitudes) : 0;
      const maxA = altitudes.length ? Math.max(...altitudes) : 45000;
      const minS = speeds.length ? Math.min(...speeds) : 0;
      const maxS = speeds.length ? Math.max(...speeds) : 500;

      // Create colored segments
      const segments = [];
      for (let i = 0; i < validSightings.length - 1; i++) {
        const current = validSightings[i];
        const next = validSightings[i + 1];

        let color;
        if (colorBy === 'altitude') {
          const alt = current.altitude || 0;
          const normalizedAlt = maxA > minA ? (alt - minA) / (maxA - minA) : 0.5;
          color = getAltitudeColor(normalizedAlt);
        } else if (colorBy === 'speed') {
          const speed = current.gs || 0;
          const normalizedSpeed = maxS > minS ? (speed - minS) / (maxS - minS) : 0.5;
          color = getSpeedColor(normalizedSpeed);
        } else {
          // Color by time (gradient from start to end)
          const normalizedTime = i / (validSightings.length - 1);
          color = getTimeColor(normalizedTime);
        }

        segments.push({
          positions: [
            [current.lat, current.lon],
            [next.lat, next.lon],
          ],
          color,
          index: i,
          timestamp: current.timestamp,
          altitude: current.altitude,
          speed: current.gs,
        });
      }

      return {
        trackSegments: segments,
        bounds: boundsObj,
        startPos: validSightings[0],
        endPos: validSightings[validSightings.length - 1],
        minAlt: minA,
        maxAlt: maxA,
        minSpeed: minS,
        maxSpeed: maxS,
      };
    }, [sightings, colorBy, feederLocation]);

  // Color helper functions
  function getAltitudeColor(normalized) {
    // Blue (low) -> Green (mid) -> Red (high)
    if (normalized < 0.5) {
      const t = normalized * 2;
      return interpolateColor('#3b82f6', '#22c55e', t);
    } else {
      const t = (normalized - 0.5) * 2;
      return interpolateColor('#22c55e', '#ef4444', t);
    }
  }

  function getSpeedColor(normalized) {
    // Blue (slow) -> Yellow (mid) -> Orange (fast)
    if (normalized < 0.5) {
      const t = normalized * 2;
      return interpolateColor('#60a5fa', '#facc15', t);
    } else {
      const t = (normalized - 0.5) * 2;
      return interpolateColor('#facc15', '#f97316', t);
    }
  }

  function getTimeColor(normalized) {
    // Cyan (start) -> Purple (end)
    return interpolateColor('#00d4ff', '#a855f7', normalized);
  }

  function interpolateColor(color1, color2, t) {
    const c1 = hexToRgb(color1);
    const c2 = hexToRgb(color2);
    const r = Math.round(c1.r + (c2.r - c1.r) * t);
    const g = Math.round(c1.g + (c2.g - c1.g) * t);
    const b = Math.round(c1.b + (c2.b - c1.b) * t);
    return `rgb(${r}, ${g}, ${b})`;
  }

  function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
      : { r: 0, g: 0, b: 0 };
  }

  // Map fit bounds component
  function FitBounds({ bounds }) {
    const map = useMap();
    useEffect(() => {
      if (bounds && map) {
        map.fitBounds(bounds, { padding: [20, 20] });
      }
    }, [bounds, map]);
    return null;
  }

  // Range rings around feeder
  const rangeRings = useMemo(() => {
    if (!showRangeRings || !feederLocation) return [];
    return [25, 50, 100, 150].map((nm) => ({
      radius: nm * 1852, // Convert nm to meters
      label: `${nm}nm`,
    }));
  }, [showRangeRings, feederLocation]);

  // Create custom icons
  const startIcon = L.divIcon({
    className: 'custom-marker',
    html: `<div style="width:12px;height:12px;background:#f97316;border:2px solid white;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,0.3);"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });

  const endIcon = L.divIcon({
    className: 'custom-marker',
    html: `<div style="width:12px;height:12px;background:#22c55e;border:2px solid white;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,0.3);"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });

  const feederIcon = L.divIcon({
    className: 'custom-marker',
    html: `<div style="width:10px;height:10px;background:#ef4444;border:2px solid white;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,0.3);"></div>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });

  const replayIcon = L.divIcon({
    className: 'custom-marker',
    html: `<div style="width:16px;height:16px;background:#00d4ff;border:2px solid white;border-radius:50%;box-shadow:0 0 8px rgba(0,212,255,0.5);"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });

  if (!bounds) {
    return (
      <div
        className={`enhanced-flight-map enhanced-flight-map--empty ${className}`}
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          color: 'var(--text-dim)',
        }}
      >
        No position data available
      </div>
    );
  }

  return (
    <div className={`enhanced-flight-map ${className}`} style={{ height, position: 'relative' }}>
      <MapContainer
        ref={mapRef}
        bounds={bounds}
        style={{ height: '100%', width: '100%', borderRadius: '8px' }}
        zoomControl={false}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
        />

        <FitBounds bounds={bounds} />

        {/* Range rings */}
        {feederLocation &&
          rangeRings.map((ring) => (
            <CircleMarker
              key={`ring-${ring.radius}`}
              center={[feederLocation.lat, feederLocation.lon]}
              radius={0}
              pathOptions={{ color: 'transparent' }}
            >
              <circle
                cx="50%"
                cy="50%"
                r={ring.radius}
                stroke="rgba(90, 122, 154, 0.3)"
                strokeWidth="1"
                strokeDasharray="4,4"
                fill="none"
              />
            </CircleMarker>
          ))}

        {/* Track segments with color gradient */}
        {trackSegments.map((segment, i) => (
          <Polyline
            key={`segment-${segment.positions[0]?.[0]}-${segment.positions[0]?.[1]}-${i}`}
            positions={segment.positions}
            pathOptions={{
              color: segment.color,
              weight: 3,
              opacity: 0.8,
            }}
            eventHandlers={{
              click: () => onPositionClick?.(segment.index),
            }}
          />
        ))}

        {/* Start marker */}
        {startPos && <Marker position={[startPos.lat, startPos.lon]} icon={startIcon} />}

        {/* End marker */}
        {endPos && <Marker position={[endPos.lat, endPos.lon]} icon={endIcon} />}

        {/* Feeder location */}
        {feederLocation && (
          <Marker position={[feederLocation.lat, feederLocation.lon]} icon={feederIcon} />
        )}

        {/* Replay position */}
        {replayPosition && replayPosition.lat && replayPosition.lon && (
          <Marker position={[replayPosition.lat, replayPosition.lon]} icon={replayIcon} />
        )}
      </MapContainer>

      {/* Map controls */}
      <div className="enhanced-flight-map__controls">
        <button
          className="enhanced-flight-map__control-btn"
          onClick={() => mapRef.current?.fitBounds(bounds)}
          title="Fit to track"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M1 5V1H5M9 1H13V5M13 9V13H9M5 13H1V9"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {/* Legend */}
      <div className="enhanced-flight-map__legend">
        <div className="enhanced-flight-map__legend-item">
          <div className="enhanced-flight-map__legend-color" style={{ background: '#f97316' }} />
          <span>Start</span>
        </div>
        <div className="enhanced-flight-map__legend-item">
          <div className="enhanced-flight-map__legend-color" style={{ background: '#22c55e' }} />
          <span>End</span>
        </div>
        {feederLocation && (
          <div className="enhanced-flight-map__legend-item">
            <div className="enhanced-flight-map__legend-color" style={{ background: '#ef4444' }} />
            <span>Feeder</span>
          </div>
        )}
        <div className="enhanced-flight-map__legend-item">
          <div
            className="enhanced-flight-map__legend-color"
            style={{
              background:
                colorBy === 'altitude'
                  ? 'linear-gradient(90deg, #3b82f6, #22c55e, #ef4444)'
                  : colorBy === 'speed'
                    ? 'linear-gradient(90deg, #60a5fa, #facc15, #f97316)'
                    : 'linear-gradient(90deg, #00d4ff, #a855f7)',
              width: '40px',
            }}
          />
          <span>
            {colorBy === 'altitude'
              ? `${(minAlt / 1000).toFixed(0)}-${(maxAlt / 1000).toFixed(0)}k ft`
              : colorBy === 'speed'
                ? `${minSpeed}-${maxSpeed} kts`
                : 'Time'}
          </span>
        </div>
      </div>
    </div>
  );
}

EnhancedFlightMap.propTypes = {
  sightings: PropTypes.array,
  feederLocation: PropTypes.shape({
    lat: PropTypes.number,
    lon: PropTypes.number,
  }),
  colorBy: PropTypes.oneOf(['altitude', 'speed', 'time']),
  showRangeRings: PropTypes.bool,
  showWaypoints: PropTypes.bool,
  selectedPosition: PropTypes.number,
  onPositionClick: PropTypes.func,
  replayPosition: PropTypes.object,
  height: PropTypes.number,
  className: PropTypes.string,
};

export default EnhancedFlightMap;
