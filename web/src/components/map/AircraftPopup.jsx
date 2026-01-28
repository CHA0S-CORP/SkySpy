import React, { useRef, useEffect, useCallback } from 'react';
import {
  Plane, X, ArrowUp, ArrowDown, Navigation,
  AlertTriangle, ExternalLink, Info, Crosshair,
  TrendingDown, TrendingUp, Minus
} from 'lucide-react';
import { useDraggable } from '../../hooks/useDraggable';
import { getTailInfo } from '../../utils/aircraft';

/**
 * Get signal strength class based on RSSI value
 * RSSI typically ranges from about -20 (excellent) to -50 (poor) dBFS
 */
function getSignalStrengthClass(rssi) {
  if (rssi > -20) return 'excellent';
  if (rssi > -30) return 'good';
  if (rssi > -40) return 'fair';
  return 'weak';
}

/**
 * Signal bars component for RSSI visualization
 * Uses same CSS-based bars as history sessions
 */
function SignalBars({ rssi }) {
  const strengthClass = getSignalStrengthClass(rssi);

  return (
    <span className="signal-indicator-inline" title={`RSSI: ${rssi} dBm`}>
      <span className={`signal-bars ${strengthClass}`}>
        <span className="bar bar-1"></span>
        <span className="bar bar-2"></span>
        <span className="bar bar-3"></span>
        <span className="bar bar-4"></span>
      </span>
      <span className="signal-value">{rssi?.toFixed(0)} dB</span>
    </span>
  );
}

/**
 * Get color class for speed based on value and altitude
 */
function getSpeedColorClass(speed, altitude) {
  if (!speed) return '';

  // Check for speed limit violation (250 kts below 10,000 ft in US airspace)
  const isBelowTransition = altitude && altitude < 10000;
  const isOverLimit = isBelowTransition && speed > 250;

  if (isOverLimit) return 'speed-violation';
  if (speed > 500) return 'speed-high';
  if (speed > 300) return 'speed-medium';
  return 'speed-normal';
}

/**
 * Get color class for altitude
 */
function getAltitudeColorClass(altitude) {
  if (!altitude) return '';
  if (altitude >= 40000) return 'alt-fl400';
  if (altitude >= 30000) return 'alt-fl300';
  if (altitude >= 20000) return 'alt-fl200';
  if (altitude >= 10000) return 'alt-fl100';
  if (altitude >= 5000) return 'alt-5k';
  return 'alt-low';
}

/**
 * Popup showing selected aircraft details
 */
