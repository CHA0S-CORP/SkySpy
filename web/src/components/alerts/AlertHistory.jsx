import React, { useState, useEffect } from 'react';
import { Bell, Trash2 } from 'lucide-react';

export function AlertHistory() {
  const [history, setHistory] = useState([]);

  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem('alert-history') || '[]');
    setHistory(stored);
  }, []);

  const clearHistory = () => {
    localStorage.setItem('alert-history', '[]');
    setHistory([]);
  };

  return (
    <div className="alert-history-container">
      {history.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <button className="btn-secondary" onClick={clearHistory}>
            <Trash2 size={14} /> Clear History
          </button>
        </div>
      )}

      {history.length === 0 ? (
        <div className="empty-state">
          No alert history yet. Alerts will appear here when triggered.
        </div>
      ) : (
        history.map(alert => (
          <div key={alert.id} className="alert-history-item">
            <div className={`alert-history-icon ${alert.priority || 'info'}`}>
              <Bell size={20} />
            </div>
            <div className="alert-history-content">
              <div className="alert-history-title">{alert.rule_name || 'Alert Triggered'}</div>
              <div className="alert-history-message">
                {alert.message || `Aircraft ${alert.icao} matched rule conditions`}
              </div>
            </div>
            <div className="alert-history-time">
              {new Date(alert.timestamp).toLocaleString()}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
