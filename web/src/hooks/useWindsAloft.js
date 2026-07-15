import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

/**
 * Standard altitude levels for winds aloft data (feet MSL)
 * These are the typical levels reported in FB (Winds/Temps) forecasts
 */
export const WINDS_ALOFT_LEVELS = [
  { value: 3000, label: '3,000 ft' },
  { value: 6000, label: '6,000 ft' },
  { value: 9000, label: '9,000 ft' },
  { value: 12000, label: '12,000 ft' },
  { value: 18000, label: 'FL180' },
  { value: 24000, label: 'FL240' },
  { value: 30000, label: 'FL300' },
  { value: 34000, label: 'FL340' },
  { value: 39000, label: 'FL390' },
];

/**
 * Wind speed color coding
 * Light winds: green, moderate: yellow, strong: red
 */
export function getWindColor(speed, opacity = 1.0) {
  if (speed < 15) {
    // Light winds (0-14 kt): Green
    return `rgba(0, 200, 0, ${opacity})`;
  } else if (speed < 25) {
    // Moderate winds (15-24 kt): Yellow-green
    return `rgba(150, 200, 0, ${opacity})`;
  } else if (speed < 35) {
    // Fresh winds (25-34 kt): Yellow
    return `rgba(255, 200, 0, ${opacity})`;
  } else if (speed < 50) {
    // Strong winds (35-49 kt): Orange
    return `rgba(255, 140, 0, ${opacity})`;
  } else if (speed < 75) {
    // Very strong winds (50-74 kt): Red
    return `rgba(255, 50, 0, ${opacity})`;
  } else {
    // Extreme winds (75+ kt): Magenta/purple for jet stream
    return `rgba(255, 0, 200, ${opacity})`;
  }
}

/**
 * Parse winds aloft data from Aviation Weather Center
 * Wind direction is in degrees TRUE, speed in knots
 * Format: DDDss or DDDssTTT (direction, speed, optionally temperature)
 * Light and variable is "9900" (0 knots)
 */
function parseWindsAloftCode(code) {
  // Light and variable is "9900", possibly followed by a temperature
  // group (e.g. "9900+15") - match on the prefix, not exact equality
  if (!code || code.trim() === '' || code.trim().startsWith('9900')) {
    return { direction: null, speed: 0, isLightVariable: true };
  }

  // Handle format: DDDss (e.g., "2725" = 270 deg at 25 kt)
  // or DDDssTT (with temp), or DDDsssTT (100+ kt winds)
  const dir = parseInt(code.slice(0, 2), 10) * 10;
  let speed;

  // Check for 100+ knot winds (direction offset by 50)
  if (dir > 360) {
    // Direction has 50 added (e.g., "7525" = 250 deg at 125 kt)
    return {
      direction: (dir - 500) % 360,
      speed: parseInt(code.slice(2, 4), 10) + 100,
      isLightVariable: false,
    };
  }

  speed = parseInt(code.slice(2, 4), 10);

  return {
    direction: dir === 0 ? 360 : dir, // 0 means 360 (north)
    speed,
    isLightVariable: false,
  };
}

/**
 * Calculate grid points for displaying wind barbs
 * Grid spacing adapts to the current view
 */
function calculateGridPoints(bounds, gridSpacing = 2) {
  const points = [];
  const { north, south, east, west } = bounds;

  const latStep = gridSpacing;
  const lonStep = gridSpacing;

  // Start from nice round numbers
  const startLat = Math.ceil(south / latStep) * latStep;
  const startLon = Math.ceil(west / lonStep) * lonStep;

  for (let lat = startLat; lat <= north; lat += latStep) {
    for (let lon = startLon; lon <= east; lon += lonStep) {
      points.push({ lat, lon });
    }
  }

  return points;
}

/**
 * Interpolate wind at a specific point from surrounding station data
 * Uses inverse distance weighting (IDW)
 */
function interpolateWind(lat, lon, stations, maxDistance = 300) {
  if (!stations || stations.length === 0) return null;

  let weightSum = 0;
  let dirX = 0;
  let dirY = 0;
  let speedSum = 0;

  for (const station of stations) {
    if (station.wind.speed === 0 && station.wind.isLightVariable) continue;

    // Calculate distance in nm (approximate)
    const dLat = (lat - station.lat) * 60;
    const dLon = (lon - station.lon) * 60 * Math.cos((lat * Math.PI) / 180);
    const distance = Math.sqrt(dLat * dLat + dLon * dLon);

    if (distance > maxDistance) continue;
    if (distance < 0.1) {
      // Very close to station - use directly
      return {
        direction: station.wind.direction,
        speed: station.wind.speed,
      };
    }

    // Inverse distance weight
    const weight = 1 / (distance * distance);
    weightSum += weight;

    // Convert direction to vector components for proper averaging
    const rad = ((station.wind.direction || 0) * Math.PI) / 180;
    dirX += Math.sin(rad) * weight;
    dirY += Math.cos(rad) * weight;
    speedSum += station.wind.speed * weight;
  }

  if (weightSum === 0) return null;

  // Calculate averaged direction
  const avgDirection =
    ((Math.atan2(dirX / weightSum, dirY / weightSum) * 180) / Math.PI + 360) % 360;
  const avgSpeed = speedSum / weightSum;

  return {
    direction: Math.round(avgDirection),
    speed: Math.round(avgSpeed),
  };
}

