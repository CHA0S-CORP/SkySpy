import React from 'react';
import { ICONS } from './icons';

/**
 * Feather-style inline SVG icon (design handoff spec: viewBox 0 0 24 24,
 * stroke currentColor, strokeWidth 1.7, fill none).
 *
 * @param {object} props
 * @param {keyof typeof ICONS} props.name
 * @param {number} [props.size]
 * @param {number} [props.strokeWidth]
 * @param {string} [props.className]
 */
export function Icon({ name, size = 16, strokeWidth = 1.7, className, ...rest }) {
  const spec = ICONS[name];
  if (!spec) {
    if (import.meta.env.DEV) console.warn(`[v2/Icon] unknown icon: ${name}`);
    return null;
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      {spec.map(([tag, attrs], i) => React.createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}
