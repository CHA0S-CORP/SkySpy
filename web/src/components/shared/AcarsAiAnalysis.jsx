import React, { useState } from 'react';
import { Icon } from '../v2/primitives';
import { LockedFeature } from './LockedFeature';
import { withAuth } from '../../lib/authHeader';
import { TURB_SEVERITY } from '../../hooks/useTurbulenceOverlay';

/**
 * Opt-in structured LLM analysis of a single ACARS message, rendered as an
 * accordion. The header is a toggle; clicking it fetches
 * `GET /acars/{id}/ai-analysis` on first open and expands to show the decoded
 * headline, message-type badges, fielded key/values, referenced airports, and
 * caveat notes. Self-contained (plain fetch) so it works in any host.
 *
 * @param {object} props
 * @param {string} props.apiBase
 * @param {number|string} props.id - AcarsMessage id
 */
export function AcarsAiAnalysis({ apiBase, id }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error | unavailable | locked
  const [data, setData] = useState(null);
  const [errMsg, setErrMsg] = useState('');

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || status !== 'idle' || id == null) return;

    setStatus('loading');
    try {
      const res = await fetch(`${apiBase}/api/v1/acars/${id}/ai-analysis`, { headers: withAuth() });
      // 401/403 = AI is gated for this (anonymous) user — offer sign-in.
      if (res.status === 401 || res.status === 403) {
        setStatus('locked');
        return;
      }
      const json = res.ok ? await res.json() : null;
      if (json && json.available === false) {
        setStatus('unavailable');
      } else if (json && json.analysis) {
        setData(json.analysis);
        setStatus('ready');
      } else {
        setErrMsg('No analysis could be decoded for this message');
        setStatus('error');
      }
    } catch {
      setErrMsg('Analysis request failed');
      setStatus('error');
    }
  };

  return (
    <div className={`acars-ai ${open ? 'is-open' : ''}`}>
      <button type="button" className="acars-ai__toggle" onClick={toggle} aria-expanded={open}>
        <Icon name="zap" size={12} strokeWidth={2} className="acars-ai__spark" />
        <span>AI Analysis</span>
        <Icon name="chevron-down" size={14} strokeWidth={2} className="acars-ai__chev" />
      </button>

      {open && (
        <div className="acars-ai__panel">
          {status === 'loading' && (
            <div className="acars-ai__loading" aria-label="Analyzing">
              <span />
              <span />
              <span />
            </div>
          )}
          {status === 'unavailable' && (
            <div className="acars-ai__msg">AI analysis is disabled on this server</div>
          )}
          {status === 'locked' && (
            <LockedFeature
              variant="inline"
              title="Sign in to unlock AI analysis"
              subtitle="Structured, plain-English decoding of this ACARS message is available to signed-in users."
            />
          )}
          {status === 'error' && <div className="acars-ai__msg">{errMsg}</div>}
          {status === 'ready' && data && <AnalysisBody a={data} />}
        </div>
      )}
    </div>
  );
}

function AnalysisBody({ a }) {
  const mt = a.message_type || {};
  return (
    <div className="acars-ai__body">
      {a.headline && <div className="acars-ai__headline">{a.headline}</div>}

      {(mt.code || mt.name || mt.direction || a.aircraft) && (
        <div className="acars-ai__tags">
          {a.aircraft && (
            <span className="acars-ai__tag acars-ai__tag--ac">
              <Icon name="plane" size={10} strokeWidth={2} />
              {a.aircraft}
            </span>
          )}
          {mt.code && <span className="acars-ai__tag">Label {mt.code}</span>}
          {mt.name && <span className="acars-ai__tag acars-ai__tag--name">{mt.name}</span>}
          {mt.direction && <span className="acars-ai__tag">{mt.direction}</span>}
        </div>
      )}

      {a.summary && <p className="acars-ai__summary">{a.summary}</p>}

      {a.turbulence?.level && a.turbulence.level !== 'none' && <TurbulenceRow t={a.turbulence} />}

      {a.fields?.length > 0 && (
        <dl className="acars-ai__fields">
          {a.fields.map((f, i) => (
            <div key={i} className="acars-ai__field">
              <dt className="acars-ai__field-label">{f.label}</dt>
              <dd className="acars-ai__field-value">
                {f.value}
                {f.note && <span className="acars-ai__field-note">{f.note}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {a.airports?.length > 0 && (
        <div className="acars-ai__airports">
          {a.airports.map((ap, i) => (
            <span
              key={i}
              className={`acars-ai__apt ${ap.note ? 'acars-ai__apt--warn' : ''}`}
              title={ap.note || undefined}
            >
              <Icon name="map-pin" size={10} strokeWidth={2} />
              {ap.code}
              {ap.note && <em className="acars-ai__apt-flag">?</em>}
            </span>
          ))}
        </div>
      )}

      {a.notes?.length > 0 && (
        <ul className="acars-ai__notes">
          {a.notes.map((n, i) => (
            <li key={i}>
              <Icon name="info" size={11} strokeWidth={2} />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Area-turbulence badge for an ACARS position report: the synthesized rough-air
 * risk (G-AIRMET + PIREPs + winds-aloft shear) at the message's position. Distinct
 * from the per-aircraft live turbulence badge on the map. Reuses TURB_SEVERITY.
 */
function TurbulenceRow({ t }) {
  const sev = TURB_SEVERITY[t.level] || TURB_SEVERITY.default;
  return (
    <div
      className={`acars-ai__turb acars-ai__turb--${t.level}`}
      style={{ backgroundColor: sev.color, borderColor: sev.stroke }}
      title={`Area turbulence risk at this report's position: ${sev.label}${
        t.score != null ? ` (${t.score}/100)` : ''
      }`}
    >
      <Icon name="alert-triangle" size={11} strokeWidth={2} />
      <span>
        Area turbulence: {sev.label}
        {t.score != null ? ` · ${t.score}` : ''}
      </span>
    </div>
  );
}

export default AcarsAiAnalysis;
