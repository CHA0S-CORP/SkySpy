/**
 * Design System Tokens
 *
 * These tokens match the CSS variables defined in styles/base.css
 * Use these for JavaScript/TypeScript styling (e.g., inline styles, CSS-in-JS)
 */

export const colors = {
  background: {
    dark: '#0d1117',
    card: '#151b24',
    hover: '#1c2432',
  },
  border: '#252d3a',
  text: {
    primary: '#e6edf3',
    secondary: '#8b949e',
    dim: '#484f58',
  },
  accent: {
    cyan: '#00d4ff',
    green: '#4ade80',
    blue: '#5a7a9a',
    yellow: '#d29922',
    red: '#f85149',
    purple: '#a371f7',
  },
  brand: {
    navy: '#1a2035',
    blue: '#5a7a9a',
    green: '#4ade80',
  },
  glow: {
    cyan: 'rgba(0, 212, 255, 0.15)',
    green: 'rgba(74, 222, 128, 0.15)',
  },
};

export const zIndex = {
  base: 1,
  dropdown: 100,
  sticky: 500,
  fixed: 900,
  modalBackdrop: 1000,
  modal: 1100,
  popover: 1200,
  tooltip: 1300,
  cannonball: 8000,
  cannonballPanel: 8100,
  cannonballSettings: 8200,
  toast: 9000,
  skipLink: 9500,
};

export const spacing = {
  0: '0px',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  7: '28px',
  8: '32px',
  9: '36px',
  10: '40px',
  11: '44px',
  12: '48px',
  13: '52px',
  14: '56px',
  15: '60px',
  16: '64px',
};

export const borderRadius = {
  none: '0px',
  sm: '4px',
  md: '6px',
  lg: '8px',
  xl: '12px',
  full: '9999px',
};

export const typography = {
  fontFamily: {
    sans: "'Outfit', sans-serif",
    mono: "'JetBrains Mono', monospace",
  },
  fontSize: {
    xs: '10px',
    sm: '11px',
    base: '14px',
    md: '16px',
    lg: '18px',
    xl: '20px',
    '2xl': '24px',
    '3xl': '30px',
  },
  fontWeight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
};

export const transitions = {
  fast: '150ms ease',
  normal: '200ms ease',
  slow: '300ms ease',
};

export const shadows = {
  sm: '0 1px 2px rgba(0, 0, 0, 0.3)',
  md: '0 4px 6px rgba(0, 0, 0, 0.4)',
  lg: '0 10px 15px rgba(0, 0, 0, 0.5)',
  glass: '0 8px 32px rgba(0, 0, 0, 0.3)',
  glowCyan: '0 0 20px rgba(0, 212, 255, 0.15)',
};
