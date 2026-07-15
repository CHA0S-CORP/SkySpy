/**
 * Drawing functions for measurement tool, cursor info, FPS counter,
 * and keyboard hint overlays on the pro/CRT radar canvas.
 *
 * Extracted from MapView.jsx (lines ~6733-6852).
 */

/**
 * Draw measurement tool A/B points with distance/bearing line.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geo - { width, height, centerX, centerY, isPro, radarRange, feederLat, feederLon, proPanOffset, themeColors }
 * @param {object} data - { measurementPoints }
 */
export function drawMeasurementTool(ctx, geo, { measurementPoints }) {
  if (!measurementPoints || measurementPoints.length === 0) return;

  const { width, height, centerX, centerY, radarRange, feederLat, feederLon, proPanOffset } = geo;
  const proPixelsPerNm = (Math.min(width, height) * 0.45) / radarRange;

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 200, 0, 0.9)';
  ctx.fillStyle = 'rgba(255, 200, 0, 0.9)';
  ctx.lineWidth = 2;

  // Draw point A marker
  const ptA = measurementPoints[0];
  const aX =
    centerX +
    (ptA.lon - feederLon) * 60 * Math.cos((feederLat * Math.PI) / 180) * proPixelsPerNm +
    proPanOffset.x;
  const aY = centerY - (ptA.lat - feederLat) * 60 * proPixelsPerNm + proPanOffset.y;
  ctx.beginPath();
  ctx.arc(aX, aY, 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = 'bold 12px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText('A', aX + 10, aY + 4);

  // Draw line and point B if we have two points
  if (measurementPoints.length === 2) {
    const ptB = measurementPoints[1];
    const bX =
      centerX +
      (ptB.lon - feederLon) * 60 * Math.cos((feederLat * Math.PI) / 180) * proPixelsPerNm +
      proPanOffset.x;
    const bY = centerY - (ptB.lat - feederLat) * 60 * proPixelsPerNm + proPanOffset.y;

    // Draw line between points
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(aX, aY);
    ctx.lineTo(bX, bY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw point B marker
    ctx.beginPath();
    ctx.arc(bX, bY, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillText('B', bX + 10, bY + 4);

    // Calculate and display distance/bearing
    const dLat = ptB.lat - ptA.lat;
    const dLon = ptB.lon - ptA.lon;
    const nmY = dLat * 60;
    const nmX = dLon * 60 * Math.cos((((ptA.lat + ptB.lat) / 2) * Math.PI) / 180);
    const distance = Math.sqrt(nmX * nmX + nmY * nmY);
    const bearing = ((Math.atan2(nmX, nmY) * 180) / Math.PI + 360) % 360;

    // Draw label at midpoint
    const midX = (aX + bX) / 2;
    const midY = (aY + bY) / 2;
    const labelText = `${distance.toFixed(1)} nm / ${bearing.toFixed(0)}\u00B0`;
    const labelWidth = ctx.measureText(labelText).width + 10;
    ctx.fillStyle = 'rgba(20, 30, 40, 0.9)';
    ctx.fillRect(midX - labelWidth / 2, midY - 20, labelWidth, 18);
    ctx.fillStyle = 'rgba(255, 200, 0, 0.9)';
    ctx.textAlign = 'center';
    ctx.fillText(labelText, midX, midY - 7);
  }
  ctx.restore();
}

/**
 * Draw cursor position readout at bottom-left corner.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geo - { width, height, centerX, centerY, isPro, radarRange, feederLat, feederLon, proPanOffset, themeColors }
 * @param {object} data - { cursorInfo }
 */
export function drawCursorInfo(ctx, geo, { cursorInfo }) {
  if (!cursorInfo) return;

  const { height } = geo;

  ctx.save();
  ctx.fillStyle = 'rgba(15, 25, 35, 0.9)';
  ctx.fillRect(10, height - 70, 180, 60);
  ctx.strokeStyle = 'rgba(80, 140, 200, 0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(10, height - 70, 180, 60);

  ctx.font = '11px "JetBrains Mono", monospace';
  ctx.fillStyle = 'rgba(100, 180, 255, 0.9)';
  ctx.textAlign = 'left';

  const latStr = `${Math.abs(cursorInfo.lat).toFixed(4)}\u00B0${cursorInfo.lat >= 0 ? 'N' : 'S'}`;
  const lonStr = `${Math.abs(cursorInfo.lon).toFixed(4)}\u00B0${cursorInfo.lon >= 0 ? 'E' : 'W'}`;
  ctx.fillText(`LAT: ${latStr}`, 18, height - 52);
  ctx.fillText(`LON: ${lonStr}`, 18, height - 38);
  ctx.fillStyle = 'rgba(150, 220, 255, 0.9)';
  ctx.fillText(`DST: ${cursorInfo.distance.toFixed(1)} nm`, 18, height - 24);
  ctx.fillText(`BRG: ${cursorInfo.bearing.toFixed(0)}\u00B0`, 110, height - 24);
  ctx.restore();
}

/**
 * Draw FPS counter display (debug mode) at top-right corner.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geo - { width, height, centerX, centerY, isPro, radarRange, feederLat, feederLon, proPanOffset, themeColors }
 * @param {object} data - { showFpsCounter, fpsRef }
 */
export function drawFpsCounter(ctx, geo, { showFpsCounter, fpsRef }) {
  if (!showFpsCounter) return;

  const { width } = geo;

  const now = Date.now();
  fpsRef.current.frames++;
  if (now - fpsRef.current.lastTime >= 1000) {
    fpsRef.current.fps = fpsRef.current.frames;
    fpsRef.current.frames = 0;
    fpsRef.current.lastTime = now;
  }
  ctx.save();
  ctx.fillStyle = 'rgba(15, 25, 35, 0.8)';
  ctx.fillRect(width - 70, 10, 60, 22);
  ctx.font = '12px "JetBrains Mono", monospace';
  ctx.fillStyle =
    fpsRef.current.fps >= 30 ? 'rgba(0, 255, 100, 0.9)' : 'rgba(255, 150, 0, 0.9)';
  ctx.textAlign = 'right';
  ctx.fillText(`${fpsRef.current.fps} FPS`, width - 15, 26);
  ctx.restore();
}

/**
 * Draw "Press ? for shortcuts" hint text at bottom-right corner.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} geo - { width, height, centerX, centerY, isPro, radarRange, feederLat, feederLon, proPanOffset, themeColors }
 */
export function drawKeyboardHint(ctx, geo) {
  const { width, height } = geo;

  ctx.save();
  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.fillStyle = 'rgba(80, 120, 160, 0.5)';
  ctx.textAlign = 'right';
  ctx.fillText('Press ? for shortcuts', width - 15, height - 10);
  ctx.restore();
}
