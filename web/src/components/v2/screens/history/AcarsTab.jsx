import React, { useMemo, useState } from 'react';
import { Icon } from '../../primitives';
import { AcarsAiAnalysis } from '../../../shared/AcarsAiAnalysis';
import { AcarsRouteMap } from './AcarsRouteMap';
import {
  ACARS_GROUPS,
  acarsAirline,
  acarsCallsign,
  acarsChips,
  acarsText,
  classifyAcars,
  decodeLabel,
} from './acarsModel';

function timeParts(msg) {
  const iso = msg.timestamp || msg.created_at;
  if (!iso) return { time: '', ago: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { time: '', ago: '' };
  const secs = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  let ago;
  if (secs < 60) ago = `${secs}s`;
  else if (secs < 3600) ago = `${Math.floor(secs / 60)}m ${secs % 60}s`;
  else ago = `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  return { time: d.toLocaleTimeString(), ago };
}

/**
 * History → ACARS tab: dense, type-classified message list (handoff §2).
 * Left color stripe + badge per group, airline tag, label tooltip, type filter
 * chips with live counts, search over cs/label/text/badge, and an opt-in
 * per-row "Explain" that fetches the cached LLM summary
 * (`GET /acars/<id>/ai-summary`).
 *
 * @param {object} props
 * @param {object[]} props.messages raw AcarsMessage rows
 * @param {string} props.apiBase
 * @param {(hex: string) => void} props.onSelectAircraft
 */
export function AcarsTab({ messages, apiBase, onSelectAircraft }) {
  const [group, setGroup] = useState('all');
  const [query, setQuery] = useState('');
  const [showEmpty, setShowEmpty] = useState(false);
  const [openMaps, setOpenMaps] = useState(() => new Set());

  const toggleMap = (id) =>
    setOpenMaps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const classified = useMemo(
    () =>
      (messages || []).map((m) => {
        const { group: g, badge } = classifyAcars(m);
        return {
          raw: m,
          id: m.id,
          group: g,
          badge,
          cs: acarsCallsign(m),
          airline: acarsAirline(m),
          label: (m.label || '').toString(),
          text: acarsText(m),
          route: m.route?.has_route ? m.route : null,
          ...timeParts(m),
        };
      }),
    [messages]
  );

  const chips = useMemo(() => acarsChips(classified, group), [classified, group]);

  // Messages matching the group + search filters, before the empty-body cut.
  const matched = useMemo(() => {
    const q = query.trim().toLowerCase();
    return classified.filter((m) => {
      if (group !== 'all' && m.group !== group) return false;
      if (!q) return true;
      return `${m.cs} ${m.label} ${m.text} ${m.badge}`.toLowerCase().includes(q);
    });
  }, [classified, group, query]);

  // Link/downlink frames carry no text; hide them by default (toggle to show).
  const emptyCount = useMemo(() => matched.filter((m) => !m.text).length, [matched]);
  const rows = useMemo(
    () => (showEmpty ? matched : matched.filter((m) => m.text)),
    [matched, showEmpty]
  );

  if (!classified.length) {
    return (
      <div className="v2-hist__empty">
        <Icon name="message" size={40} strokeWidth={1.4} />
        <div className="v2-hist__empty-title">No ACARS messages in this window</div>
        <div className="v2-hist__empty-sub">Try widening the time range or clearing filters.</div>
      </div>
    );
  }

  return (
    <div className="v2-acars">
      <div className="v2-acars__controls">
        <div className="v2-hist__search v2-acars__search">
          <Icon name="search" size={15} strokeWidth={1.8} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search callsign, label, text…"
            aria-label="Search ACARS"
          />
        </div>
        {emptyCount > 0 && (
          <button
            type="button"
            className={`v2-acars__empty-toggle ${showEmpty ? 'v2-acars__empty-toggle--on' : ''}`}
            onClick={() => setShowEmpty((v) => !v)}
            aria-pressed={showEmpty}
            title="Link/downlink frames have no message body"
          >
            <Icon name="eye" size={13} strokeWidth={1.8} />
            {showEmpty ? 'Hide' : 'Show'} {emptyCount} link/downlink
          </button>
        )}
        <span className="v2-acars__live">
          <span className="v2-acars__live-dot" />
          {rows.length} of {classified.length} msgs
        </span>
      </div>

      <div className="v2-acars__chips" role="tablist">
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

      <div className="v2-acars__list">
        <div className="v2-acars__head">
          <span>TYPE</span>
          <span>CALLSIGN · MESSAGE</span>
          <span style={{ textAlign: 'right' }}>TIME</span>
        </div>
        {rows.map((m) => {
          const color = ACARS_GROUPS[m.group].color;
          const empty = !m.text;
          return (
            <div
              key={m.id ?? `${m.cs}-${m.time}`}
              className="v2-acars__row"
              style={{ borderLeftColor: color }}
            >
              <span
                className="v2-acars__badge"
                style={{
                  color,
                  background: `color-mix(in srgb, ${color} 15%, transparent)`,
                  borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
                }}
              >
                {m.badge}
              </span>
              <div className="v2-acars__body">
                <div className="v2-acars__ident">
                  <button
                    type="button"
                    className="v2-acars__cs"
                    onClick={() =>
                      m.raw.icao_hex && onSelectAircraft?.(m.raw.icao_hex.toLowerCase())
                    }
                    title="Open airframe"
                  >
                    {m.cs}
                  </button>
                  <span className="v2-acars__airline">{m.airline}</span>
                  {m.label && (
                    <span
                      className="v2-acars__label"
                      title={`${decodeLabel(m.label)} · label ${m.label}`}
                    >
                      {m.label}
                    </span>
                  )}
                </div>
                <div className={`v2-acars__text ${empty ? 'v2-acars__text--empty' : ''}`}>
                  {empty ? '— no message text (link/downlink) —' : m.text}
                </div>
                {m.route && (
                  <button
                    type="button"
                    className={`v2-acars__route-toggle ${
                      openMaps.has(m.id) ? 'v2-acars__route-toggle--on' : ''
                    }`}
                    onClick={() => toggleMap(m.id)}
                    title="Show waypoints on map"
                  >
                    <Icon name="map" size={13} strokeWidth={1.8} />
                    {openMaps.has(m.id) ? 'Hide route' : `Route · ${m.route.points.length} pt`}
                  </button>
                )}
                {m.route && openMaps.has(m.id) && <AcarsRouteMap points={m.route.points} />}
                {m.id != null && <AcarsAiAnalysis apiBase={apiBase} id={m.id} />}
              </div>
              <div className="v2-acars__time">
                <div className="v2-acars__ago">{m.ago}</div>
                <div className="v2-acars__clock">{m.time}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
