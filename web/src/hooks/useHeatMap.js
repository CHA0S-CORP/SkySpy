import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

/**
 * Heat Map color gradient function
 * Returns RGBA color string based on intensity (0-1)
 * Gradient: transparent -> blue -> cyan -> yellow -> red
 */
export function getHeatMapColor(intensity) {
  if (intensity <= 0) return 'rgba(0, 0, 255, 0)';
  if (intensity < 0.25) {
    // Blue with increasing opacity
    const alpha = intensity * 4;
    return `rgba(0, 100, 255, ${alpha * 0.6})`;
  }
  if (intensity < 0.5) {
    // Blue to Cyan transition
    const t = (intensity - 0.25) * 4;
    const g = Math.round(100 + t * 155);
    return `rgba(0, ${g}, 255, 0.65)`;
  }
  if (intensity < 0.75) {
    // Cyan to Yellow transition
    const t = (intensity - 0.5) * 4;
    const r = Math.round(t * 255);
    const b = Math.round(255 - t * 255);
    return `rgba(${r}, 255, ${b}, 0.7)`;
  }
  // Yellow to Red transition
  const t = (intensity - 0.75) * 4;
  const g = Math.round(255 - t * 155);
  return `rgba(255, ${g}, 0, 0.75)`;
}

/**
 * Draw heat map on canvas
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number[][]} heatMapData - 2D grid of counts
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @param {Object} options - Drawing options
 */
export function drawHeatMap(ctx, heatMapData, width, height, options = {}) {
  if (!heatMapData || !heatMapData.length) return;

  const gridSize = heatMapData.length;
  const cellWidth = width / gridSize;
  const cellHeight = height / gridSize;
  const maxValue = Math.max(...heatMapData.flat()) || 1;

  const { opacity = 0.6, blur = true, minOpacity = 0.1 } = options;

  ctx.save();

  // Apply blur for smoother appearance
  if (blur) {
    ctx.filter = 'blur(4px)';
  }

  heatMapData.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value === 0) return;

      const intensity = value / maxValue;
      const color = getHeatMapColor(intensity);

      ctx.fillStyle = color;
      ctx.globalAlpha = Math.max(minOpacity, Math.min(opacity, intensity + minOpacity));

      // Draw slightly larger cells with overlap for smoother look
      const overlap = blur ? 2 : 0;
      ctx.fillRect(
        x * cellWidth - overlap,
        y * cellHeight - overlap,
        cellWidth + overlap * 2,
        cellHeight + overlap * 2
      );
    });
  });

  ctx.restore();
}

/**
 * useHeatMap - Hook for traffic density heat map visualization
 *
 * Aggregates position data over time to create a heat map showing
 * high-traffic areas. Useful for antenna optimization and coverage analysis.
 *
 * @param {Object} options
 * @param {boolean} options.enabled - Whether heat map is enabled
 * @param {Object} options.feederLocation - { lat, lon } of receiver
 * @param {number} options.radarRange - Current radar range in nm
 * @param {Function} options.wsRequest - WebSocket request function
 * @param {boolean} options.wsConnected - WebSocket connection status
 * @param {string} options.apiBaseUrl - API base URL for REST fallback
 */
