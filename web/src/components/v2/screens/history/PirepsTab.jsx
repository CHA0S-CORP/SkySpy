import React, { useMemo, useState } from 'react';
import { Icon } from '../../primitives';
import {
  PIREP_GROUPS,
  classifyPirep,
  derivePirep,
  isUrgent,
  pirepChips,
  pirepSorter,
  reportType,
  severityRank,
} from './pirepsModel';

const SORTS = [
  ['severity', 'Severity'],
  ['recent', 'Recent'],
  ['type', 'Type'],
];

function ago(iso) {
  if (!iso) return { label: '', ts: 0 };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { label: '', ts: 0 };
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  let label;
  if (s < 60) label = `${s}s ago`;
  else if (s < 3600) label = `${Math.floor(s / 60)}m ago`;
  else if (s < 86400) label = `${Math.floor(s / 3600)}h ago`;
  else label = `${Math.floor(s / 86400)}d ago`;
  return { label, ts: d.getTime() };
}

/**
 * History → PIREPs tab: a NOTAM-style grid of pilot-report cards. Each report is
 * decoded from its raw text (pirepsModel.derivePirep) into a hazard group + TYPE
 * badge, real reporting station, and Urgent/Routine report type. Hazard filter
 * chips + search + a severity/recent/type sort sit on top; clicking a card opens
 * the full PIREP detail page via `onViewPirep(pirep_id)`.
 *
 * @param {object} props
 * @param {object[]} props.pireps  serialized CachedPirep rows
 * @param {(pirepId: string) => void} props.onViewPirep
 */
export function PirepsTab({ pireps, onViewPirep }) {
  const [group, setGroup] = useState('all');
  const [query, setQuery] = useState('');
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [sort, setSort] = useState('severity');

  const classified = useMemo(
    () =>
      (pireps || []).map((p) => {
        const d = derivePirep(p);
        const { group: g, badge } = classifyPirep(p, d);
        const t = ago(p.observation_time || p.fetched_at);
        return {
          raw: p,
          derived: d,
          id: p.pirep_id ?? p.id,
          group: g,
          badge,
          station: d.station,
          rt: reportType(d),
          urgent: isUrgent(d),
          sevRank: severityRank(p, d),
          summary: p.human_summary || d.remarks || '',
          ago: t.label,
          ts: t.ts,
        };
      }),
    [pireps]
  );

  const chips = useMemo(() => pirepChips(classified, group), [classified, group]);
  const urgentCount = useMemo(() => classified.filter((r) => r.urgent).length, [classified]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return classified
      .filter((r) => {
        if (group !== 'all' && r.group !== group) return false;
        if (urgentOnly && !r.urgent) return false;
        if (!q) return true;
        return `${r.station} ${r.badge} ${r.derived.aircraft || ''} ${r.summary}`
          .toLowerCase()
          .includes(q);
      })
      .sort(pirepSorter(sort));
  }, [classified, group, urgentOnly, query, sort]);

  if (!classified.length) {
    return (
      <div className="v2-hist__empty">
        <Icon name="message" size={40} strokeWidth={1.4} />
        <div className="v2-hist__empty-title">No pilot reports in this window</div>
        <div className="v2-hist__empty-sub">Try widening the time range or clearing filters.</div>
      </div>
    );
  }

  return (
    <div className="v2-notams v2-pireps">
      <div className="v2-acars__controls">
        <div className="v2-hist__search v2-acars__search">
          <Icon name="search" size={15} strokeWidth={1.8} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search station, type, aircraft, text…"
            aria-label="Search PIREPs"
          />
        </div>
        {urgentCount > 0 && (
          <button
            type="button"
            className={`v2-acars__empty-toggle v2-pirep__urgent-toggle ${
              urgentOnly ? 'v2-pirep__urgent-toggle--on' : ''
            }`}
            onClick={() => setUrgentOnly((v) => !v)}
            aria-pressed={urgentOnly}
            title="Urgent (UUA) reports only"
          >
            <Icon name="alert-triangle" size={13} strokeWidth={1.9} />
            {urgentOnly ? 'Urgent only' : `${urgentCount} urgent`}
          </button>
        )}
        <div className="v2-pirep__sort" role="group" aria-label="Sort reports">
          <Icon name="sliders" size={13} strokeWidth={1.8} />
          {SORTS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`v2-pirep__sort-btn ${sort === key ? 'v2-pirep__sort-btn--on' : ''}`}
              onClick={() => setSort(key)}
              aria-pressed={sort === key}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="v2-acars__live">
          <span className="v2-acars__live-dot" />
          {rows.length} of {classified.length} reports
        </span>
      </div>

      <div className="v2-notams__chips" role="tablist">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`v2-acars__chip ${c.on ? 'v2-acars__chip--on' : ''}`}
            style={c.on ? { '--chip': c.color } : undefined}
            onClick={() => setGroup(c.key)}
          >
            {c.key !== 'all' && <i className="v2-acars__swatch" style={{ background: c.color }} />}
            {c.label}
            <span className="v2-acars__chip-count">{c.count}</span>
          </button>
        ))}
      </div>

      <div className="v2-notams__grid">
        {rows.map((r) => {
          const meta = PIREP_GROUPS[r.group];
          return (
            <button
              key={r.id ?? `${r.station}-${r.ts}`}
              type="button"
              className={`v2-notams__card v2-pireps__card ${
                r.urgent ? 'v2-pireps__card--urgent' : ''
              }`}
              style={{ borderLeftColor: meta.color }}
              onClick={() => r.id && onViewPirep?.(r.id)}
            >
              <div className="v2-notams__card-head">
                <span
                  className="v2-notams__card-icon"
                  style={{
                    color: meta.color,
                    background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
                    borderColor: `color-mix(in srgb, ${meta.color} 32%, transparent)`,
                  }}
                >
                  <Icon
                    name={
                      r.group === 'icing'
                        ? 'thermometer'
                        : r.group === 'turbulence'
                          ? 'wave'
                          : 'message'
                    }
                    size={15}
                    strokeWidth={1.8}
                  />
                </span>
                <div className="v2-notams__card-titles">
                  <div className="v2-notams__card-center">
                    <span className="v2-pireps__card-station">{r.station}</span>
                    <span
                      className="v2-notams__card-badge"
                      style={{
                        color: meta.color,
                        background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
                      }}
                    >
                      {r.badge}
                    </span>
                  </div>
                  <div className="v2-notams__card-id">
                    {r.rt && (
                      <span className={`v2-pireps__rtype v2-pireps__rtype--${r.rt.kind}`}>
                        {r.rt.label}
                      </span>
                    )}
                    {r.derived.aircraft && (
                      <span className="v2-pireps__ac">{r.derived.aircraft}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="v2-notams__card-desc">{r.summary || meta.name}</div>
              <div className="v2-notams__card-foot">
                {r.derived.flightLevel && (
                  <span className="v2-notams__card-metric">
                    <Icon name="layers" size={11} strokeWidth={1.9} />
                    {r.derived.flightLevel}
                  </span>
                )}
                {r.derived.temp != null && (
                  <span className="v2-notams__card-metric">
                    <Icon name="thermometer" size={11} strokeWidth={1.9} />
                    {r.derived.temp}°C
                  </span>
                )}
                <span className="v2-notams__card-time">{r.ago}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default PirepsTab;
