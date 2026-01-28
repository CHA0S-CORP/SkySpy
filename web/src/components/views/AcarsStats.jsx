import React, { useState, useMemo } from 'react';
import {
  Radio, MessageSquare, TrendingUp, Users,
  FileText, Clock, Activity, BarChart2,
  Filter, ChevronDown, RefreshCw, Signal,
  Zap, AlertCircle
} from 'lucide-react';
import { useStats } from '../../hooks';

/**
 * AcarsStats - Full page view for ACARS/VDL2 statistics
 * - Message type breakdown chart
 * - Top airlines by ACARS activity
 * - Message trends over time
 * - Service statistics
 */
export function AcarsStats({ apiBase, wsRequest, wsConnected }) {
  const [timeRange, setTimeRange] = useState('24h');
  const [showFilters, setShowFilters] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');

  const hours = { '1h': 1, '6h': 6, '24h': 24, '48h': 48, '7d': 168, '30d': 720 };
  const selectedHours = hours[timeRange] || 24;

  const { acarsStats, loading, error, refetch } = useStats(apiBase, {
    wsRequest,
    wsConnected,
    hours: selectedHours
  });

  const data = acarsStats;

  const {
    message_types = [],
    top_airlines = [],
    hourly_trend = [],
    total_messages = 0,
    last_24h = 0,
    last_hour = 0,
    service_stats = {},
    top_labels = []
  } = data || {};

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

  // Use message_types or top_labels depending on what's available
  const messageTypesData = message_types.length > 0 ? message_types : top_labels;

  // Filter message types if filter is set
  const filteredTypes = useMemo(() => {
    if (!typeFilter) return messageTypesData;
    return messageTypesData.filter(t =>
      t.label?.toLowerCase().includes(typeFilter.toLowerCase()) ||
      labelDescriptions[t.label]?.toLowerCase().includes(typeFilter.toLowerCase())
    );
  }, [messageTypesData, typeFilter]);

  const maxTypeCount = Math.max(...filteredTypes.map(t => t.count || 0), 1);
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

  // Summary stats
  const summaryStats = useMemo(() => ({
    totalMessages: total_messages || 0,
    last24h: last_24h || 0,
    lastHour: last_hour || 0,
    msgPerHour: last_24h > 0 ? Math.round(last_24h / 24) : 0,
    uniqueTypes: messageTypesData.length,
    topAirlines: top_airlines.length
  }), [total_messages, last_24h, last_hour, messageTypesData, top_airlines]);

  if (loading && !data) {
    return (
      <div className="stats-page acars-stats-page">
        <div className="loading-state">
          <RefreshCw className="spin" size={24} />
          <span>Loading ACARS data...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="stats-page acars-stats-page">
        <div className="error-state">
          <span>Error loading data: {error}</span>
          <button onClick={refetch}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="stats-page acars-stats-page">
      {/* Page Header */}
      <div className="page-header">
        <div className="page-title">
          <Radio size={24} />
          <h1>ACARS/VDL2 Analytics</h1>
          <span className={`service-status ${service_stats.running ? 'active' : 'inactive'}`}>
            {service_stats.running ? 'Active' : 'Inactive'}
          </span>
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
        <div className="filter-divider" />
        <button
          className={`advanced-filter-btn ${showFilters ? 'active' : ''}`}
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter size={14} />
          <span>Filters</span>
          <ChevronDown size={14} className={`chevron ${showFilters ? 'open' : ''}`} />
        </button>
      </div>

      {showFilters && (
        <div className="advanced-filters-panel">
          <div className="filter-row">
            <div className="filter-field">
              <label>Message Type</label>
              <input
                type="text"
                placeholder="Filter by type..."
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value.toUpperCase())}
              />
            </div>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="summary-cards">
        <div className="summary-card">
          <div className="summary-icon"><MessageSquare size={20} /></div>
          <div className="summary-content">
            <span className="summary-value">{summaryStats.totalMessages.toLocaleString()}</span>
            <span className="summary-label">Total Messages</span>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon"><Clock size={20} /></div>
          <div className="summary-content">
            <span className="summary-value">{summaryStats.last24h.toLocaleString()}</span>
            <span className="summary-label">Last 24h</span>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon"><Zap size={20} /></div>
          <div className="summary-content">
            <span className="summary-value">{summaryStats.lastHour.toLocaleString()}</span>
            <span className="summary-label">Last Hour</span>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon"><Activity size={20} /></div>
          <div className="summary-content">
            <span className="summary-value">{summaryStats.msgPerHour}</span>
            <span className="summary-label">Avg/Hour</span>
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="acars-stats-grid expanded">
        {/* Message Types Breakdown */}
        <div className="acars-card types-card large">
          <div className="card-header">
            <FileText size={16} />
            <span>Message Types</span>
            <span className="card-badge">{filteredTypes.length} types</span>
          </div>
          {filteredTypes.length === 0 ? (
            <div className="empty-state">No message type data</div>
          ) : (
            <div className="acars-types-chart expanded">
              {filteredTypes.slice(0, 15).map((type, i) => {
                const color = typeColors[i % typeColors.length];
                const description = labelDescriptions[type.label] || type.label;
                return (
                  <div key={type.label || i} className="acars-type-item expanded">
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
        <div className="acars-card airlines-card large">
          <div className="card-header">
            <Users size={16} />
            <span>Top Airlines by Activity</span>
            <span className="card-badge">{top_airlines.length} airlines</span>
          </div>
          {top_airlines.length === 0 ? (
            <div className="empty-state">No airline data</div>
          ) : (
            <div className="acars-airlines-list expanded">
              {top_airlines.slice(0, 15).map((airline, i) => (
                <div key={airline.code || i} className="acars-airline-item expanded">
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
        <div className="acars-card trend-card large">
          <div className="card-header">
            <TrendingUp size={16} />
            <span>Message Trend (24h)</span>
          </div>
          {trendData.length === 0 ? (
            <div className="empty-state">No trend data</div>
          ) : (
            <div className="acars-trend-chart expanded">
              <div className="trend-bars-container large">
                {trendData.map((point, i) => (
                  <div
                    key={i}
                    className="acars-trend-bar-wrapper"
                    title={`${point.hour ?? i}:00 - ${point.count} messages`}
                  >
                    <div
                      className="acars-trend-bar"
                      style={{ height: `${point.normalized}%` }}
                    />
                    {i % 4 === 0 && (
                      <span className="trend-hour-label">{point.hour ?? i}h</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="trend-x-axis expanded">
                <span>0:00</span>
                <span>6:00</span>
                <span>12:00</span>
                <span>18:00</span>
                <span>24:00</span>
              </div>
            </div>
          )}
        </div>

        {/* Service Stats */}
        {service_stats && Object.keys(service_stats).length > 0 && (
          <div className="acars-card service-card large">
            <div className="card-header">
              <BarChart2 size={16} />
              <span>Service Statistics</span>
              <span className={`service-indicator ${service_stats.running ? 'running' : 'stopped'}`}>
                {service_stats.running ? 'Running' : 'Stopped'}
              </span>
            </div>
            <div className="service-stats-grid expanded">
              {service_stats.uptime && (
                <div className="service-stat">
                  <Clock size={18} />
                  <span className="service-stat-label">Uptime</span>
                  <span className="service-stat-value">{service_stats.uptime}</span>
                </div>
              )}
              {service_stats.frequency && (
                <div className="service-stat">
                  <Radio size={18} />
                  <span className="service-stat-label">Frequency</span>
                  <span className="service-stat-value">{service_stats.frequency} MHz</span>
                </div>
              )}
              {service_stats.error_rate !== undefined && (
                <div className="service-stat">
                  <AlertCircle size={18} />
                  <span className="service-stat-label">Error Rate</span>
                  <span className="service-stat-value">{service_stats.error_rate.toFixed(2)}%</span>
                </div>
              )}
              {service_stats.avg_signal !== undefined && (
                <div className="service-stat">
                  <Signal size={18} />
                  <span className="service-stat-label">Avg Signal</span>
                  <span className="service-stat-value">{service_stats.avg_signal.toFixed(1)} dB</span>
                </div>
              )}
              {service_stats.messages_decoded !== undefined && (
                <div className="service-stat">
                  <MessageSquare size={18} />
                  <span className="service-stat-label">Decoded</span>
                  <span className="service-stat-value">{service_stats.messages_decoded.toLocaleString()}</span>
                </div>
              )}
              {service_stats.decode_rate !== undefined && (
                <div className="service-stat">
                  <Zap size={18} />
                  <span className="service-stat-label">Decode Rate</span>
                  <span className="service-stat-value">{service_stats.decode_rate.toFixed(1)}/s</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Message Type Distribution Pie Chart Alternative */}
        <div className="acars-card distribution-card">
          <div className="card-header">
            <BarChart2 size={16} />
            <span>Message Distribution</span>
          </div>
          <div className="message-distribution">
            {filteredTypes.slice(0, 8).map((type, i) => {
              const total = filteredTypes.reduce((sum, t) => sum + (t.count || 0), 0) || 1;
              const pct = ((type.count || 0) / total) * 100;
              return (
                <div key={type.label || i} className="distribution-item">
                  <div
                    className="distribution-bar"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: typeColors[i % typeColors.length]
                    }}
                  />
                  <span className="distribution-label">{type.label}</span>
                  <span className="distribution-pct">{pct.toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default AcarsStats;
