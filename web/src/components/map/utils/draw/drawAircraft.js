/**
 * Aircraft rendering pipeline: symbol drawing, data blocks, badges,
 * safety/emergency overlays, prediction vectors, and auto-deconfliction.
 *
 * Each function receives:
 *   ctx  - Canvas 2D rendering context
 *   geo  - {
 *            width, height, centerX, centerY, maxRadius,
 *            isPro, radarRange, themeColors, latLonToScreen,
 *            frameCount, feederLat, feederLon, proPanOffset
 *          }
 *   data - per-function data bag (see JSDoc on each export)
 */

import { DATA_BLOCK_DEFAULT_X, DATA_BLOCK_DEFAULT_Y } from '../../hooks';
import { callsignsMatch, determineWakeCategory, getWakeCategoryColor } from '../../../../utils';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Severity-based colour set used for safety-alert rings and labels.
 */
function getSeverityColors(severity, flashOn) {
  const intensity = flashOn ? 1 : 0.6;
  switch (severity) {
    case 'critical':
      return {
        primary: `rgba(255, 80, 150, ${intensity})`,
        text: `rgba(255, 120, 180, ${intensity})`,
        ring: `rgba(255, 80, 150, ${flashOn ? 0.9 : 0.5})`,
        ringInner: `rgba(255, 50, 120, ${(flashOn ? 0.9 : 0.5) * 0.6})`,
      };
    case 'warning':
      return {
        primary: `rgba(255, 140, 0, ${intensity})`,
        text: `rgba(255, 180, 80, ${intensity})`,
        ring: `rgba(255, 140, 0, ${flashOn ? 0.9 : 0.5})`,
        ringInner: `rgba(255, 100, 0, ${(flashOn ? 0.9 : 0.5) * 0.6})`,
      };
    default: // low
      return {
        primary: `rgba(255, 220, 0, ${intensity})`,
        text: `rgba(255, 240, 100, ${intensity})`,
        ring: `rgba(255, 220, 0, ${flashOn ? 0.9 : 0.5})`,
        ringInner: `rgba(255, 180, 0, ${(flashOn ? 0.9 : 0.5) * 0.6})`,
      };
  }
}

// ---------------------------------------------------------------------------
// 1. drawAllAircraft
// ---------------------------------------------------------------------------

/**
 * Complete aircraft rendering pipeline: sorting, per-aircraft symbol/data-block
 * drawing, badges, safety overlays, prediction vectors, wake rings, MSAW, and
 * post-pass auto-deconfliction.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geo
 * @param {object} data
 *   sortedAircraft, overlays, selectedAircraft, activeConflicts,
 *   conflictAircraft, trackHistoryRef, acarsMessages, aircraftInfo,
 *   showPredictionVectors, predictionSeconds, showVsTrend, showSpeedColors,
 *   showConflictVisualization, showDataBlocks, dataBlockConfig,
 *   dataBlockVisibleSet (externally-computed), msaw, showWakeRings,
 *   showAltitudeTrails, hasHighlightGroups, highlightedHexes,
 *   highlightGroupColors, highContrastMode, getDistanceNm, getBearing,
 *   getDataBlockOffset, hasCustomDataBlockOffset,
 *   autoDeconflictEnabled, maybeDeconflict,
 *   sweepAngleRef, perfMode, getAircraftHighlight
 */
