import React, { useState, useEffect } from 'react';
import { AlertTriangle, Clock, Plane, Check, Radar, Info, AlertCircle } from 'lucide-react';
import { useSocketApi } from '../../hooks';

// Severity icons that don't rely on color alone
const SEVERITY_ICONS = {
  info: Info,
  warning: AlertTriangle,
  critical: AlertCircle,
  emergency: AlertCircle,
};

// Severity labels for screen readers
const SEVERITY_LABELS = {
  info: 'Information',
  warning: 'Warning',
  critical: 'Critical',
  emergency: 'Emergency',
};

export function AlertHistory({ apiBase, wsRequest, wsConnected }) {
  const { data: historyData, loading, error, refetch } = useSocketApi('/api/v1/alerts/history?limit=50', null, apiBase, { wsRequest, wsConnected });
  const [acknowledgedIds, setAcknowledgedIds] = useState(new Set());

  // Normalize history data from Django API (may be array, {results: [...]} or {alerts: [...]})
  const history = React.useMemo(() => {
    if (!historyData) return { alerts: [] };
    if (Array.isArray(historyData)) return { alerts: historyData };
    if (historyData.results) return { alerts: historyData.results };
    if (historyData.alerts) return historyData;
    return { alerts: [] };
  }, [historyData]);

  const handleAcknowledge = async (id) => {
    try {
      // Django REST Framework uses PATCH for partial updates
      await fetch(`${apiBase}/api/v1/alerts/history/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acknowledged: true })
      });
      setAcknowledgedIds(prev => new Set([...prev, id]));
      refetch();
    } catch (err) {
      console.error('Failed to acknowledge alert:', err);
    }
  };

  if (loading) {
    return (
      <div className="alert-history-loading" role="status" aria-live="polite">
        <div className="alert-loading-radar" aria-hidden="true">
          <Radar size={32} className="alert-radar-icon" />
          <div className="alert-radar-sweep" />
        </div>
        <span>Loading alert history...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert-history-error" role="alert" aria-live="assertive">
        <AlertCircle size={20} aria-hidden="true" />
        <span>Failed to load alert history</span>
      </div>
    );
  }

  const alerts = history?.alerts || [];

  if (alerts.length === 0) {
    return (
      <div className="alert-history-empty" role="status">
        <AlertTriangle size={48} className="empty-icon" aria-hidden="true" />
        <p>No alert history</p>
        <span>Triggered alerts will appear here</span>
      </div>
    );
  }

  return (
    <div className="alert-history" role="region" aria-label="Alert History">
      <div className="alert-history-header">
        <h3 id="alert-history-title">Alert History</h3>
        <span className="alert-count" aria-live="polite">
          {alerts.length} alert{alerts.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div
        className="alert-history-list"
        role="feed"
        aria-labelledby="alert-history-title"
        aria-busy={loading}
      >
        {alerts.map((alert, index) => {
          const isAcknowledged = alert.acknowledged || acknowledgedIds.has(alert.id);
          const severity = alert.severity || 'info';
          const SeverityIcon = SEVERITY_ICONS[severity] || Info;
          const severityLabel = SEVERITY_LABELS[severity] || 'Info';
          const alertIdentifier = alert.callsign || alert.hex || 'Unknown';

          return (
            <article
              key={alert.id}
              className={`alert-history-item ${isAcknowledged ? 'acknowledged' : ''} severity-${severity}`}
              aria-label={`${severityLabel} alert: ${alert.rule_name || 'Unknown Rule'} for ${alertIdentifier}${isAcknowledged ? ', acknowledged' : ', unacknowledged'}`}
              aria-setsize={alerts.length}
              aria-posinset={index + 1}
            >
              <div className="alert-item-header">
                <span className="alert-rule-name">{alert.rule_name || 'Unknown Rule'}</span>
                <span className={`alert-severity ${severity}`}>
                  <SeverityIcon size={12} aria-hidden="true" className="severity-icon" />
                  <span>{severity}</span>
                  <span className="sr-only">{severityLabel} severity</span>
                </span>
              </div>

              <div className="alert-item-content">
                <div className="alert-aircraft">
                  <Plane size={14} aria-hidden="true" />
                  <span aria-label="Aircraft">{alertIdentifier}</span>
                </div>

                {alert.message && (
                  <div className="alert-message" aria-label="Alert message">
                    {alert.message}
                  </div>
                )}

                <div className="alert-meta">
                  <span className="alert-time">
                    <Clock size={12} aria-hidden="true" />
                    <time dateTime={alert.triggered_at} aria-label="Triggered at">
                      {alert.triggered_at
                        ? new Date(alert.triggered_at).toLocaleString()
                        : '--'}
                    </time>
                  </span>
                </div>
              </div>

              {!isAcknowledged && (
                <button
                  className="alert-ack-btn"
                  onClick={() => handleAcknowledge(alert.id)}
                  aria-label={`Acknowledge alert: ${alert.rule_name || 'Unknown Rule'} for ${alertIdentifier}`}
                >
                  <Check size={14} aria-hidden="true" />
                  Acknowledge
                </button>
              )}

              {isAcknowledged && (
                <div className="alert-acknowledged-badge" aria-label="Alert acknowledged">
                  <Check size={14} aria-hidden="true" />
                  <span className="sr-only">Acknowledged</span>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

export default AlertHistory;
