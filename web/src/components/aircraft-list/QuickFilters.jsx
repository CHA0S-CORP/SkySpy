import React from 'react';
import { QUICK_FILTERS } from './aircraftListConstants';

/**
 * Quick filter chips for common aircraft filters
 */
export function QuickFilters({ filters, stats, onToggleFilter }) {
  const isQuickFilterActive = (filterValues) => {
    return Object.entries(filterValues).every(([key, value]) => filters[key] === value);
  };

  return (
    <div className="quick-filters">
      {QUICK_FILTERS.map(qf => {
        const Icon = qf.icon;
        const isActive = isQuickFilterActive(qf.filter);
        const count = qf.id === 'emergency' ? stats.emergency :
                     qf.id === 'military' ? stats.military :
                     qf.id === 'climbing' ? stats.climbing :
                     qf.id === 'descending' ? stats.descending : 0;
        return (
          <button
            key={qf.id}
            className={`quick-filter-chip ${qf.color} ${isActive ? 'active' : ''}`}
            onClick={() => onToggleFilter(qf.id, qf.filter)}
          >
            <Icon size={14} />
            {qf.label}
            {count > 0 && <span className="chip-count">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export default QuickFilters;
