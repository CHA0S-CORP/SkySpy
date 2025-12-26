import React from 'react';
import { 
  Plane, X, ArrowUp, ArrowDown, Minus, Navigation, 
  AlertTriangle, ExternalLink, Info
} from 'lucide-react';
import { useDraggable } from '../../hooks/useDraggable';
import { icaoToNNumber, getTailInfo } from '../../utils/aircraft';

/**
 * Popup showing selected aircraft details
 */
export function AircraftPopup({ 
  aircraft,
  aircraftInfo,
  onClose,
  onShowDetails,
  mapMode = 'crt',
  getDistanceNm,
  getBearing
}) {
  const { position, isDragging, handleMouseDown } = useDraggable({ x: 16, y: 16 });

  if (!aircraft) return null;

  const tailInfo = getTailInfo(aircraft);
  const vs = aircraft.baro_rate || aircraft.geom_rate || 0;
  const emergencySquawks = { '7500': 'HIJACK', '7600': 'RADIO', '7700': 'EMERGENCY' };
  const isEmergency = aircraft.emergency || emergencySquawks[aircraft.squawk];
  
  const distanceNm = getDistanceNm?.(aircraft.lat, aircraft.lon) ?? aircraft.distance_nm;
  const bearing = getBearing?.(aircraft.lat, aircraft.lon);

  const popupStyle = {
    left: position.x,
    top: position.y,
  };

  return (
    <div 
      className={`aircraft-popup ${mapMode === 'pro' ? 'pro-popup' : 'crt-popup'} ${isDragging ? 'dragging' : ''} ${isEmergency ? 'emergency' : ''}`}
      style={popupStyle}
      onMouseDown={handleMouseDown}
      onTouchStart={handleMouseDown}
    >
      <button className="popup-close no-drag" onClick={onClose}>
        <X size={16} />
      </button>
      
      <div className="popup-header">
        <Plane size={20} />
        <span className="popup-callsign">
          {aircraft.flight?.trim() || aircraft.hex}
        </span>
        {aircraft.military && <span className="mil-badge">MIL</span>}
        {isEmergency && (
          <span className="emergency-badge">
            <AlertTriangle size={14} />
            {emergencySquawks[aircraft.squawk] || 'EMER'}
          </span>
        )}
      </div>
      
      <div className="popup-details">
        {/* Identification */}
        <div className="detail-row">
          <span>ICAO</span>
          <span className="mono">{aircraft.hex?.toUpperCase()}</span>
        </div>
        
        {tailInfo && (
          <div className="detail-row">
            <span>Tail</span>
            <span>{tailInfo}</span>
          </div>
        )}
        
        {aircraft.type && (
          <div className="detail-row">
            <span>Type</span>
            <span>{aircraft.type}</span>
          </div>
        )}
        
        {aircraftInfo?.typeLong && (
          <div className="detail-row">
            <span>Model</span>
            <span>{aircraftInfo.typeLong}</span>
          </div>
        )}
        
        {aircraftInfo?.operator && (
          <div className="detail-row">
            <span>Operator</span>
            <span>{aircraftInfo.operator}</span>
          </div>
        )}
        
        {/* Position */}
        <div className="detail-section-divider" />
        
        <div className="detail-row">
          <span>Altitude</span>
          <span className="altitude-value">
            {aircraft.alt?.toLocaleString() || aircraft.baro_alt?.toLocaleString() || '---'} ft
            {vs !== 0 && (
              <span className={`vs-indicator ${vs > 0 ? 'climbing' : 'descending'}`}>
                {vs > 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                {Math.abs(vs).toLocaleString()} fpm
              </span>
            )}
          </span>
        </div>
        
        <div className="detail-row">
          <span>Speed</span>
          <span>{aircraft.gs?.toFixed(0) || aircraft.tas?.toFixed(0) || '---'} kts</span>
        </div>
        
        <div className="detail-row">
          <span>Heading</span>
          <span>
            <Navigation size={12} style={{ transform: `rotate(${aircraft.track || aircraft.true_heading || 0}deg)` }} />
            {' '}{(aircraft.track || aircraft.true_heading || 0).toFixed(0)}°
          </span>
        </div>
        
        {distanceNm !== undefined && (
          <div className="detail-row">
            <span>Distance</span>
            <span>{distanceNm.toFixed(1)} nm</span>
          </div>
        )}
        
        {bearing !== undefined && (
          <div className="detail-row">
            <span>Bearing</span>
            <span>{Math.round(bearing)}°</span>
          </div>
        )}
        
        {/* Transponder */}
        {aircraft.squawk && (
          <>
            <div className="detail-section-divider" />
            <div className="detail-row">
              <span>Squawk</span>
              <span className={`squawk-value ${emergencySquawks[aircraft.squawk] ? 'emergency' : ''}`}>
                {aircraft.squawk}
                {emergencySquawks[aircraft.squawk] && ` (${emergencySquawks[aircraft.squawk]})`}
              </span>
            </div>
          </>
        )}
        
        {/* Position coordinates */}
        {aircraft.lat && aircraft.lon && (
          <div className="detail-row">
            <span>Position</span>
            <span className="mono">
              {aircraft.lat.toFixed(4)}°, {aircraft.lon.toFixed(4)}°
            </span>
          </div>
        )}
      </div>
      
      <div className="popup-actions">
        {onShowDetails && (
          <button className="popup-action-btn no-drag" onClick={() => onShowDetails(aircraft.hex)}>
            <Info size={14} />
            Details
          </button>
        )}
        <a 
          href={`https://flightaware.com/live/flight/${aircraft.flight?.trim() || aircraft.hex}`}
          target="_blank"
          rel="noopener noreferrer"
          className="popup-action-btn no-drag"
        >
          <ExternalLink size={14} />
          FlightAware
        </a>
        <a 
          href={`https://globe.adsbexchange.com/?icao=${aircraft.hex}`}
          target="_blank"
          rel="noopener noreferrer"
          className="popup-action-btn no-drag"
        >
          <ExternalLink size={14} />
          ADSBx
        </a>
      </div>
    </div>
  );
}

export default AircraftPopup;
