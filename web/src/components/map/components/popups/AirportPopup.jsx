import React from 'react';
import { X, Plane, ExternalLink } from 'lucide-react';

/**
 * Airport popup component
 */
export function AirportPopup({
  airport,
  config,
  popupPosition,
  isDragging,
  onClose,
  onMouseDown,
  getDistanceNm,
  getBearing,
}) {
  if (!airport) return null;

  const airportCode = airport.icao || airport.icaoId || airport.faaId || airport.id || 'APT';

  return (
    <div
      className={`weather-popup airport-popup ${config.mapMode === 'pro' ? 'pro-popup' : 'crt-popup'} ${isDragging ? 'dragging' : ''}`}
      style={{ left: popupPosition.x, top: popupPosition.y }}
      onMouseDown={onMouseDown}
    >
      <button className="popup-close" onClick={onClose}>
        <X size={16} />
      </button>
      <div className="popup-header">
        <Plane size={20} />
        <span className="popup-callsign">{airportCode}</span>
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

        <div className="detail-row">
          <span>Distance</span>
          <span>{getDistanceNm(airport.lat, airport.lon).toFixed(1)} nm</span>
        </div>

        <div className="detail-row">
          <span>Bearing</span>
          <span>{Math.round(getBearing(airport.lat, airport.lon))}°</span>
        </div>

        {/* External links */}
        <div className="detail-row lookup-section">
          <span>LOOKUP:</span>
          <div className="lookup-links">
            <a href={`https://www.airnav.com/airport/${airportCode}`} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={12} /> AirNav
            </a>
            <a href={`https://skyvector.com/airport/${airportCode}`} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={12} /> SkyVector
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
