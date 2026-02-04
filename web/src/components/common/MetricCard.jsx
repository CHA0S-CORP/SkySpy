import { useMemo } from 'react';
import PropTypes from 'prop-types';
import { Sparkline } from './Sparkline';

/**
 * MetricCard - Standardized KPI card with trend indicator
 * For use in dashboard headers and stats panels
 */
export function MetricCard({
  label,
  value,
  previousValue,
  unit = '',
  icon,
  trend,
  trendData = [],
  trendType = 'line',
  color = 'var(--accent-cyan)',
  size = 'normal',
  loading = false,
  className = '',
  onClick,
  valueFormatter = (v) => typeof v === 'number' ? v.toLocaleString() : v,
}) {
  // Calculate trend from current vs previous if not provided
  const calculatedTrend = useMemo(() => {
    if (trend !== undefined) return trend;
    if (previousValue === undefined || previousValue === 0) return null;
    return ((value - previousValue) / Math.abs(previousValue)) * 100;
  }, [value, previousValue, trend]);

  const trendDirection = calculatedTrend > 0 ? 'up' : calculatedTrend < 0 ? 'down' : 'neutral';
  const trendColor = trendDirection === 'up'
    ? 'var(--accent-green)'
    : trendDirection === 'down'
      ? 'var(--accent-red)'
      : 'var(--text-dim)';

  const sizeStyles = {
    compact: {
      padding: '8px 10px',
      labelSize: '10px',
      valueSize: '18px',
      trendSize: '10px',
      sparklineWidth: 50,
      sparklineHeight: 16,
    },
    normal: {
      padding: '12px 14px',
      labelSize: '11px',
      valueSize: '24px',
      trendSize: '11px',
      sparklineWidth: 60,
      sparklineHeight: 20,
    },
    large: {
      padding: '16px 18px',
      labelSize: '12px',
      valueSize: '32px',
      trendSize: '12px',
      sparklineWidth: 80,
      sparklineHeight: 24,
    },
  };

  const s = sizeStyles[size];

  if (loading) {
    return (
      <div
        className={`metric-card metric-card--loading metric-card--${size} ${className}`}
        style={{
          background: 'var(--bg-card)',
          borderRadius: '8px',
          padding: s.padding,
          border: '1px solid var(--border)',
          minWidth: size === 'compact' ? '100px' : '140px',
        }}
      >
        <div style={{
          height: s.labelSize,
          width: '60%',
          background: 'var(--bg-hover)',
          borderRadius: '4px',
          marginBottom: '8px',
        }} />
        <div style={{
          height: s.valueSize,
          width: '80%',
          background: 'var(--bg-hover)',
          borderRadius: '4px',
        }} />
      </div>
    );
  }

  return (
    <div
      className={`metric-card metric-card--${size} ${onClick ? 'metric-card--clickable' : ''} ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      style={{
        background: 'var(--bg-card)',
        borderRadius: '8px',
        padding: s.padding,
        border: '1px solid var(--border)',
        minWidth: size === 'compact' ? '100px' : '140px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.2s ease',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Accent glow on left edge */}
      <div style={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: '3px',
        background: color,
        opacity: 0.6,
      }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Label row */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            marginBottom: '4px',
          }}>
            {icon && (
              <span style={{
                fontSize: s.labelSize,
                color: color,
                display: 'flex',
                alignItems: 'center',
              }}>
                {icon}
              </span>
            )}
            <span style={{
              fontSize: s.labelSize,
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              fontWeight: 500,
            }}>
              {label}
            </span>
          </div>

          {/* Value row */}
          <div style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: '4px',
          }}>
            <span style={{
              fontSize: s.valueSize,
              fontWeight: 600,
              color: 'var(--text-primary)',
              fontFamily: "'JetBrains Mono', monospace",
              lineHeight: 1.1,
            }}>
              {valueFormatter(value)}
            </span>
            {unit && (
              <span style={{
                fontSize: s.trendSize,
                color: 'var(--text-dim)',
              }}>
                {unit}
              </span>
            )}
          </div>

          {/* Trend indicator */}
          {calculatedTrend !== null && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              marginTop: '4px',
            }}>
              <span style={{
                fontSize: s.trendSize,
                color: trendColor,
                display: 'flex',
                alignItems: 'center',
              }}>
                {trendDirection === 'up' && '↑'}
                {trendDirection === 'down' && '↓'}
                {trendDirection === 'neutral' && '→'}
                {Math.abs(calculatedTrend).toFixed(1)}%
              </span>
            </div>
          )}
        </div>

        {/* Sparkline */}
        {trendData.length > 0 && (
          <div style={{ marginLeft: '8px' }}>
            <Sparkline
              data={trendData}
              type={trendType}
              width={s.sparklineWidth}
              height={s.sparklineHeight}
              color={color}
            />
          </div>
        )}
      </div>
    </div>
  );
}

MetricCard.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  previousValue: PropTypes.number,
  unit: PropTypes.string,
  icon: PropTypes.node,
  trend: PropTypes.number,
  trendData: PropTypes.array,
  trendType: PropTypes.oneOf(['line', 'bar', 'area']),
  color: PropTypes.string,
  size: PropTypes.oneOf(['compact', 'normal', 'large']),
  loading: PropTypes.bool,
  className: PropTypes.string,
  onClick: PropTypes.func,
  valueFormatter: PropTypes.func,
};

export default MetricCard;
