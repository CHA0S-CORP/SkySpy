import React from 'react';
import { Check, Clock, Plane } from 'lucide-react';
import { SEVERITY_ICONS, SEVERITY_LABELS } from './alertHistoryConstants';

/**
 * Single alert history item component
 */
export function AlertHistoryItem({
  alert,
  index,
  totalCount,
  isAcknowledged,
  onAcknowledge,
}) {
  const severity = alert.severity || alert.priority || 'info';
  const SeverityIcon = SEVERITY_ICONS[severity] || SEVERITY_ICONS.info;
  const severityLabel = SEVERITY_LABELS[severity] || 'Info';
  const alertIdentifier = alert.callsign || alert.hex || alert.icao || 'Unknown';
  const timestamp = alert.triggered_at || alert.timestamp || alert.created_at;

  return (
    <article
      className={`alert-history-item ${isAcknowledged ? 'acknowledged' : ''} severity-${severity}`}
      aria-label={`${severityLabel} alert: ${alert.rule_name || 'Alert'}${isAcknowledged ? ', acknowledged' : ''}`}
      aria-setsize={totalCount}
      aria-posinset={index + 1}
    >
      <div className={`alert-history-icon ${severity}`}>
        <SeverityIcon size={20} aria-hidden="true" />
        <span className="sr-only">{severityLabel}</span>
      </div>

      <div className="alert-history-content">
        <div className="alert-history-header">
          <span className="alert-history-title">{alert.rule_name || 'Alert Triggered'}</span>
          <span className={`alert-severity-badge ${severity}`}>
            {severity}
          </span>
        </div>

        <div className="alert-history-aircraft">
          <Plane size={12} aria-hidden="true" />
          <span>{alertIdentifier}</span>
        </div>

        {alert.message && (
          <div className="alert-history-message">
            {alert.message}
          </div>
        )}
      </div>

      <div className="alert-history-meta">
        <time className="alert-history-time" dateTime={timestamp}>
          <Clock size={12} aria-hidden="true" />
          {timestamp ? new Date(timestamp).toLocaleString() : '--'}
        </time>

        {!isAcknowledged ? (
          <button
            className="alert-ack-btn"
            onClick={() => onAcknowledge(alert.id)}
            aria-label={`Acknowledge alert: ${alert.rule_name || 'Alert'}`}
          >
            <Check size={14} aria-hidden="true" />
            Ack
          </button>
        ) : (
          <span className="alert-acknowledged-badge" aria-label="Acknowledged">
            <Check size={12} aria-hidden="true" />
          </span>
        )}
      </div>
    </article>
  );
}

export default AlertHistoryItem;
