import React from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';

/**
 * LegendPanel component - displays symbol legend for CRT/Pro modes
 */
export function LegendPanel({
  config,
  showLegend,
  setShowLegend,
  legendCollapsed,
  setLegendCollapsed,
  legendPosition,
  isLegendDragging,
  handleLegendMouseDown,
  legendDragStartRef,
}) {
  if (!showLegend) return null;
  if (config.mapMode !== 'crt' && config.mapMode !== 'pro') return null;

  return (
    <div
      className={`legend-panel ${config.mapMode === 'pro' ? 'pro-style' : ''} ${isLegendDragging ? 'dragging' : ''} ${legendCollapsed ? 'collapsed' : ''}`}
      style={legendPosition.x !== null ? {
        left: legendPosition.x,
        top: legendPosition.y,
        right: 'auto',
        bottom: 'auto'
      } : {}}
      onMouseDown={handleLegendMouseDown}
      onTouchStart={(e) => {
        if (e.target.closest('button')) return;
        const touch = e.touches[0];
        const rect = e.currentTarget.getBoundingClientRect();
        legendDragStartRef.current = {
          x: touch.clientX,
          y: touch.clientY,
          startX: legendPosition.x ?? rect.left,
          startY: legendPosition.y ?? rect.top
        };
      }}
    >
      <div className="legend-header">
        <span>Symbol Legend</span>
        <div className="legend-header-buttons">
          <button onClick={() => setLegendCollapsed(!legendCollapsed)} title={legendCollapsed ? 'Expand' : 'Collapse'}>
            {legendCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          <button onClick={() => setShowLegend(false)} title="Close"><X size={14} /></button>
        </div>
      </div>

      {!legendCollapsed && (
        <>
          <div className="legend-section">
            <div className="legend-section-title">Flight Categories (METAR)</div>
            <div className="legend-item">
              <span className="legend-symbol metar-vfr">*</span>
              <span>VFR - Visual (good visibility)</span>
            </div>
            <div className="legend-item">
              <span className="legend-symbol metar-mvfr">*</span>
              <span>MVFR - Marginal Visual</span>
            </div>
            <div className="legend-item">
              <span className="legend-symbol metar-ifr">*</span>
              <span>IFR - Instrument Required</span>
            </div>
            <div className="legend-item">
              <span className="legend-symbol metar-lifr">*</span>
              <span>LIFR - Low Instrument</span>
            </div>
          </div>

          <div className="legend-section">
            <div className="legend-section-title">PIREP Types</div>
            <div className="legend-item">
              <span className="legend-symbol pirep-routine">*</span>
              <span>Routine Report</span>
            </div>
            <div className="legend-item">
              <span className="legend-symbol pirep-turb">*</span>
              <span>Turbulence</span>
            </div>
            <div className="legend-item">
              <span className="legend-symbol pirep-ice">*</span>
              <span>Icing</span>
            </div>
            <div className="legend-item">
              <span className="legend-symbol pirep-both">*</span>
              <span>Turbulence + Icing</span>
            </div>
            <div className="legend-item">
              <span className="legend-symbol pirep-ws">*</span>
              <span>Wind Shear</span>
            </div>
            <div className="legend-item">
              <span className="legend-symbol pirep-urgent">*</span>
              <span>Urgent (UUA)</span>
            </div>
          </div>

          <div className="legend-section">
            <div className="legend-section-title">Aircraft</div>
            <div className="legend-item">
              <span className="legend-symbol aircraft-normal">^</span>
              <span>Normal Traffic</span>
            </div>
            <div className="legend-item">
              <span className="legend-symbol aircraft-military">^</span>
              <span>Military</span>
            </div>
            <div className="legend-item">
              <span className="legend-symbol aircraft-emergency">^</span>
              <span>Emergency (7500/7600/7700)</span>
            </div>
            <div className="legend-item">
              <span className="legend-symbol aircraft-conflict">^</span>
              <span>Traffic Conflict</span>
            </div>
          </div>

          <div className="legend-section">
            <div className="legend-section-title">Navigation</div>
            <div className="legend-item">
              <span className="legend-symbol nav-vor">o</span>
              <span>VOR/DME</span>
            </div>
            <div className="legend-item">
              <span className="legend-symbol nav-airport">+</span>
              <span>Airport</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
