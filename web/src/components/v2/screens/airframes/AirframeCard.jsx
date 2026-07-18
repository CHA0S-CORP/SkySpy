import React from 'react';
import { Icon } from '../../primitives';
import { Planform } from './Planform';
import { CATEGORY_COLOR, CATEGORIES } from './airframesData';

const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

/** Compact spec readout row. */
function Spec({ label, value, unit }) {
  return (
    <div className="v2-af__spec">
      <span className="v2-af__spec-k">{label}</span>
      <span className="v2-af__spec-v v2-mono">
        {value}
        {unit && <span className="v2-af__spec-u"> {unit}</span>}
      </span>
    </div>
  );
}

/**
 * A single technical-diagram card for one airframe type.
 *
 * @param {object} props
 * @param {import('./airframesData').Airframe} props.frame
 * @param {(frame: import('./airframesData').Airframe) => void} [props.onOpen]
 */
export function AirframeCard({ frame, onOpen }) {
  const color = CATEGORY_COLOR[frame.category] || 'var(--accent2)';
  const engineLabel =
    frame.shape.kind === 'heli'
      ? `${frame.shape.blades}-blade rotor`
      : `${frame.shape.engines}× ${frame.shape.kind === 'prop' ? 'turbine/piston' : frame.shape.kind === 'fighter' ? 'afterburning' : 'turbofan'}`;

  const open = () => onOpen?.(frame);
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  };

  return (
    <article
      className="v2-af__card v2-af__card--btn"
      style={{ '--af-accent': color }}
      data-testid={`af-card-${frame.id}`}
      role="button"
      tabIndex={0}
      aria-label={`Open ${frame.name} dossier`}
      onClick={open}
      onKeyDown={onKey}
    >
      {/* header: ICAO type designator + category */}
      <header className="v2-af__head">
        <div className="v2-af__ident">
          <span className="v2-af__type v2-mono">{frame.id}</span>
          <span className="v2-af__cat">{CAT_LABEL[frame.category]}</span>
        </div>
        <div className="v2-af__title">
          <h3 className="v2-af__name">{frame.name}</h3>
          <span className="v2-af__mfr">{frame.mfr}</span>
        </div>
      </header>

      {/* blueprint diagram with corner registration ticks */}
      <div className="v2-af__diagram">
        <span className="v2-af__corner v2-af__corner--tl" />
        <span className="v2-af__corner v2-af__corner--tr" />
        <span className="v2-af__corner v2-af__corner--bl" />
        <span className="v2-af__corner v2-af__corner--br" />
        <span className="v2-af__scan" />
        <Planform length={frame.length} span={frame.span} shape={frame.shape} color={color} />
        <span className="v2-af__viewtag v2-mono">TOP · PLAN</span>
        {/* reference-photo inset pinned to the drawing */}
        {frame.photo && (
          <span className="v2-af__inset">
            <img src={frame.photo} alt="" loading="lazy" aria-hidden="true" />
            <span className="v2-af__inset-tag v2-mono">REF</span>
          </span>
        )}
        {/* open affordance */}
        <span className="v2-af__expand v2-mono">
          <Icon name="maximize" size={11} strokeWidth={2} />
          DOSSIER
        </span>
      </div>

      {/* spec grid */}
      <div className="v2-af__specs">
        <Spec label="Engines" value={engineLabel} />
        <Spec label="Role" value={frame.role} />
        <Spec label="MTOW" value={frame.mtow.toLocaleString()} unit="kg" />
        <Spec label="Cruise" value={frame.cruise} unit="kt" />
        <Spec label="Range" value={frame.range.toLocaleString()} unit="nm" />
        <Spec label="Ceiling" value={frame.ceiling.toLocaleString()} unit="ft" />
        <Spec label="Height" value={frame.height} unit="m" />
        <Spec label="First flt" value={frame.firstFlight} />
      </div>
    </article>
  );
}
