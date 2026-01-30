import React from 'react';
import { Search, Plane, ChevronDown, ChevronUp, List, LayoutGrid, X } from 'lucide-react';
import { SortControls } from '../common/SortControls';
import { ACARS_SORT_FIELDS, ACARS_QUICK_FILTER_CATEGORIES } from './historyConstants';

/**
 * Filter controls for the ACARS messages view
 */
export function AcarsFilters({
  acarsSearch,
  setAcarsSearch,
  acarsAirlineFilter,
  setAcarsAirlineFilter,
  acarsSource,
  setAcarsSource,
  acarsSelectedLabels,
  setAcarsSelectedLabels,
  showLabelDropdown,
  setShowLabelDropdown,
  labelDropdownRef,
  availableLabels,
  acarsHideEmpty,
  setAcarsHideEmpty,
  acarsCompactMode,
  setAcarsCompactMode,
  allMessagesExpanded,
  toggleAllMessages,
  acarsSortField,
  acarsSortDirection,
  handleAcarsSort,
  filteredCount,
  totalCount
}) {
  return (
    <div className="acars-history-filters">
      <div className="search-box">
        <Search size={16} />
        <input
          type="text"
          placeholder="Search ICAO, callsign, airline, text..."
          value={acarsSearch}
          onChange={(e) => setAcarsSearch(e.target.value)}
        />
      </div>
      <div className="airline-filter">
        <Plane size={14} />
        <input
          type="text"
          placeholder="Airline..."
          value={acarsAirlineFilter}
          onChange={(e) => setAcarsAirlineFilter(e.target.value)}
        />
      </div>
      <select
        className="source-filter"
        value={acarsSource}
        onChange={(e) => setAcarsSource(e.target.value)}
      >
        <option value="all">All Sources</option>
        <option value="acars">ACARS</option>
        <option value="vdlm2">VDL Mode 2</option>
      </select>
      <div className="label-filter-container" ref={labelDropdownRef}>
        <button
          className={`label-filter-btn ${acarsSelectedLabels.length > 0 ? 'active' : ''}`}
          onClick={() => setShowLabelDropdown(!showLabelDropdown)}
        >
          Message Types
          {acarsSelectedLabels.length > 0 && (
            <span className="label-filter-count">{acarsSelectedLabels.length}</span>
          )}
          <ChevronDown size={14} className={showLabelDropdown ? 'rotated' : ''} />
        </button>
        {showLabelDropdown && (
          <div className="label-filter-dropdown">
            <div className="label-filter-header">
              <span>Filter by Message Type</span>
              {acarsSelectedLabels.length > 0 && (
                <button
                  className="label-clear-btn"
                  onClick={() => setAcarsSelectedLabels([])}
                >
                  Clear all
                </button>
              )}
            </div>
            <div className="label-filter-list">
              {availableLabels.map(({ label, count, description }) => (
                <label key={label} className="label-filter-item">
                  <input
                    type="checkbox"
                    checked={acarsSelectedLabels.includes(label)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setAcarsSelectedLabels([...acarsSelectedLabels, label]);
                      } else {
                        setAcarsSelectedLabels(acarsSelectedLabels.filter(l => l !== label));
                      }
                    }}
                  />
                  <span className="label-code">{label}</span>
                  <span className="label-desc">{description || label}</span>
                  <span className="label-count">{count}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
      <label className="hide-empty-toggle">
        <input
          type="checkbox"
          checked={acarsHideEmpty}
          onChange={(e) => setAcarsHideEmpty(e.target.checked)}
        />
        Hide empty
      </label>
      <div className="acars-view-toggle">
        <button
          className={`acars-view-btn ${!acarsCompactMode ? 'active' : ''}`}
          onClick={() => setAcarsCompactMode(false)}
          title="Expanded view"
        >
          <LayoutGrid size={14} />
        </button>
        <button
          className={`acars-view-btn ${acarsCompactMode ? 'active' : ''}`}
          onClick={() => setAcarsCompactMode(true)}
          title="Compact view"
        >
          <List size={14} />
        </button>
      </div>
      <button
        className="acars-expand-all-btn"
        onClick={toggleAllMessages}
        title={allMessagesExpanded ? 'Collapse all messages' : 'Expand all messages'}
      >
        {allMessagesExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {allMessagesExpanded ? 'Collapse' : 'Expand'}
      </button>
      <SortControls
        fields={ACARS_SORT_FIELDS}
        activeField={acarsSortField}
        direction={acarsSortDirection}
        onSort={handleAcarsSort}
        compact
      />
      <div className="acars-history-count">
        {filteredCount === totalCount
          ? `${totalCount} message${totalCount !== 1 ? 's' : ''}`
          : `${filteredCount} of ${totalCount}`}
      </div>
    </div>
  );
}

/**
 * Quick filter chips for ACARS categories
 */
export function AcarsQuickFilters({
  acarsQuickFilters,
  toggleQuickFilter,
  clearQuickFilters
}) {
  return (
    <div className="acars-quick-filter-chips">
      {Object.entries(ACARS_QUICK_FILTER_CATEGORIES).map(([key, { name }]) => (
        <button
          key={key}
          className={`acars-filter-chip chip-${key} ${acarsQuickFilters.includes(key) ? 'active' : ''}`}
          onClick={() => toggleQuickFilter(key)}
        >
          <span className="chip-dot" />
          {name}
        </button>
      ))}
      {acarsQuickFilters.length > 0 && (
        <button className="acars-chips-clear" onClick={clearQuickFilters}>
          <X size={12} /> Clear
        </button>
      )}
    </div>
  );
}
