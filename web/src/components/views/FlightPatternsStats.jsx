import React, { useState, useMemo } from 'react';
import {
  Navigation2, Clock, Plane, Timer, TrendingUp,
  ArrowRight, BarChart2, Filter, ChevronDown, RefreshCw
} from 'lucide-react';
import { useStats } from '../../hooks';

/**
 * FlightPatternsStats - Full page view for flight pattern analytics
 * - Top routes table
 * - Busiest hours heatmap/bar chart
 * - Aircraft types breakdown
 * - Average flight duration by type
 */
export function FlightPatternsStats({ apiBase, wsRequest, wsConnected, onSelectAircraft }) {
  const [timeRange, setTimeRange] = useState('24h');
  const [showFilters, setShowFilters] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');

  const hours = { '1h': 1, '6h': 6, '24h': 24, '48h': 48, '7d': 168, '30d': 720 };
  const selectedHours = hours[timeRange] || 24;

  const { flightPatterns, loading, error, refetch } = useStats(apiBase, {
    wsRequest,
    wsConnected,
    hours: selectedHours
  });

  const data = flightPatterns;

  // Process data with filters
  const {
    top_routes = [],
    busiest_hours = [],
    aircraft_types = [],
    duration_by_type = []
  } = data || {};

  // Filter aircraft types if filter is set
  const filteredTypes = useMemo(() => {
    if (!typeFilter) return aircraft_types;
    return aircraft_types.filter(t =>
      t.type?.toLowerCase().includes(typeFilter.toLowerCase())
    );
  }, [aircraft_types, typeFilter]);

  // Find max values for normalization
  const maxRouteCount = Math.max(...top_routes.map(r => r.count || 0), 1);
  const maxHourCount = Math.max(...busiest_hours.map(h => h.count || 0), 1);
  const maxTypeCount = Math.max(...filteredTypes.map(t => t.count || 0), 1);

  // Color scale for hours heatmap
  const getHourColor = (count) => {
    if (!count) return 'rgba(255, 255, 255, 0.03)';
    const intensity = count / maxHourCount;
    if (intensity > 0.8) return 'rgba(0, 200, 255, 0.8)';
    if (intensity > 0.6) return 'rgba(0, 200, 255, 0.6)';
    if (intensity > 0.4) return 'rgba(0, 200, 255, 0.4)';
    if (intensity > 0.2) return 'rgba(0, 200, 255, 0.25)';
    return 'rgba(0, 200, 255, 0.1)';
  };

  // Prepare hours data (0-23)
  const hoursData = useMemo(() => {
    const hourMap = {};
    busiest_hours.forEach(h => {
      hourMap[h.hour] = h.count;
    });
    return Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      count: hourMap[i] || 0,
      label: `${i.toString().padStart(2, '0')}:00`
    }));
  }, [busiest_hours]);

  // Calculate summary stats
  const summaryStats = useMemo(() => {
    const totalFlights = busiest_hours.reduce((sum, h) => sum + (h.count || 0), 0);
    const peakHour = busiest_hours.reduce((max, h) => (h.count || 0) > (max?.count || 0) ? h : max, busiest_hours[0]);
    const uniqueTypes = aircraft_types.length;
    const avgFlightsPerHour = busiest_hours.length > 0 ? (totalFlights / busiest_hours.length).toFixed(1) : 0;

    return { totalFlights, peakHour, uniqueTypes, avgFlightsPerHour };
  }, [busiest_hours, aircraft_types]);

  if (loading && !data) {
    return (
      <div className="stats-page flight-patterns-page">
        <div className="loading-state">
          <RefreshCw className="spin" size={24} />
          <span>Loading flight patterns...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="stats-page flight-patterns-page">
        <div className="error-state">
          <span>Error loading data: {error}</span>
          <button onClick={refetch}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="stats-page flight-patterns-page">
      {/* Page Header */}
      <div className="page-header">
        <div className="page-title">
          <Navigation2 size={24} />
          <h1>Flight Patterns</h1>
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
              <label>Aircraft Type</label>
              <input
                type="text"
                placeholder="e.g. B738, A320"
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
          <div className="summary-icon"><TrendingUp size={20} /></div>
          <div className="summary-content">
            <span className="summary-value">{summaryStats.totalFlights.toLocaleString()}</span>
            <span className="summary-label">Total Flights</span>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon"><Clock size={20} /></div>
          <div className="summary-content">
            <span className="summary-value">
              {summaryStats.peakHour?.hour !== undefined ? `${summaryStats.peakHour.hour}:00` : '--'}
            </span>
            <span className="summary-label">Peak Hour</span>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon"><Plane size={20} /></div>
          <div className="summary-content">
            <span className="summary-value">{summaryStats.uniqueTypes}</span>
            <span className="summary-label">Aircraft Types</span>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon"><BarChart2 size={20} /></div>
          <div className="summary-content">
            <span className="summary-value">{summaryStats.avgFlightsPerHour}</span>
            <span className="summary-label">Avg/Hour</span>
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="flight-patterns-grid expanded">
        {/* Top Routes */}
        <div className="patterns-card routes-card">
          <div className="card-header">
            <ArrowRight size={16} />
            <span>Top Routes</span>
            <span className="card-badge">{top_routes.length} routes</span>
          </div>
          {top_routes.length === 0 ? (
            <div className="empty-state">No route data available</div>
          ) : (
            <div className="routes-list">
              {top_routes.slice(0, 12).map((route, i) => (
                <div key={i} className="route-item">
                  <span className="route-rank">{i + 1}</span>
                  <div className="route-info">
                    <div className="route-path">
                      <span className="route-origin">{route.origin || '???'}</span>
                      <ArrowRight size={12} />
                      <span className="route-dest">{route.destination || '???'}</span>
                    </div>
                    <div className="route-bar-container">
                      <div
                        className="route-bar-fill"
                        style={{ width: `${(route.count / maxRouteCount) * 100}%` }}
                      />
                    </div>
                  </div>
                  <span className="route-count">{route.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Busiest Hours Heatmap */}
        <div className="patterns-card hours-card">
          <div className="card-header">
            <Clock size={16} />
            <span>Activity by Hour</span>
          </div>
          <div className="hours-heatmap">
            {hoursData.map((hour) => (
              <div
                key={hour.hour}
                className="hour-cell"
                style={{ backgroundColor: getHourColor(hour.count) }}
                title={`${hour.label}: ${hour.count} flights`}
              >
                <span className="hour-label">{hour.hour}</span>
              </div>
            ))}
          </div>
          <div className="hours-legend">
            <span className="legend-label">Low</span>
            <div className="legend-gradient" />
            <span className="legend-label">High</span>
          </div>

          {/* Hourly Bar Chart */}
          <div className="hours-bar-chart">
            <div className="bar-chart-title">Hourly Distribution</div>
            <div className="hours-bars">
              {hoursData.map((hour) => (
                <div
                  key={hour.hour}
                  className="hour-bar-wrapper"
                  title={`${hour.label}: ${hour.count} flights`}
                >
                  <div
                    className="hour-bar"
                    style={{ height: `${(hour.count / maxHourCount) * 100}%` }}
                  />
                  <span className="hour-bar-label">{hour.hour}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Aircraft Types */}
        <div className="patterns-card types-card">
          <div className="card-header">
            <Plane size={16} />
            <span>Aircraft Types</span>
            <span className="card-badge">{filteredTypes.length} types</span>
          </div>
          {filteredTypes.length === 0 ? (
            <div className="empty-state">No type data available</div>
          ) : (
            <div className="types-chart">
              {filteredTypes.slice(0, 12).map((type, i) => {
                const colors = [
                  '#00c8ff', '#00ff88', '#a371f7', '#ff9f43',
                  '#f85149', '#f7d794', '#4ecdc4', '#95e1d3'
                ];
                const color = colors[i % colors.length];
                return (
                  <div key={type.type || i} className="type-bar-item">
                    <div className="type-bar-header">
                      <span className="type-name">{type.type || 'Unknown'}</span>
                      <span className="type-count">{type.count}</span>
                    </div>
                    <div className="type-bar-track">
                      <div
                        className="type-bar-fill"
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

        {/* Duration by Type */}
        <div className="patterns-card duration-card">
          <div className="card-header">
            <Timer size={16} />
            <span>Avg Duration by Type</span>
          </div>
          {duration_by_type.length === 0 ? (
            <div className="empty-state">No duration data available</div>
          ) : (
            <div className="duration-list">
              {duration_by_type.slice(0, 10).map((item, i) => (
                <div key={item.type || i} className="duration-item">
                  <span className="duration-type">{item.type || 'Unknown'}</span>
                  <div className="duration-value-container">
                    <span className="duration-value">
                      {item.avg_minutes ? `${item.avg_minutes.toFixed(0)} min` : '--'}
                    </span>
                    {item.min_minutes && item.max_minutes && (
                      <span className="duration-range">
                        ({item.min_minutes.toFixed(0)}-{item.max_minutes.toFixed(0)})
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default FlightPatternsStats;
