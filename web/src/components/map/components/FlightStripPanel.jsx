import React, { useMemo, memo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Trash2,
  ToggleLeft,
  ToggleRight,
  ListOrdered,
} from 'lucide-react';
import { FlightStrip } from './FlightStrip';

/**
 * FlightStripPanel - ATC-style electronic flight strip panel
 *
 * Collapsible panel showing flight strips for tracked aircraft.
 * Positioned on the left side of the map (opposite from watch list).
 *
 * Features:
 * - Drag strips to reorder
 * - Color-coded by status (normal/watched/emergency/conflict)
 * - Strip annotations/notes
 * - Auto-remove when aircraft exits range (configurable)
 */
export const FlightStripPanel = memo(function FlightStripPanel({
  strips,
  panelVisible,
  autoRemove,
  selectedHex,
  draggedIndex,
  dragOverIndex,
  onSelect,
  onRemove,
  onUpdateNote,
  onClear,
  onToggleAutoRemove,
  onTogglePanel,
  onDragStart,
  onDragOver,
  onDragEnd,
}) {
  // Sort strips: emergencies first, then conflicts, then watched, then by add time
  const sortedStrips = useMemo(() => {
    return [...strips].sort((a, b) => {
      // Emergencies always first
      if (a.isEmergency && !b.isEmergency) return -1;
      if (!a.isEmergency && b.isEmergency) return 1;

      // Then conflicts
      if (a.isConflict && !b.isConflict) return -1;
      if (!a.isConflict && b.isConflict) return 1;

      // Then watched
      if (a.isWatched && !b.isWatched) return -1;
      if (!a.isWatched && b.isWatched) return 1;

      // Finally by add time (newest first)
      return (b.addedAt || 0) - (a.addedAt || 0);
    });
  }, [strips]);

  // Count by status
  const statusCounts = useMemo(() => {
    return strips.reduce(
      (acc, strip) => {
        if (strip.isEmergency) acc.emergency++;
        else if (strip.isConflict) acc.conflict++;
        else if (strip.isWatched) acc.watched++;
        else if (!strip.isLive) acc.stale++;
        else acc.normal++;
        return acc;
      },
      { emergency: 0, conflict: 0, watched: 0, stale: 0, normal: 0 }
    );
  }, [strips]);

  if (!panelVisible) {
    // Show collapsed toggle button
    return (
      <button
        className="flight-strip-toggle-btn pro-style"
        onClick={onTogglePanel}
        title="Show flight strips"
        aria-label={`Show flight strips (${strips.length} strips)`}
      >
        <ListOrdered size={16} />
        <span className="toggle-count">{strips.length}</span>
        <ChevronRight size={14} />
      </button>
    );
  }

  return (
    <div className="flight-strip-panel pro-style" role="region" aria-label="Flight strips panel">
      {/* Panel header */}
      <div className="strip-panel-header">
        <div className="strip-panel-title">
          <ListOrdered size={16} aria-hidden="true" />
          <span>FLIGHT STRIPS</span>
          <span className="strip-count">{strips.length}</span>
        </div>

        <div className="strip-panel-actions">
          {/* Auto-remove toggle */}
          <button
            className={`strip-panel-btn ${autoRemove ? 'active' : ''}`}
            onClick={onToggleAutoRemove}
            title={autoRemove ? 'Auto-remove enabled' : 'Auto-remove disabled'}
            aria-pressed={autoRemove}
            aria-label={autoRemove ? 'Disable auto-remove' : 'Enable auto-remove'}
          >
            {autoRemove ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
          </button>

          {/* Clear all */}
          <button
            className="strip-panel-btn danger"
            onClick={onClear}
            title="Clear all strips"
            aria-label="Clear all flight strips"
            disabled={strips.length === 0}
          >
            <Trash2 size={14} />
          </button>

          {/* Collapse panel */}
          <button
            className="strip-panel-btn"
            onClick={onTogglePanel}
            title="Hide flight strips"
            aria-label="Hide flight strips panel"
          >
            <ChevronLeft size={16} />
          </button>
        </div>
      </div>

      {/* Status summary bar */}
      {strips.length > 0 && (
        <div className="strip-status-summary">
          {statusCounts.emergency > 0 && (
            <span
              className="status-count emergency"
              title={`${statusCounts.emergency} emergencies`}
            >
              {statusCounts.emergency} EMG
            </span>
          )}
          {statusCounts.conflict > 0 && (
            <span className="status-count conflict" title={`${statusCounts.conflict} in conflict`}>
              {statusCounts.conflict} CFT
            </span>
          )}
          {statusCounts.watched > 0 && (
            <span className="status-count watched" title={`${statusCounts.watched} watched`}>
              {statusCounts.watched} WCH
            </span>
          )}
          {statusCounts.stale > 0 && (
            <span className="status-count stale" title={`${statusCounts.stale} out of range`}>
              {statusCounts.stale} OUT
            </span>
          )}
        </div>
      )}

      {/* Strips list */}
      <div className="strip-panel-content">
        {sortedStrips.length === 0 ? (
          <div className="strip-panel-empty">
            <p>No flight strips</p>
            <p className="empty-hint">
              Right-click an aircraft and select &quot;Add Flight Strip&quot; or use the{' '}
              <kbd>S</kbd> key
            </p>
          </div>
        ) : (
          <div className="strip-list">
            {sortedStrips.map((strip, index) => (
              <FlightStrip
                key={strip.hex}
                strip={strip}
                index={index}
                isSelected={selectedHex?.toUpperCase() === strip.hex}
                isDragging={draggedIndex === index}
                isDragOver={dragOverIndex === index}
                onSelect={onSelect}
                onRemove={onRemove}
                onUpdateNote={onUpdateNote}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDragEnd={onDragEnd}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer with keyboard hint */}
      <div className="strip-panel-footer">
        <span className="keyboard-hint">
          <kbd>F</kbd> Toggle panel
        </span>
        <span className="keyboard-hint">
          <kbd>S</kbd> Add selected
        </span>
      </div>
    </div>
  );
});

export default FlightStripPanel;