export function drawAllAircraft(ctx, geo, data) {
  const { width, height, isPro, radarRange, themeColors, latLonToScreen, frameCount } = geo;

  const {
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
    showDataBlocks,
    dataBlockConfig,
    msaw,
    showWakeRings,
    hasHighlightGroups,
    highContrastMode,
    getDistanceNm,
    getBearing,
    getDataBlockOffset,
    hasCustomDataBlockOffset,
    autoDeconflictEnabled,
    maybeDeconflict,
    sweepAngleRef,
    perfMode,
    getAircraftHighlight,
  } = data;

  // Draw aircraft (if overlay enabled)
  // Sort so aircraft with safety events are drawn last (on top)
  if (!overlays.aircraft) return;

  const aircraftToDraw = [...sortedAircraft].sort((a, b) => {
    const aHasSafety = conflictAircraft.has(a.hex?.toUpperCase());
    const bHasSafety = conflictAircraft.has(b.hex?.toUpperCase());
    if (aHasSafety && !bHasSafety) return 1; // a comes after b (drawn on top)
    if (!aHasSafety && bHasSafety) return -1; // b comes after a
    return 0;
  });

  // Data block thinning: limit data blocks based on screen density
  // When many aircraft are visible, show fewer data blocks to reduce clutter
  // Count visible aircraft on screen first (using same viewport culling as rendering)
  const visibleOnScreen = aircraftToDraw.filter((ac) => {
    if (!ac.lat || !ac.lon) return false; // Skip aircraft without position
    const pos = latLonToScreen(ac.lat, ac.lon);
    if (isPro) {
      // Pro mode: viewport-based visibility
      return pos.x >= -30 && pos.x <= width + 30 && pos.y >= -30 && pos.y <= height + 30;
    } else {
      // CRT mode: distance-based visibility
      const dist = ac.distance_nm || getDistanceNm(ac.lat, ac.lon);
      return dist <= radarRange;
    }
  });

  const density = visibleOnScreen.length;

  // Density-based max data blocks (in Pro mode only)
  // Fewer aircraft = show all labels; more aircraft = thin out labels
  const maxDataBlocks = isPro
    ? density <= 15
      ? Infinity // Low density: show all
      : density <= 30
        ? 25
        : density <= 50
          ? 20
          : density <= 100
            ? 15
            : 10 // Very crowded: show only 10
    : Infinity; // No thinning in non-Pro mode

  // Build set of aircraft that should show data blocks (priority-based)
  const dataBlockVisibleSet = new Set();
  if (maxDataBlocks !== Infinity && isPro) {
    // Calculate screen positions and local density for each aircraft
    const aircraftWithScreenPos = visibleOnScreen.map((ac) => {
      const pos = latLonToScreen(ac.lat, ac.lon);
      return { ac, x: pos.x, y: pos.y };
    });

    // Score aircraft by priority (higher = more important)
    const scoredAircraft = aircraftWithScreenPos
      .map(({ ac, x, y }) => {
        let score = 0;
        const hex = ac.hex?.toUpperCase();

        // Always show: selected, emergency, military, safety conflicts
        if (selectedAircraft?.hex?.toUpperCase() === hex) score += 10000;
        if (ac.emergency || ['7500', '7600', '7700'].includes(ac.squawk)) score += 5000;
        if (ac.military) score += 3000;
        if (conflictAircraft.has(hex)) score += 4000;

        // High priority: aircraft with ACARS messages
        const hasAcars = acarsMessages.some(
          (msg) =>
            (msg.icao_hex && msg.icao_hex.toUpperCase() === hex) ||
            (msg.callsign &&
              ac.flight &&
              msg.callsign.toUpperCase() === ac.flight.trim().toUpperCase())
        );
        if (hasAcars) score += 2000;

        // Higher priority for aircraft with callsigns vs hex-only
        if (ac.flight?.trim()) score += 500;

        // Calculate local density penalty (nearby aircraft within 80px)
        const nearbyCount = aircraftWithScreenPos.filter(
          (other) =>
            other.ac.hex !== ac.hex && Math.abs(other.x - x) < 80 && Math.abs(other.y - y) < 50
        ).length;
        // Penalize aircraft in crowded areas (less likely to show label)
        score -= nearbyCount * 30;

        // Prefer aircraft closer to center of screen
        const centerDist = Math.sqrt(Math.pow(x - width / 2, 2) + Math.pow(y - height / 2, 2));
        score += Math.max(0, 200 - centerDist / 3);

        // Prefer faster aircraft (more interesting)
        if (ac.gs) score += Math.min(ac.gs / 10, 50);

        return { hex, score };
      })
      .sort((a, b) => b.score - a.score);

    // Add top N aircraft to visible set
    scoredAircraft.slice(0, maxDataBlocks).forEach(({ hex }) => {
      dataBlockVisibleSet.add(hex);
    });
  }

  // Phase 14.3: Collect data block rects for auto-deconfliction
  const dataBlockRects = [];

  aircraftToDraw.forEach((ac) => {
    // Skip aircraft without valid position
    if (!ac.lat || !ac.lon) return;

    // Use latLonToScreen for positioning (do this first for early culling)
    const pos = latLonToScreen(ac.lat, ac.lon);
    const x = pos.x;
    const y = pos.y;

    // Skip if outside visible area (with margin for data blocks/blips)
    // Data blocks extend ~120px right and ~60px down from aircraft position
    // Aircraft blips are ~20px, so add margin on all sides
    const margin = 30; // Margin for aircraft blip visibility at edges
    const dataBlockMarginRight = 150; // Extra margin for data blocks on right
    const dataBlockMarginBottom = 80; // Extra margin for data blocks below

    if (isPro) {
      // Pro mode: strict viewport culling with margins
      if (
        x < -margin ||
        x > width + dataBlockMarginRight ||
        y < -margin ||
        y > height + dataBlockMarginBottom
      )
        return;
    } else {
      // CRT mode: use distance-based culling
      const dist = ac.distance_nm || getDistanceNm(ac.lat, ac.lon);
      if (dist > radarRange) return;
    }

    // Calculate blip brightness based on sweep position (CRT) or constant (Pro)
    const bearing = getBearing(ac.lat, ac.lon);
    let brightness = 1;
    if (!isPro) {
      let sweepDiff = (sweepAngleRef.current - bearing + 360) % 360;
      if (sweepDiff > 180) sweepDiff = 360 - sweepDiff;
      brightness = Math.max(0.3, 1 - sweepDiff / 180);
    }

    // Determine colors - Pro mode uses brighter colors
    const isEmergency = ac.emergency || ['7500', '7600', '7700'].includes(ac.squawk);
    const isMilitary = ac.military;
    const isProximityConflict = conflictAircraft.has(ac.hex);

    // Check for safety events (from API)
    const safetyEvent = activeConflicts.find(
      (e) =>
        e.icao?.toUpperCase() === ac.hex?.toUpperCase() ||
        e.icao_2?.toUpperCase() === ac.hex?.toUpperCase()
    );
    const hasSafetyAlert = !!safetyEvent || isProximityConflict;
    const alertSeverity = safetyEvent?.severity || (isProximityConflict ? 'warning' : null);

    // Emergency flash effect
    const flashOn = isEmergency ? Math.floor(frameCount / 15) % 2 === 0 : true;
    const flashBrightness = flashOn ? 1 : 0.3;

    // Proximity conflict flash speed based on severity
    const flashDivisor = alertSeverity === 'critical' ? 4 : alertSeverity === 'warning' ? 8 : 12;
    const proximityFlashOn = hasSafetyAlert
      ? Math.floor(frameCount / flashDivisor) % 2 === 0
      : false;

    // Color determination
    let primaryColor, textColor;
    if (hasSafetyAlert) {
      const sevColors = getSeverityColors(alertSeverity, proximityFlashOn);
      primaryColor = sevColors.primary;
      textColor = sevColors.text;
    } else if (isEmergency) {
      const r = flashOn ? 255 : 180;
      const intensity = brightness * flashBrightness;
      primaryColor = `rgba(${r}, 50, 50, ${Math.max(0.5, intensity)})`;
      textColor = `rgba(255, 100, 100, ${Math.max(0.6, intensity)})`;
    } else if (isMilitary) {
      // Purple for military
      primaryColor = isPro ? `rgba(200, 100, 255, 0.9)` : `rgba(180, 80, 255, ${brightness})`;
      textColor = isPro ? 'rgba(220, 150, 255, 0.9)' : `rgba(200, 150, 255, ${brightness})`;
    } else if (isPro && hasHighlightGroups) {
      // Check for highlight group color (Pro mode only)
      const highlight = getAircraftHighlight(ac);
      if (highlight && highlight.color) {
        // Convert hex color to rgba for consistency
        const hexToRgba = (hex, alpha) => {
          const r = parseInt(hex.slice(1, 3), 16);
          const g = parseInt(hex.slice(3, 5), 16);
          const b = parseInt(hex.slice(5, 7), 16);
          return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        };
        primaryColor = hexToRgba(highlight.color, 0.9);
        // Slightly lighter version for text
        const r = parseInt(highlight.color.slice(1, 3), 16);
        const g = parseInt(highlight.color.slice(3, 5), 16);
        const b = parseInt(highlight.color.slice(5, 7), 16);
        textColor = `rgba(${Math.min(255, r + 50)}, ${Math.min(255, g + 50)}, ${Math.min(255, b + 50)}, 0.95)`;
      } else if (showSpeedColors && ac.gs) {
        // Fall through to speed colors if no highlight match
        const speed = ac.gs;
        if (speed > 500) {
          primaryColor = 'rgba(255, 165, 0, 0.9)';
          textColor = 'rgba(255, 200, 100, 0.9)';
        } else if (speed > 300) {
          primaryColor = 'rgba(255, 255, 0, 0.9)';
          textColor = 'rgba(255, 255, 150, 0.9)';
        } else if (speed < 150) {
          primaryColor = 'rgba(100, 180, 255, 0.9)';
          textColor = 'rgba(150, 200, 255, 0.9)';
        } else {
          primaryColor = 'rgba(0, 255, 200, 0.9)';
          textColor = 'rgba(150, 255, 220, 0.9)';
        }
      } else {
        // Default green
        primaryColor = 'rgba(0, 255, 150, 0.9)';
        textColor = 'rgba(150, 255, 200, 0.9)';
      }
    } else if (showSpeedColors && ac.gs) {
      // Speed-based coloring for civilian (Phase 2.2)
      const speed = ac.gs;
      if (speed > 500) {
        // Very fast (> 500 kts): Orange
        primaryColor = isPro ? 'rgba(255, 165, 0, 0.9)' : `rgba(255, 165, 0, ${brightness})`;
        textColor = isPro ? 'rgba(255, 200, 100, 0.9)' : `rgba(255, 200, 100, ${brightness})`;
      } else if (speed > 300) {
        // Fast (300-500 kts): Yellow
        primaryColor = isPro ? 'rgba(255, 255, 0, 0.9)' : `rgba(255, 255, 0, ${brightness})`;
        textColor = isPro ? 'rgba(255, 255, 150, 0.9)' : `rgba(255, 255, 150, ${brightness})`;
      } else if (speed < 150) {
        // Slow (< 150 kts): Blue
        primaryColor = isPro ? 'rgba(100, 180, 255, 0.9)' : `rgba(100, 180, 255, ${brightness})`;
        textColor = isPro ? 'rgba(150, 200, 255, 0.9)' : `rgba(150, 200, 255, ${brightness})`;
      } else {
        // Medium (150-300 kts): Cyan (default)
        primaryColor = isPro ? 'rgba(0, 255, 200, 0.9)' : `rgba(0, 255, 200, ${brightness})`;
        textColor = isPro ? 'rgba(150, 255, 220, 0.9)' : `rgba(150, 255, 220, ${brightness})`;
      }
    } else {
      // Green for civilian (default)
      primaryColor = isPro ? 'rgba(0, 255, 150, 0.9)' : `rgba(0, 255, 150, ${brightness})`;
      textColor = isPro ? 'rgba(150, 255, 200, 0.9)' : `rgba(150, 255, 200, ${brightness})`;
    }

    // Draw safety alert warning ring (severity-based colors)
    if (hasSafetyAlert) {
      ctx.save();
      const sevColors = getSeverityColors(alertSeverity, proximityFlashOn);
      const ringSize = proximityFlashOn ? 24 : 20;

      // Outer warning ring
      ctx.beginPath();
      ctx.arc(x, y, ringSize, 0, Math.PI * 2);
      ctx.strokeStyle = sevColors.ring;
      ctx.lineWidth = alertSeverity === 'critical' ? 4 : 3;
      ctx.stroke();

      // Inner ring
      ctx.beginPath();
      ctx.arc(x, y, ringSize - 6, 0, Math.PI * 2);
      ctx.strokeStyle = sevColors.ringInner;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.restore();
    }

    // Draw emergency glow ring
    if (isEmergency && flashOn && !hasSafetyAlert) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, 18 + Math.sin(frameCount * 0.2) * 3, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 0, 0, ${0.4 + Math.sin(frameCount * 0.15) * 0.2})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    // Draw selection highlight (flashing green outline)
    const isSelected = selectedAircraft && selectedAircraft.hex === ac.hex;
    if (isSelected) {
      const selFlash = Math.floor(frameCount / 10) % 2 === 0;
      const selAlpha = selFlash ? 0.9 : 0.4;
      const selSize = selFlash ? 22 : 20;

      ctx.save();
      ctx.strokeStyle = `rgba(100, 220, 255, ${selAlpha})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(x, y, selSize, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Corner brackets
      ctx.strokeStyle = `rgba(100, 220, 255, ${selAlpha})`;
      ctx.lineWidth = 2;
      const bSize = 15;
      const bLen = 6;
      // Top-left
      ctx.beginPath();
      ctx.moveTo(x - bSize, y - bSize + bLen);
      ctx.lineTo(x - bSize, y - bSize);
      ctx.lineTo(x - bSize + bLen, y - bSize);
      ctx.stroke();
      // Top-right
      ctx.beginPath();
      ctx.moveTo(x + bSize - bLen, y - bSize);
      ctx.lineTo(x + bSize, y - bSize);
      ctx.lineTo(x + bSize, y - bSize + bLen);
      ctx.stroke();
      // Bottom-left
      ctx.beginPath();
      ctx.moveTo(x - bSize, y + bSize - bLen);
      ctx.lineTo(x - bSize, y + bSize);
      ctx.lineTo(x - bSize + bLen, y + bSize);
      ctx.stroke();
      // Bottom-right
      ctx.beginPath();
      ctx.moveTo(x + bSize - bLen, y + bSize);
      ctx.lineTo(x + bSize, y + bSize);
      ctx.lineTo(x + bSize, y + bSize - bLen);
      ctx.stroke();

      ctx.restore();
    }

    // Draw aircraft symbol (chevron pointing in direction of travel)
    const track = ((ac.track || 0) * Math.PI) / 180;
    // Phase 5.4: Level of Detail (LOD) - adjust symbol size based on range
    const lodFactor = radarRange <= 25 ? 1.2 : radarRange <= 75 ? 1 : radarRange <= 150 ? 0.9 : 0.8;
    const symSize = Math.round((isPro ? 10 : 9) * lodFactor);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(track);

    // Main symbol - different shapes for accessibility (Phase 7.1)
    ctx.fillStyle = primaryColor;
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 2;

    if (highContrastMode && isPro) {
      // High contrast mode: use different shapes per aircraft type
      if (isEmergency) {
        // Emergency: Circle with X
        ctx.beginPath();
        ctx.arc(0, 0, symSize * 0.8, 0, Math.PI * 2);
        ctx.stroke();
        // X inside
        ctx.beginPath();
        ctx.moveTo(-symSize * 0.5, -symSize * 0.5);
        ctx.lineTo(symSize * 0.5, symSize * 0.5);
        ctx.moveTo(symSize * 0.5, -symSize * 0.5);
        ctx.lineTo(-symSize * 0.5, symSize * 0.5);
        ctx.stroke();
      } else if (isMilitary) {
        // Military: Diamond
        ctx.beginPath();
        ctx.moveTo(0, -symSize);
        ctx.lineTo(symSize * 0.7, 0);
        ctx.lineTo(0, symSize);
        ctx.lineTo(-symSize * 0.7, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        // Civilian: Triangle (default chevron)
        ctx.beginPath();
        ctx.moveTo(0, -symSize);
        ctx.lineTo(-symSize * 0.6, symSize * 0.5);
        ctx.lineTo(0, symSize * 0.2);
        ctx.lineTo(symSize * 0.6, symSize * 0.5);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      // Normal mode: filled chevron for all
      ctx.beginPath();
      ctx.moveTo(0, -symSize);
      ctx.lineTo(-symSize * 0.6, symSize * 0.5);
      ctx.lineTo(0, symSize * 0.2);
      ctx.lineTo(symSize * 0.6, symSize * 0.5);
      ctx.closePath();
      ctx.fill();
    }

    // Calculate turn rate from track history for curved velocity vectors
    let turnRate = 0; // degrees per second, positive = right turn
    const trackHistory = trackHistoryRef.current[ac.hex];
    if (trackHistory && trackHistory.length >= 2) {
      const oldest = trackHistory[0];
      const newest = trackHistory[trackHistory.length - 1];
      const timeDiff = (newest.time - oldest.time) / 1000; // seconds
      if (timeDiff > 0.5) {
        // Calculate track change, handling wrap-around at 360
        let trackChange = newest.track - oldest.track;
        if (trackChange > 180) trackChange -= 360;
        if (trackChange < -180) trackChange += 360;
        turnRate = trackChange / timeDiff;
        // Clamp to reasonable values (max ~6 deg/sec for steep turns)
        turnRate = Math.max(-6, Math.min(6, turnRate));
      }
    }

    // Velocity vector line - basic (short)
    if (ac.gs > 50) {
      const vecLen = Math.min(20, ac.gs / 25);
      ctx.strokeStyle = isPro
        ? themeColors.rgba('vector', 0.6)
        : `rgba(0, 220, 255, ${brightness * 0.5})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -symSize);
      ctx.lineTo(0, -symSize - vecLen);
      ctx.stroke();
    }

    // Extended prediction vectors (Phase 2.3) - skip when too many aircraft
    // Now supports curved paths for turning aircraft
    if (showPredictionVectors && ac.gs > 50 && isPro && !perfMode.skipPredictionVectors) {
      const pixelsPerNm = (Math.min(width, height) * 0.45) / radarRange;
      const nmPerSecond = ac.gs / 3600; // Convert knots to nm/second
      const isTurning = Math.abs(turnRate) > 0.3; // Significant turn threshold

      // Max vector lengths in pixels (prevents excessively long vectors when zoomed in)
      const maxLen30s = 120;
      const maxLen60s = 200;
      const maxLen120s = 280;

      if (isTurning) {
        // Draw curved prediction vectors for turning aircraft
        // Simple approach: integrate position with changing heading
        const pxPerSecond = nmPerSecond * pixelsPerNm;

        // Helper to draw curved path segment with max length
        const drawCurvedSegment = (startSec, endSec, opacity, dashPattern, maxLen) => {
          ctx.strokeStyle = themeColors.rgba('vector', opacity);
          ctx.lineWidth = 1;
          ctx.setLineDash(dashPattern);
          ctx.beginPath();

          const stepSec = 2;
          let startX = 0,
            startY = -symSize - 20;
          let totalDist = 0;

          // Calculate starting position from previous segments
          if (startSec > 0) {
            let headingRad = 0;
            let posX = 0,
              posY = 0;
            for (let t = 0; t < startSec; t += stepSec) {
              const dt = Math.min(stepSec, startSec - t);
              headingRad += (turnRate * dt * Math.PI) / 180;
              posX += Math.sin(headingRad) * pxPerSecond * dt;
              posY -= Math.cos(headingRad) * pxPerSecond * dt;
            }
            startX = posX;
            startY = posY - symSize - 20;
          }

          ctx.moveTo(startX, startY);

          let headingRad = (turnRate * startSec * Math.PI) / 180;
          let posX = startX,
            posY = startY;

          for (let t = startSec; t < endSec; t += stepSec) {
            const dt = Math.min(stepSec, endSec - t);
            headingRad += (turnRate * dt * Math.PI) / 180;
            const dx = Math.sin(headingRad) * pxPerSecond * dt;
            const dy = -Math.cos(headingRad) * pxPerSecond * dt;
            posX += dx;
            posY += dy;
            totalDist += Math.sqrt(dx * dx + dy * dy);

            ctx.lineTo(posX, posY);
            if (totalDist > maxLen) break; // Stop if max length reached
          }
          ctx.stroke();
        };

        // 30-second prediction (dotted)
        drawCurvedSegment(0, 30, 0.4, [3, 3], maxLen30s);

        // 60-second prediction (fainter dotted)
        if (predictionSeconds >= 60) {
          drawCurvedSegment(30, 60, 0.25, [2, 4], maxLen60s - maxLen30s);
        }

        // 120-second prediction (very faint)
        if (predictionSeconds >= 120) {
          drawCurvedSegment(60, 120, 0.15, [2, 6], maxLen120s - maxLen60s);
        }
      } else {
        // Straight prediction vectors (original behavior) with max lengths
        const nm30s = nmPerSecond * 30;
        const px30s = Math.min(nm30s * pixelsPerNm, maxLen30s);
        ctx.strokeStyle = themeColors.rgba('vector', 0.4);
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(0, -symSize - 20);
        ctx.lineTo(0, -symSize - 20 - px30s);
        ctx.stroke();

        // 60-second prediction (fainter dotted)
        if (predictionSeconds >= 60) {
          const nm60s = nmPerSecond * 60;
          const px60s = Math.min(nm60s * pixelsPerNm, maxLen60s);
          ctx.strokeStyle = themeColors.rgba('vector', 0.25);
          ctx.setLineDash([2, 4]);
          ctx.beginPath();
          ctx.moveTo(0, -symSize - 20 - px30s);
          ctx.lineTo(0, -symSize - 20 - px60s);
          ctx.stroke();
        }

        // 120-second prediction (very faint)
        if (predictionSeconds >= 120) {
          const nm120s = nmPerSecond * 120;
          const px120s = Math.min(nm120s * pixelsPerNm, maxLen120s);
          const px60sStart = Math.min(nmPerSecond * 60 * pixelsPerNm, maxLen60s);
          ctx.strokeStyle = themeColors.rgba('vector', 0.15);
          ctx.setLineDash([2, 6]);
          ctx.beginPath();
          ctx.moveTo(0, -symSize - 20 - px60sStart);
          ctx.lineTo(0, -symSize - 20 - px120s);
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
    }

    ctx.restore();

    // Altitude trend indicators (Phase 2.1) - drawn outside rotation
    const vs = ac.vr ?? ac.baro_rate ?? ac.geom_rate ?? 0;
    if (showVsTrend && isPro && Math.abs(vs) > 500) {
      const isClimbing = vs > 0;
      const isRapid = Math.abs(vs) > 2000;
      const trendColor = isClimbing ? 'rgba(0, 255, 100, 0.9)' : 'rgba(255, 200, 0, 0.9)';

      ctx.save();
      ctx.fillStyle = trendColor;
      ctx.font = isRapid
        ? 'bold 12px "JetBrains Mono", monospace'
        : '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Draw single or double chevron
      const trendX = x - 18;
      const trendY = y;
      if (isRapid) {
        // Double chevron for rapid climb/descent
        ctx.fillText(isClimbing ? '\u25B2\u25B2' : '\u25BC\u25BC', trendX, trendY);
      } else {
        // Single chevron
        ctx.fillText(isClimbing ? '\u25B2' : '\u25BC', trendX, trendY);
      }
      ctx.restore();
    }

    // Phase 8.2: MSAW warning visualization - pulsing ring around aircraft
    if (msaw.enabled) {
      const msawWarning = msaw.getWarning(ac.hex);
      if (msawWarning) {
        const pulseAlpha = 0.4 + 0.4 * Math.abs(Math.sin(Date.now() / 300));
        const ringColor =
          msawWarning.status === 'alert'
            ? `rgba(255, 50, 50, ${pulseAlpha})` // Red for alert (<500ft)
            : `rgba(255, 200, 0, ${pulseAlpha})`; // Yellow for warning (<1000ft)
        ctx.save();
        ctx.strokeStyle = ringColor;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, y, symSize + 6, 0, Math.PI * 2);
        ctx.stroke();
        // Draw "MSAW" text above aircraft
        ctx.fillStyle = ringColor;
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('MSAW', x, y - symSize - 8);
        ctx.restore();
      }
    }

    // Phase 8.4: Wake turbulence separation ring for H/J aircraft
    if (showWakeRings && isPro) {
      const wakeCat = determineWakeCategory(ac, aircraftInfo?.[ac.hex?.toUpperCase()] || {});
      const WAKE_SEP_NM = { J: 8, H: 6 };
      const sepNm = WAKE_SEP_NM[wakeCat] || 0;
      if (sepNm > 0) {
        const wakePixelsPerNm = (Math.min(width, height) * 0.45) / radarRange;
        const sepPx = sepNm * wakePixelsPerNm;
        const catColor = getWakeCategoryColor(wakeCat);
        ctx.save();
        ctx.strokeStyle = catColor + '66'; // semi-transparent
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.arc(x, y, sepPx, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        // Label
        ctx.fillStyle = catColor + '99';
        ctx.font = '8px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`${sepNm}nm`, x + sepPx + 3, y);
        ctx.restore();
      }
    }

    // Position for data block (used by both data block and alert labels)
    // Phase 14.3: Support custom data block positions with leader lines
    const dataBlockOffset = getDataBlockOffset(ac.hex);
    const hasCustomPosition = hasCustomDataBlockOffset(ac.hex);
    const blockX = x + DATA_BLOCK_DEFAULT_X + dataBlockOffset.x;
    const blockY = y + DATA_BLOCK_DEFAULT_Y + dataBlockOffset.y;
    if (hasCustomPosition && isPro) {
      const leaderDist = Math.sqrt(dataBlockOffset.x ** 2 + dataBlockOffset.y ** 2);
      if (leaderDist > 20) {
        ctx.save();
        ctx.strokeStyle = themeColors.rgba('vector', 0.4);
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(blockX - 2, blockY + 10);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    // Draw data block (callsign, speed, altitude, etc.) - respects showDataBlocks toggle, performance mode, and dataBlockConfig
    // Check if data block should be shown (respects thinning at zoomed-out levels)
    // If thinning is not active (set is empty) or aircraft is in priority set, show data block
    const acHex = ac.hex?.toUpperCase();
    const showThisDataBlock =
      !isPro || // Always show in non-Pro mode
      dataBlockVisibleSet.size === 0 || // No thinning active
      !acHex || // Always show if no hex (shouldn't happen but be safe)
      dataBlockVisibleSet.has(acHex);

    if (showDataBlocks && !perfMode.skipDataBlocks && showThisDataBlock) {
      const callsign = ac.flight?.trim() || ac.hex;
      const speed = ac.gs ? `${Math.round(ac.gs)}` : '---';
      const altitude = ac.alt ? `${Math.round(ac.alt / 100)}` : '---';
      const heading = ac.track != null ? `${Math.round(ac.track)}\u00B0` : '---';
      const verticalSpeed =
        (ac.vr ?? ac.baro_rate) != null
          ? `${(ac.vr ?? ac.baro_rate) > 0 ? '+' : ''}${Math.round(ac.vr ?? ac.baro_rate)}fpm`
          : null;
      const aircraftType = ac.t || ac.desc || null;
      // Phase 8.4: Wake Turbulence Category
      const acInfo = aircraftInfo?.[ac.hex?.toUpperCase()] || {};
      const wakeCategory = determineWakeCategory(ac, acInfo);
      const wakeColor = wakeCategory ? getWakeCategoryColor(wakeCategory) : null;

      ctx.font = '13px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';

      // Build data block content based on config
      let labelLines = [];
      let labelWidth = 0;

      if (dataBlockConfig.compact) {
        // Compact mode: single line with all enabled fields
        const compactParts = [];
        if (dataBlockConfig.showCallsign) compactParts.push(callsign);
        if (dataBlockConfig.showSpeed) compactParts.push(`${speed}kts`);
        if (dataBlockConfig.showAltitude) compactParts.push(`FL${altitude}`);
        if (dataBlockConfig.showHeading) compactParts.push(heading);
        if (dataBlockConfig.showVerticalSpeed && verticalSpeed) compactParts.push(verticalSpeed);
        if (dataBlockConfig.showAircraftType && aircraftType) compactParts.push(aircraftType);
        if (dataBlockConfig.showWakeCategory && wakeCategory)
          compactParts.push(`[${wakeCategory}]`);

        const compactLine = compactParts.join(' ');
        labelLines = [{ text: compactLine, isCallsign: true }];
        labelWidth = ctx.measureText(compactLine).width + 8;
      } else {
        // Multi-line mode: each field on separate line or grouped logically
        // Line 1: Callsign (if enabled)
        if (dataBlockConfig.showCallsign) {
          labelLines.push({ text: callsign, isCallsign: true });
          labelWidth = Math.max(labelWidth, ctx.measureText(callsign).width);
        }

        // Line 2: Speed and Altitude (combined if both enabled)
        const line2Parts = [];
        if (dataBlockConfig.showSpeed) line2Parts.push(`${speed}kts`);
        if (dataBlockConfig.showAltitude) line2Parts.push(altitude);
        if (line2Parts.length > 0) {
          const line2 = line2Parts.join(' ');
          labelLines.push({ text: line2, isCallsign: false });
          labelWidth = Math.max(labelWidth, ctx.measureText(line2).width);
        }

        // Line 3: Heading (if enabled)
        if (dataBlockConfig.showHeading) {
          const headingLine = `HDG ${heading}`;
          labelLines.push({ text: headingLine, isCallsign: false });
          labelWidth = Math.max(labelWidth, ctx.measureText(headingLine).width);
        }

        // Line 4: Vertical Speed (if enabled and available)
        if (dataBlockConfig.showVerticalSpeed && verticalSpeed) {
          const vsLine = `VS ${verticalSpeed}`;
          labelLines.push({ text: vsLine, isCallsign: false });
          labelWidth = Math.max(labelWidth, ctx.measureText(vsLine).width);
        }

        // Line 5: Aircraft Type (if enabled and available)
        if (dataBlockConfig.showAircraftType && aircraftType) {
          labelLines.push({ text: aircraftType, isCallsign: false });
          labelWidth = Math.max(labelWidth, ctx.measureText(aircraftType).width);
        }

        // Line 6: Wake Turbulence Category (Phase 8.4)
        if (dataBlockConfig.showWakeCategory && wakeCategory) {
          const wakeLine = `WTC ${wakeCategory}`;
          labelLines.push({ text: wakeLine, isCallsign: false, color: wakeColor });
          labelWidth = Math.max(labelWidth, ctx.measureText(wakeLine).width);
        }

        labelWidth += 8;
      }

      // Calculate label height based on number of lines (15px per line + padding)
      const lineHeight = 15;
      const labelHeight = Math.max(18, labelLines.length * lineHeight + 4);

      // Phase 14.3: Collect data block rect for auto-deconfliction
      if (isPro) {
        dataBlockRects.push({
          hex: ac.hex?.toUpperCase(),
          x: blockX - 4,
          y: blockY - 2,
          width: labelWidth,
          height: labelHeight,
          aircraftX: x,
          aircraftY: y,
        });
      }

      // Draw background for label readability
      ctx.fillStyle = isPro ? 'rgba(10, 13, 18, 0.85)' : 'rgba(10, 15, 10, 0.8)';
      ctx.fillRect(blockX - 4, blockY - 2, labelWidth, labelHeight);

      // ACARS indicator - small green dot at top-right corner if aircraft has ACARS messages
      const hasAcars = acarsMessages.some(
        (msg) =>
          (msg.icao_hex && msg.icao_hex.toUpperCase() === ac.hex?.toUpperCase()) ||
          callsignsMatch(msg.callsign, ac.flight)
      );
      if (hasAcars) {
        ctx.save();
        ctx.fillStyle = 'rgba(0, 255, 100, 0.9)';
        ctx.beginPath();
        ctx.arc(blockX + labelWidth - 8, blockY + 2, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Draw each line
      labelLines.forEach((line, index) => {
        if (line.isCallsign) {
          ctx.fillStyle = textColor;
          ctx.font = '13px "JetBrains Mono", monospace';
        } else if (line.color) {
          // Phase 8.4: Custom color for wake turbulence category
          ctx.fillStyle = line.color;
          ctx.font = 'bold 12px "JetBrains Mono", monospace';
        } else {
          ctx.fillStyle = isPro
            ? `rgba(100, 200, 180, 0.85)`
            : `rgba(0, 200, 100, ${brightness * 0.85})`;
          ctx.font = '12px "JetBrains Mono", monospace';
        }
        ctx.fillText(line.text, blockX, blockY + index * lineHeight);
      });

      // Draw status badges (MIL, EMG, TURB) after callsign line
      const isTurbulent = ac.turbulenceLevel === 'moderate' || ac.turbulenceLevel === 'severe';
      if (labelLines.length > 0 && (isMilitary || isEmergency || isTurbulent)) {
        ctx.save();
        ctx.font = 'bold 9px "JetBrains Mono", monospace';
        const callsignWidth = ctx.measureText(labelLines[0]?.text || '').width;
        let badgeX = blockX + callsignWidth + 6;
        const badgeY = blockY - 1;

        // Military badge
        if (isMilitary) {
          const milText = 'MIL';
          const milWidth = ctx.measureText(milText).width + 6;
          ctx.fillStyle = 'rgba(168, 85, 247, 0.3)';
          ctx.fillRect(badgeX, badgeY, milWidth, 12);
          ctx.strokeStyle = 'rgba(168, 85, 247, 0.6)';
          ctx.lineWidth = 1;
          ctx.strokeRect(badgeX, badgeY, milWidth, 12);
          ctx.fillStyle = 'rgba(192, 132, 252, 0.95)';
          ctx.fillText(milText, badgeX + 3, badgeY + 9);
          badgeX += milWidth + 4;
        }

        // Emergency badge
        if (isEmergency) {
          const emgText = 'EMG';
          const emgWidth = ctx.measureText(emgText).width + 6;
          ctx.fillStyle = 'rgba(248, 81, 73, 0.3)';
          ctx.fillRect(badgeX, badgeY, emgWidth, 12);
          ctx.strokeStyle = 'rgba(248, 81, 73, 0.6)';
          ctx.lineWidth = 1;
          ctx.strokeRect(badgeX, badgeY, emgWidth, 12);
          ctx.fillStyle = 'rgba(255, 100, 100, 0.95)';
          ctx.fillText(emgText, badgeX + 3, badgeY + 9);
          badgeX += emgWidth + 4;
        }

        // Turbulence badge (amber moderate, red-orange severe)
        if (isTurbulent) {
          const severe = ac.turbulenceLevel === 'severe';
          const turbText = 'TURB';
          const turbWidth = ctx.measureText(turbText).width + 6;
          ctx.fillStyle = severe ? 'rgba(255, 80, 0, 0.3)' : 'rgba(255, 165, 0, 0.3)';
          ctx.fillRect(badgeX, badgeY, turbWidth, 12);
          ctx.strokeStyle = severe ? 'rgba(255, 80, 0, 0.7)' : 'rgba(255, 165, 0, 0.7)';
          ctx.lineWidth = 1;
          ctx.strokeRect(badgeX, badgeY, turbWidth, 12);
          ctx.fillStyle = severe ? 'rgba(255, 140, 90, 0.95)' : 'rgba(255, 200, 90, 0.95)';
          ctx.fillText(turbText, badgeX + 3, badgeY + 9);
        }
        ctx.restore();
      }
    } // end showDataBlocks

    // Emergency squawk meaning label (Pro mode) - slow fade (always shown)
    if (isEmergency && isPro) {
      const squawkMeanings = {
        7500: 'HIJACK',
        7600: 'RADIO FAIL',
        7700: 'EMERGENCY',
      };
      const meaning = squawkMeanings[ac.squawk] || 'EMERGENCY';

      // Slow fade effect (cycle over ~3 seconds at 60fps)
      const fadeAlpha = 0.5 + Math.sin(frameCount * 0.035) * 0.5;

      ctx.save();
      ctx.font = 'bold 14px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';

      // Draw background box for visibility
      const labelText = `\u26A0 ${meaning}`;
      const textWidth = ctx.measureText(labelText).width;
      ctx.fillStyle = `rgba(120, 0, 0, 0.85)`;
      ctx.fillRect(blockX - 3, blockY + 30, textWidth + 8, 20);

      // Draw border
      ctx.strokeStyle = `rgba(255, 60, 60, 0.9)`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(blockX - 3, blockY + 30, textWidth + 8, 20);

      // Draw white text with slow fade
      ctx.fillStyle = `rgba(255, 255, 255, ${fadeAlpha})`;
      ctx.fillText(labelText, blockX + 1, blockY + 34);
      ctx.restore();
    }

    // Safety event / Proximity conflict warning label (Pro mode)
    if (hasSafetyAlert && isPro && !isEmergency) {
      const fadeAlpha = 0.5 + Math.sin(frameCount * 0.05) * 0.5;
      const sevColors = getSeverityColors(alertSeverity, proximityFlashOn);

      // Get event type name for label
      const eventNames = {
        tcas_ra: 'TCAS RA',
        extreme_vs: 'EXTREME V/S',
        vs_reversal: 'V/S REVERSAL',
        proximity_conflict: 'PROXIMITY',
        rapid_descent: 'RAPID DESCENT',
        rapid_climb: 'RAPID CLIMB',
      };
      const alertLabel = safetyEvent
        ? eventNames[safetyEvent.event_type] ||
          safetyEvent.event_type?.replace(/_/g, ' ').toUpperCase() ||
          'ALERT'
        : 'PROXIMITY';

      ctx.save();
      ctx.font = 'bold 14px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';

      const labelText = `\u26A0 ${alertLabel}`;
      const textWidth = ctx.measureText(labelText).width;

      // Background color based on severity
      const bgColor =
        alertSeverity === 'critical'
          ? 'rgba(100, 30, 60, 0.85)'
          : alertSeverity === 'warning'
            ? 'rgba(100, 60, 0, 0.85)'
            : 'rgba(100, 80, 0, 0.85)';
      ctx.fillStyle = bgColor;
      ctx.fillRect(blockX - 3, blockY + 30, textWidth + 8, 20);

      // Border color based on severity
      ctx.strokeStyle = sevColors.ring;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(blockX - 3, blockY + 30, textWidth + 8, 20);

      // White text with fade
      ctx.fillStyle = `rgba(255, 255, 255, ${fadeAlpha})`;
      ctx.fillText(labelText, blockX + 1, blockY + 34);
      ctx.restore();
    }
  });

  // Phase 14.3: After drawing all data blocks, run auto-deconfliction
  if (autoDeconflictEnabled && dataBlockRects.length > 0) {
    maybeDeconflict(dataBlockRects);
  }
}
