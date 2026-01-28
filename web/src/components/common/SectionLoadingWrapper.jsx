import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

/**
 * SectionLoadingWrapper - Wraps sections with loading and error states
 * @param {boolean} loading - Whether the section is loading
 * @param {string} error - Error message if any
 * @param {React.ReactNode} children - Content to render when loaded
 * @param {React.ReactNode} skeleton - Custom skeleton component to show while loading
 * @param {function} onRetry - Optional retry callback for errors
 * @param {string} minHeight - Minimum height for the loading/error state
 */
export function SectionLoadingWrapper({
  loading,
  error,
  children,
  skeleton,
  onRetry,
  minHeight = '100px'
}) {
  if (loading) {
    if (skeleton) {
      return skeleton;
    }
    return (
      <div className="section-loading" style={{ minHeight }}>
        <RefreshCw size={20} className="spin" />
        <span>Loading...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="section-error" style={{ minHeight }}>
        <AlertCircle size={20} />
        <span className="section-error-message">{error}</span>
        {onRetry && (
          <button className="section-retry-btn" onClick={onRetry}>
            <RefreshCw size={14} />
            Retry
          </button>
        )}
      </div>
    );
  }

  return children;
}

/**
 * SectionSkeleton - Generic skeleton for section content
 */
export function SectionSkeleton({ rows = 3, showHeader = true }) {
  return (
    <div className="section-skeleton">
      {showHeader && (
        <div className="skeleton-header">
          <div className="skeleton skeleton-text" style={{ width: '120px', height: '16px' }} />
        </div>
      )}
      <div className="skeleton-content">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="skeleton-row">
            <div className="skeleton skeleton-text" style={{ width: `${70 + Math.random() * 30}%`, height: '14px' }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * CardSkeleton - Skeleton for card components
 */
export function CardSkeleton({ showIcon = true, rows = 2 }) {
  return (
    <div className="card-skeleton">
      <div className="card-skeleton-header">
        {showIcon && <div className="skeleton skeleton-circle" style={{ width: '24px', height: '24px' }} />}
        <div className="skeleton skeleton-text" style={{ width: '100px', height: '14px' }} />
      </div>
      <div className="card-skeleton-content">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="skeleton skeleton-text" style={{ width: `${50 + Math.random() * 40}%`, height: '20px' }} />
        ))}
      </div>
    </div>
  );
}

export default SectionLoadingWrapper;