export function useHeatMap({
  enabled = false,
  feederLocation,
  radarRange = 50,
  wsRequest,
  wsConnected,
  apiBaseUrl = '',
}) {
  // Time period: '1h', '6h', '24h'
  const [timePeriod, setTimePeriod] = useState(() => {
    try {
      return localStorage.getItem('adsb-heatmap-time-period') || '1h';
    } catch {
      return '1h';
    }
  });
  // Grid resolution
  const [gridSize, setGridSize] = useState(() => {
    try {
      const saved = localStorage.getItem('adsb-heatmap-grid-size');
      return saved ? parseInt(saved, 10) : 50;
    } catch {
      return 50;
    }
  });
  // Opacity/intensity (0-1)
  const [opacity, setOpacity] = useState(() => {
    try {
      const saved = localStorage.getItem('adsb-heatmap-opacity');
      return saved ? parseFloat(saved) : 0.7;
    } catch {
      return 0.7;
    }
  });
  // Hide aircraft symbols when heat map is shown
  const [hideAircraft, setHideAircraft] = useState(() => {
    try {
      return localStorage.getItem('adsb-heatmap-hide-aircraft') === 'true';
    } catch {
      return false;
    }
  });
  // Generated heat map data (2D array)
  const [heatMapData, setHeatMapData] = useState(null);
  // Loading state
  const [loading, setLoading] = useState(false);
  // Error state
  const [error, setError] = useState(null);
  // Statistics
  const [stats, setStats] = useState({
    totalPositions: 0,
    peakCell: null,
    coveragePercent: 0,
    lastUpdated: null,
  });

  // In-memory position accumulator for live data
  const livePositionsRef = useRef([]);
  const lastFetchRef = useRef(null);

  // Get hours from time period
  const getHours = useCallback(() => {
    switch (timePeriod) {
      case '1h':
        return 1;
      case '6h':
        return 6;
      case '24h':
        return 24;
      default:
        return 1;
    }
  }, [timePeriod]);

  // Generate heat map grid from positions
  const generateHeatMap = useCallback(
    (positions) => {
      if (!positions || positions.length === 0 || !feederLocation) {
        return null;
      }

      const { lat: feederLat, lon: feederLon } = feederLocation;
      const degPerNm = 1 / 60;
      const lonScale = Math.cos((feederLat * Math.PI) / 180);

      // Calculate bounds based on radar range
      const latRange = radarRange * degPerNm * 2;
      const lonRange = (radarRange * degPerNm * 2) / lonScale;

      const minLat = feederLat - latRange / 2;
      const maxLat = feederLat + latRange / 2;
      const minLon = feederLon - lonRange / 2;
      const maxLon = feederLon + lonRange / 2;

      // Initialize grid
      const grid = Array(gridSize)
        .fill(null)
        .map(() => Array(gridSize).fill(0));

      let validPositions = 0;
      let peakValue = 0;
      let peakCell = null;

      // Populate grid
      positions.forEach((pos) => {
        const lat = pos.lat ?? pos.latitude;
        const lon = pos.lon ?? pos.longitude ?? pos.lng;

        if (lat == null || lon == null) return;

        // Check if position is within bounds
        if (lat < minLat || lat > maxLat || lon < minLon || lon > maxLon) return;

        // Map lat/lon to grid cell
        const x = Math.floor(((lon - minLon) / (maxLon - minLon)) * gridSize);
        const y = Math.floor(((maxLat - lat) / (maxLat - minLat)) * gridSize);

        if (x >= 0 && x < gridSize && y >= 0 && y < gridSize) {
          grid[y][x]++;
          validPositions++;

          if (grid[y][x] > peakValue) {
            peakValue = grid[y][x];
            peakCell = { x, y, count: grid[y][x] };
          }
        }
      });

      // Calculate coverage (cells with at least 1 position)
      const filledCells = grid.flat().filter((v) => v > 0).length;
      const coveragePercent = ((filledCells / (gridSize * gridSize)) * 100).toFixed(1);

      // Calculate peak cell geographic coordinates
      if (peakCell) {
        peakCell.lat = maxLat - ((peakCell.y + 0.5) / gridSize) * (maxLat - minLat);
        peakCell.lon = minLon + ((peakCell.x + 0.5) / gridSize) * (maxLon - minLon);
        peakCell.distanceNm = Math.sqrt(
          Math.pow((peakCell.lat - feederLat) * 60, 2) +
            Math.pow((peakCell.lon - feederLon) * 60 * lonScale, 2)
        ).toFixed(1);
        peakCell.bearing = (
          ((Math.atan2(
            (peakCell.lon - feederLon) * 60 * lonScale,
            (peakCell.lat - feederLat) * 60
          ) *
            180) /
            Math.PI +
            360) %
          360
        ).toFixed(0);
      }

      return {
        grid,
        stats: {
          totalPositions: validPositions,
          peakCell,
          coveragePercent,
          lastUpdated: Date.now(),
        },
      };
    },
    [feederLocation, radarRange, gridSize]
  );

  // Fetch historical positions from API
  const fetchHistoricalPositions = useCallback(async () => {
    if (!enabled || !feederLocation) return;

    const hours = getHours();
    const now = Date.now();

    // Prevent rapid refetching
    if (lastFetchRef.current && now - lastFetchRef.current < 30000) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let positions = [];

      // Try WebSocket first
      if (wsRequest && wsConnected) {
        const result = await wsRequest('history-positions', {
          hours,
          limit: 10000,
        });

        if (result?.positions) {
          positions = result.positions;
        } else if (result?.sightings) {
          positions = result.sightings;
        }
      }

      // Fallback to REST API
      if (positions.length === 0 && apiBaseUrl) {
        const response = await fetch(
          `${apiBaseUrl}/api/v1/sightings?hours=${hours}&limit=10000&fields=lat,lon,timestamp`
        );

        if (response.ok) {
          const data = await response.json();
          positions = data?.results || data?.sightings || [];
        }
      }

      // Combine with live accumulated positions
      const allPositions = [...positions, ...livePositionsRef.current];

      const result = generateHeatMap(allPositions);
      if (result) {
        setHeatMapData(result.grid);
        setStats(result.stats);
      }

      lastFetchRef.current = now;
    } catch (err) {
      console.error('[HeatMap] Failed to fetch positions:', err);
      setError(err.message || 'Failed to load heat map data');
    } finally {
      setLoading(false);
    }
  }, [enabled, feederLocation, getHours, wsRequest, wsConnected, apiBaseUrl, generateHeatMap]);

  // Add live position to accumulator
  const addLivePosition = useCallback(
    (position) => {
      if (!enabled) return;

      const hours = getHours();
      const cutoff = Date.now() - hours * 60 * 60 * 1000;

      // Add new position
      livePositionsRef.current.push({
        lat: position.lat,
        lon: position.lon,
        timestamp: Date.now(),
      });

      // Trim old positions
      livePositionsRef.current = livePositionsRef.current.filter((p) => p.timestamp >= cutoff);

      // Limit memory usage
      if (livePositionsRef.current.length > 50000) {
        livePositionsRef.current = livePositionsRef.current.slice(-40000);
      }
    },
    [enabled, getHours]
  );

  // Regenerate heat map from accumulated live data
  const regenerateFromLive = useCallback(() => {
    const result = generateHeatMap(livePositionsRef.current);
    if (result) {
      setHeatMapData(result.grid);
      setStats(result.stats);
    }
  }, [generateHeatMap]);

  // Clear heat map data
  const clearHeatMap = useCallback(() => {
    setHeatMapData(null);
    setStats({
      totalPositions: 0,
      peakCell: null,
      coveragePercent: 0,
      lastUpdated: null,
    });
    livePositionsRef.current = [];
  }, []);

  // Fetch data when enabled or time period changes
  useEffect(() => {
    if (enabled) {
      fetchHistoricalPositions();
    } else {
      clearHeatMap();
    }
  }, [enabled, timePeriod, fetchHistoricalPositions, clearHeatMap]);

  // Periodic refresh (every 2 minutes)
  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(() => {
      fetchHistoricalPositions();
    }, 120000);

    return () => clearInterval(interval);
  }, [enabled, fetchHistoricalPositions]);

  // Calculate bounds for drawing
  const bounds = useMemo(() => {
    if (!feederLocation) return null;

    const { lat: feederLat, lon: feederLon } = feederLocation;
    const degPerNm = 1 / 60;
    const lonScale = Math.cos((feederLat * Math.PI) / 180);

    const latRange = radarRange * degPerNm * 2;
    const lonRange = (radarRange * degPerNm * 2) / lonScale;

    return {
      minLat: feederLat - latRange / 2,
      maxLat: feederLat + latRange / 2,
      minLon: feederLon - lonRange / 2,
      maxLon: feederLon + lonRange / 2,
    };
  }, [feederLocation, radarRange]);

  // Persist settings to localStorage
  const handleSetTimePeriod = useCallback((value) => {
    setTimePeriod(value);
    try {
      localStorage.setItem('adsb-heatmap-time-period', value);
    } catch {
      // Ignore storage errors
    }
  }, []);

  const handleSetGridSize = useCallback((value) => {
    setGridSize(value);
    try {
      localStorage.setItem('adsb-heatmap-grid-size', String(value));
    } catch {
      // Ignore storage errors
    }
  }, []);

  const handleSetOpacity = useCallback((value) => {
    setOpacity(value);
    try {
      localStorage.setItem('adsb-heatmap-opacity', String(value));
    } catch {
      // Ignore storage errors
    }
  }, []);

  const handleSetHideAircraft = useCallback((value) => {
    setHideAircraft(value);
    try {
      localStorage.setItem('adsb-heatmap-hide-aircraft', String(value));
    } catch {
      // Ignore storage errors
    }
  }, []);

  return {
    // State
    enabled,
    heatMapData,
    timePeriod,
    gridSize,
    opacity,
    hideAircraft,
    loading,
    error,
    stats,
    bounds,

    // Actions
    setTimePeriod: handleSetTimePeriod,
    setGridSize: handleSetGridSize,
    setOpacity: handleSetOpacity,
    setHideAircraft: handleSetHideAircraft,
    addLivePosition,
    regenerateFromLive,
    clearHeatMap,
    refresh: fetchHistoricalPositions,
  };
}

// Time period options for UI
export const HEAT_MAP_TIME_PERIODS = [
  { value: '1h', label: '1 Hour' },
  { value: '6h', label: '6 Hours' },
  { value: '24h', label: '24 Hours' },
];

// Grid size options for UI
export const HEAT_MAP_GRID_SIZES = [
  { value: 25, label: 'Low (25x25)' },
  { value: 50, label: 'Medium (50x50)' },
  { value: 100, label: 'High (100x100)' },
];

export default useHeatMap;
