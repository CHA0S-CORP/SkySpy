import React, { memo, useMemo, useCallback } from 'react';
import { Clock, MapPin, Navigation, Plane, X, Building2, ArrowRight } from 'lucide-react';
import {
  calculateETAToPoint,
  calculateETAToNearbyAirports,
  formatETA,
  formatETADetailed,
  getETAUrgency,
  bearingToCardinal,
} from '../../../utils/etaCalculations';

/**
 * ETATargetInfo - Shows ETA to a clicked map point
 */
const ETATargetInfo = memo(function ETATargetInfo({ aircraft, target, onClear }) {
  const eta = useMemo(() => {
    if (!aircraft || !target) return null;
    return calculateETAToPoint(aircraft, target);
  }, [aircraft, target]);

  if (!eta || !target) return null;

  const urgency = getETAUrgency(eta.etaSeconds);

  return (
    <div className={`eta-target-info ${urgency || ''}`}>
      <div className="eta-target-header">
        <MapPin size={14} aria-hidden="true" />
        <span className="eta-target-title">ETA to Point</span>
        <button
          className="eta-clear-btn"
          onClick={onClear}
          title="Clear target"
          aria-label="Clear ETA target"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="eta-target-details">
        <div className="eta-detail-row">
          <span className="eta-label">Distance</span>
          <span className="eta-value">{eta.distanceNm} nm</span>
        </div>
        <div className="eta-detail-row">
          <span className="eta-label">Bearing</span>
          <span className="eta-value">
            {eta.bearing}&deg; {bearingToCardinal(eta.bearing)}
          </span>
        </div>
        {eta.isApproaching ? (
          <>
            <div className="eta-detail-row eta-primary">
              <span className="eta-label">
                <Clock size={12} aria-hidden="true" /> ETA
              </span>
              <span className={`eta-value eta-time ${urgency || ''}`}>
                {formatETA(eta.etaSeconds)}
              </span>
            </div>
            <div className="eta-detail-row">
              <span className="eta-label">Closing</span>
              <span className="eta-value">{eta.closingSpeed} kts</span>
            </div>
          </>
        ) : (
          <div className="eta-detail-row eta-not-approaching">
            <span className="eta-label">Status</span>
            <span className="eta-value">Not approaching</span>
          </div>
        )}
      </div>
      <div className="eta-target-coords">
        {target.lat.toFixed(4)}, {target.lon.toFixed(4)}
      </div>
    </div>
  );
});

/**
 * ETAAirportList - Shows ETA to nearby airports
 */
