import React from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';

/**
 * Sortable Table Header Component
 *
 * Renders a table header row with clickable, sortable columns
 *
 * @param {Object} props
 * @param {Array} props.columns - Array of column configs: { key, label, sortable?, align?, width? }
 * @param {string} props.sortField - Currently active sort field
 * @param {string} props.sortDirection - 'asc' or 'desc'
 * @param {Function} props.onSort - Callback when sort changes: (fieldKey) => void
 * @param {string} [props.className] - Additional CSS class for the thead
 */
export function SortableTableHeader({
  columns,
  sortField,
  sortDirection,
  onSort,
  className = ''
}) {
  return (
    <thead className={`sortable-table-header ${className}`}>
      <tr>
        {columns.map((column) => {
          const isActive = sortField === column.key;
          const isSortable = column.sortable !== false;
          const DirectionIcon = sortDirection === 'asc' ? ArrowUp : ArrowDown;

          return (
            <th
              key={column.key}
              className={`
                ${isSortable ? 'sortable' : ''}
                ${isActive ? 'active' : ''}
                ${column.align ? `align-${column.align}` : ''}
              `.trim()}
              style={column.width ? { width: column.width } : undefined}
              onClick={() => isSortable && onSort(column.key)}
              title={isSortable ? `Sort by ${column.label}` : undefined}
            >
              <span className="th-content">
                <span className="th-label">{column.label}</span>
                {isSortable && (
                  <span className={`th-sort-icon ${isActive ? 'visible' : ''}`}>
                    {isActive ? (
                      <DirectionIcon size={12} />
                    ) : (
                      <ArrowDown size={12} className="th-sort-hint" />
                    )}
                  </span>
                )}
              </span>
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

export default SortableTableHeader;
