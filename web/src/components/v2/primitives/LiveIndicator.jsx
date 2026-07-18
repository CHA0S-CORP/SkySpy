import React from 'react';

/**
 * Live/connection indicator: a pulsing dot + label, matching the shell's
 * LIVE/OFFLINE badge (green pulsing when connected, red static otherwise).
 * Extracted so the Live Map shell and the Detail track map share one indicator.
 *
 * @param {object} props
 * @param {boolean} props.connected - true → green pulsing LIVE, false → red static
 * @param {string} [props.liveLabel] - label when connected (default 'LIVE')
 * @param {string} [props.offlineLabel] - label when not connected (default 'OFFLINE')
 * @param {boolean} [props.showLabel] - render the text label (default true)
 * @param {string} [props.className]
 */
export function LiveIndicator({
  connected,
  liveLabel = 'LIVE',
  offlineLabel = 'OFFLINE',
  showLabel = true,
  className = '',
}) {
  return (
    <span className={`v2-live ${connected ? '' : 'v2-live--offline'} ${className}`}>
      <span className="v2-live__dot" />
      {showLabel && <span className="v2-live__label">{connected ? liveLabel : offlineLabel}</span>}
    </span>
  );
}
