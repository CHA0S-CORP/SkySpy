import React from 'react';

export function MapTabSkeleton() {
  return (
    <div className="track-replay-container skeleton" aria-busy="true" aria-label="Loading track map">
      {/* Skeleton telemetry overlay */}
      <div className="track-telemetry-overlay skeleton-overlay">
        <div className="telem-row">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="telem-item">
              <div className="skeleton-text skeleton-label-small" />
              <div className="skeleton-value-pulse" />
              <div className="skeleton-text skeleton-unit-small" />
            </div>
          ))}
        </div>
      </div>

      {/* Skeleton map */}
      <div className="track-map skeleton-map">
        <div className="skeleton-map-content">
          <svg className="skeleton-track-line" viewBox="0 0 100 50" preserveAspectRatio="none">
            <path
              d="M10 40 Q 30 10, 50 25 T 90 15"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray="4 2"
              className="skeleton-animate"
            />
          </svg>
          <div className="skeleton-aircraft-icon" />
        </div>
      </div>

      {/* Skeleton graphs */}
      <div className="track-graphs skeleton-graphs">
        <div className="graphs-row">
          {[1, 2, 3].map(i => (
            <div key={i} className="mini-graph skeleton-graph">
              <div className="mini-graph-header">
                <div className="skeleton-text skeleton-label" />
              </div>
              <div className="skeleton-graph-area" />
            </div>
          ))}
        </div>
      </div>

      {/* Skeleton controls */}
      <div className="track-controls skeleton-controls">
        <div className="replay-buttons">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="skeleton-btn" />
          ))}
        </div>
        <div className="replay-slider-container">
          <div className="skeleton-slider" />
        </div>
      </div>
    </div>
  );
}
