import React, { memo, useMemo } from 'react';
import { X } from 'lucide-react';
import { QUICK_FILTER_PRESETS } from '../../../hooks/useQuickFilters';

/**
 * QuickFilterBar - Horizontal bar with one-click filter buttons for Pro Mode
 *
 * Displays filter chips that can be toggled to filter aircraft display.
 * Multiple filters can be active simultaneously (additive/OR logic).
 */
export const QuickFilterBar = memo(function QuickFilterBar({
  activeFilters = [],
  filterCounts = {},
  onToggleFilter,
  onClear,
  onClose,
  className = '',
}) {
  // Determine if 'all' is the only active filter
  const isShowingAll = useMemo(
    () => activeFilters.length === 0 || (activeFilters.length === 1 && activeFilters[0] === 'all'),
    [activeFilters]
  );

  // Get the color class for a filter
  const getColorClass = (preset, isActive) => {
    if (!isActive) return '';
    switch (preset.color) {
      case 'purple':
        return 'filter-chip--purple';
      case 'red':
        return 'filter-chip--red';
      case 'orange':
        return 'filter-chip--orange';
      case 'teal':
        return 'filter-chip--teal';
      case 'yellow':
        return 'filter-chip--yellow';
      case 'cyan':
        return 'filter-chip--cyan';
      case 'blue':
        return 'filter-chip--blue';
      case 'green':
        return 'filter-chip--green';
      default:
        return 'filter-chip--default';
    }
  };

  return (
    <div className={`quick-filter-bar ${className}`}>
      <div className="quick-filter-bar__chips">
        {QUICK_FILTER_PRESETS.map((preset) => {
          const Icon = preset.icon;
          const isActive =
            preset.id === 'all' ? isShowingAll : activeFilters.includes(preset.id);
          const count = filterCounts[preset.id] ?? 0;

          return (
            <button
              key={preset.id}
              type="button"
              className={`filter-chip ${isActive ? 'filter-chip--active' : ''} ${getColorClass(preset, isActive)}`}
              onClick={() => onToggleFilter(preset.id)}
              title={preset.description}
              aria-pressed={isActive}
            >
              <Icon size={14} className="filter-chip__icon" />
              <span className="filter-chip__label">{preset.label}</span>
              {preset.id !== 'all' && count > 0 && (
                <span className="filter-chip__count">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="quick-filter-bar__actions">
        {!isShowingAll && (
          <button
            type="button"
            className="filter-clear-btn"
            onClick={onClear}
            title="Clear all filters"
          >
            Clear
          </button>
        )}
        <button
          type="button"
          className="filter-close-btn"
          onClick={onClose}
          title="Hide filter bar (F)"
          aria-label="Hide filter bar"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
});

export default QuickFilterBar;
