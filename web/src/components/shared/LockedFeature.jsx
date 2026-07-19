import React from 'react';
import { Icon } from '../v2/primitives';
import { navigate } from '../../lib/hashRoute';

/**
 * "Sign in to unlock" gate for AI/LLM features that are blocked for anonymous
 * users on a public deployment (backend returns 401/403 from CanUseLLM). Renders
 * a blurred, redacted preview of the feature behind a frosted-glass panel with a
 * lock and a sign-in CTA — so the feature is visibly *present* but access-gated,
 * rather than silently missing.
 *
 * Drive `locked` off the actual API response (a 401/403), which is the source of
 * truth and correctly accounts for auth mode, permissions, superusers and dev mode.
 *
 * @param {object} props
 * @param {string} [props.eyebrow] - small mono label (default "AUTH REQUIRED")
 * @param {string} props.title - headline, e.g. "Sign in to unlock AI analysis"
 * @param {string} [props.subtitle]
 * @param {'card'|'inline'} [props.variant] - chrome density (default 'card')
 * @param {React.ReactNode} [props.preview] - blurred faux-content shown behind the gate
 * @param {string} [props.className] - extra class on the root (e.g. `lockfx--fill`
 *   to stretch the gate over its whole container)
 */
export function LockedFeature({
  eyebrow = 'AUTH REQUIRED',
  title,
  subtitle = 'AI insights are available to signed-in users.',
  variant = 'card',
  preview,
  className = '',
}) {
  return (
    <div
      className={`lockfx lockfx--${variant}${className ? ` ${className}` : ''}`}
      role="group"
      aria-label={title}
    >
      <div className="lockfx__preview" aria-hidden="true">
        {preview || <RedactedLines />}
      </div>

      <div className="lockfx__scrim" aria-hidden="true" />

      <div className="lockfx__panel">
        <div className="lockfx__badge">
          <Icon name="lock" size={16} strokeWidth={2} />
        </div>
        <div className="lockfx__eyebrow">{eyebrow}</div>
        <div className="lockfx__title">{title}</div>
        {subtitle && <div className="lockfx__sub">{subtitle}</div>}
        <button type="button" className="lockfx__btn" onClick={() => navigate('login')}>
          <Icon name="log-in" size={14} strokeWidth={2} />
          Sign in to unlock
        </button>
      </div>
    </div>
  );
}

/** Blurred, redacted placeholder lines — the "there's something here" tease. */
function RedactedLines() {
  return (
    <div className="lockfx__redact">
      <span style={{ width: '92%' }} />
      <span style={{ width: '78%' }} />
      <span style={{ width: '85%' }} />
      <span style={{ width: '61%' }} />
    </div>
  );
}

export default LockedFeature;
