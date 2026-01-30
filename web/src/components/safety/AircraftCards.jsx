import React from 'react';
import { Plane, Navigation } from 'lucide-react';

/**
 * Aircraft Cards Component
 * Displays involved aircraft with their telemetry data and separation info
 */
export function AircraftCards({
  event,
  telem1,
  telem2,
  onSelectAircraft
}) {
  return (
    <div className="sep-aircraft-section">
      <div className="sep-section-header">
        <Plane size={16} />
        <span>Involved Aircraft</span>
      </div>

      <div className="sep-aircraft-grid">
        {/* Aircraft 1 */}
        <AircraftCard
          icao={event.icao}
          callsign={event.callsign}
          telemetry={telem1}
          color="#00ff88"
          onSelect={onSelectAircraft}
        />

        {/* Separation indicator */}
        {event.icao_2 && (
          <SeparationIndicator details={event.details} />
        )}

        {/* Aircraft 2 */}
        {event.icao_2 && (
          <AircraftCard
            icao={event.icao_2}
            callsign={event.callsign_2}
            telemetry={telem2}
            color="#00d4ff"
            onSelect={onSelectAircraft}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Individual Aircraft Card
 */
function AircraftCard({ icao, callsign, telemetry, color, onSelect }) {
  return (
    <div
      className="sep-aircraft-card"
      onClick={() => onSelect?.(icao)}
      style={{ '--ac-color': color }}
    >
      <div className="sep-ac-header">
        <Navigation size={16} style={{ transform: `rotate(${telemetry?.track || 0}deg)` }} />
        <span className="sep-ac-callsign">{callsign || icao}</span>
      </div>
      <div className="sep-ac-icao">{icao}</div>
      {telemetry && (
        <div className="sep-ac-telemetry">
          <TelemetryItem
            label="ALT"
            value={telemetry.altitude?.toLocaleString() || '--'}
            unit="ft"
          />
          <TelemetryItem
            label="GS"
            value={telemetry.gs?.toFixed(0) || '--'}
            unit="kts"
          />
          <TelemetryItem
            label="VS"
            value={`${telemetry.vr > 0 ? '+' : ''}${telemetry.vr || 0}`}
            unit="fpm"
            className={telemetry?.vr > 0 ? 'climbing' : telemetry?.vr < 0 ? 'descending' : ''}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Telemetry Item Display
 */
function TelemetryItem({ label, value, unit, className = '' }) {
  return (
    <div className="sep-telem-item">
      <span className="sep-telem-label">{label}</span>
      <span className={`sep-telem-value ${className}`}>{value}</span>
      <span className="sep-telem-unit">{unit}</span>
    </div>
  );
}

/**
 * Separation Indicator between aircraft
 */
function SeparationIndicator({ details }) {
  return (
    <div className="sep-separation-indicator">
      <div className="sep-separation-line" />
      <div className="sep-separation-data">
        {details?.horizontal_nm && (
          <div className="sep-sep-item">
            <span className="sep-sep-value">{details.horizontal_nm.toFixed(1)}</span>
            <span className="sep-sep-unit">nm</span>
          </div>
        )}
        {details?.vertical_ft && (
          <div className="sep-sep-item vertical">
            <span className="sep-sep-value">{details.vertical_ft}</span>
            <span className="sep-sep-unit">ft</span>
          </div>
        )}
      </div>
      <div className="sep-separation-line" />
    </div>
  );
}

export default AircraftCards;
