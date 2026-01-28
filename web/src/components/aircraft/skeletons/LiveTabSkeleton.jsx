import React from 'react';

export function LiveTabSkeleton() {
  return (
    <div className="detail-live skeleton" aria-busy="true" aria-label="Loading live status">
      <div className="live-stats-grid">
        {[1, 2, 3, 4, 5, 6, 7].map(i => (
          <div key={i} className="live-stat skeleton-stat">
            <div className="skeleton-text skeleton-label" />
            <div className="skeleton-value-pulse" />
            <div className="skeleton-text skeleton-unit" />
          </div>
        ))}
      </div>
      <div className="live-position skeleton-position">
        <div className="skeleton-text skeleton-heading" />
        <div className="position-coords">
          <div className="skeleton-text skeleton-coord" />
          <div className="skeleton-text skeleton-coord" />
        </div>
      </div>
    </div>
  );
}
