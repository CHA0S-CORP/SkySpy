import React from 'react';
import { Search, Shield } from 'lucide-react';
import { SortControls } from '../common/SortControls';
import { SESSION_SORT_FIELDS } from './historyConstants';

/**
 * Filter controls for the sessions view
 */
export function SessionsFilters({
  sessionSearch,
  setSessionSearch,
  showMilitaryOnly,
  setShowMilitaryOnly,
  sessionSortField,
  sessionSortDirection,
  handleSessionSort,
  filteredCount,
  totalCount
}) {
  return (
    <div className="sessions-filters">
      <div className="search-box">
        <Search size={16} />
        <input
          type="text"
          placeholder="Search ICAO, callsign, type..."
          value={sessionSearch}
          onChange={(e) => setSessionSearch(e.target.value)}
        />
      </div>
      <button
        className={`filter-btn ${showMilitaryOnly ? 'active' : ''}`}
        onClick={() => setShowMilitaryOnly(!showMilitaryOnly)}
      >
        <Shield size={16} />
        Military
      </button>
      <SortControls
        fields={SESSION_SORT_FIELDS}
        activeField={sessionSortField}
        direction={sessionSortDirection}
        onSort={handleSessionSort}
      />
      <div className="sessions-count">
        {filteredCount} of {totalCount} sessions
      </div>
    </div>
  );
}
