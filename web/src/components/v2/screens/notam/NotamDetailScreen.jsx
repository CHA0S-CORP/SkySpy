import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../primitives';
import { useNotamDetail } from './useNotamDetail';
import {
  NOTAM_CATS,
  classifyNotam,
  effectiveWindow,
  fmtAlt,
  notamShortId,
} from '../history/notamModel';

function utcField(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getUTCDate()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}Z`;
}

function scheduleProgress(record) {
  const start = record.effective_start ? new Date(record.effective_start).getTime() : null;
  const end = record.effective_end ? new Date(record.effective_end).getTime() : null;
  if (!start || !end || end <= start) return null;
  const now = Date.now();
  const pct = Math.max(0, Math.min(100, ((now - start) / (end - start)) * 100));
  const remMs = end - now;
  let remaining = null;
  if (remMs > 0) {
    const h = Math.floor(remMs / 3600000);
    const m = Math.floor((remMs % 3600000) / 60000);
    remaining = h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
  return { pct, remaining, start, end };
}

function Section({ icon, iconColor, title, right, children }) {
  return (
    <div className="v2-ntm__card">
      <div className="v2-ntm__card-head">
        <Icon name={icon} size={15} strokeWidth={1.7} style={{ color: iconColor }} />
        <span className="v2-ntm__card-title">{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

/** Top-down radar of the affected airspace (outer TFR ring + inner core). */
function AffectedAirspace({ record, color, refLabel }) {
  const hasInner = record.radius_nm != null;
  return (
    <svg viewBox="0 0 100 100" className="v2-ntm__radar" preserveAspectRatio="xMidYMid meet">
      <defs>
        <pattern id="ntm-grid" width="11" height="11" patternUnits="userSpaceOnUse">
          <path d="M11 0H0V11" fill="none" stroke="var(--bord)" strokeWidth=".3" />
        </pattern>
        <radialGradient id="ntm-fill" cx="50%" cy="50%" r="50%">
          <stop offset="60%" stopColor={color} stopOpacity="0" />
          <stop offset="100%" stopColor={color} stopOpacity=".16" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="100" height="100" fill="url(#ntm-grid)" opacity=".5" />
      <circle
        cx="50"
        cy="50"
        r="14"
        fill="none"
        stroke="color-mix(in srgb, var(--accent) 16%, transparent)"
        strokeWidth=".4"
        strokeDasharray="1.4 1.6"
      />
      <circle
        cx="50"
        cy="50"
        r="28"
        fill="none"
        stroke="color-mix(in srgb, var(--accent) 12%, transparent)"
        strokeWidth=".4"
        strokeDasharray="1.4 1.6"
      />
      <circle cx="50" cy="50" r="42" fill="url(#ntm-fill)" />
      <circle
        cx="50"
        cy="50"
        r="42"
        fill={`color-mix(in srgb, ${color} 5%, transparent)`}
        stroke={color}
        strokeWidth=".7"
      />
      {hasInner && (
        <circle
          cx="50"
          cy="50"
          r="16"
          fill={`color-mix(in srgb, ${color} 16%, transparent)`}
          stroke={color}
          strokeWidth=".7"
          strokeDasharray="2 1.6"
        />
      )}
      <circle
        className="v2-ntm__radar-ping"
        cx="50"
        cy="50"
        r="4"
        fill="none"
        stroke="var(--accent2)"
        strokeWidth=".6"
      />
      <path d="M50 47.4 L52.4 52 47.6 52 Z" fill="var(--accent2)" />
      <circle cx="50" cy="50" r="1.3" fill="var(--accent2)" />
      <text
        x="50"
        y="59"
        fill="var(--accent2)"
        fontSize="3.2"
        fontWeight="700"
        textAnchor="middle"
        fontFamily="IBM Plex Mono"
      >
        {refLabel}
      </text>
      {record.radius_nm != null && (
        <text
          x="50"
          y="10.5"
          fill={color}
          fontSize="3"
          fontWeight="600"
          textAnchor="middle"
          fontFamily="IBM Plex Mono"
        >
          {Math.round(record.radius_nm)} NM
        </text>
      )}
    </svg>
  );
}

/**
 * NOTAM detail page (handoff §4 / NOTAM.dc.html): AI briefing centerpiece,
 * decoded fields, raw text, affected-airspace radar, vertical-limits band, and
 * an active-schedule timeline. Reached from the History → NOTAMs archive cards
 * via `#notam?id=<notam_id>`.
 *
 * @param {object} props
 * @param {string} props.notamId
 * @param {string} props.apiBase
 * @param {() => void} props.onClose
 */
