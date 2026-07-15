/**
 * Grid, range ring, compass, and center marker drawing utilities.
 *
 * Each function receives:
 *   ctx  - Canvas 2D rendering context
 *   geo  - {
 *            width, height, centerX, centerY, maxRadius,
 *            isPro, radarRange, feederLat, feederLon,
 *            proPanOffset, themeColors, gridOpacity,
 *            showCompassRose, latLonToScreen
 *          }
 */

// ---------------------------------------------------------------------------
// 1. clearCanvas  (MapView lines ~3797-3842)
// ---------------------------------------------------------------------------

/**
 * Clear the canvas and fill with the appropriate background colour.
 * In CRT mode a subtle noise texture is also applied.
 */
export function clearCanvas(ctx, geo) {
  const { width, height, isPro, themeColors } = geo;

  ctx.fillStyle = isPro ? themeColors.bg() : '#0a0f0a';
  ctx.fillRect(0, 0, width, height);

  if (!isPro) {
    // Add subtle noise/texture (CRT only)
    ctx.fillStyle = 'rgba(0, 40, 0, 0.03)';
    for (let i = 0; i < 50; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      ctx.fillRect(x, y, 2, 2);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. drawProGrid  (MapView lines ~3844-4006)
// ---------------------------------------------------------------------------

/**
 * Pro mode: lat/lon grid lines, scale bar, dashed range rings, and
 * optional compass rose.
 */
export function drawProGrid(ctx, geo) {
  const {
    width,
    height,
    centerX,
    centerY,
    radarRange,
    feederLat,
    feederLon,
    themeColors,
    gridOpacity,
    showCompassRose,
    latLonToScreen,
  } = geo;

  // --- Lat/lon grid with adjustable opacity (theme-aware) -----------------
  const gridAlpha = gridOpacity;
  const gridColor = themeColors.rgba('grid', gridAlpha);
  const gridLabelColor = themeColors.rgba('gridLabel', Math.min(0.7, gridAlpha * 2.3));
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  ctx.font = '12px "JetBrains Mono", monospace';
  ctx.fillStyle = gridLabelColor;

  // Calculate grid spacing based on range
  const degPerNm = 1 / 60;
  const gridSpacingDeg =
    radarRange <= 30 ? 0.25 : radarRange <= 75 ? 0.5 : radarRange <= 150 ? 1 : 2;

  // Latitude lines (horizontal)
  const minGridLat =
    Math.floor((feederLat - radarRange * degPerNm) / gridSpacingDeg) * gridSpacingDeg;
  const maxGridLat =
    Math.ceil((feederLat + radarRange * degPerNm) / gridSpacingDeg) * gridSpacingDeg;

  for (let lat = minGridLat; lat <= maxGridLat; lat += gridSpacingDeg) {
    const p1 = latLonToScreen(lat, feederLon - radarRange * degPerNm * 1.5);
    // eslint-disable-next-line no-unused-vars
    const _p2 = latLonToScreen(lat, feederLon + radarRange * degPerNm * 1.5);
    if (p1.y > 0 && p1.y < height) {
      ctx.beginPath();
      ctx.moveTo(0, p1.y);
      ctx.lineTo(width, p1.y);
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.fillText(`${lat.toFixed(2)}\u00b0`, 8, p1.y - 5);
    }
  }

  // Longitude lines (vertical)
  const lonScale = Math.cos((feederLat * Math.PI) / 180);
  const minGridLon =
    Math.floor((feederLon - (radarRange * degPerNm) / lonScale) / gridSpacingDeg) *
    gridSpacingDeg;
  const maxGridLon =
    Math.ceil((feederLon + (radarRange * degPerNm) / lonScale) / gridSpacingDeg) *
    gridSpacingDeg;

  for (let lon = minGridLon; lon <= maxGridLon; lon += gridSpacingDeg) {
    const p1 = latLonToScreen(feederLat, lon);
    if (p1.x > 0 && p1.x < width) {
      ctx.beginPath();
      ctx.moveTo(p1.x, 0);
      ctx.lineTo(p1.x, height);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.abs(lon).toFixed(2)}\u00b0${lon < 0 ? 'W' : 'E'}`, p1.x, height - 8);
    }
  }

  // --- Scale bar (theme-aware) --------------------------------------------
  const scaleBarNm =
    radarRange <= 30 ? 10 : radarRange <= 75 ? 25 : radarRange <= 150 ? 50 : 100;
  const scaleBarPx = (scaleBarNm / radarRange) * (Math.min(width, height) * 0.45);
  const scaleBarY = height - 20;

  // Draw text clearly above the line
  ctx.fillStyle = themeColors.rgba('primary', 0.8);
  ctx.textAlign = 'center';
  ctx.font = '11px "JetBrains Mono", monospace';
  ctx.fillText(`${scaleBarNm} nm`, width - 20 - scaleBarPx / 2, scaleBarY - 10);

  // Draw the scale bar line below text
  ctx.strokeStyle = themeColors.rgba('primary', 0.6);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(width - 20 - scaleBarPx, scaleBarY);
  ctx.lineTo(width - 20, scaleBarY);
  // End caps (shorter)
  ctx.moveTo(width - 20 - scaleBarPx, scaleBarY - 3);
  ctx.lineTo(width - 20 - scaleBarPx, scaleBarY + 3);
  ctx.moveTo(width - 20, scaleBarY - 3);
  ctx.lineTo(width - 20, scaleBarY + 3);
  ctx.stroke();

  // --- Range rings (subtle, dashed) ---------------------------------------
  const proRingDistances =
    radarRange <= 30
      ? [10, 20, 30]
      : radarRange <= 75
        ? [25, 50, 75]
        : radarRange <= 150
          ? [50, 100, 150]
          : [100, 200, 300];

  const proPixelsPerNm = (Math.min(width, height) * 0.45) / radarRange;
  ctx.strokeStyle = themeColors.rgba('rangeRing', 0.4);
  ctx.lineWidth = 1;
  ctx.setLineDash([8, 8]);

  proRingDistances.forEach((dist) => {
    if (dist > radarRange * 1.2) return;
    const radius = dist * proPixelsPerNm;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Range label (top of ring)
    ctx.fillStyle = themeColors.rgba('rangeLabel', 0.6);
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${dist}nm`, centerX, centerY - radius - 4);
  });
  ctx.setLineDash([]);

  // --- Compass rose (optional) --------------------------------------------
  if (showCompassRose) {
    const compassRadius = Math.min(width, height) * 0.43;
    const compassPoints = [
      { angle: 0, label: 'N', major: true },
      { angle: 45, label: 'NE', major: false },
      { angle: 90, label: 'E', major: true },
      { angle: 135, label: 'SE', major: false },
      { angle: 180, label: 'S', major: true },
      { angle: 225, label: 'SW', major: false },
      { angle: 270, label: 'W', major: true },
      { angle: 315, label: 'NW', major: false },
    ];

    // Draw 10-degree tick marks
    ctx.strokeStyle = themeColors.rgba('compass', 0.3);
    ctx.lineWidth = 1;
    for (let angle = 0; angle < 360; angle += 10) {
      const rad = ((angle - 90) * Math.PI) / 180;
      const isMajor = angle % 90 === 0;
      const isIntermediate = angle % 30 === 0;
      const tickLength = isMajor ? 15 : isIntermediate ? 10 : 5;
      ctx.beginPath();
      ctx.moveTo(
        centerX + Math.cos(rad) * (compassRadius - tickLength),
        centerY + Math.sin(rad) * (compassRadius - tickLength)
      );
      ctx.lineTo(
        centerX + Math.cos(rad) * compassRadius,
        centerY + Math.sin(rad) * compassRadius
      );
      ctx.stroke();
    }

    // Draw cardinal and intercardinal labels
    compassPoints.forEach(({ angle, label, major }) => {
      const rad = ((angle - 90) * Math.PI) / 180;
      ctx.fillStyle = major
        ? themeColors.rgba('compassMajor', 0.9)
        : themeColors.rgba('compass', 0.7);
      ctx.font = major
        ? 'bold 14px "JetBrains Mono", monospace'
        : '11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const labelRadius = compassRadius + 15;
      ctx.fillText(
        label,
        centerX + Math.cos(rad) * labelRadius,
        centerY + Math.sin(rad) * labelRadius
      );
    });
  }
}

// ---------------------------------------------------------------------------
// 3. drawCrtRings  (MapView lines ~4007-4074)
// ---------------------------------------------------------------------------

/**
 * CRT mode: solid range rings, cardinal/intercardinal compass lines and
 * labels, plus 30-degree spoke lines.
 */
export function drawCrtRings(ctx, geo) {
  const { width, height, centerX, centerY, maxRadius, radarRange } = geo;

  // --- Range rings --------------------------------------------------------
  const ringDistances =
    radarRange <= 50
      ? [10, 20, 30, 40, 50]
      : radarRange <= 100
        ? [25, 50, 75, 100]
        : [50, 100, 150];

  ctx.strokeStyle = 'rgba(0, 180, 80, 0.4)';
  ctx.lineWidth = 1;

  ringDistances.forEach((dist) => {
    if (dist > radarRange) return;
    const radius = (dist / radarRange) * maxRadius;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Range label
    ctx.fillStyle = 'rgba(0, 180, 80, 0.7)';
    ctx.font = '13px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${dist}`, centerX, centerY - radius - 6);
  });

  // --- Compass lines and labels -------------------------------------------
  const compassPoints = [
    { angle: 0, label: 'N' },
    { angle: 90, label: 'E' },
    { angle: 180, label: 'S' },
    { angle: 270, label: 'W' },
  ];

  ctx.strokeStyle = 'rgba(0, 180, 80, 0.25)';
  ctx.lineWidth = 1;

  compassPoints.forEach(({ angle, label }) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + Math.cos(rad) * maxRadius, centerY + Math.sin(rad) * maxRadius);
    ctx.stroke();

    // Label
    ctx.fillStyle = 'rgba(0, 200, 100, 0.8)';
    ctx.font = 'bold 18px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labelRadius = maxRadius + 22;
    ctx.fillText(
      label,
      centerX + Math.cos(rad) * labelRadius,
      centerY + Math.sin(rad) * labelRadius
    );
  });

  // --- 30-degree spoke lines ----------------------------------------------
  ctx.strokeStyle = 'rgba(0, 180, 80, 0.15)';
  for (let angle = 30; angle < 360; angle += 30) {
    if (angle % 90 === 0) continue;
    const rad = ((angle - 90) * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(centerX + Math.cos(rad) * 20, centerY + Math.sin(rad) * 20);
    ctx.lineTo(centerX + Math.cos(rad) * maxRadius, centerY + Math.sin(rad) * maxRadius);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// 4. drawCenterMarker  (MapView lines ~4076-4089)
// ---------------------------------------------------------------------------

/**
 * Draw the feeder location crosshair at the center of the canvas.
 */
export function drawCenterMarker(ctx, geo) {
  const { centerX, centerY, isPro } = geo;

  ctx.fillStyle = isPro ? 'rgba(100, 200, 255, 0.9)' : 'rgba(0, 255, 100, 0.8)';
  ctx.beginPath();
  ctx.arc(centerX, centerY, isPro ? 5 : 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = isPro ? 'rgba(100, 200, 255, 0.5)' : 'rgba(0, 255, 100, 0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(centerX - 10, centerY);
  ctx.lineTo(centerX + 10, centerY);
  ctx.moveTo(centerX, centerY - 10);
  ctx.lineTo(centerX, centerY + 10);
  ctx.stroke();
}
