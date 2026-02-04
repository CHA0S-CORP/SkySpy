import React from 'react';
import { ExternalLink, History } from 'lucide-react';
import { getSeverityClass, formatEventType } from '../tabs/safetyConstants';

/**
 * SafetySection - Safety events list for section layout
 *
 * Compact version of SafetyTab for the scrollable sections layout.
 */
export function SafetySection({
  hex,
  safetyEvents = [],
  onSelectAircraft,
  onViewHistoryEvent,
  onViewEvent,
}) {
  if (safetyEvents.length === 0) {
    return null;
  }

  return (
    <div className="safety-section">
      <p className="safety-count-v2">
        {safetyEvents.length} safety event{safetyEvents.length !== 1 ? 's' : ''}
      </p>

      <div className="safety-events-list-v2">
        {safetyEvents.slice(0, 10).map((event, i) => {
          const eventKey = event.id || i;
          const currentHex = hex?.toLowerCase();
          const isCurrentPrimary = event.icao?.toLowerCase() === currentHex;
          const otherIcao = isCurrentPrimary ? event.icao_2 : event.icao;
          const otherCallsign = isCurrentPrimary ? event.callsign_2 : event.callsign;

          return (
            <article
              key={eventKey}
              className={`safety-event-card ${getSeverityClass(event.severity)}`}
            >
              <div className="safety-event-card-header">
                <span className={`safety-severity-tag ${getSeverityClass(event.severity)}`}>
                  {event.severity?.toUpperCase()}
                </span>
                <span className="safety-event-type-label">{formatEventType(event.event_type)}</span>
                <time className="safety-event-timestamp" dateTime={event.timestamp}>
                  {new Date(event.timestamp).toLocaleString()}
                </time>
              </div>

              <p className="safety-event-msg">{event.message}</p>

              {/* Event details */}
              {event.details && (
                <div className="safety-event-detail-row">
                  {event.details.altitude && (
                    <span>Alt: {event.details.altitude?.toLocaleString()}ft</span>
                  )}
                  {event.details.distance_nm && <span>Dist: {event.details.distance_nm}nm</span>}
                  {event.details.altitude_diff_ft && (
                    <span>ΔAlt: {event.details.altitude_diff_ft}ft</span>
                  )}
                  {otherIcao && (
                    <span className="safety-with-aircraft">
                      With:{' '}
                      {onSelectAircraft ? (
                        <button
                          className="safety-aircraft-btn"
                          onClick={() => onSelectAircraft(otherIcao)}
                        >
                          {otherCallsign || otherIcao}
                        </button>
                      ) : (
                        <span>{otherCallsign || otherIcao}</span>
                      )}
                    </span>
                  )}
                </div>
              )}

              {/* Action buttons */}
              <div className="safety-event-actions-row">
                {onViewHistoryEvent && (
                  <button
                    className="safety-action-btn"
                    onClick={() => onViewHistoryEvent(event.id || eventKey)}
                    title="View in History"
                  >
                    <History size={12} />
                    History
                  </button>
                )}
                {onViewEvent && event.id && (
                  <button
                    className="safety-action-btn"
                    onClick={() => onViewEvent(event.id)}
                    title="View Details"
                  >
                    <ExternalLink size={12} />
                    Details
                  </button>
                )}
              </div>
            </article>
          );
        })}

        {safetyEvents.length > 10 && (
          <p className="safety-more-text">+{safetyEvents.length - 10} more events</p>
        )}
      </div>
    </div>
  );
}
