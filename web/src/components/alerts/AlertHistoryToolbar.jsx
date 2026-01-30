import React from 'react';
import {
  Search, Filter, ChevronDown, Check, RefreshCw,
  Download, CheckCheck, Trash2, X
} from 'lucide-react';

/**
 * Toolbar for AlertHistory with search, filters, and actions
 */
export function AlertHistoryToolbar({
  searchQuery,
  setSearchQuery,
  severityFilter,
  setSeverityFilter,
  acknowledgedFilter,
  setAcknowledgedFilter,
  loading,
  refetch,
  onExportCSV,
  onAcknowledgeAll,
  onClearAll,
  unacknowledgedCount,
  alertsCount,
  bulkActionLoading,
}) {
  return (
    <div className="alert-history-toolbar">
      {/* Search */}
      <div className="alert-history-search">
        <Search size={16} aria-hidden="true" />
        <input
          type="text"
          placeholder="Search alerts..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search alerts by rule name, aircraft, or message"
        />
        {searchQuery && (
          <button
            className="search-clear"
            onClick={() => setSearchQuery('')}
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="alert-history-filters">
        <div className="filter-select">
          <Filter size={14} aria-hidden="true" />
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            aria-label="Filter by severity"
          >
            <option value="all">All Severities</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
            <option value="emergency">Emergency</option>
          </select>
          <ChevronDown size={14} className="select-arrow" aria-hidden="true" />
        </div>

        <div className="filter-select">
          <Check size={14} aria-hidden="true" />
          <select
            value={acknowledgedFilter}
            onChange={(e) => setAcknowledgedFilter(e.target.value)}
            aria-label="Filter by acknowledged status"
          >
            <option value="all">All Status</option>
            <option value="unacknowledged">Unacknowledged</option>
            <option value="acknowledged">Acknowledged</option>
          </select>
          <ChevronDown size={14} className="select-arrow" aria-hidden="true" />
        </div>
      </div>

      {/* Actions */}
      <div className="alert-history-actions">
        <button
          className="btn-secondary btn-sm"
          onClick={refetch}
          disabled={loading}
          aria-label="Refresh alert history"
        >
          <RefreshCw size={14} className={loading ? 'spin' : ''} aria-hidden="true" />
        </button>

        <button
          className="btn-secondary btn-sm"
          onClick={onExportCSV}
          disabled={alertsCount === 0}
          aria-label="Export history as CSV"
        >
          <Download size={14} aria-hidden="true" />
          Export
        </button>

        {unacknowledgedCount > 0 && (
          <button
            className="btn-secondary btn-sm"
            onClick={onAcknowledgeAll}
            disabled={bulkActionLoading}
            aria-label={`Acknowledge all ${unacknowledgedCount} unacknowledged alerts`}
          >
            <CheckCheck size={14} aria-hidden="true" />
            Ack All ({unacknowledgedCount})
          </button>
        )}

        {alertsCount > 0 && (
          <button
            className="btn-secondary btn-sm btn-danger-outline"
            onClick={onClearAll}
            disabled={bulkActionLoading}
            aria-label="Clear all alert history"
          >
            <Trash2 size={14} aria-hidden="true" />
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

export default AlertHistoryToolbar;
