import React from 'react';

export function InfoTabSkeleton() {
  return (
    <div className="detail-info-grid skeleton" aria-busy="true" aria-label="Loading aircraft information">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="info-section skeleton-card">
          <div className="skeleton-header">
            <div className="skeleton-icon" />
            <div className="skeleton-title" />
          </div>
          <div className="info-rows">
            {[1, 2, 3, 4].map(j => (
              <div key={j} className="info-row">
                <div className="skeleton-text skeleton-label" />
                <div className="skeleton-text skeleton-value" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
