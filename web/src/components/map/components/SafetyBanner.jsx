import React from 'react';
import { AlertTriangle, Check, Volume2, VolumeX } from 'lucide-react';

/**
 * Get severity color class for safety events.
 * @param {'critical'|'warning'|string} severity
 * @returns {string} CSS class name
 */
export const getSeverityClass = (severity) => {
  switch (severity) {
    case 'critical':
      return 'severity-critical';
    case 'warning':
      return 'severity-warning';
    default:
      return 'severity-low';
  }
};

/**
 * Get event type display name for safety events.
 * @param {string} eventType - e.g. 'tcas_ra', 'squawk_hijack'
 * @returns {string} Human-readable event type name
 */
export const getEventTypeName = (eventType) => {
  const names = {
    tcas_ra: 'TCAS RA',
    extreme_vs: 'EXTREME V/S',
    vs_reversal: 'V/S REVERSAL',
    proximity_conflict: 'PROXIMITY',
    rapid_descent: 'RAPID DESCENT',
    rapid_climb: 'RAPID CLIMB',
    squawk_hijack: 'SQUAWK 7500',
    squawk_radio_failure: 'SQUAWK 7600',
    squawk_emergency: 'SQUAWK 7700',
  };
  return names[eventType] || eventType?.replace(/_/g, ' ').toUpperCase() || 'ALERT';
};

/**
 * Render event-specific banner content based on event type.
 * Returns JSX with type-appropriate details (squawk codes, separation info,
 * vertical speed changes, etc.).
 * @param {object} event - Safety event object
 * @returns {JSX.Element}
 */
const renderEventBannerContent = (event) => {
  const eventType = event.event_type;
  const details = event.details || {};

  // Emergency squawks - show squawk code prominently
  if (eventType?.startsWith('squawk_')) {
    const squawkMeanings = {
      squawk_hijack: 'HIJACK',
      squawk_radio_failure: 'RADIO FAILURE',
      squawk_emergency: 'EMERGENCY',
    };
    return (
      <>
        <div className="banner-main-info">
          <span className="banner-squawk-code">{details.squawk || event.squawk}</span>
          <span className="banner-squawk-meaning">
            {squawkMeanings[eventType] || 'EMERGENCY'}
          </span>
        </div>
        <div className="banner-aircraft">
          <span className="banner-callsign">{event.callsign || event.icao}</span>
          {details.altitude && (
            <span className="banner-altitude">{details.altitude.toLocaleString()}ft</span>
          )}
        </div>
      </>
    );
  }

  // Proximity conflict - show separation info
  if (eventType === 'proximity_conflict') {
    return (
      <>
        <div className="banner-main-info">
          <span className="banner-separation-horiz">
            {details.horizontal_nm || details.distance_nm}nm
          </span>
          <span className="banner-separation-divider">/</span>
          <span className="banner-separation-vert">
            {details.vertical_ft || details.altitude_diff_ft}ft
          </span>
        </div>
        <div className="banner-aircraft">
          <span className="banner-callsign">{event.callsign || event.icao}</span>
          <span className="banner-vs-aircraft">&harr;</span>
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
            {details.previous_vs > 0 ? '+' : ''}
            {details.previous_vs} &rarr; {details.current_vs > 0 ? '+' : ''}
            {details.current_vs}
          </span>
          <span className="banner-vs-unit">fpm</span>
        </div>
        <div className="banner-aircraft">
          <span className="banner-callsign">{event.callsign || event.icao}</span>
          {details.altitude && (
            <span className="banner-altitude">{details.altitude.toLocaleString()}ft</span>
          )}
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
            {details.previous_vs > 0 ? '+' : ''}
            {details.previous_vs} &rarr; {details.current_vs > 0 ? '+' : ''}
            {details.current_vs}
          </span>
          <span className="banner-vs-unit">fpm</span>
        </div>
        <div className="banner-aircraft">
          <span className="banner-callsign">{event.callsign || event.icao}</span>
          {details.altitude && (
            <span className="banner-altitude">{details.altitude.toLocaleString()}ft</span>
          )}
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
          <span className="banner-vs-value">
            {vs > 0 ? '+' : ''}
            {vs}
          </span>
          <span className="banner-vs-unit">fpm</span>
        </div>
        <div className="banner-aircraft">
          <span className="banner-callsign">{event.callsign || event.icao}</span>
          {details.altitude && (
            <span className="banner-altitude">{details.altitude.toLocaleString()}ft</span>
          )}
        </div>
      </>
    );
  }

  // Default fallback
  return (
    <>
      <div className="banner-main-info">
        <span className="banner-callsign">{event.callsign || event.icao}</span>
        {event.callsign_2 && <span className="banner-callsign-2">&harr; {event.callsign_2}</span>}
      </div>
      {event.message && <div className="banner-message">{event.message}</div>}
    </>
  );
};

