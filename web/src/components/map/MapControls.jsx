import React from 'react';
import { 
  ZoomIn, ZoomOut, Maximize, Minimize, 
  Layers, Filter, List, Info, Volume2, VolumeX,
  MessageCircle, Target
} from 'lucide-react';

/**
 * Map control buttons (zoom, fullscreen, toggles)
 */
export function MapControls({ 
  onZoomIn,
  onZoomOut,
  onToggleFullscreen,
  isFullscreen,
  onToggleOverlays,
  showOverlays,
  onToggleFilters,
  showFilters,
  onToggleAircraftList,
  showAircraftList,
  onToggleLegend,
  showLegend,
  onToggleAcars,
  showAcars,
  onToggleMute,
  soundMuted,
  onCenterOnFeeder,
  radarRange,
  onRangeChange,
  showRangeControl,
  mapMode = 'crt'
}) {
  return (
    <>
      {/* Main control buttons - top right */}
      <div className={`map-controls ${mapMode}`}>
        <button 
          className="map-control-btn"
          onClick={onZoomIn}
          title="Zoom In"
        >
          <ZoomIn size={18} />
        </button>
        
        <button 
          className="map-control-btn"
          onClick={onZoomOut}
          title="Zoom Out"
        >
          <ZoomOut size={18} />
        </button>
        
        <div className="control-divider" />
        
        <button 
          className="map-control-btn"
          onClick={onCenterOnFeeder}
          title="Center on Receiver"
        >
          <Target size={18} />
        </button>
        
        <button 
          className={`map-control-btn ${isFullscreen ? 'active' : ''}`}
          onClick={onToggleFullscreen}
          title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
        </button>
        
        <div className="control-divider" />
        
        <button 
          className={`map-control-btn ${showOverlays ? 'active' : ''}`}
          onClick={onToggleOverlays}
          title="Map Overlays"
        >
          <Layers size={18} />
        </button>
        
        <button 
          className={`map-control-btn ${showFilters ? 'active' : ''}`}
          onClick={onToggleFilters}
          title="Traffic Filters"
        >
          <Filter size={18} />
        </button>
        
        <button 
          className={`map-control-btn ${showAircraftList ? 'active' : ''}`}
          onClick={onToggleAircraftList}
          title="Aircraft List"
        >
          <List size={18} />
        </button>
        
        <button 
          className={`map-control-btn ${showLegend ? 'active' : ''}`}
          onClick={onToggleLegend}
          title="Legend"
        >
          <Info size={18} />
        </button>
        
        <div className="control-divider" />
        
        <button 
          className={`map-control-btn ${showAcars ? 'active' : ''}`}
          onClick={onToggleAcars}
          title="ACARS Messages"
        >
          <MessageCircle size={18} />
        </button>
        
        <button 
          className={`map-control-btn ${soundMuted ? 'muted' : ''}`}
          onClick={onToggleMute}
          title={soundMuted ? 'Unmute Alarms' : 'Mute Alarms'}
        >
          {soundMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
      </div>
      
      {/* Range slider - bottom center */}
      <div className={`range-control ${showRangeControl ? 'visible' : ''}`}>
        <span className="range-label">Range</span>
        <input 
          type="range"
          min={10}
          max={250}
          value={radarRange}
          onChange={(e) => onRangeChange?.(parseInt(e.target.value))}
          className="range-slider"
        />
        <span className="range-value">{radarRange} nm</span>
      </div>
    </>
  );
}

export default MapControls;
