/**
 * Conflict visualization drawing functions extracted from MapView.jsx
 *
 * Each function takes (ctx, geo, data) where:
 *   ctx  = Canvas 2D rendering context
 *   geo  = { width, height, centerX, centerY, isPro, radarRange, maxRadius, themeColors, latLonToScreen, frameCount }
 *   data = function-specific data parameters
 */

/**
 * Build a Set of ICAO hex codes involved in active conflicts.
 * No longer doing local proximity calculations - backend handles this.
 *
 * @param {Array} activeConflicts - Array of conflict/safety events from backend
 * @returns {Set<string>} Set of uppercase ICAO hex codes
 */
export function buildConflictAircraftSet(activeConflicts) {
  const conflictAircraft = new Set();
  activeConflicts.forEach((event) => {
    if (event.icao) conflictAircraft.add(event.icao.toUpperCase());
    if (event.icao_2) conflictAircraft.add(event.icao_2.toUpperCase());
  });
  return conflictAircraft;
}

/**
 * Draw CPA (Closest Point of Approach) lines and relative altitude labels
 * between conflicting aircraft pairs. Includes pulsing dashed lines,
 * altitude difference labels, CPA X markers, and time-to-CPA annotations.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geo
 * @param {object} data
 * @param {boolean} data.showConflictVisualization - Whether conflict viz is enabled
 * @param {Array} data.activeConflicts - Active conflict events from backend
 * @param {Array} data.sortedAircraft - All aircraft currently displayed
 * @param {Function} data.calculateCPA - CPA calculation utility function
 * @param {Function} data.formatTimeToCPA - Time formatting utility function
 */
export function drawConflictCPALines(ctx, geo, data) {
  const { width, height, isPro, latLonToScreen, frameCount } = geo;
  const {
    showConflictVisualization,
    activeConflicts,
    sortedAircraft,
    calculateCPA,
    formatTimeToCPA,
  } = data;

  if (!showConflictVisualization || !isPro || !activeConflicts.length) return;

  ctx.save();
  const drawnPairs = new Set(); // Avoid drawing same pair twice

  activeConflicts.forEach((event) => {
    // Skip non-proximity events (single aircraft events)
    if (!event.icao || !event.icao_2) return;

    const pairKey = [event.icao, event.icao_2].sort().join('-');
    if (drawnPairs.has(pairKey)) return;
    drawnPairs.add(pairKey);

    // Find both aircraft
    const ac1 = sortedAircraft.find((ac) => ac.hex?.toUpperCase() === event.icao?.toUpperCase());
    const ac2 = sortedAircraft.find((ac) => ac.hex?.toUpperCase() === event.icao_2?.toUpperCase());

    if (!ac1 || !ac2 || !ac1.lat || !ac2.lat) return;

    const pos1 = latLonToScreen(ac1.lat, ac1.lon);
    const pos2 = latLonToScreen(ac2.lat, ac2.lon);

    // Skip if either is off-screen
    if (pos1.x < 0 || pos1.x > width || pos1.y < 0 || pos1.y > height) return;
    if (pos2.x < 0 || pos2.x > width || pos2.y < 0 || pos2.y > height) return;

    // Determine severity-based color
    const severity = event.severity || 'warning';
    const lineColor =
      severity === 'critical'
        ? 'rgba(255, 80, 150, 0.8)'
        : severity === 'warning'
          ? 'rgba(255, 140, 0, 0.8)'
          : 'rgba(255, 220, 0, 0.8)';

    // Draw connecting line between aircraft (pulsing effect)
    const pulseAlpha = 0.4 + Math.sin(frameCount * 0.1) * 0.3;
    ctx.strokeStyle = lineColor.replace(/[\d.]+\)$/, `${pulseAlpha})`);
    ctx.lineWidth = severity === 'critical' ? 3 : 2;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(pos1.x, pos1.y);
    ctx.lineTo(pos2.x, pos2.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Calculate midpoint for label
    const midX = (pos1.x + pos2.x) / 2;
    const midY = (pos1.y + pos2.y) / 2;

    // Calculate relative altitude
    const alt1 = ac1.alt || 0;
    const alt2 = ac2.alt || 0;
    const altDiff = Math.abs(alt1 - alt2);
    const isCriticalAlt = altDiff < 1000;

    // Draw relative altitude label
    const relAltText = alt1 > alt2 ? `△${Math.round(altDiff)}ft` : `▽${Math.round(altDiff)}ft`;

    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    const labelWidth = ctx.measureText(relAltText).width + 10;

    // Background
    ctx.fillStyle = isCriticalAlt ? 'rgba(150, 40, 60, 0.9)' : 'rgba(100, 60, 20, 0.9)';
    ctx.fillRect(midX - labelWidth / 2, midY - 10, labelWidth, 18);

    // Border
    ctx.strokeStyle = isCriticalAlt ? 'rgba(255, 80, 100, 0.9)' : 'rgba(255, 180, 100, 0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(midX - labelWidth / 2, midY - 10, labelWidth, 18);

    // Text
    ctx.fillStyle = isCriticalAlt ? 'rgba(255, 200, 200, 1)' : 'rgba(255, 230, 180, 1)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(relAltText, midX, midY);

    // Phase 3.1: CPA X marker and time-to-CPA label
    if (ac1.lat && ac1.lon && ac2.lat && ac2.lon) {
      const cpaData = calculateCPA(ac1, ac2);

      // Draw CPA X marker at midpoint
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(midX - 5, midY - 5);
      ctx.lineTo(midX + 5, midY + 5);
      ctx.moveTo(midX + 5, midY - 5);
      ctx.lineTo(midX - 5, midY + 5);
      ctx.stroke();

      // Draw time-to-CPA label below the midpoint
      if (cpaData.tCPASeconds > 0 && !cpaData.isPast) {
        const timeLabel = formatTimeToCPA(cpaData.tCPASeconds);
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(timeLabel, midX, midY + 14);

        // Draw distance at CPA below time label
        if (cpaData.distanceAtCPA != null) {
          const distLabel = `${cpaData.distanceAtCPA.toFixed(1)}nm`;
          ctx.fillText(distLabel, midX, midY + 26);
        }
      }
    }
  });

  ctx.restore();
}

