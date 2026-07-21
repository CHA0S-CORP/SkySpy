import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../v2/primitives';
import { LockedFeature } from './LockedFeature';
import { withAuth } from '../../lib/authHeader';

/**
 * Split a narrative into sentences for the timeline. Breaks only on a sentence
 * terminator followed by whitespace and a capital/quote/digit, so decimals like
 * "122.1 nm" and abbreviations stay intact.
 */
function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'“])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Callsigns present in a sentence. Prefers exact matches against the real
 * callsigns the station observed (`known`, from the backend) so every genuine
 * callsign is tagged wherever it appears — even shapes the regex would miss.
 * Falls back to (and unions with) an ICAO-callsign regex (3 letters + digits,
 * e.g. SWA4647, ASA763) for any callsign the narrative mentions that isn't in
 * the list. Registrations like N931AK (one leading letter) and type codes like
 * 737NG are excluded by the regex shape.
 */
function extractFlights(sentence, known = []) {
  const text = String(sentence || '');
  const found = new Set();
  for (const cs of known) {
    const c = String(cs || '').trim();
    // Whole-token, case-insensitive match so "skw3479" or a trailing comma still tags.
    if (c && new RegExp(`(?:^|[^A-Za-z0-9])${c}(?![A-Za-z0-9])`, 'i').test(text)) {
      found.add(c);
    }
  }
  for (const m of text.match(/\b[A-Z]{3}\d{1,4}[A-Z]?\b/g) || []) {
    // Skip if already covered by a known callsign (case-insensitive).
    if (![...found].some((f) => f.toUpperCase() === m.toUpperCase())) found.add(m);
  }
  return [...found];
}

/**
 * LLM-generated flight-history narrative for one airframe.
 *
 * Fetches `/api/v1/airframes/{hex}/flight-history/`, which returns a plain-English
 * paragraph grounded in this station's observation record (sessions, sightings,
 * callsigns, ACARS airports). Renders nothing when the backend LLM is disabled or
 * there is no local history to narrate, so it never clutters a sparse detail view.
 *
 * Shared by the v2 airframe DetailScreen and the legacy radar Overview tab; the
 * `variant` prop swaps the outer card chrome to match each host. The prose body
 * uses global `flighthist-*` classes so it looks identical in both. Uses plain
 * fetch (not React Query) so it works in hosts without a QueryClientProvider.
 *
 * @param {object} props
 * @param {string} props.apiBase
 * @param {string} props.hex - ICAO 24-bit hex
 * @param {'v2'|'legacy'} [props.variant]
 * @param {number} [props.refreshKey] - bump to force an append-refresh from the host
 */
