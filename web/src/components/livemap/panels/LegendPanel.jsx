import React from 'react';
import { Icon } from '../../v2/primitives';

const CATS = [
  ['Commercial', '#3ddc84'],
  ['Military', '#b39dff'],
  ['GA', '#4cc9f0'],
  ['Selected', '#ffffff'],
];
const STATUS = [
  ['Emergency squawk', '#f2585d'],
  ['Proximity / safety', '#f5b544'],
];

/** Compact symbol legend for the Live Map. */
export function LegendPanel({ onClose }) {
  return (
    <div className="lm-panel-pop lm-panel-pop--legend" role="dialog" aria-label="Map legend">
      <div className="lm-panel-pop__head">
        <span>Legend</span>
        <button type="button" className="v2-iconbtn" onClick={onClose} aria-label="Close legend">
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="lm-panel-pop__group">
        <div className="lm-panel-pop__group-label">Category</div>
        {CATS.map(([label, color]) => (
          <div key={label} className="lm-legend__row">
            <span className="lm-legend__dart" style={{ color }}>
              <svg width="14" height="14" viewBox="0 0 24 24">
                <path d="M12 2 19 21 12 16 5 21z" fill={color} />
              </svg>
            </span>
            {label}
          </div>
        ))}
      </div>
      <div className="lm-panel-pop__group">
        <div className="lm-panel-pop__group-label">Status</div>
        {STATUS.map(([label, color]) => (
          <div key={label} className="lm-legend__row">
            <span className="lm-legend__ring" style={{ borderColor: color }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
