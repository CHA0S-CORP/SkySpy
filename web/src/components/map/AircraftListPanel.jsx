import React, { useState, useMemo } from 'react';
import { List, X, ChevronDown, ChevronUp, Search, Move, ArrowUp, ArrowDown } from 'lucide-react';
import { useDraggable } from '../../hooks/useDraggable';

/**
 * Draggable floating aircraft list panel on the map
 */
export function AircraftListPanel({ 
  aircraft,
  selectedHex,
  onSelectAircraft,
  show,
  onClose,
  expanded,
  onToggleExpanded,
  displayCount = 20,
  onLoadMore
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
      filtered = filtered.filter(ac =>
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

  const listStyle = position.x !== null ? {
    position: 'fixed',
    left: position.x,
    top: position.y,
  } : {};

  return (
    <div 
      className={`aircraft-list-panel ${isDragging ? 'dragging' : ''}`}
      style={listStyle}
      onMouseDown={handleMouseDown}
      onTouchStart={handleMouseDown}
    >
      <div className="list-panel-header">
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
          
          <div className="list-table-header no-drag">
            <div 
              className={`list-col callsign ${sortField === 'flight' ? 'sorted' : ''}`}
              onClick={() => handleSort('flight')}
            >
              Callsign
              {sortField === 'flight' && (sortAsc ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
            </div>
            <div 
              className={`list-col altitude ${sortField === 'alt' ? 'sorted' : ''}`}
              onClick={() => handleSort('alt')}
            >
              Alt
              {sortField === 'alt' && (sortAsc ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
            </div>
            <div 
              className={`list-col speed ${sortField === 'gs' ? 'sorted' : ''}`}
              onClick={() => handleSort('gs')}
            >
              Spd
              {sortField === 'gs' && (sortAsc ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
            </div>
            <div 
              className={`list-col distance ${sortField === 'distance_nm' ? 'sorted' : ''}`}
              onClick={() => handleSort('distance_nm')}
            >
              Dist
              {sortField === 'distance_nm' && (sortAsc ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
            </div>
          </div>
          
          <div className="list-content no-drag">
            {filteredAircraft.slice(0, displayCount).map(ac => {
              const isSelected = ac.hex === selectedHex;
              const isEmergency = ac.emergency || ['7500', '7600', '7700'].includes(ac.squawk);
              
              return (
                <div 
                  key={ac.hex}
                  className={`aircraft-list-item ${isSelected ? 'selected' : ''} ${isEmergency ? 'emergency' : ''} ${ac.military ? 'military' : ''}`}
                  onClick={() => onSelectAircraft?.(ac.hex)}
                >
                  <div className="list-col callsign">
                    {ac.flight?.trim() || ac.hex}
                    {ac.military && <span className="mil-dot" />}
                  </div>
                  <div className="list-col altitude">
                    {ac.alt ? `${(ac.alt / 100).toFixed(0)}` : '--'}
                  </div>
                  <div className="list-col speed">
                    {ac.gs?.toFixed(0) || '--'}
                  </div>
                  <div className="list-col distance">
                    {ac.distance_nm?.toFixed(1) || '--'}
                  </div>
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
    </div>
  );
}

export default AircraftListPanel;
