import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Bell, Trash2, Check, Clock, Plane,
  Radar, RefreshCw, Search, Filter, ChevronDown, CheckCheck, X, Download
} from 'lucide-react';
import { useSocketApi } from '../../hooks';
import { ConfirmModal } from '../common/ConfirmModal';
import { SEVERITY_ICONS, SEVERITY_LABELS, PAGE_SIZE_OPTIONS } from './alertHistoryConstants';
import { AlertHistoryItem } from './AlertHistoryItem';
import { AlertHistoryToolbar } from './AlertHistoryToolbar';

/**
 * Consolidated AlertHistory component with:
 * - Search/filter functionality
 * - Pagination
 * - Bulk acknowledge/clear actions
 * - Accessibility support
 * - Error handling with retry
 */
export function AlertHistory({ apiBase = '', wsRequest, wsConnected, onToast }) {
  // Data state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [acknowledgedFilter, setAcknowledgedFilter] = useState('all');

  // Local state for optimistic updates
  const [localAcknowledgedIds, setLocalAcknowledgedIds] = useState(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  // Confirm modal state
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, type: null });

  // Build query params
  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set('limit', pageSize.toString());
    params.set('offset', ((page - 1) * pageSize).toString());
    if (searchQuery.trim()) {
      params.set('search', searchQuery.trim());
    }
    if (severityFilter !== 'all') {
      params.set('severity', severityFilter);
    }
    if (acknowledgedFilter !== 'all') {
      params.set('acknowledged', acknowledgedFilter === 'acknowledged' ? 'true' : 'false');
    }
    return params.toString();
  }, [page, pageSize, searchQuery, severityFilter, acknowledgedFilter]);

  // Fetch alert history
  const { data: historyData, loading, error, refetch } = useSocketApi(
    `/api/v1/alerts/history?${queryParams}`,
    null,
    apiBase,
    { wsRequest, wsConnected }
  );

  // Normalize history data from Django API
  const { alerts, totalCount } = useMemo(() => {
    if (!historyData) return { alerts: [], totalCount: 0 };

    let alertList = [];
    let count = 0;

    if (Array.isArray(historyData)) {
      alertList = historyData;
      count = historyData.length;
    } else if (historyData.results) {
      alertList = historyData.results;
      count = historyData.count || historyData.results.length;
    } else if (historyData.alerts) {
      alertList = historyData.alerts;
      count = historyData.total || historyData.alerts.length;
    }

    return { alerts: alertList, totalCount: count };
  }, [historyData]);

  // Calculate pagination
  const totalPages = Math.ceil(totalCount / pageSize);
  const hasNextPage = page < totalPages;
  const hasPrevPage = page > 1;

  // Count unacknowledged alerts
  const unacknowledgedCount = useMemo(() => {
    return alerts.filter(a => !a.acknowledged && !localAcknowledgedIds.has(a.id)).length;
  }, [alerts, localAcknowledgedIds]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [searchQuery, severityFilter, acknowledgedFilter, pageSize]);

  // Acknowledge single alert
  const handleAcknowledge = async (id) => {
    try {
      // Optimistic update
      setLocalAcknowledgedIds(prev => new Set([...prev, id]));

      const res = await fetch(`${apiBase}/api/v1/alerts/history/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acknowledged: true })
      });

      if (!res.ok) {
        throw new Error('Failed to acknowledge alert');
      }

      onToast?.('Alert acknowledged', 'success');
      refetch();
    } catch (err) {
      // Rollback optimistic update
      setLocalAcknowledgedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      console.error('Failed to acknowledge alert:', err);
      onToast?.('Failed to acknowledge alert', 'error');
    }
  };

  // Acknowledge all visible unacknowledged alerts
  const handleAcknowledgeAll = async () => {
    setBulkActionLoading(true);
    setConfirmModal({ isOpen: false, type: null });

    try {
      const unacknowledgedAlerts = alerts.filter(a => !a.acknowledged && !localAcknowledgedIds.has(a.id));

      // Optimistic update for all
      setLocalAcknowledgedIds(prev => {
        const next = new Set(prev);
        unacknowledgedAlerts.forEach(a => next.add(a.id));
        return next;
      });

      // Use bulk endpoint if available, otherwise acknowledge one by one
      const res = await fetch(`${apiBase}/api/v1/alerts/history/acknowledge-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        // Fallback to individual acknowledgments
        await Promise.all(
          unacknowledgedAlerts.map(alert =>
            fetch(`${apiBase}/api/v1/alerts/history/${alert.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ acknowledged: true })
            })
          )
        );
      }

      onToast?.(`${unacknowledgedAlerts.length} alerts acknowledged`, 'success');
      refetch();
    } catch (err) {
      console.error('Failed to acknowledge all:', err);
      onToast?.('Failed to acknowledge all alerts', 'error');
      // Rollback will happen on refetch
    } finally {
      setBulkActionLoading(false);
    }
  };

  // Clear all alert history
  const handleClearAll = async () => {
    setBulkActionLoading(true);
    setConfirmModal({ isOpen: false, type: null });

    try {
      const res = await fetch(`${apiBase}/api/v1/alerts/history/clear`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        throw new Error('Failed to clear history');
      }

      setLocalAcknowledgedIds(new Set());
      setPage(1);
      onToast?.('Alert history cleared', 'success');
      refetch();
    } catch (err) {
      console.error('Failed to clear history:', err);
      onToast?.('Failed to clear alert history', 'error');
    } finally {
      setBulkActionLoading(false);
    }
  };

  // Export history as CSV
  const handleExportCSV = () => {
    const headers = ['Time', 'Rule', 'Aircraft', 'Severity', 'Message', 'Acknowledged'];
    const rows = alerts.map(alert => [
      alert.triggered_at ? new Date(alert.triggered_at).toISOString() : '',
      alert.rule_name || '',
      alert.callsign || alert.hex || alert.icao || '',
      alert.severity || alert.priority || 'info',
      alert.message || '',
      alert.acknowledged ? 'Yes' : 'No'
    ]);

    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `alert-history-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    onToast?.('Alert history exported', 'success');
  };

  // Loading state
  if (loading && alerts.length === 0) {
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

  // Error state
  if (error && alerts.length === 0) {
    return (
      <div className="alert-history-error" role="alert">
        <AlertCircle size={20} aria-hidden="true" />
        <span>Failed to load alert history</span>
        <button className="btn-secondary" onClick={refetch}>
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="alert-history-container" role="region" aria-label="Alert History">
      {/* Toolbar */}
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
            onClick={handleExportCSV}
            disabled={alerts.length === 0}
            aria-label="Export history as CSV"
          >
            <Download size={14} aria-hidden="true" />
            Export
          </button>

          {unacknowledgedCount > 0 && (
            <button
              className="btn-secondary btn-sm"
              onClick={() => setConfirmModal({ isOpen: true, type: 'acknowledgeAll' })}
              disabled={bulkActionLoading}
              aria-label={`Acknowledge all ${unacknowledgedCount} unacknowledged alerts`}
            >
              <CheckCheck size={14} aria-hidden="true" />
              Ack All ({unacknowledgedCount})
            </button>
          )}

          {alerts.length > 0 && (
            <button
              className="btn-secondary btn-sm btn-danger-outline"
              onClick={() => setConfirmModal({ isOpen: true, type: 'clearAll' })}
              disabled={bulkActionLoading}
              aria-label="Clear all alert history"
            >
              <Trash2 size={14} aria-hidden="true" />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Alert count */}
      <div className="alert-history-summary" aria-live="polite">
        <span className="alert-count">
          {totalCount} alert{totalCount !== 1 ? 's' : ''}
          {unacknowledgedCount > 0 && (
            <span className="unacknowledged-count">
              ({unacknowledgedCount} unacknowledged)
            </span>
          )}
        </span>

        {/* Page size selector */}
        <div className="page-size-select">
          <label htmlFor="page-size">Show:</label>
          <select
            id="page-size"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
          >
            {PAGE_SIZE_OPTIONS.map(size => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Alert list */}
      {alerts.length === 0 ? (
        <div className="alert-history-empty" role="status">
          <Bell size={48} className="empty-icon" aria-hidden="true" />
          <p>No alerts found</p>
          <span>
            {searchQuery || severityFilter !== 'all' || acknowledgedFilter !== 'all'
              ? 'Try adjusting your filters'
              : 'Triggered alerts will appear here'}
          </span>
          {(searchQuery || severityFilter !== 'all' || acknowledgedFilter !== 'all') && (
            <button
              className="btn-secondary"
              onClick={() => {
                setSearchQuery('');
                setSeverityFilter('all');
                setAcknowledgedFilter('all');
              }}
            >
              Clear Filters
            </button>
          )}
        </div>
      ) : (
        <div
          className="alert-history-list"
          role="feed"
          aria-label="Alert history items"
          aria-busy={loading}
        >
          {alerts.map((alert, index) => {
            const isAcknowledged = alert.acknowledged || localAcknowledgedIds.has(alert.id);
            const severity = alert.severity || alert.priority || 'info';
            const SeverityIcon = SEVERITY_ICONS[severity] || Info;
            const severityLabel = SEVERITY_LABELS[severity] || 'Info';
            const alertIdentifier = alert.callsign || alert.hex || alert.icao || 'Unknown';
            const timestamp = alert.triggered_at || alert.timestamp || alert.created_at;

            return (
              <article
                key={alert.id}
                className={`alert-history-item ${isAcknowledged ? 'acknowledged' : ''} severity-${severity}`}
                aria-label={`${severityLabel} alert: ${alert.rule_name || 'Alert'}${isAcknowledged ? ', acknowledged' : ''}`}
                aria-setsize={alerts.length}
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
                      onClick={() => handleAcknowledge(alert.id)}
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
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="alert-history-pagination" role="navigation" aria-label="Alert history pages">
          <button
            className="btn-secondary btn-sm"
            onClick={() => setPage(1)}
            disabled={!hasPrevPage}
            aria-label="First page"
          >
            First
          </button>
          <button
            className="btn-secondary btn-sm"
            onClick={() => setPage(p => p - 1)}
            disabled={!hasPrevPage}
            aria-label="Previous page"
          >
            Previous
          </button>

          <span className="pagination-info">
            Page {page} of {totalPages}
          </span>

          <button
            className="btn-secondary btn-sm"
            onClick={() => setPage(p => p + 1)}
            disabled={!hasNextPage}
            aria-label="Next page"
          >
            Next
          </button>
          <button
            className="btn-secondary btn-sm"
            onClick={() => setPage(totalPages)}
            disabled={!hasNextPage}
            aria-label="Last page"
          >
            Last
          </button>
        </div>
      )}

      {/* Confirm Modals */}
      <ConfirmModal
        isOpen={confirmModal.isOpen && confirmModal.type === 'acknowledgeAll'}
        onConfirm={handleAcknowledgeAll}
        onCancel={() => setConfirmModal({ isOpen: false, type: null })}
        title="Acknowledge All Alerts"
        message={`Are you sure you want to acknowledge ${unacknowledgedCount} unacknowledged alert${unacknowledgedCount !== 1 ? 's' : ''}?`}
        confirmText="Acknowledge All"
        variant="info"
        loading={bulkActionLoading}
      />

      <ConfirmModal
        isOpen={confirmModal.isOpen && confirmModal.type === 'clearAll'}
        onConfirm={handleClearAll}
        onCancel={() => setConfirmModal({ isOpen: false, type: null })}
        title="Clear Alert History"
        message="Are you sure you want to clear all alert history? This action cannot be undone."
        confirmText="Clear All"
        variant="danger"
        loading={bulkActionLoading}
      />
    </div>
  );
}

export default AlertHistory;
