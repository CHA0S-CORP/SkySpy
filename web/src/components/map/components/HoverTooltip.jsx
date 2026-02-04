import React, { useRef, useEffect, useState, useMemo } from 'react';
import PropTypes from 'prop-types';
import {
  Plane,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
  Shield,
  AlertTriangle,
} from 'lucide-react';

/**
 * Phase 6.2: Quick Info Panel / Hover Tooltip
 *
 * Shows aircraft info on hover without clicking.
 * Appears after 500ms hover delay, positioned near cursor, avoiding screen edges.
 */
function HoverTooltip({ aircraft, info, x, y, containerWidth, containerHeight }) {
  const tooltipRef = useRef(null);
  const [position, setPosition] = useState({ left: x + 20, top: y - 10 });

  // Calculate position to avoid screen edges
  useEffect(() => {
    if (tooltipRef.current) {
      const rect = tooltipRef.current.getBoundingClientRect();
      const newPos = { left: x + 20, top: y - 10 };

      // Avoid right edge
      if (newPos.left + rect.width > containerWidth - 10) {
        newPos.left = x - rect.width - 20;
      }

      // Avoid bottom edge
      if (newPos.top + rect.height > containerHeight - 10) {
        newPos.top = y - rect.height - 10;
      }

      // Avoid top edge
      if (newPos.top < 10) {
        newPos.top = 10;
      }

      // Avoid left edge
      if (newPos.left < 10) {
        newPos.left = 10;
      }

      setPosition(newPos);
    }
  }, [x, y, containerWidth, containerHeight]);

  // Determine if aircraft has special status
  const isEmergency = useMemo(() => {
    const squawk = aircraft?.squawk;
    return squawk === '7500' || squawk === '7600' || squawk === '7700';
  }, [aircraft?.squawk]);

  const isMilitary = aircraft?.military || info?.military;

  // Get vertical speed indicator
  const vsIndicator = useMemo(() => {
    const vs = aircraft?.baro_rate || aircraft?.geom_rate;
    if (!vs || Math.abs(vs) < 100) {
      return { icon: ArrowRight, label: 'Level', className: 'level' };
    }
    if (vs > 0) {
      return { icon: ArrowUpRight, label: 'Climbing', className: 'climbing' };
    }
    return { icon: ArrowDownRight, label: 'Descending', className: 'descending' };
  }, [aircraft?.baro_rate, aircraft?.geom_rate]);

  const VsIcon = vsIndicator.icon;

  // Format altitude with FL for high altitudes
  const formatAltitude = (alt) => {
    if (!alt && alt !== 0) return '---';
    if (alt >= 18000) {
      return `FL${Math.round(alt / 100)}`;
    }
    return `${alt.toLocaleString()} ft`;
  };

  // Get type name from various sources
  const typeName =
    info?.type_name || info?.model || aircraft?.t || aircraft?.type || aircraft?.desc;

  // Get registration
  const registration = info?.registration || aircraft?.r;

  // Get operator/owner
  const operator = info?.operator || info?.owner;

  // Get origin and destination if available (from flight info)
  const origin = info?.origin || info?.departure_airport;
  const destination = info?.destination || info?.arrival_airport;

  return (
    <div
      ref={tooltipRef}
      className={`pro-hover-tooltip ${isEmergency ? 'emergency' : ''} ${isMilitary ? 'military' : ''}`}
      style={{
        left: position.left,
        top: position.top,
      }}
    >
      {/* Header with callsign */}
      <div className="tooltip-header">
        <Plane size={14} className="tooltip-icon" />
        <span className="tooltip-callsign">
          {aircraft?.flight?.trim() || aircraft?.hex?.toUpperCase()}
        </span>
        {isEmergency && (
          <span className="tooltip-emergency-badge">
            <AlertTriangle size={12} />
            {aircraft?.squawk === '7500'
              ? 'HIJACK'
              : aircraft?.squawk === '7600'
                ? 'RADIO'
                : 'EMER'}
          </span>
        )}
        {isMilitary && (
          <span className="tooltip-military-badge">
            <Shield size={12} />
            MIL
          </span>
        )}
      </div>

      {/* Aircraft type */}
      {typeName && (
        <div className="tooltip-type">
          {typeName}
          {registration && <span className="tooltip-reg"> ({registration})</span>}
        </div>
      )}

      {/* Operator */}
      {operator && <div className="tooltip-operator">{operator}</div>}

      {/* Data grid */}
      <div className="tooltip-data">
        <div className="tooltip-data-row">
          <span className="tooltip-label">Alt:</span>
          <span className="tooltip-value">
            {formatAltitude(aircraft?.alt_baro || aircraft?.alt)}
            <VsIcon size={12} className={`tooltip-vs-icon ${vsIndicator.className}`} />
          </span>
        </div>
        <div className="tooltip-data-row">
          <span className="tooltip-label">Spd:</span>
          <span className="tooltip-value">
            {aircraft?.gs ? `${Math.round(aircraft.gs)} kts` : '---'}
          </span>
        </div>
        <div className="tooltip-data-row">
          <span className="tooltip-label">Hdg:</span>
          <span className="tooltip-value">
            {aircraft?.track ? `${Math.round(aircraft.track)}°` : '---'}
          </span>
        </div>
        <div className="tooltip-data-row">
          <span className="tooltip-label">Sqwk:</span>
          <span className={`tooltip-value ${isEmergency ? 'emergency' : ''}`}>
            {aircraft?.squawk || '---'}
          </span>
        </div>
      </div>

      {/* Route if available */}
      {origin && destination && (
        <div className="tooltip-route">
          <span className="tooltip-route-airport">{origin}</span>
          <ArrowRight size={12} className="tooltip-route-arrow" />
          <span className="tooltip-route-airport">{destination}</span>
        </div>
      )}

      {/* ICAO hex (always show for identification) */}
      <div className="tooltip-hex">{aircraft?.hex?.toUpperCase()}</div>
    </div>
  );
}

HoverTooltip.propTypes = {
  aircraft: PropTypes.shape({
    hex: PropTypes.string,
    flight: PropTypes.string,
    alt_baro: PropTypes.number,
    alt: PropTypes.number,
    gs: PropTypes.number,
    track: PropTypes.number,
    squawk: PropTypes.string,
    baro_rate: PropTypes.number,
    geom_rate: PropTypes.number,
    t: PropTypes.string,
    type: PropTypes.string,
    desc: PropTypes.string,
    r: PropTypes.string,
    military: PropTypes.bool,
  }).isRequired,
  info: PropTypes.shape({
    type_name: PropTypes.string,
    model: PropTypes.string,
    registration: PropTypes.string,
    operator: PropTypes.string,
    owner: PropTypes.string,
    origin: PropTypes.string,
    destination: PropTypes.string,
    departure_airport: PropTypes.string,
    arrival_airport: PropTypes.string,
    military: PropTypes.bool,
  }),
  x: PropTypes.number.isRequired,
  y: PropTypes.number.isRequired,
  containerWidth: PropTypes.number,
  containerHeight: PropTypes.number,
};

HoverTooltip.defaultProps = {
  info: null,
  containerWidth: window.innerWidth,
  containerHeight: window.innerHeight,
};

export { HoverTooltip };
