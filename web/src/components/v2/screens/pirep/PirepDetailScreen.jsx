import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../primitives';
import { PirepMap } from '../history/PirepMap';
import { usePirepDetail } from './usePirepDetail';
import { TURB_SEVERITY } from '../../../../hooks/useTurbulenceOverlay';
import {
  PIREP_GROUPS,
  adjacentPireps,
  classifyPirep,
  cleanSummary,
  decodeFields,
  derivePirep,
  isUrgent,
  localHeadline,
  nearbyAircraft,
  pirepCoord,
} from '../history/pirepsModel';

const SEV_LABEL = {
  routine: 'Routine',
  caution: 'Caution',
  hazardous: 'Hazardous',
  severe: 'Severe',
};
const CLOSEST_MAX_MI = 50; // statute miles
const CLOSEST_MAX_ROWS = 10;
const MI_PER_NM = 1.15078;
const CLOSEST_MAX_NM = CLOSEST_MAX_MI / MI_PER_NM;
const ADJACENT_RADIUS_NM = 200;

/** PIREP reported altitude in feet MSL (flight level ×100, else altitude_ft). */
function pirepAltitudeFt(record) {
  if (record?.flight_level != null) return Number(record.flight_level) * 100;
  if (record?.altitude_ft != null) return Number(record.altitude_ft);
  return null;
}

