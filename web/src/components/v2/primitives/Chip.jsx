import React from 'react';

/**
 * Small labeled chip. Interactive chips (onClick) render as buttons.
 *
 * @param {object} props
 * @param {boolean} [props.mono] - use mono font (codes, hex, coords)
 * @param {boolean} [props.active]
 * @param {string} [props.color] - accent color when active
 * @param {Function} [props.onClick]
 * @param {string} [props.className]
 * @param {React.ReactNode} [props.children]
 */
export function Chip({ mono, active, color, onClick, className = '', children, ...rest }) {
  const classes = [
    'v2-chip',
    mono && 'v2-chip--mono',
    onClick && 'v2-chip--interactive',
    active && 'v2-chip--active',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const style = color ? { '--v2-chip-color': color, ...rest.style } : rest.style;
  if (onClick) {
    return (
      <button
        type="button"
        {...rest}
        onClick={onClick}
        className={classes}
        style={style}
        aria-pressed={!!active}
      >
        {children}
      </button>
    );
  }
  return (
    <span {...rest} className={classes} style={style}>
      {children}
    </span>
  );
}
