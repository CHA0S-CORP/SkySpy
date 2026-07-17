import React from 'react';
import { Switch } from '../../v2/primitives';
import { OVERLAY_DEFS } from '../mapState';

/**
 * Map layers panel (reskin of legacy OverlayMenu). Toggles Leaflet/canvas
 * overlays (range rings, trails, weather radar, airspace, navaids, airports,
 * NOTAMs).
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
          <label key={key} className="lm-panel-pop__row">
            <span>{label}</span>
            <Switch checked={!!overlays[key]} onCheckedChange={(v) => onChange({ [key]: v })} label={label} />
          </label>
        ))}
      </div>
    </div>
  );
}
