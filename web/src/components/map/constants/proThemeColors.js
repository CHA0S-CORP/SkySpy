// Pro Radar Theme Color Presets
export const PRO_THEME_COLORS = {
  // Classic Cyan (default) - modern ATC style
  cyan: {
    name: 'Classic Cyan',
    background: '#0a0d12',
    grid: { r: 40, g: 80, b: 120 },           // Grid lines
    gridLabel: { r: 80, g: 140, b: 180 },     // Grid labels
    primary: { r: 100, g: 200, b: 255 },      // Main UI elements (center marker, scale bar)
    aircraft: { r: 0, g: 255, b: 150 },       // Civilian aircraft
    aircraftText: { r: 150, g: 255, b: 200 }, // Aircraft data block text
    vector: { r: 100, g: 200, b: 255 },       // Velocity vectors
    rangeRing: { r: 60, g: 100, b: 140 },     // Range rings
    rangeLabel: { r: 80, g: 130, b: 170 },    // Range labels
    compass: { r: 80, g: 140, b: 200 },       // Compass rose
    compassMajor: { r: 100, g: 180, b: 255 }, // Compass major labels (N/E/S/W)
    dataBlockBg: { r: 10, g: 13, b: 18 },     // Data block background
    secondaryText: { r: 100, g: 200, b: 180 }, // Secondary info (speed/altitude)
  },
  // Amber/Gold - traditional ATC amber colors
  amber: {
    name: 'Amber/Gold',
    background: '#0d0a06',
    grid: { r: 120, g: 90, b: 40 },
    gridLabel: { r: 180, g: 140, b: 60 },
    primary: { r: 255, g: 180, b: 60 },
    aircraft: { r: 255, g: 200, b: 80 },
    aircraftText: { r: 255, g: 220, b: 150 },
    vector: { r: 255, g: 180, b: 100 },
    rangeRing: { r: 140, g: 100, b: 50 },
    rangeLabel: { r: 170, g: 130, b: 70 },
    compass: { r: 200, g: 150, b: 70 },
    compassMajor: { r: 255, g: 200, b: 100 },
    dataBlockBg: { r: 18, g: 14, b: 8 },
    secondaryText: { r: 200, g: 160, b: 100 },
  },
  // Green Phosphor - retro terminal style
  green: {
    name: 'Green Phosphor',
    background: '#0a0f0a',
    grid: { r: 40, g: 100, b: 50 },
    gridLabel: { r: 80, g: 160, b: 90 },
    primary: { r: 80, g: 255, b: 120 },
    aircraft: { r: 60, g: 255, b: 100 },
    aircraftText: { r: 150, g: 255, b: 170 },
    vector: { r: 100, g: 220, b: 130 },
    rangeRing: { r: 50, g: 120, b: 60 },
    rangeLabel: { r: 70, g: 150, b: 80 },
    compass: { r: 70, g: 180, b: 90 },
    compassMajor: { r: 100, g: 255, b: 140 },
    dataBlockBg: { r: 10, g: 18, b: 12 },
    secondaryText: { r: 100, g: 200, b: 120 },
  },
  // High Contrast - pure white on black for accessibility
  'high-contrast': {
    name: 'High Contrast',
    background: '#000000',
    grid: { r: 80, g: 80, b: 80 },
    gridLabel: { r: 180, g: 180, b: 180 },
    primary: { r: 255, g: 255, b: 255 },
    aircraft: { r: 255, g: 255, b: 255 },
    aircraftText: { r: 255, g: 255, b: 255 },
    vector: { r: 200, g: 200, b: 200 },
    rangeRing: { r: 100, g: 100, b: 100 },
    rangeLabel: { r: 160, g: 160, b: 160 },
    compass: { r: 150, g: 150, b: 150 },
    compassMajor: { r: 255, g: 255, b: 255 },
    dataBlockBg: { r: 20, g: 20, b: 20 },
    secondaryText: { r: 200, g: 200, b: 200 },
  },
};

// Helper function to get theme colors with alpha support
export const getThemeColors = (themeName) => {
  const theme = PRO_THEME_COLORS[themeName] || PRO_THEME_COLORS.cyan;

  // Return helper functions for generating rgba strings
  return {
    ...theme,
    // Generate rgba string from color key
    rgba: (colorKey, alpha = 1) => {
      const c = theme[colorKey];
      if (!c) return `rgba(100, 200, 255, ${alpha})`; // fallback cyan
      return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
    },
    // Get background color
    bg: () => theme.background,
  };
};
