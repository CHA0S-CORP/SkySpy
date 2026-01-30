import React from 'react';
import { X, AlertTriangle, Shield, Plane, RefreshCw } from 'lucide-react';

/**
 * FilterMenu component - traffic filter configuration menu
 */
export function FilterMenu({
  showFilterMenu,
  setShowFilterMenu,
  trafficFilters,
  updateTrafficFilters,
}) {
  if (!showFilterMenu) return null;

  const defaultFilters = {
    showMilitary: true,
    showCivil: true,
    showGround: false,
    showAirborne: true,
    minAltitude: 0,
    maxAltitude: 60000,
    showWithSquawk: true,
    showWithoutSquawk: true,
    safetyEventsOnly: false,
    showGA: true,
    showAirliners: true,
  };

  return (
    <div className="overlay-menu filter-menu" onClick={(e) => e.stopPropagation()}>
      <div className="overlay-menu-header">
        <span>Traffic Filters</span>
        <button onClick={() => setShowFilterMenu(false)}><X size={14} /></button>
      </div>

      <div className="filter-section">
        <label className="overlay-toggle">
          <input
            type="checkbox"
            checked={trafficFilters.safetyEventsOnly}
            onChange={() => updateTrafficFilters(prev => ({ ...prev, safetyEventsOnly: !prev.safetyEventsOnly }))}
          />
          <span className="toggle-label"><AlertTriangle size={12} /> Safety Events Only</span>
        </label>
      </div>

      <div className="overlay-divider" />

      <div className="filter-section">
        <div className="filter-section-title">Type</div>
        <label className="overlay-toggle">
          <input
            type="checkbox"
            checked={trafficFilters.showMilitary}
            onChange={() => updateTrafficFilters(prev => ({ ...prev, showMilitary: !prev.showMilitary }))}
          />
          <span className="toggle-label"><Shield size={12} /> Military</span>
        </label>
        <label className="overlay-toggle">
          <input
            type="checkbox"
            checked={trafficFilters.showCivil}
            onChange={() => updateTrafficFilters(prev => ({ ...prev, showCivil: !prev.showCivil }))}
          />
          <span className="toggle-label"><Plane size={12} /> Civil</span>
        </label>
      </div>

      <div className="filter-section">
        <div className="filter-section-title">Category</div>
        <label className="overlay-toggle">
          <input
            type="checkbox"
            checked={trafficFilters.showGA}
            onChange={() => updateTrafficFilters(prev => ({ ...prev, showGA: !prev.showGA }))}
          />
          <span className="toggle-label">GA / Light</span>
        </label>
        <label className="overlay-toggle">
          <input
            type="checkbox"
            checked={trafficFilters.showAirliners}
            onChange={() => updateTrafficFilters(prev => ({ ...prev, showAirliners: !prev.showAirliners }))}
          />
          <span className="toggle-label">Airliners / Heavy</span>
        </label>
      </div>

      <div className="filter-section">
        <div className="filter-section-title">Status</div>
        <label className="overlay-toggle">
          <input
            type="checkbox"
            checked={trafficFilters.showAirborne}
            onChange={() => updateTrafficFilters(prev => ({ ...prev, showAirborne: !prev.showAirborne }))}
          />
          <span className="toggle-label">Airborne</span>
        </label>
        <label className="overlay-toggle">
          <input
            type="checkbox"
            checked={trafficFilters.showGround}
            onChange={() => updateTrafficFilters(prev => ({ ...prev, showGround: !prev.showGround }))}
          />
          <span className="toggle-label">On Ground</span>
        </label>
      </div>

      <div className="filter-section">
        <div className="filter-section-title">Transponder</div>
        <label className="overlay-toggle">
          <input
            type="checkbox"
            checked={trafficFilters.showWithSquawk}
            onChange={() => updateTrafficFilters(prev => ({ ...prev, showWithSquawk: !prev.showWithSquawk }))}
          />
          <span className="toggle-label">With Squawk</span>
        </label>
        <label className="overlay-toggle">
          <input
            type="checkbox"
            checked={trafficFilters.showWithoutSquawk}
            onChange={() => updateTrafficFilters(prev => ({ ...prev, showWithoutSquawk: !prev.showWithoutSquawk }))}
          />
          <span className="toggle-label">No Squawk (ADS-B)</span>
        </label>
      </div>

      <div className="filter-section">
        <div className="filter-section-title">Altitude (ft)</div>
        <div className="filter-range-row">
          <input
            type="number"
            className="filter-range-input"
            value={trafficFilters.minAltitude}
            onChange={(e) => updateTrafficFilters(prev => ({
              ...prev,
              minAltitude: Math.max(0, parseInt(e.target.value) || 0)
            }))}
            min="0"
            max="60000"
            step="1000"
            placeholder="Min"
          />
          <span className="filter-range-sep">to</span>
          <input
            type="number"
            className="filter-range-input"
            value={trafficFilters.maxAltitude}
            onChange={(e) => updateTrafficFilters(prev => ({
              ...prev,
              maxAltitude: Math.min(60000, parseInt(e.target.value) || 60000)
            }))}
            min="0"
            max="60000"
            step="1000"
            placeholder="Max"
          />
        </div>
      </div>

      <div className="overlay-divider" />
      <button
        className="filter-reset-btn"
        onClick={() => updateTrafficFilters(defaultFilters)}
      >
        <RefreshCw size={14} />
        <span>Reset Filters</span>
      </button>
    </div>
  );
}