function fmtWindow(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Full PIREP detail page (NOTAM-detail sibling). Left column: AI briefing +
 * decoded hazard grid + raw report. Right column: a live mini-map of the report
 * location with surrounding traffic, the closest aircraft, and adjacent pilot
 * reports. Routed at `#pirep?id=<pirep_id>`; data comes from usePirepDetail
 * (existing pireps list + summary + live /aircraft — no new endpoints).
 *
 * @param {object} props
 * @param {string} props.pirepId
 * @param {string} props.apiBase
 * @param {() => void} props.onClose
 * @param {(hex: string) => void} [props.onSelectAircraft]
 * @param {(pirepId: string) => void} [props.onViewPirep]
 */
export function PirepDetailScreen({ pirepId, apiBase, onClose, onSelectAircraft, onViewPirep }) {
  const { listQ, list, record, summaryQ, aircraftQ } = usePirepDetail(apiBase, pirepId);
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const derived = useMemo(() => (record ? derivePirep(record) : null), [record]);
  const coord = useMemo(() => (record ? pirepCoord(record) : null), [record]);
  const group = useMemo(
    () => (record && derived ? classifyPirep(record, derived).group : 'routine'),
    [record, derived]
  );
  const meta = PIREP_GROUPS[group];

  const fields = useMemo(() => (derived ? decodeFields(derived) : []), [derived]);
  const headline = useMemo(() => (derived ? localHeadline(derived) : ''), [derived]);

  // Closest live traffic: within 50 statute miles, at most 10 rows, each tagged
  // with its distance in miles and altitude delta vs the PIREP's reported level.
  const pirepAltFt = useMemo(() => pirepAltitudeFt(record), [record]);
  const nearby = useMemo(() => {
    if (!coord) return [];
    return nearbyAircraft(aircraftQ.data, coord.lat, coord.lon, CLOSEST_MAX_NM)
      .slice(0, CLOSEST_MAX_ROWS)
      .map((a) => ({
        ...a,
        mi: a.nm * MI_PER_NM,
        dAlt: a.alt != null && pirepAltFt != null ? a.alt - pirepAltFt : null,
      }));
  }, [aircraftQ.data, coord, pirepAltFt]);
  const adjacent = useMemo(
    () => (record ? adjacentPireps(list, record, ADJACENT_RADIUS_NM) : []),
    [list, record]
  );

  const raw = record?.raw_text || record?.text || '';
  const summary = summaryQ.data;
  const blurb = cleanSummary(summary?.summary);
  const sev = (summary?.severity || record?.severity || '').toLowerCase();
  const hazards = Array.isArray(summary?.hazards) ? summary.hazards : [];
  const isLlm = summary?.source === 'llm';
  // Synthesized area turbulence (G-AIRMET + nearby PIREPs + shear) at this
  // report's position — corroborates the single report against the wider picture.
  const areaTurb =
    summary?.area_turbulence && summary.area_turbulence.level !== 'none'
      ? summary.area_turbulence
      : null;

  const copyRaw = () => {
    try {
      navigator.clipboard?.writeText(raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  const regenerate = () =>
    queryClient.invalidateQueries({ queryKey: ['v2-pirep-summary', apiBase, pirepId] });

  if (listQ.isLoading && !record) {
    return (
      <div className="v2-pird v2-pird--center">
        <Icon name="message" size={48} strokeWidth={1.3} style={{ color: 'var(--dim2)' }} />
        <div className="v2-pird__loading">Loading pilot report…</div>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="v2-pird v2-pird--center">
        <Icon name="alert-triangle" size={44} strokeWidth={1.4} style={{ color: 'var(--warn)' }} />
        <div className="v2-pird__loading">Pilot report not found</div>
        <button type="button" className="v2-pird__btn" onClick={onClose}>
          <Icon
            name="chevron-right"
            size={15}
            strokeWidth={1.8}
            style={{ transform: 'rotate(180deg)' }}
          />{' '}
          Back
        </button>
      </div>
    );
  }

  const urgent = isUrgent(derived);

  return (
    <div className="v2-pird" data-testid="v2-pirep-detail">
      {/* title bar */}
      <div className="v2-pird__titlebar">
        <button type="button" className="v2-pird__back" onClick={onClose} aria-label="Back">
          <Icon
            name="chevron-right"
            size={17}
            strokeWidth={1.8}
            style={{ transform: 'rotate(180deg)' }}
          />
        </button>
        <span className="v2-pird__id">{derived.station}</span>
        <span
          className="v2-pird__cat-chip"
          style={{
            color: meta.color,
            background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
            borderColor: `color-mix(in srgb, ${meta.color} 40%, transparent)`,
          }}
        >
          <Icon
            name={group === 'icing' ? 'thermometer' : group === 'turbulence' ? 'wave' : 'message'}
            size={13}
            strokeWidth={1.9}
          />
          {meta.name}
        </span>
        {urgent ? (
          <span className="v2-pird__urgent">
            <span className="v2-pird__urgent-dot" />
            URGENT · UUA
          </span>
        ) : (
          <span className="v2-pird__rtype">ROUTINE</span>
        )}
        {sev && sev !== 'routine' && (
          <span className={`v2-pird__sev v2-pird__sev--${sev}`}>{SEV_LABEL[sev] || sev}</span>
        )}
        <div className="v2-pird__spacer" />
        <span className="v2-pird__window">
          <Icon name="calendar" size={13} strokeWidth={1.6} />
          {fmtWindow(record.observation_time)}
        </span>
      </div>

      <div className="v2-pird__grid">
        {/* LEFT */}
        <div className="v2-pird__col">
          {/* AI BRIEFING */}
          <div className="v2-pird__brief" style={{ '--accent-c': meta.color }}>
            <div className="v2-pird__brief-head">
              <span className="v2-pird__brief-spark">
                <Icon name="zap" size={15} strokeWidth={1.8} style={{ color: 'var(--accent2)' }} />
              </span>
              <div className="v2-pird__brief-titles">
                <div className="v2-pird__brief-eyebrow">AI ANALYSIS · DECODE</div>
                <div className="v2-pird__brief-sub">
                  Plain-language reading of the raw pilot report
                </div>
              </div>
              <button
                type="button"
                className="v2-pird__regen"
                onClick={regenerate}
                disabled={summaryQ.isFetching}
              >
                <Icon name="refresh" size={12} strokeWidth={1.8} />
                {summaryQ.isFetching ? 'Regenerating…' : 'Regenerate'}
              </button>
            </div>
            <div className="v2-pird__brief-body">
              <div className="v2-pird__headline">{headline}</div>
              {summaryQ.data && (
                <div className="v2-pird__tags">
                  <span className={`v2-pird__tag ${isLlm ? 'v2-pird__tag--ai' : ''}`}>
                    <Icon name={isLlm ? 'zap' : 'cpu'} size={10} strokeWidth={2} />
                    {isLlm ? 'AI generated' : 'Rule decoder'}
                  </span>
                  {summary?.source && (
                    <span className="v2-pird__tag v2-pird__tag--muted">
                      {isLlm ? 'Reviewed against decoder' : 'Deterministic decode'}
                    </span>
                  )}
                </div>
              )}
              {summaryQ.isLoading && (
                <div className="v2-pird__skel">
                  <span />
                  <span />
                </div>
              )}
              {!summaryQ.isLoading && blurb && blurb.toLowerCase() !== headline.toLowerCase() && (
                <p className="v2-pird__summary">{blurb}</p>
              )}
              {hazards.length > 0 && (
                <ul className="v2-pird__notes">
                  {hazards.map((h, i) => (
                    <li key={i}>
                      <Icon name="alert-triangle" size={11} strokeWidth={2} />
                      <span>{String(h).replace(/_/g, ' ')}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* DECODED FIELDS */}
          {fields.length > 0 && (
            <div className="v2-pird__card">
              <div className="v2-pird__card-head">
                <span className="v2-pird__card-title">DECODED</span>
              </div>
              <dl className="v2-pird__fields">
                {fields.map((f, i) => (
                  <div key={i} className="v2-pird__field">
                    <dt className="v2-pird__field-k">{f.label}</dt>
                    <dd className="v2-pird__field-v">{f.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {/* AREA TURBULENCE — synthesized risk at the report position */}
          {areaTurb &&
            (() => {
              const sev = TURB_SEVERITY[areaTurb.level] || TURB_SEVERITY.default;
              return (
                <div className="v2-pird__card">
                  <div className="v2-pird__card-head">
                    <span className="v2-pird__card-title">AREA TURBULENCE</span>
                    <span
                      className={`v2-pird__turb-badge v2-pird__turb-badge--${areaTurb.level}`}
                      style={{ backgroundColor: sev.color, borderColor: sev.stroke }}
                      title="G-AIRMET + nearby PIREPs + winds-aloft shear at this position"
                    >
                      <Icon name="alert-triangle" size={11} strokeWidth={2} />
                      {sev.label}
                      {areaTurb.score != null ? ` · ${areaTurb.score}` : ''}
                    </span>
                  </div>
                  <dl className="v2-pird__fields">
                    <div className="v2-pird__field">
                      <dt className="v2-pird__field-k">Risk level</dt>
                      <dd className="v2-pird__field-v">{sev.label}</dd>
                    </div>
                    {areaTurb.score != null && (
                      <div className="v2-pird__field">
                        <dt className="v2-pird__field-k">Score</dt>
                        <dd className="v2-pird__field-v">{areaTurb.score} / 100</dd>
                      </div>
                    )}
                  </dl>
                </div>
              );
            })()}

          {/* RAW */}
          {raw && (
            <div className="v2-pird__card">
              <div className="v2-pird__card-head">
                <span className="v2-pird__card-title">RAW REPORT</span>
                <button type="button" className="v2-pird__copy" onClick={copyRaw}>
                  <Icon name={copied ? 'check' : 'copy'} size={12} strokeWidth={1.8} />
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="v2-pird__raw">{raw}</pre>
            </div>
          )}

          {/* ADJACENT PIREPS */}
          {coord && (
            <div className="v2-pird__card">
              <div className="v2-pird__card-head">
                <span className="v2-pird__card-title">ADJACENT PIREPS</span>
                <span className="v2-pird__count">{adjacent.length}</span>
              </div>
              {adjacent.length === 0 ? (
                <div className="v2-pird__empty-row">
                  No other reports within {ADJACENT_RADIUS_NM} nm
                </div>
              ) : (
                <div className="v2-pird__list">
                  {adjacent.slice(0, 8).map((a) => {
                    const am = PIREP_GROUPS[a.group];
                    return (
                      <button
                        key={a.raw.pirep_id ?? a.raw.id}
                        type="button"
                        className="v2-pird__adj-row"
                        onClick={() => onViewPirep?.(a.raw.pirep_id ?? String(a.raw.id))}
                      >
                        <span
                          className="v2-pird__adj-badge"
                          style={{
                            color: am.color,
                            background: `color-mix(in srgb, ${am.color} 15%, transparent)`,
                            borderColor: `color-mix(in srgb, ${am.color} 36%, transparent)`,
                          }}
                        >
                          {a.badge}
                        </span>
                        <span className="v2-pird__adj-station">{a.station}</span>
                        <span className="v2-pird__adj-dist">
                          {a.nm.toFixed(0)} nm {a.bearing.point}
                        </span>
                        <Icon
                          name="chevron-right"
                          size={14}
                          strokeWidth={1.8}
                          style={{ color: 'var(--dim)' }}
                        />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT */}
        <div className="v2-pird__col">
          {coord ? (
            <>
              {/* MAP */}
              <div className="v2-pird__card">
                <div className="v2-pird__card-head">
                  <span className="v2-pird__card-title">LOCATION · LIVE TRAFFIC</span>
                  <span className="v2-pird__coord">
                    {coord.lat.toFixed(3)}, {coord.lon.toFixed(3)}
                  </span>
                </div>
                <PirepMap
                  lat={coord.lat}
                  lon={coord.lon}
                  station={derived.station}
                  color={meta.color}
                  radiusNm={CLOSEST_MAX_NM}
                  nearby={nearby}
                  onSelectAircraft={onSelectAircraft}
                />
                <div className="v2-pird__map-note">
                  Live traffic within {CLOSEST_MAX_MI} mi — current positions, not at report time.
                </div>
              </div>

              {/* CLOSEST AIRCRAFT */}
              <div className="v2-pird__card">
                <div className="v2-pird__card-head">
                  <span className="v2-pird__card-title">CLOSEST AIRCRAFT</span>
                  <span className="v2-pird__count">{nearby.length}</span>
                </div>
                {nearby.length === 0 ? (
                  <div className="v2-pird__empty-row">
                    {aircraftQ.isLoading
                      ? 'Loading traffic…'
                      : `No live traffic within ${CLOSEST_MAX_MI} mi`}
                  </div>
                ) : (
                  <div className="v2-pird__actable">
                    <div className="v2-pird__ac-head">
                      <span>Callsign</span>
                      <span>Alt</span>
                      <span>Δ vs PIREP</span>
                      <span>Dist</span>
                    </div>
                    {nearby.map((a) => (
                      <button
                        key={a.hex || `${a.lat}-${a.lon}`}
                        type="button"
                        className="v2-pird__ac-row"
                        onClick={() => a.hex && onSelectAircraft?.(a.hex.toLowerCase())}
                      >
                        <span className="v2-pird__ac-cs">
                          <Icon
                            name="plane"
                            size={13}
                            strokeWidth={1.8}
                            style={{ color: 'var(--accent2)' }}
                          />
                          {a.flight || a.hex.toUpperCase() || '—'}
                        </span>
                        <span className="v2-pird__ac-alt">
                          {a.alt != null ? Number(a.alt).toLocaleString() : '—'}
                        </span>
                        <span
                          className={`v2-pird__ac-delta ${
                            a.dAlt == null
                              ? ''
                              : a.dAlt >= 0
                                ? 'v2-pird__ac-delta--up'
                                : 'v2-pird__ac-delta--down'
                          }`}
                          title="Altitude vs reported PIREP level"
                        >
                          {a.dAlt == null
                            ? '—'
                            : `${a.dAlt >= 0 ? '+' : '−'}${Math.abs(a.dAlt).toLocaleString()}`}
                        </span>
                        <span className="v2-pird__ac-dist">
                          {a.mi.toFixed(0)} mi <em>{a.bearing.point}</em>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="v2-pird__card v2-pird__card--noloc">
              <Icon name="map-pin" size={26} strokeWidth={1.4} style={{ color: 'var(--dim2)' }} />
              <div>
                No position reported — map, nearby traffic and adjacent reports unavailable.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default PirepDetailScreen;
