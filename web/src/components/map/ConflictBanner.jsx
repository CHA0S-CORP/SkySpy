import React from 'react';
import { AlertTriangle, X, Volume2, VolumeX } from 'lucide-react';

/**
 * TCAS-style conflict banner showing active proximity conflicts from API
 */
export function ConflictBanner({
  safetyEvents,
  acknowledgedEvents,
  onAcknowledge,
  onSelectAircraft,
  soundMuted,
  onToggleMute
}) {
  // Filter to proximity conflicts that are not acknowledged
  const proximityConflicts = safetyEvents.filter(e =>
    e.event_type === 'proximity_conflict' && !acknowledgedEvents?.has(e.id)
  );

  if (proximityConflicts.length === 0) return null;

  // Get highest severity
  const highestSeverity = proximityConflicts.some(c => c.severity === 'critical')
    ? 'critical'
    : proximityConflicts.some(c => c.severity === 'warning')
      ? 'warning'
      : 'info';

  return (
    <div className={`conflict-banner severity-${highestSeverity}`}>
      <div className="conflict-banner-header">
        <AlertTriangle size={20} />
        <span className="conflict-title">
          TRAFFIC CONFLICT{proximityConflicts.length > 1 ? 'S' : ''}
        </span>
        <button
          className="conflict-mute-btn"
          onClick={onToggleMute}
          title={soundMuted ? 'Unmute alarms' : 'Mute alarms'}
        >
          {soundMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
      </div>

      <div className="conflict-list">
        {proximityConflicts.map((event) => {
          const details = event.details || {};
          const ac1 = details.aircraft_1 || {};
          const ac2 = details.aircraft_2 || {};
          const distanceNm = details.distance_nm || 0;
          const altDiff = details.altitude_diff_ft || 0;

          return (
            <div
              key={event.id}
              className={`conflict-item severity-${event.severity}`}
            >
              <div className="conflict-aircraft">
                <span
                  className="conflict-callsign clickable"
                  onClick={() => onSelectAircraft?.(event.icao)}
                >
                  {event.callsign || event.icao}
                </span>
                <span className="conflict-separator">/</span>
                <span
                  className="conflict-callsign clickable"
                  onClick={() => onSelectAircraft?.(event.icao_2)}
                >
                  {event.callsign_2 || event.icao_2}
                </span>
              </div>

              <div className="conflict-separation">
                <span className="horizontal">
                  {distanceNm.toFixed(1)} nm
                </span>
                <span className="separator">|</span>
                <span className="vertical">
                  {altDiff.toLocaleString()} ft
                </span>
              </div>

              <div className="conflict-altitudes">
                <span>{ac1.alt?.toLocaleString() || '?'}</span>
                <span>/</span>
                <span>{ac2.alt?.toLocaleString() || '?'}</span>
              </div>

              <button
                className="conflict-ack-btn"
                onClick={() => onAcknowledge?.(event.id)}
                title="Acknowledge"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ConflictBanner;
