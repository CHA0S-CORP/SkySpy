import React from 'react';
import { X, AlertTriangle, Shield, Plane, RefreshCw } from 'lucide-react';

/**
 * FilterMenuPanel - extracted traffic filter menu panel from MapView.jsx (lines 9325-9519).
 *
 * Props:
 *   trafficFilters     - current filter state object
 *   updateTrafficFilters - setter/updater for filter state (accepts object or updater fn)
 *   onClose            - callback to close the panel
 */
const SAFETY_CATEGORY_OPTIONS = [
  { key: 'proximity', label: 'Proximity' },
  { key: 'tcas', label: 'TCAS RA/TA' },
  { key: 'vertical_speed', label: 'Vertical Speed' },
  { key: 'emergency_squawk', label: 'Emergency Squawk' },
];

function FilterMenuPanelBase({ trafficFilters, updateTrafficFilters, onClose }) {
  const hiddenSafety = trafficFilters.hiddenSafetyCategories || [];
  const toggleSafetyCategory = (key) =>
    updateTrafficFilters((prev) => {
      const hidden = new Set(prev.hiddenSafetyCategories || []);
      if (hidden.has(key)) hidden.delete(key);
      else hidden.add(key);
      return { ...prev, hiddenSafetyCategories: [...hidden] };
    });

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className="overlay-menu filter-menu" onClick={(e) => e.stopPropagation()}>
      <div className="overlay-menu-header">
        <span>Traffic Filters</span>
        <button onClick={onClose}>
          <X size={14} />
        </button>
      </div>

      <div className="filter-menu-body">
        <div className="filter-section">
          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={trafficFilters.safetyEventsOnly}
              onChange={() =>
                updateTrafficFilters((prev) => ({
                  ...prev,
                  safetyEventsOnly: !prev.safetyEventsOnly,
                }))
              }
            />
            <span className="toggle-label">
              <AlertTriangle size={12} /> Safety Events Only
            </span>
          </label>
        </div>

        <div className="filter-section">
          <div className="filter-section-title">Safety Events on Map</div>
          {SAFETY_CATEGORY_OPTIONS.map((opt) => (
            <label className="overlay-toggle" key={opt.key}>
              <input
                type="checkbox"
                checked={!hiddenSafety.includes(opt.key)}
                onChange={() => toggleSafetyCategory(opt.key)}
              />
              <span className="toggle-label">{opt.label}</span>
            </label>
          ))}
        </div>

        <div className="overlay-divider" />

        <div className="filter-section">
          <div className="filter-section-title">Type</div>
          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={trafficFilters.showMilitary}
              onChange={() =>
                updateTrafficFilters((prev) => ({ ...prev, showMilitary: !prev.showMilitary }))
              }
            />
            <span className="toggle-label">
              <Shield size={12} /> Military
            </span>
          </label>
          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={trafficFilters.showCivil}
              onChange={() =>
                updateTrafficFilters((prev) => ({ ...prev, showCivil: !prev.showCivil }))
              }
            />
            <span className="toggle-label">
              <Plane size={12} /> Civil
            </span>
          </label>
        </div>

        <div className="filter-section">
          <div className="filter-section-title">Category</div>
          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={trafficFilters.showGA}
              onChange={() => updateTrafficFilters((prev) => ({ ...prev, showGA: !prev.showGA }))}
            />
            <span className="toggle-label">GA / Light</span>
          </label>
          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={trafficFilters.showAirliners}
              onChange={() =>
                updateTrafficFilters((prev) => ({ ...prev, showAirliners: !prev.showAirliners }))
              }
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
              onChange={() =>
                updateTrafficFilters((prev) => ({ ...prev, showAirborne: !prev.showAirborne }))
              }
            />
            <span className="toggle-label">Airborne</span>
          </label>
          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={trafficFilters.showGround}
              onChange={() =>
                updateTrafficFilters((prev) => ({ ...prev, showGround: !prev.showGround }))
              }
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
              onChange={() =>
                updateTrafficFilters((prev) => ({
                  ...prev,
                  showWithSquawk: !prev.showWithSquawk,
                }))
              }
            />
            <span className="toggle-label">With Squawk</span>
          </label>
          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={trafficFilters.showWithoutSquawk}
              onChange={() =>
                updateTrafficFilters((prev) => ({
                  ...prev,
                  showWithoutSquawk: !prev.showWithoutSquawk,
                }))
              }
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
              onChange={(e) =>
                updateTrafficFilters((prev) => ({
                  ...prev,
                  minAltitude: Math.max(0, parseInt(e.target.value) || 0),
                }))
              }
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
              onChange={(e) =>
                updateTrafficFilters((prev) => ({
                  ...prev,
                  maxAltitude: Math.min(60000, parseInt(e.target.value) || 60000),
                }))
              }
              min="0"
              max="60000"
              step="1000"
              placeholder="Max"
            />
          </div>
        </div>
      </div>

      <div className="filter-menu-footer">
        <button
          className="filter-reset-btn"
          onClick={() =>
            updateTrafficFilters({
              showMilitary: true,
              showCivil: true,
              showGround: false,
              showAirborne: true,
              minAltitude: 0,
              maxAltitude: 60000,
              showWithSquawk: true,
              showWithoutSquawk: true,
              safetyEventsOnly: false,
              hiddenSafetyCategories: [],
              showGA: true,
              showAirliners: true,
            })
          }
        >
          <RefreshCw size={14} />
          <span>Reset Filters</span>
        </button>
      </div>
    </div>
  );
}

// Memoized: its props are stabilized by the caller (useCallback handlers), so it
// no longer re-renders on every MapView tick while the panel is open.
export const FilterMenuPanel = React.memo(FilterMenuPanelBase);
export default FilterMenuPanel;
