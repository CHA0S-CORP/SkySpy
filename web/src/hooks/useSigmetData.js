import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

/**
 * SIGMET Severity Configuration
 * Maps hazard types and intensity to severity levels and colors
 */
export const SIGMET_SEVERITY = {
  SEV: { level: 3, color: 'rgba(255, 0, 0, 0.5)', stroke: 'rgba(255, 0, 0, 0.9)', label: 'Severe' },
  EMBD: {
    level: 2,
    color: 'rgba(255, 140, 0, 0.4)',
    stroke: 'rgba(255, 140, 0, 0.8)',
    label: 'Embedded',
  },
  OBSC: {
    level: 2,
    color: 'rgba(255, 100, 50, 0.4)',
    stroke: 'rgba(255, 100, 50, 0.8)',
    label: 'Obscured',
  },
  SQL: {
    level: 2,
    color: 'rgba(255, 180, 0, 0.4)',
    stroke: 'rgba(255, 180, 0, 0.8)',
    label: 'Squall Line',
  },
  MOD: {
    level: 1,
    color: 'rgba(255, 200, 0, 0.3)',
    stroke: 'rgba(255, 200, 0, 0.7)',
    label: 'Moderate',
  },
  DEFAULT: {
    level: 1,
    color: 'rgba(255, 220, 100, 0.3)',
    stroke: 'rgba(255, 220, 100, 0.7)',
    label: 'Convective',
  },
};

/**
 * Get severity configuration for a SIGMET based on its hazard/qualifier
 * @param {Object} sigmet - SIGMET object
 * @returns {Object} Severity configuration with color, stroke, level, label
 */
export function getSigmetSeverity(sigmet) {
  const qualifier = sigmet.qualifier?.toUpperCase() || '';
  const hazard = sigmet.hazard?.toUpperCase() || '';
  const rawText = sigmet.rawSigmet || sigmet.raw || '';

  // Check for severity indicators
  if (rawText.includes('SEV TS') || rawText.includes('SEVERE') || qualifier === 'SEV') {
    return SIGMET_SEVERITY.SEV;
  }
  if (rawText.includes('EMBD TS') || rawText.includes('EMBD') || qualifier === 'EMBD') {
    return SIGMET_SEVERITY.EMBD;
  }
  if (rawText.includes('SQL') || rawText.includes('SQUALL')) {
    return SIGMET_SEVERITY.SQL;
  }
  if (rawText.includes('OBSC') || qualifier === 'OBSC') {
    return SIGMET_SEVERITY.OBSC;
  }
  if (rawText.includes('MOD') || qualifier === 'MOD') {
    return SIGMET_SEVERITY.MOD;
  }

  // For convective SIGMETs without explicit severity, check for severe indicators
  if (hazard === 'CONVECTIVE' || hazard === 'TS') {
    // Check for hail, tornado, or severe in the raw text
    if (rawText.includes('TORNADO') || rawText.includes('HAIL') || rawText.includes('>50KT')) {
      return SIGMET_SEVERITY.SEV;
    }
  }

  return SIGMET_SEVERITY.DEFAULT;
}

/**
 * Parse polygon coordinates from various SIGMET formats
 * @param {Object} sigmet - SIGMET object from API
 * @returns {Array<{lat: number, lon: number}>} Array of coordinate objects
 */
function parsePolygonCoords(sigmet) {
  // If there's already a coords array, use it
  if (sigmet.coords && Array.isArray(sigmet.coords)) {
    return sigmet.coords.map((c) => {
      if (Array.isArray(c)) {
        // GeoJSON format [lon, lat]
        return { lat: c[1], lon: c[0] };
      }
      return { lat: c.lat, lon: c.lon || c.lng };
    });
  }

  // If there's a GeoJSON geometry
  if (sigmet.geometry?.coordinates) {
    const coords =
      sigmet.geometry.type === 'Polygon'
        ? sigmet.geometry.coordinates[0]
        : sigmet.geometry.coordinates;
    return coords.map((c) => ({ lat: c[1], lon: c[0] }));
  }

  // If there's a polygon field (FAA format)
  if (sigmet.polygon) {
    if (Array.isArray(sigmet.polygon)) {
      return sigmet.polygon.map((p) => {
        if (typeof p === 'string') {
          // Parse "lat,lon" string format
          const [lat, lon] = p.split(',').map(Number);
          return { lat, lon };
        }
        if (Array.isArray(p)) {
          return { lat: p[1], lon: p[0] };
        }
        return { lat: p.lat, lon: p.lon || p.lng };
      });
    }
  }

  // If there's an area field with points
  if (sigmet.area?.points) {
    return sigmet.area.points.map((p) => ({
      lat: p.latitude || p.lat,
      lon: p.longitude || p.lon || p.lng,
    }));
  }

  return [];
}

