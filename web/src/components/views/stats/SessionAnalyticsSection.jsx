import React, { useMemo } from 'react';
import {
  Activity, Signal, BarChart3, Users, RefreshCw,
  Gauge, CheckCircle, AlertCircle, TrendingUp, Loader2
} from 'lucide-react';

/**
 * SessionAnalyticsSection - Displays session/tracking analytics
 * - Tracking quality metrics (update rate, completeness score)
 * - Engagement stats (peak concurrent, return aircraft)
 */
export function SessionAnalyticsSection({ data, loading }) {
  // Show loading skeleton when data is loading
  if (loading) {
    return (
      <div className="stats-section session-analytics-section">
        <div className="section-header">
          <Activity size={18} />
          <span>Session Analytics</span>
        </div>
        <div className="section-loading">
          <Loader2 size={24} className="spin" />
          <span>Loading session analytics...</span>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const {
    tracking_quality = {},
    engagement = {},
    session_stats = {},
    data_completeness = {}
  } = data;

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
      trend: engagement.peak_trend
    },
    {
      label: 'Return Aircraft',
      value: engagement.return_aircraft ?? '--',
      subtext: engagement.return_percentage ? `${engagement.return_percentage.toFixed(1)}%` : null,
      icon: RefreshCw
    },
    {
      label: 'Avg Track Duration',
      value: session_stats.avg_duration_min ? `${session_stats.avg_duration_min.toFixed(0)}m` : '--',
      icon: Activity
    },
    {
      label: 'Total Sessions',
      value: session_stats.total_sessions?.toLocaleString() ?? '--',
      icon: BarChart3
    }
  ];

  // Completeness metrics
  const completenessItems = [
    { label: 'Position', value: data_completeness.position_pct ?? 0 },
    { label: 'Altitude', value: data_completeness.altitude_pct ?? 0 },
    { label: 'Speed', value: data_completeness.speed_pct ?? 0 },
    { label: 'Callsign', value: data_completeness.callsign_pct ?? 0 },
    { label: 'Squawk', value: data_completeness.squawk_pct ?? 0 },
    { label: 'Type', value: data_completeness.aircraft_type_pct ?? 0 }
  ];

  return (
    <div className="stats-section session-analytics-section">
      <div className="section-header">
        <Activity size={18} />
        <span>Session Analytics</span>
      </div>

      <div className="session-analytics-grid">
        {/* Tracking Quality Gauge */}
        <div className="analytics-card quality-card">
          <div className="card-header">
            <Gauge size={16} />
            <span>Tracking Quality</span>
          </div>
          <div className="quality-gauge-container">
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
          <div className="quality-details">
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
          </div>
        </div>

        {/* Engagement Stats */}
        <div className="analytics-card engagement-card">
          <div className="card-header">
            <TrendingUp size={16} />
            <span>Engagement</span>
          </div>
          <div className="engagement-metrics">
            {engagementMetrics.map((metric, i) => (
              <div key={i} className="engagement-metric">
                <div className="metric-icon">
                  <metric.icon size={18} />
                </div>
                <div className="metric-content">
                  <span className="metric-value">{metric.value}</span>
                  {metric.subtext && (
                    <span className="metric-subtext">{metric.subtext}</span>
                  )}
                  <span className="metric-label">{metric.label}</span>
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
          <div className="completeness-bars">
            {completenessItems.map((item, i) => (
              <div key={item.label} className="completeness-item">
                <div className="completeness-header">
                  <span className="completeness-label">{item.label}</span>
                  <span className="completeness-value">{item.value.toFixed(0)}%</span>
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

        {/* Session Statistics */}
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

export default SessionAnalyticsSection;
