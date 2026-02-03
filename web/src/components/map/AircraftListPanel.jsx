import React, { useState, useMemo, memo } from 'react';
import { List, X, ChevronDown, ChevronUp, Search, Move, ArrowUp, ArrowDown } from 'lucide-react';
import { useDraggable } from '../../hooks/useDraggable';

/**
 * Draggable floating aircraft list panel on the map
 * Memoized to prevent re-renders when other map state changes
 */
export const AircraftListPanel = memo(
  function AircraftListPanel({
    aircraft,
    selectedHex,
    onSelectAircraft,
    show,
    onClose,
    expanded,
    onToggleExpanded,
    displayCount = 20,
    onLoadMore,
  }) {
    const [searchQuery, setSearchQuery] = useState('');
    const [sortField, setSortField] = useState('distance_nm');
    const [sortAsc, setSortAsc] = useState(true);
    const { position, isDragging, handleMouseDown } = useDraggable({ x: null, y: null });

    // Filter and sort aircraft
    const filteredAircraft = useMemo(() => {
      let filtered = [...aircraft];

      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(
          (ac) =>
            ac.hex?.toLowerCase().includes(q) ||
            ac.flight?.toLowerCase().includes(q) ||
            ac.type?.toLowerCase().includes(q) ||
            ac.squawk?.includes(q)
        );
      }

      filtered.sort((a, b) => {
        const aVal = a[sortField] ?? (sortAsc ? 999999 : -999999);
        const bVal = b[sortField] ?? (sortAsc ? 999999 : -999999);
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        }
        return sortAsc ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
      });

      return filtered;
    }, [aircraft, searchQuery, sortField, sortAsc]);

    const handleSort = (field) => {
      if (sortField === field) {
        setSortAsc(!sortAsc);
      } else {
        setSortField(field);
        setSortAsc(true);
      }
    };

    if (!show) return null;

    const listStyle =
      position.x !== null
        ? {
            position: 'fixed',
            left: position.x,
            top: position.y,
          }
        : {};

    return (
      <aside
        className={`aircraft-list-panel ${isDragging ? 'dragging' : ''}`}
        style={listStyle}
        aria-label="Aircraft list panel"
      >
        <div className="list-panel-header" role="toolbar" aria-label="Aircraft list controls" onMouseDown={handleMouseDown} onTouchStart={handleMouseDown}>
          <Move size={14} className="drag-handle" />
          <List size={16} />
          <span>Aircraft ({filteredAircraft.length})</span>
          <button className="list-expand-btn no-drag" onClick={onToggleExpanded}>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button className="list-close-btn no-drag" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {expanded && (
          <>
            <div className="list-search no-drag">
              <Search size={14} />
              <input
                type="text"
                placeholder="Search callsign, hex, type..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="list-table-header no-drag" role="row">
              <button
                type="button"
                className={`list-col callsign ${sortField === 'flight' ? 'sorted' : ''}`}
                onClick={() => handleSort('flight')}
                aria-label={`Sort by callsign ${sortField === 'flight' ? (sortAsc ? 'ascending' : 'descending') : ''}`}
              >
                Callsign
                {sortField === 'flight' &&
                  (sortAsc ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
              </button>
              <button
                type="button"
                className={`list-col altitude ${sortField === 'alt' ? 'sorted' : ''}`}
                onClick={() => handleSort('alt')}
                aria-label={`Sort by altitude ${sortField === 'alt' ? (sortAsc ? 'ascending' : 'descending') : ''}`}
              >
                Alt
                {sortField === 'alt' && (sortAsc ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
              </button>
              <button
                type="button"
                className={`list-col speed ${sortField === 'gs' ? 'sorted' : ''}`}
                onClick={() => handleSort('gs')}
                aria-label={`Sort by speed ${sortField === 'gs' ? (sortAsc ? 'ascending' : 'descending') : ''}`}
              >
                Spd
                {sortField === 'gs' && (sortAsc ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
              </button>
              <button
                type="button"
                className={`list-col distance ${sortField === 'distance_nm' ? 'sorted' : ''}`}
                onClick={() => handleSort('distance_nm')}
                aria-label={`Sort by distance ${sortField === 'distance_nm' ? (sortAsc ? 'ascending' : 'descending') : ''}`}
              >
                Dist
                {sortField === 'distance_nm' &&
                  (sortAsc ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
              </button>
            </div>

            <div className="list-content no-drag">
              {filteredAircraft.slice(0, displayCount).map((ac) => {
                const isSelected = ac.hex === selectedHex;
                const isEmergency = ac.emergency || ['7500', '7600', '7700'].includes(ac.squawk);

                return (
                  <div
                    key={ac.hex}
                    className={`aircraft-list-item ${isSelected ? 'selected' : ''} ${isEmergency ? 'emergency' : ''} ${ac.military ? 'military' : ''}`}
                    onClick={() => onSelectAircraft?.(ac.hex)}
                    onKeyDown={(e) => e.key === 'Enter' && onSelectAircraft?.(ac.hex)}
                    role="button"
                    tabIndex={0}
                    aria-label={`Select aircraft ${ac.flight?.trim() || ac.hex}`}
                  >
                    <div className="list-col callsign">
                      {ac.flight?.trim() || ac.hex}
                      {ac.military && <span className="mil-dot" />}
                    </div>
                    <div className="list-col altitude">
                      {ac.alt ? `${(ac.alt / 100).toFixed(0)}` : '--'}
                    </div>
                    <div className="list-col speed">{ac.gs?.toFixed(0) || '--'}</div>
                    <div className="list-col distance">{ac.distance_nm?.toFixed(1) || '--'}</div>
                  </div>
                );
              })}

              {filteredAircraft.length > displayCount && onLoadMore && (
                <button className="list-load-more" onClick={onLoadMore}>
                  Load more ({filteredAircraft.length - displayCount} remaining)
                </button>
              )}
            </div>
          </>
        )}
      </aside>
    );
  },
  (prev, next) => {
    // Custom comparison - only re-render for meaningful changes
    if (prev.show !== next.show) return false;
    if (prev.expanded !== next.expanded) return false;
    if (prev.selectedHex !== next.selectedHex) return false;
    if (prev.displayCount !== next.displayCount) return false;
    // Compare aircraft array length first (fast check)
    if (prev.aircraft?.length !== next.aircraft?.length) return false;
    // For aircraft data, we rely on the batching to reduce update frequency
    // A deeper comparison would be too expensive
    if (prev.aircraft !== next.aircraft) return false;
    return true;
  }
);

export default AircraftListPanel;
