import React from 'react';

/**
 * Surface card (mock: --bg1 + 1px --bord, radius 13).
 *
 * @param {object} props
 * @param {'flat'|'raised'|'inset'} [props.variant]
 * @param {string} [props.accentColor] - CSS color for the 3px left accent bar
 * @param {boolean} [props.hoverable]
 * @param {string} [props.className]
 * @param {React.ReactNode} [props.children]
 */
export function Card({
  variant = 'flat',
  accentColor,
  hoverable,
  className = '',
  children,
  ...rest
}) {
  const classes = [
    'v2-card',
    variant === 'raised' && 'v2-card--raised',
    variant === 'inset' && 'v2-card--inset',
    accentColor && 'v2-card--accent-left',
    hoverable && 'v2-card--hover',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const style = accentColor ? { '--v2-accent-bar': accentColor, ...rest.style } : rest.style;
  return (
    <div {...rest} className={classes} style={style}>
      {children}
    </div>
  );
}
