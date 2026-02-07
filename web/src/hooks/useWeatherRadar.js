import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

/**
 * NEXRAD Weather Radar color scale
 * Maps reflectivity (dBZ) to colors using NWS standard scale:
 * - Green (20-35 dBZ): Light rain
 * - Yellow (35-45 dBZ): Moderate rain
 * - Orange (45-50 dBZ): Heavy rain
 * - Red (50-60 dBZ): Very heavy rain / hail possible
 * - Purple (60+ dBZ): Extreme / large hail
 */
export const RADAR_COLOR_SCALE = [
  { min: 5, max: 20, color: { r: 0, g: 100, b: 0 }, label: 'Light' },
  { min: 20, max: 35, color: { r: 0, g: 200, b: 0 }, label: 'Light Rain' },
  { min: 35, max: 40, color: { r: 255, g: 255, b: 0 }, label: 'Moderate' },
  { min: 40, max: 45, color: { r: 255, g: 200, b: 0 }, label: 'Moderate Rain' },
  { min: 45, max: 50, color: { r: 255, g: 140, b: 0 }, label: 'Heavy' },
  { min: 50, max: 55, color: { r: 255, g: 0, b: 0 }, label: 'Very Heavy' },
  { min: 55, max: 60, color: { r: 200, g: 0, b: 0 }, label: 'Intense' },
  { min: 60, max: 70, color: { r: 200, b: 0, g: 100 }, label: 'Extreme' },
  { min: 70, max: 100, color: { r: 255, g: 0, b: 255 }, label: 'Hail' },
];

/**
 * Get RGBA color string for a given dBZ value
 * @param {number} dbz - Reflectivity in dBZ
 * @param {number} opacity - Opacity (0-1)
 * @returns {string} RGBA color string
 */
export function getRadarColor(dbz, opacity = 0.7) {
  if (dbz < 5) return 'transparent';

  for (const scale of RADAR_COLOR_SCALE) {
    if (dbz >= scale.min && dbz < scale.max) {
      const { r, g, b } = scale.color;
      return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }
  }
  // Default to purple for extreme values
  return `rgba(255, 0, 255, ${opacity})`;
}

/**
 * Iowa State Mesonet NEXRAD tile URL generator
 * Uses their WMS service for CONUS composite radar
 * @see https://mesonet.agron.iastate.edu/docs/nexrad_mosaic/
 */
const MESONET_BASE_URL = 'https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q.cgi';

/**
 * NWS Ridge2 radar tile service (CONUS composite)
 * Alternative source with good coverage
 */
const NWS_RIDGE_URL = 'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows';

/**
 * Generate WMS URL for weather radar tiles
 * @param {Object} bounds - Map bounds {north, south, east, west}
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {string} source - 'mesonet' or 'nws'
 * @returns {string} WMS request URL
 */
export function getRadarTileUrl(bounds, width, height, source = 'mesonet') {
  const { north, south, east, west } = bounds;
  const bbox = `${west},${south},${east},${north}`;

  if (source === 'nws') {
    return `${NWS_RIDGE_URL}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=true&LAYERS=conus_bref_qcd&WIDTH=${width}&HEIGHT=${height}&SRS=EPSG:4326&BBOX=${bbox}`;
  }

  // Default to Iowa State Mesonet - more reliable
  return `${MESONET_BASE_URL}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=true&LAYERS=nexrad-n0q-900913&WIDTH=${width}&HEIGHT=${height}&SRS=EPSG:4326&BBOX=${bbox}`;
}

/**
 * Fetch radar timestamp from Mesonet service
 * @returns {Promise<Date|null>} Radar data timestamp
 */
