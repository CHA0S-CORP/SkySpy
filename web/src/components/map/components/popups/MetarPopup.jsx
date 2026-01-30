import React from 'react';
import { X, MapPin, Navigation } from 'lucide-react';
import { decodeMetar, windDirToCardinal } from '../../../../utils';

/**
 * METAR weather popup component
 */
export function MetarPopup({
  metar,
  config,
  popupPosition,
  isDragging,
  onClose,
  onMouseDown,
}) {
  if (!metar) return null;

  const decoded = decodeMetar(metar);

  return (
    <div
      className={`weather-popup ${config.mapMode === 'pro' ? 'pro-popup' : 'crt-popup'} ${isDragging ? 'dragging' : ''}`}
      style={{ left: popupPosition.x, top: popupPosition.y }}
      onMouseDown={onMouseDown}
    >
      <button className="popup-close" onClick={onClose}>
        <X size={16} />
      </button>
      <div className="popup-header">
        <MapPin size={20} />
        <span className="popup-callsign">{metar.stationId || metar.icaoId || 'METAR'}</span>
        <span className={`flt-cat-badge ${(metar.fltCat || 'VFR').toLowerCase()}`}>
          {metar.fltCat || 'VFR'}
        </span>
      </div>
      <div className="popup-details">
        {metar.name && (
          <div className="detail-row"><span>Name</span><span>{metar.name}</span></div>
        )}

        {/* Flight Category with explanation */}
        <div className="detail-row decoded-section">
          <span>Conditions</span>
          <div className="decoded-value">
            <strong>{decoded?.flightCategory || 'VFR'}</strong>
            <span className="decoded-desc">{decoded?.flightCategoryDesc}</span>
          </div>
        </div>

        {/* Temperature with description */}
        {decoded?.temperature && (
          <div className="detail-row decoded-section">
            <span>Temperature</span>
            <div className="decoded-value">
              <strong>{decoded.temperature.celsius}°C / {decoded.temperature.fahrenheit}°F</strong>
              <span className="decoded-desc">{decoded.temperature.description}</span>
            </div>
          </div>
        )}

        {/* Dewpoint with fog risk */}
        {decoded?.dewpoint && (
          <div className="detail-row decoded-section">
            <span>Dewpoint</span>
            <div className="decoded-value">
              <strong>{decoded.dewpoint.celsius}°C</strong>
              {decoded.dewpoint.spread !== undefined && (
                <span className="decoded-desc">
                  Spread: {decoded.dewpoint.spread}°C - {decoded.dewpoint.fogRisk}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Wind with description */}
        {decoded?.wind && (
          <div className="detail-row decoded-section">
            <span className="section-icon"><Navigation size={14} /> Wind</span>
            <div className="decoded-value">
              <strong>{windDirToCardinal(decoded.wind.direction)} {decoded.wind.text}</strong>
              <span className="decoded-desc">{decoded.wind.description}</span>
            </div>
          </div>
        )}

        {/* Visibility with description */}
        {decoded?.visibility && (
          <div className="detail-row decoded-section">
            <span>Visibility</span>
            <div className="decoded-value">
              <strong>{decoded.visibility.value} {decoded.visibility.unit}</strong>
              <span className="decoded-desc">{decoded.visibility.description}</span>
            </div>
          </div>
        )}

        {/* Altimeter with description */}
        {decoded?.altimeter && (
          <div className="detail-row decoded-section">
            <span>Altimeter</span>
            <div className="decoded-value">
              <strong>{decoded.altimeter.inhg}" Hg</strong>
              <span className="decoded-desc">{decoded.altimeter.description}</span>
            </div>
          </div>
        )}

        {/* Clouds with decoded descriptions */}
        {decoded?.clouds && decoded.clouds.length > 0 && (
          <div className="detail-row decoded-section">
            <span>Clouds</span>
            <div className="decoded-value cloud-layers">
              {decoded.clouds.map((c, i) => (
                <div key={i} className="cloud-layer">
                  <strong>{c.cover} @ {c.baseDesc}</strong>
                  <span className="decoded-desc">{c.coverDesc}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Weather phenomena */}
        {decoded?.weather && decoded.weather.length > 0 && (
          <div className="detail-row decoded-section wx-section">
            <span>Weather</span>
            <div className="decoded-value">
              {decoded.weather.map((w, i) => (
                <div key={i} className="wx-item">
                  <strong>{w.code}</strong>
                  <span className="decoded-desc">{w.description}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Raw METAR */}
        {metar.rawOb && (
          <div className="detail-row raw-section">
            <span>Raw METAR</span>
            <span className="mono raw-text">{metar.rawOb}</span>
          </div>
        )}

        <div className="detail-row">
          <span>Observed</span>
          <span>{decoded?.time || '--'}</span>
        </div>
      </div>
    </div>
  );
}
