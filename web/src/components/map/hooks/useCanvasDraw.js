import { useEffect, useRef } from 'react';
import {
  clearCanvas,
  drawProGrid,
  drawCrtRings,
  drawCenterMarker,
  drawWeatherRadarOverlay,
  drawConvectiveSigmetPolygons,
  drawTerrainBoundaries,
  drawNavaids,
  drawAirports,
  drawAirspaces,
  drawAdvisories,
  drawNotams,
  drawPireps,
  drawWindsAloft,
  drawMetars,
  drawSelectedTrack,
  drawShortTracks,
  buildConflictAircraftSet,
  drawConflictCPALines,
  drawConflictWedges,
  drawJRings,
  drawAllAircraft,
  drawMeasurementTool,
  drawCursorInfo,
  drawFpsCounter,
  drawKeyboardHint,
  drawSweepLine,
  drawScanlines,
} from '../utils/draw';
import { drawWindBarb, drawWindBarbs, drawWindsLevelIndicator } from '../utils/windBarbs';
import {
  calculateCPA,
  formatTimeToCPA,
  determineWakeCategory,
  getWakeCategoryColor,
  findMetarForAirport,
  getFlightCategoryColor,
  getPirepMaxSeverity,
  getPirepAgeMinutes,
  getAgeOpacity,
  getPirepType,
  formatPirepAltitude,
} from '../../../utils';

