import { useEffect } from 'react';

const VALID_MODES = ['radar', 'crt', 'pro', 'map'];

/**
 * Sync map settings from URL hash params on mount.
 *
 * Reads hash parameters like mode, range, dark, overlays, filters, selected,
 * aircraft, lat, lon, zoom, pan etc. and applies them to various state setters.
 */
export function useUrlHashSync({
  hashParams,
  setHashParams,
  config,
  setConfig,
  radarRange,
  setRadarRange,
  overlays,
  setOverlays,
  trafficFilters,
  setTrafficFilters,
  setSelectedAircraft,
  setAircraftDetailHex,
  setSidebarAircraftHex,
  setProPanOffset,
  initialCenterRef,
  initialZoomRef,
  saveConfig,
  saveOverlays,
}) {
  // Sync map settings from URL hash params on mount
  useEffect(() => {
    const newConfig = { ...config };
    let configChanged = false;

    // Sync mode from URL
    if (
      hashParams.mode &&
      VALID_MODES.includes(hashParams.mode) &&
      hashParams.mode !== config.mapMode
    ) {
      newConfig.mapMode = hashParams.mode;
      configChanged = true;
    }

    // Sync dark mode from URL
    if (hashParams.dark !== undefined) {
      const darkMode = hashParams.dark === '1' || hashParams.dark === 'true';
      if (darkMode !== config.mapDarkMode) {
        newConfig.mapDarkMode = darkMode;
        configChanged = true;
      }
    }

    if (configChanged) {
      setConfig(newConfig);
      saveConfig(newConfig);
    }

    // Sync range from URL
    if (hashParams.range) {
      const range = parseInt(hashParams.range, 10);
      if (!isNaN(range) && range >= 5 && range <= 250 && range !== radarRange) {
        setRadarRange(range);
      }
    }

    // Sync overlays from URL (comma-separated list of enabled overlays)
    if (hashParams.overlays) {
      const enabledOverlays = hashParams.overlays.split(',').map((s) => s.trim());
      const newOverlays = { ...overlays };
      Object.keys(newOverlays).forEach((key) => {
        newOverlays[key] = enabledOverlays.includes(key);
      });
      setOverlays(newOverlays);
      saveOverlays(newOverlays);
    }

    // Sync traffic filters from URL (comma-separated list of enabled filters + altitude range)
    if (hashParams.filters || hashParams.minAlt !== undefined || hashParams.maxAlt !== undefined) {
      const newFilters = { ...trafficFilters };

      if (hashParams.filters) {
        const enabledFilters = hashParams.filters.split(',').map((s) => s.trim());
        // Boolean filter keys
        const boolKeys = [
          'showMilitary',
          'showCivil',
          'showGround',
          'showAirborne',
          'showWithSquawk',
          'showWithoutSquawk',
          'safetyEventsOnly',
          'showGA',
          'showAirliners',
        ];
        boolKeys.forEach((key) => {
          newFilters[key] = enabledFilters.includes(key);
        });
      }

      if (hashParams.minAlt !== undefined) {
        const minAlt = parseInt(hashParams.minAlt, 10);
        if (!isNaN(minAlt) && minAlt >= 0) {
          newFilters.minAltitude = minAlt;
        }
      }

      if (hashParams.maxAlt !== undefined) {
        const maxAlt = parseInt(hashParams.maxAlt, 10);
        if (!isNaN(maxAlt) && maxAlt >= 0) {
          newFilters.maxAltitude = maxAlt;
        }
      }

      setTrafficFilters(newFilters);
    }

    // If no mode in URL, set current mode to URL
    if (!hashParams.mode && setHashParams && config.mapMode) {
      setHashParams({ mode: config.mapMode });
    }

    // If no overlays in URL, set current overlays to URL
    if (!hashParams.overlays && setHashParams) {
      const enabledOverlays = Object.entries(overlays)
        .filter(([, enabled]) => enabled)
        .map(([key]) => key)
        .join(',');
      if (enabledOverlays) {
        setHashParams({ overlays: enabledOverlays });
      }
    }

    // If no filters in URL, set current filters to URL
    if (!hashParams.filters && setHashParams) {
      const boolKeys = [
        'showMilitary',
        'showCivil',
        'showGround',
        'showAirborne',
        'showWithSquawk',
        'showWithoutSquawk',
        'safetyEventsOnly',
        'showGA',
        'showAirliners',
      ];
      const enabledFilters = boolKeys.filter((key) => trafficFilters[key]).join(',');
      setHashParams({
        filters: enabledFilters || undefined,
        minAlt: trafficFilters.minAltitude !== 0 ? String(trafficFilters.minAltitude) : undefined,
        maxAlt:
          trafficFilters.maxAltitude !== 60000 ? String(trafficFilters.maxAltitude) : undefined,
      });
    }

    // Open aircraft detail from URL if specified
    if (hashParams.aircraft) {
      setAircraftDetailHex(hashParams.aircraft);
    }

    // Store initial center/zoom from URL to apply when map initializes
    if (hashParams.lat && hashParams.lon) {
      const lat = parseFloat(hashParams.lat);
      const lon = parseFloat(hashParams.lon);
      if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        initialCenterRef.current = { lat, lon };
      }
    }
    if (hashParams.zoom) {
      const zoom = parseInt(hashParams.zoom, 10);
      if (!isNaN(zoom) && zoom >= 1 && zoom <= 20) {
        initialZoomRef.current = zoom;
      }
    }

    // Restore pro/crt mode pan offset from URL
    if (hashParams.panX && hashParams.panY) {
      const panX = parseInt(hashParams.panX, 10);
      const panY = parseInt(hashParams.panY, 10);
      if (!isNaN(panX) && !isNaN(panY)) {
        setProPanOffset({ x: panX, y: panY });
      }
    }
  }, []); // Only run on mount
}