/**
 * Draw conflict wedge visualization - projected path corridors for aircraft
 * involved in active conflicts. Shows heading uncertainty wedges and
 * predicted track center lines.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geo
 * @param {object} data
 * @param {boolean} data.showConflictVisualization - Whether conflict viz is enabled
 * @param {Array} data.activeConflicts - Active conflict events from backend
 * @param {Array} data.sortedAircraft - All aircraft currently displayed
 * @param {Set} data.conflictAircraft - Set of ICAO hexes in active conflicts (from buildConflictAircraftSet)
 */
export function drawConflictWedges(ctx, geo, data) {
  const { width, height, isPro, radarRange, latLonToScreen } = geo;
  const { showConflictVisualization, activeConflicts, sortedAircraft, conflictAircraft } = data;

  if (!showConflictVisualization || !isPro) return;

  ctx.save();
  const wedgeAngle = 5; // ±5 degrees heading uncertainty
  const lookaheadMinutes = 2; // 2-minute lookahead
  const wedgePixelsPerNm = (Math.min(width, height) * 0.45) / radarRange;

  // Draw wedges for aircraft in conflicts (or all aircraft if toggled)
  const wedgesToDraw =
    conflictAircraft.size > 0
      ? sortedAircraft.filter((ac) => conflictAircraft.has(ac.hex?.toUpperCase()))
      : [];

  wedgesToDraw.forEach((ac) => {
    // track === 0 (due north) is valid — only bail on missing values
    if (ac.lat == null || ac.lon == null || ac.track == null || !ac.gs) return;

    const pos = latLonToScreen(ac.lat, ac.lon);
    if (pos.x < -50 || pos.x > width + 50 || pos.y < -50 || pos.y > height + 50) return;

    // Calculate lookahead distance in nm (speed in kts * time in hours)
    const lookaheadNm = ac.gs * (lookaheadMinutes / 60);
    const lookaheadPx = lookaheadNm * wedgePixelsPerNm;

    // Heading in radians (canvas 0° is right, aircraft track 0° is north)
    const headingRad = ((ac.track - 90) * Math.PI) / 180;
    const leftRad = ((ac.track - wedgeAngle - 90) * Math.PI) / 180;
    const rightRad = ((ac.track + wedgeAngle - 90) * Math.PI) / 180;

    // Determine severity color based on whether this aircraft is in a critical conflict
    const isInCriticalConflict = activeConflicts.some(
      (e) =>
        e.severity === 'critical' &&
        (e.icao?.toUpperCase() === ac.hex?.toUpperCase() ||
          e.icao_2?.toUpperCase() === ac.hex?.toUpperCase())
    );
    const wedgeColor = isInCriticalConflict
      ? 'rgba(255, 80, 150, 0.15)'
      : 'rgba(255, 180, 0, 0.12)';
    const wedgeBorderColor = isInCriticalConflict
      ? 'rgba(255, 80, 150, 0.4)'
      : 'rgba(255, 180, 0, 0.3)';

    // Draw the wedge (triangle from aircraft position)
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.lineTo(pos.x + Math.cos(leftRad) * lookaheadPx, pos.y + Math.sin(leftRad) * lookaheadPx);
    ctx.lineTo(pos.x + Math.cos(rightRad) * lookaheadPx, pos.y + Math.sin(rightRad) * lookaheadPx);
    ctx.closePath();

    ctx.fillStyle = wedgeColor;
    ctx.fill();
    ctx.strokeStyle = wedgeBorderColor;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Draw center line (predicted track)
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.lineTo(
      pos.x + Math.cos(headingRad) * lookaheadPx,
      pos.y + Math.sin(headingRad) * lookaheadPx
    );
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = isInCriticalConflict ? 'rgba(255, 80, 150, 0.5)' : 'rgba(255, 180, 0, 0.4)';
    ctx.stroke();
    ctx.setLineDash([]);
  });

  ctx.restore();
}

