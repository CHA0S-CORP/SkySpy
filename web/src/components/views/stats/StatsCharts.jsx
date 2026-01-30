import React from 'react';

/**
 * HorizontalBarChart - Replaces pie charts for better readability
 */
export function HorizontalBarChart({ title, data, maxItems = 5, showPercentage = true }) {
  if (!data?.length) return null;

  const sortedData = [...data].sort((a, b) => b.count - a.count).slice(0, maxItems);
  const maxCount = sortedData[0]?.count || 1;

  return (
    <div className="horizontal-bar-chart">
      {title && <div className="bar-chart-title">{title}</div>}
      <div className="bar-chart-items">
        {sortedData.map((item, i) => (
          <div key={i} className="bar-item">
            <div className="bar-item-header">
              <span className="bar-item-label">{item.label || item.name || item.type}</span>
              <span className="bar-item-value">
                {item.count}
                {showPercentage && item.pct !== undefined && (
                  <span className="bar-item-pct">{item.pct.toFixed(0)}%</span>
                )}
              </span>
            </div>
            <div className="bar-item-track">
              <div
                className="bar-item-fill"
                style={{
                  width: `${(item.count / maxCount) * 100}%`,
                  backgroundColor: item.color || 'var(--accent-cyan)'
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * LiveSparkline - Real-time sparkline graph
 */
export function LiveSparkline({ data, valueKey, color, height = 60, label, currentValue, unit }) {
  const width = 200;
  const padding = 4;

  if (!data?.length) {
    return (
      <div className="sparkline-container empty">
        <div className="sparkline-header">
          <span className="sparkline-label">{label}</span>
          <span className="sparkline-value">--</span>
        </div>
      </div>
    );
  }

  const values = data.map(d => d[valueKey] || 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  // Handle edge case when there's only one data point
  if (values.length === 1) {
    const lastValue = values[0];
    const lastY = height - padding - ((lastValue - min) / range) * (height - padding * 2);
    return (
      <div className="sparkline-container">
        <div className="sparkline-header">
          <span className="sparkline-label">{label}</span>
          <span className="sparkline-value">
            {currentValue ?? lastValue?.toFixed(0) ?? '--'}
            {unit && <span className="sparkline-unit">{unit}</span>}
          </span>
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="sparkline-svg">
          <circle cx={width / 2} cy={lastY} r="4" fill={color} />
        </svg>
      </div>
    );
  }

  const points = values.map((v, i) => {
    const x = padding + (i / (values.length - 1)) * (width - padding * 2);
    const y = height - padding - ((v - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  }).join(' ');

  const areaPoints = `${padding},${height - padding} ${points} ${width - padding},${height - padding}`;
  const lastValue = values[values.length - 1];
  const lastY = height - padding - ((lastValue - min) / range) * (height - padding * 2);

  return (
    <div className="sparkline-container">
      <div className="sparkline-header">
        <span className="sparkline-label">{label}</span>
        <span className="sparkline-value">
          {currentValue ?? lastValue?.toFixed(0) ?? '--'}
          {unit && <span className="sparkline-unit">{unit}</span>}
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="sparkline-svg">
        <polygon points={areaPoints} fill={color} opacity="0.15" />
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={width - padding} cy={lastY} r="4" fill={color} />
      </svg>
    </div>
  );
}