/**
 * Aviation Weather Center FB Winds URL
 * Uses their text bulletin data which is freely available
 */
const AWC_WINDS_URL = 'https://aviationweather.gov/api/data/windtemp';

/**
 * NOAA NDFD (National Digital Forecast Database) for gridded wind data
 * Alternative source with broader coverage
 */
const NOAA_NDFD_URL =
  'https://graphical.weather.gov/xml/sample_products/browser_interface/ndfdXMLclient.php';

/**
 * Parse station wind data for a given altitude level from a raw AWC response
 */
function parseStationsForLevel(data, level) {
  const stations = [];

  if (data && Array.isArray(data)) {
    data.forEach((item) => {
      if (!item.lat || !item.lon) return;

      // Find the wind for the requested level
      const levelKey = `${level}`;
      const windCode = item[levelKey] || item.winds?.[levelKey];

      if (windCode) {
        const wind = parseWindsAloftCode(windCode);
        stations.push({
          id: item.station || item.id,
          lat: parseFloat(item.lat),
          lon: parseFloat(item.lon),
          wind,
          level,
        });
      }
    });
  }

  return stations;
}

/**
 * useWindsAloft - Hook for winds aloft data overlay
 *
 * Fetches winds aloft forecast data from Aviation Weather Center
 * and provides interpolated wind data at grid points for display.
 *
 * @param {Object} options
 * @param {boolean} options.enabled - Whether winds overlay is enabled
 * @param {Object} options.feederLocation - { lat, lon } of receiver
 * @param {number} options.radarRange - Current radar range in nm
 * @param {number} options.selectedLevel - Altitude level in feet (from WINDS_ALOFT_LEVELS)
 */
