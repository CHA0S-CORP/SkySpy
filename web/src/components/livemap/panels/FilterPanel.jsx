import React from 'react';
import { Switch } from '../../v2/primitives';

const TOGGLES = [
  [
    'Aircraft type',
    [
      ['showMilitary', 'Military'],
      ['showCivil', 'Civil'],
    ],
  ],
  [
    'Status',
    [
      ['showAirborne', 'Airborne'],
      ['showGround', 'On ground'],
    ],
  ],
  [
    'Transponder',
    [
      ['showWithSquawk', 'With squawk'],
      ['showWithoutSquawk', 'Without squawk'],
    ],
  ],
];

/**
 * Traffic filters panel (reskin of legacy FilterMenu). Gates which aircraft the
 * canvas draws.
 *
 * @param {object} props
 * @param {object} props.filters
 * @param {(patch: object) => void} props.onChange
 * @param {() => void} props.onReset
 */
export function FilterPanel({ filters, onChange, onReset }) {
  return (
    <div className="lm-panel-pop" role="dialog" aria-label="Traffic filters">
      <div className="lm-panel-pop__head">
        <span>Traffic Filters</span>
        <button type="button" className="lm-panel-pop__reset" onClick={onReset}>
          Reset
        </button>
      </div>
      {TOGGLES.map(([group, rows]) => (
        <div key={group} className="lm-panel-pop__group">
          <div className="lm-panel-pop__group-label">{group}</div>
          {rows.map(([key, label]) => (
            <label key={key} className="lm-panel-pop__row">
              <span>{label}</span>
              <Switch
                checked={filters[key]}
                onCheckedChange={(v) => onChange({ [key]: v })}
                label={label}
              />
            </label>
          ))}
        </div>
      ))}
      <div className="lm-panel-pop__group">
        <div className="lm-panel-pop__group-label">Altitude (ft)</div>
        <div className="lm-panel-pop__range">
          <input
            type="number"
            className="v2-input"
            value={filters.minAltitude}
            min={0}
            max={60000}
            step={1000}
            onChange={(e) => {
              // number inputs emit '' while being cleared - Number('') is 0,
              // which would hide all airborne traffic (and persist)
              const v = e.target.valueAsNumber;
              if (!Number.isNaN(v)) onChange({ minAltitude: v });
            }}
            aria-label="Minimum altitude"
          />
          <span>–</span>
          <input
            type="number"
            className="v2-input"
            value={filters.maxAltitude}
            min={0}
            max={60000}
            step={1000}
            onChange={(e) => {
              // number inputs emit '' while being cleared - Number('') is 0,
              // which would hide all airborne traffic (and persist)
              const v = e.target.valueAsNumber;
              if (!Number.isNaN(v)) onChange({ maxAltitude: v });
            }}
            aria-label="Maximum altitude"
          />
        </div>
      </div>
    </div>
  );
}
