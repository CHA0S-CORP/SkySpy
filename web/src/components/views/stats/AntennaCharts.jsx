import React, { useState, useMemo, useRef } from 'react';
import { Navigation, Signal } from 'lucide-react';

/**
 * PolarPlot - Antenna reception polar diagram with real data
 */
export function PolarPlot({ data, loading }) {
  const bearingData = data?.bearing_data || [];
  const summary = data?.summary || {};

  // Interactive cursor state
  const [cursor, setCursor] = useState(null);
  const svgRef = useRef(null);

  // Chart dimensions
  const width = 240, height = 240;
  const cx = width / 2, cy = height / 2;
  const maxR = 95; // Maximum radius for data

  // Find max values for normalization
  const maxCount = Math.max(...bearingData.map(d => d.count || 0), 1);
  const maxDistance = Math.max(...bearingData.map(d => d.max_distance_nm || 0), 1);

  // Convert polar to cartesian
  const polarToCartesian = (angle, radius) => {
    const rad = (angle - 90) * (Math.PI / 180); // -90 to start at N
    return {
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad)
    };
  };

  // Generate polar path from bearing data
  const generatePolarPath = (valueKey, maxValue) => {
    if (!bearingData.length) return '';

    const points = bearingData.map(sector => {
      const value = sector[valueKey] || 0;
      const normalizedR = (value / maxValue) * maxR;
      const angle = sector.bearing_start + 5; // Center of 10-degree sector
      const { x, y } = polarToCartesian(angle, normalizedR);
      return `${x},${y}`;
    });

    return `M${points[0]} ${points.slice(1).map(p => `L${p}`).join(' ')} Z`;
  };

  const countPath = generatePolarPath('count', maxCount);
  const distancePath = generatePolarPath('max_distance_nm', maxDistance);

  // Ring radii for reference circles
  const rings = [24, 48, 72, 95];

  // Mouse handlers for interactive cursor
  const handleMouseMove = (e) => {
    if (!svgRef.current || !bearingData.length) return;
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // Calculate distance from center and angle
    const dx = x - cx;
    const dy = y - cy;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance <= maxR + 10) {
      // Calculate bearing angle (0 = N, 90 = E, etc.)
      let angle = Math.atan2(dx, -dy) * (180 / Math.PI);
      if (angle < 0) angle += 360;

      // Find the sector for this angle
      const sectorIndex = Math.floor(angle / 10);
      const sector = bearingData.find(s => Math.floor(s.bearing_start / 10) === sectorIndex);

      setCursor({
        x, y,
        bearing: Math.round(angle),
        sector,
        distance
      });
    } else {
      setCursor(null);
    }
  };

  const handleMouseLeave = () => setCursor(null);

  return (
    <div className="nerd-stats-card polar-plot">
      <div className="nerd-stats-header">
        <Navigation size={16} />
        <span>Antenna Coverage</span>
        {summary.coverage_pct != null && (
          <span className="nerd-badge live">{summary.coverage_pct}% COVERAGE</span>
        )}
      </div>
      <div className="polar-content">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className="polar-svg interactive"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          {/* Concentric circles */}
          {rings.map(r => (
            <circle key={r} cx={cx} cy={cy} r={r} className="polar-ring" />
          ))}
          {/* Cardinal directions */}
          <line x1={cx} y1={cy - maxR - 5} x2={cx} y2={cy + maxR + 5} className="polar-axis" />
          <line x1={cx - maxR - 5} y1={cy} x2={cx + maxR + 5} y2={cy} className="polar-axis" />
          {/* Diagonal axes */}
          <line x1={cx - 70} y1={cy - 70} x2={cx + 70} y2={cy + 70} className="polar-axis-minor" />
          <line x1={cx + 70} y1={cy - 70} x2={cx - 70} y2={cy + 70} className="polar-axis-minor" />
          {/* Labels */}
          <text x={cx} y={18} className="polar-label">N</text>
          <text x={cx} y={height - 8} className="polar-label">S</text>
          <text x={12} y={cy + 4} className="polar-label">W</text>
          <text x={width - 12} y={cy + 4} className="polar-label">E</text>
          {/* Distance pattern (outer) */}
          {distancePath && (
            <path d={distancePath} className="polar-pattern-distance" />
          )}
          {/* Count pattern (inner) */}
          {countPath && (
            <path d={countPath} className="polar-pattern-count" />
          )}
          {/* Interactive cursor */}
          {cursor && (
            <g className="polar-cursor">
              {/* Bearing line from center */}
              <line
                x1={cx}
                y1={cy}
                x2={cursor.x}
                y2={cursor.y}
                className="cursor-line"
              />
              {/* Highlight the hovered sector */}
              {cursor.sector && (() => {
                const startAngle = cursor.sector.bearing_start;
                const endAngle = startAngle + 10;
                const countR = (cursor.sector.count / maxCount) * maxR;
                const distR = (cursor.sector.max_distance_nm / maxDistance) * maxR;
                const start1 = polarToCartesian(startAngle, Math.max(countR, distR));
                const end1 = polarToCartesian(endAngle, Math.max(countR, distR));
                return (
                  <>
                    <line x1={cx} y1={cy} x2={start1.x} y2={start1.y} className="cursor-sector-line" />
                    <line x1={cx} y1={cy} x2={end1.x} y2={end1.y} className="cursor-sector-line" />
                  </>
                );
              })()}
              {/* Center point */}
              <circle cx={cursor.x} cy={cursor.y} r="4" className="cursor-highlight" />
            </g>
          )}
        </svg>
        {/* Cursor tooltip */}
        {cursor?.sector && (
          <div className="polar-tooltip">
            <span className="tooltip-bearing">{cursor.bearing}deg</span>
            <span>{cursor.sector.count?.toLocaleString()} msgs</span>
            <span>{cursor.sector.max_distance_nm?.toFixed(1)} nm max</span>
          </div>
        )}
        <div className="polar-info">
          <div className="polar-legend">
            <span className="legend-item">
              <span className="legend-dot count"></span>
              Reception count
            </span>
            <span className="legend-item">
              <span className="legend-dot distance"></span>
              Max range
            </span>
          </div>
          <div className="polar-stats">
            <span>{summary.total_sightings?.toLocaleString() || 0} sightings</span>
            <span>{summary.sectors_with_data || 0}/36 sectors</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * RSSIScatter - RSSI vs Distance scatter plot with real data
 */
export function RSSIScatter({ data, loading }) {
  const scatterData = data?.scatter_data || [];
  const bandStats = data?.band_statistics || [];
  const trendLine = data?.trend_line;
  const overallStats = data?.overall_statistics || {};

  // Interactive cursor state
  const [cursor, setCursor] = useState(null);
  const svgRef = useRef(null);

  // Chart dimensions - increased for better label visibility
  const width = 240, height = 160;
  const margin = { top: 10, right: 15, bottom: 28, left: 38 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  // Calculate scales from data
  const distances = scatterData.map(d => d.distance_nm);
  const rssis = scatterData.map(d => d.rssi);

  const minDist = Math.min(...distances, 0);
  const maxDist = Math.max(...distances, 200);
  const minRssi = Math.min(...rssis, -30);
  const maxRssi = Math.max(...rssis, 0);

  // Scale functions
  const xScale = (d) => margin.left + ((d - minDist) / (maxDist - minDist || 1)) * plotWidth;
  const yScale = (r) => margin.top + plotHeight - ((r - minRssi) / (maxRssi - minRssi || 1)) * plotHeight;

  // Inverse scale functions for cursor
  const xScaleInverse = (px) => minDist + ((px - margin.left) / plotWidth) * (maxDist - minDist);
  const yScaleInverse = (py) => maxRssi - ((py - margin.top) / plotHeight) * (maxRssi - minRssi);

  // Generate tick values
  const xTicks = useMemo(() => {
    const range = maxDist - minDist;
    const step = range <= 50 ? 10 : range <= 100 ? 25 : range <= 200 ? 50 : 100;
    const ticks = [];
    for (let v = Math.ceil(minDist / step) * step; v <= maxDist; v += step) {
      ticks.push(v);
    }
    return ticks;
  }, [minDist, maxDist]);

  const yTicks = useMemo(() => {
    const range = maxRssi - minRssi;
    const step = range <= 20 ? 5 : 10;
    const ticks = [];
    for (let v = Math.ceil(minRssi / step) * step; v <= maxRssi; v += step) {
      ticks.push(v);
    }
    return ticks;
  }, [minRssi, maxRssi]);

  // Generate trend line points - clamp to plot area
  let trendLinePoints = null;
  if (trendLine && trendLine.slope != null && trendLine.intercept != null) {
    const x1 = minDist;
    const x2 = maxDist;
    let y1 = trendLine.slope * x1 + trendLine.intercept;
    let y2 = trendLine.slope * x2 + trendLine.intercept;
    // Clamp y values to RSSI range
    y1 = Math.max(minRssi, Math.min(maxRssi, y1));
    y2 = Math.max(minRssi, Math.min(maxRssi, y2));
    trendLinePoints = {
      x1: xScale(x1),
      y1: yScale(y1),
      x2: xScale(x2),
      y2: yScale(y2)
    };
  }

  // Clip path ID for this chart
  const clipId = 'rssi-scatter-clip';

  // Mouse handlers for interactive cursor
  const handleMouseMove = (e) => {
    if (!svgRef.current || !scatterData.length) return;
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // Check if within plot area
    if (x >= margin.left && x <= margin.left + plotWidth &&
        y >= margin.top && y <= margin.top + plotHeight) {
      const distValue = xScaleInverse(x);
      const rssiValue = yScaleInverse(y);

      // Find nearest point
      let nearestPoint = null;
      let nearestDist = Infinity;
      scatterData.forEach(point => {
        const px = xScale(point.distance_nm);
        const py = yScale(point.rssi);
        const d = Math.sqrt((px - x) ** 2 + (py - y) ** 2);
        if (d < nearestDist && d < 15) {
          nearestDist = d;
          nearestPoint = point;
        }
      });

      setCursor({
        x, y,
        distValue: distValue.toFixed(1),
        rssiValue: rssiValue.toFixed(1),
        nearestPoint
      });
    } else {
      setCursor(null);
    }
  };

  const handleMouseLeave = () => setCursor(null);

  return (
    <div className="nerd-stats-card rssi-scatter">
      <div className="nerd-stats-header">
        <Signal size={16} />
        <span>Signal vs Distance</span>
        {overallStats.avg_rssi != null && (
          <span className="nerd-badge live">AVG {overallStats.avg_rssi} DB</span>
        )}
      </div>
      <div className="scatter-content">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className="scatter-svg interactive"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={margin.left} y={margin.top} width={plotWidth} height={plotHeight} />
            </clipPath>
          </defs>
          {/* Axes */}
          <line
            x1={margin.left}
            y1={margin.top + plotHeight}
            x2={margin.left + plotWidth}
            y2={margin.top + plotHeight}
            className="scatter-axis"
          />
          <line
            x1={margin.left}
            y1={margin.top}
            x2={margin.left}
            y2={margin.top + plotHeight}
            className="scatter-axis"
          />
          {/* X-axis ticks and labels */}
          {xTicks.map(tick => (
            <g key={`x-${tick}`}>
              <line
                x1={xScale(tick)}
                y1={margin.top + plotHeight}
                x2={xScale(tick)}
                y2={margin.top + plotHeight + 4}
                className="scatter-tick"
              />
              <text
                x={xScale(tick)}
                y={margin.top + plotHeight + 12}
                className="scatter-tick-label"
                textAnchor="middle"
              >
                {tick}
              </text>
            </g>
          ))}
          {/* Y-axis ticks and labels */}
          {yTicks.map(tick => (
            <g key={`y-${tick}`}>
              <line
                x1={margin.left - 4}
                y1={yScale(tick)}
                x2={margin.left}
                y2={yScale(tick)}
                className="scatter-tick"
              />
              <text
                x={margin.left - 6}
                y={yScale(tick)}
                className="scatter-tick-label"
                textAnchor="end"
                dominantBaseline="middle"
              >
                {tick}
              </text>
            </g>
          ))}
          {/* X-axis label */}
          <text x={margin.left + plotWidth / 2} y={height - 2} className="scatter-label" textAnchor="middle">Distance (nm)</text>
          {/* Y-axis label - use g transform for reliable rotation */}
          <g transform={`translate(8, ${margin.top + plotHeight / 2}) rotate(-90)`}>
            <text className="scatter-label-y" textAnchor="middle" dominantBaseline="middle">RSSI (dB)</text>
          </g>
          {/* Grid lines */}
          {yTicks.map(tick => (
            <line
              key={`grid-${tick}`}
              x1={margin.left}
              y1={yScale(tick)}
              x2={margin.left + plotWidth}
              y2={yScale(tick)}
              className="scatter-grid"
            />
          ))}
          {/* Clipped content group */}
          <g clipPath={`url(#${clipId})`}>
            {/* Trend line */}
            {trendLinePoints && (
              <line
                x1={trendLinePoints.x1}
                y1={trendLinePoints.y1}
                x2={trendLinePoints.x2}
                y2={trendLinePoints.y2}
                className="scatter-trend"
              />
            )}
            {/* Data points */}
            {scatterData.slice(0, 500).map((point, i) => (
              <circle
                key={i}
                cx={xScale(point.distance_nm)}
                cy={yScale(point.rssi)}
                r={cursor?.nearestPoint === point ? 4 : 2}
                className={`scatter-point ${cursor?.nearestPoint === point ? 'highlighted' : ''}`}
              />
            ))}
          </g>
          {/* Interactive cursor */}
          {cursor && (
            <g className="scatter-cursor">
              <line
                x1={cursor.x}
                y1={margin.top}
                x2={cursor.x}
                y2={margin.top + plotHeight}
                className="cursor-line"
              />
              <line
                x1={margin.left}
                y1={cursor.y}
                x2={margin.left + plotWidth}
                y2={cursor.y}
                className="cursor-line"
              />
              {cursor.nearestPoint && (
                <circle
                  cx={xScale(cursor.nearestPoint.distance_nm)}
                  cy={yScale(cursor.nearestPoint.rssi)}
                  r="6"
                  className="cursor-highlight"
                />
              )}
            </g>
          )}
        </svg>
        {/* Cursor tooltip */}
        {cursor?.nearestPoint && (
          <div className="scatter-tooltip">
            <span>{cursor.nearestPoint.distance_nm.toFixed(1)} nm</span>
            <span>{cursor.nearestPoint.rssi.toFixed(1)} dB</span>
          </div>
        )}
        <div className="scatter-info">
          {trendLine?.interpretation ? (
            <span className="trend-interpretation">{trendLine.interpretation}</span>
          ) : (
            <span>Signal strength vs distance correlation</span>
          )}
          <div className="scatter-stats">
            <span>{scatterData.length} samples</span>
            {bandStats.length > 0 && (
              <span>Best: {bandStats[0]?.band}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
