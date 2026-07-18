/**
 * v2 icon registry. Feather-style geometry lifted verbatim from
 * design_handoff_skyspy_ui/designs/*.dc.html (viewBox 0 0 24 24,
 * stroke currentColor, stroke-width 1.7, fill none).
 *
 * Each icon is a list of SVG element specs: [tagName, attrs].
 * Screens append icons here as they are migrated — keep entries sorted.
 */

/** @type {Record<string, Array<[string, Record<string, string|number>]>>} */
export const ICONS = {
  activity: [['path', { d: 'M3 12h4l2 6 4-14 2 8h6' }]],
  'alert-circle': [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['path', { d: 'M12 8v4M12 16h.01' }],
  ],
  'alert-triangle': [
    ['path', { d: 'M10.3 3.9 1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z' }],
    ['path', { d: 'M12 9v4M12 17h.01' }],
  ],
  'arrow-down': [['path', { d: 'M12 5v14M5 12l7 7 7-7' }]],
  'arrow-up': [['path', { d: 'M12 19V5M5 12l7-7 7 7' }]],
  'refresh-cw': [
    ['path', { d: 'M23 4v6h-6M1 20v-6h6' }],
    ['path', { d: 'M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15' }],
  ],
  radio: [
    ['circle', { cx: 12, cy: 12, r: 2 }],
    [
      'path',
      {
        d: 'M16.24 7.76a6 6 0 0 1 0 8.49m-8.48 0a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14',
      },
    ],
  ],
  'mic-off': [
    ['path', { d: 'M1 1l22 22' }],
    ['path', { d: 'M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6' }],
    ['path', { d: 'M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23' }],
    ['path', { d: 'M12 19v4M8 23h8' }],
  ],
  inbox: [
    ['path', { d: 'M22 12h-6l-2 3h-4l-2-3H2' }],
    [
      'path',
      {
        d: 'M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
      },
    ],
  ],
  hash: [['path', { d: 'M4 9h16M4 15h16M10 3L8 21M14 3l-2 18' }]],
  'bar-chart': [['path', { d: 'M4 20V10M10 20V4M16 20v-8M22 20H2' }]],
  'bar-chart-2': [['path', { d: 'M18 20V10M12 20V4M6 20v-6' }]],
  bell: [['path', { d: 'M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0' }]],
  'bell-off': [
    ['path', { d: 'M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0' }],
    ['path', { d: 'M2 2l20 20' }],
  ],
  calendar: [
    ['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }],
    ['path', { d: 'M3 9h18M8 4v16' }],
  ],
  check: [['path', { d: 'M20 6L9 17l-5-5' }]],
  'chevron-down': [['path', { d: 'M6 9l6 6 6-6' }]],
  'chevron-right': [['path', { d: 'M9 18l6-6-6-6' }]],
  'chevron-up': [['path', { d: 'M6 15l6-6 6 6' }]],
  clock: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['path', { d: 'M12 7v5l3 2' }],
  ],
  columns: [
    ['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }],
    ['path', { d: 'M9 3v18' }],
  ],
  copy: [
    ['rect', { x: 9, y: 9, width: 12, height: 12, rx: 2 }],
    ['path', { d: 'M5 15V5a2 2 0 012-2h10' }],
  ],
  cpu: [['path', { d: 'M9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2M6 6h12v12H6z' }]],
  database: [
    ['ellipse', { cx: 12, cy: 5, rx: 8, ry: 3 }],
    ['path', { d: 'M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3' }],
  ],
  compass: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['circle', { cx: 12, cy: 12, r: 4 }],
    ['path', { d: 'M12 1v4M12 19v4M1 12h4M19 12h4' }],
  ],
  crosshair: [
    ['circle', { cx: 12, cy: 12, r: 7 }],
    ['path', { d: 'M12 1v4M12 19v4M1 12h4M19 12h4' }],
  ],
  dart: [['path', { d: 'M12 2 19 21 12 16 5 21z', fill: 'currentColor', stroke: 'none' }]],
  edit: [['path', { d: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z' }]],
  'external-link': [
    ['path', { d: 'M15 3h6v6M21 3l-9 9M10 5H5a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-5' }],
  ],
  eye: [
    ['path', { d: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z' }],
    ['circle', { cx: 12, cy: 12, r: 3 }],
  ],
  file: [
    ['path', { d: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z' }],
    ['path', { d: 'M14 2v6h6' }],
  ],
  filter: [['path', { d: 'M22 3H2l8 9.5V19l4 2v-8.5z' }]],
  fullscreen: [['path', { d: 'M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5' }]],
  grid: [
    ['rect', { x: 3, y: 3, width: 7, height: 7, rx: 1 }],
    ['rect', { x: 14, y: 3, width: 7, height: 7, rx: 1 }],
    ['rect', { x: 3, y: 14, width: 7, height: 7, rx: 1 }],
    ['rect', { x: 14, y: 14, width: 7, height: 7, rx: 1 }],
  ],
  history: [['path', { d: 'M3 12a9 9 0 109-9 9 9 0 00-8 5M3 3v5h5M12 7v5l3 2' }]],
  info: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['path', { d: 'M12 16v-4M12 8h.01' }],
  ],
  layers: [['path', { d: 'M12 2 2 7l10 5 10-5zM2 12l10 5 10-5M2 17l10 5 10-5' }]],
  link: [
    [
      'path',
      { d: 'M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1' },
    ],
  ],
  'log-out': [['path', { d: 'M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3' }]],
  mail: [['path', { d: 'M4 4h16v16H4zM4 6l8 6 8-6' }]],
  map: [['path', { d: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15' }]],
  'line-chart': [
    ['path', { d: 'M3 3v18h18' }],
    ['path', { d: 'M7 14l3-4 3 3 4-6' }],
  ],
  'map-pin': [
    ['path', { d: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0116 0z' }],
    ['circle', { cx: 12, cy: 10, r: 2.6 }],
  ],
  maximize: [['path', { d: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7' }]],
  menu: [['path', { d: 'M3 6h18M3 12h18M3 18h18' }]],
  memory: [['path', { d: 'M4 8h16v8H4zM8 8v8M12 8v8M16 8v8M2 12h2M20 12h2' }]],
  message: [['path', { d: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z' }]],
  mic: [
    ['path', { d: 'M12 2a3 3 0 013 3v6a3 3 0 01-6 0V5a3 3 0 013-3zM5 11a7 7 0 0014 0M12 18v3' }],
  ],
  pause: [['path', { d: 'M6 5h2v14H6zM16 5h2v14h-2z', fill: 'currentColor', stroke: 'none' }]],
  plane: [['path', { d: 'M22 12 15 12 13 21 11 3 9 12 2 12' }]],
  // solid right-pointing arrowhead used as the flight-route position marker
  'route-marker': [['path', { d: 'M4 4 20 12 4 20 8 12z', fill: 'currentColor', stroke: 'none' }]],
  play: [['path', { d: 'M7 5v14l11-7z', fill: 'currentColor', stroke: 'none' }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  radar: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['path', { d: 'M12 3v18M3 12h18', opacity: 0.5 }],
    ['circle', { cx: 12, cy: 12, r: 3.4, fill: 'currentColor', stroke: 'none' }],
  ],
  refresh: [['path', { d: 'M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5' }]],
  rows: [
    ['rect', { x: 3, y: 4, width: 18, height: 6, rx: 1.5 }],
    ['rect', { x: 3, y: 14, width: 18, height: 6, rx: 1.5 }],
  ],
  search: [
    ['circle', { cx: 11, cy: 11, r: 7 }],
    ['path', { d: 'M21 21l-4.3-4.3' }],
  ],
  send: [['path', { d: 'M22 2 15 22 11 13 2 9z' }]],
  share: [
    ['circle', { cx: 18, cy: 5, r: 3 }],
    ['circle', { cx: 6, cy: 12, r: 3 }],
    ['circle', { cx: 18, cy: 19, r: 3 }],
    ['path', { d: 'M8.6 13.5l6.8 4M15.4 6.5l-6.8 4' }],
  ],
  shield: [['path', { d: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z' }]],
  'shield-check': [
    ['path', { d: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z' }],
    ['path', { d: 'M9 12l2 2 4-4' }],
  ],
  signal: [['path', { d: 'M5 12a10 10 0 0114 0M8.5 15.5a5 5 0 017 0M12 19h.01' }]],
  sliders: [['path', { d: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' }]],
  sun: [
    ['circle', { cx: 12, cy: 12, r: 3.2 }],
    ['path', { d: 'M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2' }],
  ],
  star: [
    ['path', { d: 'M12 2l3 6.5 7 .8-5.2 4.7 1.5 6.9L12 17.8 5.2 20.9l1.5-6.9L1.5 9.3l7-.8z' }],
  ],
  thermometer: [['path', { d: 'M14 14V5a2 2 0 10-4 0v9a4 4 0 104 0z' }]],
  target: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['circle', { cx: 12, cy: 12, r: 3.6 }],
    ['path', { d: 'M12 1v3M12 20v3M1 12h3M20 12h3' }],
  ],
  users: [
    ['circle', { cx: 9, cy: 8, r: 3 }],
    ['path', { d: 'M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 14c2.5.3 4 2.4 4 5' }],
  ],
  upload: [['path', { d: 'M12 3v12M8 7l4-4 4 4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2' }]],
  volume: [['path', { d: 'M11 5 6 9H2v6h4l5 4zM19 12a4 4 0 00-2-3.5' }]],
  'volume-x': [['path', { d: 'M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6' }]],
  wave: [
    ['circle', { cx: 12, cy: 12, r: 2.4 }],
    ['path', { d: 'M7 8a7 7 0 000 8M17 8a7 7 0 010 8M4.5 5a11 11 0 000 14M19.5 5a11 11 0 010 14' }],
  ],
  x: [['path', { d: 'M6 6l12 12M18 6L6 18' }]],
  zap: [['path', { d: 'M13 2 3 14h7l-1 8 10-12h-7z' }]],
};
