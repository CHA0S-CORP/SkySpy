import React, { useMemo, useState } from 'react';
import { Icon } from '../../primitives';
import { useBulkAircraftInfo } from '../../../../hooks/useBulkAircraftInfo';
import { CHIP_DEFS, COLUMNS, FILTER_TESTS, selectAircraft, toRow } from './listModel';

/**
 * v2 Aircraft List (design: Aircraft List.dc.html) — search, filter chips with
 * live counts, sortable grid table, footer legend. Fully socket-driven; airframe
 * enrichment (photo + privacy flags) is layered on off the hot path via the
 * cache-only bulk REST endpoint (see useBulkAircraftInfo).
 *
 * @param {object} props
 * @param {object[]} props.aircraft - live aircraft array from useSocketIOData
 * @param {(hex: string) => void} props.onSelectAircraft
 * @param {string} [props.apiBase] - API base (defaults to the app's relative base)
 */
export function AircraftListScreen({ aircraft, onSelectAircraft, apiBase }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(null);
  const [sortBy, setSortBy] = useState('dist');
  const [sortDir, setSortDir] = useState('asc');

  const counts = useMemo(() => {
    const c = {};
    for (const { key } of CHIP_DEFS) c[key] = aircraft.filter(FILTER_TESTS[key]).length;
    return c;
  }, [aircraft]);

  const rows = useMemo(
    () => selectAircraft(aircraft, { query, filter, sortBy, sortDir }).map(toRow),
    [aircraft, query, filter, sortBy, sortDir]
  );

  // Off-hot-path enrichment: the hexes currently shown drive one debounced,
  // cache-only bulk lookup. Keyed on the (sorted) hex set inside the hook, so
  // socket ticks that don't change which aircraft are visible cost nothing.
  const shownHexes = useMemo(() => rows.map((r) => r.hex), [rows]);
  const enrichment = useBulkAircraftInfo(shownHexes, apiBase);

  const militaryCount = counts.military ?? 0;

  const onSort = (key) => {
    if (sortBy === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(key);
      setSortDir('asc');
    }
  };

  return (
    <div className="v2-list" data-testid="v2-aircraft-list">
      <div className="v2-list__toolbar">
        <div className="v2-list__search">
          <Icon name="search" size={16} strokeWidth={1.8} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ICAO, callsign, type, squawk…"
            aria-label="Search aircraft"
          />
        </div>
      </div>

      <div className="v2-list__chips">
        {CHIP_DEFS.map(({ key, label, dot, hasCount }) => {
          const on = filter === key;
          return (
            <button
              key={key}
              type="button"
              className={`v2-list__chip ${on ? 'v2-list__chip--on' : ''}`}
              style={{ '--chip-dot': dot }}
              aria-pressed={on}
              onClick={() => setFilter(on ? null : key)}
            >
              <span className="v2-list__chip-dot" />
              {label}
              {hasCount && <span className="v2-list__chip-count">{counts[key]}</span>}
            </button>
          );
        })}
      </div>

      <div className="v2-list__table">
        <div className="v2-list__thead" role="row">
          {COLUMNS.map(({ key, label }) => {
            const active = sortBy === key;
            return (
              <button
                key={key}
                type="button"
                role="columnheader"
                className={`v2-list__th ${active ? 'v2-list__th--active' : ''}`}
                onClick={() => onSort(key)}
                aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                {label}
                <span className="v2-list__th-arrow">
                  {active ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                </span>
              </button>
            );
          })}
        </div>

        <div className="v2-list__rows">
          {rows.map((r) => {
            const info = enrichment[(r.hex || '').toUpperCase()] || null;
            const thumb = info?.photo_thumbnail_url || null;
            const flags = info || {};
            return (
              <button
                key={r.hex}
                type="button"
                className="v2-list__row"
                style={{ borderLeftColor: r.accent }}
                onClick={() => onSelectAircraft(r.hex)}
                data-testid={`v2-list-row-${r.hex}`}
              >
                <div className="v2-list__cell v2-list__cell--icao">
                  {thumb && (
                    <img
                      className="v2-list__photo"
                      src={thumb}
                      alt=""
                      loading="lazy"
                      data-testid={`v2-list-photo-${r.hex}`}
                    />
                  )}
                  {r.isMil && (
                    <Icon
                      name="shield"
                      size={12}
                      strokeWidth={1.8}
                      style={{ color: 'var(--mil)' }}
                    />
                  )}
                  <span style={{ color: r.icaoColor }}>{r.icao}</span>
                  {(flags.isPia || flags.isLadd || flags.isInteresting) && (
                    <span className="v2-list__flags">
                      {flags.isPia && (
                        <span
                          className="v2-list__flag v2-list__flag--pia"
                          title="Privacy ICAO Address"
                          data-testid={`v2-list-flag-pia-${r.hex}`}
                        >
                          PIA
                        </span>
                      )}
                      {flags.isLadd && (
                        <span
                          className="v2-list__flag v2-list__flag--ladd"
                          title="FAA Limiting Aircraft Data Displayed"
                          data-testid={`v2-list-flag-ladd-${r.hex}`}
                        >
                          LADD
                        </span>
                      )}
                      {flags.isInteresting && (
                        <span
                          className="v2-list__flag v2-list__flag--interesting"
                          title="Flagged as interesting"
                          data-testid={`v2-list-flag-interest-${r.hex}`}
                        >
                          INT
                        </span>
                      )}
                    </span>
                  )}
                </div>
                <div className="v2-list__cell v2-list__cell--cs">
                  <span style={{ color: r.csColor }}>{r.cs}</span>
                  {r.tail && <span className="v2-list__tail">{r.tail}</span>}
                  {r.operator && (
                    <span
                      className="v2-list__operator"
                      title={r.operator}
                      data-testid={`v2-list-operator-${r.hex}`}
                    >
                      {r.operator}
                    </span>
                  )}
                </div>
                <div
                  className="v2-list__cell v2-list__cell--type"
                  title={r.typeFull || undefined}
                  data-testid={`v2-list-type-${r.hex}`}
                >
                  <span>{r.type}</span>
                  {r.typeFull && (
                    <span className="v2-list__type-full" data-testid={`v2-list-type-full-${r.hex}`}>
                      {r.typeFull}
                      {r.year && (
                        <span className="v2-list__year" data-testid={`v2-list-year-${r.hex}`}>
                          {' · '}
                          {r.year}
                        </span>
                      )}
                    </span>
                  )}
                  {!r.typeFull && r.year && (
                    <span className="v2-list__year" data-testid={`v2-list-year-${r.hex}`}>
                      {r.year}
                    </span>
                  )}
                </div>
                <div className="v2-list__cell v2-list__cell--alt">
                  <span style={{ color: r.altColor }}>{r.altDisp}</span>
                  {r.altUnit && <span className="v2-list__unit">{r.altUnit}</span>}
                </div>
                <span className="v2-list__cell" style={{ color: r.spdColor }}>
                  {r.spd}
                </span>
                <span className="v2-list__cell v2-list__cell--vs" style={{ color: r.vsColor }}>
                  {r.vsDisp}
                </span>
                <div className="v2-list__cell v2-list__cell--hdg">
                  <span>{r.hdgDisp}</span>
                  <span className="v2-list__hdg-dir">{r.hdgDir}</span>
                </div>
                <span className="v2-list__cell">{r.dist}</span>
                <div className="v2-list__cell v2-list__cell--sig">
                  <Icon name="signal" size={12} strokeWidth={2} style={{ color: r.sigColor }} />
                  {r.bars.map((b, i) => (
                    <span
                      key={i}
                      className="v2-list__bar"
                      style={{ height: b.h, background: b.color }}
                    />
                  ))}
                </div>
                <span className="v2-list__cell" style={{ color: r.sqkColor }}>
                  {r.sqk}
                </span>
              </button>
            );
          })}
          {rows.length === 0 && (
            <div className="v2-list__empty">
              <Icon name="radar" size={30} />
              <span>No aircraft match the current filters</span>
            </div>
          )}
        </div>

        <div className="v2-list__footer">
          <div className="v2-list__foot-stat">
            <Icon name="send" size={14} strokeWidth={1.7} style={{ color: 'var(--accent2)' }} />
            <span>
              {rows.length} of {aircraft.length}
            </span>
          </div>
          <div className="v2-list__foot-stat">
            <Icon name="shield" size={13} strokeWidth={1.7} style={{ color: 'var(--mil)' }} />
            <span>{militaryCount} military</span>
          </div>
          <div className="v2-list__foot-spacer" />
          <div className="v2-list__legend">
            <Icon
              name="chevron-up"
              size={12}
              strokeWidth={2.4}
              style={{ color: 'var(--accent)' }}
            />
            <span>Climbing</span>
          </div>
          <div className="v2-list__legend">
            <Icon
              name="chevron-down"
              size={12}
              strokeWidth={2.4}
              style={{ color: 'var(--warn)' }}
            />
            <span>Descending</span>
          </div>
          <div className="v2-list__legend">
            <span className="v2-list__legend-dot" />
            <span>Military</span>
          </div>
        </div>
      </div>
    </div>
  );
}
