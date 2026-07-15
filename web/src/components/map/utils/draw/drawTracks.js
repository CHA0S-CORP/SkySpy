/**
 * Track history drawing extracted from MapView.jsx
 *
 * Each function takes (ctx, geo, data) where:
 *   ctx  = Canvas 2D rendering context
 *   geo  = { width, height, centerX, centerY, maxRadius, isPro, radarRange, themeColors, latLonToScreen, frameCount }
 *   data = function-specific data bag (see individual JSDoc)
 */

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/**
 * Get smooth altitude-based RGB color for trail segments.
 * Green (0ft) -> Yellow (10000ft) -> Orange (25000ft) -> Red/Magenta (45000ft+)
 * @param {number|string} alt - Altitude in feet
 * @returns {{ r: number, g: number, b: number }}
 */
function getAltitudeRGB(alt) {
  const numAlt = Number(alt);
  if (!Number.isFinite(numAlt) || numAlt <= 0) return { r: 50, g: 255, b: 100 }; // Ground level: bright green
  // Smooth gradient: Green (0ft) -> Yellow (10000ft) -> Orange (25000ft) -> Red/Magenta (45000ft+)
  const clampedAlt = Math.max(0, Math.min(numAlt, 45000));
  if (clampedAlt < 10000) {
    // Green to Yellow transition (0-10000ft)
    const t = clampedAlt / 10000;
    return {
      r: Math.round(50 + 205 * t),
      g: Math.round(255),
      b: Math.round(100 - 100 * t),
    };
  } else if (clampedAlt < 25000) {
    // Yellow to Orange transition (10000-25000ft)
    const t = (clampedAlt - 10000) / 15000;
    return {
      r: Math.round(255),
      g: Math.round(255 - 130 * t),
      b: Math.round(0),
    };
  } else {
    // Orange to Magenta transition (25000-45000ft)
    const t = (clampedAlt - 25000) / 20000;
    return {
      r: Math.round(255),
      g: Math.round(125 - 125 * t),
      b: Math.round(0 + 255 * t),
    };
  }
}

/**
 * Calculate great-circle distance between two points in nautical miles.
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} Distance in nm
 */
function getSegmentDistanceNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // Earth radius in nm
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ---------------------------------------------------------------------------
// Exported draw functions
// ---------------------------------------------------------------------------

/**
 * Draw dotted track history trail for the followed or selected aircraft.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geo - { width, height, isPro, latLonToScreen }
 * @param {object} data
 * @param {string|null} data.followingAircraft - Hex of the aircraft being followed
 * @param {boolean} data.showSelectedTrack - Whether the selected-track toggle is on
 * @param {object|null} data.selectedAircraft - Currently selected aircraft object (needs .hex)
 * @param {object} data.trackHistory - Map of hex -> array of { lat, lon, time } positions
 */
export function drawSelectedTrack(ctx, geo, data) {
  const { width, height, isPro, latLonToScreen } = geo;
  const { followingAircraft, showSelectedTrack, selectedAircraft, trackHistory } = data;

  // Draw track history line for followed aircraft or selected aircraft (when toggle is on)
  const trackAircraftHex = followingAircraft || (showSelectedTrack && selectedAircraft?.hex);
  if (trackAircraftHex && trackHistory[trackAircraftHex]?.length > 1) {
    const history = trackHistory[trackAircraftHex];
    ctx.save();
    ctx.strokeStyle = isPro ? 'rgba(0, 200, 255, 0.7)' : 'rgba(0, 255, 100, 0.6)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]); // Dotted line
    ctx.beginPath();

    let started = false;
    history.forEach((point) => {
      const pos = latLonToScreen(point.lat, point.lon);
      // Skip points outside canvas
      if (pos.x < -50 || pos.x > width + 50 || pos.y < -50 || pos.y > height + 50) return;

      if (!started) {
        ctx.moveTo(pos.x, pos.y);
        started = true;
      } else {
        ctx.lineTo(pos.x, pos.y);
      }
    });
    ctx.stroke();
    ctx.setLineDash([]); // Reset dash
    ctx.restore();
  }
}

