import React, { useCallback, useEffect, useState } from 'react';
import { Sparkles, RefreshCw, Info } from 'lucide-react';
import { LockedFeature } from '../shared/LockedFeature';
import { withAuth } from '../../lib/authHeader';

/**
 * AI Analysis card for the Safety Event page. Fetches a plain-English
 * explanation of the event from `GET /safety/events/<id>/ai-summary` (one
 * cached LLM call) and renders it, with a regenerate control. Silently renders
 * nothing when the backend LLM is disabled and there's no summary to show.
 *
 * @param {object} props
 * @param {string|number} props.eventId
 * @param {string} props.apiBase
 * @param {string} [props.accent] severity color for the accent
 */
export function EventAiSummary({ eventId, apiBase, accent = '#00d4ff' }) {
  const [state, setState] = useState({ status: 'idle', summary: null });

  const fetchSummary = useCallback(
    async (signal) => {
      if (!eventId) return;
      setState({ status: 'loading', summary: null });
      try {
        const res = await fetch(`${apiBase}/api/v1/safety/events/${eventId}/ai-summary`, {
          signal,
          headers: withAuth(),
        });
        if (res.status === 401 || res.status === 403) {
          if (!signal?.aborted) setState({ status: 'locked', summary: null });
          return;
        }
        const data = res.ok ? await res.json() : null;
        if (signal?.aborted) return;
        if (data?.summary) setState({ status: 'ready', summary: data.summary });
        else if (data && data.available === false) setState({ status: 'disabled', summary: null });
        else setState({ status: 'empty', summary: null });
      } catch (err) {
        if (signal?.aborted) return;
        setState({ status: 'error', summary: null });
      }
    },
    [eventId, apiBase]
  );

  useEffect(() => {
    const ctrl = new AbortController();
    fetchSummary(ctrl.signal);
    return () => ctrl.abort();
  }, [fetchSummary]);

  // Nothing to show and nothing pending — keep the layout clean.
  if (state.status === 'disabled' || state.status === 'empty' || state.status === 'error') {
    return null;
  }

  // AI gated for anonymous users — offer sign-in instead of hiding.
  if (state.status === 'locked') {
    return (
      <LockedFeature
        variant="card"
        title="Sign in to unlock the AI analysis"
        subtitle="A plain-English explanation of this safety event is available to signed-in users."
      />
    );
  }

  return (
    <div className="sep-ai-card" style={{ '--ai-accent': accent }}>
      <div className="sep-ai-head">
        <span className="sep-ai-icon">
          <Sparkles size={15} />
        </span>
        <div className="sep-ai-titles">
          <div className="sep-ai-eyebrow">AI ANALYSIS</div>
          <div className="sep-ai-sub">Plain-English explanation of this event</div>
        </div>
        <button
          type="button"
          className="sep-ai-regen"
          onClick={() => fetchSummary()}
          disabled={state.status === 'loading'}
          title="Regenerate"
        >
          <RefreshCw size={13} className={state.status === 'loading' ? 'sep-ai-spin' : ''} />
          {state.status === 'loading' ? 'Analyzing…' : 'Regenerate'}
        </button>
      </div>
      {state.status === 'loading' ? (
        <div className="sep-ai-skel">
          <span />
          <span />
          <span />
        </div>
      ) : (
        <p className="sep-ai-text">{state.summary}</p>
      )}
      <div className="sep-ai-disclaimer">
        <Info size={11} />
        AI-generated from the event data · an observation, not an official incident ruling.
      </div>
    </div>
  );
}

export default EventAiSummary;
