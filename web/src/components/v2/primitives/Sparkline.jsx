import React from 'react';

/**
 * Hand-built SVG sparkline (design mocks build charts inline — no chart lib).
 * Normalizes the series into the viewBox; optional area fill under the line.
 *
 * @param {object} props
 * @param {number[]} props.data
 * @param {number} [props.width]
 * @param {number} [props.height]
 * @param {string} [props.color]
 * @param {boolean} [props.area]
 * @param {number} [props.strokeWidth]
 */
export function Sparkline({
  data,
  width = 120,
  height = 32,
  color = 'var(--accent)',
  area = false,
  strokeWidth = 1.6,
}) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pad = 2;
  const step = (width - pad * 2) / (data.length - 1);
  const points = data.map((v, i) => {
    const x = pad + i * step;
    const y = pad + (1 - (v - min) / span) * (height - pad * 2);
    return [Number(x.toFixed(2)), Number(y.toFixed(2))];
  });
  const path = points.map(([x, y]) => `${x},${y}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {area && (
        <polygon
          points={`${pad},${height - pad} ${path} ${width - pad},${height - pad}`}
          fill={color}
          opacity="0.12"
        />
      )}
      <polyline
        points={path}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
    </svg>
  );
}
