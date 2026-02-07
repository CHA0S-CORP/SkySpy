/**
 * Wind Barbs Utility for Pro Mode
 *
 * Draws standard meteorological wind barbs on canvas:
 * - 5 kt = short barb
 * - 10 kt = long barb
 * - 50 kt = pennant (filled triangle)
 *
 * Barb points in the direction the wind is coming FROM
 * (standard meteorological convention)
 *
 * Color coded by speed:
 * - Light (< 15 kt): Green
 * - Moderate (15-34 kt): Yellow
 * - Strong (35-49 kt): Orange
 * - Very Strong (50+ kt): Red
 */

/**
 * Get color for wind speed
 * @param {number} speed - Wind speed in knots
 * @param {number} opacity - Color opacity (0-1)
 * @returns {string} RGBA color string
 */
export function getWindBarbColor(speed, opacity = 1.0) {
  if (speed < 15) {
    // Light winds: Green
    return `rgba(0, 220, 100, ${opacity})`;
  } else if (speed < 25) {
    // Light-Moderate: Yellow-green
    return `rgba(180, 220, 0, ${opacity})`;
  } else if (speed < 35) {
    // Moderate: Yellow
    return `rgba(255, 220, 0, ${opacity})`;
  } else if (speed < 50) {
    // Strong: Orange
    return `rgba(255, 140, 0, ${opacity})`;
  } else if (speed < 75) {
    // Very Strong: Red
    return `rgba(255, 60, 0, ${opacity})`;
  } else {
    // Extreme (Jet stream): Magenta
    return `rgba(255, 0, 180, ${opacity})`;
  }
}

/**
 * Calculate barb components from wind speed
 * Returns counts of pennants, long barbs, and short barbs
 * @param {number} speed - Wind speed in knots
 * @returns {{ pennants: number, longBarbs: number, shortBarb: boolean }}
 */
export function calculateBarbComponents(speed) {
  let remaining = Math.round(speed);

  // Count 50-kt pennants
  const pennants = Math.floor(remaining / 50);
  remaining -= pennants * 50;

  // Count 10-kt long barbs
  const longBarbs = Math.floor(remaining / 10);
  remaining -= longBarbs * 10;

  // Check for 5-kt short barb
  const shortBarb = remaining >= 5;

  return { pennants, longBarbs, shortBarb };
}

/**
 * Draw a single wind barb on canvas
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} x - Center X position
 * @param {number} y - Center Y position
 * @param {number} direction - Wind direction in degrees (where it's FROM)
 * @param {number} speed - Wind speed in knots
 * @param {Object} options - Drawing options
 */
