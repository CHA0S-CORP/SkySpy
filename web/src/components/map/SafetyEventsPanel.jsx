import React from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';

/**
 * Panel showing safety events (emergencies, special squawks, etc.)
 */
export function SafetyEventsPanel({ 
  events, 
  acknowledgedEvents, 
  onAcknowledge,
  onSelectAircraft,
  onClose
}) {
  if (!events || events.length === 0) return null;

  // Sort by severity (critical first) then by time (newest first)
  const sortedEvents = [...events].sort((a, b) => {
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    const aSev = severityOrder[a.severity] ?? 3;
    const bSev = severityOrder[b.severity] ?? 3;
    if (aSev !== bSev) return aSev - bSev;
    return new Date(b.timestamp) - new Date(a.timestamp);
  });

  return (
    <div className="safety-events-panel">
      <div className="safety-events-header">
        <AlertTriangle size={18} />
        <span>Safety Events</span>
        <span className="event-count">{events.length}</span>
        {onClose && (
          <button className="safety-close" onClick={onClose}>
            <X size={16} />
          </button>
        )}
      </div>
      
      <div className="safety-events-list">
        {sortedEvents.map((event, idx) => {
          const isAcknowledged = acknowledgedEvents?.has(event.id);
          
          return (
            <div 
              key={event.id || idx}
              className={`safety-event severity-${event.severity} ${isAcknowledged ? 'acknowledged' : ''}`}
            >
              <div className="event-header">
                <span
                  className="event-callsign clickable"
                  onClick={() => onSelectAircraft?.(event.icao)}
                >
                  {event.callsign || event.icao}
                </span>
                <span className={`event-type-badge ${event.event_type}`}>
                  {event.event_type?.replace(/_/g, ' ').toUpperCase()}
                </span>
              </div>
              
              <div className="event-details">
                {event.squawk && (
                  <span className="event-squawk">
                    Squawk: {event.squawk}
                  </span>
                )}
                {event.altitude && (
                  <span className="event-altitude">
                    {event.altitude.toLocaleString()} ft
                  </span>
                )}
                {event.message && (
                  <span className="event-message">{event.message}</span>
                )}
              </div>
              
              <div className="event-footer">
                <span className="event-time">
                  {event.timestamp 
                    ? new Date(event.timestamp).toLocaleTimeString()
                    : '--'}
                </span>
                {!isAcknowledged && onAcknowledge && (
                  <button 
                    className="event-ack-btn"
                    onClick={() => onAcknowledge(event.id)}
                    title="Acknowledge"
                  >
                    <Check size={14} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default SafetyEventsPanel;