/**
 * Check if a SIGMET is currently active
 * @param {Object} sigmet - SIGMET object
 * @returns {boolean} Whether the SIGMET is valid now
 */
export function isSigmetActive(sigmet) {
  const now = new Date();

  // Parse valid times
  const validFrom = sigmet.validTimeFrom || sigmet.validFrom || sigmet.startTime;
  const validTo = sigmet.validTimeTo || sigmet.validTo || sigmet.endTime;

  if (validFrom) {
    const fromDate = new Date(validFrom);
    if (fromDate > now) return false;
  }

  if (validTo) {
    const toDate = new Date(validTo);
    if (toDate < now) return false;
  }

  return true;
}

/**
 * Format SIGMET valid times for display
 * @param {Object} sigmet - SIGMET object
 * @returns {string} Formatted valid time string
 */
export function formatSigmetValidTime(sigmet) {
  const validFrom = sigmet.validTimeFrom || sigmet.validFrom || sigmet.startTime;
  const validTo = sigmet.validTimeTo || sigmet.validTo || sigmet.endTime;

  const formatTime = (date) => {
    if (!date) return '---';
    const d = new Date(date);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  };

  if (validFrom && validTo) {
    return `${formatTime(validFrom)} - ${formatTime(validTo)}`;
  }
  if (validTo) {
    return `Valid until ${formatTime(validTo)}`;
  }
  return 'Time unknown';
}

/**
 * AWC (Aviation Weather Center) SIGMET API endpoints
 * https://aviationweather.gov/data/api/
 */
const AWC_SIGMET_URL = 'https://aviationweather.gov/api/data/airsigmet';
// Reserved for future use: CWA (Center Weather Advisory) endpoint
// const AWC_CWA_URL = 'https://aviationweather.gov/cgi-bin/json/CWAJson.php';

/**
 * Fetch SIGMETs from aviationweather.gov API
 * @param {Object} options - Fetch options
 * @returns {Promise<Array>} Array of SIGMET objects
 */
async function fetchSigmets({ type = 'conv', hours = 3, format = 'json' } = {}) {
  try {
    // Try the main AWC API first
    const params = new URLSearchParams({
      format,
      type, // 'conv' for convective, 'sigmet' for international, 'airmet' for AIRMETs
      hours: String(hours),
    });

    const response = await fetch(`${AWC_SIGMET_URL}?${params}`, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      console.warn(`[SigmetData] AWC API returned ${response.status}`);
      return [];
    }

    const contentType = response.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      console.warn('[SigmetData] AWC API returned non-JSON response');
      return [];
    }

    const data = await response.json();

    // AWC API returns an array of SIGMETs
    if (Array.isArray(data)) {
      return data;
    }

    // Some responses wrap data in an object
    if (data.features) {
      return data.features.map((f) => ({ ...f.properties, geometry: f.geometry }));
    }
    if (data.data) {
      return data.data;
    }
    if (data.sigmets) {
      return data.sigmets;
    }

    return [];
  } catch (err) {
    console.error('[SigmetData] Fetch error:', err);
    return [];
  }
}

/**
 * useSigmetData - Hook for convective SIGMET data
 *
 * Fetches convective SIGMET data from Aviation Weather Center and provides
 * processed polygons for map rendering. Used primarily in Pro mode for
 * weather overlay visualization.
 *
 * Features:
 * - Auto-refresh every 5-10 minutes (configurable)
 * - Polygon coordinate parsing from various formats
 * - Severity classification (severe, moderate, etc.)
 * - Active/expired status checking
 * - Timestamp display
 *
 * @param {Object} options
 * @param {boolean} options.enabled - Whether to fetch SIGMET data
 * @param {Object} options.feederLocation - { lat, lon } for filtering nearby SIGMETs
 * @param {number} options.radarRange - Range in nm for relevance filtering
 * @param {number} options.refreshInterval - Refresh interval in ms (default: 5 min)
 */
