import React, { useMemo } from 'react';
import {
  Navigation2, Clock, Plane, Timer, TrendingUp,
  ArrowRight, BarChart2, Loader2
} from 'lucide-react';

/**
 * FlightPatternsSection - Displays flight pattern analytics
 * - Top routes table
 * - Busiest hours heatmap/bar chart
 * - Aircraft types breakdown
 * - Average flight duration by type
 */
export function FlightPatternsSection({ data, loading, onSelectAircraft }) {
  // Show loading skeleton when data is loading
  if (loading) {
    return (
      <div className="stats-section flight-patterns-section">
        <div className="section-header">
          <Navigation2 size={18} />
          <span>Flight Patterns</span>
        </div>
        <div className="section-loading">
          <Loader2 size={24} className="spin" />
          <span>Loading flight patterns...</span>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const {
    top_routes = [],
    busiest_hours = [],
    aircraft_types = [],
    duration_by_type = []
  } = data;

  // Find max values for normalization
  const maxRouteCount = Math.max(...top_routes.map(r => r.count || 0), 1);
  const maxHourCount = Math.max(...busiest_hours.map(h => h.count || 0), 1);
  const maxTypeCount = Math.max(...aircraft_types.map(t => t.count || 0), 1);

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

  return (
    <div className="stats-section flight-patterns-section">
      <div className="section-header">
        <Navigation2 size={18} />
        <span>Flight Patterns</span>
      </div>

      <div className="flight-patterns-grid">
        {/* Top Routes */}
        <div className="patterns-card routes-card">
          <div className="card-header">
            <ArrowRight size={16} />
            <span>Top Routes</span>
          </div>
          {top_routes.length === 0 ? (
            <div className="empty-state">No route data available</div>
          ) : (
            <div className="routes-list">
              {top_routes.slice(0, 8).map((route, i) => (
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
        </div>

        {/* Aircraft Types */}
        <div className="patterns-card types-card">
          <div className="card-header">
            <Plane size={16} />
            <span>Aircraft Types</span>
          </div>
          {aircraft_types.length === 0 ? (
            <div className="empty-state">No type data available</div>
          ) : (
            <div className="types-chart">
              {aircraft_types.slice(0, 8).map((type, i) => {
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
              {duration_by_type.slice(0, 6).map((item, i) => (
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

export default FlightPatternsSection;
