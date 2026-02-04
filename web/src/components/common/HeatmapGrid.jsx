import { useMemo } from 'react';
import PropTypes from 'prop-types';

/**
 * HeatmapGrid - Color-grid visualization for activity patterns
 */
export function HeatmapGrid({
  data = [],
  rowLabels = [],
  columnLabels = [],
  colorScale = 'cyan',
  cellSize = 14,
  cellGap = 2,
  showLegend = true,
  onCellClick,
  onCellHover,
  tooltipFormatter = (value, row, col) =>
    `${rowLabels[row] || row}: ${columnLabels[col] || col} = ${value}`,
  className = '',
}) {
  // Calculate min/max for color scaling
  const { min, max, normalizedData } = useMemo(() => {
    if (!data.length || !data[0]?.length) {
      return { min: 0, max: 0, normalizedData: [] };
    }

    let minVal = Infinity;
    let maxVal = -Infinity;

    data.forEach((row) => {
      row.forEach((val) => {
        if (val < minVal) minVal = val;
        if (val > maxVal) maxVal = val;
      });
    });

    const range = maxVal - minVal || 1;
    const normalized = data.map((row) => row.map((val) => (val - minVal) / range));

    return { min: minVal, max: maxVal, normalizedData: normalized };
  }, [data]);

  // Color scales
  const colorScales = {
    cyan: {
      0: 'rgba(0, 212, 255, 0.05)',
      0.25: 'rgba(0, 212, 255, 0.25)',
      0.5: 'rgba(0, 212, 255, 0.5)',
      0.75: 'rgba(0, 212, 255, 0.75)',
      1: 'rgba(0, 212, 255, 0.95)',
    },
    green: {
      0: 'rgba(74, 222, 128, 0.05)',
      0.25: 'rgba(74, 222, 128, 0.25)',
      0.5: 'rgba(74, 222, 128, 0.5)',
      0.75: 'rgba(74, 222, 128, 0.75)',
      1: 'rgba(74, 222, 128, 0.95)',
    },
    heat: {
      0: 'rgba(59, 130, 246, 0.8)',
      0.25: 'rgba(34, 197, 94, 0.8)',
      0.5: 'rgba(250, 204, 21, 0.8)',
      0.75: 'rgba(249, 115, 22, 0.8)',
      1: 'rgba(239, 68, 68, 0.8)',
    },
  };

  const getColor = (normalizedValue) => {
    const scale = colorScales[colorScale] || colorScales.cyan;
    const thresholds = Object.keys(scale)
      .map(Number)
      .sort((a, b) => a - b);

    for (let i = thresholds.length - 1; i >= 0; i--) {
      if (normalizedValue >= thresholds[i]) {
        return scale[thresholds[i]];
      }
    }
    return scale[0];
  };

  if (!data.length || !data[0]?.length) {
    return (
      <div
        className={`heatmap-grid heatmap-grid--empty ${className}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          color: 'var(--text-dim)',
          fontSize: '12px',
        }}
      >
        No data available
      </div>
    );
  }

  const labelWidth = rowLabels.length > 0 ? 30 : 0;

  return (
    <div className={`heatmap-grid ${className}`}>
      {/* Column labels */}
      {columnLabels.length > 0 && (
        <div
          style={{
            display: 'flex',
            marginLeft: labelWidth,
            marginBottom: '4px',
          }}
        >
          {columnLabels.map((label, i) => (
            <div
              key={i}
              style={{
                width: cellSize,
                marginRight: cellGap,
                fontSize: '9px',
                color: 'var(--text-dim)',
                textAlign: 'center',
                overflow: 'hidden',
              }}
            >
              {label}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex' }}>
        {/* Row labels */}
        {rowLabels.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              marginRight: '4px',
            }}
          >
            {rowLabels.map((label, i) => (
              <div
                key={i}
                style={{
                  height: cellSize,
                  marginBottom: cellGap,
                  fontSize: '9px',
                  color: 'var(--text-dim)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  paddingRight: '4px',
                  width: labelWidth,
                }}
              >
                {label}
              </div>
            ))}
          </div>
        )}

        {/* Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${data[0].length}, ${cellSize}px)`,
            gridTemplateRows: `repeat(${data.length}, ${cellSize}px)`,
            gap: `${cellGap}px`,
          }}
        >
          {normalizedData.map((row, rowIdx) =>
            row.map((normalizedVal, colIdx) => (
              <div
                key={`${rowIdx}-${colIdx}`}
                onClick={() => onCellClick?.(data[rowIdx][colIdx], rowIdx, colIdx)}
                onMouseEnter={() => onCellHover?.(data[rowIdx][colIdx], rowIdx, colIdx)}
                title={tooltipFormatter(data[rowIdx][colIdx], rowIdx, colIdx)}
                style={{
                  width: cellSize,
                  height: cellSize,
                  background: getColor(normalizedVal),
                  borderRadius: '2px',
                  cursor: onCellClick ? 'pointer' : 'default',
                  transition: 'transform 0.1s ease, opacity 0.1s ease',
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.transform = 'scale(1.1)';
                }}
                onFocus={(e) => {
                  e.currentTarget.style.transform = 'scale(1.1)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                }}
                tabIndex={onCellClick ? 0 : -1}
                role={onCellClick ? 'button' : undefined}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && onCellClick) {
                    onCellClick?.({ row: rowIdx, col: colIdx, value: data[rowIdx][colIdx] });
                  }
                }}
              />
            ))
          )}
        </div>
      </div>

      {/* Legend */}
      {showLegend && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginTop: '8px',
            marginLeft: labelWidth,
          }}
        >
          <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>{min.toLocaleString()}</span>
          <div
            style={{
              display: 'flex',
              gap: '2px',
            }}
          >
            {[0, 0.25, 0.5, 0.75, 1].map((level) => (
              <div
                key={level}
                style={{
                  width: '16px',
                  height: '10px',
                  background: getColor(level),
                  borderRadius: '2px',
                }}
              />
            ))}
          </div>
          <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>{max.toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}

HeatmapGrid.propTypes = {
  data: PropTypes.arrayOf(PropTypes.arrayOf(PropTypes.number)),
  rowLabels: PropTypes.arrayOf(PropTypes.string),
  columnLabels: PropTypes.arrayOf(PropTypes.string),
  colorScale: PropTypes.oneOf(['cyan', 'green', 'heat']),
  cellSize: PropTypes.number,
  cellGap: PropTypes.number,
  showLegend: PropTypes.bool,
  onCellClick: PropTypes.func,
  onCellHover: PropTypes.func,
  tooltipFormatter: PropTypes.func,
  className: PropTypes.string,
};

export default HeatmapGrid;