export function AircraftPopup({
  aircraft,
  aircraftInfo,
  onClose,
  onShowDetails,
  onJumpTo,
  mapMode = 'crt',
  getDistanceNm,
  getBearing,
  trackHistory
}) {
  const { position, isDragging, handleMouseDown } = useDraggable({ x: 100, y: 100 });
  const prevDistanceRef = useRef(null);
  const distanceTrendRef = useRef(null); // 'approaching', 'receding', or 'stable'
  const popupRef = useRef(null);
  const titleId = `aircraft-popup-title-${aircraft?.hex || 'unknown'}`;

  // Handle Escape key to close popup
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      onClose?.();
    }
  }, [onClose]);

  // Add Escape key listener and auto-focus on open
  useEffect(() => {
    if (aircraft && popupRef.current) {
      popupRef.current.focus();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [aircraft, handleKeyDown]);

  if (!aircraft) return null;

  const tailInfo = getTailInfo(aircraft);
  const vs = aircraft.vr ?? aircraft.baro_rate ?? aircraft.geom_rate ?? 0;
  const emergencySquawks = { '7500': 'HIJACK', '7600': 'RADIO', '7700': 'EMERGENCY' };
  const isEmergency = aircraft.emergency || emergencySquawks[aircraft.squawk];

  const distanceNm = getDistanceNm?.(aircraft.lat, aircraft.lon) ?? aircraft.distance_nm;
  const bearing = getBearing?.(aircraft.lat, aircraft.lon);

  // Track distance trend
  if (distanceNm !== undefined && prevDistanceRef.current !== null) {
    const delta = distanceNm - prevDistanceRef.current;
    if (Math.abs(delta) > 0.05) { // threshold to avoid noise
      distanceTrendRef.current = delta < 0 ? 'approaching' : 'receding';
    } else {
      distanceTrendRef.current = 'stable';
    }
  }
  prevDistanceRef.current = distanceNm;

  const distanceTrend = distanceTrendRef.current;

  // Get speed and altitude values
  const speed = aircraft.gs ?? aircraft.tas;
  const altitude = aircraft.alt ?? aircraft.baro_alt;
  const speedClass = getSpeedColorClass(speed, altitude);
  const altClass = getAltitudeColorClass(altitude);

  // RSSI value (signal strength)
  const rssi = aircraft.rssi;

  const popupStyle = {
    left: position.x,
    top: position.y,
  };

  return (
    <div
      ref={popupRef}
      className={`aircraft-popup ${mapMode === 'pro' ? 'pro-popup' : 'crt-popup'} ${isDragging ? 'dragging' : ''} ${isEmergency ? 'emergency' : ''}`}
      style={popupStyle}
      onMouseDown={handleMouseDown}
      onTouchStart={handleMouseDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      <button className="popup-close no-drag" onClick={onClose} aria-label="Close popup">
        <X size={16} />
      </button>

      <div className="popup-header">
        <Plane size={20} aria-hidden="true" />
        <span id={titleId} className="popup-callsign">
          {aircraft.flight?.trim() || aircraft.hex}
        </span>
        {(aircraftInfo?.typeLong || aircraft.type) && (
          <span className={`model-tag ${aircraft.military ? 'military' : ''}`}>{aircraftInfo?.typeLong || aircraft.type}</span>
        )}
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
        
        {tailInfo?.tailNumber && (
          <div className="detail-row">
            <span>Tail</span>
            <span>{tailInfo.tailNumber}</span>
          </div>
        )}

        {tailInfo?.country && (
          <div className="detail-row">
            <span>Reg</span>
            <span>{tailInfo.country}</span>
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
          <span className={`altitude-value ${altClass}`}>
            {altitude?.toLocaleString() || '---'} ft
            {vs !== 0 && (
              <span className={`vs-indicator ${vs > 0 ? 'climbing' : 'descending'} ${Math.abs(vs) > 3000 ? 'extreme-vs' : ''}`}>
                {vs > 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                {Math.abs(vs).toLocaleString()} fpm
              </span>
            )}
          </span>
        </div>

        <div className="detail-row">
          <span>Speed</span>
          <span className={`speed-value ${speedClass}`}>
            {speed?.toFixed(0) || '---'} kts
          </span>
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
            <span className={`distance-value ${distanceTrend || ''}`}>
              {distanceTrend === 'approaching' && <TrendingDown size={12} className="trend-icon approaching" />}
              {distanceTrend === 'receding' && <TrendingUp size={12} className="trend-icon receding" />}
              {distanceTrend === 'stable' && <Minus size={12} className="trend-icon stable" />}
              {distanceNm.toFixed(1)} nm
            </span>
          </div>
        )}
        
        {bearing !== undefined && (
          <div className="detail-row">
            <span>Bearing</span>
            <span>{Math.round(bearing)}°</span>
          </div>
        )}

        {trackHistory?.length > 0 && (
          <div className="detail-row">
            <span>Track Pts</span>
            <span>{trackHistory.length}</span>
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

        {/* Signal strength */}
        {rssi !== undefined && (
          <div className="detail-row">
            <span>Signal</span>
            <SignalBars rssi={rssi} />
          </div>
        )}
      </div>
      
      <div className="popup-actions">
        {onJumpTo && (
          <button className="popup-action-btn no-drag" onClick={() => onJumpTo(aircraft)}>
            <Crosshair size={14} />
            Jump
          </button>
        )}
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
