import React from 'react';
import { Clock, Filter, ChevronDown } from 'lucide-react';

/**
 * TimeRangeSelector - Time range button group
 */
export function TimeRangeSelector({ timeRange, onTimeRangeChange }) {
  return (
    <div className="filter-group">
      <Clock size={14} />
      <span className="filter-label">Time Range</span>
      <div className="time-range-buttons">
        {['1h', '6h', '24h', '48h', '7d'].map(range => (
          <button
            key={range}
            className={`time-btn ${timeRange === range ? 'active' : ''}`}
            onClick={() => onTimeRangeChange(range)}
          >
            {range}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * MilitaryToggle - Toggle for military-only filter
 */
export function MilitaryToggle({ showMilitaryOnly, onToggle }) {
  return (
    <div
      className={`filter-toggle ${showMilitaryOnly ? 'active' : ''}`}
      onClick={onToggle}
    >
      <span className="toggle-indicator" />
      <span>Military Only</span>
    </div>
  );
}

/**
 * AdvancedFiltersButton - Button to show/hide advanced filters
 */
export function AdvancedFiltersButton({ showAdvancedFilters, onToggle }) {
  return (
    <button
      className={`advanced-filter-btn ${showAdvancedFilters ? 'active' : ''}`}
      onClick={onToggle}
    >
      <Filter size={14} />
      <span>Filters</span>
      <ChevronDown size={14} className={`chevron ${showAdvancedFilters ? 'open' : ''}`} />
    </button>
  );
}

/**
 * AdvancedFiltersPanel - Advanced filter controls panel
 */
export function AdvancedFiltersPanel({
  categoryFilter,
  setCategoryFilter,
  aircraftType,
  setAircraftType,
  minAltitude,
  setMinAltitude,
  maxAltitude,
  setMaxAltitude,
  minDistance,
  setMinDistance,
  maxDistance,
  setMaxDistance,
  onClearFilters
}) {
  return (
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
        <button className="clear-filters-btn" onClick={onClearFilters}>
          Clear Filters
        </button>
      </div>
    </div>
  );
}

/**
 * StatsFilterBar - Complete filter bar component
 */
export function StatsFilterBar({
  timeRange,
  setTimeRange,
  showMilitaryOnly,
  setShowMilitaryOnly,
  showAdvancedFilters,
  setShowAdvancedFilters,
  categoryFilter,
  setCategoryFilter,
  aircraftType,
  setAircraftType,
  minAltitude,
  setMinAltitude,
  maxAltitude,
  setMaxAltitude,
  minDistance,
  setMinDistance,
  maxDistance,
  setMaxDistance
}) {
  const handleClearFilters = () => {
    setCategoryFilter('');
    setAircraftType('');
    setMinAltitude('');
    setMaxAltitude('');
    setMinDistance('');
    setMaxDistance('');
  };

  return (
    <>
      <div className="stats-filters">
        <TimeRangeSelector
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
        />
        <div className="filter-divider" />
        <MilitaryToggle
          showMilitaryOnly={showMilitaryOnly}
          onToggle={() => setShowMilitaryOnly(!showMilitaryOnly)}
        />
        <div className="filter-divider" />
        <AdvancedFiltersButton
          showAdvancedFilters={showAdvancedFilters}
          onToggle={() => setShowAdvancedFilters(!showAdvancedFilters)}
        />
      </div>

      {showAdvancedFilters && (
        <AdvancedFiltersPanel
          categoryFilter={categoryFilter}
          setCategoryFilter={setCategoryFilter}
          aircraftType={aircraftType}
          setAircraftType={setAircraftType}
          minAltitude={minAltitude}
          setMinAltitude={setMinAltitude}
          maxAltitude={maxAltitude}
          setMaxAltitude={setMaxAltitude}
          minDistance={minDistance}
          setMinDistance={setMinDistance}
          maxDistance={maxDistance}
          setMaxDistance={setMaxDistance}
          onClearFilters={handleClearFilters}
        />
      )}
    </>
  );
}
