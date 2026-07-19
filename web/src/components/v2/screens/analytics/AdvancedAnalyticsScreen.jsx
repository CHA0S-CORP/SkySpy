import React, { useMemo } from 'react';
import { Icon, Select, SegmentedControl } from '../../primitives';
import { useHashParamState } from '../../../../hooks/useHashParamState';
import { RANGE_HOURS, useAnalyticsData } from './useAnalyticsData';
import {
  FIELD_FALLBACK,
  aircraftTypeRows,
  barsFrom,
  correlationStrength,
  crossDomainRows,
  hourHeat,
  matrixGrid,
  militaryRows,
  routeRows,
  scatterGeometry,
} from './analyticsModel';

const RANGES = ['1h', '6h', '24h', '48h', '7d'];
const MIL_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'civ', label: 'Civil' },
  { value: 'mil', label: 'Military' },
];

/** Small labelled bar-list panel body (mirrors the Statistics screen). */
function BarList({ items, color = 'var(--accent2)', unit = '' }) {
  if (!items.length) return <div className="v2-analytics__empty">No data in range</div>;
  return items.map((a, i) => (
    <div key={`${a.label}-${i}`} className="v2-analytics__bar-row">
      <div className="v2-analytics__bar-head">
        <span className="v2-analytics__bar-label" title={a.label}>
          {a.label}
        </span>
        <strong className="v2-mono">
          {a.value}
          {unit}
        </strong>
      </div>
      <div className="v2-analytics__bar-track">
        <div className="v2-analytics__bar-fill" style={{ width: `${a.pct}%`, background: color }} />
      </div>
    </div>
  ));
}

/**
 * v2 Advanced Analytics screen: cross-correlate sightings and data points.
 * Build-your-own scatter explorer (Pearson r + regression) + correlation matrix
 * + curated correlation panels + cross-domain per-aircraft impact + geographic
 * and time-of-day patterns.
 *
 * @param {object} props
 * @param {string} props.apiBase
 * @param {(hex: string) => void} props.onSelectAircraft
 */
