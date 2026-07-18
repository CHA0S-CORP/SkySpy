import React, { useMemo } from 'react';

/**
 * Rich "breakdown" display blocks for assistant answers. Like AssistantChart,
 * these ride inside the markdown as fenced code blocks the model authors — the
 * content is the model's own synthesis of tool data, so a fenced block (not a
 * server tool) is the right home. Every field is tolerant / best-effort: a
 * malformed spec renders null rather than throwing mid-stream.
 *
 * Languages handled here (dispatched from AssistantMarkdown):
 *   ```stats     — KPI card grid: { title?, cards:[{label,value,delta?,sub?,tone?}] }
 *   ```timeline  — vertical event list: { title?, events:[{time?,title,desc?,tone?}] }
 *   ```compare   — side-by-side table: { title?, attributes:[...], items:[{name,values:[...]}] }
 *   ```callout   — highlighted box + optional steps: { tone?, title?, body?, steps?:[...] }
 */

const TONES = {
  ok: 'var(--accent)',
  good: 'var(--accent)',
  success: 'var(--accent)',
  info: 'var(--accent2)',
  warn: 'var(--warn)',
  warning: 'var(--warn)',
  danger: 'var(--danger)',
  critical: 'var(--danger)',
  error: 'var(--danger)',
  mil: 'var(--mil)',
};

/** Map a tone name to a CSS color, defaulting to the primary text color. */
const toneColor = (tone, fallback = 'var(--txt)') =>
  (tone && TONES[String(tone).toLowerCase()]) || fallback;

const fmtValue = (v) => {
  if (typeof v !== 'number' || !isFinite(v)) return String(v ?? '');
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${(v / 1e3).toFixed(1)}k`;
  return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(1);
};

const asRows = (value) =>
  Array.isArray(value) ? value.filter((r) => r && typeof r === 'object') : [];

// ---------------------------------------------------------------------------

function StatsBlock({ spec }) {
  const cards = asRows(spec.cards || spec.data);
  if (!cards.length) return null;
  return (
    <figure className="v2-asst-disp v2-asst-stats">
      {spec.title ? <figcaption className="v2-asst-disp__title">{spec.title}</figcaption> : null}
      <div className="v2-asst-stats__grid">
        {cards.map((c, i) => {
          const delta = typeof c.delta === 'number' && isFinite(c.delta) ? c.delta : null;
          const up = delta != null && delta >= 0;
          return (
            <div key={i} className="v2-asst-stats__card">
              <div className="v2-asst-stats__value" style={{ color: toneColor(c.tone) }}>
                {fmtValue(c.value)}
              </div>
              <div className="v2-asst-stats__label">{String(c.label ?? '')}</div>
              {c.sub ? <div className="v2-asst-stats__sub">{String(c.sub)}</div> : null}
              {delta != null ? (
                <div
                  className="v2-asst-stats__delta"
                  style={{ color: up ? 'var(--accent)' : 'var(--danger)' }}
                >
                  {up ? '▲' : '▼'} {Math.abs(delta)}%
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </figure>
  );
}

function TimelineBlock({ spec }) {
  const events = asRows(spec.events || spec.data);
  if (!events.length) return null;
  return (
    <figure className="v2-asst-disp v2-asst-tl">
      {spec.title ? <figcaption className="v2-asst-disp__title">{spec.title}</figcaption> : null}
      <ol className="v2-asst-tl__list">
        {events.map((e, i) => {
          const color = toneColor(e.tone, 'var(--accent2)');
          return (
            <li key={i} className="v2-asst-tl__item">
              <span className="v2-asst-tl__dot" style={{ background: color }} />
              <div className="v2-asst-tl__body">
                <div className="v2-asst-tl__head">
                  {e.time ? <span className="v2-asst-tl__time">{String(e.time)}</span> : null}
                  <span className="v2-asst-tl__title" style={{ color }}>
                    {String(e.title ?? e.label ?? '')}
                  </span>
                </div>
                {e.desc ? <div className="v2-asst-tl__desc">{String(e.desc)}</div> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

function CompareBlock({ spec }) {
  const items = asRows(spec.items || spec.data);
  const attributes = Array.isArray(spec.attributes) ? spec.attributes.map(String) : [];
  if (!items.length || !attributes.length) return null;
  return (
    <figure className="v2-asst-disp v2-asst-cmp">
      {spec.title ? <figcaption className="v2-asst-disp__title">{spec.title}</figcaption> : null}
      <div className="v2-asst-cmp__scroll">
        <table className="v2-asst-cmp__table">
          <thead>
            <tr>
              <th />
              {items.map((it, i) => (
                <th key={i} className="v2-asst-cmp__name">
                  {String(it.name ?? it.label ?? `#${i + 1}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {attributes.map((attr, ri) => (
              <tr key={ri}>
                <th className="v2-asst-cmp__attr" scope="row">
                  {attr}
                </th>
                {items.map((it, ci) => {
                  const vals = Array.isArray(it.values) ? it.values : [];
                  const raw = vals[ri] ?? (it[attr] != null ? it[attr] : '');
                  return (
                    <td key={ci} className="v2-asst-cmp__cell">
                      {typeof raw === 'number' ? fmtValue(raw) : String(raw)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function CalloutBlock({ spec }) {
  const color = toneColor(spec.tone, 'var(--accent2)');
  const steps = Array.isArray(spec.steps) ? spec.steps.filter((s) => s != null) : [];
  const body = spec.body ?? spec.text;
  if (!spec.title && !body && !steps.length) return null;
  return (
    <div
      className="v2-asst-disp v2-asst-callout"
      style={{ borderColor: color, background: `color-mix(in srgb, ${color} 10%, transparent)` }}
    >
      {spec.title ? (
        <div className="v2-asst-callout__title" style={{ color }}>
          {String(spec.title)}
        </div>
      ) : null}
      {body ? <div className="v2-asst-callout__body">{String(body)}</div> : null}
      {steps.length ? (
        <ol className="v2-asst-callout__steps">
          {steps.map((s, i) => (
            <li key={i}>{typeof s === 'object' ? String(s.text ?? s.title ?? '') : String(s)}</li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

const RENDERERS = {
  stats: StatsBlock,
  timeline: TimelineBlock,
  compare: CompareBlock,
  callout: CalloutBlock,
};

export const DISPLAY_LANGS = Object.keys(RENDERERS);

export function AssistantDisplay({ lang, spec }) {
  const safe = useMemo(() => (spec && typeof spec === 'object' ? spec : null), [spec]);
  const Renderer = RENDERERS[lang];
  if (!Renderer || !safe) return null;
  return <Renderer spec={safe} />;
}

export default AssistantDisplay;
