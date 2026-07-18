import React from 'react';
import { Switch, SegmentedControl, Select } from '../../v2/primitives';
import {
  OVERLAY_DEFS,
  TRAIL_LENGTH_OPTIONS,
  PREDICTOR_LENGTH_OPTIONS,
  DEFAULT_AIRSPACE_CLASSES,
} from '../mapState';
import { AIRSPACE_CLASSES } from '../render/symbology';

const COLOR_MODES = [
  { value: 'category', label: 'Type' },
  { value: 'altitude', label: 'Altitude' },
];

const toStr = (opts) => opts.map((o) => ({ value: String(o.value), label: o.label }));

/**
 * Map layers panel (reskin of legacy OverlayMenu). Toggles Leaflet/canvas
 * overlays (range rings, trails, weather radar, airspace, navaids, airports,
 * NOTAMs/TFRs, PIREPs) plus a Display group for ATC symbology prefs (blip coloring, trail
 * length, curved predictor, data-block leaders, coast markers).
 *
 * @param {object} props
 * @param {object} props.overlays
 * @param {(patch: object) => void} props.onChange
 */
export function LayersPanel({ overlays, onChange }) {
  return (
    <div className="lm-panel-pop" role="dialog" aria-label="Map layers">
      <div className="lm-panel-pop__head">
        <span>Map Layers</span>
      </div>
      <div className="lm-panel-pop__group">
        {OVERLAY_DEFS.map(({ key, label }) => (
          <React.Fragment key={key}>
            <label className="lm-panel-pop__row">
              <span>{label}</span>
              <Switch
                checked={!!overlays[key]}
                onCheckedChange={(v) => onChange({ [key]: v })}
                label={label}
              />
            </label>
            {key === 'airspace' && overlays.airspace && (
              <AirspaceClassToggles overlays={overlays} onChange={onChange} />
            )}
          </React.Fragment>
        ))}
      </div>

      <div className="lm-panel-pop__head">
        <span>Display</span>
      </div>
      <div className="lm-panel-pop__group">
        <div className="lm-panel-pop__row">
          <span>Color By</span>
          <SegmentedControl
            options={COLOR_MODES}
            value={overlays.colorMode || 'category'}
            onChange={(v) => onChange({ colorMode: v })}
            aria-label="Blip color mode"
          />
        </div>
        {overlays.trails && (
          <div className="lm-panel-pop__row">
            <span>Trail Length</span>
            <Select
              options={toStr(TRAIL_LENGTH_OPTIONS)}
              value={String(overlays.trailSeconds ?? 300)}
              onChange={(v) => onChange({ trailSeconds: Number(v) })}
              label="Trail length"
            />
          </div>
        )}
        <div className="lm-panel-pop__row">
          <span>Velocity Predictor</span>
          <Switch
            checked={overlays.showPredictor !== false}
            onCheckedChange={(v) => onChange({ showPredictor: v })}
            label="Velocity predictor"
          />
        </div>
        {overlays.showPredictor !== false && (
          <div className="lm-panel-pop__row">
            <span>Predictor Horizon</span>
            <Select
              options={toStr(PREDICTOR_LENGTH_OPTIONS)}
              value={String(overlays.predictorSeconds ?? 60)}
              onChange={(v) => onChange({ predictorSeconds: Number(v) })}
              label="Predictor horizon"
            />
          </div>
        )}
        <div className="lm-panel-pop__row">
          <span>Data-Block Leaders</span>
          <Switch
            checked={overlays.showLeaders !== false}
            onCheckedChange={(v) => onChange({ showLeaders: v })}
            label="Data-block leaders"
          />
        </div>
        <div className="lm-panel-pop__row">
          <span>Coast Markers</span>
          <Switch
            checked={overlays.showCoast !== false}
            onCheckedChange={(v) => onChange({ showCoast: v })}
            label="Coast markers"
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Per-class airspace visibility sub-toggles (Class B/C/D/E, Restricted, MOA,
 * TFR, …). Each row shows the class's map color swatch. Rendered inline under
 * the Airspace overlay row when that layer is enabled.
 */
function AirspaceClassToggles({ overlays, onChange }) {
  const classes = overlays.airspaceClasses || DEFAULT_AIRSPACE_CLASSES;
  const set = (key, v) => onChange({ airspaceClasses: { ...classes, [key]: v } });
  return (
    <div className="lm-panel-pop__subgroup">
      {AIRSPACE_CLASSES.map(({ key, label, rgb }) => (
        <label key={key} className="lm-panel-pop__row lm-panel-pop__row--sub">
          <span>
            <i className="lm-airspace-swatch" style={{ background: `rgb(${rgb})` }} />
            {label}
          </span>
          <Switch
            checked={classes[key] !== false}
            onCheckedChange={(v) => set(key, v)}
            label={label}
          />
        </label>
      ))}
    </div>
  );
}
