/**
 * Heat Map Renderer Utilities
 *
 * Provides functions for rendering traffic density heat maps on canvas.
 * Used for antenna optimization and coverage analysis.
 */

/**
 * Heat Map color gradient function
 * Returns RGBA color string based on intensity (0-1)
 * Gradient: transparent -> blue -> cyan -> green -> yellow -> orange -> red
 *
 * @param {number} intensity - Value between 0 and 1
 * @returns {string} RGBA color string
 */
export function getHeatMapColor(intensity) {
  if (intensity <= 0) return 'rgba(0, 0, 255, 0)';

  if (intensity < 0.17) {
    // Transparent to Blue
    const alpha = intensity * 6;
    return `rgba(0, 50, 255, ${alpha * 0.5})`;
  }

  if (intensity < 0.33) {
    // Blue to Cyan
    const t = (intensity - 0.17) * 6;
    const g = Math.round(50 + t * 205);
    return `rgba(0, ${g}, 255, 0.55)`;
  }

  if (intensity < 0.5) {
    // Cyan to Green
    const t = (intensity - 0.33) * 6;
    const b = Math.round(255 - t * 255);
    return `rgba(0, 255, ${b}, 0.6)`;
  }

  if (intensity < 0.67) {
    // Green to Yellow
    const t = (intensity - 0.5) * 6;
    const r = Math.round(t * 255);
    return `rgba(${r}, 255, 0, 0.65)`;
  }

  if (intensity < 0.83) {
    // Yellow to Orange
    const t = (intensity - 0.67) * 6;
    const g = Math.round(255 - t * 100);
    return `rgba(255, ${g}, 0, 0.7)`;
  }

  // Orange to Red
  const t = (intensity - 0.83) * 6;
  const g = Math.round(155 - t * 155);
  return `rgba(255, ${g}, 0, 0.75)`;
}

/**
 * Draw heat map on canvas with color gradient
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number[][]} heatMapData - 2D grid of counts
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @param {Object} options - Drawing options
 * @param {number} options.opacity - Overall opacity (0-1), default 0.6
 * @param {boolean} options.blur - Apply Gaussian blur, default true
 * @param {number} options.minOpacity - Minimum opacity for cells, default 0.1
 * @param {number} options.blurRadius - Blur radius in pixels, default 4
 */
export function drawHeatMap(ctx, heatMapData, width, height, options = {}) {
  if (!heatMapData || !heatMapData.length) return;

  const gridSize = heatMapData.length;
  const cellWidth = width / gridSize;
  const cellHeight = height / gridSize;
  const maxValue = Math.max(...heatMapData.flat()) || 1;

  const { opacity = 0.6, blur = true, minOpacity = 0.1, blurRadius = 4 } = options;

  ctx.save();

  // Apply Gaussian blur for smooth appearance
  if (blur) {
    ctx.filter = `blur(${blurRadius}px)`;
  }

  heatMapData.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value === 0) return;

      const intensity = value / maxValue;
      const color = getHeatMapColor(intensity);

      ctx.fillStyle = color;
      ctx.globalAlpha = Math.max(minOpacity, Math.min(opacity, intensity + minOpacity));

      // Draw slightly larger cells with overlap for smoother look
      const overlap = blur ? 2 : 0;
      ctx.fillRect(
        x * cellWidth - overlap,
        y * cellHeight - overlap,
        cellWidth + overlap * 2,
        cellHeight + overlap * 2
      );
    });
  });

  ctx.restore();
}

/**
 * Render heat map to an offscreen canvas and return it
 * Useful for double-buffering or compositing
 *
 * @param {number[][]} heatMapData - 2D grid of counts
 * @param {Object} options - Drawing options
 * @returns {HTMLCanvasElement} Offscreen canvas with rendered heat map
 */
export function renderHeatMapToCanvas(heatMapData, options = {}) {
  if (!heatMapData || !heatMapData.length) return null;

  const gridWidth = heatMapData[0]?.length || heatMapData.length;
  const gridHeight = heatMapData.length;

  const canvas = document.createElement('canvas');
  canvas.width = gridWidth;
  canvas.height = gridHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  drawHeatMap(ctx, heatMapData, gridWidth, gridHeight, {
    ...options,
    blur: false, // No blur at native resolution
  });

  return canvas;
}

/**
 * Draw color legend for heat map
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} width - Legend width
 * @param {number} height - Legend height
 * @param {Object} options - Drawing options
 */
export function drawHeatMapLegend(ctx, x, y, width, height, options = {}) {
  const { showLabels = true, labelColor = 'rgba(255, 255, 255, 0.8)' } = options;

  ctx.save();

  // Draw gradient bar
  const gradient = ctx.createLinearGradient(x, y, x + width, y);
  gradient.addColorStop(0, 'rgba(0, 50, 255, 0.3)');
  gradient.addColorStop(0.2, 'rgba(0, 255, 255, 0.55)');
  gradient.addColorStop(0.4, 'rgba(0, 255, 0, 0.6)');
  gradient.addColorStop(0.6, 'rgba(255, 255, 0, 0.65)');
  gradient.addColorStop(0.8, 'rgba(255, 155, 0, 0.7)');
  gradient.addColorStop(1, 'rgba(255, 0, 0, 0.75)');

  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, width, height);

  // Draw border
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, height);

  // Draw labels
  if (showLabels) {
    ctx.fillStyle = labelColor;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Low', x, y + height + 12);
    ctx.textAlign = 'right';
    ctx.fillText('High', x + width, y + height + 12);
  }

  ctx.restore();
}

/**
 * Heat map intensity presets for different use cases
 */
export const INTENSITY_PRESETS = {
  default: { opacity: 0.6, minOpacity: 0.1, blurRadius: 4 },
  high: { opacity: 0.8, minOpacity: 0.15, blurRadius: 6 },
  low: { opacity: 0.4, minOpacity: 0.05, blurRadius: 3 },
  sharp: { opacity: 0.7, minOpacity: 0.1, blurRadius: 2 },
  smooth: { opacity: 0.5, minOpacity: 0.08, blurRadius: 8 },
};

export default {
  getHeatMapColor,
  drawHeatMap,
  renderHeatMapToCanvas,
  drawHeatMapLegend,
  INTENSITY_PRESETS,
};