export function AdvancedAnalyticsScreen({ apiBase, onSelectAircraft }) {
  // Deep-linked view state (#analytics?range=&x=&y=&mil=)
  const [range, setRange] = useHashParamState('range', '24h');
  const [xField, setXField] = useHashParamState('x', 'distance_nm');
  const [yField, setYField] = useHashParamState('y', 'rssi');
  const [military, setMilitary] = useHashParamState('mil', 'all');

  const hours = RANGE_HOURS[range] ?? 24;
  const {
    fields,
    scatter,
    matrix,
    crossDomain,
    correlation,
    geography,
    operators,
    busiestHours,
    routes,
    aircraftTypes,
    militaryBreakdown,
  } = useAnalyticsData(apiBase, { hours, xField, yField, military });

  const fieldOpts = useMemo(() => {
    const list = fields.data?.length ? fields.data : FIELD_FALLBACK;
    return list.map((f) => ({ value: f.key, label: f.label }));
  }, [fields.data]);

  const geo = useMemo(() => scatterGeometry(scatter.data), [scatter.data]);
  const strength = useMemo(() => correlationStrength(scatter.data?.r), [scatter.data]);
  const grid = useMemo(() => matrixGrid(matrix.data), [matrix.data]);
  const rows = useMemo(() => crossDomainRows(crossDomain.data), [crossDomain.data]);
  const countryBars = useMemo(
    () => barsFrom(geography.data?.countries, 'country', 'count'),
    [geography.data]
  );
  const opBars = useMemo(
    () => barsFrom(operators.data?.operators, 'operator', 'count'),
    [operators.data]
  );
  const hourCells = useMemo(() => hourHeat(busiestHours.data?.busiest_hours), [busiestHours.data]);
  const routeList = useMemo(() => routeRows(routes.data), [routes.data]);
  const typeList = useMemo(() => aircraftTypeRows(aircraftTypes.data), [aircraftTypes.data]);
  const milList = useMemo(() => militaryRows(militaryBreakdown.data), [militaryBreakdown.data]);
  const dayNight = busiestHours.data;

  const altSpeed = useMemo(
    () =>
      barsFrom(
        (correlation.data?.altitude_vs_speed || []).map((d) => ({
          label: d.altitude_band,
          v: Math.round(d.avg_speed || 0),
        })),
        'label',
        'v'
      ),
    [correlation.data]
  );
  const distAlt = useMemo(
    () =>
      barsFrom(
        (correlation.data?.distance_vs_altitude || []).map((d) => ({
          label: d.distance_band,
          v: Math.round((d.avg_altitude || 0) / 1000),
        })),
        'label',
        'v'
      ),
    [correlation.data]
  );

  const swapAxes = () => {
    setXField(yField);
    setYField(xField);
  };

  const loadPair = (xKey, yKey) => {
    if (xKey === yKey) return;
    setXField(xKey);
    setYField(yKey);
  };

  const fieldLabel = (key) => fieldOpts.find((o) => o.value === key)?.label ?? key;

  return (
    <div className="v2-analytics" data-testid="v2-analytics">
      {/* Toolbar */}
      <div className="v2-analytics__toolbar">
        <div className="v2-analytics__title">
          <Icon name="line-chart" size={18} strokeWidth={1.8} style={{ color: 'var(--accent)' }} />
          <span>Advanced Analytics</span>
        </div>
        <div className="v2-analytics__toolbar-group">
          <span className="v2-analytics__eyebrow">
            <Icon name="filter" size={13} strokeWidth={1.7} />
            Fleet
          </span>
          <SegmentedControl options={MIL_OPTIONS} value={military} onChange={setMilitary} />
        </div>
        <div className="v2-analytics__toolbar-group">
          <span className="v2-analytics__eyebrow">
            <Icon name="clock" size={13} strokeWidth={1.7} />
            Range
          </span>
          <div className="v2-analytics__ranges">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                className={`v2-analytics__range ${range === r ? 'v2-analytics__range--on' : ''}`}
                onClick={() => setRange(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Explorer + matrix */}
      <div className="v2-analytics__grid2">
        {/* Correlation Explorer */}
        <section className="v2-analytics__card">
          <div className="v2-analytics__card-head">
            <Icon
              name="crosshair"
              size={14}
              strokeWidth={1.8}
              style={{ color: 'var(--accent2)' }}
            />
            <span>Correlation Explorer</span>
            <span className="v2-analytics__count">{scatter.data?.n ?? 0} pts</span>
            {scatter.data?.sampled && (
              <span
                className="v2-analytics__badge"
                title="Row cap hit — computed on a sample of the data"
              >
                Sampled
              </span>
            )}
          </div>
          <div className="v2-analytics__explorer">
            <div className="v2-analytics__axes">
              <div className="v2-analytics__axis">
                <span className="v2-analytics__axis-label">X</span>
                <Select
                  options={fieldOpts}
                  value={xField}
                  onChange={setXField}
                  label="X axis field"
                />
              </div>
              <button
                type="button"
                className="v2-analytics__swap"
                onClick={swapAxes}
                title="Swap axes"
                aria-label="Swap axes"
              >
                <Icon name="refresh" size={15} strokeWidth={1.8} />
              </button>
              <div className="v2-analytics__axis">
                <span className="v2-analytics__axis-label">Y</span>
                <Select
                  options={fieldOpts}
                  value={yField}
                  onChange={setYField}
                  label="Y axis field"
                />
              </div>
            </div>

            <div className="v2-analytics__r" style={{ borderColor: strength.color }}>
              <span className="v2-analytics__r-val v2-mono" style={{ color: strength.color }}>
                {scatter.data?.r != null ? scatter.data.r.toFixed(3) : '—'}
              </span>
              <span className="v2-analytics__r-lab">Pearson r · {strength.label}</span>
              {scatter.data?.slope != null && scatter.data?.intercept != null && (
                <span className="v2-analytics__fit v2-mono" title="Least-squares regression fit">
                  y = {scatter.data.slope.toFixed(3)}x {scatter.data.intercept >= 0 ? '+' : '−'}{' '}
                  {Math.abs(scatter.data.intercept).toFixed(2)}
                </span>
              )}
            </div>

            <svg
              className="v2-analytics__scatter"
              viewBox={`0 0 ${geo.w} ${geo.h}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={`${fieldLabel(xField)} vs ${fieldLabel(yField)} scatter`}
            >
              {/* plot frame */}
              <line
                x1={geo.plot.x0}
                y1={geo.plot.y0}
                x2={geo.plot.x1}
                y2={geo.plot.y0}
                stroke="var(--bord2)"
              />
              <line
                x1={geo.plot.x0}
                y1={geo.plot.y0}
                x2={geo.plot.x0}
                y2={geo.plot.y1}
                stroke="var(--bord2)"
              />
              {geo.empty ? (
                <text
                  x={geo.w / 2}
                  y={geo.h / 2}
                  textAnchor="middle"
                  fill="var(--dim)"
                  fontSize="11"
                >
                  No data in range
                </text>
              ) : (
                <>
                  {geo.dots.map((d, i) => (
                    <circle
                      key={i}
                      cx={d.cx}
                      cy={d.cy}
                      r="2.1"
                      fill="var(--accent2)"
                      opacity="0.65"
                    />
                  ))}
                  {geo.reg && (
                    <line
                      x1={geo.reg.x1}
                      y1={geo.reg.y1}
                      x2={geo.reg.x2}
                      y2={geo.reg.y2}
                      stroke="var(--warn)"
                      strokeWidth="1.6"
                      strokeDasharray="4 3"
                    />
                  )}
                </>
              )}
              {/* axis captions */}
              <text
                x={(geo.plot.x0 + geo.plot.x1) / 2}
                y={geo.h - 6}
                textAnchor="middle"
                fill="var(--dim)"
                fontSize="9"
              >
                {fieldLabel(xField)}
              </text>
              <text
                x={12}
                y={(geo.plot.y0 + geo.plot.y1) / 2}
                textAnchor="middle"
                fill="var(--dim)"
                fontSize="9"
                transform={`rotate(-90 12 ${(geo.plot.y0 + geo.plot.y1) / 2})`}
              >
                {fieldLabel(yField)}
              </text>
            </svg>
          </div>
        </section>

        {/* Correlation matrix */}
        <section className="v2-analytics__card">
          <div className="v2-analytics__card-head">
            <Icon name="grid" size={14} strokeWidth={1.8} style={{ color: 'var(--accent)' }} />
            <span>Correlation Matrix</span>
            <span className="v2-analytics__count">
              {matrix.data?.n != null ? `n=${matrix.data.n}` : 'click a cell'}
            </span>
            {matrix.data?.sampled && (
              <span
                className="v2-analytics__badge"
                title="Row cap hit — computed on a sample of the data"
              >
                Sampled
              </span>
            )}
          </div>
          <div className="v2-analytics__matrix">
            {grid.length === 0 ? (
              <div className="v2-analytics__empty">No data in range</div>
            ) : (
              <table className="v2-analytics__matrix-table">
                <thead>
                  <tr>
                    <th />
                    {grid.map((row) => (
                      <th key={row.key} title={row.label}>
                        {row.label.split(' ')[0]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.map((row) => (
                    <tr key={row.key}>
                      <th title={row.label}>{row.label.split(' ')[0]}</th>
                      {row.cells.map((cell) => (
                        <td
                          key={cell.key}
                          className={`v2-analytics__cell ${cell.self ? 'v2-analytics__cell--self' : ''}`}
                          style={{ background: cell.color }}
                          title={`${row.label} × ${fieldLabel(cell.key)}: ${cell.r ?? 'n/a'}`}
                          onClick={() => !cell.self && loadPair(cell.key, row.key)}
                        >
                          {cell.r != null ? cell.r.toFixed(2) : '·'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      {/* Curated correlation panels */}
      <div className="v2-analytics__grid3">
        <section className="v2-analytics__card">
          <div className="v2-analytics__card-head">
            <Icon name="signal" size={14} strokeWidth={1.8} style={{ color: 'var(--accent2)' }} />
            <span>Avg Speed by Altitude</span>
          </div>
          <div className="v2-analytics__card-body">
            <BarList items={altSpeed} color="var(--accent2)" unit=" kt" />
          </div>
        </section>
        <section className="v2-analytics__card">
          <div className="v2-analytics__card-head">
            <Icon name="map-pin" size={14} strokeWidth={1.8} style={{ color: 'var(--accent)' }} />
            <span>Avg Altitude by Distance</span>
          </div>
          <div className="v2-analytics__card-body">
            <BarList items={distAlt} color="var(--accent)" unit="k ft" />
          </div>
        </section>
        <section className="v2-analytics__card">
          <div className="v2-analytics__card-head">
            <Icon name="clock" size={14} strokeWidth={1.8} style={{ color: 'var(--purple)' }} />
            <span>Activity by Hour</span>
          </div>
          <div className="v2-analytics__card-body">
            <div className="v2-analytics__hours">
              {hourCells.map((h) => (
                <div
                  key={h.label}
                  className="v2-analytics__hour"
                  title={`${h.label}:00 · ${h.count}`}
                  style={{ background: h.color, color: h.fg }}
                >
                  {h.label}
                </div>
              ))}
            </div>
            {dayNight && (dayNight.peak_hour != null || dayNight.day_night_ratio != null) && (
              <div className="v2-analytics__daynight">
                {dayNight.peak_hour != null && (
                  <div className="v2-analytics__stat">
                    <span className="v2-analytics__stat-lab">Peak</span>
                    <strong className="v2-mono">
                      {String(dayNight.peak_hour).padStart(2, '0')}:00
                      {dayNight.peak_aircraft_count != null && (
                        <span className="v2-analytics__muted">
                          {' '}
                          · {dayNight.peak_aircraft_count} ac
                        </span>
                      )}
                    </strong>
                  </div>
                )}
                {dayNight.day_positions != null && dayNight.night_positions != null && (
                  <div className="v2-analytics__stat">
                    <span className="v2-analytics__stat-lab">Day / Night</span>
                    <strong className="v2-mono">
                      {dayNight.day_positions.toLocaleString()} /{' '}
                      {dayNight.night_positions.toLocaleString()}
                      {dayNight.day_night_ratio != null && (
                        <span className="v2-analytics__muted"> · {dayNight.day_night_ratio}×</span>
                      )}
                    </strong>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Cross-domain impact table */}
      <section className="v2-analytics__card">
        <div className="v2-analytics__card-head">
          <Icon name="target" size={14} strokeWidth={1.8} style={{ color: 'var(--danger)' }} />
          <span>Cross-Domain Impact</span>
          <span className="v2-analytics__count">sightings · alerts · safety · ACARS</span>
        </div>
        <div className="v2-analytics__card-body">
          {rows.length === 0 ? (
            <div className="v2-analytics__empty">No cross-domain activity in range</div>
          ) : (
            <table className="v2-analytics__impact">
              <thead>
                <tr>
                  <th>Aircraft</th>
                  <th>Type</th>
                  <th className="v2-analytics__num">Sight</th>
                  <th className="v2-analytics__num">Alerts</th>
                  <th className="v2-analytics__num">Safety</th>
                  <th className="v2-analytics__num">ACARS</th>
                  <th>Activity</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.icao_hex}
                    className="v2-analytics__impact-row"
                    onClick={() => onSelectAircraft?.(r.icao_hex)}
                    title={`Open ${r.label}`}
                  >
                    <td>
                      <span className="v2-mono">{r.label}</span>
                      {r.is_military && <span className="v2-analytics__mil">MIL</span>}
                    </td>
                    <td className="v2-analytics__muted">{r.type_code || '—'}</td>
                    <td className="v2-analytics__num v2-mono">{r.sightings}</td>
                    <td className="v2-analytics__num v2-mono">{r.alerts}</td>
                    <td className="v2-analytics__num v2-mono">{r.safety_events}</td>
                    <td className="v2-analytics__num v2-mono">{r.acars}</td>
                    <td>
                      <div className="v2-analytics__bar-track">
                        <div
                          className="v2-analytics__bar-fill"
                          style={{ width: `${r.pct}%`, background: 'var(--danger)' }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Frequent routes + common aircraft types */}
      <div className="v2-analytics__grid2">
        <section className="v2-analytics__card">
          <div className="v2-analytics__card-head">
            <Icon name="share" size={14} strokeWidth={1.8} style={{ color: 'var(--accent2)' }} />
            <span>Frequent Routes</span>
            {routes.data?.total_routes != null && (
              <span className="v2-analytics__count">{routes.data.total_routes} routes</span>
            )}
          </div>
          <div className="v2-analytics__card-body">
            {routeList.length === 0 ? (
              <div className="v2-analytics__empty">No routes in range</div>
            ) : (
              routeList.map((r) => (
                <div key={r.key} className="v2-analytics__bar-row">
                  <div className="v2-analytics__bar-head">
                    <span className="v2-analytics__bar-label" title={r.label}>
                      {r.label}
                    </span>
                    <strong className="v2-mono">{r.count}</strong>
                  </div>
                  <div className="v2-analytics__bar-track">
                    <div
                      className="v2-analytics__bar-fill"
                      style={{ width: `${r.pct}%`, background: 'var(--accent2)' }}
                    />
                  </div>
                  {r.callsigns.length > 0 && (
                    <div className="v2-analytics__subtle v2-mono">{r.callsigns.join(' · ')}</div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
        <section className="v2-analytics__card">
          <div className="v2-analytics__card-head">
            <Icon name="plane" size={14} strokeWidth={1.8} style={{ color: 'var(--accent)' }} />
            <span>Common Aircraft Types</span>
            {aircraftTypes.data?.total_types != null && (
              <span className="v2-analytics__count">{aircraftTypes.data.total_types} types</span>
            )}
          </div>
          <div className="v2-analytics__card-body">
            {typeList.length === 0 ? (
              <div className="v2-analytics__empty">No aircraft types in range</div>
            ) : (
              typeList.map((t) => (
                <div key={t.key} className="v2-analytics__bar-row">
                  <div className="v2-analytics__bar-head">
                    <span className="v2-analytics__bar-label" title={t.manufacturer || t.name}>
                      <span className="v2-mono">{t.code}</span>
                      {t.name !== t.code && <span className="v2-analytics__muted"> {t.name}</span>}
                    </span>
                    <strong className="v2-mono">
                      {t.count}
                      {t.unique > 0 && <span className="v2-analytics__muted"> · {t.unique}u</span>}
                    </strong>
                  </div>
                  <div className="v2-analytics__bar-track">
                    <div
                      className="v2-analytics__bar-fill"
                      style={{ width: `${t.pct}%`, background: 'var(--accent)' }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* Military vs civilian by country */}
      <section className="v2-analytics__card">
        <div className="v2-analytics__card-head">
          <Icon name="shield" size={14} strokeWidth={1.8} style={{ color: 'var(--warn)' }} />
          <span>Military vs Civilian by Country</span>
          <span className="v2-analytics__count">military share</span>
        </div>
        <div className="v2-analytics__card-body">
          {milList.length === 0 ? (
            <div className="v2-analytics__empty">No fleet-origin data in range</div>
          ) : (
            <table className="v2-analytics__impact">
              <thead>
                <tr>
                  <th>Country</th>
                  <th className="v2-analytics__num">Mil</th>
                  <th className="v2-analytics__num">Civ</th>
                  <th className="v2-analytics__num">Total</th>
                  <th>Military share</th>
                </tr>
              </thead>
              <tbody>
                {milList.map((m) => (
                  <tr key={m.key}>
                    <td>{m.country}</td>
                    <td className="v2-analytics__num v2-mono">{m.military}</td>
                    <td className="v2-analytics__num v2-mono">{m.civilian}</td>
                    <td className="v2-analytics__num v2-mono">{m.total}</td>
                    <td>
                      <div className="v2-analytics__split">
                        <div
                          className="v2-analytics__split-fill"
                          style={{ width: `${m.militaryPct ?? 0}%`, background: 'var(--warn)' }}
                        />
                        {m.militaryPct != null && (
                          <span className="v2-analytics__split-lab v2-mono">{m.militaryPct}%</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Geographic / operator */}
      <div className="v2-analytics__grid2">
        <section className="v2-analytics__card">
          <div className="v2-analytics__card-head">
            <Icon name="compass" size={14} strokeWidth={1.8} style={{ color: 'var(--accent2)' }} />
            <span>Countries of Origin</span>
          </div>
          <div className="v2-analytics__card-body">
            <BarList items={countryBars} color="var(--accent2)" />
          </div>
        </section>
        <section className="v2-analytics__card">
          <div className="v2-analytics__card-head">
            <Icon name="plane" size={14} strokeWidth={1.8} style={{ color: 'var(--accent)' }} />
            <span>Top Operators</span>
          </div>
          <div className="v2-analytics__card-body">
            <BarList items={opBars} color="var(--accent)" />
          </div>
        </section>
      </div>
    </div>
  );
}
