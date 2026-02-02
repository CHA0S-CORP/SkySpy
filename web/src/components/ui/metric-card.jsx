import React, { forwardRef, useRef, useEffect, useState, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cva } from 'class-variance-authority';
import { cn } from './cn';

const metricCardVariants = cva(
  // Base styles for metric cards
  [
    'relative rounded-xl',
    'border transition-all duration-200',
    'overflow-hidden',
    'min-h-[72px]',
    'flex flex-col justify-center',
  ],
  {
    variants: {
      variant: {
        default: [
          'bg-white/[0.03] backdrop-blur-sm',
          'border-white/[0.08]',
        ],
        primary: [
          'bg-white/[0.04] backdrop-blur-sm',
          'border-white/[0.1]',
        ],
        emergency: [
          'bg-red-500/10 backdrop-blur-sm',
          'border-red-500/30',
        ],
        warning: [
          'bg-yellow-500/10 backdrop-blur-sm',
          'border-yellow-500/30',
        ],
      },
      size: {
        sm: 'p-2.5',
        md: 'p-3',
        lg: 'p-4',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
);

/**
 * Determine trend direction from current and previous value
 */
function getTrend(current, previous) {
  if (previous === null || previous === undefined) return null;
  const diff = current - previous;
  if (Math.abs(diff) < 0.001) return 'stable';
  return diff > 0 ? 'increasing' : 'decreasing';
}

/**
 * MetricCard - A single metric display card with value change animations
 *
 * Features:
 * - Animated value changes (color + subtle position shift)
 * - Trend indicator (icon pairing for accessibility)
 * - Customizable label and unit
 * - Screen reader friendly with aria-live
 */
const MetricCard = forwardRef(function MetricCard(
  {
    label,
    value,
    unit,
    icon: Icon,
    trend: trendProp,
    trendIcon: TrendIcon,
    variant = 'default',
    size = 'md',
    formatValue,
    className,
    valueClassName,
    ariaLabel,
    ...props
  },
  ref
) {
  const prevValueRef = useRef(value);
  const [animationClass, setAnimationClass] = useState('');

  // Detect value changes and trigger animation
  useEffect(() => {
    const prevValue = prevValueRef.current;
    if (prevValue !== value && prevValue !== null && prevValue !== undefined) {
      const trend = trendProp || getTrend(parseFloat(value), parseFloat(prevValue));
      if (trend === 'increasing') {
        setAnimationClass('metric-value-increasing');
      } else if (trend === 'decreasing') {
        setAnimationClass('metric-value-decreasing');
      }

      // Clear animation class after animation completes
      const timer = setTimeout(() => setAnimationClass(''), 300);
      return () => clearTimeout(timer);
    }
    prevValueRef.current = value;
  }, [value, trendProp]);

  // Format the display value
  const displayValue = formatValue ? formatValue(value) : value;

  // Get trend-based classes
  const trendClass = trendProp === 'climbing' || trendProp === 'increasing'
    ? 'climbing'
    : trendProp === 'descending' || trendProp === 'decreasing'
      ? 'descending'
      : '';

  return (
    <motion.div
      ref={ref}
      className={cn(metricCardVariants({ variant, size }), className)}
      whileHover={{
        scale: 1.02,
        boxShadow: '0 8px 24px rgba(0, 212, 255, 0.15)',
        borderColor: 'rgba(0, 212, 255, 0.3)',
      }}
      transition={{ duration: 0.15 }}
      {...props}
    >
      {/* Label with icon */}
      <div className="metric-card-label flex items-center gap-1.5 mb-1">
        {Icon && (
          <Icon
            size={12}
            className="flex-shrink-0 text-text-dim"
            aria-hidden="true"
          />
        )}
        <span className="text-[10px] font-medium uppercase tracking-wider text-text-dim">
          {label}
        </span>
      </div>

      {/* Value with trend indicator */}
      <div
        className={cn(
          'metric-card-value',
          'flex items-baseline gap-1',
          'text-xl font-bold font-mono',
          'text-text-primary',
          trendClass,
          animationClass,
          valueClassName
        )}
        aria-live="polite"
        aria-label={ariaLabel || `${label}: ${displayValue} ${unit || ''}`}
      >
        {TrendIcon && (
          <TrendIcon
            size={14}
            className={cn(
              'trend-icon flex-shrink-0',
              trendClass === 'climbing' && 'text-accent-green',
              trendClass === 'descending' && 'text-accent-yellow'
            )}
            aria-hidden="true"
          />
        )}
        <span className="metric-value-text">{displayValue}</span>
        {unit && (
          <span className="text-xs font-normal text-text-secondary ml-0.5">
            {unit}
          </span>
        )}
      </div>
    </motion.div>
  );
});

/**
 * MetricsGrid - A responsive grid container for MetricCard components
 */
const MetricsGrid = forwardRef(function MetricsGrid(
  { columns = 2, gap = 3, children, className, ...props },
  ref
) {
  const gridCols = {
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
  };

  return (
    <div
      ref={ref}
      className={cn(
        'metrics-grid grid',
        gridCols[columns] || 'grid-cols-2',
        `gap-${gap}`,
        className
      )}
      role="region"
      aria-label="Flight metrics"
      {...props}
    >
      {children}
    </div>
  );
});

/**
 * PrimaryMetrics - 2x2 grid for critical flight data
 * Displays: Altitude, Speed, V/S, Distance
 */
const PrimaryMetrics = memo(function PrimaryMetrics({
  altitude,
  speed,
  verticalSpeed,
  distance,
  altitudeClass,
  speedClass,
  distanceTrend,
  TrendIcon,
  className,
}) {
  // Format altitude with thousands separator
  const formatAltitude = (alt) => {
    if (alt === null || alt === undefined) return '--';
    return Math.round(alt).toLocaleString();
  };

  // Format vertical speed with sign
  const formatVS = (vs) => {
    if (vs === null || vs === undefined) return '--';
    const rounded = Math.round(vs);
    return rounded > 0 ? `+${rounded.toLocaleString()}` : rounded.toLocaleString();
  };

  // Get trend class for V/S
  const vsTrend = verticalSpeed > 0 ? 'climbing' : verticalSpeed < 0 ? 'descending' : '';
  const isExtremeVS = Math.abs(verticalSpeed || 0) > 3000;

  return (
    <MetricsGrid columns={2} gap={3} className={cn('primary-metrics', className)}>
      <MetricCard
        label="Altitude"
        value={formatAltitude(altitude)}
        unit="ft"
        valueClassName={altitudeClass}
      />
      <MetricCard
        label="Speed"
        value={speed || '--'}
        unit="kts"
        valueClassName={speedClass}
      />
      <MetricCard
        label="V/S"
        value={formatVS(verticalSpeed)}
        unit="fpm"
        trend={vsTrend}
        valueClassName={cn(vsTrend, isExtremeVS && 'extreme-vs')}
      />
      <MetricCard
        label="Distance"
        value={distance?.toFixed(1) || '--'}
        unit="nm"
        trend={distanceTrend}
        trendIcon={TrendIcon}
      />
    </MetricsGrid>
  );
});

/**
 * SecondaryMetrics - 2x2 grid for secondary flight data
 * Displays: Track, Squawk, RSSI, Type
 */
const SecondaryMetrics = memo(function SecondaryMetrics({
  track,
  trackCardinal,
  squawk,
  rssi,
  signalClass,
  type,
  className,
}) {
  // Format track heading
  const formatTrack = (t) => {
    if (t === null || t === undefined) return '--';
    return `${Math.round(t)}°`;
  };

  // Format RSSI
  const formatRssi = (r) => {
    if (r === null || r === undefined) return '--';
    return r.toFixed(0);
  };

  return (
    <MetricsGrid columns={2} gap={3} className={cn('secondary-metrics', className)}>
      <MetricCard
        label="Track"
        value={formatTrack(track)}
        unit={trackCardinal || ''}
        size="sm"
      />
      <MetricCard
        label="Squawk"
        value={squawk || '1200'}
        size="sm"
      />
      <MetricCard
        label="RSSI"
        value={formatRssi(rssi)}
        unit="dB"
        valueClassName={signalClass}
        size="sm"
      />
      <MetricCard
        label="Type"
        value={type || '--'}
        size="sm"
      />
    </MetricsGrid>
  );
});

export { MetricCard, MetricsGrid, PrimaryMetrics, SecondaryMetrics, metricCardVariants };