async function fetchRadarTimestamp() {
  try {
    // Mesonet provides a JSON API for the latest radar time
    const response = await fetch('https://mesonet.agron.iastate.edu/json/radar_time.py', {
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data?.utc_valid) {
      return new Date(data.utc_valid);
    }
    return null;
  } catch (err) {
    console.warn('[WeatherRadar] Failed to fetch timestamp:', err);
    return null;
  }
}

/**
 * useWeatherRadar - Hook for NEXRAD weather radar overlay
 *
 * Fetches radar imagery from Iowa State Mesonet or NWS and provides
 * data for canvas-based rendering in Pro mode or Leaflet tile layer
 * in standard map mode.
 *
 * Features:
 * - Auto-refresh every 5-10 minutes
 * - Configurable opacity
 * - Standard NWS color scale
 * - Timestamp display
 * - Error handling with fallback sources
 *
 * @param {Object} options
 * @param {boolean} options.enabled - Whether radar overlay is enabled
 * @param {Object} options.bounds - Map bounds {north, south, east, west} or feederLocation + radarRange
 * @param {Object} options.feederLocation - { lat, lon } for Pro mode center
 * @param {number} options.radarRange - Radar range in nm for Pro mode
 * @param {number} options.refreshInterval - Refresh interval in ms (default: 5 min)
 * @param {string} options.source - Data source: 'mesonet' or 'nws'
 */
export function useWeatherRadar({
  enabled = false,
  bounds = null,
  feederLocation = null,
  radarRange = 100,
  refreshInterval = 5 * 60 * 1000, // 5 minutes
  source = 'mesonet',
}) {
  // Radar image state
  const [radarImage, setRadarImage] = useState(null);
  const [radarBounds, setRadarBounds] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [timestamp, setTimestamp] = useState(null);
  const [lastFetch, setLastFetch] = useState(null);

  // Refs for cleanup
  const imageRef = useRef(null);
  const fetchTimeoutRef = useRef(null);
  const refreshIntervalRef = useRef(null);

  // Calculate bounds from feederLocation and radarRange if not provided
  const effectiveBounds = useMemo(() => {
    if (bounds) return bounds;
    if (!feederLocation) return null;

    const { lat, lon } = feederLocation;
    const degPerNm = 1 / 60;
    const lonScale = Math.cos((lat * Math.PI) / 180);
    const latRange = radarRange * degPerNm * 1.2; // 20% buffer
    const lonRange = (radarRange * degPerNm * 1.2) / lonScale;

    return {
      north: lat + latRange,
      south: lat - latRange,
      east: lon + lonRange,
      west: lon - lonRange,
    };
  }, [bounds, feederLocation, radarRange]);

  // Fetch radar image
  const fetchRadar = useCallback(async () => {
    if (!enabled || !effectiveBounds) return;

    // Prevent rapid fetching
    const now = Date.now();
    if (lastFetch && now - lastFetch < 30000) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Try backend proxy first
      try {
        const proxyParams = new URLSearchParams({
          north: effectiveBounds.north,
          south: effectiveBounds.south,
          east: effectiveBounds.east,
          west: effectiveBounds.west,
          width: 1024,
          height: 1024,
        });
        const proxyRes = await fetch(`/api/v1/aviation/nexrad/?${proxyParams}`);
        if (proxyRes.ok && proxyRes.headers.get('content-type')?.includes('image/')) {
          const blob = await proxyRes.blob();
          const objectUrl = URL.createObjectURL(blob);
          const img = new Image();

          await new Promise((resolve, reject) => {
            img.onload = () => {
              URL.revokeObjectURL(objectUrl);
              resolve(img);
            };
            img.onerror = () => {
              URL.revokeObjectURL(objectUrl);
              reject(new Error('Failed to load proxied radar'));
            };
            img.src = objectUrl;
          });

          imageRef.current = img;
          setRadarImage(img);
          setRadarBounds(effectiveBounds);

          // Also try fetching timestamp from proxy
          try {
            const tsRes = await fetch('/api/v1/aviation/nexrad-timestamp/');
            if (tsRes.ok) {
              const tsData = await tsRes.json();
              setTimestamp(tsData.utc_valid ? new Date(tsData.utc_valid) : new Date());
            } else {
              setTimestamp(new Date());
            }
          } catch {
            setTimestamp(new Date());
          }

          setLastFetch(now);
          setLoading(false);
          return; // Successfully loaded from proxy
        }
      } catch {
        // Proxy failed, fall through to direct fetch
        console.info('[WeatherRadar] Backend proxy unavailable, using direct fetch');
      }

      // Fetch timestamp first
      const radarTime = await fetchRadarTimestamp();

      // Generate URL for radar image (higher resolution for quality)
      const width = 1024;
      const height = 1024;
      const url = getRadarTileUrl(effectiveBounds, width, height, source);

      // Create image element
      const img = new Image();
      img.crossOrigin = 'anonymous';

      await new Promise((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load radar image'));
        img.src = url;
      });

      // Store image and metadata
      imageRef.current = img;
      setRadarImage(img);
      setRadarBounds(effectiveBounds);
      setTimestamp(radarTime || new Date());
      setLastFetch(now);
    } catch (err) {
      console.error('[WeatherRadar] Fetch error:', err);
      setError(err.message || 'Failed to load weather radar');

      // Try fallback source if primary failed
      if (source === 'mesonet') {
        console.info('[WeatherRadar] Trying NWS fallback...');
        try {
          const fallbackUrl = getRadarTileUrl(effectiveBounds, 1024, 1024, 'nws');
          const img = new Image();
          img.crossOrigin = 'anonymous';

          await new Promise((resolve, reject) => {
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Fallback also failed'));
            img.src = fallbackUrl;
          });

          imageRef.current = img;
          setRadarImage(img);
          setRadarBounds(effectiveBounds);
          setTimestamp(new Date());
          setLastFetch(Date.now());
          setError(null);
        } catch {
          // Keep original error
        }
      }
    } finally {
      setLoading(false);
    }
  }, [enabled, effectiveBounds, source, lastFetch]);

  // Manual refresh
  const refresh = useCallback(() => {
    setLastFetch(null); // Clear rate limit
    fetchRadar();
  }, [fetchRadar]);

  // Clear radar data
  const clear = useCallback(() => {
    setRadarImage(null);
    setRadarBounds(null);
    setTimestamp(null);
    setError(null);
    imageRef.current = null;
  }, []);

  // Initial fetch when enabled
  useEffect(() => {
    if (enabled) {
      fetchRadar();
    } else {
      clear();
    }
  }, [enabled, fetchRadar, clear]);

  // Auto-refresh
  useEffect(() => {
    if (!enabled) {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
      return;
    }

    refreshIntervalRef.current = setInterval(() => {
      fetchRadar();
    }, refreshInterval);

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [enabled, refreshInterval, fetchRadar]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    };
  }, []);

  /**
   * Draw radar image on canvas context
   * @param {CanvasRenderingContext2D} ctx - Canvas 2D context
   * @param {Function} latLonToScreen - Function to convert lat/lon to screen coords
   * @param {number} opacity - Overlay opacity (0-1)
   */
  const drawOnCanvas = useCallback(
    (ctx, latLonToScreen, opacity = 0.5) => {
      if (!radarImage || !radarBounds) return;

      // Calculate screen positions for image corners
      const topLeft = latLonToScreen(radarBounds.north, radarBounds.west);
      const bottomRight = latLonToScreen(radarBounds.south, radarBounds.east);

      const x = topLeft.x;
      const y = topLeft.y;
      const width = bottomRight.x - topLeft.x;
      const height = bottomRight.y - topLeft.y;

      // Draw with opacity
      ctx.save();
      ctx.globalAlpha = opacity;

      try {
        ctx.drawImage(radarImage, x, y, width, height);
      } catch (err) {
        console.warn('[WeatherRadar] Canvas draw error:', err);
      }

      ctx.restore();
    },
    [radarImage, radarBounds]
  );

  /**
   * Get tile layer URL for Leaflet
   * Uses standard XYZ tile format from Mesonet
   */
  const tileLayerUrl = useMemo(() => {
    if (source === 'nws') {
      // NWS doesn't support XYZ tiles well, use WMS instead
      return null;
    }
    // Iowa State Mesonet XYZ tiles for NEXRAD composite
    return 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png';
  }, [source]);

  /**
   * Get WMS layer config for Leaflet WMS tile layer
   */
  const wmsConfig = useMemo(
    () => ({
      url: source === 'nws' ? NWS_RIDGE_URL : MESONET_BASE_URL,
      layers: source === 'nws' ? 'conus_bref_qcd' : 'nexrad-n0q-900913',
      format: 'image/png',
      transparent: true,
      attribution:
        source === 'nws'
          ? 'NOAA/NWS'
          : '<a href="https://mesonet.agron.iastate.edu/">Iowa State Mesonet</a>',
    }),
    [source]
  );

  /**
   * Format timestamp for display
   */
  const timestampDisplay = useMemo(() => {
    if (!timestamp) return null;

    const now = new Date();
    const diff = Math.floor((now - timestamp) / 60000); // minutes

    if (diff < 1) return 'Just now';
    if (diff < 60) return `${diff} min ago`;

    // Format as time
    return timestamp.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  }, [timestamp]);

  return {
    // State
    enabled,
    radarImage,
    radarBounds,
    loading,
    error,
    timestamp,
    timestampDisplay,

    // Actions
    refresh,
    clear,
    drawOnCanvas,

    // Leaflet integration
    tileLayerUrl,
    wmsConfig,

    // Color utilities
    getRadarColor,
    colorScale: RADAR_COLOR_SCALE,
  };
}

export default useWeatherRadar;
