import React, { useState, useCallback, memo } from 'react';
import {
  X,
  Plane,
  AlertTriangle,
  Radio,
  ArrowUp,
  ArrowDown,
  Minus,
  GripVertical,
  Eye,
  Zap,
  Clock,
  Edit3,
  Check,
} from 'lucide-react';

/**
 * Format time in range as human readable string
 */
function formatTimeInRange(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

/**
 * Get status class for strip styling
 */
function getStripStatusClass(strip) {
  if (strip.isEmergency) return 'emergency';
  if (strip.isConflict) return 'conflict';
  if (strip.isWatched) return 'watched';
  return 'normal';
}

/**
 * Get wake category color class
 */
function getWakeCategoryClass(category) {
  switch (category) {
    case 'J':
      return 'wake-super';
    case 'H':
      return 'wake-heavy';
    case 'M':
      return 'wake-medium';
    case 'L':
      return 'wake-light';
    default:
      return 'wake-medium';
  }
}

/**
 * Get vertical speed indicator
 */
function getVerticalTrend(vs) {
  if (!vs || Math.abs(vs) < 100) return { icon: Minus, class: 'level' };
  if (vs > 500) return { icon: ArrowUp, class: 'climbing' };
  if (vs < -500) return { icon: ArrowDown, class: 'descending' };
  return { icon: Minus, class: 'level' };
}

/**
 * FlightStrip - ATC-style electronic flight strip
 *
 * Displays:
 * - Callsign / Squawk code
 * - Aircraft type / Wake category (H/M/L)
 * - Current altitude with trend
 * - Ground speed (kts)
 * - Origin -> Destination (if available)
 * - Time in range
 * - Editable scratchpad/notes
 */
export const FlightStrip = memo(function FlightStrip({
  strip,
  index,
  isSelected,
  isDragging,
  isDragOver,
  onSelect,
  onRemove,
  onUpdateNote,
  onDragStart,
  onDragOver,
  onDragEnd,
}) {
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [noteValue, setNoteValue] = useState(strip.note || '');

  const statusClass = getStripStatusClass(strip);
  const wakeCategoryClass = getWakeCategoryClass(strip.wakeCategory);
  const vsTrend = getVerticalTrend(strip.verticalSpeed);
  const VsTrendIcon = vsTrend.icon;

  // Handle note save
  const handleSaveNote = useCallback(() => {
    onUpdateNote?.(strip.hex, noteValue);
    setIsEditingNote(false);
  }, [strip.hex, noteValue, onUpdateNote]);

  // Handle note cancel
  const handleCancelNote = useCallback(() => {
    setNoteValue(strip.note || '');
    setIsEditingNote(false);
  }, [strip.note]);

  // Handle key press in note input
  const handleNoteKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter') {
        handleSaveNote();
      } else if (e.key === 'Escape') {
        handleCancelNote();
      }
    },
    [handleSaveNote, handleCancelNote]
  );

  // Drag handlers
  const handleDragStart = useCallback(
    (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', index.toString());
      onDragStart?.(index);
    },
    [index, onDragStart]
  );

  const handleDragOver = useCallback(
    (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      onDragOver?.(index);
    },
    [index, onDragOver]
  );

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      onDragEnd?.();
    },
    [onDragEnd]
  );

  const handleDragEnd = useCallback(() => {
    onDragEnd?.();
  }, [onDragEnd]);

  return (
    <div
      className={`flight-strip ${statusClass} ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''} ${!strip.isLive ? 'stale' : ''}`}
      onClick={() => onSelect?.(strip.hex)}
      onKeyDown={(e) => e.key === 'Enter' && onSelect?.(strip.hex)}
      role="button"
      tabIndex={0}
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragEnd={handleDragEnd}
      aria-label={`Flight strip for ${strip.callsign || strip.hex}`}
    >
      {/* Drag handle */}
      <div className="strip-drag-handle" aria-hidden="true">
        <GripVertical size={14} />
      </div>

      {/* Status indicator bar */}
      <div className={`strip-status-bar ${statusClass}`} aria-hidden="true" />

      {/* Main content area */}
      <div className="strip-content">
        {/* Top row: Callsign, Type, Wake, Squawk */}
        <div className="strip-row strip-primary">
          <div className="strip-callsign">
            <Plane size={12} className="strip-icon" aria-hidden="true" />
            <span className="callsign-text">{strip.callsign || strip.hex?.toUpperCase()}</span>
            {strip.registration && <span className="strip-reg">{strip.registration}</span>}
          </div>

          <div className="strip-type-info">
            {strip.typeName && (
              <span className="strip-type" title={strip.type}>
                {strip.typeName}
              </span>
            )}
            <span
              className={`strip-wake ${wakeCategoryClass}`}
              title={`Wake category: ${strip.wakeCategory}`}
            >
              {strip.wakeCategory}
            </span>
          </div>

          <div className="strip-squawk">
            <Radio size={10} aria-hidden="true" />
            <span className={strip.isEmergency ? 'squawk-emergency' : ''}>
              {strip.squawk || '----'}
            </span>
          </div>
        </div>

        {/* Middle row: Altitude, Speed, V/S */}
        <div className="strip-row strip-metrics">
          <div className="strip-altitude">
            <span className="metric-label">ALT</span>
            <span className="metric-value">{strip.altitude?.toLocaleString() || '---'}</span>
            <VsTrendIcon size={12} className={`vs-trend ${vsTrend.class}`} aria-hidden="true" />
          </div>

          <div className="strip-speed">
            <span className="metric-label">GS</span>
            <span className="metric-value">{strip.speed || '---'}</span>
            <span className="metric-unit">kt</span>
          </div>

          <div className="strip-vs">
            <span className="metric-label">V/S</span>
            <span className={`metric-value ${vsTrend.class}`}>
              {strip.verticalSpeed > 0 ? '+' : ''}
              {strip.verticalSpeed || 0}
            </span>
          </div>
        </div>

        {/* Route row: Origin -> Destination */}
        {(strip.origin || strip.destination) && (
          <div className="strip-row strip-route">
            <span className="route-origin">{strip.origin || '????'}</span>
            <span className="route-arrow">-&gt;</span>
            <span className="route-dest">{strip.destination || '????'}</span>
            {strip.operator && (
              <span className="route-operator" title={strip.operator}>
                {strip.operator.substring(0, 20)}
              </span>
            )}
          </div>
        )}

        {/* Bottom row: Time in range, Status badges, Note */}
        <div className="strip-row strip-footer">
          <div className="strip-time">
            <Clock size={10} aria-hidden="true" />
            <span>{formatTimeInRange(strip.timeInRange || 0)}</span>
          </div>

          {/* Status badges */}
          <div className="strip-badges">
            {strip.isEmergency && (
              <span className="strip-badge emergency" title="Emergency">
                <AlertTriangle size={10} /> EMG
              </span>
            )}
            {strip.isConflict && (
              <span className="strip-badge conflict" title="In conflict">
                <Zap size={10} /> CFT
              </span>
            )}
            {strip.isWatched && (
              <span className="strip-badge watched" title="On watch list">
                <Eye size={10} />
              </span>
            )}
            {!strip.isLive && (
              <span className="strip-badge stale" title="Aircraft not currently visible">
                OUT
              </span>
            )}
          </div>

          {/* Scratchpad/Notes */}
          <div className="strip-note">
            {isEditingNote ? (
              <div className="note-edit">
                <input
                  type="text"
                  value={noteValue}
                  onChange={(e) => setNoteValue(e.target.value)}
                  onKeyDown={handleNoteKeyDown}
                  onBlur={handleSaveNote}
                  placeholder="Add note..."
                  /* eslint-disable-next-line jsx-a11y/no-autofocus */
                  autoFocus
                  maxLength={50}
                  className="note-input"
                  aria-label="Strip note"
                />
                <button
                  className="note-save"
                  onClick={handleSaveNote}
                  title="Save note"
                  aria-label="Save note"
                >
                  <Check size={10} />
                </button>
              </div>
            ) : (
              <button
                className={`note-display ${strip.note ? 'has-note' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditingNote(true);
                }}
                title={strip.note || 'Add note'}
                aria-label={strip.note ? `Note: ${strip.note}` : 'Add note'}
              >
                <Edit3 size={10} />
                {strip.note && <span className="note-text">{strip.note}</span>}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Remove button */}
      <button
        className="strip-remove"
        onClick={(e) => {
          e.stopPropagation();
          onRemove?.(strip.hex);
        }}
        title="Remove flight strip"
        aria-label="Remove flight strip"
      >
        <X size={14} />
      </button>
    </div>
  );
});

export default FlightStrip;