export function FlightHistoryCard({ apiBase, hex, variant = 'v2', refreshKey = 0 }) {
  const hexUC = (hex || '').toUpperCase();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!!hex);
  const [error, setError] = useState(false);
  const [locked, setLocked] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!hex) return undefined;
    const ctrl = new AbortController();
    setLoading(true);
    setError(false);
    setLocked(false);
    fetch(`${apiBase}/api/v1/airframes/${hexUC}/flight-history/`, {
      signal: ctrl.signal,
      headers: withAuth(),
    })
      .then((res) => {
        // 401/403 = AI features are gated for this (anonymous) user — show the
        // sign-in gate rather than hiding the card.
        if (res.status === 401 || res.status === 403) {
          if (mounted.current) setLocked(true);
          return null;
        }
        return res.ok ? res.json() : { available: false, summary: null };
      })
      .then((json) => {
        if (json && mounted.current) setData(json);
      })
      .catch((e) => {
        if (e.name !== 'AbortError' && mounted.current) setError(true);
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => ctrl.abort();
  }, [apiBase, hexUC, hex]);

  // Two explicit user actions against the same endpoint:
  //   'refresh'    → "Update from latest": append new activity, keep prior history.
  //                  A no-op server-side when nothing new has been observed.
  //   'regenerate' → "Generate new": rewrite the whole briefing from scratch.
  const runAction = useCallback(
    async (mode) => {
      if (regenerating) return;
      setRegenerating(true);
      try {
        const res = await fetch(
          `${apiBase}/api/v1/airframes/${hexUC}/flight-history/?${mode}=true`,
          {
            headers: withAuth(),
          }
        );
        if (res.ok && mounted.current) setData(await res.json());
      } catch {
        // Network hiccup — leave the existing summary in place.
      } finally {
        if (mounted.current) setRegenerating(false);
      }
    },
    [apiBase, hexUC, regenerating]
  );

  // Host-driven refresh (e.g. the airframe page's refresh button): append-refresh
  // on bump, but skip the initial mount value.
  const firstRefresh = useRef(true);
  useEffect(() => {
    if (firstRefresh.current) {
      firstRefresh.current = false;
      return;
    }
    runAction('refresh');
    // runAction is stable per apiBase/hexUC; only re-run when refreshKey changes.
  }, [refreshKey]);

  // AI gated for anonymous users — render the sign-in gate inside the card chrome.
  if (locked) {
    const badge = (
      <span className="flighthist__ai">
        <Icon name="cpu" size={10} strokeWidth={2} />
        AI
      </span>
    );
    const gate = (
      <LockedFeature
        title="Sign in to unlock the AI flight history"
        subtitle="An AI-written narrative of this airframe's activity, grounded in what this station observed."
        variant={variant === 'legacy' ? 'inline' : 'card'}
      />
    );
    if (variant === 'legacy') {
      return (
        <section className="overview-section flighthist-section" aria-label="Flight history">
          <h3 className="overview-section-title flighthist__head">
            <Icon name="history" size={16} strokeWidth={1.8} className="flighthist__glyph" />
            Flight History
            {badge}
          </h3>
          <div className="flighthist">{gate}</div>
        </section>
      );
    }
    return (
      <div className="v2-det__card">
        <div className="v2-det__card-head">
          <Icon name="history" size={15} strokeWidth={1.7} style={{ color: 'var(--accent2)' }} />
          <span>Flight History</span>
          {badge}
        </div>
        <div className="v2-det__card-body flighthist">{gate}</div>
      </div>
    );
  }

  // LLM disabled/unconfigured, or the fetch errored — stay invisible.
  if (error || (data && data.available === false)) return null;
  // No local observations to summarise and nothing is generating — hide.
  const based = data?.based_on;
  const hasHistory = based ? based.sessions > 0 || based.sightings > 0 : true;
  if (data && !data.summary && !hasHistory && !loading) return null;

  const busy = loading || regenerating;

  const regenBtn = data?.summary ? (
    <span className="flighthist__actions">
      <button
        type="button"
        className={`flighthist__regen ${regenerating ? 'is-spinning' : ''}`}
        onClick={() => runAction('refresh')}
        disabled={busy}
        aria-label="Update from latest (keep history)"
        title="Update from latest — appends new activity, keeps history"
      >
        <Icon name="refresh-cw" size={13} strokeWidth={2} />
      </button>
      <button
        type="button"
        className="flighthist__regen"
        onClick={() => runAction('regenerate')}
        disabled={busy}
        aria-label="Generate new summary from scratch"
        title="Generate new — rewrites the whole briefing"
      >
        <Icon name="zap" size={13} strokeWidth={2} />
      </button>
    </span>
  ) : null;

  const aiBadge = (
    <span className="flighthist__ai">
      <Icon name="cpu" size={10} strokeWidth={2} />
      AI
    </span>
  );

  const inner = busy ? (
    <div className="flighthist__skeleton" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  ) : data?.summary ? (
    <>
      <div className="flighthist__timeline">
        {splitSentences(data.summary).map((sentence, i) => {
          const flights = extractFlights(sentence, data.callsigns || []);
          return (
            <div key={i} className="v2-det__timeline-row">
              <div className="v2-det__timeline-rail">
                <span
                  className="v2-det__timeline-dot"
                  style={{ background: i === 0 ? 'var(--accent2)' : 'var(--dim)' }}
                />
                <span className="v2-det__timeline-line" />
              </div>
              <div className="v2-det__timeline-body">
                <div className="v2-det__timeline-note flighthist__sentence">{sentence}</div>
                {flights.length > 0 && (
                  <div className="flighthist__flights">
                    {flights.map((f) => (
                      <span key={f} className="flighthist__flight">
                        <Icon name="plane" size={10} strokeWidth={2} />
                        {f}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {based && (
        <div className="flighthist__meta">
          <Icon name="activity" size={11} strokeWidth={2} />
          <span>
            Synthesized from {based.sessions.toLocaleString()} tracking session
            {based.sessions === 1 ? '' : 's'} · {based.sightings.toLocaleString()} sighting
            {based.sightings === 1 ? '' : 's'}
            {based.acars_airports > 0 && ` · ${based.acars_airports} ACARS airports`}
          </span>
        </div>
      )}
    </>
  ) : (
    <p className="flighthist__prose flighthist__prose--muted">
      Not enough tracking history yet to summarize this airframe.
    </p>
  );

  if (variant === 'legacy') {
    return (
      <section className="overview-section flighthist-section" aria-label="Flight history">
        <h3 className="overview-section-title flighthist__head">
          <Icon name="history" size={16} strokeWidth={1.8} className="flighthist__glyph" />
          Flight History
          {aiBadge}
          {regenBtn}
        </h3>
        <div className="flighthist">{inner}</div>
      </section>
    );
  }

  return (
    <div className="v2-det__card">
      <div className="v2-det__card-head">
        <Icon name="history" size={15} strokeWidth={1.7} style={{ color: 'var(--accent2)' }} />
        <span>Flight History</span>
        {aiBadge}
        <span className="v2-det__card-aside">{regenBtn || 'AI narrative'}</span>
      </div>
      <div className="v2-det__card-body flighthist">{inner}</div>
    </div>
  );
}

export default FlightHistoryCard;