export function NotamDetailScreen({ notamId, apiBase, onClose }) {
  const { record: recordQ, brief: briefQ } = useNotamDetail(apiBase, notamId);
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const record = recordQ.data;
  const brief = briefQ.data;

  const cat = useMemo(() => (record ? classifyNotam(record) : 'hazards'), [record]);
  const meta = NOTAM_CATS[cat];

  const fields = useMemo(() => {
    if (!record) return [];
    const ref = record.decoded?.reference || record.decoded?.ref_point || record.location;
    return [
      { k: 'LOCATION', v: record.location || '—' },
      {
        k: 'TYPE',
        v: `${record.notam_type || 'NOTAM'}${record.is_tfr ? ' · TFR' : ''}`,
        color: meta.color,
      },
      { k: 'CLASS', v: record.classification || '—' },
      { k: 'CEILING', v: fmtAlt(record.ceiling_ft) },
      { k: 'FLOOR', v: fmtAlt(record.floor_ft, { surface: true }) },
      { k: 'RADIUS', v: record.radius_nm != null ? `${Math.round(record.radius_nm)} NM` : '—' },
      { k: 'REFERENCE', v: ref || '—' },
      { k: 'EFFECTIVE', v: utcField(record.effective_start), color: 'var(--accent)' },
      {
        k: 'EXPIRES',
        v: record.is_permanent ? 'PERM' : utcField(record.effective_end),
        color: 'var(--danger)',
      },
    ];
  }, [record, meta.color]);

  const raw = record?.raw_text || record?.text || '';
  const sched = record ? scheduleProgress(record) : null;
  const refLabel = (record?.decoded?.reference || record?.location || 'REF').toString().slice(0, 5);

  const copyRaw = () => {
    try {
      navigator.clipboard?.writeText(raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const regenerate = () => {
    queryClient.invalidateQueries({ queryKey: ['v2-notam-brief', apiBase, notamId] });
  };

  if (recordQ.isLoading) {
    return (
      <div className="v2-ntm v2-ntm--center">
        <Icon name="file" size={48} strokeWidth={1.3} style={{ color: 'var(--dim2)' }} />
        <div className="v2-ntm__loading">Loading NOTAM {notamId}…</div>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="v2-ntm v2-ntm--center">
        <Icon name="alert-triangle" size={44} strokeWidth={1.4} style={{ color: 'var(--warn)' }} />
        <div className="v2-ntm__loading">NOTAM {notamId} not found</div>
        <button type="button" className="v2-ntm__btn" onClick={onClose}>
          <Icon name="arrow-left" size={15} strokeWidth={1.8} /> Back
        </button>
      </div>
    );
  }

  const active = record.is_active !== false;

  return (
    <div className="v2-ntm" data-testid="v2-notam-detail">
      {/* title bar */}
      <div className="v2-ntm__titlebar">
        <button type="button" className="v2-ntm__back" onClick={onClose} aria-label="Back">
          <Icon name="arrow-left" size={17} strokeWidth={1.8} />
        </button>
        <span className="v2-ntm__id">{notamShortId(record)}</span>
        <span className="v2-ntm__type-badge">{record.notam_type || 'NOTAM'}</span>
        <span
          className="v2-ntm__cat-chip"
          style={{
            color: meta.color,
            background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
            borderColor: `color-mix(in srgb, ${meta.color} 40%, transparent)`,
          }}
        >
          <Icon name={meta.icon} size={13} strokeWidth={1.9} />
          {meta.name}
        </span>
        {record.is_tfr && (
          <span className={`v2-ntm__tfr ${active ? 'v2-ntm__tfr--on' : ''}`}>
            <span className="v2-ntm__tfr-dot" />
            TFR · {active ? 'ACTIVE' : 'INACTIVE'}
          </span>
        )}
        <div className="v2-ntm__spacer" />
        <span className="v2-ntm__window">
          <Icon name="calendar" size={13} strokeWidth={1.6} />
          {effectiveWindow(record)}
        </span>
      </div>

      <div className="v2-ntm__grid">
        {/* LEFT */}
        <div className="v2-ntm__col">
          {/* AI BRIEFING */}
          <div className="v2-ntm__brief">
            <div className="v2-ntm__brief-head">
              <span className="v2-ntm__brief-spark">
                <Icon name="zap" size={15} strokeWidth={1.8} style={{ color: 'var(--accent2)' }} />
              </span>
              <div className="v2-ntm__brief-titles">
                <div className="v2-ntm__brief-eyebrow">AI BRIEFING</div>
                <div className="v2-ntm__brief-sub">
                  Plain-language interpretation of the raw NOTAM
                </div>
              </div>
              <button
                type="button"
                className="v2-ntm__regen"
                onClick={regenerate}
                disabled={briefQ.isFetching}
              >
                <Icon name="refresh" size={12} strokeWidth={1.8} />
                {briefQ.isFetching ? 'Regenerating…' : 'Regenerate'}
              </button>
            </div>
            <div className="v2-ntm__brief-body">
              {briefQ.isLoading ? (
                <div className="v2-ntm__brief-skel">
                  <span />
                  <span />
                  <span />
                </div>
              ) : brief && (brief.headline || brief.summary) ? (
                <>
                  {brief.headline && <div className="v2-ntm__headline">{brief.headline}</div>}
                  {brief.summary && <p className="v2-ntm__summary">{brief.summary}</p>}
                  {(brief.restrictions?.length || brief.implications?.length) > 0 && (
                    <div className="v2-ntm__brief-cols">
                      {brief.restrictions?.length > 0 && (
                        <div className="v2-ntm__brief-col v2-ntm__brief-col--danger">
                          <div className="v2-ntm__brief-col-head">
                            <Icon
                              name="alert-circle"
                              size={13}
                              strokeWidth={2}
                              style={{ color: 'var(--danger)' }}
                            />
                            KEY RESTRICTIONS
                          </div>
                          <ul>
                            {brief.restrictions.map((r, i) => (
                              <li key={i}>
                                <span style={{ color: 'var(--danger)' }}>▸</span>
                                {r}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {brief.implications?.length > 0 && (
                        <div className="v2-ntm__brief-col v2-ntm__brief-col--accent">
                          <div className="v2-ntm__brief-col-head">
                            <Icon
                              name="check"
                              size={13}
                              strokeWidth={2}
                              style={{ color: 'var(--accent)' }}
                            />
                            WHAT THIS MEANS FOR YOU
                          </div>
                          <ul>
                            {brief.implications.map((r, i) => (
                              <li key={i}>
                                <span style={{ color: 'var(--accent)' }}>▸</span>
                                {r}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <p className="v2-ntm__summary">
                  {record.human_summary ||
                    'AI briefing unavailable. Read the decoded fields and raw NOTAM below.'}
                </p>
              )}
              <div className="v2-ntm__disclaimer">
                <Icon name="info" size={12} strokeWidth={1.6} />
                AI-generated from the raw NOTAM text · always verify against the official FAA source
                before flight.
              </div>
            </div>
          </div>

          {/* DECODED FIELDS */}
          <Section icon="columns" iconColor="var(--accent2)" title="DECODED FIELDS">
            <div className="v2-ntm__fields">
              {fields.map((f) => (
                <div key={f.k} className="v2-ntm__field">
                  <div className="v2-ntm__field-k">{f.k}</div>
                  <div className="v2-ntm__field-v" style={f.color ? { color: f.color } : undefined}>
                    {f.v}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* RAW */}
          <Section
            icon="file"
            iconColor="var(--dim)"
            title="RAW NOTAM"
            right={
              <button type="button" className="v2-ntm__copy" onClick={copyRaw}>
                <Icon name="copy" size={12} strokeWidth={1.7} />
                {copied ? 'Copied' : 'Copy'}
              </button>
            }
          >
            <pre className="v2-ntm__raw">{raw || '— no raw text —'}</pre>
          </Section>
        </div>

        {/* RIGHT */}
        <div className="v2-ntm__col">
          <Section
            icon="target"
            iconColor="var(--accent2)"
            title="AFFECTED AIRSPACE"
            right={
              record.latitude != null && record.longitude != null ? (
                <span className="v2-ntm__coords">
                  {record.latitude.toFixed(2)}, {record.longitude.toFixed(2)}
                </span>
              ) : null
            }
          >
            <div className="v2-ntm__radar-wrap">
              <AffectedAirspace record={record} color={meta.color} refLabel={refLabel} />
            </div>
          </Section>

          <Section icon="arrow-up" iconColor="var(--accent)" title="VERTICAL LIMITS">
            <div className="v2-ntm__vlimits">
              <div className="v2-ntm__vbar">
                <div className="v2-ntm__vbar-fill" />
                <span className="v2-ntm__vbar-top">{fmtAlt(record.ceiling_ft)}</span>
                <span className="v2-ntm__vbar-bot">
                  {fmtAlt(record.floor_ft, { surface: true })}
                </span>
              </div>
              <div className="v2-ntm__vmeta">
                <div>
                  <div className="v2-ntm__vmeta-k">CEILING</div>
                  <div className="v2-ntm__vmeta-v">
                    {fmtAlt(record.ceiling_ft)}
                    <span> {record.ceiling_ft >= 18000 ? '' : 'ft MSL'}</span>
                  </div>
                </div>
                <div>
                  <div className="v2-ntm__vmeta-k">FLOOR</div>
                  <div className="v2-ntm__vmeta-v">
                    {fmtAlt(record.floor_ft, { surface: true })}
                  </div>
                </div>
              </div>
            </div>
          </Section>

          {sched && (
            <Section icon="clock" iconColor="var(--warn)" title="SCHEDULE">
              <div className="v2-ntm__sched-labels">
                <span>{utcField(record.effective_start)}</span>
                <span>{utcField(record.effective_end)}</span>
              </div>
              <div className="v2-ntm__sched-track">
                <div className="v2-ntm__sched-fill" style={{ width: `${sched.pct}%` }} />
                <div className="v2-ntm__sched-now" style={{ left: `${sched.pct}%` }} />
              </div>
              <div className="v2-ntm__sched-foot">
                <span>
                  Now ·{' '}
                  <b style={{ color: active ? 'var(--txt)' : 'var(--dim)' }}>
                    {active ? 'active' : 'pending'}
                  </b>
                </span>
                {sched.remaining && (
                  <span>
                    Expires in <b style={{ color: 'var(--warn)' }}>{sched.remaining}</b>
                  </span>
                )}
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
