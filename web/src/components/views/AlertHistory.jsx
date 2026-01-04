import React, { useState, useEffect } from 'react';
import { AlertTriangle, Clock, Plane, Check, Radar } from 'lucide-react';
import { useApi } from '../../hooks';

export function AlertHistory({ apiBase }) {
  const { data: history, loading, error, refetch } = useApi('/api/v1/alerts/history?limit=50', null, apiBase);
  const [acknowledgedIds, setAcknowledgedIds] = useState(new Set());

  const handleAcknowledge = async (id) => {
    try {
      await fetch(`${apiBase}/api/v1/alerts/history/${id}/acknowledge`, { method: 'POST' });
      setAcknowledgedIds(prev => new Set([...prev, id]));
      refetch();
    } catch (err) {
      console.error('Failed to acknowledge alert:', err);
    }
  };

  if (loading) {
    return (
      <div className="alert-history-loading">
        <div className="alert-loading-radar">
          <Radar size={32} className="alert-radar-icon" />
          <div className="alert-radar-sweep" />
        </div>
        <span>Loading alert history...</span>
      </div>
    );
  }

  if (error) {
    return <div className="alert-history-error">Failed to load alert history</div>;
  }

  const alerts = history?.alerts || [];

  if (alerts.length === 0) {
    return (
      <div className="alert-history-empty">
        <AlertTriangle size={48} className="empty-icon" />
        <p>No alert history</p>
        <span>Triggered alerts will appear here</span>
      </div>
    );
  }

  return (
    <div className="alert-history">
      <div className="alert-history-header">
        <h3>Alert History</h3>
        <span className="alert-count">{alerts.length} alerts</span>
      </div>
      
      <div className="alert-history-list">
        {alerts.map(alert => {
          const isAcknowledged = alert.acknowledged || acknowledgedIds.has(alert.id);
          
          return (
            <div 
              key={alert.id} 
              className={`alert-history-item ${isAcknowledged ? 'acknowledged' : ''} severity-${alert.severity || 'info'}`}
            >
              <div className="alert-item-header">
                <span className="alert-rule-name">{alert.rule_name || 'Unknown Rule'}</span>
                <span className={`alert-severity ${alert.severity || 'info'}`}>
                  {alert.severity || 'info'}
                </span>
              </div>
              
              <div className="alert-item-content">
                <div className="alert-aircraft">
                  <Plane size={14} />
                  <span>{alert.callsign || alert.hex || 'Unknown'}</span>
                </div>
                
                {alert.message && (
                  <div className="alert-message">{alert.message}</div>
                )}
                
                <div className="alert-meta">
                  <span className="alert-time">
                    <Clock size={12} />
                    {alert.triggered_at 
                      ? new Date(alert.triggered_at).toLocaleString()
                      : '--'}
                  </span>
                </div>
              </div>
              
              {!isAcknowledged && (
                <button 
                  className="alert-ack-btn"
                  onClick={() => handleAcknowledge(alert.id)}
                >
                  <Check size={14} />
                  Acknowledge
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default AlertHistory;