export function useCanvasDraw({
  // Core
  config,
  canvasRef,
  containerRef,
  // Geography
  feederLat,
  feederLon,
  radarRange,
  proPanOffset,
  setProPanOffset,
  setRadarRange,
  setHashParams,
  // Aircraft
  sortedAircraft,
  selectedAircraft,
  aircraftInfo,
  activeConflicts,
  acarsMessages,
  highlightedHexes,
  highContrastMode,
  // Aviation data
  aviationData,
  aviationOverlayData,
  terrainData,
  // Overlays
  overlays,
  layerOpacities,
  airspaceTypeFilters,
  weatherAdvisoryFilters,
  showAirspaceLabels,
  // Conflict/Safety
  safetyEvents,
  showConflictVisualization,
  showJRings,
  showWakeRings,
  // Track/Trail
  trackHistory,
  shortTrackHistory,
  showSelectedTrack,
  showShortTracks,
  followingAircraft,
  showAltitudeTrails,
  // Display settings
  gridOpacity,
  showCompassRose,
  showSpeedColors,
  showPredictionVectors,
  predictionSeconds,
  showDataBlocks,
  dataBlockConfig,
  showVsTrend,
  measurementPoints,
  cursorInfo,
  showFpsCounter,
  reducedMotion,
  msaw,
  proThemeColors,
  // Selected items
  selectedMetar,
  selectedPirep,
  selectedNavaid,
  selectedAirport,
  selectedSigmet,
  selectedAdvisoryId,
  selectedNotamId,
  // Aviation display
  stationsWithTaf,
  getTafForAirport,
  convectiveSigmets,
  airspaceAdvisories,
  acknowledgedAdvisories,
  mapNotams,
  acknowledgedNotams,
  windGrid,
  windsAloftLevel,
  weatherRadarImage,
  weatherRadarBounds,
  drawWeatherRadar,
  drawSigmets,
  // Weather advisory config
  HAZARD_CONFIG,
  NOTAM_TYPE_CONFIG,
  getAircraftHighlight,
  hasCustomDataBlockOffset,
  // Data block management
  getDataBlockOffset,
  autoDeconflictEnabled,
  maybeDeconflict,
  // Highlight groups
  hasHighlightGroups,
}) {
  // Internal refs
  const animationRef = useRef(null);
  const sweepAngleRef = useRef(0);
  const fpsRef = useRef({ frames: 0, lastTime: Date.now(), fps: 0 });
  const historyRef = useRef({});
  const trackHistoryRef = useRef({});
  const pinchStateRef = useRef({
    lastDistance: 0,
    startRange: 0,
    lastCenterX: 0,
    lastCenterY: 0,
    startPanX: 0,
    startPanY: 0,
  });

  // Internal helpers
  const getDistanceNm = (lat, lon) => {
    const dLat = lat - feederLat;
    const dLon = lon - feederLon;
    const latNm = dLat * 60;
    const lonNm = dLon * 60 * Math.cos((feederLat * Math.PI) / 180);
    return Math.sqrt(latNm * latNm + lonNm * lonNm);
  };

  const getBearing = (lat, lon) => {
    const dLat = lat - feederLat;
    const dLon = lon - feederLon;
    const latNm = dLat * 60;
    const lonNm = dLon * 60 * Math.cos((feederLat * Math.PI) / 180);
    return ((Math.atan2(lonNm, latNm) * 180) / Math.PI + 360) % 360;
  };

  const updateRadarRange = (newRange) => {
    setRadarRange(newRange);
    if (setHashParams) {
      setHashParams({ range: String(newRange) });
    }
  };

  // Update aircraft history for trails
  useEffect(() => {
    if (config.mapMode !== 'crt') return;

    const now = Date.now();
    sortedAircraft.forEach((ac) => {
      if (!ac.hex) return;
      if (!historyRef.current[ac.hex]) {
        historyRef.current[ac.hex] = [];
      }
      const history = historyRef.current[ac.hex];
      // Add position if moved significantly or first position
      if (
        history.length === 0 ||
        Math.abs(history[history.length - 1].lat - ac.lat) > 0.001 ||
        Math.abs(history[history.length - 1].lon - ac.lon) > 0.001
      ) {
        history.push({ lat: ac.lat, lon: ac.lon, time: now });
      }
      // Keep only last 60 seconds of history (about 6 positions at 10s intervals)
      while (history.length > 0 && now - history[0].time > 60000) {
        history.shift();
      }
    });

    // Clean up old aircraft
    const activeHexes = new Set(sortedAircraft.map((a) => a.hex));
    Object.keys(historyRef.current).forEach((hex) => {
      if (!activeHexes.has(hex)) {
        delete historyRef.current[hex];
      }
    });
  }, [sortedAircraft, config.mapMode]);

  // Update track history for turn rate calculation (pro mode velocity vectors)
  useEffect(() => {
    if (config.mapMode !== 'crt' && config.mapMode !== 'pro') return;

    const now = Date.now();
    sortedAircraft.forEach((ac) => {
      if (!ac.hex || ac.track == null) return;

      if (!trackHistoryRef.current[ac.hex]) {
        trackHistoryRef.current[ac.hex] = [];
      }
      const history = trackHistoryRef.current[ac.hex];

      // Add track sample if different from last or first sample
      const lastTrack = history.length > 0 ? history[history.length - 1].track : null;
      if (lastTrack === null || Math.abs(ac.track - lastTrack) > 0.5) {
        history.push({ track: ac.track, time: now });
      }

      // Keep only last 10 seconds of track history for turn rate calculation
      while (history.length > 0 && now - history[0].time > 10000) {
        history.shift();
      }
    });

    // Clean up old aircraft
    const activeHexes = new Set(sortedAircraft.map((a) => a.hex));
    Object.keys(trackHistoryRef.current).forEach((hex) => {
      if (!activeHexes.has(hex)) {
        delete trackHistoryRef.current[hex];
      }
    });
  }, [sortedAircraft, config.mapMode]);

  // CRT Radar Canvas Drawing (also handles Pro mode)
  useEffect(() => {
    if (config.mapMode !== 'crt' && config.mapMode !== 'pro') return;
    if (!canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    const ctx = canvas.getContext('2d');

    // Bug fix #5: Track all event listeners for guaranteed cleanup
    // Store references to handlers to ensure we remove the exact same functions we added
    const eventListeners = [];
    const addTrackedListener = (target, event, handler, options) => {
      target.addEventListener(event, handler, options);
      eventListeners.push({ target, event, handler, options });
    };

    // Set canvas size to match container.
    // IMPORTANT: assigning canvas.width/height clears the canvas AND resets its
    // transform — even when assigning the same value. This effect re-runs on
    // every data change (sortedAircraft is a dependency), so unconditionally
    // resizing here blanked the canvas on every aircraft update, producing a
    // visible flash (worse with more aircraft / faster refresh). Only resize
    // when the pixel dimensions actually changed.
    const resize = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.round(rect.width * window.devicePixelRatio);
      const h = Math.round(rect.height * window.devicePixelRatio);
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    addTrackedListener(window, 'resize', resize);

    // Scroll to zoom - smooth increments
    // When zooming, scale the pan offset so the view stays centered on the same geographic point
    const handleWheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 1.1 : 0.9; // 10% zoom per scroll
      const newRange = Math.round(radarRange * delta);
      const clampedRange = Math.max(5, Math.min(500, newRange));
      if (clampedRange !== radarRange) {
        // Scale factor: when range increases, pixelsPerNm decreases, so offset should scale inversely
        const scaleFactor = radarRange / clampedRange;
        setProPanOffset((prev) => ({
          x: prev.x * scaleFactor,
          y: prev.y * scaleFactor,
        }));
        updateRadarRange(clampedRange);
      }
    };
    addTrackedListener(canvas, 'wheel', handleWheel, { passive: false });

    // Pinch-to-zoom and two-finger pan for touch devices
    const getTouchDistance = (touches) => {
      if (touches.length < 2) return 0;
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const getTouchCenter = (touches) => {
      if (touches.length < 2) return { x: 0, y: 0 };
      return {
        x: (touches[0].clientX + touches[1].clientX) / 2,
        y: (touches[0].clientY + touches[1].clientY) / 2,
      };
    };

    const handleTouchStart = (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const center = getTouchCenter(e.touches);
        pinchStateRef.current = {
          lastDistance: getTouchDistance(e.touches),
          startRange: radarRange,
          lastCenterX: center.x,
          lastCenterY: center.y,
          startPanX: proPanOffset.x,
          startPanY: proPanOffset.y,
        };
      }
    };

    const handleTouchMove = (e) => {
      const { lastDistance, startRange, lastCenterX, lastCenterY, startPanX, startPanY } =
        pinchStateRef.current;
      if (e.touches.length === 2 && lastDistance > 0) {
        e.preventDefault();
        const currentDistance = getTouchDistance(e.touches);
        const currentCenter = getTouchCenter(e.touches);

        // Calculate pinch-to-zoom
        // Pinch out (fingers apart) = zoom in (smaller range)
        // Pinch in (fingers together) = zoom out (larger range)
        const scale = lastDistance / currentDistance;
        const newRange = Math.round(startRange * scale);
        const clampedRange = Math.max(5, Math.min(500, newRange));

        // Calculate two-finger pan (delta from start position)
        const panDeltaX = currentCenter.x - lastCenterX;
        const panDeltaY = currentCenter.y - lastCenterY;

        // Apply zoom if changed
        if (clampedRange !== radarRange) {
          updateRadarRange(clampedRange);
        }

        // Apply pan offset: scale the starting pan for any zoom applied since
        // the pinch began (pixelsPerNm scales inversely with range), then add
        // the two-finger pan delta.
        const zoomScale = startRange / clampedRange;
        setProPanOffset({
          x: startPanX * zoomScale + panDeltaX,
          y: startPanY * zoomScale + panDeltaY,
        });
      }
    };

    const handleTouchEnd = (e) => {
      if (e.touches.length < 2) {
        pinchStateRef.current = {
          lastDistance: 0,
          startRange: radarRange,
          lastCenterX: 0,
          lastCenterY: 0,
          startPanX: 0,
          startPanY: 0,
        };
      }
    };

    addTrackedListener(canvas, 'touchstart', handleTouchStart, { passive: false });
    addTrackedListener(canvas, 'touchmove', handleTouchMove, { passive: false });
    addTrackedListener(canvas, 'touchend', handleTouchEnd);

    // Use fetched aviation data or fallback to static
    const navAids =
      aviationData.navaids.length > 0
        ? aviationData.navaids
        : [
            { id: 'SEA', name: 'Seattle VORTAC', lat: 47.435, lon: -122.309, type: 'VORTAC' },
            { id: 'PAE', name: 'Paine Field', lat: 47.906, lon: -122.283, type: 'VOR/DME' },
            { id: 'BFI', name: 'Boeing Field', lat: 47.529, lon: -122.302, type: 'VOR/DME' },
            { id: 'TCM', name: 'McChord', lat: 47.136, lon: -122.476, type: 'TACAN' },
            { id: 'OLM', name: 'Olympia', lat: 46.969, lon: -122.902, type: 'VOR/DME' },
            { id: 'EPH', name: 'Ephrata', lat: 47.385, lon: -119.515, type: 'VOR/DME' },
            { id: 'ELN', name: 'Ellensburg', lat: 47.033, lon: -120.53, type: 'VOR/DME' },
            { id: 'YYJ', name: 'Victoria', lat: 48.647, lon: -123.426, type: 'VOR/DME' },
            { id: 'CV', name: 'Coupeville', lat: 48.188, lon: -122.688, type: 'NDB' },
            { id: 'BTG', name: 'Battleground', lat: 45.816, lon: -122.531, type: 'VOR/DME' },
            { id: 'UBG', name: 'Bellingham', lat: 48.795, lon: -122.538, type: 'VOR/DME' },
            { id: 'GEG', name: 'Spokane', lat: 47.625, lon: -117.539, type: 'VORTAC' },
          ];

    const airports =
      aviationData.airports.length > 0
        ? aviationData.airports
        : [
            { icao: 'KSEA', name: 'Seattle-Tacoma', lat: 47.449, lon: -122.309, class: 'B' },
            { icao: 'KBFI', name: 'Boeing Field', lat: 47.529, lon: -122.302, class: 'D' },
            { icao: 'KPAE', name: 'Paine Field', lat: 47.906, lon: -122.283, class: 'D' },
            { icao: 'KPDX', name: 'Portland Intl', lat: 45.589, lon: -122.597, class: 'C' },
            { icao: 'KGEG', name: 'Spokane', lat: 47.62, lon: -117.534, class: 'C' },
          ];

    // Combine airspace advisories and boundaries from API, or use static fallback
    const rawAirspaceData =
      aviationData.airspaces.length > 0 || aviationData.boundaries.length > 0
        ? [...aviationData.airspaces, ...aviationData.boundaries]
        : [
            {
              name: 'Seattle Class B',
              type: 'CLASS_B',
              class: 'B',
              isBoundary: true,
              center: { lat: 47.449, lon: -122.309 },
              rings: [
                { radius_nm: 10, floor_ft: 0, ceiling_ft: 10000 },
                { radius_nm: 20, floor_ft: 3000, ceiling_ft: 10000 },
                { radius_nm: 30, floor_ft: 6000, ceiling_ft: 10000 },
              ],
            },
          ];

    // Filter airspace by type based on user preferences
    const airspaceData = rawAirspaceData.filter((as) => {
      const asClass = as.class || as.airspace_class || as.type?.replace('CLASS_', '') || '';
      // Check if this airspace type is enabled
      if (airspaceTypeFilters[asClass] !== undefined) {
        return airspaceTypeFilters[asClass];
      }
      // For G-AIRMETs and other advisories, filter by hazard type
      if (as.isAdvisory && as.hazard) {
        if (weatherAdvisoryFilters[as.hazard] !== undefined) {
          return weatherAdvisoryFilters[as.hazard];
        }
      }
      // Default to showing unknown types
      return true;
    });

    // Animation loop
    const isPro = config.mapMode === 'pro';
    // Phase 5.1: Get theme colors for Pro mode (using hook)
    const themeColors = isPro ? proThemeColors : null;
    let frameCount = 0;
    const draw = () => {
      frameCount++;
      const width = canvas.width / window.devicePixelRatio;
      const height = canvas.height / window.devicePixelRatio;
      const centerX = width / 2;
      const centerY = height / 2;
      // For Pro mode: use full rectangular area
      // For CRT mode: use circular area that fills more of the canvas
      const maxRadius = isPro
        ? Math.max(width, height) * 0.5 // Pro: allow overflow for rectangular
        : Math.min(width, height) * 0.48; // CRT: fill more of the circle

      // Clear with dark background (theme-aware for Pro mode)
      ctx.fillStyle = isPro ? themeColors.bg() : '#0a0f0a';
      ctx.fillRect(0, 0, width, height);

      // For Pro mode, calculate scale to show full area (no circular limit)
      // _nmPerPixel tells us how many nm one pixel represents (kept for future use)
      const _nmPerPixel = isPro
        ? radarRange / (Math.min(width, height) * 0.45)
        : radarRange / maxRadius;

      // Helper to convert lat/lon to screen coordinates
      const latLonToScreen = (lat, lon) => {
        const dLat = lat - feederLat;
        const dLon = lon - feederLon;
        const nmY = dLat * 60; // North is up
        const nmX = dLon * 60 * Math.cos((feederLat * Math.PI) / 180);

        if (isPro) {
          // Pro mode: linear mapping, no circular constraint, with pan offset
          const pixelsPerNm = (Math.min(width, height) * 0.45) / radarRange;
          return {
            x: centerX + nmX * pixelsPerNm + proPanOffset.x,
            y: centerY - nmY * pixelsPerNm + proPanOffset.y, // Flip Y for screen coords
          };
        } else {
          // CRT mode: polar mapping with circular constraint
          const dist = Math.sqrt(nmX * nmX + nmY * nmY);
          const bearing = (Math.atan2(nmX, nmY) * 180) / Math.PI;
          const radius = (dist / radarRange) * maxRadius;
          const rad = ((bearing - 90) * Math.PI) / 180;
          return {
            x: centerX + Math.cos(rad) * radius,
            y: centerY + Math.sin(rad) * radius,
          };
        }
      };

      // Build shared geometry object for draw modules
      const geo = {
        width,
        height,
        centerX,
        centerY,
        maxRadius,
        isPro,
        radarRange,
        feederLat,
        feederLon,
        proPanOffset,
        themeColors,
        gridOpacity,
        showCompassRose,
        latLonToScreen,
        frameCount,
        reducedMotion,
        sweepAngleRef,
      };

      // 1. Clear canvas
      clearCanvas(ctx, geo);

      // 2. Grid, range rings, compass
      if (isPro) {
        drawProGrid(ctx, geo);
      } else {
        drawCrtRings(ctx, geo);
      }
      drawCenterMarker(ctx, geo);

      // 3. Aviation overlays (underneath aircraft)
      drawWeatherRadarOverlay(ctx, geo, {
        overlays,
        weatherRadarImage,
        weatherRadarBounds,
        layerOpacities,
        drawWeatherRadar,
      });
      drawConvectiveSigmetPolygons(ctx, geo, {
        overlays,
        convectiveSigmets: convectiveSigmets || [],
        layerOpacities,
        selectedSigmet: selectedSigmet,
        drawSigmets,
      });
      drawTerrainBoundaries(ctx, geo, {
        overlays,
        terrainData,
        aviationOverlayData,
        layerOpacities,
      });
      drawNavaids(ctx, geo, {
        overlays,
        navAids,
        selectedNavaid,
        getDistanceNm,
      });
      drawAirports(ctx, geo, {
        overlays,
        airports,
        aviationData,
        stationsWithTaf,
        selectedAirport,
        findMetarForAirport,
        getFlightCategoryColor,
        getDistanceNm,
        getTafForAirport,
      });
      drawAirspaces(ctx, geo, {
        overlays,
        showAirspaceLabels,
        airspaceData,
      });
      drawAdvisories(ctx, geo, {
        overlays,
        airspaceAdvisories,
        selectedAdvisoryId,
        acknowledgedAdvisories,
        weatherAdvisoryFilters,
        HAZARD_CONFIG,
      });
      drawNotams(ctx, geo, {
        overlays,
        mapNotams,
        selectedNotamId,
        acknowledgedNotams,
        NOTAM_TYPE_CONFIG,
      });
      drawPireps(ctx, geo, {
        overlays,
        aviationData,
        selectedPirep,
        getPirepMaxSeverity,
        getPirepAgeMinutes,
        getAgeOpacity,
        getPirepType,
        formatPirepAltitude,
      });
      drawWindsAloft(ctx, geo, {
        overlays,
        windGrid,
        windsAloftLevel,
        drawWindBarbs,
        drawWindsLevelIndicator,
      });
      drawMetars(ctx, geo, {
        overlays,
        aviationData,
        selectedMetar,
        drawWindBarb,
      });

      // 4. CRT sweep line (before aircraft, for brightness calculation)
      drawSweepLine(ctx, geo);

      // 5. Conflict visualization
      const conflictAircraft = buildConflictAircraftSet(activeConflicts);
      drawConflictCPALines(ctx, geo, {
        showConflictVisualization,
        activeConflicts,
        sortedAircraft,
        calculateCPA,
        formatTimeToCPA,
      });
      drawConflictWedges(ctx, geo, {
        showConflictVisualization,
        activeConflicts,
        sortedAircraft,
        conflictAircraft,
      });
      drawJRings(ctx, geo, {
        showJRings,
        selectedAircraft,
      });

      // 6. Track history
      drawSelectedTrack(ctx, geo, {
        followingAircraft,
        showSelectedTrack,
        selectedAircraft,
        trackHistory,
      });
      drawShortTracks(ctx, geo, {
        showShortTracks,
        showAltitudeTrails,
        overlays,
        config,
        sortedAircraft,
        shortTrackHistory,
        trackHistory,
        aircraftCount: sortedAircraft.length,
        selectedAircraft,
        getDistanceNm,
      });

      // 7. Aircraft symbols, data blocks, badges (the main rendering loop)
      // Performance mode thresholds match the pre-decomposition MapView values
      const perfMode = {
        skipPredictionVectors: sortedAircraft.length > 300,
        skipDataBlocks: sortedAircraft.length > 400,
      };
      drawAllAircraft(ctx, geo, {
        sortedAircraft,
        overlays,
        selectedAircraft,
        activeConflicts,
        conflictAircraft,
        trackHistoryRef,
        acarsMessages,
        aircraftInfo,
        showPredictionVectors,
        predictionSeconds,
        showVsTrend,
        showSpeedColors,
        showConflictVisualization,
        showDataBlocks,
        dataBlockConfig,
        msaw,
        showWakeRings,
        showAltitudeTrails,
        hasHighlightGroups,
        highlightedHexes,
        highContrastMode,
        getDistanceNm,
        getBearing,
        getDataBlockOffset,
        hasCustomDataBlockOffset,
        sweepAngleRef,
        perfMode,
        getAircraftHighlight,
        determineWakeCategory,
        getWakeCategoryColor,
        autoDeconflictEnabled,
        maybeDeconflict,
      });

      // 8. Pro mode overlays on top
      drawMeasurementTool(ctx, geo, { measurementPoints });
      drawCursorInfo(ctx, geo, { cursorInfo });
      drawFpsCounter(ctx, geo, { showFpsCounter, fpsRef });
      drawKeyboardHint(ctx, geo);

      // 9. CRT post-processing effects
      drawScanlines(ctx, geo);

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      // Bug fix #5: Clean up all tracked event listeners to prevent duplicates
      eventListeners.forEach(({ target, event, handler, options }) => {
        target.removeEventListener(event, handler, options);
      });
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [
    config.mapMode,
    sortedAircraft,
    radarRange,
    feederLat,
    feederLon,
    selectedAircraft,
    selectedMetar,
    selectedPirep,
    selectedNavaid,
    selectedAirport,
    overlays,
    aviationData,
    aviationOverlayData,
    proPanOffset,
    followingAircraft,
    trackHistory,
    showSelectedTrack,
    safetyEvents,
    showShortTracks,
    shortTrackHistory,
    config.shortTrackLength,
    gridOpacity,
    showCompassRose,
    showSpeedColors,
    showPredictionVectors,
    predictionSeconds,
    showConflictVisualization,
    showDataBlocks,
    measurementPoints,
    cursorInfo,
    showFpsCounter,
    showAltitudeTrails,
    reducedMotion,
    msaw,
    showWakeRings,
    aircraftInfo,
  ]);

  return { trackHistoryRef };
}
