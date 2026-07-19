import React, { useEffect, useState } from 'react';
import { Icon } from '../../v2/primitives';
import { airmetRgb, airmetLabel } from '../render/symbology';

/**
 * Fetch the structured LLM breakdown for one AIRMET, keyed on advisory_id.
 * Plain fetch (not React Query) so the panel works regardless of provider host.
 * Returns {brief, state} where state is 'loading' | 'ready' | 'unavailable' | 'error'.
 */
function useAirmetBrief(apiBase, advisoryId) {
  const [brief, setBrief] = useState(null);
  const [state, setState] = useState('idle');

  useEffect(() => {
    if (!advisoryId) {
      setBrief(null);
      setState('idle');
      return;
    }
    const ctrl = new AbortController();
    setBrief(null);
    setState('loading');
    const url = `${apiBase || ''}/api/v1/aviation/airmet/brief?advisory_id=${encodeURIComponent(advisoryId)}`;
    fetch(url, { signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (ctrl.signal.aborted) return;
        if (!data || data.available === false || !data.brief) {
          setState('unavailable');
          return;
        }
        setBrief(data.brief);
        setState('ready');
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setState('error');
      });
    return () => ctrl.abort();
  }, [apiBase, advisoryId]);

  return { brief, state };
}

const HAZARD_NAMES = {
  'TURB-LO': 'Turbulence (low)',
  'TURB-HI': 'Turbulence (high)',
  TURB: 'Turbulence',
  ICE: 'Icing',
  FZLVL: 'Freezing level',
  IFR: 'IFR',
  MT_OBSC: 'Mountain obscuration',
  MTN_OBSCN: 'Mountain obscuration',
  LLWS: 'Low-level wind shear',
  SFC_WND: 'Surface wind',
};

const fl = (ft) => (ft === null || ft === undefined ? null : `FL${Math.round(ft / 100)}`);

function until(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return `${new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}Z`;
}

/**
 * Live Map AIRMET detail panel. Given a clicked G-AIRMET advisory, renders the
 * hazard, severity, altitude band, validity, and geometry type inside the shared
 * lm-panel, colour-matched to the canvas symbology.
 *
 * @param {object} props
 * @param {object} props.airmet - advisory: {advisory_id, hazard, severity, lower_alt_ft, upper_alt_ft, valid_to, polygon, raw_text}
 * @param {string} [props.apiBase] - API base URL for the LLM breakdown fetch
 * @param {() => void} props.onClose
 */
export function AirmetPanel({ airmet, apiBase = '', onClose }) {
  const { brief, state } = useAirmetBrief(apiBase, airmet?.advisory_id);
  if (!airmet) return null;
  const hazard = (airmet.hazard || '').toUpperCase();
  const color = `rgb(${airmetRgb(hazard)})`;
  const name = HAZARD_NAMES[hazard] || airmetLabel(hazard);
  const isLine = airmet.polygon?.type === 'LineString';
  const sev = airmet.severity ? String(airmet.severity).toUpperCase() : null;
  const idTag = (airmet.advisory_id || hazard || 'G-AIRMET').toString().toUpperCase().slice(0, 22);

  return (
    <aside
      className="lm-panel lm-airmet"
      data-testid="lm-airmet-panel"
      style={{ '--airmet-color': color }}
    >
      <div className="lm-airmet__banner">
        <div className="lm-airmet__grid" />
        <div className="lm-airmet__sweep" />
        <div className="lm-airmet__glow" />
        <span className="lm-airmet__reticle lm-airmet__reticle--tl" />
        <span className="lm-airmet__reticle lm-airmet__reticle--tr" />
        <span className="lm-airmet__reticle lm-airmet__reticle--bl" />
        <span className="lm-airmet__reticle lm-airmet__reticle--br" />

        <button
          type="button"
          className="lm-airmet__close"
          onClick={onClose}
          aria-label="Close panel"
        >
          <Icon name="x" size={15} strokeWidth={2.1} />
        </button>

        <div className="lm-airmet__eyebrow">
          <span className="lm-airmet__live">
            <i className="lm-airmet__live-dot" />
            LIVE ADVISORY
          </span>
          <span className="lm-airmet__id">{idTag}</span>
        </div>

        <div className="lm-airmet__head">
          <span className="lm-airmet__glyph" aria-hidden="true">
            <Icon name="wind" size={22} strokeWidth={1.7} />
          </span>
          <span className="lm-airmet__title">
            <span className="lm-airmet__name">{name}</span>
            <span className="lm-airmet__tier">
              <span className="lm-airmet__badge">{sev || 'AIRMET'}</span>
              <span className="lm-airmet__haz">{hazard}</span>
              <span className="lm-airmet__geo">{isLine ? 'LINE' : 'AREA'}</span>
            </span>
          </span>
        </div>
      </div>

      <div className="lm-panel__body lm-airmet__body">
        <div className="lm-airmet__readout">
          <AltitudeBand lowerFt={airmet.lower_alt_ft} upperFt={airmet.upper_alt_ft} />
          <div className="lm-airmet__rows">
            <Row
              label="Altitude"
              value={`${fl(airmet.lower_alt_ft) || 'SFC'} – ${fl(airmet.upper_alt_ft) || 'ABV'}`}
              mono
            />
            <Row label="Hazard" value={hazard} mono />
            <Row label="Geometry" value={isLine ? 'Advisory line' : 'Forecast area'} />
            <Row label="Valid until" value={until(airmet.valid_to) || '—'} mono />
          </div>
        </div>

        <AirmetBriefing brief={brief} state={state} />

        {airmet.raw_text ? (
          <div className="lm-airmet__source">
            <div className="lm-airmet__source-head">
              <Icon name="file" size={11} strokeWidth={1.9} />
              Source text
            </div>
            <div className="lm-airmet__raw">{airmet.raw_text}</div>
          </div>
        ) : null}

        <p className="lm-airmet__note">
          <Icon name="info" size={12} strokeWidth={1.9} />
          Forecast hazard region issued by the NWS Aviation Weather Center.
        </p>
      </div>
    </aside>
  );
}