/**
 * Draw short ATC-style history trails for all aircraft with altitude-gradient coloring
 * and LOD decimation at far ranges.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geo - { width, height, isPro, radarRange, latLonToScreen }
 * @param {object} data
 * @param {boolean} data.showShortTracks - Whether short tracks toggle is enabled
 * @param {boolean} data.showAltitudeTrails - Whether altitude-colored trails are enabled (pro mode)
 * @param {object} data.overlays - Overlay visibility flags (needs .aircraft)
 * @param {object} data.config - Map config (needs .shortTrackLength)
 * @param {Array} data.sortedAircraft - Array of aircraft objects to draw trails for
 * @param {object} data.shortTrackHistory - Map of hex -> array of historic positions from API
 * @param {object} data.trackHistory - Map of hex -> array of real-time positions
 * @param {number} data.aircraftCount - Total number of aircraft (for perf mode thresholds)
 * @param {object|null} data.selectedAircraft - Currently selected aircraft (needs .hex)
 * @param {function} data.getDistanceNm - Function(lat, lon) returning distance in nm from feeder
 */
export function drawShortTracks(ctx, geo, data) {
  const { width, height, isPro, radarRange, latLonToScreen } = geo;
  const {
    showShortTracks,
    showAltitudeTrails,
    overlays,
    config,
    sortedAircraft,
    shortTrackHistory,
    trackHistory,
    aircraftCount,
    selectedAircraft,
    getDistanceNm,
  } = data;

  // Phase 5.3: Performance mode - adjust detail based on aircraft count
  const perfMode = {
    skipTrails: aircraftCount > 200,
    reduceTrailLength: aircraftCount > 150,
  };

  // Draw short tracks for all aircraft (ATC-style history trails)
  // Performance: Skip trails entirely when > 150 aircraft
  if (!showShortTracks || !overlays.aircraft || perfMode.skipTrails) return;

  ctx.save();
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Performance: Limit trail length when > 100 aircraft
  const trackLength = perfMode.reduceTrailLength
    ? Math.min(config.shortTrackLength || 15, 8)
    : config.shortTrackLength || 15;
  // Reduce max trail points at far ranges
  const lodTrailMax =
    radarRange <= 50
      ? trackLength
      : radarRange <= 100
        ? Math.min(trackLength, 15)
        : Math.min(trackLength, 8);
  const effectiveTrackLength = lodTrailMax;
  // Phase 5.4: Range-based trail point decimation
  const lodTrailStride = radarRange <= 50 ? 1 : radarRange <= 100 ? 2 : radarRange <= 200 ? 3 : 4;

  // Target trail length in nm based on slider (5-60 positions maps to ~0.5-6nm)
  const targetTrailNm = effectiveTrackLength * 0.1;

  sortedAircraft.forEach((ac) => {
    if (!ac.hex || !ac.lat || !ac.lon) return;

    const dist = ac.distance_nm || getDistanceNm(ac.lat, ac.lon);
    if (!isPro && dist > radarRange) return;
    if (isPro && dist > radarRange * 1.5) return;

    // Combine historical data (from API) with real-time trackHistory
    const historicPositions = shortTrackHistory[ac.hex] || [];
    const realtimePositions = trackHistory[ac.hex] || [];

    // Merge and sort by time
    const now = Date.now();
    const maxAge = 300000; // 5 minutes max
    const allPositions = [
      ...historicPositions.filter((p) => now - p.time < maxAge),
      ...realtimePositions.filter((p) => now - p.time < maxAge),
    ].sort((a, b) => a.time - b.time);

    // Need at least 2 points to draw a line
    if (allPositions.length < 2) return;

    // Select positions based on target distance (uniform length for all aircraft)
    const positions = [];
    let accumulatedDist = 0;
    // Walk backward from most recent position
    for (let i = allPositions.length - 1; i >= 0; i--) {
      const p = allPositions[i];
      if (positions.length === 0) {
        positions.unshift(p);
      } else {
        const nextP = positions[0];
        const segDist = getSegmentDistanceNm(p.lat, p.lon, nextP.lat, nextP.lon);
        if (accumulatedDist + segDist <= targetTrailNm) {
          positions.unshift(p);
          accumulatedDist += segDist;
        } else {
          // Interpolate final point to hit exact target distance
          const remaining = targetTrailNm - accumulatedDist;
          const ratio = remaining / segDist;
          const interpLat = nextP.lat + (p.lat - nextP.lat) * ratio;
          const interpLon = nextP.lon + (p.lon - nextP.lon) * ratio;
          const interpAlt =
            nextP.alt && p.alt ? nextP.alt + (p.alt - nextP.alt) * ratio : p.alt || nextP.alt;
          positions.unshift({ lat: interpLat, lon: interpLon, alt: interpAlt, time: p.time });
          break;
        }
      }
    }

    // Need at least 2 points to draw
    if (positions.length < 2) return;

    // Draw trail with fading opacity (older = more transparent)
    const isSelected = selectedAircraft?.hex === ac.hex;

    // Draw altitude gradient in pro mode when altitude trails enabled
    if (isPro && showAltitudeTrails) {
      // Draw individual segments with smooth altitude gradient
      for (let i = 1; i < positions.length; i++) {
        // LOD: skip trail points at far ranges for performance
        if (lodTrailStride > 1 && i % lodTrailStride !== 0 && i !== positions.length - 1) continue;
        const p1 = positions[i - 1];
        const p2 = positions[i];
        const pos1 = latLonToScreen(p1.lat, p1.lon);
        const pos2 = latLonToScreen(p2.lat, p2.lon);

        if (pos1.x < -50 || pos1.x > width + 50 || pos1.y < -50 || pos1.y > height + 50) continue;
        if (pos2.x < -50 || pos2.x > width + 50 || pos2.y < -50 || pos2.y > height + 50) continue;

        // Create gradient for this segment
        const gradient = ctx.createLinearGradient(pos1.x, pos1.y, pos2.x, pos2.y);
        const opacity1 = (isSelected ? 0.5 : 0.3) + ((i - 1) / positions.length) * 0.5;
        const opacity2 = (isSelected ? 0.5 : 0.3) + (i / positions.length) * 0.5;
        const rgb1 = getAltitudeRGB(p1.alt);
        const rgb2 = getAltitudeRGB(p2.alt);
        gradient.addColorStop(0, `rgba(${rgb1.r}, ${rgb1.g}, ${rgb1.b}, ${opacity1})`);
        gradient.addColorStop(1, `rgba(${rgb2.r}, ${rgb2.g}, ${rgb2.b}, ${opacity2})`);

        ctx.beginPath();
        ctx.moveTo(pos1.x, pos1.y);
        ctx.lineTo(pos2.x, pos2.y);
        ctx.strokeStyle = gradient;
        ctx.stroke();
      }
    } else {
      // Standard white trail for non-pro mode
      ctx.beginPath();
      let started = false;

      positions.forEach((point, i) => {
        // LOD: skip trail points at far ranges for performance
        if (lodTrailStride > 1 && i % lodTrailStride !== 0 && i !== positions.length - 1) return;
        const pos = latLonToScreen(point.lat, point.lon);
        if (pos.x < -50 || pos.x > width + 50 || pos.y < -50 || pos.y > height + 50) return;

        if (!started) {
          ctx.moveTo(pos.x, pos.y);
          started = true;
        } else {
          ctx.lineTo(pos.x, pos.y);
        }
      });

      const opacity = isSelected ? 0.6 : 0.35;
      ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
      ctx.stroke();
    }
  });

  ctx.restore();
}
