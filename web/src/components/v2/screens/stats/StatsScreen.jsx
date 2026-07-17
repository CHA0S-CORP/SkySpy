import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '../../primitives';
import {
  activityByHour,
  altitudeDistribution,
  categoryDistribution,
  coveragePolygon,
  historyBars,
  liveFeeds,
  rssiScatter,
  safetySeverityCounts,
  safetyTypeBars,
  spark,
  squawkWatchlist,
  typeBreakdown,
} from './statsModel';

const RANGES = ['1h', '6h', '24h', '48h', '7d'];
const RANGE_HOURS = { '1h': 1, '6h': 6, '24h': 24, '48h': 48, '7d': 168 };
const HIST_TABS = ['Trends', 'Top Performers', 'Distance', 'Duration', 'Patterns'];

function PanelBars({ items }) {
  return (
    <>
      {items.map((a) => (
        <div key={a.label} className="v2-stats__dist-row">
          <div className="v2-stats__dist-head">
            <span className="v2-stats__dist-label">{a.label}</span>
            <span>
              <strong className="v2-mono">{a.count ?? a.disp}</strong>{' '}
              {a.pct != null && <span className="v2-stats__dist-pct">{a.pct}%</span>}
            </span>
          </div>
          <div className="v2-stats__dist-track">
            <div
              className="v2-stats__dist-fill"
              style={{ width: `${a.pct}%`, background: a.color || 'var(--accent2)' }}
            />
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * v2 Statistics screen (designs/Statistics.dc.html): 3-rail analytics.
 * Live rails + distributions from the socket aircraft array, KPI sparklines
 * from stats:tick, antenna panels from antenna analytics, historical panels
 * from /sessions, severity counters from /safety/events.
 *
 * @param {object} props
 * @param {string} props.apiBase
 * @param {object[]} props.aircraft
 * @param {object|null} props.statsTick
 * @param {object|null} props.antennaAnalytics
 * @param {boolean} props.connected
 * @param {(hex: string) => void} props.onSelectAircraft
 */
export function StatsScreen({
  apiBase,
  aircraft,
  statsTick,
  antennaAnalytics,
  connected,
  onSelectAircraft,
}) {
  const [range, setRange] = useState('24h');
  const [milOnly, setMilOnly] = useState(false);
  const [histTab, setHistTab] = useState('Trends');

  const hours = RANGE_HOURS[range] ?? 24;

  const { data: sessions = [] } = useQuery({
    queryKey: ['v2-stats-sessions', apiBase, hours],
    queryFn: async () => {
      try {
        const res = await fetch(`${apiBase}/api/v1/sessions?hours=${hours}&limit=500`);
        if (!res.ok) return [];
        const data = await res.json();
        return data.sessions || data.results || (Array.isArray(data) ? data : []);
      } catch {
        return [];
      }
    },
  });

  const { data: safetyEvents = [] } = useQuery({
    queryKey: ['v2-stats-safety', apiBase, hours],
    refetchInterval: 60000,
    queryFn: async () => {
      try {
        const res = await fetch(`${apiBase}/api/v1/safety/events/?hours=${hours}&limit=500`);
        if (!res.ok) return [];
        const data = await res.json();
        return data.events || data.results || (Array.isArray(data) ? data : []);
      } catch {
        return [];
      }
    },
  });

  const fleet = useMemo(
    () => (milOnly ? aircraft.filter((a) => a.military) : aircraft),
    [aircraft, milOnly]
  );

  const feeds = useMemo(() => liveFeeds(fleet), [fleet]);
  const watchlist = useMemo(() => squawkWatchlist(aircraft), [aircraft]);
  const altDist = useMemo(() => altitudeDistribution(fleet), [fleet]);
  const cats = useMemo(() => categoryDistribution(fleet), [fleet]);

  const series = statsTick?.series || [];
  const kpis = useMemo(() => {
    const num = (v, digits = 0) => (typeof v === 'number' ? v.toFixed(digits) : '--');
    return [
      {
        label: 'TRAFFIC',
        color: 'var(--accent)',
        icon: 'send',
        v1: statsTick?.traffic?.aircraft ?? aircraft.length,
        l1: 'current',
        v2: num(statsTick?.traffic?.msg_rate),
        l2: 'msg/s',
        ...spark(series.map((s) => s.aircraft ?? 0)),
      },
      {
        label: 'RECEPTION',
        color: 'var(--accent2)',
        icon: 'signal',
        v1: statsTick?.traffic?.with_position ?? '--',
        l1: 'with pos',
        v2: num(statsTick?.reception?.max_range_nm),
        l2: 'nm max',
        ...spark(series.map((s) => s.max_range_nm ?? 0)),
      },
      {
        label: 'SYSTEM',
        color: 'var(--purple)',
        icon: 'activity',
        v1: new Set(sessions.map((s) => s.icao_hex)).size,
        l1: `${range} uniq`,
        v2: statsTick?.traffic?.military ?? '--',
        l2: 'military',
        ...spark(series.map((s) => s.load ?? 0)),
      },
    ];
  }, [statsTick, aircraft.length, sessions, range, series]);

  const severity = useMemo(() => safetySeverityCounts(safetyEvents), [safetyEvents]);
  const typeBars = useMemo(() => safetyTypeBars(safetyEvents), [safetyEvents]);

  const coverage = useMemo(
    () => coveragePolygon(antennaAnalytics?.max_range_by_direction),
    [antennaAnalytics]
  );
  const scatterData = useMemo(
    () =>
      rssiScatter(
        antennaAnalytics?.scatter_data ||
          aircraft.filter((a) => typeof a.rssi === 'number' && typeof a.distance_nm === 'number')
      ),
    [antennaAnalytics, aircraft]
  );

  const histBars = useMemo(() => historyBars(sessions, histTab), [sessions, histTab]);
  const trends = useMemo(() => {
    const a = spark(
      series.map((s) => s.aircraft ?? 0),
      50
    );
    const b = spark(
      series.map((s) => s.msg_rate ?? 0),
      50
    );
    return { lineA: a.line, areaA: a.area, lineB: b.line };
  }, [series]);

  const hoursHeat = useMemo(() => activityByHour(sessions), [sessions]);
  const { types, durations } = useMemo(() => typeBreakdown(sessions), [sessions]);

  const health = [
    {
      label: 'Load',
      val: statsTick?.system?.load ?? '--',
      pct: Math.min(100, (statsTick?.system?.load ?? 0) * 25),
      color: 'var(--accent)',
    },
    {
      label: 'RAM',
      val: statsTick?.system?.mem != null ? `${statsTick.system.mem}%` : '--',
      pct: statsTick?.system?.mem ?? 0,
      color: 'var(--warn)',
    },
    {
      label: 'Receiver',
      val: statsTick?.system?.adsb_online ? 'ONLINE' : 'OFFLINE',
      pct: statsTick?.system?.adsb_online ? 100 : 0,
      color: statsTick?.system?.adsb_online ? 'var(--accent)' : 'var(--danger)',
    },
    {
      label: 'Celery',
      val: statsTick?.system?.celery_ok ? 'OK' : 'DOWN',
      pct: statsTick?.system?.celery_ok ? 100 : 0,
      color: statsTick?.system?.celery_ok ? 'var(--accent)' : 'var(--danger)',
    },
  ];

  return (
    <div className="v2-stats" data-testid="v2-stats">
      {/* toolbar */}
      <div className="v2-stats__toolbar">
        <span className="v2-stats__toolbar-label">
          <Icon name="clock" size={14} strokeWidth={1.7} />
          TIME RANGE
        </span>
        <div className="v2-stats__ranges">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              className={`v2-stats__range ${range === r ? 'v2-stats__range--on' : ''}`}
              onClick={() => setRange(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="v2-stats__mil"
          aria-pressed={milOnly}
          onClick={() => setMilOnly(!milOnly)}
        >
          <span className={`v2-stats__mil-box ${milOnly ? 'v2-stats__mil-box--on' : ''}`}>
            {milOnly && <Icon name="check" size={11} strokeWidth={3} />}
          </span>
          Military Only
        </button>
      </div>

      <div className="v2-stats__grid">
        {/* LEFT RAIL */}
        <div className="v2-stats__rail">
          <div className="v2-stats__rail-title">
            <span className="v2-stats__live-dot" />
            LIVE FEED
          </div>
          {feeds.map((f) => (
            <div key={f.key} className="v2-stats__card">
              <div className="v2-stats__card-head">
                <Icon name={f.icon} size={13} strokeWidth={1.8} style={{ color: f.color }} />
                <span>{f.title}</span>
              </div>
              <div className="v2-stats__feed-rows">
                {f.rows.length === 0 ? (
                  <div className="v2-stats__feed-empty">no data</div>
                ) : (
                  f.rows.map((r) => (
                    <button
                      key={r.hex}
                      type="button"
                      className="v2-stats__feed-row"
                      onClick={() => onSelectAircraft(r.hex)}
                    >
                      <span className="v2-stats__feed-n">{r.n}</span>
                      <span className="v2-stats__feed-cs">{r.cs}</span>
                      <span className="v2-stats__feed-val" style={{ color: f.color }}>
                        {r.val}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          ))}
          <div className="v2-stats__card">
            <div className="v2-stats__card-head">
              <Icon
                name="alert-triangle"
                size={13}
                strokeWidth={1.8}
                style={{ color: 'var(--warn)' }}
              />
              <span>Squawk Watchlist</span>
            </div>
            {watchlist.length === 0 ? (
              <div className="v2-stats__allclear">
                <span className="v2-stats__allclear-icon">
                  <Icon name="check" size={18} strokeWidth={2} />
                </span>
                <span className="v2-stats__allclear-title">All Clear</span>
                <span className="v2-stats__allclear-sub">No emergency squawks active</span>
              </div>
            ) : (
              <div className="v2-stats__feed-rows">
                {watchlist.map((w) => (
                  <button
                    key={w.hex}
                    type="button"
                    className="v2-stats__feed-row"
                    onClick={() => onSelectAircraft(w.hex)}
                  >
                    <span className="v2-stats__feed-cs" style={{ color: 'var(--danger)' }}>
                      {w.cs}
                    </span>
                    <span className="v2-stats__feed-val" style={{ color: 'var(--danger)' }}>
                      {w.squawk}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* CENTER */}
        <div className="v2-stats__center">
          {/* KPI cards */}
          <div className="v2-stats__kpis">
            {kpis.map((k) => (
              <div key={k.label} className="v2-stats__kpi">
                <div className="v2-stats__kpi-head">
                  <Icon name={k.icon} size={14} strokeWidth={1.7} style={{ color: k.color }} />
                  <span>{k.label}</span>
                </div>
                <div className="v2-stats__kpi-vals">
                  <div>
                    <span className="v2-stats__kpi-v1" style={{ color: k.color }}>
                      {k.v1}
                    </span>
                    <span className="v2-stats__kpi-l">{k.l1}</span>
                  </div>
                  <div>
                    <span className="v2-stats__kpi-v2">{k.v2}</span>
                    <span className="v2-stats__kpi-l">{k.l2}</span>
                  </div>
                </div>
                {k.line && (
                  <svg width="100%" height="40" viewBox="0 0 100 40" preserveAspectRatio="none">
                    <polyline
                      points={k.area}
                      fill={`color-mix(in srgb, ${k.color} 14%, transparent)`}
                      stroke="none"
                    />
                    <polyline
                      points={k.line}
                      fill="none"
                      stroke={k.color}
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                )}
              </div>
            ))}
          </div>

          {/* distributions */}
          <div className="v2-stats__two-col">
            <div className="v2-stats__panel">
              <div className="v2-stats__panel-title">Altitude Distribution</div>
              <PanelBars items={altDist} />
            </div>
            <div className="v2-stats__panel">
              <div className="v2-stats__panel-title">Flight Categories</div>
              <PanelBars items={cats} />
            </div>
          </div>

          {/* safety events */}
          <div className="v2-stats__panel">
            <div className="v2-stats__panel-head">
              <Icon name="shield" size={14} strokeWidth={1.7} style={{ color: 'var(--purple)' }} />
              <span>Safety Events ({range})</span>
              <span className="v2-stats__badge">{safetyEvents.length} total</span>
            </div>
            {typeBars.length === 0 ? (
              <div className="v2-stats__feed-empty">No safety events in this window</div>
            ) : (
              <PanelBars items={typeBars} />
            )}
          </div>

          {/* antenna analytics */}
          <div className="v2-stats__panel">
            <div className="v2-stats__panel-head">
              <Icon
                name="line-chart"
                size={14}
                strokeWidth={1.7}
                style={{ color: 'var(--accent)' }}
              />
              <span>Antenna Analytics</span>
            </div>
            <div className="v2-stats__two-col">
              <div className="v2-stats__subpanel">
                <div className="v2-stats__subpanel-title">Antenna Coverage</div>
                <svg width="100%" viewBox="0 0 200 200" style={{ display: 'block' }}>
                  <circle
                    cx="100"
                    cy="100"
                    r="80"
                    fill="none"
                    stroke="var(--bord2)"
                    strokeWidth="1"
                  />
                  <circle
                    cx="100"
                    cy="100"
                    r="53"
                    fill="none"
                    stroke="var(--bord2)"
                    strokeWidth="1"
                  />
                  <circle
                    cx="100"
                    cy="100"
                    r="26"
                    fill="none"
                    stroke="var(--bord2)"
                    strokeWidth="1"
                  />
                  <line x1="100" y1="18" x2="100" y2="182" stroke="var(--bord2)" strokeWidth="1" />
                  <line x1="18" y1="100" x2="182" y2="100" stroke="var(--bord2)" strokeWidth="1" />
                  {coverage && (
                    <polygon
                      points={coverage}
                      fill="color-mix(in srgb, var(--accent2) 22%, transparent)"
                      stroke="var(--accent2)"
                      strokeWidth="1.5"
                    />
                  )}
                  <text x="100" y="13" fill="var(--dim)" fontSize="9" textAnchor="middle">
                    N
                  </text>
                  <text x="192" y="103" fill="var(--dim)" fontSize="9" textAnchor="middle">
                    E
                  </text>
                  <text x="100" y="196" fill="var(--dim)" fontSize="9" textAnchor="middle">
                    S
                  </text>
                  <text x="8" y="103" fill="var(--dim)" fontSize="9" textAnchor="middle">
                    W
                  </text>
                </svg>
                <div className="v2-stats__subpanel-foot">
                  <span>{antennaAnalytics?.total_positions ?? 0} sightings</span>
                  <span>{antennaAnalytics?.sectors_with_data ?? 0} sectors</span>
                </div>
              </div>
              <div className="v2-stats__subpanel">
                <div className="v2-stats__subpanel-title">Signal vs Distance</div>
                <svg width="100%" viewBox="0 0 220 180" style={{ display: 'block' }}>
                  <line x1="34" y1="10" x2="34" y2="150" stroke="var(--bord2)" strokeWidth="1" />
                  <line x1="34" y1="150" x2="214" y2="150" stroke="var(--bord2)" strokeWidth="1" />
                  <line
                    x1="34"
                    y1="50"
                    x2="214"
                    y2="50"
                    stroke="var(--bord)"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  <line
                    x1="34"
                    y1="100"
                    x2="214"
                    y2="100"
                    stroke="var(--bord)"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  <text x="28" y="14" fill="var(--dim2)" fontSize="8" textAnchor="end">
                    0
                  </text>
                  <text x="28" y="53" fill="var(--dim2)" fontSize="8" textAnchor="end">
                    -10
                  </text>
                  <text x="28" y="103" fill="var(--dim2)" fontSize="8" textAnchor="end">
                    -20
                  </text>
                  <text x="28" y="150" fill="var(--dim2)" fontSize="8" textAnchor="end">
                    -30
                  </text>
                  {scatterData.regY0 != null && (
                    <line
                      x1="34"
                      y1={scatterData.regY0}
                      x2="214"
                      y2={scatterData.regY1}
                      stroke="var(--warn)"
                      strokeWidth="1.5"
                      strokeDasharray="4 3"
                    />
                  )}
                  {scatterData.scatter.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r="2.2" fill="var(--accent2)" opacity="0.7" />
                  ))}
                  <text x="124" y="174" fill="var(--dim)" fontSize="9" textAnchor="middle">
                    Distance (nm)
                  </text>
                </svg>
                <div className="v2-stats__subpanel-foot v2-stats__subpanel-foot--center">
                  {scatterData.scatter.length} samples
                  {scatterData.r != null && ` · r = ${scatterData.r}`}
                </div>
              </div>
            </div>
          </div>

          {/* historical analytics */}
          <div className="v2-stats__panel">
            <div className="v2-stats__panel-head">
              <Icon
                name="bar-chart"
                size={14}
                strokeWidth={1.7}
                style={{ color: 'var(--accent)' }}
              />
              <span>Historical Analytics</span>
              <div className="v2-stats__seg">
                {HIST_TABS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`v2-stats__seg-btn ${histTab === t ? 'v2-stats__seg-btn--on' : ''}`}
                    onClick={() => setHistTab(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            {histTab === 'Trends' ? (
              <div className="v2-stats__subpanel">
                <div className="v2-stats__legend">
                  <span>
                    <span
                      className="v2-stats__legend-line"
                      style={{ background: 'var(--accent2)' }}
                    />
                    Aircraft tracked
                  </span>
                  <span>
                    <span
                      className="v2-stats__legend-line"
                      style={{ background: 'var(--accent)' }}
                    />
                    Msg rate
                  </span>
                </div>
                {trends.lineA ? (
                  <svg width="100%" height="180" viewBox="0 0 100 50" preserveAspectRatio="none">
                    <line
                      x1="0"
                      y1="12.5"
                      x2="100"
                      y2="12.5"
                      stroke="var(--bord)"
                      strokeWidth="0.4"
                    />
                    <line x1="0" y1="25" x2="100" y2="25" stroke="var(--bord)" strokeWidth="0.4" />
                    <line
                      x1="0"
                      y1="37.5"
                      x2="100"
                      y2="37.5"
                      stroke="var(--bord)"
                      strokeWidth="0.4"
                    />
                    <polyline
                      points={trends.areaA}
                      fill="color-mix(in srgb, var(--accent2) 16%, transparent)"
                      stroke="none"
                    />
                    <polyline
                      points={trends.lineA}
                      fill="none"
                      stroke="var(--accent2)"
                      strokeWidth="1.6"
                      vectorEffect="non-scaling-stroke"
                    />
                    <polyline
                      points={trends.lineB}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth="1.6"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                ) : (
                  <div className="v2-stats__feed-empty">Collecting live samples…</div>
                )}
              </div>
            ) : (
              <div className="v2-stats__subpanel">
                {histBars.length === 0 ? (
                  <div className="v2-stats__feed-empty">No session data in this window</div>
                ) : (
                  <PanelBars items={histBars} />
                )}
              </div>
            )}
          </div>

          {/* extended analytics: flight patterns */}
          <div className="v2-stats__panel">
            <div className="v2-stats__panel-head">
              <Icon name="map" size={14} strokeWidth={1.7} style={{ color: 'var(--accent)' }} />
              <span>Flight Patterns</span>
            </div>
            <div className="v2-stats__two-col">
              <div className="v2-stats__subpanel">
                <div className="v2-stats__subpanel-title">Activity by Hour</div>
                <div className="v2-stats__hours">
                  {hoursHeat.map((h) => (
                    <div
                      key={h.label}
                      title={`${h.label}:00 · ${h.count}`}
                      style={{ background: h.color, color: h.fg }}
                    >
                      {h.label}
                    </div>
                  ))}
                </div>
                <div className="v2-stats__hours-legend">
                  Low
                  <span />
                  High
                </div>
              </div>
              <div className="v2-stats__subpanel">
                <div className="v2-stats__subpanel-title">Aircraft Types</div>
                {types.length === 0 ? (
                  <div className="v2-stats__feed-empty">No session data</div>
                ) : (
                  <PanelBars
                    items={types.map((t) => ({ label: t.type, count: t.count, pct: t.pct }))}
                  />
                )}
              </div>
              <div className="v2-stats__subpanel">
                <div className="v2-stats__subpanel-title">Avg Duration by Type</div>
                {durations.length === 0 ? (
                  <div className="v2-stats__feed-empty">No session data</div>
                ) : (
                  <PanelBars
                    items={durations.map((d) => ({
                      label: d.type,
                      disp: `${d.min} min`,
                      pct: d.pct,
                      color: 'var(--warn)',
                    }))}
                  />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT RAIL */}
        <div className="v2-stats__rail">
          <div className="v2-stats__rail-title">SYSTEM &amp; SAFETY</div>
          <div className="v2-stats__card">
            <div className="v2-stats__card-head">
              <Icon name="cpu" size={13} strokeWidth={1.8} style={{ color: 'var(--accent)' }} />
              <span>System Health</span>
            </div>
            <div className="v2-stats__health">
              {health.map((h) => (
                <div key={h.label} className="v2-stats__health-row">
                  <div className="v2-stats__health-head">
                    <span>{h.label}</span>
                    <span style={{ color: h.color }}>{h.val}</span>
                  </div>
                  <div className="v2-stats__dist-track" style={{ height: 4 }}>
                    <div
                      className="v2-stats__dist-fill"
                      style={{
                        width: `${Math.max(0, Math.min(100, h.pct))}%`,
                        background: h.color,
                        height: 4,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="v2-stats__card">
            <div className="v2-stats__card-head">
              <Icon name="shield" size={13} strokeWidth={1.8} style={{ color: 'var(--purple)' }} />
              <span>Safety Events</span>
              <span className="v2-stats__card-aside">{range}</span>
            </div>
            <div className="v2-stats__sev">
              <div className="v2-stats__sev-cell v2-stats__sev-cell--crit">
                <div>{severity.critical}</div>
                <span>CRITICAL</span>
              </div>
              <div className="v2-stats__sev-cell v2-stats__sev-cell--warn">
                <div>{severity.warning}</div>
                <span>WARNING</span>
              </div>
              <div className="v2-stats__sev-cell">
                <div style={{ color: 'var(--accent2)' }}>{severity.info}</div>
                <span>INFO</span>
              </div>
            </div>
          </div>
          <div className="v2-stats__card v2-stats__card--pad">
            <div className="v2-stats__card-head v2-stats__card-head--bare">
              <Icon name="signal" size={13} strokeWidth={1.8} style={{ color: 'var(--accent)' }} />
              <span>Connection</span>
            </div>
            <div className="v2-stats__conn">
              <span
                className="v2-stats__conn-dot"
                style={{ background: connected ? 'var(--accent)' : 'var(--danger)' }}
              />
              <span style={{ color: connected ? 'var(--accent)' : 'var(--danger)' }}>
                {connected ? 'WebSocket Active' : 'Disconnected'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
