import React, { useEffect, useState } from 'react';
import { Clock, User, ArrowRight, RefreshCw } from 'lucide-react';

/**
 * Displays configuration change audit log.
 */
export function ConfigAuditLog({
  auditLog = [],
  loading = false,
  onRefresh,
  selectedConfig = null,
}) {
  const [hours, setHours] = useState(24);

  useEffect(() => {
    if (onRefresh) {
      onRefresh(selectedConfig, hours);
    }
  }, [hours, selectedConfig, onRefresh]);

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const formatValue = (value) => {
    if (!value || value === '****') return <span className="audit-value-masked">****</span>;
    if (value.length > 50) {
      return <span title={value}>{value.substring(0, 50)}...</span>;
    }
    return value;
  };

  return (
    <div className="config-audit-log">
      <div className="config-audit-header">
        <h3>Change History</h3>
        <div className="config-audit-controls">
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="config-audit-hours"
          >
            <option value={1}>Last hour</option>
            <option value={6}>Last 6 hours</option>
            <option value={24}>Last 24 hours</option>
            <option value={168}>Last 7 days</option>
            <option value={720}>Last 30 days</option>
          </select>
          <button
            type="button"
            className="config-audit-refresh"
            onClick={() => onRefresh && onRefresh(selectedConfig, hours)}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'spinning' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="config-audit-loading">Loading audit log...</div>
      ) : auditLog.length === 0 ? (
        <div className="config-audit-empty">No changes recorded in the selected time period.</div>
      ) : (
        <div className="config-audit-list">
          {auditLog.map((entry, index) => (
            <div key={entry.id || index} className="config-audit-entry">
              <div className="config-audit-entry-header">
                <span className="config-audit-key" title={entry.config_key}>
                  {entry.config_display_name || entry.config_key}
                </span>
                <span className="config-audit-time">
                  <Clock size={12} />
                  {formatDate(entry.changed_at)}
                </span>
              </div>

              <div className="config-audit-change">
                <span className="config-audit-old">{formatValue(entry.old_value)}</span>
                <ArrowRight size={14} className="config-audit-arrow" />
                <span className="config-audit-new">{formatValue(entry.new_value)}</span>
              </div>

              <div className="config-audit-meta">
                <span className="config-audit-user">
                  <User size={12} />
                  {entry.changed_by_username || 'System'}
                </span>
                {entry.ip_address && (
                  <span className="config-audit-ip">IP: {entry.ip_address}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
