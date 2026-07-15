import React from 'react';
import { Plane, X, Shield, AlertTriangle, ExternalLink, Crosshair, Bell, Zap } from 'lucide-react';
import { getTailInfo } from '../../../utils';

/**
 * Selected aircraft popup with optional conflict side panel.
 * Extracted from MapView.jsx inline IIFE (lines ~9884-10243).
 */
export function SelectedAircraftPanel({
  liveAircraft,
  config,
  popupPosition,
  isDragging,
  handlePopupMouseDown,
  selectAircraft,
  activeConflicts,
  aircraft,
  getSeverityClass,
  getEventTypeName,
  followingAircraft,
  setFollowingAircraft,
  leafletMapRef,
  openAircraftSidebar,
  onViewHistoryEvent,
}) {
  if (!liveAircraft) return null;

  const isEmergency =
    liveAircraft.emergency || ['7500', '7600', '7700'].includes(liveAircraft.squawk);
  const squawkMeanings = { 7500: 'HIJACK', 7600: 'RADIO', 7700: 'EMERG' };
  const squawkLabel = squawkMeanings[liveAircraft.squawk];

  // Check if this aircraft has a safety event
  const safetyEvent = activeConflicts.find(
    (e) =>
      e.icao?.toUpperCase() === liveAircraft.hex?.toUpperCase() ||
      e.icao_2?.toUpperCase() === liveAircraft.hex?.toUpperCase()
  );

  const isConflict = !!safetyEvent;
  const conflictSeverity = safetyEvent?.severity || null;
  const conflictTitle = safetyEvent ? getEventTypeName(safetyEvent.event_type) : null;

  // Get the other aircraft in a two-aircraft conflict from safety event
  const otherAircraftHex = safetyEvent?.icao_2
    ? safetyEvent.icao?.toUpperCase() === liveAircraft.hex?.toUpperCase()
      ? safetyEvent.icao_2
      : safetyEvent.icao
    : null;
  const otherAircraft = otherAircraftHex
    ? aircraft.find((ac) => ac.hex?.toUpperCase() === otherAircraftHex?.toUpperCase())
    : null;

  // Build conflictInfo for display
  const conflictInfo = safetyEvent?.icao_2
    ? {
        hex1: safetyEvent.icao,
        hex2: safetyEvent.icao_2,
        horizontalNm:
          safetyEvent.horizontalNm || safetyEvent.details?.horizontal_nm?.toFixed(1) || '--',
        verticalFt: safetyEvent.verticalFt || safetyEvent.details?.altitude_diff_ft || '--',
      }
    : null;

  // Vertical rate arrows - chevron style like ATC displays
  const vr = liveAircraft.vr || 0;
  const absVr = Math.abs(vr);
  const vrArrows = absVr > 2000 ? 3 : absVr > 1000 ? 2 : absVr > 300 ? 1 : 0;
  const vrChevron = vr > 0 ? '\u25B2' : vr < 0 ? '\u25BC' : '';

  // Other aircraft vertical rate
  const otherVr = otherAircraft?.vr || 0;
  const otherAbsVr = Math.abs(otherVr);
  const otherVrArrows = otherAbsVr > 2000 ? 3 : otherAbsVr > 1000 ? 2 : otherAbsVr > 300 ? 1 : 0;
  const otherVrChevron = otherVr > 0 ? '\u25B2' : otherVr < 0 ? '\u25BC' : '';

  return (
    <div
      className={`aircraft-popup-container ${isConflict ? 'with-conflict' : ''}`}
      style={{ left: popupPosition.x, top: popupPosition.y }}
    >
      {/* Main Aircraft Panel */}
      <div
        className={`aircraft-popup ${config.mapMode === 'crt' ? 'crt-popup' : ''} ${config.mapMode === 'pro' ? 'pro-popup' : ''} ${isEmergency ? 'emergency-popup' : ''} ${isConflict ? `conflict-popup ${getSeverityClass(conflictSeverity)}` : ''} ${isDragging ? 'dragging' : ''}`}
      >
        <button className="popup-close" onClick={() => selectAircraft(null)}>
          <X size={16} />
        </button>
        <div
          role="toolbar"
          aria-label="Drag to move panel"
          tabIndex={0}
          className={`popup-header ${isEmergency ? 'emergency-header' : ''} ${isConflict ? `conflict-header ${getSeverityClass(conflictSeverity)}` : ''}`}
          onMouseDown={handlePopupMouseDown}
          onKeyDown={(e) => {
            if (e.key === 'Escape') selectAircraft(null);
          }}
        >
          <Plane size={20} />
          <span className="popup-callsign">{liveAircraft.flight || liveAircraft.hex}</span>
          {isConflict && (
            <span className={`popup-conflict-tag ${getSeverityClass(conflictSeverity)}`}>
              {'\u26A0\uFE0F'} {conflictTitle}
            </span>
          )}
          {isEmergency && squawkLabel && <span className="popup-squawk-tag">{squawkLabel}</span>}
          {liveAircraft.military && <Shield size={14} className="military-badge" />}
        </div>

        <div className="popup-details">
          <div className="detail-row">
            <span>ICAO</span>
            <span>{liveAircraft.hex}</span>
          </div>
          {(() => {
            const tailInfo = getTailInfo(liveAircraft.hex, liveAircraft.flight);
            return (
              <>
                <div className="detail-row">
                  <span>Tail #</span>
                  <span className={tailInfo.tailNumber ? 'tail-number' : 'tail-unknown'}>
                    {tailInfo.tailNumber || '--'}
                  </span>
                </div>
                <div className="detail-row">
                  <span>Country</span>
                  <span>{tailInfo.country || '--'}</span>
                </div>
              </>
            );
          })()}
          <div className="detail-row">
            <span>Type</span>
            <span>{liveAircraft.type || '--'}</span>
          </div>
          <div className="detail-row">
            <span>Altitude</span>
            <span>{liveAircraft.alt?.toLocaleString() || '--'} ft</span>
          </div>
          <div className="detail-row">
            <span>Speed</span>
            <span>{liveAircraft.gs?.toFixed(0) || '--'} kts</span>
          </div>
          <div className="detail-row">
            <span>Distance</span>
            <span>{liveAircraft.distance_nm?.toFixed(1) || '--'} nm</span>
          </div>
          <div className="detail-row">
            <span>Track</span>
            <span>{liveAircraft.track?.toFixed(0) || '--'}&deg;</span>
          </div>
          <div className="detail-row">
            <span>V/S</span>
            <span className={`vs-value ${vr > 0 ? 'climbing' : vr < 0 ? 'descending' : ''}`}>
              {vrArrows > 0 && (
                <span className={`vs-chevrons chevrons-${vrArrows}`}>
                  {Array(vrArrows)
                    .fill(vrChevron)
                    .map((c, i) => (
                      <span key={i} className="vs-chevron">
                        {c}
                      </span>
                    ))}
                </span>
              )}
              {liveAircraft.vr || '--'} fpm
            </span>
          </div>
          <div className="detail-row">
            <span>Squawk</span>
            <span className={liveAircraft.squawk?.match(/^7[567]00$/) ? 'emergency-squawk' : ''}>
              {liveAircraft.squawk || '--'}
            </span>
          </div>
        </div>

        {/* External Lookup Links */}
        <div className="popup-links">
          <span className="links-label">Lookup:</span>
          <div className="links-row">
            {liveAircraft.flight && (
              <a
                href={`https://flightaware.com/live/flight/${liveAircraft.flight.trim()}`}
                target="_blank"
                rel="noopener noreferrer"
                className="lookup-link"
                title="FlightAware"
              >
                <ExternalLink size={12} /> FA
              </a>
            )}
            <a
              href={`https://globe.adsbexchange.com/?icao=${liveAircraft.hex}`}
              target="_blank"
              rel="noopener noreferrer"
              className="lookup-link"
              title="ADS-B Exchange"
            >
              <ExternalLink size={12} /> ADSBx
            </a>
            <a
              href={`https://www.planespotters.net/hex/${liveAircraft.hex.toUpperCase()}`}
              target="_blank"
              rel="noopener noreferrer"
              className="lookup-link"
              title="Planespotters"
            >
              <ExternalLink size={12} /> PS
            </a>
            <a
              href={`https://www.jetphotos.com/registration/${liveAircraft.hex.toUpperCase()}`}
              target="_blank"
              rel="noopener noreferrer"
              className="lookup-link"
              title="JetPhotos"
            >
              <ExternalLink size={12} /> JP
            </a>
            <a
              href={`https://opensky-network.org/aircraft-profile?icao24=${liveAircraft.hex.toLowerCase()}`}
              target="_blank"
              rel="noopener noreferrer"
              className="lookup-link"
              title="OpenSky Network"
            >
              <ExternalLink size={12} /> OSN
            </a>
            {liveAircraft.flight && (
              <a
                href={`https://www.flightradar24.com/${liveAircraft.flight.trim()}`}
                target="_blank"
                rel="noopener noreferrer"
                className="lookup-link"
                title="Flightradar24"
              >
                <ExternalLink size={12} /> FR24
              </a>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="popup-action-buttons">
          <button
            className={`popup-action-btn ${followingAircraft === liveAircraft.hex ? 'active' : ''}`}
            onClick={() => {
              if (!liveAircraft.lat || !liveAircraft.lon) return;

              if (config.mapMode === 'map' && leafletMapRef.current) {
                leafletMapRef.current.flyTo([liveAircraft.lat, liveAircraft.lon], 14, {
                  duration: 1.5,
                  easeLinearity: 0.25,
                });
              } else if (config.mapMode === 'pro') {
                if (followingAircraft === liveAircraft.hex) {
                  setFollowingAircraft(null);
                } else {
                  setFollowingAircraft(liveAircraft.hex);
                }
              }
            }}
          >
            <Crosshair size={14} />
            {followingAircraft === liveAircraft.hex ? 'Following' : 'Follow Aircraft'}
          </button>
          <button
            className="popup-action-btn"
            onClick={() => openAircraftSidebar(liveAircraft.hex)}
          >
            <ExternalLink size={14} />
            Details
          </button>
        </div>

        {/* Create Alert Button */}
        <button
          className="popup-create-alert"
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent('createAlertFromAircraft', {
                detail: liveAircraft,
              })
            );
            selectAircraft(null);
          }}
        >
          <Bell size={14} />
          Create Alert for this Aircraft
        </button>
      </div>

      {/* Conflict Side Panel - Shows other aircraft */}
      {isConflict && otherAircraft && (
        <div
          className={`conflict-side-panel ${config.mapMode === 'pro' ? 'pro-style' : ''} ${getSeverityClass(conflictSeverity)}`}
        >
          <div className={`conflict-separation-header ${getSeverityClass(conflictSeverity)}`}>
            <AlertTriangle size={16} />
            <span>{conflictTitle}</span>
          </div>
          <div className="conflict-separation-info">
            <div className="separation-value">
              {conflictInfo?.horizontalNm || '--'}
              <span>nm</span>
            </div>
            <div className="separation-value">
              {conflictInfo?.verticalFt || '--'}
              <span>ft</span>
            </div>
          </div>
          {safetyEvent && (
            <div
              className="conflict-message-row clickable"
              onClick={() => onViewHistoryEvent?.(safetyEvent.id)}
              onKeyDown={(e) => e.key === 'Enter' && onViewHistoryEvent?.(safetyEvent.id)}
              role="button"
              tabIndex={0}
              title="View in History"
            >
              <span className="conflict-event-message">{safetyEvent.message}</span>
            </div>
          )}
          <div className="conflict-other-header">
            <Plane size={16} />
            <span>{otherAircraft.flight?.trim() || otherAircraft.hex}</span>
          </div>
          <div className="conflict-other-details">
            <div className="conflict-detail">
              <span>Alt</span>
              <span>{otherAircraft.alt?.toLocaleString() || '--'} ft</span>
            </div>
            <div className="conflict-detail">
              <span>Spd</span>
              <span>{otherAircraft.gs?.toFixed(0) || '--'} kts</span>
            </div>
            <div className="conflict-detail">
              <span>V/S</span>
              <span
                className={`vs-value ${otherVr > 0 ? 'climbing' : otherVr < 0 ? 'descending' : ''}`}
              >
                {otherVrArrows > 0 && (
                  <span className={`vs-chevrons chevrons-${otherVrArrows}`}>
                    {Array(otherVrArrows).fill(otherVrChevron).join('')}
                  </span>
                )}{' '}
                {otherAircraft.vr || '--'}
              </span>
            </div>
            <div className="conflict-detail">
              <span>Trk</span>
              <span>{otherAircraft.track?.toFixed(0) || '--'}&deg;</span>
            </div>
            <div className="conflict-detail">
              <span>Type</span>
              <span>{otherAircraft.type || '--'}</span>
            </div>
          </div>
          <button
            className={`conflict-select-btn ${getSeverityClass(conflictSeverity)}`}
            onClick={() => selectAircraft(otherAircraft)}
          >
            Select {otherAircraft.flight?.trim() || otherAircraft.hex}
          </button>
        </div>
      )}
    </div>
  );
}
