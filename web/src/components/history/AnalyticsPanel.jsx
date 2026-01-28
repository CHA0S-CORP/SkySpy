import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronDown, ChevronUp, BarChart3, Compass, Signal, Ruler, Activity } from 'lucide-react';

/**
 * Analytics Panel - Collapsible panel showing analytics visualizations
 * Surfaces backend analytics endpoints with mini visualizations
 *
 * @param {Object} props
 * @param {string} props.apiBase - API base URL
 * @param {number} props.hours - Time range in hours
 * @param {Function} props.wsRequest - WebSocket request function
 * @param {boolean} props.wsConnected - WebSocket connection status
 */
export function AnalyticsPanel({
  apiBase = '',
  hours = 24,
  wsRequest,
  wsConnected,
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [loading, setLoading] = useState({});
  const [data, setData] = useState({
    distance: null,
    speed: null,
    antennaPolar: null,
    antennaRssi: null,
  });
  const [error, setError] = useState({});

  // Fetch analytics data when expanded
  const fetchAnalytics = useCallback(async (endpoint, key) => {
    if (data[key] !== null) return; // Already fetched

    setLoading(prev => ({ ...prev, [key]: true }));
    setError(prev => ({ ...prev, [key]: null }));

    try {
      let result;
      if (wsRequest && wsConnected) {
        result = await wsRequest(`history-analytics-${key}`, { hours });
        if (result?.error) throw new Error(result.error);
      } else {
        const res = await fetch(`${apiBase}${endpoint}?hours=${hours}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          throw new Error('Invalid response format');
        }
        result = await res.json();
      }
      setData(prev => ({ ...prev, [key]: result }));
    } catch (err) {
      setError(prev => ({ ...prev, [key]: err.message }));
    } finally {
      setLoading(prev => ({ ...prev, [key]: false }));
    }
  }, [apiBase, hours, wsRequest, wsConnected, data]);

  // Lazy load data when expanded
  useEffect(() => {
    if (!isExpanded) return;

    fetchAnalytics('/api/v1/history/analytics/distance', 'distance');
    fetchAnalytics('/api/v1/history/analytics/speed', 'speed');
    fetchAnalytics('/api/v1/history/analytics/antenna/polar', 'antennaPolar');
    fetchAnalytics('/api/v1/history/analytics/antenna/rssi', 'antennaRssi');
  }, [isExpanded, fetchAnalytics]);

  // Reset data when hours change
  useEffect(() => {
    setData({
      distance: null,
      speed: null,
      antennaPolar: null,
      antennaRssi: null,
    });
  }, [hours]);

  // Render mini bar chart
  const renderBarChart = (chartData, maxValue, color) => {
    if (!chartData || chartData.length === 0) return null;

    const barWidth = Math.max(4, Math.floor(180 / chartData.length) - 2);

    return (
      <svg width="180" height="60" className="analytics-bar-chart">
        {chartData.map((item, i) => {
          const height = maxValue > 0 ? (item.count / maxValue) * 50 : 0;
          return (
            <g key={i}>
              <rect
                x={i * (barWidth + 2)}
                y={55 - height}
                width={barWidth}
                height={height}
                fill={color}
                opacity="0.7"
                rx="1"
              >
                <title>{`${item.label || item.range}: ${item.count}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
    );
  };

  // Render polar plot for antenna coverage
  const renderPolarPlot = (polarData) => {
    if (!polarData || !polarData.bearings) return null;

    const size = 120;
    const center = size / 2;
    const maxRadius = center - 10;

    // Find max count for scaling
    const maxCount = Math.max(...Object.values(polarData.bearings).map(b => b.count || 0), 1);

    // Generate path for each bearing sector
    const sectors = Object.entries(polarData.bearings).map(([bearing, data]) => {
      const angle = (parseFloat(bearing) - 90) * (Math.PI / 180); // Rotate so 0 is up
      const nextAngle = angle + (Math.PI / 18); // 10-degree sectors
      const radius = (data.count / maxCount) * maxRadius;

      const x1 = center + Math.cos(angle) * radius;
      const y1 = center + Math.sin(angle) * radius;
      const x2 = center + Math.cos(nextAngle) * radius;
      const y2 = center + Math.sin(nextAngle) * radius;

      return (
        <path
          key={bearing}
          d={`M${center},${center} L${x1},${y1} A${radius},${radius} 0 0,1 ${x2},${y2} Z`}
          fill="#00d4ff"
          opacity={0.5 + (data.count / maxCount) * 0.5}
        >
          <title>{`${bearing}°: ${data.count} sightings, avg RSSI: ${data.avgRssi?.toFixed(1) || 'N/A'} dB`}</title>
        </path>
      );
    });

    return (
      <svg width={size} height={size} className="analytics-polar-plot">
        {/* Background circles */}
        <circle cx={center} cy={center} r={maxRadius} fill="none" stroke="rgba(255,255,255,0.1)" />
        <circle cx={center} cy={center} r={maxRadius * 0.66} fill="none" stroke="rgba(255,255,255,0.05)" />
        <circle cx={center} cy={center} r={maxRadius * 0.33} fill="none" stroke="rgba(255,255,255,0.05)" />

        {/* Cardinal directions */}
        <text x={center} y="8" textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="8">N</text>
        <text x={size - 4} y={center + 3} textAnchor="end" fill="rgba(255,255,255,0.5)" fontSize="8">E</text>
        <text x={center} y={size - 2} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="8">S</text>
        <text x="4" y={center + 3} textAnchor="start" fill="rgba(255,255,255,0.5)" fontSize="8">W</text>

        {/* Data sectors */}
        {sectors}
      </svg>
    );
  };

  // Render RSSI fade curve
  const renderRssiFadeCurve = (rssiData) => {
    if (!rssiData || !rssiData.curve || rssiData.curve.length < 2) return null;

    const width = 180;
    const height = 60;
    const padding = 5;

    const distances = rssiData.curve.map(p => p.distance);
    const rssiValues = rssiData.curve.map(p => p.avgRssi);

    const minDist = Math.min(...distances);
    const maxDist = Math.max(...distances);
    const minRssi = Math.min(...rssiValues);
    const maxRssi = Math.max(...rssiValues);

    const distRange = maxDist - minDist || 1;
    const rssiRange = maxRssi - minRssi || 1;

    const points = rssiData.curve.map(p => {
      const x = padding + ((p.distance - minDist) / distRange) * (width - padding * 2);
      const y = height - padding - ((p.avgRssi - minRssi) / rssiRange) * (height - padding * 2);
      return `${x},${y}`;
    }).join(' ');

    return (
      <svg width={width} height={height} className="analytics-rssi-curve">
        <polyline
          points={points}
          fill="none"
          stroke="#00ff88"
          strokeWidth="2"
          opacity="0.7"
        />
        <text x={padding} y={height - 2} fill="rgba(255,255,255,0.4)" fontSize="8">
          {minDist.toFixed(0)} nm
        </text>
        <text x={width - padding} y={height - 2} textAnchor="end" fill="rgba(255,255,255,0.4)" fontSize="8">
          {maxDist.toFixed(0)} nm
        </text>
      </svg>
    );
  };

  // Process distance distribution
  const distanceDistribution = useMemo(() => {
    if (!data.distance?.distribution) return [];
    return data.distance.distribution.map(d => ({
      range: d.range,
      label: d.label,
      count: d.count,
    }));
  }, [data.distance]);

  // Process speed distribution
  const speedDistribution = useMemo(() => {
    if (!data.speed?.distribution) return [];
    return data.speed.distribution.map(s => ({
      range: s.range,
      label: s.label,
      count: s.count,
    }));
  }, [data.speed]);

  const maxDistCount = Math.max(...distanceDistribution.map(d => d.count), 1);
  const maxSpeedCount = Math.max(...speedDistribution.map(s => s.count), 1);

  return (
    <div className={`analytics-panel ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <button
        className="analytics-panel-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <BarChart3 size={16} />
        <span>Analytics</span>
        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {isExpanded && (
        <div className="analytics-panel-content">
          <div className="analytics-grid">
            {/* Distance Distribution */}
            <div className="analytics-card">
              <div className="analytics-card-header">
                <Ruler size={14} />
                <span>Distance Distribution</span>
              </div>
              <div className="analytics-card-content">
                {loading.distance ? (
                  <div className="analytics-loading">Loading...</div>
                ) : error.distance ? (
                  <div className="analytics-error">{error.distance}</div>
                ) : (
                  <>
                    {renderBarChart(distanceDistribution, maxDistCount, '#00d4ff')}
                    {data.distance?.stats && (
                      <div className="analytics-stats">
                        <span>Avg: {data.distance.stats.avg?.toFixed(1)} nm</span>
                        <span>Max: {data.distance.stats.max?.toFixed(1)} nm</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Speed Distribution */}
            <div className="analytics-card">
              <div className="analytics-card-header">
                <Activity size={14} />
                <span>Speed Distribution</span>
              </div>
              <div className="analytics-card-content">
                {loading.speed ? (
                  <div className="analytics-loading">Loading...</div>
                ) : error.speed ? (
                  <div className="analytics-error">{error.speed}</div>
                ) : (
                  <>
                    {renderBarChart(speedDistribution, maxSpeedCount, '#a371f7')}
                    {data.speed?.stats && (
                      <div className="analytics-stats">
                        <span>Avg: {data.speed.stats.avg?.toFixed(0)} kts</span>
                        <span>Max: {data.speed.stats.max?.toFixed(0)} kts</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Antenna Polar Coverage */}
            <div className="analytics-card">
              <div className="analytics-card-header">
                <Compass size={14} />
                <span>Bearing Coverage</span>
              </div>
              <div className="analytics-card-content">
                {loading.antennaPolar ? (
                  <div className="analytics-loading">Loading...</div>
                ) : error.antennaPolar ? (
                  <div className="analytics-error">{error.antennaPolar}</div>
                ) : (
                  renderPolarPlot(data.antennaPolar)
                )}
              </div>
            </div>

            {/* Signal Fade Curve */}
            <div className="analytics-card">
              <div className="analytics-card-header">
                <Signal size={14} />
                <span>Signal vs Distance</span>
              </div>
              <div className="analytics-card-content">
                {loading.antennaRssi ? (
                  <div className="analytics-loading">Loading...</div>
                ) : error.antennaRssi ? (
                  <div className="analytics-error">{error.antennaRssi}</div>
                ) : (
                  <>
                    {renderRssiFadeCurve(data.antennaRssi)}
                    {data.antennaRssi?.stats && (
                      <div className="analytics-stats">
                        <span>Avg RSSI: {data.antennaRssi.stats.avgRssi?.toFixed(1)} dB</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AnalyticsPanel;