/**
 * Vertical flight-level ladder that renders the affected altitude slab as a
 * glowing hazard band against an FL scale (SFC → FL450). Surfaces the altitude
 * band graphically — the single most operationally useful AIRMET field.
 */
function AltitudeBand({ lowerFt, upperFt }) {
  const MAX = 45000;
  const lo = Math.max(0, Math.min(MAX, lowerFt ?? 0));
  const hi = Math.max(lo, Math.min(MAX, upperFt ?? MAX));
  const openTop = upperFt == null;
  const topPct = (1 - hi / MAX) * 100;
  const hPct = Math.max(3, ((hi - lo) / MAX) * 100);
  const ticks = [45000, 35000, 25000, 15000, 5000];
  return (
    <div className="lm-airmet__ladder" aria-hidden="true">
      <div className="lm-airmet__ladder-scale">
        {ticks.map((t) => (
          <span
            key={t}
            className="lm-airmet__ladder-tick"
            style={{ top: `${(1 - t / MAX) * 100}%` }}
          >
            FL{t / 100}
          </span>
        ))}
      </div>
      <div className="lm-airmet__ladder-track">
        {ticks.map((t) => (
          <span
            key={t}
            className="lm-airmet__ladder-grid"
            style={{ top: `${(1 - t / MAX) * 100}%` }}
          />
        ))}
        <div
          className={`lm-airmet__ladder-band${openTop ? ' is-open' : ''}`}
          style={{ top: `${topPct}%`, height: `${hPct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * LLM-generated structured breakdown block. Renders headline/summary plus
 * hazard, altitude, operational-impact and observer-tip lists when present.
 */
function AirmetBriefing({ brief, state }) {
  if (state === 'loading' || state === 'idle') {
    return (
      <div className="lm-airmet__brief lm-airmet__brief--loading">
        <span className="lm-airmet__brief-tag">
          <Icon name="zap" size={12} strokeWidth={2} />
          DECODE
        </span>
        <span className="lm-airmet__brief-wait">
          Analyzing advisory
          <span className="lm-airmet__dots">
            <i />
            <i />
            <i />
          </span>
        </span>
      </div>
    );
  }
  if (state !== 'ready' || !brief) return null;
  const { headline, summary, hazard_detail, altitude_note, operational_impact, safety_tips } =
    brief;
  return (
    <div className="lm-airmet__brief">
      <div className="lm-airmet__brief-head">
        <span className="lm-airmet__brief-tag">
          <Icon name="zap" size={12} strokeWidth={2} />
          DECODE
        </span>
        <span className="lm-airmet__brief-sub">AI hazard breakdown</span>
      </div>
      {headline ? <div className="lm-airmet__brief-headline">{headline}</div> : null}
      {summary ? <p className="lm-airmet__brief-summary">{summary}</p> : null}
      {hazard_detail ? <BriefRow label="Hazard" value={hazard_detail} /> : null}
      {altitude_note ? <BriefRow label="Altitudes" value={altitude_note} /> : null}
      {operational_impact?.length ? (
        <BriefList label="Operational impact" items={operational_impact} />
      ) : null}
      {safety_tips?.length ? <BriefList label="What to watch" items={safety_tips} /> : null}
    </div>
  );
}

function BriefRow({ label, value }) {
  return (
    <div className="lm-airmet__brief-row">
      <span className="lm-airmet__brief-label">{label}</span>
      <span className="lm-airmet__brief-value">{value}</span>
    </div>
  );
}

function BriefList({ label, items }) {
  return (
    <div className="lm-airmet__brief-block">
      <span className="lm-airmet__brief-label">{label}</span>
      <ul className="lm-airmet__brief-list">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

function Row({ label, value, mono }) {
  return (
    <div className="lm-airmet__row">
      <span className="lm-airmet__row-label">{label}</span>
      <span className={`lm-airmet__row-value${mono ? ' is-mono' : ''}`}>{value}</span>
    </div>
  );
}

export default AirmetPanel;
