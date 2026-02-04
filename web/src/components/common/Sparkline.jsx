import { useMemo, useRef, useEffect, useState } from 'react';
import PropTypes from 'prop-types';

/**
 * Sparkline - Inline micro-chart component
 * Supports line, bar, and area variants for tables and cards
 */
export function Sparkline({
  data = [],
  type = 'line',
  width = 80,
  height = 24,
  color,
  negativeColor,
  showMinMax = false,
  showLastValue = false,
  animate = false,
  strokeWidth = 1.5,
  barGap = 1,
  className = '',
  valueFormatter = (v) => v?.toFixed(0),
  gradientId,
}) {
  const svgRef = useRef(null);
  const [isVisible, setIsVisible] = useState(!animate);

  // Extract numeric values from data (handle arrays of numbers or objects)
  const values = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data.map((d) => (typeof d === 'number' ? d : (d?.value ?? d?.y ?? 0)));
  }, [data]);

  // Calculate min/max and normalized values
  const { min, max, normalizedValues, minIndex, maxIndex } = useMemo(() => {
    if (values.length === 0)
      return { min: 0, max: 0, normalizedValues: [], minIndex: 0, maxIndex: 0 };

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    let minIdx = 0;
    let maxIdx = 0;

    const normalized = values.map((v, i) => {
      if (v === min) minIdx = i;
      if (v === max) maxIdx = i;
      return (v - min) / range;
    });

    return { min, max, normalizedValues: normalized, minIndex: minIdx, maxIndex: maxIdx };
  }, [values]);

  // Animation on mount
  useEffect(() => {
    if (animate && svgRef.current) {
      const timer = setTimeout(() => setIsVisible(true), 50);
      return () => clearTimeout(timer);
    }
  }, [animate]);

  if (values.length === 0) {
    return (
      <div
        className={`sparkline sparkline--empty ${className}`}
        style={{
          width,
          height,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ color: 'var(--text-dim)', fontSize: '10px' }}>—</span>
      </div>
    );
  }

  const padding = showMinMax ? 4 : 2;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  const primaryColor = color || 'var(--sparkline-line)';
  const negColor = negativeColor || 'var(--sparkline-bar-negative)';
  const uniqueGradientId =
    gradientId || `sparkline-gradient-${Math.random().toString(36).slice(2, 9)}`;

  const renderLine = () => {
    const points = normalizedValues.map((v, i) => {
      const x = padding + (i / (values.length - 1)) * chartWidth;
      const y = padding + (1 - v) * chartHeight;
      return `${x},${y}`;
    });

    return (
      <>
        <defs>
          <linearGradient id={uniqueGradientId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={primaryColor} stopOpacity="0.3" />
            <stop offset="100%" stopColor={primaryColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        {type === 'area' && (
          <path
            d={`M${padding},${height - padding} L${points.join(' L')} L${width - padding},${height - padding} Z`}
            fill={`url(#${uniqueGradientId})`}
            opacity={isVisible ? 1 : 0}
            style={{ transition: animate ? 'opacity 0.3s ease' : 'none' }}
          />
        )}
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke={primaryColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={isVisible ? 1 : 0}
          style={{ transition: animate ? 'opacity 0.3s ease' : 'none' }}
        />
        {showMinMax && (
          <>
            <circle
              cx={padding + (minIndex / (values.length - 1)) * chartWidth}
              cy={padding + (1 - normalizedValues[minIndex]) * chartHeight}
              r={2}
              fill="var(--viz-altitude-low)"
            />
            <circle
              cx={padding + (maxIndex / (values.length - 1)) * chartWidth}
              cy={padding + (1 - normalizedValues[maxIndex]) * chartHeight}
              r={2}
              fill="var(--viz-altitude-high)"
            />
          </>
        )}
      </>
    );
  };

  const renderBars = () => {
    const barWidth = Math.max(2, (chartWidth - barGap * (values.length - 1)) / values.length);
    const zeroY = values.some((v) => v < 0)
      ? padding + (max / (max - min)) * chartHeight
      : height - padding;

    return normalizedValues.map((v, i) => {
      const x = padding + i * (barWidth + barGap);
      const barHeight = Math.abs(v * chartHeight);
      const isNegative = values[i] < 0;
      const y = isNegative ? zeroY : zeroY - barHeight;

      return (
        <rect
          key={i}
          x={x}
          y={y}
          width={barWidth}
          height={Math.max(1, barHeight)}
          fill={isNegative ? negColor : primaryColor}
          rx={1}
          opacity={isVisible ? 1 : 0}
          style={{
            transition: animate ? `opacity 0.3s ease ${i * 20}ms` : 'none',
          }}
        />
      );
    });
  };

  return (
    <div
      className={`sparkline sparkline--${type} ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        lineHeight: 1,
      }}
    >
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ overflow: 'visible' }}
      >
        {type === 'bar' ? renderBars() : renderLine()}
      </svg>
      {showLastValue && values.length > 0 && (
        <span
          style={{
            fontSize: '10px',
            color: 'var(--text-secondary)',
            fontFamily: "'JetBrains Mono', monospace",
            minWidth: '32px',
          }}
        >
          {valueFormatter(values[values.length - 1])}
        </span>
      )}
    </div>
  );
}

Sparkline.propTypes = {
  data: PropTypes.arrayOf(
    PropTypes.oneOfType([
      PropTypes.number,
      PropTypes.shape({
        value: PropTypes.number,
        y: PropTypes.number,
      }),
    ])
  ),
  type: PropTypes.oneOf(['line', 'bar', 'area']),
  width: PropTypes.number,
  height: PropTypes.number,
  color: PropTypes.string,
  negativeColor: PropTypes.string,
  showMinMax: PropTypes.bool,
  showLastValue: PropTypes.bool,
  animate: PropTypes.bool,
  strokeWidth: PropTypes.number,
  barGap: PropTypes.number,
  className: PropTypes.string,
  valueFormatter: PropTypes.func,
  gradientId: PropTypes.string,
};

export default Sparkline;
