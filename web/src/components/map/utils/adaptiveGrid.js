/**
 * Adaptive Grid Spacing for Pro Mode (Phase 4.1)
 *
 * Grid lines adapt to the current zoom/range level:
 * | Range | Minor Lines | Major Lines |
 * |-------|-------------|-------------|
 * | 10nm  | 2nm         | 5nm         |
 * | 25nm  | 5nm         | 10nm        |
 * | 50nm  | 10nm        | 25nm        |
 * | 100nm | 25nm        | 50nm        |
 * | 250nm | 50nm        | 100nm       |
 *
 * Visual Style:
 * - Minor lines: Very subtle, rgba(0, 255, 255, 0.1) equivalent
 * - Major lines: More visible, rgba(0, 255, 255, 0.25) equivalent
 * - Labels: Distance from center at major lines
 */

/**
 * Get adaptive grid spacing based on current radar range
 * @param {number} radarRange - Current radar range in nautical miles
 * @returns {{ minorSpacing: number, majorSpacing: number }} Grid spacing values
 */
export function getAdaptiveGridSpacing(radarRange) {
  if (radarRange <= 10) {
    return { minorSpacing: 2, majorSpacing: 5 };
  } else if (radarRange <= 25) {
    return { minorSpacing: 5, majorSpacing: 10 };
  } else if (radarRange <= 50) {
    return { minorSpacing: 10, majorSpacing: 25 };
  } else if (radarRange <= 100) {
    return { minorSpacing: 25, majorSpacing: 50 };
  } else {
    return { minorSpacing: 50, majorSpacing: 100 };
  }
}

/**
 * Draw adaptive grid on canvas for Pro mode
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D context
 * @param {Object} params - Drawing parameters
 * @param {number} params.width - Canvas width
 * @param {number} params.height - Canvas height
 * @param {number} params.centerX - Center X coordinate
 * @param {number} params.centerY - Center Y coordinate
 * @param {number} params.radarRange - Current radar range in nm
 * @param {number} params.gridAlpha - Grid opacity (0-1)
 * @param {Object} params.proPanOffset - Pan offset { x, y }
 * @param {Object} params.themeColors - Theme color helper object with rgba() method
 */
export function drawAdaptiveGrid(ctx, params) {
  const { width, height, centerX, centerY, radarRange, gridAlpha, proPanOffset, themeColors } =
    params;

  if (gridAlpha <= 0) return;

  const pxPerNm = (Math.min(width, height) * 0.45) / radarRange;
  const { minorSpacing, majorSpacing } = getAdaptiveGridSpacing(radarRange);
  const maxDist = radarRange * 1.3;

  // Grid center follows pan offset
  const gcX = centerX + proPanOffset.x;
  const gcY = centerY + proPanOffset.y;

  // Alpha values for minor/major lines
  const minorAlpha = gridAlpha * 0.33; // ~0.1 at default 0.3 opacity
  const majorAlpha = gridAlpha * 0.83; // ~0.25 at default 0.3 opacity

  // Draw minor grid rings (very subtle)
  ctx.strokeStyle = themeColors.rgba('grid', minorAlpha);
  ctx.lineWidth = 0.5;
  ctx.setLineDash([]);

  for (let dist = minorSpacing; dist <= maxDist; dist += minorSpacing) {
    if (dist % majorSpacing === 0) continue; // Skip major lines
    const radius = dist * pxPerNm;
    ctx.beginPath();
    ctx.arc(gcX, gcY, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Draw major grid rings with distance labels
  ctx.strokeStyle = themeColors.rgba('grid', majorAlpha);
  ctx.lineWidth = 1;

  for (let dist = majorSpacing; dist <= maxDist; dist += majorSpacing) {
    const radius = dist * pxPerNm;
    ctx.beginPath();
    ctx.arc(gcX, gcY, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Distance labels at major lines
    ctx.fillStyle = themeColors.rgba('gridLabel', Math.min(0.7, gridAlpha * 2));
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';

    // Top label (only if visible in viewport)
    const topY = gcY - radius - 4;
    if (topY > 15 && topY < height - 15) {
      ctx.fillText(`${dist}nm`, gcX, topY);
    }

    // Right label (only if visible in viewport)
    const rightX = gcX + radius + 4;
    if (rightX > 30 && rightX < width - 30) {
      ctx.textAlign = 'left';
      ctx.fillText(`${dist}`, rightX, gcY + 4);
    }
  }

  // Draw radial bearing lines
  const maxRadialRadius = maxDist * pxPerNm;

  // Minor bearing lines (every 10 degrees, very subtle)
  ctx.strokeStyle = themeColors.rgba('grid', minorAlpha * 0.5);
  ctx.lineWidth = 0.5;
  for (let angle = 0; angle < 360; angle += 10) {
    if (angle % 30 === 0) continue; // Skip major lines
    const rad = ((angle - 90) * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(gcX, gcY);
    ctx.lineTo(gcX + Math.cos(rad) * maxRadialRadius, gcY + Math.sin(rad) * maxRadialRadius);
    ctx.stroke();
  }

  // Major bearing lines (every 30 degrees)
  ctx.strokeStyle = themeColors.rgba('grid', majorAlpha * 0.6);
  ctx.lineWidth = 1;
  for (let angle = 0; angle < 360; angle += 30) {
    const rad = ((angle - 90) * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(gcX, gcY);
    ctx.lineTo(gcX + Math.cos(rad) * maxRadialRadius, gcY + Math.sin(rad) * maxRadialRadius);
    ctx.stroke();
  }
}

/**
 * Get scale bar distance based on current radar range (adapts to new spacing)
 * @param {number} radarRange - Current radar range in nm
 * @returns {number} Scale bar distance in nm
 */
export function getAdaptiveScaleBarDistance(radarRange) {
  if (radarRange <= 10) return 5;
  if (radarRange <= 25) return 10;
  if (radarRange <= 50) return 25;
  if (radarRange <= 100) return 50;
  return 100;
}