/**
 * Draw J-Rings - concentric range rings (5nm, 10nm, 20nm) around the
 * selected aircraft. Toggle with 'J' key, persisted in localStorage.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geo
 * @param {object} data
 * @param {boolean} data.showJRings - Whether J-rings are enabled
 * @param {object|null} data.selectedAircraft - Currently selected aircraft object
 */
export function drawJRings(ctx, geo, data) {
  const { width, height, isPro, radarRange, maxRadius, themeColors, latLonToScreen } = geo;
  const { showJRings, selectedAircraft } = data;

  if (!showJRings || !selectedAircraft?.lat || !selectedAircraft?.lon) return;

  ctx.save();

  // Get selected aircraft screen position
  const acPos = latLonToScreen(selectedAircraft.lat, selectedAircraft.lon);

  // Skip if aircraft is too far off screen
  if (acPos.x >= -200 && acPos.x <= width + 200 && acPos.y >= -200 && acPos.y <= height + 200) {
    // J-Ring distances in nautical miles (configurable)
    const jRingDistances = [5, 10, 20];

    // Calculate pixels per nautical mile for current view
    const pixelsPerNm = isPro
      ? (Math.min(width, height) * 0.45) / radarRange
      : maxRadius / radarRange;

    // Use cyan/theme color with lower opacity
    const ringColor = isPro
      ? themeColors?.rgba('primary', 0.35) || 'rgba(0, 200, 255, 0.35)'
      : 'rgba(0, 255, 100, 0.35)';
    const labelColor = isPro
      ? themeColors?.rgba('primary', 0.6) || 'rgba(0, 200, 255, 0.6)'
      : 'rgba(0, 255, 100, 0.6)';

    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);

    jRingDistances.forEach((distNm) => {
      const radiusPx = distNm * pixelsPerNm;

      // Only draw if ring would be at least partially visible
      if (radiusPx > 10 && radiusPx < Math.max(width, height) * 2) {
        // Draw the ring
        ctx.beginPath();
        ctx.arc(acPos.x, acPos.y, radiusPx, 0, Math.PI * 2);
        ctx.stroke();

        // Draw distance label at the top of the ring
        ctx.fillStyle = labelColor;
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';

        const labelY = acPos.y - radiusPx - 3;
        // Only draw label if it's within reasonable screen bounds
        if (labelY > -20 && labelY < height + 20) {
          ctx.fillText(`${distNm}nm`, acPos.x, labelY);
        }

        // Also draw label at bottom for better visibility when panning
        const bottomLabelY = acPos.y + radiusPx + 12;
        if (bottomLabelY > 0 && bottomLabelY < height + 30 && labelY < 10) {
          ctx.textBaseline = 'top';
          ctx.fillText(`${distNm}nm`, acPos.x, acPos.y + radiusPx + 3);
        }
      }
    });

    ctx.setLineDash([]);
  }

  ctx.restore();
}
