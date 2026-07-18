import React, { useMemo } from 'react';

/**
 * Self-contained SVG chart for assistant answers. Renders a chart spec emitted
 * by the agent inside a ```chart fenced block. No external charting dependency —
 * matches the project's custom-SVG chart idiom (see views/stats/StatsCharts.jsx).
 *
 * Spec shape (all fields tolerant / best-effort):
 *   { type: 'bar'|'hbar'|'line'|'area'|'pie'|'scatter',
 *     title?: string,
 *     xKey?: string,                       // row key for category/x label (numeric x for scatter)
 *     series?: [{ name, key, color }],     // one line/bar set per series
 *     data: [ { <xKey>: 'KSEA', value: 123, ... } ] }
 */

const PALETTE = ['#4aa3e0', '#e0774a', '#5ac77a', '#c77ae0', '#e0c74a', '#4ae0c7', '#e04a7a'];
const W = 520;
const H = 240;
const PAD = { top: 20, right: 16, bottom: 46, left: 46 };

const fmt = (n) => {
  if (typeof n !== 'number' || !isFinite(n)) return String(n ?? '');
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
};

/** Resolve which row key holds the x-axis label, tolerant of model key drift. */
function resolveXKey(spec, rows) {
  const candidates = [
    spec.xKey,
    'label',
    'name',
    'x',
    'category',
    'date',
    'hour',
    'time',
    'bucket',
  ];
  for (const k of candidates) {
    if (k && rows.some((r) => r && r[k] != null)) return k;
  }
  // Fall back to the first string-valued key.
  const first = rows.find((r) => r && typeof r === 'object') || {};
  return Object.keys(first).find((k) => typeof first[k] === 'string') || 'label';
}

/** Resolve series (name + numeric row key), deriving them if not supplied. */
function resolveSeries(spec, rows, xKey) {
  const provided = Array.isArray(spec.series)
    ? spec.series.filter((s) => s && (s.key || s.name))
    : [];
  const valid = provided.filter((s) => rows.some((r) => typeof r?.[s.key ?? s.name] === 'number'));
  if (valid.length) {
    return valid.map((s, i) => ({
      name: s.name || s.key,
      key: s.key || s.name,
      color: s.color || PALETTE[i % PALETTE.length],
    }));
  }
  // Derive: every numeric key that isn't the x key.
  const sample = rows.find((r) => r && typeof r === 'object') || {};
  const keys = Object.keys(sample).filter((k) => k !== xKey && typeof sample[k] === 'number');
  const chosen = keys.length ? keys : ['value'];
  return chosen.map((k, i) => ({ name: k, key: k, color: PALETTE[i % PALETTE.length] }));
}

