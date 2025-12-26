import React from 'react';
import { Info, ChevronDown, ChevronUp, X, Move } from 'lucide-react';
import { useDraggable } from '../../hooks/useDraggable';

/**
 * Draggable legend panel showing aircraft symbols and color meanings
 */
export function LegendPanel({ 
  show, 
  onClose,
  collapsed,
  onToggleCollapsed,
  mapMode = 'crt'
}) {
  const { position, isDragging, handleMouseDown } = useDraggable({ x: null, y: null });

  if (!show) return null;

  const legendStyle = position.x !== null ? {
    position: 'fixed',
    left: position.x,
    top: position.y,
  } : {};

  return (
    <div 
      className={`legend-panel ${mapMode === 'pro' ? 'pro-legend' : 'crt-legend'} ${isDragging ? 'dragging' : ''}`}
      style={legendStyle}
      onMouseDown={handleMouseDown}
      onTouchStart={handleMouseDown}
    >
      <div className="legend-header">
        <Move size={14} className="drag-handle" />
        <Info size={16} />
        <span>Legend</span>
        <button 
          className="legend-collapse-btn"
          onClick={onToggleCollapsed}
        >
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
        <button className="legend-close-btn" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      
      {!collapsed && (
        <div className="legend-content">
          <div className="legend-section">
            <div className="legend-section-title">Aircraft Types</div>
            <div className="legend-item">
              <div className="legend-symbol aircraft-civil">▲</div>
              <span>Civil Aircraft</span>
            </div>
            <div className="legend-item">
              <div className="legend-symbol aircraft-military">▲</div>
              <span>Military Aircraft</span>
            </div>
            <div className="legend-item">
              <div className="legend-symbol aircraft-ground">▲</div>
              <span>Ground Vehicle</span>
            </div>
            <div className="legend-item">
              <div className="legend-symbol aircraft-helicopter">●</div>
              <span>Helicopter/Rotorcraft</span>
            </div>
          </div>
          
          <div className="legend-section">
            <div className="legend-section-title">Altitude Colors</div>
            <div className="legend-item">
              <div className="legend-color" style={{ background: '#00d4ff' }} />
              <span>High (FL350+)</span>
            </div>
            <div className="legend-item">
              <div className="legend-color" style={{ background: '#4ade80' }} />
              <span>Medium (FL180-350)</span>
            </div>
            <div className="legend-item">
              <div className="legend-color" style={{ background: '#facc15' }} />
              <span>Low (0-FL180)</span>
            </div>
            <div className="legend-item">
              <div className="legend-color" style={{ background: '#8a949e' }} />
              <span>Ground/Unknown</span>
            </div>
          </div>
          
          <div className="legend-section">
            <div className="legend-section-title">Special Status</div>
            <div className="legend-item">
              <div className="legend-symbol emergency">▲</div>
              <span>Emergency (7700)</span>
            </div>
            <div className="legend-item">
              <div className="legend-symbol hijack">▲</div>
              <span>Hijack (7500)</span>
            </div>
            <div className="legend-item">
              <div className="legend-symbol radio-fail">▲</div>
              <span>Radio Failure (7600)</span>
            </div>
            <div className="legend-item">
              <div className="legend-symbol selected">▲</div>
              <span>Selected Aircraft</span>
            </div>
          </div>
          
          <div className="legend-section">
            <div className="legend-section-title">Aviation Data</div>
            <div className="legend-item">
              <div className="legend-symbol navaid">◇</div>
              <span>VOR/NDB</span>
            </div>
            <div className="legend-item">
              <div className="legend-symbol airport">✈</div>
              <span>Airport</span>
            </div>
            <div className="legend-item">
              <div className="legend-symbol metar-vfr">●</div>
              <span>VFR Conditions</span>
            </div>
            <div className="legend-item">
              <div className="legend-symbol metar-mvfr">●</div>
              <span>MVFR Conditions</span>
            </div>
            <div className="legend-item">
              <div className="legend-symbol metar-ifr">●</div>
              <span>IFR Conditions</span>
            </div>
            <div className="legend-item">
              <div className="legend-symbol metar-lifr">●</div>
              <span>LIFR Conditions</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LegendPanel;
