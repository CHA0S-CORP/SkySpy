import React from 'react';
import { RefreshCw } from 'lucide-react';
import { NOTAM_TYPES } from './notamTypes';
import { formatRelativeTime } from './notamUtils';

// Stats Summary
export function NotamStats({ stats }) {
  if (!stats) return null;

  return (
    <div className="notam-stats">
      <div className="stat-item">
        <span className="stat-value">{stats.total_active || 0}</span>
        <span className="stat-label">Active NOTAMs</span>
      </div>
      <div className="stat-item tfr">
        <span className="stat-value">{stats.tfr_count || 0}</span>
        <span className="stat-label">Active TFRs</span>
      </div>
      {stats.by_type && Object.entries(stats.by_type).map(([type, count]) => (
        <div key={type} className="stat-item mini">
          <span className="stat-value">{count}</span>
          <span className="stat-label">{NOTAM_TYPES[type]?.label || type}</span>
        </div>
      ))}
      {stats.last_update && (
        <div className="stat-item update-time">
          <RefreshCw size={12} />
          <span>Updated {formatRelativeTime(stats.last_update)}</span>
        </div>
      )}
    </div>
  );
}

export default NotamStats;