export function drawWindBarb(ctx, x, y, direction, speed, options = {}) {
  const {
    size = 30, // Length of the barb staff
    barbLength = 12, // Length of individual barbs
    barbSpacing = 6, // Spacing between barbs
    lineWidth = 1.5,
    color = null, // Override color (uses speed-based if null)
    opacity = 1.0,
    showCircle = false, // Show circle at base for calm winds
  } = options;

  // Handle calm winds (< 3 kt)
  if (speed < 3) {
    if (showCircle) {
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.strokeStyle = color || getWindBarbColor(0, opacity);
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
    return;
  }

  // Calculate barb components
  const { pennants, longBarbs, shortBarb } = calculateBarbComponents(speed);

  // Convert direction to radians (wind is FROM this direction)
  // Meteorological convention: 0/360 = North, 90 = East
  // Canvas: 0 = right, need to rotate so 0 = up
  const rad = ((direction - 90) * Math.PI) / 180;

  // Calculate staff end points
  // Staff points in the direction wind is FROM
  const staffEndX = x + Math.cos(rad) * size;
  const staffEndY = y + Math.sin(rad) * size;

  // Get color based on speed
  const barbColor = color || getWindBarbColor(speed, opacity);

  ctx.save();
  ctx.strokeStyle = barbColor;
  ctx.fillStyle = barbColor;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Draw the staff
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(staffEndX, staffEndY);
  ctx.stroke();

  // Position along staff for barbs (start from end, work toward center)
  let barbPosition = 0; // Distance from staff end

  // Draw pennants (50 kt triangles)
  for (let i = 0; i < pennants; i++) {
    const pennantStart = barbPosition;
    const pennantEnd = barbPosition + barbSpacing * 1.5;

    drawPennant(ctx, x, y, rad, size, pennantStart, pennantEnd, barbLength, barbColor);

    barbPosition = pennantEnd + 2;
  }

  // Draw long barbs (10 kt)
  for (let i = 0; i < longBarbs; i++) {
    drawBarb(ctx, x, y, rad, size, barbPosition, barbLength, true);
    barbPosition += barbSpacing;
  }

  // Draw short barb (5 kt) if present
  if (shortBarb) {
    // If this is the only barb, offset from end slightly
    if (pennants === 0 && longBarbs === 0) {
      barbPosition = barbSpacing * 0.5;
    }
    drawBarb(ctx, x, y, rad, size, barbPosition, barbLength * 0.5, false);
  }

  ctx.restore();
}

/**
 * Draw a single barb line
 */
function drawBarb(ctx, centerX, centerY, staffRad, staffLength, offset, length, isLong) {
  // Calculate position along staff
  const posX = centerX + Math.cos(staffRad) * (staffLength - offset);
  const posY = centerY + Math.sin(staffRad) * (staffLength - offset);

  // Barbs angle at ~60 degrees from staff, to the right (clockwise from wind direction)
  const barbRad = staffRad + (Math.PI * 60) / 180;

  const actualLength = isLong ? length : length;
  const endX = posX + Math.cos(barbRad) * actualLength;
  const endY = posY + Math.sin(barbRad) * actualLength;

  ctx.beginPath();
  ctx.moveTo(posX, posY);
  ctx.lineTo(endX, endY);
  ctx.stroke();
}

/**
 * Draw a pennant (filled triangle for 50 kt)
 */
function drawPennant(ctx, centerX, centerY, staffRad, staffLength, startOffset, endOffset, height, color) {
  // Three points of the triangle:
  // 1. Start point on staff
  // 2. End point on staff
  // 3. Point perpendicular to staff

  const startX = centerX + Math.cos(staffRad) * (staffLength - startOffset);
  const startY = centerY + Math.sin(staffRad) * (staffLength - startOffset);

  const endX = centerX + Math.cos(staffRad) * (staffLength - endOffset);
  const endY = centerY + Math.sin(staffRad) * (staffLength - endOffset);

  // Perpendicular point (to the right of staff direction)
  const perpRad = staffRad + Math.PI / 2;
  const midX = (startX + endX) / 2;
  const midY = (startY + endY) / 2;
  const pointX = midX + Math.cos(perpRad) * height * 0.7;
  const pointY = midY + Math.sin(perpRad) * height * 0.7;

  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(pointX, pointY);
  ctx.lineTo(endX, endY);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/**
 * Draw wind barbs at grid points
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Array} windGrid - Array of { lat, lon, wind: { direction, speed } }
 * @param {Function} latLonToScreen - Function to convert lat/lon to screen coords
 * @param {Object} options - Drawing options
 */
export function drawWindBarbs(ctx, windGrid, latLonToScreen, options = {}) {
  const {
    size = 25,
    minSpacing = 40, // Minimum pixel spacing between barbs
    opacity = 0.85,
    showLabels = false,
  } = options;

  if (!windGrid || windGrid.length === 0) return;

  // Track drawn positions to prevent overlap
  const drawnPositions = [];

  windGrid.forEach((point) => {
    const { lat, lon, wind } = point;
    if (!wind || wind.speed === 0) return;

    const screen = latLonToScreen(lat, lon);
    if (!screen) return;

    const { x, y } = screen;

    // Check if position is on screen (with buffer)
    if (x < -size || y < -size) return;

    // Check minimum spacing
    const tooClose = drawnPositions.some((pos) => {
      const dx = x - pos.x;
      const dy = y - pos.y;
      return Math.sqrt(dx * dx + dy * dy) < minSpacing;
    });

    if (tooClose) return;

    // Draw the wind barb
    drawWindBarb(ctx, x, y, wind.direction, wind.speed, {
      size,
      opacity,
    });

    // Optionally show speed label
    if (showLabels && wind.speed >= 10) {
      ctx.save();
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = getWindBarbColor(wind.speed, opacity * 0.9);
      ctx.textAlign = 'center';
      ctx.fillText(`${wind.speed}`, x, y + size + 12);
      ctx.restore();
    }

    drawnPositions.push({ x, y });
  });
}

/**
 * Draw wind barb legend
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} x - Legend X position
 * @param {number} y - Legend Y position
 * @param {Object} options - Drawing options
 */
export function drawWindBarbLegend(ctx, x, y, options = {}) {
  const {
    themeColors = null,
    opacity = 0.9,
  } = options;

  const legendItems = [
    { speed: 5, label: '5 kt' },
    { speed: 15, label: '15 kt' },
    { speed: 25, label: '25 kt' },
    { speed: 50, label: '50 kt' },
    { speed: 75, label: '75 kt' },
  ];

  ctx.save();

  // Background
  const padding = 8;
  const itemHeight = 30;
  const legendWidth = 80;
  const legendHeight = legendItems.length * itemHeight + padding * 2;

  ctx.fillStyle = themeColors
    ? themeColors.rgba('background', 0.85)
    : 'rgba(0, 0, 0, 0.85)';
  ctx.strokeStyle = themeColors
    ? themeColors.rgba('grid', 0.5)
    : 'rgba(100, 100, 100, 0.5)';
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.roundRect(x, y, legendWidth, legendHeight, 4);
  ctx.fill();
  ctx.stroke();

  // Title
  ctx.font = 'bold 11px "JetBrains Mono", monospace';
  ctx.fillStyle = themeColors
    ? themeColors.rgba('text', 0.9)
    : 'rgba(255, 255, 255, 0.9)';
  ctx.textAlign = 'center';
  ctx.fillText('Winds', x + legendWidth / 2, y + 14);

  // Draw sample barbs
  legendItems.forEach((item, i) => {
    const itemY = y + padding + 20 + i * itemHeight;

    // Draw barb
    drawWindBarb(ctx, x + 20, itemY + 5, 270, item.speed, {
      size: 20,
      barbLength: 10,
      barbSpacing: 5,
      opacity,
    });

    // Label
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = getWindBarbColor(item.speed, opacity);
    ctx.textAlign = 'left';
    ctx.fillText(item.label, x + 45, itemY + 9);
  });

  ctx.restore();
}

/**
 * Draw altitude level indicator
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} x - Position X
 * @param {number} y - Position Y
 * @param {number} level - Altitude level in feet
 * @param {Object} options - Drawing options
 */
export function drawWindsLevelIndicator(ctx, x, y, level, options = {}) {
  const {
    themeColors = null,
  } = options;

  const label = level >= 18000
    ? `FL${Math.round(level / 100)}`
    : `${(level / 1000).toFixed(0)}k ft`;

  ctx.save();
  ctx.font = 'bold 12px "JetBrains Mono", monospace';
  ctx.fillStyle = themeColors
    ? themeColors.rgba('accent', 0.9)
    : 'rgba(0, 255, 255, 0.9)';
  ctx.textAlign = 'left';
  ctx.fillText(`Winds @ ${label}`, x, y);
  ctx.restore();
}

export default {
  drawWindBarb,
  drawWindBarbs,
  drawWindBarbLegend,
  drawWindsLevelIndicator,
  getWindBarbColor,
  calculateBarbComponents,
};