export function useSigmetData({
  enabled = false,
  feederLocation: _feederLocation = null, // Reserved for future proximity filtering
  radarRange: _radarRange = 200, // Reserved for future proximity filtering
  refreshInterval = 5 * 60 * 1000, // 5 minutes
}) {
  // State
  const [sigmets, setSigmets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [timestamp, setTimestamp] = useState(null);
  const [lastFetch, setLastFetch] = useState(null);

  // Refs for cleanup
  const refreshIntervalRef = useRef(null);
  const abortControllerRef = useRef(null);

  // Fetch SIGMET data
  const fetchData = useCallback(async () => {
    if (!enabled) return;

    // Prevent rapid fetching
    const now = Date.now();
    if (lastFetch && now - lastFetch < 30000) {
      return;
    }

    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setLoading(true);
    setError(null);

    try {
      // Fetch convective SIGMETs
      const rawSigmets = await fetchSigmets({ type: 'conv', hours: 6 });

      // Process and normalize SIGMETs
      const processed = rawSigmets
        .map((sigmet, index) => {
          const coords = parsePolygonCoords(sigmet);
          if (coords.length < 3) return null; // Need at least 3 points for a polygon

          const severity = getSigmetSeverity(sigmet);
          const active = isSigmetActive(sigmet);

          return {
            id: sigmet.airSigmetId || sigmet.id || sigmet.sigmetId || `sigmet-${index}`,
            type: sigmet.airSigmetType || sigmet.type || 'CONVECTIVE',
            hazard: sigmet.hazard || 'CONVECTIVE',
            qualifier: sigmet.qualifier || '',
            severity,
            active,
            validTimeFrom: sigmet.validTimeFrom || sigmet.validFrom || sigmet.startTime,
            validTimeTo: sigmet.validTimeTo || sigmet.validTo || sigmet.endTime,
            validTimeDisplay: formatSigmetValidTime(sigmet),
            coords,
            rawText: sigmet.rawSigmet || sigmet.rawAirSigmet || sigmet.raw || '',
            altitude: {
              lower: sigmet.altitudeLow1 || sigmet.base || 0,
              upper: sigmet.altitudeHi1 || sigmet.top || 45000,
            },
            movement: sigmet.movement || sigmet.movementDir || null,
            intensity: sigmet.intensity || sigmet.change || null,
            region: sigmet.region || sigmet.fir || null,
            source: 'AWC',
          };
        })
        .filter(Boolean)
        .filter((s) => s.active); // Only show active SIGMETs

      setSigmets(processed);
      setTimestamp(new Date());
      setLastFetch(now);
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('[SigmetData] Fetch error:', err);
        setError(err.message || 'Failed to fetch SIGMET data');
      }
    } finally {
      setLoading(false);
    }
  }, [enabled, lastFetch]);

  // Manual refresh
  const refresh = useCallback(() => {
    setLastFetch(null); // Clear rate limit
    fetchData();
  }, [fetchData]);

  // Clear data
  const clear = useCallback(() => {
    setSigmets([]);
    setTimestamp(null);
    setError(null);
  }, []);

  // Initial fetch when enabled
  useEffect(() => {
    if (enabled) {
      fetchData();
    } else {
      clear();
    }
  }, [enabled, fetchData, clear]);

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
      fetchData();
    }, refreshInterval);

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [enabled, refreshInterval, fetchData]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  /**
   * Get SIGMET by ID
   * @param {string} id - SIGMET ID
   * @returns {Object|null} SIGMET object or null
   */
  const getSigmetById = useCallback(
    (id) => {
      return sigmets.find((s) => s.id === id) || null;
    },
    [sigmets]
  );

  /**
   * Check if a point is inside any SIGMET polygon
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @returns {Object|null} Matching SIGMET or null
   */
  const getSigmetAtPoint = useCallback(
    (lat, lon) => {
      for (const sigmet of sigmets) {
        if (isPointInPolygon(lat, lon, sigmet.coords)) {
          return sigmet;
        }
      }
      return null;
    },
    [sigmets]
  );

  /**
   * Get only severe SIGMETs
   * @returns {Array} Array of severe SIGMET objects
   */
  const severeSigmets = useMemo(() => {
    return sigmets.filter((s) => s.severity.level >= 3);
  }, [sigmets]);

  /**
   * Get SIGMET count by severity
   * @returns {Object} Counts by severity level
   */
  const countsBySeverity = useMemo(() => {
    const counts = { severe: 0, moderate: 0, other: 0, total: sigmets.length };
    sigmets.forEach((s) => {
      if (s.severity.level >= 3) counts.severe++;
      else if (s.severity.level >= 2) counts.moderate++;
      else counts.other++;
    });
    return counts;
  }, [sigmets]);

  /**
   * Format timestamp for display
   */
  const timestampDisplay = useMemo(() => {
    if (!timestamp) return null;

    const now = new Date();
    const diff = Math.floor((now - timestamp) / 60000); // minutes

    if (diff < 1) return 'Just now';
    if (diff < 60) return `${diff} min ago`;

    return timestamp.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  }, [timestamp]);

  /**
   * Draw SIGMET polygons on canvas
   * @param {CanvasRenderingContext2D} ctx - Canvas 2D context
   * @param {Function} latLonToScreen - Function to convert lat/lon to screen coords
   * @param {number} opacity - Overall opacity multiplier (0-1)
   */
  const drawOnCanvas = useCallback(
    (ctx, latLonToScreen, opacity = 1.0) => {
      if (!sigmets.length) return;

      sigmets.forEach((sigmet) => {
        const { coords, severity, id } = sigmet;
        if (coords.length < 3) return;

        // Convert coordinates to screen positions
        const screenCoords = coords.map((c) => latLonToScreen(c.lat, c.lon));

        // Check if any point is visible
        const hasVisiblePoint = screenCoords.some(
          (p) =>
            p.x >= -100 &&
            p.x <= ctx.canvas.width + 100 &&
            p.y >= -100 &&
            p.y <= ctx.canvas.height + 100
        );
        if (!hasVisiblePoint) return;

        ctx.save();

        // Draw filled polygon with hatching pattern
        ctx.beginPath();
        ctx.moveTo(screenCoords[0].x, screenCoords[0].y);
        screenCoords.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
        ctx.closePath();

        // Create hatching pattern for convective areas
        const patternCanvas = document.createElement('canvas');
        const patternSize = severity.level >= 3 ? 8 : 10;
        patternCanvas.width = patternSize;
        patternCanvas.height = patternSize;
        const patternCtx = patternCanvas.getContext('2d');

        // Draw diagonal lines for hatching
        patternCtx.strokeStyle = severity.stroke.replace(/[\d.]+\)$/, `${opacity * 0.6})`);
        patternCtx.lineWidth = severity.level >= 3 ? 2 : 1.5;
        patternCtx.beginPath();
        patternCtx.moveTo(0, patternSize);
        patternCtx.lineTo(patternSize, 0);
        patternCtx.stroke();

        // Add cross-hatch for severe
        if (severity.level >= 3) {
          patternCtx.beginPath();
          patternCtx.moveTo(0, 0);
          patternCtx.lineTo(patternSize, patternSize);
          patternCtx.stroke();
        }

        const pattern = ctx.createPattern(patternCanvas, 'repeat');
        ctx.fillStyle = pattern;
        ctx.fill();

        // Also draw semi-transparent fill
        ctx.fillStyle = severity.color.replace(/[\d.]+\)$/, `${opacity * 0.3})`);
        ctx.fill();

        // Draw border
        ctx.strokeStyle = severity.stroke.replace(/[\d.]+\)$/, `${opacity * 0.9})`);
        ctx.lineWidth = severity.level >= 3 ? 3 : 2;
        ctx.setLineDash(severity.level >= 3 ? [] : [8, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw SIGMET ID label at centroid
        const centroid = {
          x: screenCoords.reduce((sum, p) => sum + p.x, 0) / screenCoords.length,
          y: screenCoords.reduce((sum, p) => sum + p.y, 0) / screenCoords.length,
        };

        // Only draw label if centroid is visible
        if (
          centroid.x >= 0 &&
          centroid.x <= ctx.canvas.width &&
          centroid.y >= 0 &&
          centroid.y <= ctx.canvas.height
        ) {
          ctx.font = 'bold 11px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          // Background for label
          const labelText = id.replace('SIGMET_', '').replace('WST', 'CWA ');
          const labelWidth = ctx.measureText(labelText).width + 8;
          ctx.fillStyle = `rgba(0, 0, 0, ${opacity * 0.7})`;
          ctx.fillRect(centroid.x - labelWidth / 2, centroid.y - 8, labelWidth, 16);

          // Label text
          ctx.fillStyle = severity.stroke.replace(/[\d.]+\)$/, `${opacity})`);
          ctx.fillText(labelText, centroid.x, centroid.y);
        }

        ctx.restore();
      });
    },
    [sigmets]
  );

  return {
    // State
    sigmets,
    loading,
    error,
    timestamp,
    timestampDisplay,

    // Counts
    count: sigmets.length,
    countsBySeverity,
    severeSigmets,

    // Actions
    refresh,
    clear,

    // Lookups
    getSigmetById,
    getSigmetAtPoint,

    // Canvas rendering
    drawOnCanvas,

    // Utilities
    getSigmetSeverity,
    isSigmetActive,
    formatSigmetValidTime,
  };
}

/**
 * Point-in-polygon test using ray casting algorithm
 * @param {number} lat - Point latitude
 * @param {number} lon - Point longitude
 * @param {Array<{lat, lon}>} polygon - Array of polygon vertices
 * @returns {boolean} Whether point is inside polygon
 */
function isPointInPolygon(lat, lon, polygon) {
  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].lon,
      yi = polygon[i].lat;
    const xj = polygon[j].lon,
      yj = polygon[j].lat;

    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}

export default useSigmetData;
