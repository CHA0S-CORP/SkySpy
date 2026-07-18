import React, { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../primitives';
import { useHistoryData, RANGE_HOURS } from './useHistoryData';
import { ArchiveTab } from './ArchiveTab';
import {
  activityBins,
  airlineOf,
  fmtCoord,
  fmtSpeedTrack,
  historyKpis,
  historyStatRows,
  selectSessions,
  toSessionCard,
} from './historyModel';

const RANGES = ['1h', '6h', '24h', '48h', '7d'];
const TABS = [
  { key: 'sessions', label: 'Sessions' },
  { key: 'sightings', label: 'Sightings' },
  { key: 'acars', label: 'ACARS' },
  { key: 'safety', label: 'Safety' },
  { key: 'notams', label: 'NOTAMs' },
  { key: 'pireps', label: 'PIREPs' },
  { key: 'archive', label: 'Archive' },
];
const SORTS = [
  ['time', 'Time'],
  ['callsign', 'Callsign'],
  ['type', 'Type'],
  ['duration', 'Duration'],
  ['distance', 'Distance'],
  ['signal', 'Signal'],
  ['altitude', 'Altitude'],
  ['safety', 'Safety'],
];

function Kpi({ icon, iconColor, label, value, unit, warn }) {
  return (
    <div className={`v2-hist__kpi ${warn ? 'v2-hist__kpi--warn' : ''}`}>
      <Icon name={icon} size={16} strokeWidth={1.7} style={{ color: iconColor }} />
      <div>
        <div className="v2-hist__kpi-label">{label}</div>
        <div className="v2-hist__kpi-value" style={warn ? { color: 'var(--warn)' } : undefined}>
          {value}
          {unit && <span className="v2-hist__kpi-unit"> {unit}</span>}
        </div>
      </div>
    </div>
  );
}

function EmptyTab({ label }) {
  return (
    <div className="v2-hist__empty">
      <Icon name="calendar" size={40} strokeWidth={1.4} />
      <div className="v2-hist__empty-title">No {label.toLowerCase()} records in this window</div>
      <div className="v2-hist__empty-sub">Try widening the time range or clearing filters.</div>
    </div>
  );
}

/**
 * v2 History screen (designs/History.dc.html): time range + KPIs + 24h
 * activity + 7 section tabs. Sessions renders the designed card grid;
 * other tabs are simple record lists over their REST endpoints.
 *
 * @param {object} props
 * @param {string} props.apiBase
 * @param {(hex: string) => void} props.onSelectAircraft
 * @param {(eventId: string|number) => void} props.onViewEvent
 * @param {{data?: string}} [props.hashParams] - deep-link tab (`?data=notams`)
 */
export function HistoryScreen({ apiBase, onSelectAircraft, onViewEvent, hashParams }) {
  const initialTab = TABS.some((t) => t.key === hashParams?.data) ? hashParams.data : 'sessions';
  const [tab, setTab] = useState(initialTab);

  // Deep links (#history?data=... and the legacy #notams/#pireps/#archive
  // aliases) must also switch the tab when the screen is already mounted
  useEffect(() => {
    const linked = hashParams?.data;
    if (linked && TABS.some((t) => t.key === linked)) {
      setTab(linked);
    }
  }, [hashParams?.data]);
  const [range, setRange] = useState('24h');
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('All category');
  const [type, setType] = useState('All types');
  const [airline, setAirline] = useState('All airlines');
  const [mil, setMil] = useState(false);
  const [safe, setSafe] = useState(false);
  const [sortBy, setSortBy] = useState('time');
  const [sortDir, setSortDir] = useState('desc');
  const [archiveIcao, setArchiveIcao] = useState('');

  const queryClient = useQueryClient();
  const historyData = useHistoryData(apiBase, range, tab, archiveIcao);
  const { sessions, safety, stats, sightings, acars, notams, pireps } = historyData;

  const sessionList = sessions.data || [];
  const safetyList = safety.data || [];

  const safetyByHex = useMemo(() => {
    const m = new Map();
    for (const e of safetyList) {
      const hex = (e.icao_hex || e.hex || '').toUpperCase();
      if (hex) m.set(hex, (m.get(hex) || 0) + 1);
    }
    return m;
  }, [safetyList]);

  const filtered = useMemo(
    () =>
      selectSessions(
        sessionList,
        { query, cat, type, airline, mil, safe, sortBy, sortDir },
        safetyByHex
      ),
    [sessionList, query, cat, type, airline, mil, safe, sortBy, sortDir, safetyByHex]
  );
  const cards = useMemo(
    () => filtered.map((s) => toSessionCard(s, safetyByHex)),
    [filtered, safetyByHex]
  );
  const kpis = useMemo(
    () => historyKpis(sessionList, safetyList.length),
    [sessionList, safetyList]
  );
  const statRows = useMemo(() => historyStatRows(stats.data), [stats.data]);
  const activity = useMemo(
    () => activityBins(sessionList, RANGE_HOURS[range] ?? 24),
    [sessionList, range]
  );
  const peak = activity.length ? Math.max(...activity.map((b) => b.count ?? 0)) : 0;

  const typeOpts = useMemo(
    () =>
      [
        'All types',
        ...new Set(sessionList.map((s) => s.type || s.aircraft_type).filter(Boolean)),
      ].sort(),
    [sessionList]
  );
  const airlineOpts = useMemo(
    () => ['All airlines', ...new Set(sessionList.map(airlineOf))].sort(),
    [sessionList]
  );

  const onSort = (key) => {
    if (sortBy === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortBy(key);
      setSortDir('desc');
    }
  };

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['v2-history-sessions'] });

  return (
    <div className="v2-hist" data-testid="v2-history">
      <div className="v2-hist__top">
        {/* range + KPIs */}
        <div className="v2-hist__toprow">
          <div className="v2-hist__ranges">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                className={`v2-hist__range ${range === r ? 'v2-hist__range--on' : ''}`}
                onClick={() => setRange(r)}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="v2-hist__kpis">
            <Kpi
              icon="line-chart"
              iconColor="var(--accent)"
              label="SESSIONS"
              value={kpis.sessions}
            />
            <Kpi icon="send" iconColor="var(--accent2)" label="AIRCRAFT" value={kpis.aircraft} />
            <Kpi
              icon="clock"
              iconColor="var(--accent2)"
              label="AVG DURATION"
              value={kpis.avgDur}
              unit="min"
            />
            <Kpi
              icon="map-pin"
              iconColor="var(--accent2)"
              label="MAX RANGE"
              value={kpis.maxRange}
              unit="nm"
            />
            <Kpi
              icon="alert-triangle"
              iconColor="var(--warn)"
              label="SAFETY EVENTS"
              value={kpis.safety}
              warn
            />
          </div>
          <button
            type="button"
            className="v2-iconbtn v2-hist__refresh"
            title="Refresh"
            onClick={refresh}
          >
            <Icon name="refresh" size={16} strokeWidth={1.7} />
          </button>
        </div>

        {/* activity */}
        <div className="v2-hist__activity">
          <span className="v2-hist__activity-label">{range.toUpperCase()} ACTIVITY</span>
          <div className="v2-hist__activity-bars">
            {activity.map((b, i) => (
              <span
                key={i}
                style={{
                  height: `${b.h}%`,
                  background: b.recent ? 'var(--accent)' : 'var(--bord2)',
                }}
              />
            ))}
          </div>
          <span className="v2-hist__activity-peak">peak {peak} / bin</span>
        </div>

        {/* history stats summary (server-computed over the full window) */}
        {statRows.length > 0 && (
          <div className="v2-hist__stats" data-testid="v2-hist-stats">
            <span className="v2-hist__stats-label">{range.toUpperCase()} STATS</span>
            <div className="v2-hist__stats-grid">
              {statRows.map((r) => (
                <div key={r.label} className="v2-hist__stat">
                  <div className="v2-hist__stat-label">{r.label}</div>
                  <div className="v2-hist__stat-value">
                    {r.value.toLocaleString()}
                    {r.unit && <span className="v2-hist__stat-unit"> {r.unit}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* tabs */}
        <div className="v2-hist__tabs" role="tablist">
          {TABS.map((t) => {
            const on = tab === t.key;
            const count =
              t.key === 'sessions'
                ? sessionList.length
                : t.key === 'safety'
                  ? safetyList.length
                  : null;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={on}
                className={`v2-hist__tab ${on ? 'v2-hist__tab--on' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                {count != null && count > 0 && <span className="v2-hist__tab-count">{count}</span>}
              </button>
            );
          })}
        </div>

        {/* filters (sessions tab) */}
        {tab === 'sessions' && (
          <>
            <div className="v2-hist__filters">
              <div className="v2-hist__search">
                <Icon name="search" size={15} strokeWidth={1.8} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search callsign, ICAO, type…"
                  aria-label="Search sessions"
                />
              </div>
              <select
                className="v2-select"
                value={cat}
                onChange={(e) => setCat(e.target.value)}
                aria-label="Category"
              >
                {['All category', 'Commercial', 'Military', 'GA'].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
              <select
                className="v2-select"
                value={type}
                onChange={(e) => setType(e.target.value)}
                aria-label="Type"
              >
                {typeOpts.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
              <select
                className="v2-select"
                value={airline}
                onChange={(e) => setAirline(e.target.value)}
                aria-label="Airline"
              >
                {airlineOpts.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
              <button
                type="button"
                className={`v2-hist__toggle ${mil ? 'v2-hist__toggle--mil' : ''}`}
                aria-pressed={mil}
                onClick={() => setMil(!mil)}
              >
                <Icon name="shield" size={14} strokeWidth={1.7} />
                Military
              </button>
              <button
                type="button"
                className={`v2-hist__toggle ${safe ? 'v2-hist__toggle--safe' : ''}`}
                aria-pressed={safe}
                onClick={() => setSafe(!safe)}
              >
                <Icon name="alert-triangle" size={14} strokeWidth={1.7} />
                Safety
              </button>
            </div>
            <div className="v2-hist__sorts">
              <span className="v2-hist__sorts-label">SORT</span>
              {SORTS.map(([key, label]) => {
                const on = sortBy === key;
                return (
                  <button
                    key={key}
                    type="button"
                    className={`v2-hist__sort ${on ? 'v2-hist__sort--on' : ''}`}
                    onClick={() => onSort(key)}
                  >
                    {label}
                    <span className="v2-hist__sort-arrow">
                      {on ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                    </span>
                  </button>
                );
              })}
              <div className="v2-hist__spacer" />
              <span className="v2-hist__shown">
                {cards.length} of {sessionList.length} sessions
              </span>
            </div>
          </>
        )}
      </div>

      {/* content */}
      <div className="v2-hist__body">
        {tab === 'sessions' &&
          (cards.length === 0 ? (
            <EmptyTab label="session" />
          ) : (
            <div className="v2-hist__grid">
              {cards.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className="v2-hist__card"
                  style={{ borderLeftColor: c.accent }}
                  onClick={() => onSelectAircraft(c.hex.toLowerCase())}
                  data-testid={`v2-hist-card-${c.hex}`}
                >
                  <div className="v2-hist__card-head">
                    <div className="v2-hist__card-titles">
                      <div className="v2-hist__card-cs">
                        <span>{c.cs}</span>
                        {c.hasSafety && (
                          <span className="v2-hist__card-safety">
                            <Icon name="alert-triangle" size={10} strokeWidth={2} />
                            {c.safety}
                          </span>
                        )}
                      </div>
                      <div className="v2-hist__card-sub">
                        <span className="v2-hist__card-hex">{c.hex}</span>
                        <span
                          className="v2-hist__card-type"
                          style={{
                            color: c.typeFg,
                            background: `color-mix(in srgb, ${c.typeFg} 12%, transparent)`,
                            borderColor: `color-mix(in srgb, ${c.typeFg} 30%, transparent)`,
                          }}
                        >
                          {c.type}
                        </span>
                      </div>
                    </div>
                    <div className="v2-hist__card-dur">
                      <span>{c.dur}</span>
                      <span className="v2-hist__card-dur-label">MIN</span>
                    </div>
                  </div>

                  <div className="v2-hist__card-mid">
                    <div className="v2-hist__card-alt">
                      <div className="v2-hist__card-mini-label">ALTITUDE</div>
                      <div className="v2-hist__altbar">
                        <div className="v2-hist__altbar-fill" style={{ width: `${c.altPct}%` }} />
                        <span className="v2-hist__altbar-val">{c.altk} ft</span>
                      </div>
                    </div>
                    <div>
                      <div className="v2-hist__card-mini-label" style={{ textAlign: 'right' }}>
                        SIGNAL
                      </div>
                      <div className="v2-hist__card-signal">
                        <div className="v2-hist__card-bars">
                          {c.bars.map((b, i) => (
                            <span key={i} style={{ height: b.h, background: b.color }} />
                          ))}
                        </div>
                        <span className="v2-hist__card-db">
                          {c.dbMin != null ? `${c.dbMin} to ${c.db}` : c.db} dB
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="v2-hist__card-metrics">
                    <div>
                      <div className="v2-hist__card-mini-label">DISTANCE</div>
                      <div className="v2-hist__card-metric">
                        {c.dMin}–{c.dMax}
                        <span className="v2-hist__card-metric-unit"> nm</span>
                      </div>
                    </div>
                    <div>
                      <div className="v2-hist__card-mini-label">MAX V/S</div>
                      <div className="v2-hist__card-metric" style={{ color: 'var(--accent)' }}>
                        {c.vs}
                        <span className="v2-hist__card-metric-unit"> fpm</span>
                      </div>
                    </div>
                    <div>
                      <div className="v2-hist__card-mini-label">MSGS</div>
                      <div className="v2-hist__card-metric">{c.msg}</div>
                    </div>
                    <div>
                      <div className="v2-hist__card-mini-label">SQK</div>
                      <div className="v2-hist__card-metric" style={{ color: c.sqkColor }}>
                        {c.sqk}
                      </div>
                    </div>
                  </div>

                  <div className="v2-hist__card-times">
                    <span>First {c.first}</span>
                    <span>Last {c.last}</span>
                  </div>
                </button>
              ))}
            </div>
          ))}

        {tab === 'safety' &&
          (safetyList.length === 0 ? (
            <EmptyTab label="safety" />
          ) : (
            <div className="v2-hist__rows">
              {safetyList.map((e, i) => (
                <button
                  key={e.id ?? i}
                  type="button"
                  className="v2-hist__row"
                  onClick={() => (e.id != null ? onViewEvent(e.id) : null)}
                >
                  <Icon
                    name="alert-triangle"
                    size={16}
                    strokeWidth={1.8}
                    style={{ color: 'var(--warn)' }}
                  />
                  <div className="v2-hist__row-body">
                    <div className="v2-hist__row-title">
                      {e.event_type || e.type || 'Safety event'} ·{' '}
                      <span className="v2-mono">{(e.callsign || e.icao_hex || '').trim()}</span>
                    </div>
                    <div className="v2-hist__row-sub">{e.description || e.message || ''}</div>
                  </div>
                  <span className="v2-hist__row-time">
                    {e.timestamp || e.created_at
                      ? new Date(e.timestamp || e.created_at).toLocaleTimeString()
                      : ''}
                  </span>
                </button>
              ))}
            </div>
          ))}

        {tab === 'sightings' &&
          ((sightings.data || []).length === 0 ? (
            <EmptyTab label="sighting" />
          ) : (
            <div className="v2-hist__rows">
              {(sightings.data || []).map((s, i) => (
                <button
                  key={s.id ?? i}
                  type="button"
                  data-testid="v2-hist-sighting"
                  className={`v2-hist__row${s.is_emergency ? ' v2-hist__row--emergency' : ''}`}
                  onClick={() => onSelectAircraft((s.icao_hex || '').toLowerCase())}
                >
                  <Icon
                    name="send"
                    size={15}
                    strokeWidth={1.7}
                    style={{ color: 'var(--accent2)' }}
                  />
                  <div className="v2-hist__row-body">
                    <div className="v2-hist__row-title">
                      <span className="v2-mono">
                        {(s.callsign || '').trim() || (s.icao_hex || '').toUpperCase()}
                      </span>
                      {s.is_emergency && (
                        <span
                          data-testid="v2-hist-sighting-emergency"
                          className="v2-hist__pill v2-hist__pill--danger"
                        >
                          EMERGENCY
                        </span>
                      )}
                    </div>
                    <div className="v2-hist__row-sub v2-mono">
                      {s.altitude != null ? `${s.altitude} ft` : ''}{' '}
                      {fmtSpeedTrack(s.gs, s.track) ? `· ${fmtSpeedTrack(s.gs, s.track)}` : ''}
                      {fmtCoord(s.lat, s.lon) ? ` · ${fmtCoord(s.lat, s.lon)}` : ''}
                    </div>
                  </div>
                  <span className="v2-hist__row-time">
                    {s.timestamp ? new Date(s.timestamp).toLocaleTimeString() : ''}
                  </span>
                </button>
              ))}
            </div>
          ))}

        {tab === 'acars' &&
          ((acars.data || []).length === 0 ? (
            <EmptyTab label="ACARS" />
          ) : (
            <div className="v2-hist__rows">
              {(acars.data || []).map((m, i) => (
                <div key={m.id ?? i} className="v2-hist__row v2-hist__row--static">
                  <Icon
                    name="message"
                    size={15}
                    strokeWidth={1.7}
                    style={{ color: 'var(--accent2)' }}
                  />
                  <div className="v2-hist__row-body">
                    <div className="v2-hist__row-title v2-mono">
                      {(m.callsign || m.registration || m.icao_hex || 'ACARS').toString().trim()}
                      {m.label ? ` · ${m.label}` : ''}
                    </div>
                    <div className="v2-hist__row-sub">
                      {m.decoded_text || m.text || m.message || ''}
                    </div>
                  </div>
                  <span className="v2-hist__row-time">
                    {m.timestamp || m.created_at
                      ? new Date(m.timestamp || m.created_at).toLocaleTimeString()
                      : ''}
                  </span>
                </div>
              ))}
            </div>
          ))}

        {tab === 'notams' &&
          ((notams.data || []).length === 0 ? (
            <EmptyTab label="NOTAM" />
          ) : (
            <div className="v2-hist__rows">
              {(notams.data || []).map((n, i) => (
                <div key={n.id ?? n.notam_id ?? i} className="v2-hist__row v2-hist__row--static">
                  <Icon name="file" size={15} strokeWidth={1.7} style={{ color: 'var(--warn)' }} />
                  <div className="v2-hist__row-body">
                    <div className="v2-hist__row-title v2-mono">
                      {n.notam_id || n.location || 'NOTAM'}
                      {n.notam_type ? ` · ${n.notam_type}` : ''}
                    </div>
                    <div className="v2-hist__row-sub">{(n.text || '').slice(0, 220)}</div>
                  </div>
                </div>
              ))}
            </div>
          ))}

        {tab === 'pireps' &&
          ((pireps.data || []).length === 0 ? (
            <EmptyTab label="PIREP" />
          ) : (
            <div className="v2-hist__rows">
              {(pireps.data || []).map((p, i) => {
                const flightLvl =
                  p.flight_level != null
                    ? `FL${p.flight_level}`
                    : p.altitude_ft != null
                      ? `${p.altitude_ft.toLocaleString()} ft`
                      : null;
                const turb =
                  p.turbulence_type != null
                    ? `Turb ${p.turbulence_type}${
                        p.turbulence_base_ft != null || p.turbulence_top_ft != null
                          ? ` ${p.turbulence_base_ft ?? '?'}–${p.turbulence_top_ft ?? '?'} ft`
                          : ''
                      }`
                    : null;
                const icing =
                  p.icing_type != null
                    ? `Icing ${p.icing_type}${
                        p.icing_base_ft != null || p.icing_top_ft != null
                          ? ` ${p.icing_base_ft ?? '?'}–${p.icing_top_ft ?? '?'} ft`
                          : ''
                      }`
                    : null;
                const meta = [flightLvl, turb, icing].filter(Boolean).join(' · ');
                const isUrgent = (p.report_type || '').toUpperCase() === 'UUA';
                return (
                  <div key={p.id ?? i} className="v2-hist__row v2-hist__row--static">
                    <Icon
                      name="message"
                      size={15}
                      strokeWidth={1.7}
                      style={{ color: 'var(--accent2)' }}
                    />
                    <div className="v2-hist__row-body">
                      <div className="v2-hist__row-title">
                        <span className="v2-mono">
                          {p.location || p.pirep_id || p.station || 'PIREP'}
                        </span>
                        {p.report_type && (
                          <span
                            className={`v2-hist__pill ${
                              isUrgent ? 'v2-hist__pill--danger' : 'v2-hist__pill--dim'
                            }`}
                          >
                            {p.report_type}
                          </span>
                        )}
                        {p.severity && (
                          <span className="v2-hist__pill v2-hist__pill--warn">{p.severity}</span>
                        )}
                      </div>
                      <div className="v2-hist__row-sub">
                        {p.human_summary || meta || p.raw_text || p.text || ''}
                      </div>
                      {meta && (p.human_summary || p.raw_text || p.text) && (
                        <div className="v2-hist__row-meta v2-mono">{meta}</div>
                      )}
                    </div>
                    <span className="v2-hist__row-time">
                      {p.observation_time ? new Date(p.observation_time).toLocaleTimeString() : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}

        {tab === 'archive' && (
          <ArchiveTab
            data={historyData}
            icao={archiveIcao}
            onSearch={(v) => setArchiveIcao((v || '').trim().toUpperCase())}
            onClear={() => setArchiveIcao('')}
          />
        )}
      </div>
    </div>
  );
}
