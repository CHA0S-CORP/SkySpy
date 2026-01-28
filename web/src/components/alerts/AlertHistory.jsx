import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Bell, Trash2, Info, AlertTriangle, AlertCircle, Check, Clock, Plane, Radar, RefreshCw } from 'lucide-react';

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

export function AlertHistory({ apiBase = '', wsRequest, wsConnected }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [acknowledgedIds, setAcknowledgedIds] = useState(new Set());

  // Fetch alert history from Django API
  const fetchHistory = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${apiBase}/api/v1/alerts/history?limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Invalid response format');
      }
      const data = await res.json();
      // Normalize response (may be array, {results: [...]} or {alerts: [...]})
      const alerts = Array.isArray(data) ? data :
                     data.results ? data.results :
                     data.alerts ? data.alerts : [];
      setHistory(alerts);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Acknowledge an alert
  const handleAcknowledge = async (id) => {
    try {
      await fetch(`${apiBase}/api/v1/alerts/history/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acknowledged: true })
      });
      setAcknowledgedIds(prev => new Set([...prev, id]));
      fetchHistory();
    } catch (err) {
      console.error('Failed to acknowledge alert:', err);
    }
  };

  if (loading) {
    return (
      <div className="alert-history-loading" role="status" aria-live="polite">
        <Radar size={24} className="alert-radar-icon" aria-hidden="true" />
        <span>Loading alert history...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert-history-error" role="alert">
        <AlertCircle size={20} aria-hidden="true" />
        <span>Failed to load alert history: {error}</span>
        <button className="btn-secondary" onClick={fetchHistory}>
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  return (
    <div
      className="alert-history-container"
      role="region"
      aria-label="Alert History"
    >
      {history.length > 0 && (
        <div className="alert-history-header" style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="alert-count">{history.length} alert{history.length !== 1 ? 's' : ''}</span>
          <button
            className="btn-secondary btn-sm"
            onClick={fetchHistory}
            aria-label="Refresh alert history"
          >
            <RefreshCw size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      {history.length === 0 ? (
        <div className="empty-state" role="status">
          No alert history yet. Alerts will appear here when triggered.
        </div>
      ) : (
        <div role="feed" aria-label="Alert history items">
          {history.map((alert, index) => {
            const priority = alert.priority || alert.severity || 'info';
            const SeverityIcon = SEVERITY_ICONS[priority] || Bell;
            const severityLabel = SEVERITY_LABELS[priority] || 'Info';
            const isAcknowledged = alert.acknowledged || acknowledgedIds.has(alert.id);
            const alertIdentifier = alert.callsign || alert.hex || alert.icao || 'Unknown';
            const timestamp = alert.triggered_at || alert.timestamp || alert.created_at;

            return (
              <article
                key={alert.id}
                className={`alert-history-item ${isAcknowledged ? 'acknowledged' : ''}`}
                aria-label={`${severityLabel} alert: ${alert.rule_name || 'Alert Triggered'}${isAcknowledged ? ', acknowledged' : ''}`}
                aria-setsize={history.length}
                aria-posinset={index + 1}
              >
                <div className={`alert-history-icon ${priority}`}>
                  <SeverityIcon size={20} aria-hidden="true" />
                  <span className="sr-only">{severityLabel}</span>
                </div>
                <div className="alert-history-content">
                  <div className="alert-history-title">{alert.rule_name || 'Alert Triggered'}</div>
                  <div className="alert-history-aircraft">
                    <Plane size={12} aria-hidden="true" />
                    <span>{alertIdentifier}</span>
                  </div>
                  <div className="alert-history-message">
                    {alert.message || `Aircraft ${alertIdentifier} matched rule conditions`}
                  </div>
                </div>
                <div className="alert-history-meta">
                  <time className="alert-history-time" dateTime={timestamp}>
                    <Clock size={12} aria-hidden="true" />
                    {timestamp ? new Date(timestamp).toLocaleString() : '--'}
                  </time>
                  {!isAcknowledged && (
                    <button
                      className="alert-ack-btn"
                      onClick={() => handleAcknowledge(alert.id)}
                      aria-label={`Acknowledge alert: ${alert.rule_name || 'Alert'}`}
                    >
                      <Check size={14} aria-hidden="true" />
                      Ack
                    </button>
                  )}
                  {isAcknowledged && (
                    <span className="alert-acknowledged-badge" aria-label="Acknowledged">
                      <Check size={12} aria-hidden="true" />
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
