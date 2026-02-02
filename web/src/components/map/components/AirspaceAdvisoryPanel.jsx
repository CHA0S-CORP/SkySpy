import React, { useMemo } from 'react';
import { AlertTriangle, X, GripHorizontal, RefreshCw } from 'lucide-react';
import { useDraggable } from '../../../hooks/useDraggable';
import { AirspaceAdvisoryItem } from './AirspaceAdvisoryItem';

// Available hazard filters
const HAZARD_FILTER_OPTIONS = [
  { value: '', label: 'All Hazards' },
  { value: 'TURB', label: 'Turbulence' },
  { value: 'ICE', label: 'Icing' },
  { value: 'TS', label: 'Thunderstorms' },
  { value: 'IFR', label: 'IFR Conditions' },
  { value: 'MT_OBSC', label: 'Mountain Obscuration' },
  { value: 'LLWS', label: 'Wind Shear' },
  { value: 'SFC_WND', label: 'Surface Wind' },
  { value: 'FZLVL', label: 'Freezing Level' },
];

/**
 * AirspaceAdvisoryPanel component - floating panel showing advisory list
 */
export function AirspaceAdvisoryPanel({
  show,
  onClose,
  advisories,
  loading,
  error,
  acknowledged,
  onAcknowledge,
  onUnacknowledge,
  onShowOnMap,
  onRefresh,
  hazardFilter,
  setHazardFilter,
  selectedAdvisoryId,
  unacknowledgedCount,
}) {
  // Draggable panel behavior
  const { position, handleMouseDown } = useDraggable(
    { x: null, y: null },
    { width: 340, height: 500 }
  );

  // Sort advisories: unacknowledged first, then by valid_to (soonest first)
  const sortedAdvisories = useMemo(() => {
    if (!advisories) return [];

    return [...advisories].sort((a, b) => {
      // Acknowledged items go to bottom
      const aAck = acknowledged?.has(a.id) ? 1 : 0;
      const bAck = acknowledged?.has(b.id) ? 1 : 0;
      if (aAck !== bAck) return aAck - bAck;

      // Sort by valid_to (soonest expiry first)
      const aTime = a.valid_to ? new Date(a.valid_to).getTime() : Infinity;
      const bTime = b.valid_to ? new Date(b.valid_to).getTime() : Infinity;
      return aTime - bTime;
    });
  }, [advisories, acknowledged]);

  // Filter by hazard type
  const filteredAdvisories = useMemo(() => {
    if (!hazardFilter) return sortedAdvisories;
    return sortedAdvisories.filter((adv) => adv.hazard === hazardFilter);
  }, [sortedAdvisories, hazardFilter]);

  if (!show) return null;

  const panelStyle =
    position.x !== null
      ? {
          position: 'fixed',
          left: position.x,
          top: position.y,
        }
      : {};

  return (
    <div className="advisory-panel pro-style" style={panelStyle}>
      {/* Drag handle header */}
      <div className="advisory-panel-header" onMouseDown={handleMouseDown}>
        <div className="advisory-panel-drag-handle">
          <GripHorizontal size={16} />
        </div>

        <div className="advisory-panel-title">
          <AlertTriangle size={16} />
          <span>AIRSPACE ADVISORIES</span>
          {unacknowledgedCount > 0 && (
            <span className="advisory-count-badge">{unacknowledgedCount}</span>
          )}
        </div>

        <div className="advisory-panel-actions">
          <button
            className="advisory-panel-btn"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'spinning' : ''} />
          </button>
          <button className="advisory-panel-btn close" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="advisory-filter-bar">
        <select
          className="advisory-filter-select"
          value={hazardFilter || ''}
          onChange={(e) => setHazardFilter(e.target.value || null)}
        >
          {HAZARD_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <span className="advisory-filter-count">
          {filteredAdvisories.length} {filteredAdvisories.length === 1 ? 'advisory' : 'advisories'}
        </span>
      </div>

      {/* Advisory list */}
      <div className="advisory-list">
        {error && <div className="advisory-error">{error}</div>}

        {!error && filteredAdvisories.length === 0 && (
          <div className="advisory-empty">
            {loading ? 'Loading advisories...' : 'No active advisories'}
          </div>
        )}

        {filteredAdvisories.map((advisory) => (
          <AirspaceAdvisoryItem
            key={advisory.id}
            advisory={advisory}
            isAcknowledged={acknowledged?.has(advisory.id)}
            onAcknowledge={(id) => {
              if (acknowledged?.has(id)) {
                onUnacknowledge?.(id);
              } else {
                onAcknowledge?.(id);
              }
            }}
            onShowOnMap={onShowOnMap}
            isHighlighted={selectedAdvisoryId === advisory.id}
          />
        ))}
      </div>
    </div>
  );
}

export default AirspaceAdvisoryPanel;
