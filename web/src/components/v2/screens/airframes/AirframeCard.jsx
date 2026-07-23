import React from 'react';
import { Icon } from '../../primitives';
import { Planform } from './Planform';
import { CATEGORY_COLOR, CATEGORIES } from './airframesData';
import { navigate } from '../../../../lib/hashRoute';

const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

/**
 * Placeholder tile for a type designator that has NO reference card yet (seen
 * here or searched-for). Offers on-demand LLM generation.
 *
 * @param {object} props
 * @param {string} props.type - ICAO type designator
 * @param {number} [props.seenCount] - distinct tails tracked here (0 = hide badge)
 * @param {'idle'|'pending'|'error'} [props.state]
 * @param {boolean} [props.locked] - LLM card generation is gated for this
 *   (anonymous) user — show a sign-in CTA instead of the generate button.
 * @param {(type: string) => void} props.onGenerate
 */
export function GenerateTile({ type, seenCount = 0, state = 'idle', locked = false, onGenerate }) {
  const pending = state === 'pending';
  return (
    <article className="v2-af__card v2-af__card--ghost" data-testid={`af-ghost-${type}`}>
      <header className="v2-af__head">
        <div className="v2-af__ident">
          <span className="v2-af__type v2-mono">{type}</span>
          <span className="v2-af__cat">No reference card</span>
          {seenCount > 0 && (
            <span className="v2-af__seen v2-mono" title={`${seenCount} tracked here`}>
              <Icon name="eye" size={11} strokeWidth={2} />
              {seenCount} seen
            </span>
          )}
        </div>
      </header>
      <div className="v2-af__ghost-body">
        <Icon name={locked ? 'lock' : pending ? 'cpu' : 'plus'} size={20} strokeWidth={1.7} />
        <p className="v2-af__ghost-msg">
          {locked
            ? 'Sign in to generate a card.'
            : pending
              ? 'Generating from web sources…'
              : state === 'error'
                ? 'Generation failed — try again.'
                : 'No blueprint or specs yet.'}
        </p>
        {locked ? (
          <button
            type="button"
            className="v2-af__gen-btn v2-mono"
            onClick={() => navigate('login')}
          >
            <Icon name="log-in" size={12} strokeWidth={2} />
            SIGN IN TO GENERATE
          </button>
        ) : (
          <button
            type="button"
            className="v2-af__gen-btn v2-mono"
            onClick={() => onGenerate?.(type)}
            disabled={pending}
          >
            <Icon name="cpu" size={12} strokeWidth={2} />
            {pending ? 'GENERATING…' : 'GENERATE CARD'}
          </button>
        )}
      </div>
    </article>
  );
}

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
 * @param {number} [props.seenCount] - distinct tails of this type tracked here (0 = hide badge)
 * @param {boolean} [props.neverSeen] - this station has never tracked this type (all-time)
 * @param {(frame: import('./airframesData').Airframe) => void} [props.onOpen]
 */
export function AirframeCard({ frame, seenCount = 0, neverSeen = false, onOpen }) {
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
    <div
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
          {frame.generated && (
            <span
              className="v2-af__auto v2-mono"
              title="Auto-generated from an AI summary — verify the figures"
            >
              <Icon name="cpu" size={11} strokeWidth={2} />
              AUTO
            </span>
          )}
          {seenCount > 0 && (
            <span className="v2-af__seen v2-mono" title={`${seenCount} tracked here`}>
              <Icon name="eye" size={11} strokeWidth={2} />
              {seenCount} seen
            </span>
          )}
          {seenCount === 0 && neverSeen && (
            <span
              className="v2-af__unseen v2-mono"
              title="This station has never tracked this type — reference data only"
            >
              <Icon name="eye-off" size={11} strokeWidth={2} />
              NEVER SEEN
            </span>
          )}
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
    </div>
  );
}
