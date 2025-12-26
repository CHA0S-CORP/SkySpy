import React from 'react';
import { 
  X, Cloud, Wind, Thermometer, Eye, Navigation, 
  Radio, Plane, ExternalLink, AlertTriangle, Snowflake
} from 'lucide-react';
import { useDraggable } from '../../hooks/useDraggable';
import { decodeMetar, decodePirep } from '../../utils/decoders';

// Helper to convert wind direction to cardinal
const windDirToCardinal = (deg) => {
  if (deg === null || deg === undefined) return '';
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
};

/**
 * METAR weather popup
 */
export function MetarPopup({ metar, onClose, mapMode, getDistanceNm, getBearing }) {
  const { position, isDragging, handleMouseDown } = useDraggable({ x: 16, y: 16 });
  
  if (!metar) return null;
  
  const decoded = decodeMetar(metar);

  return (
    <div 
      className={`weather-popup metar-popup ${mapMode === 'pro' ? 'pro-popup' : 'crt-popup'} ${isDragging ? 'dragging' : ''}`}
      style={{ left: position.x, top: position.y }}
      onMouseDown={handleMouseDown}
    >
      <button className="popup-close no-drag" onClick={onClose}>
        <X size={16} />
      </button>
      <div className="popup-header">
        <Cloud size={20} />
        <span className="popup-callsign">{metar.icaoId || metar.stationId || 'METAR'}</span>
        {decoded.flightCategory && (
          <span className={`flight-cat-badge ${decoded.flightCategory.toLowerCase()}`}>
            {decoded.flightCategory}
          </span>
        )}
      </div>
      
      <div className="popup-details">
        {decoded.time && (
          <div className="detail-row">
            <span>Observed</span>
            <span>{decoded.time}</span>
          </div>
        )}
        
        {decoded.wind && (
          <div className="detail-row">
            <span><Wind size={14} /> Wind</span>
            <span>
              {windDirToCardinal(decoded.wind.direction)} ({decoded.wind.direction}°) 
              at {decoded.wind.speed}kt
              {decoded.wind.gusts && ` G${decoded.wind.gusts}`}
            </span>
          </div>
        )}
        
        {decoded.visibility && (
          <div className="detail-row">
            <span><Eye size={14} /> Visibility</span>
            <span>{decoded.visibility.text}</span>
          </div>
        )}
        
        {decoded.clouds && decoded.clouds.length > 0 && (
          <div className="detail-row">
            <span><Cloud size={14} /> Clouds</span>
            <span>{decoded.clouds.map(c => c.text).join(', ')}</span>
          </div>
        )}
        
        {decoded.temperature !== null && (
          <div className="detail-row">
            <span><Thermometer size={14} /> Temp/Dew</span>
            <span>{decoded.temperature}°C / {decoded.dewpoint}°C</span>
          </div>
        )}
        
        {decoded.altimeter && (
          <div className="detail-row">
            <span>Altimeter</span>
            <span>{decoded.altimeter.text}</span>
          </div>
        )}
        
        {decoded.weather && (
          <div className="detail-row">
            <span>Weather</span>
            <span>{decoded.weather}</span>
          </div>
        )}
        
        {metar.rawOb && (
          <div className="detail-row raw-section">
            <span>Raw</span>
            <span className="mono raw-text">{metar.rawOb}</span>
          </div>
        )}
        
        {getDistanceNm && metar.lat && (
          <>
            <div className="detail-row">
              <span>Distance</span>
              <span>{getDistanceNm(metar.lat, metar.lon).toFixed(1)} nm</span>
            </div>
            <div className="detail-row">
              <span>Bearing</span>
              <span>{Math.round(getBearing(metar.lat, metar.lon))}°</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * PIREP popup
 */
export function PirepPopup({ pirep, onClose, mapMode, getDistanceNm, getBearing }) {
  const { position, isDragging, handleMouseDown } = useDraggable({ x: 16, y: 16 });
  
  if (!pirep) return null;
  
  const decoded = decodePirep(pirep);
  
  // Determine severity based on content
  const hasTurbulence = decoded?.turbulence?.level >= 2;
  const hasIcing = decoded?.icing?.level >= 2;
  const hasWindshear = decoded?.windshear;
  const isUrgent = decoded?.isUrgent || hasTurbulence || hasIcing || hasWindshear;

  return (
    <div 
      className={`weather-popup pirep-popup ${mapMode === 'pro' ? 'pro-popup' : 'crt-popup'} ${isDragging ? 'dragging' : ''} ${isUrgent ? 'urgent' : ''}`}
      style={{ left: position.x, top: position.y }}
      onMouseDown={handleMouseDown}
    >
      <button className="popup-close no-drag" onClick={onClose}>
        <X size={16} />
      </button>
      <div className="popup-header">
        <AlertTriangle size={20} />
        <span className="popup-callsign">{decoded?.location || pirep.icaoId || 'PIREP'}</span>
        <span className={`pirep-type-badge ${pirep.pirepType?.toLowerCase() || 'ua'}`}>
          {pirep.pirepType || 'UA'}
        </span>
      </div>
      
      <div className="popup-details">
        {decoded?.time && (
          <div className="detail-row">
            <span>Reported</span>
            <span>{decoded.time}</span>
          </div>
        )}
        
        {decoded?.aircraft && (
          <div className="detail-row">
            <span>Aircraft</span>
            <span>{decoded.aircraft}</span>
          </div>
        )}
        
        {decoded?.altitude && (
          <div className="detail-row">
            <span>Altitude</span>
            <span>{decoded.altitude.text}</span>
          </div>
        )}
        
        {decoded?.sky && (
          <div className="detail-row">
            <span>Sky</span>
            <span>{decoded.sky.description}</span>
          </div>
        )}
        
        {decoded?.turbulence && (
          <div className={`detail-row turb-section level-${decoded.turbulence.level}`}>
            <span><Wind size={14} /> Turbulence</span>
            <div>
              <strong>{decoded.turbulence.intensity}</strong>
              {decoded.turbulence.type && <span> - {decoded.turbulence.type}</span>}
            </div>
          </div>
        )}
        
        {decoded?.icing && (
          <div className={`detail-row icing-section level-${decoded.icing.level}`}>
            <span><Snowflake size={14} /> Icing</span>
            <div>
              <strong>{decoded.icing.intensity}</strong>
              {decoded.icing.type && <span> - {decoded.icing.type}</span>}
            </div>
          </div>
        )}
        
        {decoded?.windshear && (
          <div className={`detail-row ws-section level-${decoded.windshear.level}`}>
            <span><Wind size={14} /> Wind Shear</span>
            <div>
              <strong>{decoded.windshear.intensity}</strong>
              {decoded.windshear.altRange && <span> at {decoded.windshear.altRange}</span>}
            </div>
          </div>
        )}
        
        {decoded?.temperature && (
          <div className="detail-row">
            <span><Thermometer size={14} /> Temp</span>
            <span>{decoded.temperature.celsius}°C / {decoded.temperature.fahrenheit}°F</span>
          </div>
        )}
        
        {decoded?.wind && (
          <div className="detail-row">
            <span><Navigation size={14} /> Wind</span>
            <span>{windDirToCardinal(decoded.wind.direction)} at {decoded.wind.speed}kt</span>
          </div>
        )}
        
        {pirep.rawOb && (
          <div className="detail-row raw-section">
            <span>Raw</span>
            <span className="mono raw-text">{pirep.rawOb}</span>
          </div>
        )}
        
        {getDistanceNm && pirep.lat && (
          <div className="detail-row">
            <span>Distance</span>
            <span>{getDistanceNm(pirep.lat, pirep.lon).toFixed(1)} nm</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Navaid popup
 */
export function NavaidPopup({ navaid, onClose, mapMode, getDistanceNm, getBearing }) {
  const { position, isDragging, handleMouseDown } = useDraggable({ x: 16, y: 16 });
  
  if (!navaid) return null;

  return (
    <div 
      className={`weather-popup navaid-popup ${mapMode === 'pro' ? 'pro-popup' : 'crt-popup'} ${isDragging ? 'dragging' : ''}`}
      style={{ left: position.x, top: position.y }}
      onMouseDown={handleMouseDown}
    >
      <button className="popup-close no-drag" onClick={onClose}>
        <X size={16} />
      </button>
      <div className="popup-header">
        <Radio size={20} />
        <span className="popup-callsign">{navaid.id}</span>
        <span className="navaid-type-badge">{navaid.type || 'NAV'}</span>
      </div>
      
      <div className="popup-details">
        <div className="detail-row">
          <span>Type</span>
          <span>{navaid.type || 'Unknown'}</span>
        </div>
        
        {navaid.name && (
          <div className="detail-row">
            <span>Name</span>
            <span>{navaid.name}</span>
          </div>
        )}
        
        {navaid.freq && (
          <div className="detail-row">
            <span>Frequency</span>
            <span>{navaid.freq} MHz</span>
          </div>
        )}
        
        {navaid.channel && (
          <div className="detail-row">
            <span>Channel</span>
            <span>{navaid.channel}</span>
          </div>
        )}
        
        <div className="detail-row">
          <span>Position</span>
          <span>{navaid.lat?.toFixed(4)}°, {navaid.lon?.toFixed(4)}°</span>
        </div>
        
        {navaid.elev && (
          <div className="detail-row">
            <span>Elevation</span>
            <span>{navaid.elev.toLocaleString()} ft</span>
          </div>
        )}
        
        {getDistanceNm && (
          <>
            <div className="detail-row">
              <span>Distance</span>
              <span>{getDistanceNm(navaid.lat, navaid.lon).toFixed(1)} nm</span>
            </div>
            <div className="detail-row">
              <span>Bearing</span>
              <span>{Math.round(getBearing(navaid.lat, navaid.lon))}°</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Airport popup
 */
export function AirportPopup({ airport, onClose, mapMode, getDistanceNm, getBearing }) {
  const { position, isDragging, handleMouseDown } = useDraggable({ x: 16, y: 16 });
  
  if (!airport) return null;
  
  const icao = airport.icao || airport.icaoId || airport.faaId || airport.id || 'APT';

  return (
    <div 
      className={`weather-popup airport-popup ${mapMode === 'pro' ? 'pro-popup' : 'crt-popup'} ${isDragging ? 'dragging' : ''}`}
      style={{ left: position.x, top: position.y }}
      onMouseDown={handleMouseDown}
    >
      <button className="popup-close no-drag" onClick={onClose}>
        <X size={16} />
      </button>
      <div className="popup-header">
        <Plane size={20} />
        <span className="popup-callsign">{icao}</span>
        {airport.class && (
          <span className={`airport-class-badge class-${airport.class.toLowerCase()}`}>
            Class {airport.class}
          </span>
        )}
      </div>
      
      <div className="popup-details">
        {(airport.name || airport.site) && (
          <div className="detail-row">
            <span>Name</span>
            <span>{airport.name || airport.site}</span>
          </div>
        )}
        
        {(airport.city || airport.assocCity) && (
          <div className="detail-row">
            <span>City</span>
            <span>{airport.city || airport.assocCity}</span>
          </div>
        )}
        
        {(airport.state || airport.stateProv) && (
          <div className="detail-row">
            <span>State</span>
            <span>{airport.state || airport.stateProv}</span>
          </div>
        )}
        
        <div className="detail-row">
          <span>Position</span>
          <span>{airport.lat?.toFixed(4)}°, {airport.lon?.toFixed(4)}°</span>
        </div>
        
        {(airport.elev !== undefined && airport.elev !== null) || airport.elev_ft ? (
          <div className="detail-row">
            <span>Elevation</span>
            <span>{(airport.elev ?? airport.elev_ft).toLocaleString()} ft</span>
          </div>
        ) : null}
        
        {airport.rwy_length && (
          <div className="detail-row">
            <span>Longest Runway</span>
            <span>{airport.rwy_length.toLocaleString()} ft</span>
          </div>
        )}
        
        {getDistanceNm && (
          <>
            <div className="detail-row">
              <span>Distance</span>
              <span>{getDistanceNm(airport.lat, airport.lon).toFixed(1)} nm</span>
            </div>
            <div className="detail-row">
              <span>Bearing</span>
              <span>{Math.round(getBearing(airport.lat, airport.lon))}°</span>
            </div>
          </>
        )}
        
        <div className="detail-row lookup-section">
          <span>LOOKUP:</span>
          <div className="lookup-links no-drag">
            <a href={`https://www.airnav.com/airport/${icao}`} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={12} /> AirNav
            </a>
            <a href={`https://skyvector.com/airport/${icao}`} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={12} /> SkyVector
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export { windDirToCardinal };
