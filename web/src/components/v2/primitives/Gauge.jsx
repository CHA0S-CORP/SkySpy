import React from 'react';

/**
 * Health gauge (mock System screen: value + progress bar + note).
 *
 * @param {object} props
 * @param {React.ReactNode} props.label
 * @param {number} props.value - 0..100
 * @param {React.ReactNode} [props.display] - formatted value (defaults to `${value}%`)
 * @param {React.ReactNode} [props.note]
 * @param {string} [props.color]
 */
export function Gauge({ label, value, display, note, color = 'var(--accent)' }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="v2-statcard">
      <div className="v2-eyebrow">{label}</div>
      <div className="v2-statcard__value" style={{ color }}>
        {display ?? `${Math.round(pct)}%`}
      </div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{ height: 6, borderRadius: 3, background: 'var(--bg0)', overflow: 'hidden' }}
      >
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: color }} />
      </div>
      {note != null && <div className="v2-statcard__sub">{note}</div>}
    </div>
  );
}