/**
 * SafetyBanner - Displays the highest-priority unacknowledged safety event
 * as a prominent banner overlay. Shown only in map/radar modes (not pro/crt).
 *
 * Clicking the banner clears any open popups (METAR, PIREP, navaid, airport),
 * positions the aircraft popup, and selects the associated aircraft.
 *
 * Includes a mute/unmute toggle for alarm sounds.
 *
 * @param {object} props
 * @param {Array} props.activeConflicts - Active safety events sorted by priority
 * @param {Set} props.acknowledgedEvents - Set of acknowledged event IDs
 * @param {function} props.acknowledgeEvent - Callback to acknowledge/dismiss an event
 * @param {Array} props.aircraft - Current aircraft array
 * @param {object} props.config - Map configuration (includes mapMode)
 * @param {function} props.selectAircraft - Callback to select an aircraft
 * @param {function} props.setSelectedMetar - Clear METAR popup
 * @param {function} props.setSelectedPirep - Clear PIREP popup
 * @param {function} props.setSelectedNavaid - Clear navaid popup
 * @param {function} props.setSelectedAirport - Clear airport popup
 * @param {function} props.setPopupPosition - Set aircraft popup position
 * @param {boolean} props.soundMuted - Whether alarm sounds are muted
 * @param {function} props.setSoundMuted - Toggle mute state
 */
export default function SafetyBanner({
  activeConflicts,
  acknowledgedEvents,
  acknowledgeEvent,
  aircraft,
  config,
  selectAircraft,
  setSelectedMetar,
  setSelectedPirep,
  setSelectedNavaid,
  setSelectedAirport,
  setPopupPosition,
  soundMuted,
  setSoundMuted,
}) {
  // Only render in map/radar mode, not pro/crt
  if (config.mapMode === 'pro' || config.mapMode === 'crt') return null;
  if (!activeConflicts || activeConflicts.length === 0) return null;

  // Filter out acknowledged events and show only the highest-priority one
  const visibleEvents = activeConflicts
    .filter((event) => !acknowledgedEvents.has(event.id))
    .slice(0, 1);

  if (visibleEvents.length === 0) return null;

  const handleBannerClick = (event) => {
    const ac = aircraft.find(
      (a) => a.hex?.toUpperCase() === event.icao?.toUpperCase()
    );
    if (ac) {
      setSelectedMetar(null);
      setSelectedPirep(null);
      setSelectedNavaid(null);
      setSelectedAirport(null);
      setPopupPosition({ x: 16, y: 16 });
      selectAircraft(ac);
    }
  };

  const handleBannerKeyDown = (e, event) => {
    if (e.key === 'Enter') {
      handleBannerClick(event);
    }
  };

  return (
    <div className="conflict-banners-container">
      {visibleEvents.map((event, idx) => (
        <div
          key={event.id || `conflict-${event.icao}-${idx}`}
          className={`conflict-banner ${getSeverityClass(event.severity)} event-type-${event.event_type}`}
          onClick={() => handleBannerClick(event)}
          onKeyDown={(e) => handleBannerKeyDown(e, event)}
          role="button"
          tabIndex={0}
          style={{ cursor: 'pointer' }}
        >
          <AlertTriangle size={28} />
          <div className="conflict-banner-content">
            <strong className="banner-event-type">
              {getEventTypeName(event.event_type)}
            </strong>
            {renderEventBannerContent(event)}
          </div>
          <div className="conflict-banner-actions">
            <button
              className="conflict-mute-btn"
              onClick={(e) => {
                e.stopPropagation();
                setSoundMuted(!soundMuted);
              }}
              title={soundMuted ? 'Unmute alerts' : 'Mute alerts'}
            >
              {soundMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <button
              className="conflict-ack-btn"
              onClick={(e) => {
                e.stopPropagation();
                acknowledgeEvent(event.id);
              }}
              title="Acknowledge and dismiss"
            >
              <Check size={20} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export { renderEventBannerContent, SafetyBanner };
