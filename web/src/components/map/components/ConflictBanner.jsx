import React from 'react';
import { AlertTriangle, Check, History, X } from 'lucide-react';

/**
 * Get severity color class
 */
export const getSeverityClass = (severity) => {
  switch (severity) {
    case 'critical': return 'severity-critical';
    case 'warning': return 'severity-warning';
    default: return 'severity-low';
  }
};

/**
 * Get event type display name
 */
export const getEventTypeName = (eventType) => {
  const names = {
    'tcas_ra': 'TCAS RA',
    'extreme_vs': 'EXTREME V/S',
    'vs_reversal': 'V/S REVERSAL',
    'proximity_conflict': 'PROXIMITY',
    'rapid_descent': 'RAPID DESCENT',
    'rapid_climb': 'RAPID CLIMB',
    'squawk_hijack': 'SQUAWK 7500',
    'squawk_radio_failure': 'SQUAWK 7600',
    'squawk_emergency': 'SQUAWK 7700',
  };
  return names[eventType] || eventType?.replace(/_/g, ' ').toUpperCase() || 'ALERT';
};

/**
 * Render event-specific banner content based on event type
 */
export const renderEventBannerContent = (event) => {
  const eventType = event.event_type;
  const details = event.details || {};

  // Emergency squawks - show squawk code prominently
  if (eventType?.startsWith('squawk_')) {
    const squawkMeanings = {
      'squawk_hijack': 'HIJACK',
      'squawk_radio_failure': 'RADIO FAILURE',
      'squawk_emergency': 'EMERGENCY'
    };
    return (
      <>
        <div className="banner-main-info">
          <span className="banner-squawk-code">{details.squawk || event.squawk}</span>
          <span className="banner-squawk-meaning">{squawkMeanings[eventType] || 'EMERGENCY'}</span>
        </div>
        <div className="banner-aircraft">
          <span className="banner-callsign">{event.callsign || event.icao}</span>
          {details.altitude && <span className="banner-altitude">{details.altitude.toLocaleString()}ft</span>}
        </div>
      </>
    );
  }

  // Proximity conflict - show separation info
  if (eventType === 'proximity_conflict') {
    return (
      <>
        <div className="banner-main-info">
          <span className="banner-separation-horiz">{details.horizontal_nm || details.distance_nm}nm</span>
          <span className="banner-separation-divider">/</span>
          <span className="banner-separation-vert">{details.vertical_ft || details.altitude_diff_ft}ft</span>
        </div>
        <div className="banner-aircraft">
          <span className="banner-callsign">{event.callsign || event.icao}</span>
          <span className="banner-vs-aircraft">-</span>
          <span className="banner-callsign">{event.callsign_2 || event.icao_2}</span>
        </div>
      </>
    );
  }

  // TCAS RA - show VS change
  if (eventType === 'tcas_ra') {
    return (
      <>
        <div className="banner-main-info">
          <span className="banner-vs-change">
            {details.previous_vs > 0 ? '+' : ''}{details.previous_vs} - {details.current_vs > 0 ? '+' : ''}{details.current_vs}
          </span>
          <span className="banner-vs-unit">fpm</span>
        </div>
        <div className="banner-aircraft">
          <span className="banner-callsign">{event.callsign || event.icao}</span>
          {details.altitude && <span className="banner-altitude">{details.altitude.toLocaleString()}ft</span>}
        </div>
      </>
    );
  }

  // VS Reversal - show VS change
  if (eventType === 'vs_reversal') {
    return (
      <>
        <div className="banner-main-info">
          <span className="banner-vs-change">
            {details.previous_vs > 0 ? '+' : ''}{details.previous_vs} - {details.current_vs > 0 ? '+' : ''}{details.current_vs}
          </span>
          <span className="banner-vs-unit">fpm</span>
        </div>
        <div className="banner-aircraft">
          <span className="banner-callsign">{event.callsign || event.icao}</span>
          {details.altitude && <span className="banner-altitude">{details.altitude.toLocaleString()}ft</span>}
        </div>
      </>
    );
  }

  // Extreme VS - show current VS
  if (eventType === 'extreme_vs') {
    const vs = details.vertical_rate;
    return (
      <>
        <div className="banner-main-info">
          <span className="banner-vs-value">{vs > 0 ? '+' : ''}{vs}</span>
          <span className="banner-vs-unit">fpm</span>
        </div>
        <div className="banner-aircraft">
          <span className="banner-callsign">{event.callsign || event.icao}</span>
          {details.altitude && <span className="banner-altitude">{details.altitude.toLocaleString()}ft</span>}
        </div>
      </>
    );
  }

  // Default fallback
  return (
    <>
      <div className="banner-main-info">
        <span className="banner-callsign">{event.callsign || event.icao}</span>
        {event.callsign_2 && <span className="banner-callsign-2">- {event.callsign_2}</span>}
      </div>
      {event.message && <div className="banner-message">{event.message}</div>}
    </>
  );
};

/**
 * ConflictBanner component - displays safety event banners
 */
export function ConflictBanner({
  activeConflicts,
  acknowledgedEvents,
  aircraft,
  selectAircraft,
  acknowledgeEvent,
  onViewHistoryEvent,
}) {
  // Filter out acknowledged events and take just the first one
  const visibleEvents = activeConflicts
    .filter(event => !acknowledgedEvents.has(event.id))
    .slice(0, 1);

  if (visibleEvents.length === 0) return null;

  return (
    <div className="conflict-banners-container">
      {visibleEvents.map((event, idx) => (
        <div
          key={event.id || `conflict-${event.icao}-${idx}`}
          className={`conflict-banner ${getSeverityClass(event.severity)} event-type-${event.event_type}`}
          onClick={() => {
            // Find and select the aircraft
            const ac = aircraft.find(a => a.hex?.toUpperCase() === event.icao?.toUpperCase());
            if (ac) {
              selectAircraft(ac);
            }
          }}
        >
          <div className="banner-icon">
            <AlertTriangle size={20} />
          </div>
          <div className="banner-type">
            {getEventTypeName(event.event_type)}
          </div>
          <div className="banner-content">
            {renderEventBannerContent(event)}
          </div>
          <div className="banner-actions">
            <button
              className="banner-action-btn history"
              onClick={(e) => {
                e.stopPropagation();
                onViewHistoryEvent?.(event.id);
              }}
              title="View in History"
            >
              <History size={14} />
            </button>
            <button
              className="banner-action-btn acknowledge"
              onClick={(e) => {
                e.stopPropagation();
                acknowledgeEvent(event.id);
              }}
              title="Acknowledge"
            >
              <Check size={14} />
            </button>
            <button
              className="banner-action-btn dismiss"
              onClick={(e) => {
                e.stopPropagation();
                acknowledgeEvent(event.id);
              }}
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