function Legend({ series }) {
  if (series.length < 2) return null;
  return (
    <div className="v2-asst-chart__legend">
      {series.map((s) => (
        <span key={s.key} className="v2-asst-chart__legend-item">
          <span className="v2-asst-chart__swatch" style={{ background: s.color }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

function BarChart({ rows, xKey, series }) {
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const max = Math.max(1, ...rows.flatMap((r) => series.map((s) => Number(r[s.key]) || 0)));
  const groupW = innerW / rows.length;
  const barW = Math.max(2, (groupW * 0.7) / series.length);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="v2-asst-chart__svg" role="img">
      <line
        x1={PAD.left}
        y1={PAD.top + innerH}
        x2={PAD.left + innerW}
        y2={PAD.top + innerH}
        stroke="var(--bord2)"
      />
      {rows.map((r, ri) => {
        const gx = PAD.left + ri * groupW + groupW * 0.15;
        return (
          <g key={ri}>
            {series.map((s, si) => {
              const v = Number(r[s.key]) || 0;
              const h = (v / max) * innerH;
              return (
                <rect
                  key={s.key}
                  x={gx + si * barW}
                  y={PAD.top + innerH - h}
                  width={barW - 1}
                  height={h}
                  fill={s.color}
                  rx={1.5}
                >
                  <title>{`${r[xKey]} · ${s.name}: ${fmt(v)}`}</title>
                </rect>
              );
            })}
            <text
              x={gx + (barW * series.length) / 2}
              y={PAD.top + innerH + 14}
              textAnchor="middle"
              className="v2-asst-chart__xlabel"
            >
              {String(r[xKey] ?? '').slice(0, 8)}
            </text>
          </g>
        );
      })}
      <text x={PAD.left - 6} y={PAD.top + 4} textAnchor="end" className="v2-asst-chart__ylabel">
        {fmt(max)}
      </text>
      <text
        x={PAD.left - 6}
        y={PAD.top + innerH}
        textAnchor="end"
        className="v2-asst-chart__ylabel"
      >
        0
      </text>
    </svg>
  );
}

function LineChart({ rows, xKey, series, area }) {
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const max = Math.max(1, ...rows.flatMap((r) => series.map((s) => Number(r[s.key]) || 0)));
  const stepX = rows.length > 1 ? innerW / (rows.length - 1) : 0;
  const px = (i) => PAD.left + i * stepX;
  const py = (v) => PAD.top + innerH - ((Number(v) || 0) / max) * innerH;
  const labelEvery = Math.ceil(rows.length / 8);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="v2-asst-chart__svg" role="img">
      <line
        x1={PAD.left}
        y1={PAD.top + innerH}
        x2={PAD.left + innerW}
        y2={PAD.top + innerH}
        stroke="var(--bord2)"
      />
      {series.map((s) => {
        const pts = rows.map((r, i) => `${px(i)},${py(r[s.key])}`).join(' ');
        return (
          <g key={s.key}>
            {area && (
              <polygon
                points={`${PAD.left},${PAD.top + innerH} ${pts} ${PAD.left + (rows.length - 1) * stepX},${PAD.top + innerH}`}
                fill={s.color}
                opacity={0.15}
              />
            )}
            <polyline points={pts} fill="none" stroke={s.color} strokeWidth={2} />
            {rows.map((r, i) => (
              <circle key={i} cx={px(i)} cy={py(r[s.key])} r={2.5} fill={s.color}>
                <title>{`${r[xKey]} · ${s.name}: ${fmt(Number(r[s.key]) || 0)}`}</title>
              </circle>
            ))}
          </g>
        );
      })}
      {rows.map((r, i) =>
        i % labelEvery === 0 ? (
          <text
            key={i}
            x={px(i)}
            y={PAD.top + innerH + 14}
            textAnchor="middle"
            className="v2-asst-chart__xlabel"
          >
            {String(r[xKey] ?? '').slice(0, 8)}
          </text>
        ) : null
      )}
      <text x={PAD.left - 6} y={PAD.top + 4} textAnchor="end" className="v2-asst-chart__ylabel">
        {fmt(max)}
      </text>
      <text
        x={PAD.left - 6}
        y={PAD.top + innerH}
        textAnchor="end"
        className="v2-asst-chart__ylabel"
      >
        0
      </text>
    </svg>
  );
}

function PieChart({ rows, xKey, series }) {
  const key = series[0]?.key || 'value';
  const total = rows.reduce((sum, r) => sum + (Number(r[key]) || 0), 0) || 1;
  const cx = H / 2;
  const cy = H / 2;
  const rad = H / 2 - PAD.top;
  let angle = -Math.PI / 2;
  const slices = rows.map((r, i) => {
    const frac = (Number(r[key]) || 0) / total;
    const a0 = angle;
    const a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const x0 = cx + rad * Math.cos(a0);
    const y0 = cy + rad * Math.sin(a0);
    const x1 = cx + rad * Math.cos(a1);
    const y1 = cy + rad * Math.sin(a1);
    return {
      d: `M ${cx} ${cy} L ${x0} ${y0} A ${rad} ${rad} 0 ${large} 1 ${x1} ${y1} Z`,
      color: PALETTE[i % PALETTE.length],
      label: r[xKey],
      value: Number(r[key]) || 0,
      frac,
    };
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="v2-asst-chart__svg" role="img">
      {slices.map((s, i) => (
        <path key={i} d={s.d} fill={s.color} stroke="var(--bg1)" strokeWidth={1}>
          <title>{`${s.label}: ${fmt(s.value)} (${(s.frac * 100).toFixed(0)}%)`}</title>
        </path>
      ))}
      {slices.map((s, i) => (
        <g key={`l${i}`} transform={`translate(${H + 8}, ${PAD.top + i * 18})`}>
          <rect width={11} height={11} rx={2} fill={s.color} />
          <text x={16} y={10} className="v2-asst-chart__xlabel" textAnchor="start">
            {String(s.label ?? '').slice(0, 16)} · {fmt(s.value)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function HBarChart({ rows, xKey, series }) {
  const key = series[0]?.key || 'value';
  const color = series[0]?.color || PALETTE[0];
  const rowH = 26;
  const labelW = 120;
  const height = PAD.top + rows.length * rowH + 10;
  const barMaxW = W - labelW - PAD.right - 40;
  const max = Math.max(1, ...rows.map((r) => Number(r[key]) || 0));
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="v2-asst-chart__svg" role="img">
      {rows.map((r, i) => {
        const v = Number(r[key]) || 0;
        const w = (v / max) * barMaxW;
        const y = PAD.top + i * rowH;
        return (
          <g key={i}>
            <text
              x={labelW - 6}
              y={y + rowH / 2 + 3}
              textAnchor="end"
              className="v2-asst-chart__xlabel"
            >
              {String(r[xKey] ?? '').slice(0, 18)}
            </text>
            <rect x={labelW} y={y + 3} width={Math.max(1, w)} height={rowH - 8} fill={color} rx={2}>
              <title>{`${r[xKey]}: ${fmt(v)}`}</title>
            </rect>
            <text
              x={labelW + w + 5}
              y={y + rowH / 2 + 3}
              textAnchor="start"
              className="v2-asst-chart__ylabel"
            >
              {fmt(v)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ScatterChart({ rows, xKey, series }) {
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const yKey = series[0]?.key || 'value';
  const color = series[0]?.color || PALETTE[0];
  const xs = rows.map((r) => Number(r[xKey]) || 0);
  const ys = rows.map((r) => Number(r[yKey]) || 0);
  const xMax = Math.max(1, ...xs);
  const xMin = Math.min(0, ...xs);
  const yMax = Math.max(1, ...ys);
  const px = (v) => PAD.left + ((v - xMin) / (xMax - xMin || 1)) * innerW;
  const py = (v) => PAD.top + innerH - (v / yMax) * innerH;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="v2-asst-chart__svg" role="img">
      <line
        x1={PAD.left}
        y1={PAD.top + innerH}
        x2={PAD.left + innerW}
        y2={PAD.top + innerH}
        stroke="var(--bord2)"
      />
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + innerH} stroke="var(--bord2)" />
      {rows.map((r, i) => (
        <circle
          key={i}
          cx={px(Number(r[xKey]) || 0)}
          cy={py(Number(r[yKey]) || 0)}
          r={3.5}
          fill={color}
          opacity={0.75}
        >
          <title>{`${r.label ?? ''} ${xKey}=${fmt(Number(r[xKey]) || 0)}, ${series[0]?.name || yKey}=${fmt(Number(r[yKey]) || 0)}`}</title>
        </circle>
      ))}
      <text x={PAD.left - 6} y={PAD.top + 4} textAnchor="end" className="v2-asst-chart__ylabel">
        {fmt(yMax)}
      </text>
      <text
        x={PAD.left + innerW}
        y={PAD.top + innerH + 14}
        textAnchor="end"
        className="v2-asst-chart__xlabel"
      >
        {fmt(xMax)}
      </text>
    </svg>
  );
}

const TYPES = ['bar', 'hbar', 'line', 'area', 'pie', 'scatter'];

export function AssistantChart({ spec }) {
  const parsed = useMemo(() => {
    const rows = Array.isArray(spec?.data)
      ? spec.data.filter((r) => r && typeof r === 'object')
      : [];
    if (!rows.length) return null;
    const type = TYPES.includes(spec?.type) ? spec.type : 'bar';
    const xKey = resolveXKey(spec, rows);
    const series = resolveSeries(spec, rows, xKey);
    return { rows, xKey, series, type };
  }, [spec]);

  if (!parsed) return null;
  const { rows, xKey, series, type } = parsed;

  const chart =
    type === 'pie' ? (
      <PieChart rows={rows} xKey={xKey} series={series} />
    ) : type === 'hbar' ? (
      <HBarChart rows={rows} xKey={xKey} series={series} />
    ) : type === 'scatter' ? (
      <ScatterChart rows={rows} xKey={xKey} series={series} />
    ) : type === 'line' || type === 'area' ? (
      <LineChart rows={rows} xKey={xKey} series={series} area={type === 'area'} />
    ) : (
      <BarChart rows={rows} xKey={xKey} series={series} />
    );

  return (
    <figure className="v2-asst-chart">
      {spec?.title ? <figcaption className="v2-asst-chart__title">{spec.title}</figcaption> : null}
      {chart}
      {type !== 'pie' && type !== 'hbar' && type !== 'scatter' && <Legend series={series} />}
    </figure>
  );
}

export default AssistantChart;
