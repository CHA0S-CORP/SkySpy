import React, { useState } from 'react';
import { Clock, User, FileText, Calendar, ChevronDown, AlertCircle } from 'lucide-react';
import { ScrollArea } from '../ui';

/**
 * Admin Audit Log Component
 * Displays a paginated list of audit log entries for configuration changes.
 *
 * @param {Object} props
 * @param {Array} props.entries - Array of audit log entries
 * @param {boolean} props.loading - Loading state
 * @param {Function} props.onLoadMore - Callback to load more entries
 * @param {boolean} props.hasMore - Whether more entries are available
 */
export function AdminAuditLog({
  entries = [],
  loading = false,
  onLoadMore,
  hasMore = false,
}) {
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [showFilters, setShowFilters] = useState(false);

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return '--';
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const formatDetails = (details) => {
    if (!details) return '--';
    if (typeof details === 'object') {
      return JSON.stringify(details, null, 2);
    }
    if (details.length > 100) {
      return details.substring(0, 100) + '...';
    }
    return details;
  };

  const getActionBadgeClass = (action) => {
    const actionLower = (action || '').toLowerCase();
    if (actionLower.includes('create') || actionLower.includes('add')) {
      return 'admin-audit-action-create';
    }
    if (actionLower.includes('delete') || actionLower.includes('remove')) {
      return 'admin-audit-action-delete';
    }
    if (actionLower.includes('update') || actionLower.includes('change') || actionLower.includes('modify')) {
      return 'admin-audit-action-update';
    }
    return 'admin-audit-action-default';
  };

  // Filter entries by date range if set
  const filteredEntries = entries.filter((entry) => {
    if (!dateRange.start && !dateRange.end) return true;
    const entryDate = new Date(entry.timestamp);
    if (dateRange.start && entryDate < new Date(dateRange.start)) return false;
    if (dateRange.end && entryDate > new Date(dateRange.end + 'T23:59:59')) return false;
    return true;
  });

  const clearFilters = () => {
    setDateRange({ start: '', end: '' });
  };

  const hasActiveFilters = dateRange.start || dateRange.end;

  return (
    <div className="admin-audit-log">
      {/* Header with optional date filter */}
      <div className="admin-audit-header">
        <div className="admin-audit-title">
          <FileText size={18} />
          <h3>Audit Log</h3>
          <span className="admin-audit-count">
            {filteredEntries.length} {filteredEntries.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>

        <button
          type="button"
          className={`admin-audit-filter-toggle ${showFilters ? 'active' : ''}`}
          onClick={() => setShowFilters(!showFilters)}
        >
          <Calendar size={14} />
          Filter by Date
          <ChevronDown size={14} className={showFilters ? 'rotated' : ''} />
        </button>
      </div>

      {/* Date range filter (collapsible) */}
      {showFilters && (
        <div className="admin-audit-filters">
          <div className="admin-audit-date-range">
            <label>
              <span>From:</span>
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange((prev) => ({ ...prev, start: e.target.value }))}
                className="admin-audit-date-input"
              />
            </label>
            <label>
              <span>To:</span>
              <input
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange((prev) => ({ ...prev, end: e.target.value }))}
                className="admin-audit-date-input"
              />
            </label>
          </div>
          {hasActiveFilters && (
            <button type="button" className="admin-audit-clear-filter" onClick={clearFilters}>
              Clear Filters
            </button>
          )}
        </div>
      )}

      {/* Audit log content */}
      <ScrollArea className="admin-audit-scroll">
        {loading && entries.length === 0 ? (
          <div className="admin-audit-loading">Loading audit log...</div>
        ) : filteredEntries.length === 0 ? (
          <div className="admin-audit-empty">
            <AlertCircle size={32} />
            <p>No audit log entries found.</p>
            {hasActiveFilters && (
              <button type="button" className="admin-audit-clear-filter" onClick={clearFilters}>
                Clear Filters
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Table view */}
            <div className="admin-audit-table-wrapper">
              <table className="admin-audit-table">
                <thead>
                  <tr>
                    <th className="admin-audit-col-timestamp">Timestamp</th>
                    <th className="admin-audit-col-user">User</th>
                    <th className="admin-audit-col-action">Action</th>
                    <th className="admin-audit-col-resource">Resource</th>
                    <th className="admin-audit-col-details">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry, index) => (
                    <tr key={entry.id || index} className="admin-audit-row">
                      <td className="admin-audit-col-timestamp">
                        <span className="admin-audit-timestamp">
                          <Clock size={12} />
                          {formatTimestamp(entry.timestamp)}
                        </span>
                      </td>
                      <td className="admin-audit-col-user">
                        <span className="admin-audit-user">
                          <User size={12} />
                          {entry.user || 'System'}
                        </span>
                      </td>
                      <td className="admin-audit-col-action">
                        <span className={`admin-audit-action ${getActionBadgeClass(entry.action)}`}>
                          {entry.action || '--'}
                        </span>
                      </td>
                      <td className="admin-audit-col-resource">
                        <span className="admin-audit-resource" title={entry.resource}>
                          {entry.resource || '--'}
                        </span>
                      </td>
                      <td className="admin-audit-col-details">
                        <span className="admin-audit-details" title={typeof entry.details === 'object' ? JSON.stringify(entry.details) : entry.details}>
                          {formatDetails(entry.details)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Load more button */}
            {hasMore && (
              <div className="admin-audit-load-more">
                <button
                  type="button"
                  className="admin-audit-load-more-btn"
                  onClick={onLoadMore}
                  disabled={loading}
                >
                  {loading ? 'Loading...' : 'Load More'}
                </button>
              </div>
            )}
          </>
        )}
      </ScrollArea>
    </div>
  );
}

export default AdminAuditLog;
