import React, { memo } from 'react';
import { LayoutGrid, List, GripHorizontal, Rows } from 'lucide-react';

/**
 * Toggle between table and card views with density options
 */
export const ViewToggle = memo(function ViewToggle({
  viewMode,
  density,
  onViewModeChange,
  onDensityChange,
}) {
  return (
    <div className="al-view-controls">
      {/* View Mode Toggle */}
      <div className="al-view-toggle">
        <button
          className={viewMode === 'table' ? 'active' : ''}
          onClick={() => onViewModeChange('table')}
          title="Table view"
          aria-label="Table view"
          aria-pressed={viewMode === 'table'}
        >
          <List size={16} />
        </button>
        <button
          className={viewMode === 'cards' ? 'active' : ''}
          onClick={() => onViewModeChange('cards')}
          title="Card view"
          aria-label="Card view"
          aria-pressed={viewMode === 'cards'}
        >
          <LayoutGrid size={16} />
        </button>
      </div>

      {/* Density Toggle (only for table view) */}
      {viewMode === 'table' && (
        <div className="al-density-toggle">
          <button
            className={density === 'compact' ? 'active' : ''}
            onClick={() => onDensityChange('compact')}
            title="Compact rows (32px)"
            aria-label="Compact density"
            aria-pressed={density === 'compact'}
          >
            <GripHorizontal size={16} />
          </button>
          <button
            className={density === 'comfortable' ? 'active' : ''}
            onClick={() => onDensityChange('comfortable')}
            title="Comfortable rows (44px)"
            aria-label="Comfortable density"
            aria-pressed={density === 'comfortable'}
          >
            <Rows size={16} />
          </button>
        </div>
      )}
    </div>
  );
});

export default ViewToggle;
