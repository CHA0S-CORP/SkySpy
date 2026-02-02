import React, { useState } from 'react';
import {
  X,
  AlertTriangle,
  Wind,
  Snowflake,
  Thermometer,
  Navigation,
  MapPin,
  Plane,
  ChevronDown,
  ChevronUp,
  Copy,
  Target,
  Cloud,
} from 'lucide-react';
import { decodePirep, windDirToCardinal, getPirepMaxSeverity } from '../../../../utils';
import {
  PirepHazardBanner,
  TimeFreshnessIndicator,
  SeverityGauge,
  AltitudeRangeViz,
} from '../../../pirep';

/**
 * Collapsible section component
 */
function CollapsibleSection({ title, icon: Icon, children, defaultOpen = true, className = '' }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={`collapsible-section ${className} ${isOpen ? 'open' : 'closed'}`}>
      <button className="section-toggle" onClick={() => setIsOpen(!isOpen)}>
        {Icon && <Icon size={14} />}
        <span>{title}</span>
        {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {isOpen && <div className="section-content">{children}</div>}
    </div>
  );
}

/**
 * Quick action buttons for PIREP popup
 */
function PirepQuickActions({ pirep, onCenterMap }) {
  const handleCopy = () => {
    const rawText = pirep.raw_text || pirep.rawOb || '';
    if (rawText) {
      navigator.clipboard.writeText(rawText);
    }
  };

  return (
    <div className="pirep-quick-actions">
      {onCenterMap && (
        <button className="quick-action" onClick={onCenterMap} title="Center map on this PIREP">
          <Target size={14} />
        </button>
      )}
      <button className="quick-action" onClick={handleCopy} title="Copy raw PIREP">
        <Copy size={14} />
      </button>
    </div>
  );
}

/**
 * PIREP (Pilot Report) popup component - redesigned
 */
