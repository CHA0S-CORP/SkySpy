import { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import PropTypes from 'prop-types';
import { Sparkline } from '../common/Sparkline';

/**
 * DenseDataTable - Virtual-scrolling table with inline sparklines and color-coded cells
 */
export function DenseDataTable({
  data = [],
  columns = [],
  rowHeight = 32,
  onRowClick,
  onSort,
  sortField,
  sortDirection = 'desc',
  selectedRow,
  virtualize = true,
  maxHeight = 500,
  emptyMessage = 'No data available',
  className = '',
}) {
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(maxHeight);

  // Measure container
  useEffect(() => {
    if (containerRef.current) {
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setContainerHeight(entry.contentRect.height || maxHeight);
        }
      });
      resizeObserver.observe(containerRef.current);
      return () => resizeObserver.disconnect();
    }
  }, [maxHeight]);

  // Handle scroll
  const handleScroll = useCallback((e) => {
    setScrollTop(e.target.scrollTop);
  }, []);

  // Calculate visible rows for virtualization
  const { visibleRows, startIndex, totalHeight, offsetY } = useMemo(() => {
    if (!virtualize || data.length === 0) {
      return {
        visibleRows: data,
        startIndex: 0,
        totalHeight: data.length * rowHeight,
        offsetY: 0,
      };
    }

    const overscan = 5; // Render extra rows above/below viewport
    const startIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const visibleCount = Math.ceil(containerHeight / rowHeight) + overscan * 2;
    const endIdx = Math.min(data.length, startIdx + visibleCount);

    return {
      visibleRows: data.slice(startIdx, endIdx),
      startIndex: startIdx,
      totalHeight: data.length * rowHeight,
      offsetY: startIdx * rowHeight,
    };
  }, [data, scrollTop, containerHeight, rowHeight, virtualize]);

  // Handle header click for sorting
  const handleHeaderClick = (column) => {
    if (column.sortable !== false && onSort) {
      const newDirection = sortField === column.field && sortDirection === 'desc' ? 'asc' : 'desc';
      onSort(column.field, newDirection);
    }
  };

  // Render cell content based on column type
  const renderCell = (row, column, rowIndex) => {
    const value = row[column.field];

    // Custom renderer
    if (column.render) {
      return column.render(value, row, rowIndex);
    }

    // Sparkline column
    if (column.type === 'sparkline' && Array.isArray(value)) {
      return (
        <Sparkline
          data={value}
          type={column.sparklineType || 'line'}
          width={column.sparklineWidth || 60}
          height={column.sparklineHeight || 18}
          color={column.sparklineColor}
        />
      );
    }

    // Number with formatting
    if (column.type === 'number') {
      const formatted = column.format ? column.format(value) : (value ?? '').toLocaleString();
      return (
        <span className="dense-data-table__cell--numeric">
          {formatted}
          {column.unit && <span style={{ color: 'var(--text-dim)', marginLeft: '2px' }}>{column.unit}</span>}
        </span>
      );
    }

    // Color-coded value
    if (column.colorScale && value !== undefined) {
      const colorClass = getColorClass(value, column.colorScale);
      return <span className={colorClass}>{column.format ? column.format(value) : value}</span>;
    }

    // Date/time formatting
    if (column.type === 'datetime' && value) {
      const date = new Date(value);
      return date.toLocaleString();
    }

    if (column.type === 'time' && value) {
      const date = new Date(value);
      return date.toLocaleTimeString();
    }

    // Boolean
    if (column.type === 'boolean') {
      return value ? '✓' : '';
    }

    // Default string
    return value ?? '';
  };

  // Get color class based on value and scale
  const getColorClass = (value, scale) => {
    if (scale === 'altitude') {
      if (value < 10000) return 'dense-data-table__cell--altitude-low';
      if (value < 30000) return 'dense-data-table__cell--altitude-mid';
      return 'dense-data-table__cell--altitude-high';
    }
    if (scale === 'signal') {
      if (value > -5) return 'dense-data-table__cell--signal-excellent';
      if (value > -10) return 'dense-data-table__cell--signal-good';
      if (value > -15) return 'dense-data-table__cell--signal-fair';
      return 'dense-data-table__cell--signal-weak';
    }
    return '';
  };

  if (data.length === 0) {
    return (
      <div
        className={`dense-data-table dense-data-table--empty ${className}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '200px',
          color: 'var(--text-dim)',
          fontSize: '13px',
        }}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={`dense-data-table ${className}`}>
      {/* Header */}
      <div className="dense-data-table__header">
        <div className="dense-data-table__header-row">
          {columns.map((column) => (
            <div
              key={column.field}
              className={`dense-data-table__header-cell ${
                sortField === column.field ? 'dense-data-table__header-cell--sorted' : ''
              } ${column.align === 'right' ? 'dense-data-table__header-cell--numeric' : ''}`}
              style={{
                width: column.width,
                minWidth: column.minWidth,
                flex: column.flex || (column.width ? `0 0 ${column.width}` : 1),
              }}
              onClick={() => handleHeaderClick(column)}
            >
              {column.label}
              {sortField === column.field && (
                <span className="dense-data-table__sort-icon">
                  {sortDirection === 'asc' ? '↑' : '↓'}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Body with virtual scrolling */}
      <div
        ref={containerRef}
        className="virtual-scroll-container"
        style={{ height: maxHeight, overflowY: 'auto' }}
        onScroll={handleScroll}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
          <div style={{ transform: `translateY(${offsetY}px)` }}>
            {visibleRows.map((row, idx) => {
              const actualIndex = startIndex + idx;
              const isSelected = selectedRow && (
                selectedRow === row.id ||
                selectedRow === row.icao_hex ||
                selectedRow === actualIndex
              );

              return (
                <div
                  key={row.id || row.icao_hex || actualIndex}
                  className={`dense-data-table__row ${
                    isSelected ? 'dense-data-table__row--selected' : ''
                  } ${row.is_military ? 'dense-data-table__row--military' : ''} ${
                    row.safety_event_count > 0 ? 'dense-data-table__row--safety' : ''
                  }`}
                  style={{ height: rowHeight }}
                  onClick={() => onRowClick?.(row, actualIndex)}
                >
                  {columns.map((column) => (
                    <div
                      key={column.field}
                      className={`dense-data-table__cell ${
                        column.mono ? 'dense-data-table__cell--mono' : ''
                      } ${column.highlight ? 'dense-data-table__cell--highlight' : ''}`}
                      style={{
                        width: column.width,
                        minWidth: column.minWidth,
                        flex: column.flex || (column.width ? `0 0 ${column.width}` : 1),
                        textAlign: column.align || 'left',
                      }}
                      title={typeof row[column.field] === 'string' ? row[column.field] : undefined}
                    >
                      {renderCell(row, column, actualIndex)}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer with count */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 12px',
          borderTop: '1px solid var(--border)',
          fontSize: '11px',
          color: 'var(--text-dim)',
        }}
      >
        <span>{data.length.toLocaleString()} rows</span>
        {virtualize && (
          <span>
            Showing {startIndex + 1}-{Math.min(startIndex + visibleRows.length, data.length)}
          </span>
        )}
      </div>
    </div>
  );
}

DenseDataTable.propTypes = {
  data: PropTypes.array,
  columns: PropTypes.arrayOf(
    PropTypes.shape({
      field: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      width: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      minWidth: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      flex: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      align: PropTypes.oneOf(['left', 'center', 'right']),
      type: PropTypes.oneOf(['string', 'number', 'datetime', 'time', 'boolean', 'sparkline']),
      format: PropTypes.func,
      render: PropTypes.func,
      sortable: PropTypes.bool,
      mono: PropTypes.bool,
      highlight: PropTypes.bool,
      colorScale: PropTypes.oneOf(['altitude', 'signal']),
      unit: PropTypes.string,
      sparklineType: PropTypes.string,
      sparklineWidth: PropTypes.number,
      sparklineHeight: PropTypes.number,
      sparklineColor: PropTypes.string,
    })
  ),
  rowHeight: PropTypes.number,
  onRowClick: PropTypes.func,
  onSort: PropTypes.func,
  sortField: PropTypes.string,
  sortDirection: PropTypes.oneOf(['asc', 'desc']),
  selectedRow: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  virtualize: PropTypes.bool,
  maxHeight: PropTypes.number,
  emptyMessage: PropTypes.string,
  className: PropTypes.string,
};

export default DenseDataTable;
