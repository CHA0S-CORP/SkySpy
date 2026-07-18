import React, { useMemo, useState } from 'react';
import { Icon } from '../../primitives';
import {
  NOTAM_CATS,
  altBand,
  classifyNotam,
  effectiveWindow,
  fmtRadius,
  notamCenter,
  notamChips,
  notamShortId,
  notamStats,
} from './notamModel';

/**
 * History → NOTAMs archive tab (handoff §4). Category system (Security /
 * Hazards / UAS / VIP / Air Shows), real stat strip (active NOTAMs, active
 * TFRs, ARTCC centers), category filter chips + search, and cards that link to
 * the NOTAM detail page.
 *
 * @param {object} props
 * @param {object[]} props.notams merged NOTAM + TFR list
 * @param {(notamId: string) => void} props.onViewNotam
 */
export function NotamsTab({ notams, onViewNotam }) {
  const [cat, setCat] = useState('all');
  const [query, setQuery] = useState('');

  const rows = useMemo(
    () =>
      (notams || []).map((n) => ({
        raw: n,
        id: notamShortId(n),
        cat: classifyNotam(n),
        center: notamCenter(n),
        isTfr: n.is_tfr || (n.notam_type || '').toUpperCase() === 'TFR',
        alt: altBand(n),
        radius: fmtRadius(n),
        time: effectiveWindow(n),
      })),
    [notams]
  );

  const stats = useMemo(() => notamStats(notams || []), [notams]);
  const chips = useMemo(() => notamChips(rows, cat), [rows, cat]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (cat !== 'all' && r.cat !== cat) return false;
      if (!q) return true;
      return `${r.center} ${r.id} ${NOTAM_CATS[r.cat].short} ${r.raw.text || ''}`
        .toLowerCase()
        .includes(q);
    });
  }, [rows, cat, query]);

  if (!rows.length) {
    return (
      <div className="v2-hist__empty">
        <Icon name="file" size={40} strokeWidth={1.4} />
        <div className="v2-hist__empty-title">No active NOTAMs</div>
        <div className="v2-hist__empty-sub">
          NOTAM data refreshes periodically from the FAA feed.
        </div>
      </div>
    );
  }

  return (
    <div className="v2-notams">
      <div className="v2-notams__stats">
        <div className="v2-notams__stat">
          <span className="v2-notams__stat-val" style={{ color: 'var(--accent2)' }}>
            {stats.total}
          </span>
          <span className="v2-notams__stat-label">ACTIVE NOTAMS</span>
        </div>
        <div className="v2-notams__stat v2-notams__stat--danger">
          <span className="v2-notams__stat-val" style={{ color: 'var(--danger)' }}>
            {stats.tfrs}
          </span>
          <span className="v2-notams__stat-label">ACTIVE TFRS</span>
        </div>
        <div className="v2-notams__stat">
          <span className="v2-notams__stat-val">{stats.centers}</span>
          <span className="v2-notams__stat-label">ARTCC CENTERS</span>
        </div>
        <div className="v2-hist__search v2-notams__search">
          <Icon name="search" size={15} strokeWidth={1.8} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search center, id, keyword…"
            aria-label="Search NOTAMs"
          />
        </div>
      </div>

      <div className="v2-notams__chips" role="tablist">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`v2-acars__chip ${c.on ? 'v2-acars__chip--on' : ''}`}
            style={c.on ? { '--chip': c.color } : undefined}
            onClick={() => setCat(c.key)}
          >
            {c.key !== 'all' && <i className="v2-acars__swatch" style={{ background: c.color }} />}
            {c.label}
            <span className="v2-acars__chip-count">{c.count}</span>
          </button>
        ))}
        <span className="v2-notams__shown">{filtered.length} shown</span>
      </div>

      <div className="v2-notams__grid">
        {filtered.map((r) => {
          const meta = NOTAM_CATS[r.cat];
          return (
            <button
              key={r.id || r.center}
              type="button"
              className="v2-notams__card"
              style={{ borderLeftColor: meta.color }}
              onClick={() => r.id && onViewNotam?.(r.id)}
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
                  <Icon name={meta.icon} size={15} strokeWidth={1.8} />
                </span>
                <div className="v2-notams__card-titles">
                  <div className="v2-notams__card-center">
                    <span>{r.center}</span>
                    <span
                      className="v2-notams__card-badge"
                      style={{
                        color: meta.color,
                        background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
                      }}
                    >
                      {r.isTfr ? 'TFR' : 'NOTAM'}
                    </span>
                  </div>
                  <div className="v2-notams__card-id">{r.id}</div>
                </div>
              </div>
              <div className="v2-notams__card-cat" style={{ color: meta.color }}>
                {meta.short}
              </div>
              <div className="v2-notams__card-desc">{r.raw.human_summary || meta.desc}</div>
              <div className="v2-notams__card-foot">
                <span className="v2-notams__card-metric">
                  <Icon name="arrow-up" size={11} strokeWidth={1.9} />
                  {r.alt}
                </span>
                {r.radius !== '—' && (
                  <span className="v2-notams__card-metric">
                    <Icon name="target" size={11} strokeWidth={1.9} />
                    {r.radius}
                  </span>
                )}
                <span className="v2-notams__card-time">{r.time}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
