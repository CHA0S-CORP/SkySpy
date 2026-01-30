import React from 'react';

/**
 * Advanced filters panel for aircraft list
 */
export function AdvancedFilters({ filters, setFilters }) {
  return (
    <div className="advanced-filters">
      <div className="filter-group">
        <label>Altitude (ft)</label>
        <div className="range-inputs">
          <input
            type="number"
            placeholder="Min"
            value={filters.minAltitude}
            onChange={e => setFilters(prev => ({ ...prev, minAltitude: e.target.value }))}
          />
          <span>to</span>
          <input
            type="number"
            placeholder="Max"
            value={filters.maxAltitude}
            onChange={e => setFilters(prev => ({ ...prev, maxAltitude: e.target.value }))}
          />
        </div>
      </div>
      <div className="filter-group">
        <label>Distance (nm)</label>
        <div className="range-inputs">
          <input
            type="number"
            placeholder="Min"
            value={filters.minDistance}
            onChange={e => setFilters(prev => ({ ...prev, minDistance: e.target.value }))}
          />
          <span>to</span>
          <input
            type="number"
            placeholder="Max"
            value={filters.maxDistance}
            onChange={e => setFilters(prev => ({ ...prev, maxDistance: e.target.value }))}
          />
        </div>
      </div>
      <div className="filter-group">
        <label>Speed (kts)</label>
        <div className="range-inputs">
          <input
            type="number"
            placeholder="Min"
            value={filters.minSpeed}
            onChange={e => setFilters(prev => ({ ...prev, minSpeed: e.target.value }))}
          />
          <span>to</span>
          <input
            type="number"
            placeholder="Max"
            value={filters.maxSpeed}
            onChange={e => setFilters(prev => ({ ...prev, maxSpeed: e.target.value }))}
          />
        </div>
      </div>
    </div>
  );
}

export default AdvancedFilters;