const ETAAirportList = memo(function ETAAirportList({
  aircraft,
  airports,
  onSelectAirport,
  maxResults = 5,
}) {
  const airportETAs = useMemo(() => {
    if (!aircraft || !airports?.length) return [];
    return calculateETAToNearbyAirports(aircraft, airports, {
      maxDistance: 100,
      maxResults,
    });
  }, [aircraft, airports, maxResults]);

  if (!airportETAs.length) return null;

  return (
    <div className="eta-airport-list">
      <div className="eta-airport-header">
        <Building2 size={14} aria-hidden="true" />
        <span>Nearby Airports</span>
      </div>
      <div className="eta-airport-items">
        {airportETAs.map((apt) => {
          const urgency = getETAUrgency(apt.etaSeconds);
          return (
            <button
              key={apt.id}
              className={`eta-airport-item ${urgency || ''}`}
              onClick={() => onSelectAirport?.(apt)}
              title={`${apt.name || apt.id} - ${formatETADetailed(apt.etaSeconds)}`}
            >
              <div className="eta-airport-main">
                <span className="eta-airport-code">{apt.icao || apt.id}</span>
                <span className="eta-airport-distance">{apt.distanceNm} nm</span>
              </div>
              <div className="eta-airport-eta">
                {apt.isApproaching ? (
                  <>
                    <Clock size={10} aria-hidden="true" />
                    <span className={`eta-time ${urgency || ''}`}>{formatETA(apt.etaSeconds)}</span>
                  </>
                ) : (
                  <span className="eta-not-approaching-badge">--</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
});

/**
 * ETALine - Visual line from aircraft to target on the map canvas
 * This is a data structure component - actual rendering happens in MapView canvas
 */
export function getETALineData(aircraft, target) {
  if (!aircraft?.lat || !aircraft?.lon || !target?.lat || !target?.lon) {
    return null;
  }

  const eta = calculateETAToPoint(aircraft, target);

  return {
    start: { lat: aircraft.lat, lon: aircraft.lon },
    end: { lat: target.lat, lon: target.lon },
    eta,
    isApproaching: eta.isApproaching,
  };
}

/**
 * ETAOverlay - Main component combining target info and airport list
 */
export const ETAOverlay = memo(function ETAOverlay({
  aircraft,
  etaTarget,
  airports,
  onClearTarget,
  onSelectAirport,
  showAirportETAs = true,
  className = '',
}) {
  if (!aircraft) return null;

  const hasTarget = etaTarget?.lat != null && etaTarget?.lon != null;
  const hasAirports = showAirportETAs && airports?.length > 0;

  if (!hasTarget && !hasAirports) return null;

  return (
    <div className={`eta-overlay ${className}`}>
      {/* ETA to clicked point */}
      {hasTarget && (
        <ETATargetInfo aircraft={aircraft} target={etaTarget} onClear={onClearTarget} />
      )}

      {/* ETA to nearby airports */}
      {hasAirports && (
        <ETAAirportList aircraft={aircraft} airports={airports} onSelectAirport={onSelectAirport} />
      )}
    </div>
  );
});

/**
 * ETASection - Compact ETA section for ProDetailsPanel
 */
export const ETASection = memo(function ETASection({
  aircraft,
  etaTarget,
  airports,
  onClearTarget,
  onSelectAirport,
}) {
  const targetETA = useMemo(() => {
    if (!aircraft || !etaTarget) return null;
    return calculateETAToPoint(aircraft, etaTarget);
  }, [aircraft, etaTarget]);

  const topAirports = useMemo(() => {
    if (!aircraft || !airports?.length) return [];
    return calculateETAToNearbyAirports(aircraft, airports, {
      maxDistance: 50,
      maxResults: 3,
    });
  }, [aircraft, airports]);

  const hasContent = targetETA || topAirports.length > 0;

  if (!hasContent) return null;

  return (
    <div className="eta-section">
      <div className="pro-section-header">
        <Navigation size={14} aria-hidden="true" />
        ETA CALCULATIONS
      </div>

      {/* Target ETA */}
      {targetETA && etaTarget && (
        <div className="eta-panel-target">
          <div className="eta-panel-row">
            <span className="eta-panel-label">
              <MapPin size={12} aria-hidden="true" /> Target
            </span>
            <span className="eta-panel-value">{targetETA.distanceNm} nm</span>
            <button className="eta-panel-clear" onClick={onClearTarget} title="Clear target">
              <X size={12} />
            </button>
          </div>
          {targetETA.isApproaching ? (
            <div className="eta-panel-row eta-panel-primary">
              <span className="eta-panel-label">
                <Clock size={12} aria-hidden="true" /> ETA
              </span>
              <span
                className={`eta-panel-value eta-panel-time ${getETAUrgency(targetETA.etaSeconds) || ''}`}
              >
                {formatETA(targetETA.etaSeconds)}
              </span>
              <span className="eta-panel-closing">{targetETA.closingSpeed} kts</span>
            </div>
          ) : (
            <div className="eta-panel-row eta-panel-status">
              <span className="eta-panel-not-approaching">Not approaching target</span>
            </div>
          )}
        </div>
      )}

      {/* Top airports */}
      {topAirports.length > 0 && (
        <div className="eta-panel-airports">
          <div className="eta-panel-airports-header">
            <Building2 size={12} aria-hidden="true" />
            <span>Nearby Airports</span>
          </div>
          {topAirports.map((apt) => (
            <button
              key={apt.id}
              className="eta-panel-airport"
              onClick={() => onSelectAirport?.(apt)}
              title={apt.name || apt.id}
            >
              <span className="eta-panel-airport-code">{apt.icao || apt.id}</span>
              <span className="eta-panel-airport-dist">{apt.distanceNm} nm</span>
              {apt.isApproaching ? (
                <span className={`eta-panel-airport-eta ${getETAUrgency(apt.etaSeconds) || ''}`}>
                  {formatETA(apt.etaSeconds)}
                </span>
              ) : (
                <span className="eta-panel-airport-eta eta-na">--</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

export default ETAOverlay;
