import React, { useMemo } from 'react';
import {
  Radio, MessageSquare, TrendingUp, Users,
  FileText, Clock, Activity, BarChart2, Loader2
} from 'lucide-react';

/**
 * AcarsStatsSection - Displays ACARS/VDL2 statistics
 * - Message type breakdown chart
 * - Top airlines by ACARS activity
 * - Message trends over time
 */
export function AcarsStatsSection({ data, loading }) {
  // Show loading skeleton when data is loading
  if (loading) {
    return (
      <div className="stats-section acars-stats-section">
        <div className="section-header">
          <Radio size={18} />
          <span>ACARS Statistics</span>
        </div>
        <div className="section-loading">
          <Loader2 size={24} className="spin" />
          <span>Loading ACARS data...</span>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const {
    message_types = [],
    top_airlines = [],
    hourly_trend = [],
    total_messages = 0,
    last_24h = 0,
    last_hour = 0,
    service_stats = {}
  } = data;

  // ACARS label descriptions
  const labelDescriptions = {
    '_d': 'Command',
    'H1': 'Departure',
    'H2': 'Arrival',
    '10': 'OUT Gate',
    '11': 'OFF Takeoff',
    '12': 'ON Landing',
    '13': 'IN Gate',
    '44': 'Position Report',
    '5Z': 'Airline Ops',
    'AA': 'Free Text',
    'SA': 'System',
    'CA': 'CPDLC',
    'Q0': 'Weather Request',
    'QA': 'ATIS',
    'QC': 'Clearance',
    'QD': 'METAR',
    'QE': 'TAF',
    'QF': 'NOTAM',
    'SQ': 'SELCAL',
    'B0': 'Booking',
    'B1': 'Passenger',
    'B2': 'Load Info',
    'B3': 'Cargo',
    'M1': 'Maintenance'
  };

  const maxTypeCount = Math.max(...message_types.map(t => t.count || 0), 1);
  const maxAirlineCount = Math.max(...top_airlines.map(a => a.count || 0), 1);

  // Message type colors
  const typeColors = [
    '#00c8ff', '#00ff88', '#a371f7', '#ff9f43',
    '#f85149', '#f7d794', '#4ecdc4', '#95e1d3'
  ];

  // Normalize hourly trend
  const trendData = useMemo(() => {
    if (!hourly_trend.length) return [];
    const max = Math.max(...hourly_trend.map(h => h.count || 0), 1);
    return hourly_trend.map(h => ({
      ...h,
      normalized: ((h.count || 0) / max) * 100
    }));
  }, [hourly_trend]);

  return (
    <div className="stats-section acars-stats-section">
      <div className="section-header">
        <Radio size={18} />
        <span>ACARS/VDL2 Analytics</span>
        <span className={`section-status ${service_stats.running ? 'active' : 'inactive'}`}>
          {service_stats.running ? 'Active' : 'Inactive'}
        </span>
      </div>

      {/* Summary Stats */}
      <div className="acars-summary">
        <div className="acars-summary-stat">
          <MessageSquare size={20} />
          <div className="stat-content">
            <span className="stat-value">{total_messages?.toLocaleString() ?? '--'}</span>
            <span className="stat-label">Total Messages</span>
          </div>
        </div>
        <div className="acars-summary-stat">
          <Clock size={20} />
          <div className="stat-content">
            <span className="stat-value">{last_24h?.toLocaleString() ?? '--'}</span>
            <span className="stat-label">Last 24h</span>
          </div>
        </div>
        <div className="acars-summary-stat">
          <Activity size={20} />
          <div className="stat-content">
            <span className="stat-value">{last_hour?.toLocaleString() ?? '--'}</span>
            <span className="stat-label">Last Hour</span>
          </div>
        </div>
      </div>

      <div className="acars-stats-grid">
        {/* Message Types Breakdown */}
        <div className="acars-card types-card">
          <div className="card-header">
            <FileText size={16} />
            <span>Message Types</span>
          </div>
          {message_types.length === 0 ? (
            <div className="empty-state">No message type data</div>
          ) : (
            <div className="acars-types-chart">
              {message_types.slice(0, 10).map((type, i) => {
                const color = typeColors[i % typeColors.length];
                const description = labelDescriptions[type.label] || type.label;
                return (
                  <div key={type.label || i} className="acars-type-item">
                    <div className="acars-type-header">
                      <span className="acars-type-label">
                        <span className="type-code">{type.label}</span>
                        <span className="type-desc">{description}</span>
                      </span>
                      <span className="acars-type-count">{type.count?.toLocaleString()}</span>
                    </div>
                    <div className="acars-type-bar-track">
                      <div
                        className="acars-type-bar-fill"
                        style={{
                          width: `${(type.count / maxTypeCount) * 100}%`,
                          backgroundColor: color
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Top Airlines */}
        <div className="acars-card airlines-card">
          <div className="card-header">
            <Users size={16} />
            <span>Top Airlines by Activity</span>
          </div>
          {top_airlines.length === 0 ? (
            <div className="empty-state">No airline data</div>
          ) : (
            <div className="acars-airlines-list">
              {top_airlines.slice(0, 10).map((airline, i) => (
                <div key={airline.code || i} className="acars-airline-item">
                  <span className="airline-rank">{i + 1}</span>
                  <div className="airline-info">
                    <span className="airline-code">{airline.code || '???'}</span>
                    {airline.name && (
                      <span className="airline-name">{airline.name}</span>
                    )}
                  </div>
                  <div className="airline-bar-container">
                    <div
                      className="airline-bar-fill"
                      style={{ width: `${(airline.count / maxAirlineCount) * 100}%` }}
                    />
                  </div>
                  <span className="airline-count">{airline.count?.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Hourly Trend */}
        <div className="acars-card trend-card">
          <div className="card-header">
            <TrendingUp size={16} />
            <span>Message Trend (24h)</span>
          </div>
          {trendData.length === 0 ? (
            <div className="empty-state">No trend data</div>
          ) : (
            <div className="acars-trend-chart">
              <div className="trend-bars-container">
                {trendData.map((point, i) => (
                  <div
                    key={i}
                    className="acars-trend-bar"
                    style={{ height: `${point.normalized}%` }}
                    title={`${point.hour ?? i}:00 - ${point.count} messages`}
                  >
                    <span className="bar-tooltip">{point.count}</span>
                  </div>
                ))}
              </div>
              <div className="trend-x-axis">
                <span>0h</span>
                <span>6h</span>
                <span>12h</span>
                <span>18h</span>
                <span>24h</span>
              </div>
            </div>
          )}
        </div>

        {/* Service Stats */}
        {service_stats && Object.keys(service_stats).length > 0 && (
          <div className="acars-card service-card">
            <div className="card-header">
              <BarChart2 size={16} />
              <span>Service Statistics</span>
            </div>
            <div className="service-stats-grid">
              {service_stats.uptime && (
                <div className="service-stat">
                  <span className="service-stat-label">Uptime</span>
                  <span className="service-stat-value">{service_stats.uptime}</span>
                </div>
              )}
              {service_stats.frequency && (
                <div className="service-stat">
                  <span className="service-stat-label">Frequency</span>
                  <span className="service-stat-value">{service_stats.frequency} MHz</span>
                </div>
              )}
              {service_stats.error_rate !== undefined && (
                <div className="service-stat">
                  <span className="service-stat-label">Error Rate</span>
                  <span className="service-stat-value">{service_stats.error_rate.toFixed(2)}%</span>
                </div>
              )}
              {service_stats.avg_signal !== undefined && (
                <div className="service-stat">
                  <span className="service-stat-label">Avg Signal</span>
                  <span className="service-stat-value">{service_stats.avg_signal.toFixed(1)} dB</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default AcarsStatsSection;
