import React, { useMemo, useState, useEffect } from 'react';
import {
  AlertTriangle, TrendingUp, Radio, Plane, Activity, Filter,
  Clock, Shield, ChevronDown, Award, BarChart3, Zap, Target,
  Cpu, Thermometer, HardDrive, Wifi, CheckCircle, Eye,
  Signal, ArrowUpCircle, Navigation
} from 'lucide-react';
import { useSocketApi } from '../../hooks';

// ============================================================================
// Subcomponents for the Bento Grid Layout
// ============================================================================

/**
 * KPICard - Consolidated Key Performance Indicator card
 * Groups related metrics into logical clusters
 */
function KPICard({ title, icon: Icon, metrics, accentColor = 'cyan' }) {
  const colorClasses = {
    cyan: 'kpi-accent-cyan',
    green: 'kpi-accent-green',
    purple: 'kpi-accent-purple',
    orange: 'kpi-accent-orange',
    red: 'kpi-accent-red'
  };

  return (
    <div className={`kpi-card ${colorClasses[accentColor]}`}>
      <div className="kpi-header">
        <Icon size={16} />
        <span className="kpi-title">{title}</span>
      </div>
      <div className="kpi-metrics">
        {metrics.map((metric, i) => (
          <div key={i} className="kpi-metric">
            <span className="kpi-metric-value">{metric.value}</span>
            <span className="kpi-metric-label">{metric.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * LeaderboardCard - Live feed metric with pulse animation on update
 */
function LeaderboardCard({ title, icon: Icon, items, onSelect, valueFormatter, emptyText = "No data" }) {
  const [pulse, setPulse] = useState(false);
  const [prevItems, setPrevItems] = useState([]);

  useEffect(() => {
    if (items?.length > 0 && JSON.stringify(items) !== JSON.stringify(prevItems)) {
      setPulse(true);
      setPrevItems(items);
      const timer = setTimeout(() => setPulse(false), 1000);
      return () => clearTimeout(timer);
    }
  }, [items, prevItems]);

  return (
    <div className={`leaderboard-card ${pulse ? 'pulse' : ''}`}>
      <div className="leaderboard-header">
        <Icon size={16} />
        <span>{title}</span>
      </div>
      <div className="leaderboard-list">
        {!items?.length ? (
          <div className="leaderboard-empty">{emptyText}</div>
        ) : (
          items.slice(0, 3).map((item, i) => (
            <div
              key={item.hex || i}
              className={`leaderboard-item ${onSelect ? 'clickable' : ''}`}
              onClick={() => onSelect?.(item.hex)}
            >
              <span className="leaderboard-rank">{i + 1}</span>
              <div className="leaderboard-info">
                <span className="leaderboard-callsign">{item.flight || item.hex}</span>
              </div>
              <span className="leaderboard-value">{valueFormatter(item)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * SquawkWatchlist - Special squawk code monitor (emergency-focused)
 */
function SquawkWatchlist({ aircraftData, onSelect }) {
  const specialSquawks = useMemo(() => {
    const aircraft = Array.isArray(aircraftData) ? aircraftData : aircraftData?.aircraft;
    if (!aircraft?.length) return { active: [], allClear: true };

    const watchCodes = {
      '7700': { label: 'EMERGENCY', severity: 'critical', description: 'General Emergency' },
      '7600': { label: 'RADIO FAIL', severity: 'warning', description: 'Radio Failure' },
      '7500': { label: 'HIJACK', severity: 'critical', description: 'Hijacking' }
    };

    const active = aircraft
      .filter(ac => ac.squawk && watchCodes[ac.squawk])
      .map(ac => ({
        ...ac,
        ...watchCodes[ac.squawk]
      }));

    return { active, allClear: active.length === 0 };
  }, [aircraftData]);

  return (
    <div className="squawk-watchlist">
      <div className="watchlist-header">
        <AlertTriangle size={16} />
        <span>Squawk Watchlist</span>
      </div>
      {specialSquawks.allClear ? (
        <div className="watchlist-clear">
          <CheckCircle size={20} />
          <span>All Clear</span>
          <span className="watchlist-subtext">No emergency squawks active</span>
        </div>
      ) : (
        <div className="watchlist-alerts">
          {specialSquawks.active.map((ac, i) => (
            <div
              key={i}
              className={`watchlist-alert ${ac.severity}`}
              onClick={() => onSelect?.(ac.hex)}
            >
              <div className="alert-badge">{ac.squawk}</div>
              <div className="alert-info">
                <span className="alert-label">{ac.label}</span>
                <span className="alert-callsign">{ac.flight || ac.hex}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * HorizontalBarChart - Replaces pie charts for better readability
 */
function HorizontalBarChart({ title, data, maxItems = 5, showPercentage = true }) {
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
 * SystemStatusCard - Compact system health display
 */
function SystemStatusCard({ systemData }) {
  const getStatusColor = (value, thresholds) => {
    if (value >= thresholds.critical) return 'critical';
    if (value >= thresholds.warning) return 'warning';
    return 'normal';
  };

  const metrics = [
    {
      icon: Cpu,
      label: 'CPU',
      value: systemData?.cpu_percent ?? '--',
      unit: '%',
      status: getStatusColor(systemData?.cpu_percent || 0, { warning: 70, critical: 90 })
    },
    {
      icon: HardDrive,
      label: 'RAM',
      value: systemData?.memory_percent ?? '--',
      unit: '%',
      status: getStatusColor(systemData?.memory_percent || 0, { warning: 80, critical: 95 })
    },
    {
      icon: Thermometer,
      label: 'SDR Temp',
      value: systemData?.sdr_temp ?? '--',
      unit: '°C',
      status: getStatusColor(systemData?.sdr_temp || 0, { warning: 55, critical: 70 })
    },
    {
      icon: Wifi,
      label: 'Gain',
      value: systemData?.sdr_gain ?? '--',
      unit: 'dB',
      status: 'normal'
    }
  ];

  return (
    <div className="system-status-card">
      <div className="system-status-header">
        <Cpu size={16} />
        <span>System Health</span>
      </div>
      <div className="system-metrics">
        {metrics.map((metric, i) => (
          <div key={i} className={`system-metric ${metric.status}`}>
            <metric.icon size={14} />
            <span className="system-metric-label">{metric.label}</span>
            <span className="system-metric-value">
              {metric.value}{metric.value !== '--' ? metric.unit : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * SafetyAlertsSummary - Compact safety events summary for right sidebar
 */
function SafetyAlertsSummary({ safetyStats, timeRange }) {
  const hasEvents = safetyStats?.total_events > 0;
  const criticalCount = safetyStats?.events_by_severity?.critical || 0;
  const warningCount = safetyStats?.events_by_severity?.warning || 0;

  return (
    <div className={`safety-alerts-summary ${criticalCount > 0 ? 'has-critical' : ''}`}>
      <div className="safety-summary-header">
        <Shield size={16} />
        <span>Safety Events</span>
        <span className="safety-period">{timeRange}</span>
      </div>
      {!hasEvents ? (
        <div className="safety-all-clear">
          <CheckCircle size={18} />
          <span>No Events</span>
        </div>
      ) : (
        <div className="safety-counts">
          {criticalCount > 0 && (
            <div className="safety-count critical">
              <span className="count-value">{criticalCount}</span>
              <span className="count-label">Critical</span>
            </div>
          )}
          {warningCount > 0 && (
            <div className="safety-count warning">
              <span className="count-value">{warningCount}</span>
              <span className="count-label">Warning</span>
            </div>
          )}
          <div className="safety-count info">
            <span className="count-value">{safetyStats?.events_by_severity?.low || 0}</span>
            <span className="count-label">Info</span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * PolarPlot - Antenna reception polar diagram with real data
 */
function PolarPlot({ data, loading }) {
  const bearingData = data?.bearing_data || [];
  const summary = data?.summary || {};

  // Find max values for normalization
  const maxCount = Math.max(...bearingData.map(d => d.count || 0), 1);
  const maxDistance = Math.max(...bearingData.map(d => d.max_distance_nm || 0), 1);

  // Generate polar path from bearing data
  const generatePolarPath = (valueKey, maxValue) => {
    if (!bearingData.length) return '';

    const cx = 100, cy = 100, maxR = 75;
    const points = bearingData.map(sector => {
      const value = sector[valueKey] || 0;
      const normalizedR = (value / maxValue) * maxR;
      const angle = ((sector.bearing_start + 5) - 90) * (Math.PI / 180); // Center of sector, -90 to start at N
      const x = cx + normalizedR * Math.cos(angle);
      const y = cy + normalizedR * Math.sin(angle);
      return `${x},${y}`;
    });

    // Close the path by returning to start
    return `M${points[0]} ${points.slice(1).map(p => `L${p}`).join(' ')} Z`;
  };

  const countPath = generatePolarPath('count', maxCount);
  const distancePath = generatePolarPath('max_distance_nm', maxDistance);

  return (
    <div className="nerd-stats-card polar-plot">
      <div className="nerd-stats-header">
        <Navigation size={16} />
        <span>Antenna Coverage</span>
        {summary.coverage_pct != null && (
          <span className="nerd-badge live">{summary.coverage_pct}% coverage</span>
        )}
      </div>
      <div className="polar-content">
        <svg viewBox="0 0 200 200" className="polar-svg">
          {/* Concentric circles */}
          {[20, 40, 60, 75].map(r => (
            <circle key={r} cx="100" cy="100" r={r} className="polar-ring" />
          ))}
          {/* Cardinal directions */}
          <line x1="100" y1="25" x2="100" y2="175" className="polar-axis" />
          <line x1="25" y1="100" x2="175" y2="100" className="polar-axis" />
          {/* Diagonal axes */}
          <line x1="47" y1="47" x2="153" y2="153" className="polar-axis-minor" />
          <line x1="153" y1="47" x2="47" y2="153" className="polar-axis-minor" />
          {/* Labels */}
          <text x="100" y="15" className="polar-label">N</text>
          <text x="100" y="192" className="polar-label">S</text>
          <text x="10" y="104" className="polar-label">W</text>
          <text x="186" y="104" className="polar-label">E</text>
          {/* Distance pattern (outer) */}
          {distancePath && (
            <path d={distancePath} className="polar-pattern-distance" />
          )}
          {/* Count pattern (inner) */}
          {countPath && (
            <path d={countPath} className="polar-pattern-count" />
          )}
        </svg>
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
function RSSIScatter({ data, loading }) {
  const scatterData = data?.scatter_data || [];
  const bandStats = data?.band_statistics || [];
  const trendLine = data?.trend_line;
  const overallStats = data?.overall_statistics || {};

  // Chart dimensions
  const width = 200, height = 120;
  const margin = { top: 10, right: 10, bottom: 20, left: 35 };
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

  // Generate trend line points
  let trendLinePoints = null;
  if (trendLine && trendLine.slope != null && trendLine.intercept != null) {
    const x1 = minDist;
    const x2 = maxDist;
    const y1 = trendLine.slope * x1 + trendLine.intercept;
    const y2 = trendLine.slope * x2 + trendLine.intercept;
    trendLinePoints = {
      x1: xScale(x1),
      y1: yScale(y1),
      x2: xScale(x2),
      y2: yScale(y2)
    };
  }

  return (
    <div className="nerd-stats-card rssi-scatter">
      <div className="nerd-stats-header">
        <Signal size={16} />
        <span>Signal vs Distance</span>
        {overallStats.avg_rssi != null && (
          <span className="nerd-badge live">Avg {overallStats.avg_rssi} dB</span>
        )}
      </div>
      <div className="scatter-content">
        <svg viewBox={`0 0 ${width} ${height}`} className="scatter-svg">
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
          {/* Axis labels */}
          <text x={width / 2} y={height - 2} className="scatter-label">Distance (nm)</text>
          <text x={5} y={height / 2} className="scatter-label-y" transform={`rotate(-90, 8, ${height / 2})`}>RSSI (dB)</text>
          {/* Grid lines */}
          {[0.25, 0.5, 0.75].map(pct => (
            <line
              key={`h-${pct}`}
              x1={margin.left}
              y1={margin.top + plotHeight * pct}
              x2={margin.left + plotWidth}
              y2={margin.top + plotHeight * pct}
              className="scatter-grid"
            />
          ))}
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
          {scatterData.slice(0, 200).map((point, i) => (
            <circle
              key={i}
              cx={xScale(point.distance_nm)}
              cy={yScale(point.rssi)}
              r="2"
              className="scatter-point"
            />
          ))}
        </svg>
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

/**
 * LiveSparkline - Real-time sparkline graph
 */
function LiveSparkline({ data, valueKey, color, height = 60, label, currentValue, unit }) {
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
  const width = 200;
  const padding = 4;

  const points = values.map((v, i) => {
    const x = padding + (i / (values.length - 1)) * (width - padding * 2);
    const y = height - padding - ((v - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  }).join(' ');

  const areaPoints = `${padding},${height - padding} ${points} ${width - padding},${height - padding}`;

  return (
    <div className="sparkline-container">
      <div className="sparkline-header">
        <span className="sparkline-label">{label}</span>
        <span className="sparkline-value">
          {currentValue ?? values[values.length - 1]?.toFixed(0) ?? '--'}
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
        <circle
          cx={width - padding}
          cy={height - padding - ((values[values.length - 1] - min) / range) * (height - padding * 2)}
          r="4"
          fill={color}
        />
      </svg>
    </div>
  );
}

// ============================================================================
// Main StatsView Component - Bento Grid Layout
// ============================================================================

export function StatsView({ apiBase, onSelectAircraft, wsRequest, wsConnected, aircraft: wsAircraft, stats: wsStats, antennaAnalytics }) {
  // Filter state
  const [timeRange, setTimeRange] = useState('24h');
  const [showMilitaryOnly, setShowMilitaryOnly] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [minAltitude, setMinAltitude] = useState('');
  const [maxAltitude, setMaxAltitude] = useState('');
  const [minDistance, setMinDistance] = useState('');
  const [maxDistance, setMaxDistance] = useState('');
  const [aircraftType, setAircraftType] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [activeAnalyticsTab, setActiveAnalyticsTab] = useState('trends');
  const [topPerformersTab, setTopPerformersTab] = useState('longest');

  // Convert time range to hours
  const hours = { '1h': 1, '6h': 6, '24h': 24, '48h': 48, '7d': 168 };
  const selectedHours = hours[timeRange] || 24;

  // Build filter query params
  const buildFilterParams = () => {
    const params = new URLSearchParams();
    params.append('hours', selectedHours);
    if (showMilitaryOnly) params.append('military_only', 'true');
    if (categoryFilter) params.append('category', categoryFilter);
    if (minAltitude) params.append('min_altitude', minAltitude);
    if (maxAltitude) params.append('max_altitude', maxAltitude);
    if (minDistance) params.append('min_distance', minDistance);
    if (maxDistance) params.append('max_distance', maxDistance);
    if (aircraftType) params.append('aircraft_type', aircraftType);
    return params.toString();
  };

  const filterParams = buildFilterParams();

  // Socket-first strategy:
  // - Real-time data (aircraft, stats) computed from WebSocket push - no polling needed
  // - Historical/analytics data: fetch once on mount + when filters change (null interval)
  // - System status: infrequent polling only when socket unavailable
  const socketOpts = { wsRequest, wsConnected };

  // Aircraft data from WebSocket push (array of aircraft objects)
  const aircraftData = wsAircraft || null;

  // Compute real-time stats from pushed aircraft array (client-side)
  const computedStats = useMemo(() => {
    if (!wsAircraft?.length) return null;

    const altDist = { ground: 0, low: 0, medium: 0, high: 0 };
    let withPosition = 0;
    let military = 0;
    const emergencySquawks = [];

    wsAircraft.forEach(ac => {
      // Count aircraft with position
      if (ac.lat != null && ac.lon != null) withPosition++;

      // Count military
      if (ac.military) military++;

      // Emergency squawks
      if (ac.squawk && ['7500', '7600', '7700'].includes(ac.squawk)) {
        emergencySquawks.push({ hex: ac.hex, squawk: ac.squawk, flight: ac.flight });
      }

      // Altitude distribution
      const alt = ac.alt || ac.altitude || 0;
      if (ac.on_ground || alt <= 0) {
        altDist.ground++;
      } else if (alt < 10000) {
        altDist.low++;
      } else if (alt < 30000) {
        altDist.medium++;
      } else {
        altDist.high++;
      }
    });

    return {
      total: wsAircraft.length,
      with_position: withPosition,
      military,
      emergency_squawks: emergencySquawks,
      altitude: altDist,
      // Message count not available client-side, will come from server stats
      messages: wsStats?.count || 0
    };
  }, [wsAircraft, wsStats]);

  // Fetch detailed stats only when socket not connected or for filtered queries
  // When socket is connected, we rely on computedStats for real-time data
  const { data: fetchedStats } = useSocketApi(
    `/api/v1/aircraft/stats?${filterParams}`,
    wsConnected ? null : 30000, // No polling when socket connected
    apiBase,
    socketOpts
  );

  // Use computed stats from WebSocket push, fall back to fetched
  const stats = computedStats || fetchedStats;

  // Top aircraft - computed from pushed aircraft data or fetched once
  const computedTop = useMemo(() => {
    if (!wsAircraft?.length) return null;

    const withDistance = wsAircraft.filter(ac => ac.distance_nm != null);
    const withSpeed = wsAircraft.filter(ac => ac.gs != null);
    const withAlt = wsAircraft.filter(ac => ac.alt != null);

    return {
      closest: [...withDistance].sort((a, b) => a.distance_nm - b.distance_nm).slice(0, 5),
      fastest: [...withSpeed].sort((a, b) => b.gs - a.gs).slice(0, 5),
      highest: [...withAlt].sort((a, b) => b.alt - a.alt).slice(0, 5)
    };
  }, [wsAircraft]);

  const { data: fetchedTop } = useSocketApi(
    '/api/v1/aircraft/top',
    wsConnected ? null : 30000,
    apiBase,
    socketOpts
  );

  const top = computedTop || fetchedTop;

  // Historical data - fetch once, refresh only on filter change (no interval polling)
  const { data: histStats } = useSocketApi(`/api/v1/history/stats?${filterParams}`, null, apiBase, socketOpts);
  const { data: acarsStats } = useSocketApi(`/api/v1/acars/stats?hours=${selectedHours}`, null, apiBase, socketOpts);
  const { data: safetyStats } = useSocketApi(`/api/v1/safety/stats?hours=${selectedHours}`, null, apiBase, socketOpts);
  const { data: sessionsData } = useSocketApi(`/api/v1/history/sessions?hours=${selectedHours}&limit=500${showMilitaryOnly ? '&military_only=true' : ''}`, null, apiBase, socketOpts);

  // System status - very infrequent polling (5 min) or socket request
  const { data: systemData } = useSocketApi('/api/v1/system/status', wsConnected ? null : 300000, apiBase, socketOpts);

  // Analytics endpoints - fetch once, no polling (data doesn't change rapidly)
  const { data: trendsData } = useSocketApi(`/api/v1/history/trends?${filterParams}&interval=hour`, null, apiBase, socketOpts);
  const { data: topPerformersData } = useSocketApi(`/api/v1/history/top?${filterParams}&limit=10`, null, apiBase, socketOpts);
  const { data: distanceAnalytics } = useSocketApi(`/api/v1/history/analytics/distance?${filterParams}`, null, apiBase, socketOpts);
  const { data: speedAnalytics } = useSocketApi(`/api/v1/history/analytics/speed?${filterParams}`, null, apiBase, socketOpts);
  const { data: correlationData } = useSocketApi(`/api/v1/history/analytics/correlation?${filterParams}`, null, apiBase, socketOpts);

  // Throughput history for graphs
  const [throughputHistory, setThroughputHistory] = useState([]);
  const [aircraftHistory, setAircraftHistory] = useState([]);
  const [lastMessageCount, setLastMessageCount] = useState(null);
  const [messageRate, setMessageRate] = useState(0);

  // Track throughput over time
  useEffect(() => {
    if (!stats) return;

    const now = Date.now();
    const currentMessages = stats.messages || 0;

    let rate = 0;
    if (lastMessageCount !== null && throughputHistory.length > 0) {
      const lastPoint = throughputHistory[throughputHistory.length - 1];
      const timeDiff = (now - lastPoint.time) / 1000;
      if (timeDiff > 0) {
        rate = (currentMessages - lastMessageCount) / timeDiff;
        if (rate < 0) rate = 0;
      }
    }
    setLastMessageCount(currentMessages);
    setMessageRate(rate);

    const newPoint = {
      time: now,
      messages: rate,
      aircraft: stats.total || 0,
      withPosition: stats.with_position || 0
    };

    setThroughputHistory(prev => [...prev, newPoint].slice(-60));
    setAircraftHistory(prev => [...prev, { time: now, count: stats.total || 0 }].slice(-60));
  }, [stats]);

  const emergencyAircraft = stats?.emergency_squawks || [];

  // Altitude distribution data
  const altitudeData = useMemo(() => {
    const dist = stats?.altitude || stats?.altitude_distribution;
    if (!dist) return [];
    const total = Object.values(dist).reduce((a, b) => a + (b || 0), 0) || 1;
    return [
      { label: 'Ground', count: dist.ground || 0, pct: ((dist.ground || 0) / total) * 100, color: '#6b7280' },
      { label: '< 10k ft', count: dist.low || 0, pct: ((dist.low || 0) / total) * 100, color: '#00ff88' },
      { label: '10-30k ft', count: dist.medium || 0, pct: ((dist.medium || 0) / total) * 100, color: '#00c8ff' },
      { label: '> 30k ft', count: dist.high || 0, pct: ((dist.high || 0) / total) * 100, color: '#a371f7' }
    ];
  }, [stats]);

  // Fleet breakdown
  const fleetBreakdown = useMemo(() => {
    let sessions = sessionsData?.sessions;
    if (!sessions?.length) return null;

    if (showMilitaryOnly) {
      sessions = sessions.filter(s => s.is_military);
    }

    const seenHex = new Set();
    const categoryCount = {};
    const manufacturerCount = {};
    const typeCount = {};

    // Type mappings (simplified)
    const typeToCategory = {
      'B737': 'Commercial', 'B738': 'Commercial', 'B739': 'Commercial', 'A319': 'Commercial',
      'A320': 'Commercial', 'A321': 'Commercial', 'E170': 'Regional', 'E175': 'Regional',
      'CRJ2': 'Regional', 'CRJ7': 'Regional', 'C172': 'GA', 'C182': 'GA', 'PA28': 'GA',
      'EC35': 'Helicopter', 'R44': 'Helicopter', 'B407': 'Helicopter'
    };

    const typeToManufacturer = {
      'B737': 'Boeing', 'B738': 'Boeing', 'B739': 'Boeing', 'B77W': 'Boeing',
      'A319': 'Airbus', 'A320': 'Airbus', 'A321': 'Airbus', 'A380': 'Airbus',
      'E170': 'Embraer', 'E175': 'Embraer', 'CRJ2': 'Bombardier', 'CRJ7': 'Bombardier',
      'C172': 'Cessna', 'C182': 'Cessna', 'PA28': 'Piper'
    };

    sessions.forEach(session => {
      const hex = session.icao_hex;
      if (!hex || seenHex.has(hex)) return;
      seenHex.add(hex);

      const type = session.type?.toUpperCase();
      if (type) {
        typeCount[type] = (typeCount[type] || 0) + 1;

        const category = session.is_military ? 'Military' : (typeToCategory[type] || 'Other');
        categoryCount[category] = (categoryCount[category] || 0) + 1;

        const manufacturer = typeToManufacturer[type] || 'Other';
        manufacturerCount[manufacturer] = (manufacturerCount[manufacturer] || 0) + 1;
      }
    });

    const total = Object.values(typeCount).reduce((a, b) => a + b, 0) || 1;
    const categoryColors = {
      'Commercial': '#00c8ff', 'Regional': '#a371f7', 'GA': '#00ff88',
      'Helicopter': '#ff9f43', 'Military': '#ff4757', 'Other': '#6b7280'
    };

    return {
      categories: Object.entries(categoryCount)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({
          name, count, pct: (count / total) * 100,
          color: categoryColors[name] || '#6b7280'
        })),
      manufacturers: Object.entries(manufacturerCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([name, count]) => ({ name, count, pct: (count / total) * 100 })),
      types: Object.entries(typeCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([type, count]) => ({ type, count, pct: (count / total) * 100 })),
      total: seenHex.size
    };
  }, [sessionsData, showMilitaryOnly]);

  // Safety events by type for bar chart
  const safetyEventsByType = useMemo(() => {
    if (!safetyStats?.events_by_type) return [];

    const typeLabels = {
      tcas_ra: 'TCAS RA', tcas_ta: 'TCAS TA', extreme_vs: 'Extreme V/S',
      vs_reversal: 'VS Reversal', proximity_conflict: 'Proximity',
      squawk_emergency: 'Emergency', squawk_hijack: 'Hijack', squawk_radio_failure: 'Radio Fail'
    };
    const typeColors = {
      tcas_ra: '#ff4757', tcas_ta: '#ff9f43', extreme_vs: '#f7d794',
      vs_reversal: '#f7d794', proximity_conflict: '#a371f7', squawk_emergency: '#ff4757',
      squawk_hijack: '#ff4757', squawk_radio_failure: '#ff9f43'
    };

    return Object.entries(safetyStats.events_by_type)
      .map(([type, count]) => ({
        label: typeLabels[type] || type,
        count,
        color: typeColors[type] || '#00c8ff'
      }))
      .sort((a, b) => b.count - a.count);
  }, [safetyStats]);

  // ACARS label descriptions
  const acarsLabelDescriptions = {
    '_d': 'Command', 'H1': 'Departure', 'H2': 'Arrival', '10': 'OUT Gate',
    '11': 'OFF Takeoff', '12': 'ON Landing', '13': 'IN Gate', '44': 'Position',
    '5Z': 'Airline Op', 'AA': 'Free Text', 'SA': 'System', 'CA': 'CPDLC'
  };

  return (
    <div className="stats-bento-container">
      {/* Emergency Banner */}
      {emergencyAircraft.length > 0 && (
        <div className="emergency-banner">
          <AlertTriangle size={24} />
          <div>
            <strong>Emergency Squawk Detected</strong>
            <div>
              {emergencyAircraft.map((a, i) => (
                <span key={a.hex}>
                  {i > 0 && ', '}
                  <button className="emergency-aircraft-link" onClick={() => onSelectAircraft?.(a.hex)}>
                    {a.hex} ({a.squawk})
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Filter Controls */}
      <div className="stats-filters">
        <div className="filter-group">
          <Clock size={14} />
          <span className="filter-label">Time Range</span>
          <div className="time-range-buttons">
            {['1h', '6h', '24h', '48h', '7d'].map(range => (
              <button
                key={range}
                className={`time-btn ${timeRange === range ? 'active' : ''}`}
                onClick={() => setTimeRange(range)}
              >
                {range}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-divider" />
        <div
          className={`filter-toggle ${showMilitaryOnly ? 'active' : ''}`}
          onClick={() => setShowMilitaryOnly(!showMilitaryOnly)}
        >
          <span className="toggle-indicator" />
          <span>Military Only</span>
        </div>
        <div className="filter-divider" />
        <button
          className={`advanced-filter-btn ${showAdvancedFilters ? 'active' : ''}`}
          onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
        >
          <Filter size={14} />
          <span>Filters</span>
          <ChevronDown size={14} className={`chevron ${showAdvancedFilters ? 'open' : ''}`} />
        </button>
      </div>

      {/* Advanced Filters Panel */}
      {showAdvancedFilters && (
        <div className="advanced-filters-panel">
          <div className="filter-row">
            <div className="filter-field">
              <label>Category</label>
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="">All Categories</option>
                <option value="A0">A0 - No ADS-B</option>
                <option value="A1">A1 - Light</option>
                <option value="A2">A2 - Small</option>
                <option value="A3">A3 - Large</option>
                <option value="A4">A4 - High Vortex</option>
                <option value="A5">A5 - Heavy</option>
                <option value="A6">A6 - High Performance</option>
                <option value="A7">A7 - Rotorcraft</option>
              </select>
            </div>
            <div className="filter-field">
              <label>Aircraft Type</label>
              <input
                type="text"
                placeholder="e.g. B738, A320"
                value={aircraftType}
                onChange={(e) => setAircraftType(e.target.value.toUpperCase())}
              />
            </div>
          </div>
          <div className="filter-row">
            <div className="filter-field">
              <label>Min Altitude (ft)</label>
              <input type="number" placeholder="0" value={minAltitude} onChange={(e) => setMinAltitude(e.target.value)} />
            </div>
            <div className="filter-field">
              <label>Max Altitude (ft)</label>
              <input type="number" placeholder="60000" value={maxAltitude} onChange={(e) => setMaxAltitude(e.target.value)} />
            </div>
            <div className="filter-field">
              <label>Min Distance (nm)</label>
              <input type="number" placeholder="0" value={minDistance} onChange={(e) => setMinDistance(e.target.value)} />
            </div>
            <div className="filter-field">
              <label>Max Distance (nm)</label>
              <input type="number" placeholder="250" value={maxDistance} onChange={(e) => setMaxDistance(e.target.value)} />
            </div>
          </div>
          <div className="filter-actions">
            <button
              className="clear-filters-btn"
              onClick={() => {
                setCategoryFilter('');
                setAircraftType('');
                setMinAltitude('');
                setMaxAltitude('');
                setMinDistance('');
                setMaxDistance('');
              }}
            >
              Clear Filters
            </button>
          </div>
        </div>
      )}

      {/* ====================================================================
          BENTO GRID - 3 Column Layout
          ==================================================================== */}
      <div className="bento-grid">

        {/* ----------------------------------------------------------------
            LEFT COLUMN - Live Feed (20%)
            ---------------------------------------------------------------- */}
        <div className="bento-column bento-left">
          <div className="column-header">
            <Eye size={16} />
            <span>Live Feed</span>
          </div>

          {/* Leaderboards */}
          <LeaderboardCard
            title="Closest"
            icon={Target}
            items={top?.closest}
            onSelect={onSelectAircraft}
            valueFormatter={(item) => `${item.distance_nm?.toFixed(1)} nm`}
            emptyText="No data"
          />

          <LeaderboardCard
            title="Fastest"
            icon={Zap}
            items={top?.fastest}
            onSelect={onSelectAircraft}
            valueFormatter={(item) => `${item.gs?.toFixed(0)} kts`}
            emptyText="No data"
          />

          <LeaderboardCard
            title="Highest"
            icon={ArrowUpCircle}
            items={top?.highest}
            onSelect={onSelectAircraft}
            valueFormatter={(item) => `${(item.alt / 1000).toFixed(1)}k ft`}
            emptyText="No data"
          />

          {/* Squawk Watchlist */}
          <SquawkWatchlist
            aircraftData={aircraftData}
            onSelect={onSelectAircraft}
          />
        </div>

        {/* ----------------------------------------------------------------
            CENTER COLUMN - Primary Visuals (60%)
            ---------------------------------------------------------------- */}
        <div className="bento-column bento-center">

          {/* KPI Grid - 3 consolidated groups */}
          <div className="kpi-grid">
            <KPICard
              title="Traffic"
              icon={Plane}
              accentColor="cyan"
              metrics={[
                { label: 'Current', value: stats?.total || 0 },
                { label: 'Msg/s', value: messageRate > 0 ? messageRate.toFixed(0) : '--' }
              ]}
            />
            <KPICard
              title="Reception"
              icon={Radio}
              accentColor="green"
              metrics={[
                { label: 'With Pos', value: stats?.with_position || 0 },
                { label: 'Max Dist', value: distanceAnalytics?.statistics?.max_nm ? `${distanceAnalytics.statistics.max_nm.toFixed(0)}nm` : '--' }
              ]}
            />
            <KPICard
              title="System"
              icon={Activity}
              accentColor="purple"
              metrics={[
                { label: '24h Unique', value: histStats?.unique_aircraft || '--' },
                { label: 'Military', value: stats?.military || 0 }
              ]}
            />
          </div>

          {/* Live Graphs Row */}
          <div className="live-graphs-row">
            <div className="live-graph-card">
              <LiveSparkline
                data={aircraftHistory}
                valueKey="count"
                color="#00c8ff"
                height={50}
                label="Aircraft Count"
                currentValue={stats?.total}
              />
            </div>
            <div className="live-graph-card">
              <LiveSparkline
                data={throughputHistory}
                valueKey="messages"
                color="#00ff88"
                height={50}
                label="Message Rate"
                currentValue={messageRate > 0 ? messageRate.toFixed(0) : 0}
                unit=" msg/s"
              />
            </div>
            <div className="live-graph-card">
              <LiveSparkline
                data={throughputHistory}
                valueKey="withPosition"
                color="#f7d794"
                height={50}
                label="Position Reports"
                currentValue={stats?.with_position}
              />
            </div>
          </div>

          {/* Distribution Charts - Horizontal Bars */}
          <div className="distribution-row">
            <div className="distribution-card">
              <HorizontalBarChart
                title="Altitude Distribution"
                data={altitudeData}
                maxItems={4}
                showPercentage={true}
              />
            </div>

            {fleetBreakdown && (
              <div className="distribution-card">
                <HorizontalBarChart
                  title="Flight Categories"
                  data={fleetBreakdown.categories.map(c => ({
                    label: c.name,
                    count: c.count,
                    pct: c.pct,
                    color: c.color
                  }))}
                  maxItems={6}
                  showPercentage={true}
                />
              </div>
            )}
          </div>

          {/* Safety Events Bar Chart (replaces pie chart) */}
          {safetyStats?.total_events > 0 && (
            <div className="safety-events-section">
              <div className="section-header">
                <Shield size={16} />
                <span>Safety Events ({timeRange})</span>
                <span className="section-badge">{safetyStats.total_events} total</span>
              </div>
              <HorizontalBarChart
                data={safetyEventsByType}
                maxItems={6}
                showPercentage={false}
              />
            </div>
          )}

          {/* ACARS Statistics (horizontal bars instead of pie) */}
          {acarsStats && (
            <div className="acars-section">
              <div className="section-header">
                <Radio size={16} />
                <span>ACARS/VDL2 ({timeRange})</span>
                <span className="section-badge">{acarsStats.last_24h?.toLocaleString() || 0} messages</span>
              </div>
              <div className="acars-stats-row">
                <div className="acars-stat">
                  <span className="acars-stat-value">{acarsStats.total_messages?.toLocaleString() || '--'}</span>
                  <span className="acars-stat-label">Total</span>
                </div>
                <div className="acars-stat">
                  <span className="acars-stat-value">{acarsStats.last_hour?.toLocaleString() || '--'}</span>
                  <span className="acars-stat-label">Last Hour</span>
                </div>
                <div className={`acars-stat ${acarsStats.service_stats?.running ? 'active' : 'inactive'}`}>
                  <span className="acars-stat-value">{acarsStats.service_stats?.running ? 'Active' : 'Stopped'}</span>
                  <span className="acars-stat-label">Service</span>
                </div>
              </div>
              {acarsStats.top_labels?.length > 0 && (
                <HorizontalBarChart
                  title="Top Message Types"
                  data={acarsStats.top_labels.slice(0, 6).map(item => ({
                    label: `${item.label} - ${acarsLabelDescriptions[item.label] || item.label}`,
                    count: item.count,
                    color: '#00c8ff'
                  }))}
                  maxItems={6}
                  showPercentage={false}
                />
              )}
            </div>
          )}

          {/* Antenna Analytics Section */}
          <div className="nerd-stats-section">
            <div className="section-header">
              <BarChart3 size={16} />
              <span>Antenna Analytics</span>
              <span className="section-badge beta">Beta</span>
            </div>
            <div className="nerd-stats-grid">
              <PolarPlot data={antennaAnalytics?.polar} />
              <RSSIScatter data={antennaAnalytics?.rssi} />
            </div>
          </div>

          {/* Analytics Section with Tabs */}
          <div className="analytics-section">
            <div className="analytics-header">
              <div className="analytics-title">
                <BarChart3 size={18} />
                Historical Analytics
              </div>
              <div className="analytics-tabs">
                {[
                  { key: 'trends', label: 'Trends', icon: TrendingUp },
                  { key: 'top', label: 'Top Performers', icon: Award },
                  { key: 'distance', label: 'Distance', icon: Target },
                  { key: 'speed', label: 'Speed', icon: Zap },
                  { key: 'patterns', label: 'Patterns', icon: Activity }
                ].map(tab => (
                  <button
                    key={tab.key}
                    className={`analytics-tab ${activeAnalyticsTab === tab.key ? 'active' : ''}`}
                    onClick={() => setActiveAnalyticsTab(tab.key)}
                  >
                    <tab.icon size={14} />
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Trends Tab */}
            {activeAnalyticsTab === 'trends' && trendsData && (
              <div className="analytics-content">
                <div className="trends-summary">
                  <div className="trend-stat">
                    <span className="trend-label">Total Unique</span>
                    <span className="trend-value">{trendsData.summary?.total_unique_aircraft || 0}</span>
                  </div>
                  <div className="trend-stat">
                    <span className="trend-label">Peak Concurrent</span>
                    <span className="trend-value">{trendsData.summary?.peak_concurrent || 0}</span>
                  </div>
                  <div className="trend-stat">
                    <span className="trend-label">Intervals</span>
                    <span className="trend-value">{trendsData.summary?.total_intervals || 0}</span>
                  </div>
                </div>
                {trendsData.intervals?.length > 0 && (
                  <div className="trends-chart">
                    <div className="trend-bars">
                      {trendsData.intervals.map((interval, i) => {
                        const maxCount = Math.max(...trendsData.intervals.map(i => i.unique_aircraft || 0));
                        const height = maxCount > 0 ? ((interval.unique_aircraft || 0) / maxCount) * 100 : 0;
                        return (
                          <div
                            key={i}
                            className="trend-bar"
                            style={{ height: `${height}%` }}
                            title={`${new Date(interval.timestamp).toLocaleTimeString()}: ${interval.unique_aircraft} aircraft`}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Top Performers Tab */}
            {activeAnalyticsTab === 'top' && topPerformersData && (
              <div className="analytics-content">
                <div className="top-performers-tabs">
                  {[
                    { key: 'longest', label: 'Longest' },
                    { key: 'furthest', label: 'Furthest' },
                    { key: 'highest', label: 'Highest' },
                    { key: 'closest', label: 'Closest' }
                  ].map(tab => (
                    <button
                      key={tab.key}
                      className={`top-tab ${topPerformersTab === tab.key ? 'active' : ''}`}
                      onClick={() => setTopPerformersTab(tab.key)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <div className="top-performers-list">
                  {(topPerformersData[topPerformersTab === 'longest' ? 'longest_tracked' :
                    topPerformersTab === 'furthest' ? 'furthest_distance' :
                    topPerformersTab === 'highest' ? 'highest_altitude' : 'closest_approach'] || [])
                    .slice(0, 6).map((ac, i) => (
                      <div
                        key={ac.icao_hex}
                        className={`performer-item ${onSelectAircraft ? 'clickable' : ''} ${ac.is_military ? 'military' : ''}`}
                        onClick={() => onSelectAircraft?.(ac.icao_hex)}
                      >
                        <span className="performer-rank">{i + 1}</span>
                        <div className="performer-info">
                          <span className="performer-callsign">
                            {ac.callsign || ac.icao_hex}
                            {ac.is_military && <span className="mil-badge">MIL</span>}
                          </span>
                          <span className="performer-type">{ac.aircraft_type || 'Unknown'}</span>
                        </div>
                        <span className="performer-value">
                          {topPerformersTab === 'longest' && `${ac.duration_min?.toFixed(0)} min`}
                          {topPerformersTab === 'furthest' && `${ac.max_distance_nm?.toFixed(1)} nm`}
                          {topPerformersTab === 'highest' && `${ac.max_altitude?.toLocaleString()} ft`}
                          {topPerformersTab === 'closest' && `${ac.min_distance_nm?.toFixed(1)} nm`}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Distance Analytics Tab */}
            {activeAnalyticsTab === 'distance' && distanceAnalytics && (
              <div className="analytics-content">
                <div className="distance-stats">
                  <div className="stat-box">
                    <span className="stat-label">Mean</span>
                    <span className="stat-value">{distanceAnalytics.statistics?.mean_nm?.toFixed(1) || '--'} nm</span>
                  </div>
                  <div className="stat-box">
                    <span className="stat-label">Max</span>
                    <span className="stat-value">{distanceAnalytics.statistics?.max_nm?.toFixed(1) || '--'} nm</span>
                  </div>
                  <div className="stat-box">
                    <span className="stat-label">Median</span>
                    <span className="stat-value">{distanceAnalytics.statistics?.median_nm?.toFixed(1) || '--'} nm</span>
                  </div>
                  <div className="stat-box">
                    <span className="stat-label">90th %</span>
                    <span className="stat-value">{distanceAnalytics.statistics?.percentile_90?.toFixed(1) || '--'} nm</span>
                  </div>
                </div>
                {distanceAnalytics.distribution && (
                  <HorizontalBarChart
                    title="Distance Distribution"
                    data={Object.entries(distanceAnalytics.distribution).map(([band, count]) => ({
                      label: band,
                      count,
                      color: '#00c8ff'
                    }))}
                    maxItems={8}
                    showPercentage={false}
                  />
                )}
              </div>
            )}

            {/* Speed Analytics Tab */}
            {activeAnalyticsTab === 'speed' && speedAnalytics && (
              <div className="analytics-content">
                <div className="speed-stats">
                  <div className="stat-box">
                    <span className="stat-label">Mean</span>
                    <span className="stat-value">{speedAnalytics.statistics?.mean_kt || '--'} kt</span>
                  </div>
                  <div className="stat-box">
                    <span className="stat-label">Max</span>
                    <span className="stat-value">{speedAnalytics.statistics?.max_kt || '--'} kt</span>
                  </div>
                  <div className="stat-box">
                    <span className="stat-label">90th %</span>
                    <span className="stat-value">{speedAnalytics.statistics?.percentile_90 || '--'} kt</span>
                  </div>
                </div>
                {speedAnalytics.fastest_sessions?.length > 0 && (
                  <div className="fastest-list">
                    <div className="fastest-title">Fastest Aircraft</div>
                    {speedAnalytics.fastest_sessions.slice(0, 5).map((ac, i) => (
                      <div
                        key={ac.icao_hex}
                        className={`fastest-item ${onSelectAircraft ? 'clickable' : ''}`}
                        onClick={() => onSelectAircraft?.(ac.icao_hex)}
                      >
                        <span className="fastest-rank">{i + 1}</span>
                        <span className="fastest-callsign">{ac.callsign || ac.icao_hex}</span>
                        <span className="fastest-speed">{ac.max_speed} kt</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Patterns Tab */}
            {activeAnalyticsTab === 'patterns' && correlationData && (
              <div className="analytics-content">
                <div className="patterns-grid">
                  <div className="pattern-card">
                    <div className="pattern-title">Altitude vs Speed</div>
                    {correlationData.altitude_vs_speed?.slice(0, 4).map((band, i) => (
                      <div key={band.altitude_band} className="pattern-row">
                        <span className="pattern-label">{band.altitude_band}</span>
                        <span className="pattern-value">{band.avg_speed || '--'} kt avg</span>
                      </div>
                    ))}
                  </div>
                  <div className="pattern-card">
                    <div className="pattern-title">Peak Activity</div>
                    <div className="peak-info">
                      <span className="peak-hour">
                        {correlationData.time_of_day_patterns?.peak_hour !== undefined
                          ? `${correlationData.time_of_day_patterns.peak_hour}:00`
                          : '--'}
                      </span>
                      <span className="peak-count">
                        {correlationData.time_of_day_patterns?.peak_aircraft_count || 0} aircraft
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ----------------------------------------------------------------
            RIGHT COLUMN - System & Safety (20%)
            ---------------------------------------------------------------- */}
        <div className="bento-column bento-right">
          <div className="column-header">
            <Shield size={16} />
            <span>System & Safety</span>
          </div>

          {/* System Status */}
          <SystemStatusCard systemData={systemData} />

          {/* Safety Alerts Summary */}
          <SafetyAlertsSummary safetyStats={safetyStats} timeRange={timeRange} />

          {/* Connection Status */}
          <div className="connection-status-card">
            <div className="connection-header">
              <Wifi size={16} />
              <span>Connection</span>
            </div>
            <div className={`connection-indicator ${wsConnected ? 'connected' : 'disconnected'}`}>
              <span className="connection-dot"></span>
              <span>{wsConnected ? 'WebSocket Active' : 'Polling Mode'}</span>
            </div>
          </div>

          {/* ACARS Service Status */}
          {acarsStats && (
            <div className="service-status-card">
              <div className="service-header">
                <Radio size={16} />
                <span>ACARS Service</span>
              </div>
              <div className={`service-indicator ${acarsStats.service_stats?.running ? 'running' : 'stopped'}`}>
                <span className="service-dot"></span>
                <span>{acarsStats.service_stats?.running ? 'Running' : 'Stopped'}</span>
              </div>
              <div className="service-stats">
                <div className="service-stat">
                  <span className="service-stat-value">{acarsStats.last_hour || 0}</span>
                  <span className="service-stat-label">Last Hour</span>
                </div>
              </div>
            </div>
          )}

          {/* Safety Monitor Status */}
          {safetyStats && (
            <div className="monitor-status-card">
              <div className="monitor-header">
                <Shield size={16} />
                <span>Safety Monitor</span>
              </div>
              <div className={`monitor-indicator ${safetyStats.monitoring_enabled ? 'active' : 'inactive'}`}>
                <span className="monitor-dot"></span>
                <span>{safetyStats.monitoring_enabled ? 'Active' : 'Inactive'}</span>
              </div>
              {safetyStats.monitor_state?.tracked_aircraft && (
                <div className="monitor-tracking">
                  Tracking {safetyStats.monitor_state.tracked_aircraft} aircraft
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
