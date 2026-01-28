import React, { useState, useMemo } from 'react';
import {
  Activity, Signal, BarChart3, Users, RefreshCw,
  Gauge, CheckCircle, AlertCircle, TrendingUp,
  Clock, Filter, ChevronDown, Eye, Repeat
} from 'lucide-react';
import { useStats } from '../../hooks';

/**
 * SessionAnalyticsStats - Full page view for session/tracking analytics
 * - Tracking quality metrics (update rate, completeness score)
 * - Engagement stats (peak concurrent, return aircraft)
 * - Most-watched aircraft
 * - Return visitors analysis
 */
export function SessionAnalyticsStats({ apiBase, wsRequest, wsConnected }) {
  const [timeRange, setTimeRange] = useState('24h');
  const [showFilters, setShowFilters] = useState(false);

  const hours = { '1h': 1, '6h': 6, '24h': 24, '48h': 48, '7d': 168, '30d': 720 };
  const selectedHours = hours[timeRange] || 24;

  const { sessionAnalytics, loading, error, refetch } = useStats(apiBase, {
    wsRequest,
    wsConnected,
    hours: selectedHours
  });

  const data = sessionAnalytics;

  const {
    tracking_quality = {},
    engagement = {},
    session_stats = {},
    data_completeness = {},
    most_watched = [],
    return_visitors = {}
  } = data || {};

  // Quality score color
  const getQualityColor = (score) => {
    if (score >= 90) return '#00ff88';
    if (score >= 70) return '#00c8ff';
    if (score >= 50) return '#f7d794';
    return '#ff4757';
  };

  // Build quality gauge
  const qualityScore = tracking_quality.overall_score ?? 0;
  const qualityAngle = (qualityScore / 100) * 180;

  // Engagement metrics
  const engagementMetrics = [
    {
      label: 'Peak Concurrent',
      value: engagement.peak_concurrent ?? '--',
      icon: Users,
      trend: engagement.peak_trend,
      description: 'Maximum aircraft tracked simultaneously'
    },
    {
      label: 'Return Aircraft',
      value: engagement.return_aircraft ?? '--',
      subtext: engagement.return_percentage ? `${engagement.return_percentage.toFixed(1)}%` : null,
      icon: Repeat,
      description: 'Aircraft seen more than once'
    },
    {
      label: 'Avg Track Duration',
      value: session_stats.avg_duration_min ? `${session_stats.avg_duration_min.toFixed(0)}m` : '--',
      icon: Clock,
      description: 'Average time an aircraft is tracked'
    },
    {
      label: 'Total Sessions',
      value: session_stats.total_sessions?.toLocaleString() ?? '--',
      icon: Activity,
      description: 'Total unique tracking sessions'
    }
  ];

  // Completeness metrics
  const completenessItems = [
    { label: 'Position', value: data_completeness.position_pct ?? 0, icon: Signal },
    { label: 'Altitude', value: data_completeness.altitude_pct ?? 0, icon: TrendingUp },
    { label: 'Speed', value: data_completeness.speed_pct ?? 0, icon: Activity },
    { label: 'Callsign', value: data_completeness.callsign_pct ?? 0, icon: Users },
    { label: 'Squawk', value: data_completeness.squawk_pct ?? 0, icon: AlertCircle },
    { label: 'Type', value: data_completeness.aircraft_type_pct ?? 0, icon: BarChart3 }
  ];

  // Summary stats
  const summaryStats = useMemo(() => ({
    qualityScore: qualityScore.toFixed(0),
    peakConcurrent: engagement.peak_concurrent ?? 0,
    totalSessions: session_stats.total_sessions ?? 0,
    avgDuration: session_stats.avg_duration_min?.toFixed(0) ?? 0
  }), [qualityScore, engagement, session_stats]);

  if (loading && !data) {
    return (
      <div className="stats-page session-analytics-page">
        <div className="loading-state">
          <RefreshCw className="spin" size={24} />
          <span>Loading session analytics...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="stats-page session-analytics-page">
        <div className="error-state">
          <span>Error loading data: {error}</span>
          <button onClick={refetch}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="stats-page session-analytics-page">
      {/* Page Header */}
      <div className="page-header">
        <div className="page-title">
          <Activity size={24} />
          <h1>Session Analytics</h1>
        </div>
        <div className="page-actions">
          <button className="refresh-btn" onClick={refetch} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="stats-filters">
        <div className="filter-group">
          <Clock size={14} />
          <span className="filter-label">Time Range</span>
          <div className="time-range-buttons">
            {Object.keys(hours).map(range => (
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
      </div>

      {/* Summary Cards */}
      <div className="summary-cards">
        <div className="summary-card quality">
          <div className="summary-icon"><Gauge size={20} /></div>
          <div className="summary-content">
            <span className="summary-value" style={{ color: getQualityColor(qualityScore) }}>
              {summaryStats.qualityScore}%
            </span>
            <span className="summary-label">Quality Score</span>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon"><Users size={20} /></div>
          <div className="summary-content">
            <span className="summary-value">{summaryStats.peakConcurrent}</span>
            <span className="summary-label">Peak Concurrent</span>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon"><Activity size={20} /></div>
          <div className="summary-content">
            <span className="summary-value">{summaryStats.totalSessions.toLocaleString()}</span>
            <span className="summary-label">Total Sessions</span>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon"><Clock size={20} /></div>
          <div className="summary-content">
            <span className="summary-value">{summaryStats.avgDuration}m</span>
            <span className="summary-label">Avg Duration</span>
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="session-analytics-grid expanded">
        {/* Tracking Quality Gauge */}
        <div className="analytics-card quality-card large">
          <div className="card-header">
            <Gauge size={16} />
            <span>Tracking Quality</span>
          </div>
          <div className="quality-gauge-container large">
            <svg viewBox="0 0 200 120" className="quality-gauge">
              {/* Background arc */}
              <path
                d="M 20 100 A 80 80 0 0 1 180 100"
                fill="none"
                stroke="rgba(255, 255, 255, 0.1)"
                strokeWidth="12"
                strokeLinecap="round"
              />
              {/* Value arc */}
              <path
                d="M 20 100 A 80 80 0 0 1 180 100"
                fill="none"
                stroke={getQualityColor(qualityScore)}
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray={`${(qualityAngle / 180) * 251.33} 251.33`}
                className="gauge-value-arc"
              />
              {/* Center text */}
              <text x="100" y="85" textAnchor="middle" className="gauge-value">
                {qualityScore.toFixed(0)}
              </text>
              <text x="100" y="105" textAnchor="middle" className="gauge-label">
                Quality Score
              </text>
            </svg>
          </div>
          <div className="quality-details expanded">
            <div className="quality-item">
              <span className="quality-label">Update Rate</span>
              <span className="quality-value">
                {tracking_quality.update_rate_hz ? `${tracking_quality.update_rate_hz.toFixed(1)} Hz` : '--'}
              </span>
            </div>
            <div className="quality-item">
              <span className="quality-label">Avg Signal</span>
              <span className="quality-value">
                {tracking_quality.avg_rssi ? `${tracking_quality.avg_rssi.toFixed(1)} dB` : '--'}
              </span>
            </div>
            <div className="quality-item">
              <span className="quality-label">Coverage</span>
              <span className="quality-value">
                {tracking_quality.coverage_pct ? `${tracking_quality.coverage_pct.toFixed(0)}%` : '--'}
              </span>
            </div>
            <div className="quality-item">
              <span className="quality-label">Msg Drop Rate</span>
              <span className="quality-value">
                {tracking_quality.drop_rate_pct ? `${tracking_quality.drop_rate_pct.toFixed(2)}%` : '--'}
              </span>
            </div>
          </div>
        </div>

        {/* Engagement Stats */}
        <div className="analytics-card engagement-card large">
          <div className="card-header">
            <TrendingUp size={16} />
            <span>Engagement Metrics</span>
          </div>
          <div className="engagement-metrics expanded">
            {engagementMetrics.map((metric, i) => (
              <div key={i} className="engagement-metric large">
                <div className="metric-icon">
                  <metric.icon size={24} />
                </div>
                <div className="metric-content">
                  <span className="metric-value">{metric.value}</span>
                  {metric.subtext && (
                    <span className="metric-subtext">{metric.subtext}</span>
                  )}
                  <span className="metric-label">{metric.label}</span>
                  <span className="metric-description">{metric.description}</span>
                </div>
                {metric.trend && (
                  <span className={`metric-trend ${metric.trend > 0 ? 'up' : 'down'}`}>
                    {metric.trend > 0 ? '+' : ''}{metric.trend}%
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Data Completeness */}
        <div className="analytics-card completeness-card">
          <div className="card-header">
            <CheckCircle size={16} />
            <span>Data Completeness</span>
          </div>
          <div className="completeness-bars expanded">
            {completenessItems.map((item, i) => (
              <div key={item.label} className="completeness-item expanded">
                <div className="completeness-header">
                  <item.icon size={14} />
                  <span className="completeness-label">{item.label}</span>
                  <span
                    className="completeness-value"
                    style={{ color: getQualityColor(item.value) }}
                  >
                    {item.value.toFixed(0)}%
                  </span>
                </div>
                <div className="completeness-bar-track">
                  <div
                    className="completeness-bar-fill"
                    style={{
                      width: `${item.value}%`,
                      backgroundColor: getQualityColor(item.value)
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Most Watched Aircraft */}
        {most_watched?.length > 0 && (
          <div className="analytics-card most-watched-card">
            <div className="card-header">
              <Eye size={16} />
              <span>Most Watched Aircraft</span>
            </div>
            <div className="most-watched-list">
              {most_watched.slice(0, 10).map((aircraft, i) => (
                <div key={aircraft.icao_hex || i} className="watched-item">
                  <span className="watched-rank">{i + 1}</span>
                  <div className="watched-info">
                    <span className="watched-callsign">{aircraft.callsign || aircraft.icao_hex}</span>
                    <span className="watched-type">{aircraft.aircraft_type || 'Unknown'}</span>
                  </div>
                  <div className="watched-stats">
                    <span className="watched-duration">{aircraft.total_duration_min?.toFixed(0)}m</span>
                    <span className="watched-sessions">{aircraft.session_count} sessions</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Return Visitors */}
        {return_visitors && Object.keys(return_visitors).length > 0 && (
          <div className="analytics-card return-visitors-card">
            <div className="card-header">
              <Repeat size={16} />
              <span>Return Visitors Analysis</span>
            </div>
            <div className="return-visitors-content">
              <div className="return-stat">
                <span className="return-value">{return_visitors.total_return || 0}</span>
                <span className="return-label">Returning Aircraft</span>
              </div>
              <div className="return-stat">
                <span className="return-value">{return_visitors.return_rate?.toFixed(1) || 0}%</span>
                <span className="return-label">Return Rate</span>
              </div>
              <div className="return-stat">
                <span className="return-value">{return_visitors.avg_visits?.toFixed(1) || 0}</span>
                <span className="return-label">Avg Visits</span>
              </div>
              {return_visitors.frequent_visitors?.length > 0 && (
                <div className="frequent-visitors">
                  <span className="frequent-title">Frequent Visitors</span>
                  <div className="frequent-list">
                    {return_visitors.frequent_visitors.slice(0, 5).map((visitor, i) => (
                      <div key={visitor.icao_hex || i} className="frequent-item">
                        <span className="frequent-callsign">{visitor.callsign || visitor.icao_hex}</span>
                        <span className="frequent-visits">{visitor.visit_count} visits</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Session Statistics Distribution */}
        {session_stats.session_distribution && (
          <div className="analytics-card session-dist-card">
            <div className="card-header">
              <BarChart3 size={16} />
              <span>Session Duration Distribution</span>
            </div>
            <div className="session-distribution">
              {Object.entries(session_stats.session_distribution).map(([range, count]) => {
                const maxCount = Math.max(...Object.values(session_stats.session_distribution), 1);
                return (
                  <div key={range} className="dist-bar-item">
                    <span className="dist-label">{range}</span>
                    <div className="dist-bar-track">
                      <div
                        className="dist-bar-fill"
                        style={{ width: `${(count / maxCount) * 100}%` }}
                      />
                    </div>
                    <span className="dist-count">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SessionAnalyticsStats;
