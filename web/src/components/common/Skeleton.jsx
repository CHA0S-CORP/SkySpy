import React from 'react';

/**
 * Skeleton - Loading placeholder component with shimmer animation
 *
 * Variants:
 * - text: Single line of text (default height: 16px)
 * - card: Card/block element (default height: 100px)
 * - circle: Circular element (width = height)
 * - rect: Rectangle with custom dimensions
 *
 * Props:
 * - variant: 'text' | 'card' | 'circle' | 'rect'
 * - width: CSS width value (e.g., '100%', '200px', 100)
 * - height: CSS height value
 * - className: Additional CSS classes
 * - style: Additional inline styles
 * - count: Number of skeleton elements to render (for text variant)
 * - gap: Gap between multiple elements (default: 8px)
 */
export function Skeleton({
  variant = 'text',
  width,
  height,
  className = '',
  style = {},
  count = 1,
  gap = 8
}) {
  // Default dimensions based on variant
  const getDefaultDimensions = () => {
    switch (variant) {
      case 'text':
        return {
          width: width || '100%',
          height: height || 16
        };
      case 'card':
        return {
          width: width || '100%',
          height: height || 100
        };
      case 'circle': {
        const size = width || height || 40;
        return {
          width: size,
          height: size
        };
      }
      case 'rect':
      default:
        return {
          width: width || '100%',
          height: height || 40
        };
    }
  };

  const dimensions = getDefaultDimensions();

  const baseStyle = {
    width: typeof dimensions.width === 'number' ? `${dimensions.width}px` : dimensions.width,
    height: typeof dimensions.height === 'number' ? `${dimensions.height}px` : dimensions.height,
    ...style
  };

  const variantClass = `skeleton-${variant}`;
  const combinedClassName = `skeleton ${variantClass} ${className}`.trim();

  if (count > 1) {
    return (
      <div className="skeleton-group" style={{ display: 'flex', flexDirection: 'column', gap: `${gap}px` }}>
        {Array.from({ length: count }).map((_, index) => (
          <div
            key={index}
            className={combinedClassName}
            style={baseStyle}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={combinedClassName}
      style={baseStyle}
    />
  );
}

/**
 * SkeletonCard - Pre-configured skeleton for card layouts (KPI cards, stats cards)
 */
export function SkeletonCard({ className = '', ...props }) {
  return (
    <div className={`skeleton-card-container ${className}`}>
      <div className="skeleton-card-header">
        <Skeleton variant="circle" width={32} height={32} />
        <Skeleton variant="text" width="60%" height={14} />
      </div>
      <div className="skeleton-card-content">
        <Skeleton variant="text" width="40%" height={28} />
        <Skeleton variant="text" width="70%" height={12} />
      </div>
    </div>
  );
}

/**
 * SkeletonTableRow - Pre-configured skeleton for table rows
 */
export function SkeletonTableRow({ columns = 5, className = '' }) {
  return (
    <tr className={`skeleton-table-row ${className}`}>
      {Array.from({ length: columns }).map((_, index) => (
        <td key={index}>
          <Skeleton variant="text" width={index === 0 ? '80%' : '60%'} height={14} />
        </td>
      ))}
    </tr>
  );
}

/**
 * SkeletonAudioItem - Pre-configured skeleton for audio transmission items
 */
export function SkeletonAudioItem({ className = '' }) {
  return (
    <div className={`skeleton-audio-item ${className}`}>
      <Skeleton variant="circle" width={40} height={40} />
      <div className="skeleton-audio-info">
        <div className="skeleton-audio-header">
          <Skeleton variant="text" width="30%" height={14} />
          <Skeleton variant="text" width="20%" height={12} />
          <Skeleton variant="text" width="25%" height={12} />
        </div>
        <Skeleton variant="rect" width="100%" height={6} style={{ borderRadius: 3 }} />
        <Skeleton variant="text" width="90%" height={12} />
      </div>
      <Skeleton variant="rect" width={60} height={24} style={{ borderRadius: 4 }} />
    </div>
  );
}

/**
 * SkeletonAircraftInfo - Pre-configured skeleton for aircraft detail info
 */
export function SkeletonAircraftInfo({ className = '' }) {
  return (
    <div className={`skeleton-aircraft-info ${className}`}>
      <div className="skeleton-aircraft-photo">
        <Skeleton variant="rect" width="100%" height={200} />
      </div>
      <div className="skeleton-aircraft-details">
        <Skeleton variant="text" width="60%" height={24} />
        <Skeleton variant="text" width="40%" height={16} />
        <div className="skeleton-aircraft-stats">
          <Skeleton variant="rect" width="100%" height={60} />
          <Skeleton variant="rect" width="100%" height={60} />
        </div>
        <Skeleton variant="text" count={3} width="80%" height={14} gap={10} />
      </div>
    </div>
  );
}

/**
 * SkeletonLeaderboard - Pre-configured skeleton for leaderboard cards
 */
export function SkeletonLeaderboard({ items = 3, className = '' }) {
  return (
    <div className={`skeleton-leaderboard ${className}`}>
      <div className="skeleton-leaderboard-header">
        <Skeleton variant="circle" width={16} height={16} />
        <Skeleton variant="text" width="50%" height={14} />
      </div>
      <div className="skeleton-leaderboard-list">
        {Array.from({ length: items }).map((_, index) => (
          <div key={index} className="skeleton-leaderboard-item">
            <Skeleton variant="circle" width={24} height={24} />
            <div className="skeleton-leaderboard-info">
              <Skeleton variant="text" width="70%" height={14} />
            </div>
            <Skeleton variant="text" width={60} height={14} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * SkeletonKPICard - Pre-configured skeleton for KPI metric cards
 */
export function SkeletonKPICard({ className = '' }) {
  return (
    <div className={`skeleton-kpi-card ${className}`}>
      <div className="skeleton-kpi-header">
        <Skeleton variant="circle" width={16} height={16} />
        <Skeleton variant="text" width="40%" height={12} />
      </div>
      <div className="skeleton-kpi-metrics">
        <div className="skeleton-kpi-metric">
          <Skeleton variant="text" width={50} height={24} />
          <Skeleton variant="text" width={40} height={10} />
        </div>
        <div className="skeleton-kpi-metric">
          <Skeleton variant="text" width={50} height={24} />
          <Skeleton variant="text" width={40} height={10} />
        </div>
      </div>
    </div>
  );
}

/**
 * SkeletonSessionCard - Pre-configured skeleton for session/history cards
 */
export function SkeletonSessionCard({ className = '' }) {
  return (
    <div className={`skeleton-session-card ${className}`}>
      <div className="skeleton-session-header">
        <div className="skeleton-session-identity">
          <Skeleton variant="text" width="60%" height={18} />
          <Skeleton variant="text" width="40%" height={12} />
        </div>
        <Skeleton variant="rect" width={50} height={40} style={{ borderRadius: 6 }} />
      </div>
      <div className="skeleton-session-stats">
        <Skeleton variant="rect" width="100%" height={8} style={{ borderRadius: 4 }} />
        <Skeleton variant="rect" width="70%" height={8} style={{ borderRadius: 4 }} />
      </div>
      <div className="skeleton-session-footer">
        <Skeleton variant="text" width="30%" height={12} />
        <Skeleton variant="text" width="30%" height={12} />
      </div>
    </div>
  );
}

export default Skeleton;
