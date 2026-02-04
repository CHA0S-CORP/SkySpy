import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  X,
  BarChart3,
  Clock,
  Plane,
  TrendingUp,
  Target,
  Activity,
  RefreshCw,
  Layers,
} from 'lucide-react';

/**
 * SessionStatsPanel - displays session statistics for Pro Mode
 * Shows metrics tracked over the current browsing session
 */
export function SessionStatsPanel({
  show,
  onClose,
  sessionStats,
  config,
  // Draggable panel support
  position = { x: null, y: null },
  isDragging = false,
  onMouseDown,
  dragStartRef,
}) {
  const [collapsed, setCollapsed] = useState(false);

  if (!show) return null;
  if (config?.mapMode !== 'pro' && config?.mapMode !== 'crt') return null;

  const {
    sessionDurationFormatted,
    uniqueAircraftCount,
    currentCount,
    peakSimultaneousCount,
    peakTimeFormatted,
    categoryBreakdown,
    topAircraftTypes,
    maxRangeNm,
    maxRangeAircraft,
    totalPositionUpdates,
    resetSession,
  } = sessionStats || {};

  // Sort category breakdown by count
  const sortedCategories = Object.entries(categoryBreakdown || {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6);

  return (
    <aside
      className={`session-stats-panel pro-style ${isDragging ? 'dragging' : ''} ${collapsed ? 'collapsed' : ''}`}
      style={
        position.x !== null
          ? {
              left: position.x,
              top: position.y,
              right: 'auto',
              bottom: 'auto',
            }
          : {}
      }
      aria-label="Session statistics"
    >
      <div
        className="session-stats-header"
        role="toolbar"
        aria-label="Session stats controls"
        onMouseDown={onMouseDown}
        onTouchStart={(e) => {
          if (e.target.closest('button')) return;
          const touch = e.touches[0];
          const rect = e.currentTarget.parentElement.getBoundingClientRect();
          if (dragStartRef) {
            dragStartRef.current = {
              x: touch.clientX,
              y: touch.clientY,
              startX: position.x ?? rect.left,
              startY: position.y ?? rect.top,
            };
          }
        }}
      >
        <div className="session-stats-title">
          <BarChart3 size={14} />
          <span>Session Stats</span>
        </div>
        <div className="session-stats-header-buttons">
          <button
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? 'Expand' : 'Collapse'}
            aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
          >
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          <button onClick={onClose} title="Close" aria-label="Close panel">
            <X size={14} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="session-stats-content">
          {/* Session Duration */}
          <div className="session-stats-section">
            <div className="session-stats-section-title">
              <Clock size={12} />
              <span>Session Duration</span>
            </div>
            <div className="session-stats-value large">{sessionDurationFormatted || '0s'}</div>
          </div>

          {/* Aircraft Counts */}
          <div className="session-stats-section">
            <div className="session-stats-section-title">
              <Plane size={12} />
              <span>Aircraft Tracking</span>
            </div>
            <div className="session-stats-grid">
              <div className="session-stats-metric">
                <span className="metric-label">Current</span>
                <span className="metric-value">{currentCount || 0}</span>
              </div>
              <div className="session-stats-metric">
                <span className="metric-label">Unique Seen</span>
                <span className="metric-value highlight">{uniqueAircraftCount || 0}</span>
              </div>
            </div>
          </div>

          {/* Peak Count */}
          <div className="session-stats-section">
            <div className="session-stats-section-title">
              <TrendingUp size={12} />
              <span>Peak Traffic</span>
            </div>
            <div className="session-stats-grid">
              <div className="session-stats-metric">
                <span className="metric-label">Max Count</span>
                <span className="metric-value highlight">{peakSimultaneousCount || 0}</span>
              </div>
              <div className="session-stats-metric">
                <span className="metric-label">Peak Time</span>
                <span className="metric-value small">{peakTimeFormatted || '--:--'}</span>
              </div>
            </div>
          </div>

          {/* Max Range */}
          <div className="session-stats-section">
            <div className="session-stats-section-title">
              <Target size={12} />
              <span>Max Range</span>
            </div>
            <div className="session-stats-grid">
              <div className="session-stats-metric">
                <span className="metric-label">Distance</span>
                <span className="metric-value highlight">
                  {maxRangeNm ? `${Math.round(maxRangeNm)} nm` : '-- nm'}
                </span>
              </div>
              <div className="session-stats-metric">
                <span className="metric-label">Aircraft</span>
                <span className="metric-value small mono">
                  {maxRangeAircraft?.toUpperCase() || '------'}
                </span>
              </div>
            </div>
          </div>

          {/* Position Updates */}
          <div className="session-stats-section">
            <div className="session-stats-section-title">
              <Activity size={12} />
              <span>Position Updates</span>
            </div>
            <div className="session-stats-value">{totalPositionUpdates?.toLocaleString() || 0}</div>
          </div>

          {/* Category Breakdown */}
          {sortedCategories.length > 0 && (
            <div className="session-stats-section">
              <div className="session-stats-section-title">
                <Layers size={12} />
                <span>By Category</span>
              </div>
              <div className="session-stats-breakdown">
                {sortedCategories.map(([category, count]) => (
                  <div key={category} className="breakdown-item">
                    <span className="breakdown-label">{category}</span>
                    <span className="breakdown-value">{count}</span>
                    <div
                      className="breakdown-bar"
                      style={{
                        width: `${Math.min(100, (count / (uniqueAircraftCount || 1)) * 100)}%`,
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top Aircraft Types */}
          {topAircraftTypes && topAircraftTypes.length > 0 && (
            <div className="session-stats-section">
              <div className="session-stats-section-title">
                <Plane size={12} />
                <span>Top Aircraft Types</span>
              </div>
              <div className="session-stats-types">
                {topAircraftTypes.map(({ type, count }, index) => (
                  <div key={type} className="type-item">
                    <span className="type-rank">#{index + 1}</span>
                    <span className="type-name">{type}</span>
                    <span className="type-count">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reset Button */}
          <div className="session-stats-actions">
            <button
              className="session-stats-reset-btn"
              onClick={resetSession}
              title="Reset session statistics"
            >
              <RefreshCw size={12} />
              <span>Reset Session</span>
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

/**
 * Button to show/hide the session stats panel
 */
export function SessionStatsButton({ onClick, isActive, config }) {
  if (config?.mapMode !== 'pro' && config?.mapMode !== 'crt') return null;

  return (
    <button
      className={`session-stats-show-btn pro-style ${isActive ? 'active' : ''}`}
      onClick={onClick}
      title="Session Statistics"
      aria-label="Toggle session statistics panel"
      aria-pressed={isActive}
    >
      <BarChart3 size={16} />
    </button>
  );
}

export default SessionStatsPanel;
