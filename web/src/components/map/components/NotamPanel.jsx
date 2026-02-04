import React, { useMemo } from 'react';
import { FileWarning, X, GripHorizontal, RefreshCw } from 'lucide-react';
import { useDraggable } from '../../../hooks/useDraggable';
import { NotamItem } from './NotamItem';

// Available type filters
const NOTAM_FILTER_OPTIONS = [
  { value: '', label: 'All NOTAMs' },
  { value: 'TFR', label: 'TFRs Only' },
  { value: 'FDC', label: 'FDC NOTAMs' },
  { value: 'D', label: 'NOTAM D' },
  { value: 'GPS', label: 'GPS NOTAMs' },
  { value: 'MIL', label: 'Military' },
];

/**
 * NotamPanel component - floating panel showing NOTAM list for pro mode
 */
export function NotamPanel({
  show,
  onClose,
  notams,
  loading,
  error,
  acknowledged,
  onAcknowledge,
  onUnacknowledge,
  onShowOnMap,
  onRefresh,
  typeFilter,
  setTypeFilter,
  selectedNotamId,
  unacknowledgedCount,
}) {
  // Draggable panel behavior
  const { position, handleMouseDown } = useDraggable(
    { x: null, y: null },
    { width: 360, height: 500 }
  );

  // Sort NOTAMs: TFRs first, then unacknowledged, then by effective_end (soonest first)
  const sortedNotams = useMemo(() => {
    if (!notams) return [];

    return [...notams].sort((a, b) => {
      // TFRs always on top
      const aIsTfr = a.type === 'TFR' ? 0 : 1;
      const bIsTfr = b.type === 'TFR' ? 0 : 1;
      if (aIsTfr !== bIsTfr) return aIsTfr - bIsTfr;

      // Acknowledged items go to bottom
      const aAck = acknowledged?.has(a.notam_id || a.id) ? 1 : 0;
      const bAck = acknowledged?.has(b.notam_id || b.id) ? 1 : 0;
      if (aAck !== bAck) return aAck - bAck;

      // Sort by effective_end (soonest expiry first), permanent last
      const aTime = a.is_permanent
        ? Infinity
        : a.effective_end
          ? new Date(a.effective_end).getTime()
          : Infinity;
      const bTime = b.is_permanent
        ? Infinity
        : b.effective_end
          ? new Date(b.effective_end).getTime()
          : Infinity;
      return aTime - bTime;
    });
  }, [notams, acknowledged]);

  // Filter by type
  const filteredNotams = useMemo(() => {
    if (!typeFilter) return sortedNotams;
    return sortedNotams.filter((n) => n.type === typeFilter);
  }, [sortedNotams, typeFilter]);

  if (!show) return null;

  const panelStyle =
    position.x !== null
      ? {
          position: 'fixed',
          left: position.x,
          top: position.y,
        }
      : {};

  // Count TFRs for badge
  const tfrCount = notams?.filter((n) => n.type === 'TFR').length || 0;

  return (
    <aside className="notam-panel pro-style" style={panelStyle} aria-label="NOTAMs panel">
      {/* Drag handle header */}
      <div
        className="notam-panel-header"
        onMouseDown={handleMouseDown}
        role="toolbar"
        aria-label="NOTAM panel controls"
      >
        <div className="notam-panel-drag-handle">
          <GripHorizontal size={16} />
        </div>

        <div className="notam-panel-title">
          <FileWarning size={16} />
          <span>NOTAMs</span>
          {unacknowledgedCount > 0 && (
            <span className="notam-count-badge">{unacknowledgedCount}</span>
          )}
          {tfrCount > 0 && <span className="tfr-count-badge">{tfrCount} TFR</span>}
        </div>

        <div className="notam-panel-actions">
          <button
            className="notam-panel-btn"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'spinning' : ''} />
          </button>
          <button className="notam-panel-btn close" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="notam-filter-bar">
        <select
          className="notam-filter-select"
          value={typeFilter || ''}
          onChange={(e) => setTypeFilter(e.target.value || null)}
        >
          {NOTAM_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <span className="notam-filter-count">
          {filteredNotams.length} {filteredNotams.length === 1 ? 'NOTAM' : 'NOTAMs'}
        </span>
      </div>

      {/* NOTAM list */}
      <div className="notam-list">
        {error && <div className="notam-error">{error}</div>}

        {!error && filteredNotams.length === 0 && (
          <div className="notam-empty">
            {loading ? 'Loading NOTAMs...' : 'No active NOTAMs in area'}
          </div>
        )}

        {filteredNotams.map((notam) => (
          <NotamItem
            key={notam.notam_id || notam.id}
            notam={notam}
            isAcknowledged={acknowledged?.has(notam.notam_id || notam.id)}
            onAcknowledge={(id) => {
              if (acknowledged?.has(id)) {
                onUnacknowledge?.(id);
              } else {
                onAcknowledge?.(id);
              }
            }}
            onShowOnMap={onShowOnMap}
            isHighlighted={selectedNotamId === (notam.notam_id || notam.id)}
          />
        ))}
      </div>
    </aside>
  );
}

export default NotamPanel;