export function useWindsAloft({
  enabled = false,
  feederLocation = null,
  radarRange = 50,
  selectedLevel = 6000,
}) {
  // Wind station data cache
  const [stationData, setStationData] = useState([]);
  // Grid of interpolated wind data
  const [windGrid, setWindGrid] = useState([]);
  // Loading state
  const [loading, setLoading] = useState(false);
  // Error state
  const [error, setError] = useState(null);
  // Last fetch timestamp
  const [lastFetch, setLastFetch] = useState(null);
  // Data validity time from forecast
  const [validTime, setValidTime] = useState(null);

  // Refs for cleanup and rate limiting
  const fetchTimeoutRef = useRef(null);
  const refreshIntervalRef = useRef(null);
  const lastFetchTimeRef = useRef(0);
  // Cache of the last raw API response so level changes can re-parse
  // without a network fetch (and without waiting out the rate limit)
  const rawDataRef = useRef(null);

  // Calculate bounds from feeder location and range
  const bounds = useMemo(() => {
    if (!feederLocation) return null;

    const { lat, lon } = feederLocation;
    const degPerNm = 1 / 60;
    const lonScale = Math.cos((lat * Math.PI) / 180);
    const latRange = radarRange * degPerNm * 1.5; // 50% buffer
    const lonRange = (radarRange * degPerNm * 1.5) / lonScale;

    return {
      north: lat + latRange,
      south: lat - latRange,
      east: lon + lonRange,
      west: lon - lonRange,
    };
  }, [feederLocation, radarRange]);

  // Calculate grid spacing based on radar range
  const gridSpacing = useMemo(() => {
    if (radarRange <= 25) return 0.5; // ~30nm grid
    if (radarRange <= 50) return 1.0; // ~60nm grid
    if (radarRange <= 100) return 2.0; // ~120nm grid
    return 3.0; // ~180nm grid for large ranges
  }, [radarRange]);

  /**
   * Fetch winds aloft data from AWC
   * Uses the FB (Winds/Temps Aloft) product
   */
  const fetchWindsData = useCallback(async () => {
    if (!enabled || !bounds) return;

    // Rate limit: don't fetch more than once per 5 minutes.
    // Level changes within the window re-parse the cached raw response so
    // the displayed winds always match the selected level.
    const now = Date.now();
    if (now - lastFetchTimeRef.current < 5 * 60 * 1000) {
      if (rawDataRef.current) {
        const stations = parseStationsForLevel(rawDataRef.current, selectedLevel);
        setStationData(stations);
        setError(stations.length === 0 ? 'No winds aloft data available for this level' : null);
      }
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Fetch from AWC API
      // The windtemp endpoint returns text data for FB (winds/temps) forecasts
      const params = new URLSearchParams({
        region: 'all', // All US regions
        level: 'low,high', // Both low (3k-24k) and high (24k-45k) levels
        fcst: '06,12,24', // 6, 12, 24 hour forecasts
        format: 'json',
      });

      const response = await fetch(`${AWC_WINDS_URL}?${params}`, {
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`AWC API returned ${response.status}`);
      }

      const data = await response.json();

      // Parse the winds aloft data (AWC returns station-based FB data)
      // and cache the raw response for level-change re-parsing
      rawDataRef.current = data && Array.isArray(data) ? data : null;
      const stations = parseStationsForLevel(data, selectedLevel);

      // Never fabricate winds - if the API returned nothing usable,
      // surface an empty state instead of rendering synthetic data
      if (stations.length === 0) {
        setError('No winds aloft data available for this level');
      }

      setStationData(stations);
      setLastFetch(new Date());
      lastFetchTimeRef.current = now;

      // Set valid time (typically 6-24 hours from issuance)
      setValidTime(new Date(now + 6 * 60 * 60 * 1000));
    } catch (err) {
      console.error('[WindsAloft] Fetch error:', err);
      setError(err.message || 'Failed to fetch winds aloft data');
      // Never fabricate winds - clear data and let the error state show
      setStationData([]);
    } finally {
      setLoading(false);
    }
  }, [enabled, bounds, selectedLevel]);

  /**
   * Generate wind grid from station data
   */
  const generateWindGrid = useCallback(() => {
    if (!bounds || stationData.length === 0) {
      setWindGrid([]);
      return;
    }

    const gridPoints = calculateGridPoints(bounds, gridSpacing);

    const grid = gridPoints
      .map((point) => {
        const wind = interpolateWind(point.lat, point.lon, stationData);
        return {
          ...point,
          wind: wind || { direction: 0, speed: 0 },
        };
      })
      .filter((point) => point.wind.speed > 0);

    setWindGrid(grid);
  }, [bounds, stationData, gridSpacing]);

  // Regenerate grid when station data or bounds change
  useEffect(() => {
    if (enabled && stationData.length > 0) {
      generateWindGrid();
    } else {
      setWindGrid([]);
    }
  }, [enabled, stationData, generateWindGrid]);

  // Fetch data when enabled
  useEffect(() => {
    if (enabled) {
      fetchWindsData();
    } else {
      setStationData([]);
      setWindGrid([]);
      setError(null);
    }
  }, [enabled, selectedLevel, fetchWindsData]);

  // Auto-refresh every hour
  useEffect(() => {
    if (!enabled) {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
      return;
    }

    refreshIntervalRef.current = setInterval(
      () => {
        lastFetchTimeRef.current = 0; // Allow refetch
        fetchWindsData();
      },
      60 * 60 * 1000
    ); // 1 hour

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [enabled, fetchWindsData]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    };
  }, []);

  // Manual refresh
  const refresh = useCallback(() => {
    lastFetchTimeRef.current = 0;
    fetchWindsData();
  }, [fetchWindsData]);

  // Clear data
  const clear = useCallback(() => {
    rawDataRef.current = null;
    setStationData([]);
    setWindGrid([]);
    setError(null);
    setLastFetch(null);
    setValidTime(null);
  }, []);

  // Format timestamp for display
  const timestampDisplay = useMemo(() => {
    if (!lastFetch) return null;

    const now = new Date();
    const diff = Math.floor((now - lastFetch) / 60000);

    if (diff < 1) return 'Just now';
    if (diff < 60) return `${diff} min ago`;

    return lastFetch.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  }, [lastFetch]);

  // Format valid time for display
  const validTimeDisplay = useMemo(() => {
    if (!validTime) return null;

    return validTime.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  }, [validTime]);

  return {
    // State
    enabled,
    windGrid,
    stationData,
    loading,
    error,
    lastFetch,
    validTime,
    timestampDisplay,
    validTimeDisplay,
    bounds,
    selectedLevel,

    // Actions
    refresh,
    clear,

    // Utilities
    getWindColor,
    levels: WINDS_ALOFT_LEVELS,
  };
}

export default useWindsAloft;
