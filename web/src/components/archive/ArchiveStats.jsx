import React from 'react';
import { FileWarning, Cloud, Loader2 } from 'lucide-react';

// Archive Stats Summary
export function ArchiveStats({ stats, loading }) {
  if (loading || !stats) {
    return (
      <div className="archive-stats loading">
        <Loader2 size={20} className="spin" />
        <span>Loading statistics...</span>
      </div>
    );
  }

  return (
    <div className="archive-stats">
      <div className="stat-group">
        <h4>
          <FileWarning size={16} />
          NOTAMs
        </h4>
        <div className="stat-item">
          <span className="stat-value">{stats.notams?.total_archived || 0}</span>
          <span className="stat-label">Total Archived</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{stats.notams?.archived_last_30_days || 0}</span>
          <span className="stat-label">Last 30 Days</span>
        </div>
      </div>
      <div className="stat-group">
        <h4>
          <Cloud size={16} />
          PIREPs
        </h4>
        <div className="stat-item">
          <span className="stat-value">{stats.pireps?.total_archived || 0}</span>
          <span className="stat-label">Total Archived</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{stats.pireps?.total_records || 0}</span>
          <span className="stat-label">Total Records</span>
        </div>
      </div>
    </div>
  );
}

export default ArchiveStats;
