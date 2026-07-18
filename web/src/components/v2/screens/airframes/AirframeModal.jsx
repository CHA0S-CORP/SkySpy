import React, { useState } from 'react';
import { Modal, Icon } from '../../primitives';
import { Planform } from './Planform';
import { CATEGORY_COLOR, CATEGORIES } from './airframesData';

const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

// unit conversions
const M_TO_FT = 3.28084;
const KG_TO_LB = 2.20462;
const KT_TO_KMH = 1.852;
const NM_TO_KM = 1.852;
const FT_TO_M = 0.3048;
const r0 = (n) => Math.round(n).toLocaleString();
const r1 = (n) => (Math.round(n * 10) / 10).toLocaleString();

/** One dual-unit spec row in the technical readout. */
function SpecRow({ k, primary, secondary }) {
  return (
    <div className="v2-afm__row">
      <span className="v2-afm__row-k">{k}</span>
      <span className="v2-afm__row-v v2-mono">
        {primary}
        {secondary != null && <span className="v2-afm__row-s"> {secondary}</span>}
      </span>
    </div>
  );
}

/** Reference photograph with graceful fallback to the blueprint on load error. */
function TypePhoto({ frame, color }) {
  const [failed, setFailed] = useState(false);
  if (!frame.photoFull || failed) {
    return (
      <div className="v2-afm__photo v2-afm__photo--empty">
        <Planform
          length={frame.length}
          span={frame.span}
          shape={frame.shape}
          color={color}
          w={360}
          h={280}
        />
        <span className="v2-afm__nophoto v2-mono">NO REFERENCE IMAGE — SYNTHESISED PLAN</span>
      </div>
    );
  }
  return (
    <figure className="v2-afm__photo">
      <img
        src={frame.photoFull}
        alt={`${frame.mfr} ${frame.name}`}
        loading="lazy"
        onError={() => setFailed(true)}
      />
      <span className="v2-afm__scanline" />
      <figcaption className="v2-afm__credit v2-mono">
        <Icon name="file" size={10} strokeWidth={1.8} />
        REF. PHOTO · {frame.credit || 'Wikimedia Commons'}
      </figcaption>
    </figure>
  );
}

/**
 * Full technical dossier for one airframe type: reference photograph, annotated
 * engineering blueprint, dual-unit spec sheet and reference notes.
 *
 * @param {object} props
 * @param {import('./airframesData').Airframe|null} props.frame
 * @param {boolean} props.open
 * @param {(open: boolean) => void} props.onOpenChange
 */
export function AirframeModal({ frame, open, onOpenChange }) {
  if (!frame) return null;
  const color = CATEGORY_COLOR[frame.category] || 'var(--accent2)';
  const ratio = (frame.span / frame.length).toFixed(2);

  const title = (
    <div className="v2-afm__title" style={{ '--af-accent': color }}>
      <span className="v2-afm__title-type v2-mono">{frame.id}</span>
      <span className="v2-afm__title-sep" />
      <span className="v2-afm__title-name">{frame.name}</span>
      <span className="v2-afm__title-cat">{CAT_LABEL[frame.category]}</span>
    </div>
  );

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} width="min(920px, 94vw)">
      <div className="v2-afm" style={{ '--af-accent': color }}>
        {/* ── top: photo + primary identity ─────────────────────────────── */}
        <div className="v2-afm__hero">
          <TypePhoto frame={frame} color={color} />
          <div className="v2-afm__ident">
            <div className="v2-afm__maker">{frame.mfr}</div>
            <div className="v2-afm__role">
              <Icon name="target" size={13} strokeWidth={1.9} />
              {frame.role}
            </div>
            {frame.blurb && <p className="v2-afm__blurb">{frame.blurb}</p>}
            <dl className="v2-afm__tags">
              {frame.powerplant && (
                <div className="v2-afm__tag">
                  <dt>
                    <Icon name="zap" size={12} strokeWidth={1.9} /> Powerplant
                  </dt>
                  <dd>{frame.powerplant}</dd>
                </div>
              )}
              {frame.variants && (
                <div className="v2-afm__tag">
                  <dt>
                    <Icon name="layers" size={12} strokeWidth={1.9} /> Variants
                  </dt>
                  <dd>{frame.variants}</dd>
                </div>
              )}
              {frame.wtc && (
                <div className="v2-afm__tag">
                  <dt>
                    <Icon name="wave" size={12} strokeWidth={1.9} /> Wake cat.
                  </dt>
                  <dd>{frame.wtc}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>

        {/* ── bottom: blueprint + spec sheet ────────────────────────────── */}
        <div className="v2-afm__tech">
          <div className="v2-afm__blueprint">
            <div className="v2-afm__bp-head v2-mono">
              <span>DRG · TOP PLAN — {frame.id}</span>
              <span className="v2-afm__bp-rev">REV — REF ONLY · NOT TO BUILD</span>
            </div>
            <Planform
              length={frame.length}
              span={frame.span}
              shape={frame.shape}
              color={color}
              w={440}
              h={360}
              detailed
              label={frame.id}
            />
          </div>

          <div className="v2-afm__sheet">
            <div className="v2-afm__sheet-head v2-mono">SPECIFICATIONS</div>
            <SpecRow
              k="Length"
              primary={`${r1(frame.length)} m`}
              secondary={`${r1(frame.length * M_TO_FT)} ft`}
            />
            <SpecRow
              k="Wingspan"
              primary={`${r1(frame.span)} m`}
              secondary={`${r1(frame.span * M_TO_FT)} ft`}
            />
            <SpecRow
              k="Height"
              primary={`${r1(frame.height)} m`}
              secondary={`${r1(frame.height * M_TO_FT)} ft`}
            />
            <SpecRow
              k="MTOW"
              primary={`${r0(frame.mtow)} kg`}
              secondary={`${r0(frame.mtow * KG_TO_LB)} lb`}
            />
            <SpecRow
              k="Cruise"
              primary={`${frame.cruise} kt`}
              secondary={`${r0(frame.cruise * KT_TO_KMH)} km/h`}
            />
            <SpecRow
              k="Range"
              primary={`${r0(frame.range)} nm`}
              secondary={`${r0(frame.range * NM_TO_KM)} km`}
            />
            <SpecRow
              k="Ceiling"
              primary={`${r0(frame.ceiling)} ft`}
              secondary={`${r0(frame.ceiling * FT_TO_M)} m`}
            />
            <SpecRow k="Span : length" primary={`${ratio} : 1`} />
            <SpecRow k="First flight" primary={`${frame.firstFlight}`} />
          </div>
        </div>
      </div>
    </Modal>
  );
}