export function PirepPopup({
  pirep,
  config,
  popupPosition,
  isDragging,
  onClose,
  onMouseDown,
  onCenterMap,
}) {
  if (!pirep) return null;

  const decoded = decodePirep(pirep);
  const severity = getPirepMaxSeverity(pirep);
  const hasTurbulence = decoded?.turbulence && decoded.turbulence.level > 0;
  const hasIcing = decoded?.icing && decoded.icing.level > 0;
  const hasWindshear = decoded?.windshear && decoded.windshear.level > 0;
  const hasHazards = hasTurbulence || hasIcing || hasWindshear;

  return (
    <div
      className={`weather-popup pirep-popup ${config.mapMode === 'pro' ? 'pro-popup' : 'crt-popup'} ${decoded?.type === 'UUA' ? 'urgent-pirep' : ''} ${isDragging ? 'dragging' : ''}`}
      style={{ left: popupPosition.x, top: popupPosition.y }}
      onMouseDown={onMouseDown}
    >
      <button className="popup-close" onClick={onClose}>
        <X size={16} />
      </button>

      {/* Header */}
      <div className="popup-header">
        <AlertTriangle size={20} />
        <span className="popup-callsign">PIREP</span>
        <span className={`pirep-type-badge ${decoded?.type === 'UUA' ? 'urgent' : ''}`}>
          {decoded?.type || 'UA'}
        </span>
        <PirepQuickActions pirep={pirep} onCenterMap={onCenterMap} />
      </div>

      {/* Hazard Banner - always visible at top */}
      <PirepHazardBanner decoded={decoded} severity={severity} />

      <div className="popup-details">
        {/* At-a-glance summary */}
        <div className="pirep-summary">
          {decoded?.location && (
            <div className="summary-item">
              <MapPin size={12} />
              <span>{decoded.location}</span>
            </div>
          )}
          {decoded?.altitude && (
            <div className="summary-item">
              <span className="alt-badge">{decoded.altitude.text}</span>
            </div>
          )}
          {decoded?.aircraft && (
            <div className="summary-item">
              <Plane size={12} />
              <span>{decoded.aircraft}</span>
            </div>
          )}
        </div>

        {/* Time Freshness Indicator */}
        <TimeFreshnessIndicator pirep={pirep} decoded={decoded} />

        {/* Severity Gauges */}
        {hasHazards && (
          <div className="severity-gauges">
            {hasTurbulence && (
              <SeverityGauge
                type="turbulence"
                level={decoded.turbulence.level}
                label="Turbulence"
              />
            )}
            {hasIcing && <SeverityGauge type="icing" level={decoded.icing.level} label="Icing" />}
          </div>
        )}

        {/* Altitude Range Visualization */}
        {(pirep.turbulence_base_ft || pirep.icing_base_ft || decoded?.altitude) && (
          <AltitudeRangeViz decoded={decoded} pirep={pirep} />
        )}

        {/* Turbulence Section - collapsible, default open if present */}
        {hasTurbulence && (
          <CollapsibleSection
            title="Turbulence"
            icon={Wind}
            defaultOpen={true}
            className={`turb-section level-${decoded.turbulence.level}`}
          >
            <div className="hazard-details">
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
          </CollapsibleSection>
        )}

        {/* Icing Section - collapsible, default open if present */}
        {hasIcing && (
          <CollapsibleSection
            title="Icing"
            icon={Snowflake}
            defaultOpen={true}
            className={`icing-section level-${decoded.icing.level}`}
          >
            <div className="hazard-details">
              <strong className="icing-intensity">{decoded.icing.intensity}</strong>
              {decoded.icing.type && <span className="icing-type">{decoded.icing.type}</span>}
              {decoded.icing.detail && <span className="decoded-desc">{decoded.icing.detail}</span>}
              {decoded.icing.warning && (
                <span className="hazard-warning">{decoded.icing.warning}</span>
              )}
            </div>
          </CollapsibleSection>
        )}

        {/* Wind Shear Section - collapsible, default open if present */}
        {hasWindshear && (
          <CollapsibleSection
            title="Wind Shear"
            icon={Wind}
            defaultOpen={true}
            className={`ws-section level-${decoded.windshear.level}`}
          >
            <div className="hazard-details">
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
          </CollapsibleSection>
        )}

        {/* Weather/Sky Section - collapsible, default closed */}
        {(decoded?.weather || decoded?.sky) && (
          <CollapsibleSection title="Weather & Sky" icon={Cloud} defaultOpen={false}>
            {decoded?.sky && (
              <div className="detail-row">
                <span>Sky</span>
                <span>{decoded.sky.description}</span>
              </div>
            )}
            {decoded?.weather && (
              <div className="detail-row">
                <span>Weather</span>
                <span>{decoded.weather.description}</span>
              </div>
            )}
          </CollapsibleSection>
        )}

        {/* Temperature & Wind Section - collapsible, default closed */}
        {(decoded?.temperature || decoded?.wind) && (
          <CollapsibleSection title="Atmosphere" icon={Thermometer} defaultOpen={false}>
            {decoded?.temperature && (
              <div className="detail-row">
                <span>Temperature</span>
                <span>
                  {decoded.temperature.celsius}°C / {decoded.temperature.fahrenheit}°F
                  {decoded.temperature.isaDeviation !== null && (
                    <span className="isa-dev">
                      {' '}
                      (ISA {decoded.temperature.isaDeviation > 0 ? '+' : ''}
                      {decoded.temperature.isaDeviation}°)
                    </span>
                  )}
                </span>
              </div>
            )}
            {decoded?.wind && (
              <div className="detail-row">
                <span>Wind</span>
                <span>
                  <Navigation size={12} style={{ display: 'inline', marginRight: 4 }} />
                  {windDirToCardinal(decoded.wind.direction)} ({decoded.wind.direction}°) at{' '}
                  {decoded.wind.speed}kt
                </span>
              </div>
            )}
          </CollapsibleSection>
        )}

        {/* Remarks */}
        {decoded?.remarks && (
          <div className="detail-row remarks-row">
            <span>Remarks</span>
            <span>{decoded.remarks}</span>
          </div>
        )}

        {/* Raw PIREP - collapsible, default closed */}
        {(pirep.raw_text || pirep.rawOb) && (
          <CollapsibleSection title="Raw PIREP" defaultOpen={false} className="raw-section">
            <pre className="raw-text">{pirep.raw_text || pirep.rawOb}</pre>
          </CollapsibleSection>
        )}
      </div>
    </div>
  );
}
