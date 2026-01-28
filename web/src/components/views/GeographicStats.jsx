import React, { useState, useMemo } from 'react';
import {
  Globe, Building2, MapPin, Flag, Users,
  Plane, ExternalLink, Clock, Filter, ChevronDown,
  RefreshCw, BarChart2
} from 'lucide-react';
import { useStats } from '../../hooks';

/**
 * GeographicStats - Full page view for geographic analytics
 * - Countries breakdown (pie chart visualization)
 * - Top airlines/operators list
 * - Connected airports
 * - Regional distribution
 */
export function GeographicStats({ apiBase, wsRequest, wsConnected, onSelectAircraft }) {
  const [timeRange, setTimeRange] = useState('24h');
  const [showFilters, setShowFilters] = useState(false);
  const [countryFilter, setCountryFilter] = useState('');

  const hours = { '1h': 1, '6h': 6, '24h': 24, '48h': 48, '7d': 168, '30d': 720 };
  const selectedHours = hours[timeRange] || 24;

  const { geographicStats, loading, error, refetch } = useStats(apiBase, {
    wsRequest,
    wsConnected,
    hours: selectedHours
  });

  const data = geographicStats;

  const {
    countries = [],
    airlines = [],
    airports = [],
    regions = []
  } = data || {};

  // Filter countries if filter is set
  const filteredCountries = useMemo(() => {
    if (!countryFilter) return countries;
    return countries.filter(c =>
      c.country?.toLowerCase().includes(countryFilter.toLowerCase())
    );
  }, [countries, countryFilter]);

  // Calculate totals for percentage
  const totalCountryFlights = useMemo(() =>
    filteredCountries.reduce((sum, c) => sum + (c.count || 0), 0) || 1,
    [filteredCountries]
  );

  const maxAirlineCount = Math.max(...airlines.map(a => a.count || 0), 1);
  const maxAirportCount = Math.max(...airports.map(a => a.count || 0), 1);

  // Colors for countries pie
  const countryColors = [
    '#00c8ff', '#00ff88', '#a371f7', '#ff9f43',
    '#f85149', '#f7d794', '#4ecdc4', '#95e1d3',
    '#a8dadc', '#6b7280'
  ];

  // Build pie chart segments
  const pieSegments = useMemo(() => {
    const segments = [];
    let startAngle = 0;

    filteredCountries.slice(0, 10).forEach((country, i) => {
      const percentage = (country.count / totalCountryFlights);
      const angle = percentage * 360;
      segments.push({
        ...country,
        startAngle,
        endAngle: startAngle + angle,
        color: countryColors[i % countryColors.length],
        percentage: (percentage * 100).toFixed(1)
      });
      startAngle += angle;
    });

    return segments;
  }, [filteredCountries, totalCountryFlights]);

  // SVG arc path helper
  const describeArc = (cx, cy, radius, startAngle, endAngle) => {
    const start = polarToCartesian(cx, cy, radius, endAngle);
    const end = polarToCartesian(cx, cy, radius, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
    return [
      "M", cx, cy,
      "L", start.x, start.y,
      "A", radius, radius, 0, largeArcFlag, 0, end.x, end.y,
      "Z"
    ].join(" ");
  };

  const polarToCartesian = (cx, cy, radius, angle) => {
    const rad = (angle - 90) * Math.PI / 180;
    return {
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad)
    };
  };

  // Summary statistics
  const summaryStats = useMemo(() => ({
    totalCountries: countries.length,
    totalAirlines: airlines.length,
    totalAirports: airports.length,
    topCountry: countries[0]?.country || 'N/A'
  }), [countries, airlines, airports]);

  if (loading && !data) {
    return (
      <div className="stats-page geographic-page">
        <div className="loading-state">
          <RefreshCw className="spin" size={24} />
          <span>Loading geographic data...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="stats-page geographic-page">
        <div className="error-state">
          <span>Error loading data: {error}</span>
          <button onClick={refetch}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="stats-page geographic-page">
      {/* Page Header */}
      <div className="page-header">
        <div className="page-title">
          <Globe size={24} />
          <h1>Geographic Coverage</h1>
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
              <label>Country</label>
              <input
                type="text"
                placeholder="Filter by country..."
                value={countryFilter}
                onChange={(e) => setCountryFilter(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="summary-cards">
        <div className="summary-card">
          <div className="summary-icon"><Flag size={20} /></div>
          <div className="summary-content">
            <span className="summary-value">{summaryStats.totalCountries}</span>
            <span className="summary-label">Countries</span>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon"><Users size={20} /></div>
          <div className="summary-content">
            <span className="summary-value">{summaryStats.totalAirlines}</span>
            <span className="summary-label">Airlines</span>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon"><MapPin size={20} /></div>
          <div className="summary-content">
            <span className="summary-value">{summaryStats.totalAirports}</span>
            <span className="summary-label">Airports</span>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon"><Globe size={20} /></div>
          <div className="summary-content">
            <span className="summary-value">{summaryStats.topCountry}</span>
            <span className="summary-label">Top Country</span>
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="geographic-grid expanded">
        {/* Countries Pie Chart */}
        <div className="geo-card countries-card">
          <div className="card-header">
            <Flag size={16} />
            <span>Countries</span>
            <span className="card-badge">{filteredCountries.length} total</span>
          </div>
          {filteredCountries.length === 0 ? (
            <div className="empty-state">No country data available</div>
          ) : (
            <div className="countries-content">
              <div className="pie-chart-container large">
                <svg viewBox="0 0 100 100" className="pie-chart">
                  {pieSegments.map((segment, i) => (
                    <path
                      key={segment.country || i}
                      d={describeArc(50, 50, 45, segment.startAngle, segment.endAngle)}
                      fill={segment.color}
                      className="pie-segment"
                    >
                      <title>{segment.country}: {segment.count} ({segment.percentage}%)</title>
                    </path>
                  ))}
                  <circle cx="50" cy="50" r="25" fill="var(--bg-card)" />
                  <text x="50" y="48" textAnchor="middle" className="pie-center-value">
                    {filteredCountries.length}
                  </text>
                  <text x="50" y="58" textAnchor="middle" className="pie-center-label">
                    countries
                  </text>
                </svg>
              </div>
              <div className="countries-legend expanded">
                {pieSegments.map((segment, i) => (
                  <div key={segment.country || i} className="legend-item">
                    <span
                      className="legend-dot"
                      style={{ backgroundColor: segment.color }}
                    />
                    <span className="legend-label">{segment.country || 'Unknown'}</span>
                    <span className="legend-value">{segment.percentage}%</span>
                    <span className="legend-count">{segment.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Top Airlines */}
        <div className="geo-card airlines-card">
          <div className="card-header">
            <Users size={16} />
            <span>Top Airlines/Operators</span>
            <span className="card-badge">{airlines.length} total</span>
          </div>
          {airlines.length === 0 ? (
            <div className="empty-state">No airline data available</div>
          ) : (
            <div className="airlines-list">
              {airlines.slice(0, 15).map((airline, i) => (
                <div key={airline.code || i} className="airline-item">
                  <span className="airline-rank">{i + 1}</span>
                  <div className="airline-info">
                    <span className="airline-name">
                      {airline.name || airline.code || 'Unknown'}
                    </span>
                    {airline.code && airline.name && (
                      <span className="airline-code">{airline.code}</span>
                    )}
                  </div>
                  <div className="airline-bar-container">
                    <div
                      className="airline-bar-fill"
                      style={{ width: `${(airline.count / maxAirlineCount) * 100}%` }}
                    />
                  </div>
                  <span className="airline-count">{airline.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Connected Airports */}
        <div className="geo-card airports-card">
          <div className="card-header">
            <MapPin size={16} />
            <span>Connected Airports</span>
            <span className="card-badge">{airports.length} total</span>
          </div>
          {airports.length === 0 ? (
            <div className="empty-state">No airport data available</div>
          ) : (
            <div className="airports-grid expanded">
              {airports.slice(0, 20).map((airport, i) => (
                <div key={airport.icao || airport.iata || i} className="airport-chip">
                  <span className="airport-code">
                    {airport.icao || airport.iata || '????'}
                  </span>
                  {airport.name && (
                    <span className="airport-name" title={airport.name}>
                      {airport.name.length > 20 ? `${airport.name.slice(0, 20)}...` : airport.name}
                    </span>
                  )}
                  <span className="airport-count">{airport.count}</span>
                </div>
              ))}
            </div>
          )}
          {airports.length > 20 && (
            <div className="airports-overflow">
              +{airports.length - 20} more airports
            </div>
          )}
        </div>

        {/* Regions Overview */}
        {regions.length > 0 && (
          <div className="geo-card regions-card">
            <div className="card-header">
              <Globe size={16} />
              <span>Regions</span>
            </div>
            <div className="regions-list">
              {regions.slice(0, 10).map((region, i) => {
                const maxRegionCount = Math.max(...regions.map(r => r.count || 0), 1);
                return (
                  <div key={region.name || i} className="region-item">
                    <span className="region-name">{region.name || 'Unknown'}</span>
                    <div className="region-bar-track">
                      <div
                        className="region-bar-fill"
                        style={{ width: `${(region.count / maxRegionCount) * 100}%` }}
                      />
                    </div>
                    <span className="region-count">{region.count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Countries Bar Chart (alternative view) */}
        <div className="geo-card countries-bar-card">
          <div className="card-header">
            <BarChart2 size={16} />
            <span>Country Distribution</span>
          </div>
          <div className="countries-bar-chart">
            {filteredCountries.slice(0, 10).map((country, i) => {
              const maxCount = filteredCountries[0]?.count || 1;
              return (
                <div key={country.country || i} className="country-bar-item">
                  <span className="country-name">{country.country || 'Unknown'}</span>
                  <div className="country-bar-track">
                    <div
                      className="country-bar-fill"
                      style={{
                        width: `${(country.count / maxCount) * 100}%`,
                        backgroundColor: countryColors[i % countryColors.length]
                      }}
                    />
                  </div>
                  <span className="country-count">{country.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default GeographicStats;
