import React from 'react';
import { AlertTriangle, Plane, ExternalLink, ArrowRight, Check } from 'lucide-react';

/**
 * Safety Event Card Component
 *
 * Features:
 * - Left severity indicator bar (red/orange/yellow/blue)
 * - Color-coded background by severity
 * - Type badge with icon
 * - Clickable aircraft chips
 * - Prominent separation metrics
 * - Clear CTA button
 */
export function SafetyEventCard({
  event,
  onSelectAircraft,
  onViewEvent,
  className = ''
}) {
  const getSeverityConfig = (severity) => {
    switch (severity) {
      case 'critical':
        return { color: '#ff4757', bgClass: 'severity-critical', label: 'CRITICAL' };
      case 'warning':
        return { color: '#ff9f43', bgClass: 'severity-warning', label: 'WARNING' };
      case 'info':
        return { color: '#00d4ff', bgClass: 'severity-info', label: 'INFO' };
      default:
        return { color: '#5a7a9a', bgClass: 'severity-default', label: 'EVENT' };
    }
  };

  const severityConfig = getSeverityConfig(event.severity);
  const eventTypeDisplay = event.event_type?.replace(/_/g, ' ').toUpperCase();
  const timestamp = new Date(event.timestamp).toLocaleTimeString();
  const isAcknowledged = event.acknowledged || event.resolved;

  return (
    <div
      className={`safety-event-card-v2 ${severityConfig.bgClass} ${isAcknowledged ? 'acknowledged' : ''} ${className}`}
      style={{ '--severity-color': severityConfig.color }}
    >
      {/* Left severity bar */}
      <div className="sec-severity-bar" />

      <div className="sec-content">
        {/* Header row: Type badge, severity, time */}
        <div className="sec-header">
          <div className="sec-type-badge">
            <AlertTriangle size={14} />
            <span>{eventTypeDisplay}</span>
          </div>
          <span className="sec-severity-label">{severityConfig.label}</span>
          {isAcknowledged && (
            <span className="sec-acknowledged-badge">
              <Check size={12} />
              <span>ACK</span>
            </span>
          )}
          <span className="sec-timestamp">{timestamp}</span>
        </div>

        {/* Message */}
        <p className="sec-message">{event.message}</p>

        {/* Aircraft chips with separation */}
        <div className="sec-aircraft-row">
          <button
            className="sec-aircraft-chip"
            onClick={(e) => {
              e.stopPropagation();
              onSelectAircraft?.(event.icao);
            }}
          >
            <Plane size={14} />
            <span>{event.callsign || event.icao}</span>
          </button>

          {event.icao_2 && (
            <>
              <span className="sec-separator">
                <span className="sec-separator-line" />
                <span className="sec-separator-icon">↔</span>
                <span className="sec-separator-line" />
              </span>

              <button
                className="sec-aircraft-chip"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectAircraft?.(event.icao_2);
                }}
              >
                <Plane size={14} />
                <span>{event.callsign_2 || event.icao_2}</span>
              </button>
            </>
          )}
        </div>

        {/* Separation metrics */}
        {(event.details?.horizontal_nm || event.details?.vertical_ft) && (
          <div className="sec-metrics">
            {event.details?.horizontal_nm && (
              <div className="sec-metric">
                <span className="sec-metric-value">
                  {event.details.horizontal_nm.toFixed(1)}
                </span>
                <span className="sec-metric-unit">nm</span>
              </div>
            )}
            {event.details?.vertical_ft && (
              <div className="sec-metric">
                <span className="sec-metric-value">
                  {Math.abs(event.details.vertical_ft).toLocaleString()}
                </span>
                <span className="sec-metric-unit">ft</span>
              </div>
            )}
          </div>
        )}

        {/* View details button */}
        {onViewEvent && event.id && (
          <button
            className="sec-view-btn"
            onClick={(e) => {
              e.stopPropagation();
              onViewEvent(event.id);
            }}
          >
            <span>View Details</span>
            <ArrowRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

export default SafetyEventCard;
