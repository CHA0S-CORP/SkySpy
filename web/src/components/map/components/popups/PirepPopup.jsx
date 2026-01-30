import React from 'react';
import { X, AlertTriangle, Wind, Snowflake, Thermometer, Navigation } from 'lucide-react';
import { decodePirep, windDirToCardinal } from '../../../../utils';

/**
 * PIREP (Pilot Report) popup component
 */
export function PirepPopup({
  pirep,
  config,
  popupPosition,
  isDragging,
  onClose,
  onMouseDown,
}) {
  if (!pirep) return null;

  const decoded = decodePirep(pirep);

  return (
    <div
      className={`weather-popup pirep-popup ${config.mapMode === 'pro' ? 'pro-popup' : 'crt-popup'} ${decoded?.type === 'UUA' ? 'urgent-pirep' : ''} ${isDragging ? 'dragging' : ''}`}
      style={{ left: popupPosition.x, top: popupPosition.y }}
      onMouseDown={onMouseDown}
    >
      <button className="popup-close" onClick={onClose}>
        <X size={16} />
      </button>
      <div className="popup-header">
        <AlertTriangle size={20} />
        <span className="popup-callsign">PIREP</span>
        <span className={`pirep-type-badge ${decoded?.type === 'UUA' ? 'urgent' : ''}`}>
          {decoded?.type || 'UA'}
        </span>
      </div>

      {/* Urgent warning banner */}
      {decoded?.type === 'UUA' && (
        <div className="urgent-banner">
          Warning: URGENT PILOT REPORT - Significant weather hazard
        </div>
      )}

      <div className="popup-details">
        {/* Location */}
        {decoded?.location && (
          <div className="detail-row">
            <span>Location</span>
            <span>{decoded.location}</span>
          </div>
        )}

        {/* Aircraft */}
        {decoded?.aircraft && (
          <div className="detail-row">
            <span>Aircraft</span>
            <span>{decoded.aircraft}</span>
          </div>
        )}

        {/* Altitude/Flight Level */}
        {decoded?.altitude && (
          <div className="detail-row decoded-section">
            <span>Altitude</span>
            <div className="decoded-value">
              <strong>{decoded.altitude.text}</strong>
            </div>
          </div>
        )}

        {/* Sky Condition */}
        {decoded?.sky && (
          <div className="detail-row decoded-section">
            <span>Sky</span>
            <div className="decoded-value">
              <strong>{decoded.sky.description}</strong>
            </div>
          </div>
        )}

        {/* Turbulence with full decoding */}
        {decoded?.turbulence && (
          <div className={`detail-row decoded-section turb-section level-${decoded.turbulence.level}`}>
            <span className="section-icon"><Wind size={14} /> Turbulence</span>
            <div className="decoded-value">
              <strong className="turb-intensity">{decoded.turbulence.intensity}</strong>
              {decoded.turbulence.type && (
                <span className="turb-type">{decoded.turbulence.type}</span>
              )}
              {decoded.turbulence.detail && (
                <span className="decoded-desc">{decoded.turbulence.detail}</span>
              )}
              {decoded.turbulence.warning && (
                <span className="hazard-warning">{decoded.turbulence.warning}</span>
              )}
            </div>
          </div>
        )}

        {/* Icing with full decoding */}
        {decoded?.icing && (
          <div className={`detail-row decoded-section icing-section level-${decoded.icing.level}`}>
            <span className="section-icon"><Snowflake size={14} /> Icing</span>
            <div className="decoded-value">
              <strong className="icing-intensity">{decoded.icing.intensity}</strong>
              {decoded.icing.type && (
                <span className="icing-type">{decoded.icing.type}</span>
              )}
              {decoded.icing.detail && (
                <span className="decoded-desc">{decoded.icing.detail}</span>
              )}
              {decoded.icing.warning && (
                <span className="hazard-warning">{decoded.icing.warning}</span>
              )}
            </div>
          </div>
        )}

        {/* Wind Shear / LLWS with full decoding */}
        {decoded?.windshear && (
          <div className={`detail-row decoded-section ws-section level-${decoded.windshear.level}`}>
            <span className="section-icon"><Wind size={14} /> Wind Shear</span>
            <div className="decoded-value">
              <strong className="ws-intensity">{decoded.windshear.intensity}</strong>
              {decoded.windshear.gainLoss && (
                <span className="ws-type">{decoded.windshear.gainLoss}</span>
              )}
              {decoded.windshear.altRange && (
                <span className="ws-type">at {decoded.windshear.altRange}</span>
              )}
              {decoded.windshear.detail && (
                <span className="decoded-desc">{decoded.windshear.detail}</span>
              )}
              {decoded.windshear.warning && (
                <span className="hazard-warning">{decoded.windshear.warning}</span>
              )}
            </div>
          </div>
        )}

        {/* Weather */}
        {decoded?.weather && (
          <div className="detail-row">
            <span>Weather</span>
            <span>{decoded.weather.description}</span>
          </div>
        )}

        {/* Temperature at altitude */}
        {decoded?.temperature && (
          <div className="detail-row decoded-section">
            <span className="section-icon"><Thermometer size={14} /> Temp</span>
            <div className="decoded-value">
              <strong>{decoded.temperature.celsius}°C / {decoded.temperature.fahrenheit}°F</strong>
              {decoded.temperature.isaDeviation !== null && (
                <span className="decoded-desc">
                  ISA deviation: {decoded.temperature.isaDeviation > 0 ? '+' : ''}{decoded.temperature.isaDeviation}°C
                </span>
              )}
            </div>
          </div>
        )}

        {/* Wind at altitude */}
        {decoded?.wind && (
          <div className="detail-row">
            <span className="section-icon"><Navigation size={14} /> Wind</span>
            <span>{windDirToCardinal(decoded.wind.direction)} ({decoded.wind.direction}°) at {decoded.wind.speed}kt</span>
          </div>
        )}

        {/* Remarks */}
        {decoded?.remarks && (
          <div className="detail-row">
            <span>Remarks</span>
            <span>{decoded.remarks}</span>
          </div>
        )}

        {/* Raw PIREP */}
        {(pirep.raw_text || pirep.rawOb) && (
          <div className="detail-row raw-section">
            <span>Raw PIREP</span>
            <span className="mono raw-text">{pirep.raw_text || pirep.rawOb}</span>
          </div>
        )}

        {/* Reported time - only show if valid */}
        {decoded?.time && (
          <div className="detail-row">
            <span>Reported</span>
            <span>{decoded.time}</span>
          </div>
        )}
      </div>
    </div>
  );
}
