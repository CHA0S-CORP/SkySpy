import { useMemo } from 'react';
import PropTypes from 'prop-types';

/**
 * DistributionChart - Horizontal bar chart for distributions
 * Useful for distance, speed, altitude band analysis
 */
export function DistributionChart({
  data = [],
  orientation = 'horizontal',
  showLabels = true,
  showValues = true,
  showPercentages = false,
  color = 'var(--accent-cyan)',
  barHeight = 16,
  barGap = 6,
  labelWidth = 60,
  valueWidth = 50,
  animate = false,
  maxBars = 10,
  sortBy = 'value', // 'value', 'label', 'none'
  sortDirection = 'desc',
  formatValue = (v) => v.toLocaleString(),
  formatLabel = (l) => l,
  onClick,
  className = '',
}) {
  // Process and sort data
  const processedData = useMemo(() => {
    let items = data.map((item, index) => ({
      label: item.label || `Item ${index + 1}`,
      value: item.value || 0,
      color: item.color || color,
      id: item.id || index,
    }));

    // Sort
    if (sortBy === 'value') {
      items.sort((a, b) =>
        sortDirection === 'desc' ? b.value - a.value : a.value - b.value
      );
    } else if (sortBy === 'label') {
      items.sort((a, b) =>
        sortDirection === 'desc'
          ? b.label.localeCompare(a.label)
          : a.label.localeCompare(b.label)
      );
    }

    // Limit bars
    if (maxBars > 0 && items.length > maxBars) {
      const shown = items.slice(0, maxBars - 1);
      const others = items.slice(maxBars - 1);
      const othersValue = others.reduce((sum, item) => sum + item.value, 0);
      items = [
        ...shown,
        { label: `${others.length} others`, value: othersValue, color: 'var(--text-dim)', id: 'others' },
      ];
    }

    return items;
  }, [data, sortBy, sortDirection, maxBars, color]);

  // Calculate max value and totals
  const { maxValue, totalValue } = useMemo(() => {
    const max = Math.max(...processedData.map((d) => d.value), 1);
    const total = processedData.reduce((sum, d) => sum + d.value, 0);
    return { maxValue: max, totalValue: total };
  }, [processedData]);

  if (processedData.length === 0) {
    return (
      <div
        className={`distribution-chart distribution-chart--empty ${className}`}
        style={{
          padding: '16px',
          textAlign: 'center',
          color: 'var(--text-dim)',
          fontSize: '12px',
        }}
      >
        No data available
      </div>
    );
  }

  if (orientation === 'vertical') {
    return (
      <div
        className={`distribution-chart distribution-chart--vertical ${className}`}
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: `${barGap}px`,
          height: '100%',
        }}
      >
        {processedData.map((item, index) => {
          const heightPercent = (item.value / maxValue) * 100;
          return (
            <div
              key={item.id}
              role={onClick ? 'button' : undefined}
              tabIndex={onClick ? 0 : undefined}
              onClick={() => onClick?.(item)}
              onKeyDown={onClick ? (e) => { if (e.key === 'Enter') onClick?.(item); } : undefined}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                flex: 1,
                cursor: onClick ? 'pointer' : 'default',
              }}
            >
              {showValues && (
                <span
                  style={{
                    fontSize: '10px',
                    color: 'var(--text-secondary)',
                    fontFamily: "'JetBrains Mono', monospace",
                    marginBottom: '4px',
                  }}
                >
                  {showPercentages
                    ? `${((item.value / totalValue) * 100).toFixed(0)}%`
                    : formatValue(item.value)}
                </span>
              )}
              <div
                style={{
                  width: '100%',
                  height: `${heightPercent}%`,
                  minHeight: item.value > 0 ? '4px' : 0,
                  background: item.color,
                  borderRadius: '3px 3px 0 0',
                  transition: animate ? 'height 0.3s ease' : 'none',
                }}
              />
              {showLabels && (
                <span
                  style={{
                    fontSize: '9px',
                    color: 'var(--text-dim)',
                    marginTop: '4px',
                    textAlign: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '100%',
                  }}
                >
                  {formatLabel(item.label)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Horizontal orientation (default)
  return (
    <div className={`distribution-chart distribution-chart--horizontal ${className}`}>
      {processedData.map((item, index) => {
        const widthPercent = (item.value / maxValue) * 100;
        return (
          <div
            key={item.id}
            role={onClick ? 'button' : undefined}
            tabIndex={onClick ? 0 : undefined}
            onClick={() => onClick?.(item)}
            onKeyDown={onClick ? (e) => { if (e.key === 'Enter') onClick?.(item); } : undefined}
            className="distribution-chart__bar-container"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: index < processedData.length - 1 ? `${barGap}px` : 0,
              cursor: onClick ? 'pointer' : 'default',
            }}
          >
            {showLabels && (
              <span
                className="distribution-chart__label"
                style={{
                  width: labelWidth,
                  fontSize: '10px',
                  color: 'var(--text-dim)',
                  textAlign: 'right',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
                title={item.label}
              >
                {formatLabel(item.label)}
              </span>
            )}
            <div
              className="distribution-chart__bar-wrapper"
              style={{
                flex: 1,
                height: barHeight,
                background: 'var(--bg-hover)',
                borderRadius: '3px',
                overflow: 'hidden',
              }}
            >
              <div
                className="distribution-chart__bar"
                style={{
                  width: `${widthPercent}%`,
                  height: '100%',
                  background: item.color,
                  borderRadius: '3px',
                  transition: animate ? 'width 0.3s ease' : 'none',
                }}
              />
            </div>
            {showValues && (
              <span
                className="distribution-chart__value"
                style={{
                  width: valueWidth,
                  fontSize: '10px',
                  color: 'var(--text-secondary)',
                  fontFamily: "'JetBrains Mono', monospace",
                  flexShrink: 0,
                }}
              >
                {showPercentages
                  ? `${((item.value / totalValue) * 100).toFixed(0)}%`
                  : formatValue(item.value)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

DistributionChart.propTypes = {
  data: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string,
      value: PropTypes.number.isRequired,
      color: PropTypes.string,
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    })
  ),
  orientation: PropTypes.oneOf(['horizontal', 'vertical']),
  showLabels: PropTypes.bool,
  showValues: PropTypes.bool,
  showPercentages: PropTypes.bool,
  color: PropTypes.string,
  barHeight: PropTypes.number,
  barGap: PropTypes.number,
  labelWidth: PropTypes.number,
  valueWidth: PropTypes.number,
  animate: PropTypes.bool,
  maxBars: PropTypes.number,
  sortBy: PropTypes.oneOf(['value', 'label', 'none']),
  sortDirection: PropTypes.oneOf(['asc', 'desc']),
  formatValue: PropTypes.func,
  formatLabel: PropTypes.func,
  onClick: PropTypes.func,
  className: PropTypes.string,
};

export default DistributionChart;
