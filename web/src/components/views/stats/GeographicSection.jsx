import React, { useMemo } from 'react';
import {
  Globe, Building2, MapPin, Flag, Users,
  Plane, ExternalLink, Loader2
} from 'lucide-react';

/**
 * GeographicSection - Displays geographic analytics
 * - Countries breakdown (pie chart visualization)
 * - Top airlines/operators list
 * - Connected airports
 */
export function GeographicSection({ data, loading, onSelectAircraft }) {
  // Show loading skeleton when data is loading
  if (loading) {
    return (
      <div className="stats-section geographic-section">
        <div className="section-header">
          <Globe size={18} />
          <span>Geographic Coverage</span>
        </div>
        <div className="section-loading">
          <Loader2 size={24} className="spin" />
          <span>Loading geographic data...</span>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const {
    countries = [],
    airlines = [],
    airports = [],
    regions = []
  } = data;

  // Calculate totals for percentage
  const totalCountryFlights = useMemo(() =>
    countries.reduce((sum, c) => sum + (c.count || 0), 0) || 1,
    [countries]
  );

  const maxAirlineCount = Math.max(...airlines.map(a => a.count || 0), 1);
  const maxAirportCount = Math.max(...airports.map(a => a.count || 0), 1);
  const maxRegionCount = Math.max(...regions.map(r => r.count || 0), 1);

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

    countries.slice(0, 10).forEach((country, i) => {
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
  }, [countries, totalCountryFlights]);

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

  return (
    <div className="stats-section geographic-section">
      <div className="section-header">
        <Globe size={18} />
        <span>Geographic Coverage</span>
      </div>

      <div className="geographic-grid">
        {/* Countries Pie Chart */}
        <div className="geo-card countries-card">
          <div className="card-header">
            <Flag size={16} />
            <span>Countries</span>
            <span className="card-badge">{countries.length} total</span>
          </div>
          {countries.length === 0 ? (
            <div className="empty-state">No country data available</div>
          ) : (
            <div className="countries-content">
              <div className="pie-chart-container">
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
                    {countries.length}
                  </text>
                  <text x="50" y="58" textAnchor="middle" className="pie-center-label">
                    countries
                  </text>
                </svg>
              </div>
              <div className="countries-legend">
                {pieSegments.slice(0, 6).map((segment, i) => (
                  <div key={segment.country || i} className="legend-item">
                    <span
                      className="legend-dot"
                      style={{ backgroundColor: segment.color }}
                    />
                    <span className="legend-label">{segment.country || 'Unknown'}</span>
                    <span className="legend-value">{segment.percentage}%</span>
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
          </div>
          {airlines.length === 0 ? (
            <div className="empty-state">No airline data available</div>
          ) : (
            <div className="airlines-list">
              {airlines.slice(0, 10).map((airline, i) => (
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
            <div className="airports-grid">
              {airports.slice(0, 12).map((airport, i) => (
                <div key={airport.icao || airport.iata || i} className="airport-chip">
                  <span className="airport-code">
                    {airport.icao || airport.iata || '????'}
                  </span>
                  {airport.name && (
                    <span className="airport-name" title={airport.name}>
                      {airport.name.length > 15 ? `${airport.name.slice(0, 15)}...` : airport.name}
                    </span>
                  )}
                  <span className="airport-count">{airport.count}</span>
                </div>
              ))}
            </div>
          )}
          {airports.length > 12 && (
            <div className="airports-overflow">
              +{airports.length - 12} more airports
            </div>
          )}
        </div>

        {/* Regions Overview (if available) */}
        {regions.length > 0 && (
          <div className="geo-card regions-card">
            <div className="card-header">
              <Globe size={16} />
              <span>Regions</span>
            </div>
            <div className="regions-list">
              {regions.slice(0, 6).map((region, i) => (
                <div key={region.name || i} className="region-item">
                  <span className="region-name">{region.name || 'Unknown'}</span>
                  <div className="region-bar-track">
                    <div
                      className="region-bar-fill"
                      style={{ width: `${((region.count || 0) / maxRegionCount) * 100}%` }}
                    />
                  </div>
                  <span className="region-count">{region.count || 0}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default GeographicSection;
