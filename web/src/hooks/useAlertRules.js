import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSocketApi } from './index';
import { useSocketIO } from './socket';
import {
  exportAllRules,
  exportSingleRule,
  downloadAsJson,
  downloadAsCsv,
  generateFilename,
  parseImportFile,
  findDuplicates,
  convertToApiFormat,
} from '../utils/ruleImportExport';
import { UNDO_GRACE_PERIOD } from '../components/alerts/alertConstants';

export function useAlertRules({ apiBase, wsRequest, wsConnected, onToast }) {
  const { data: rulesData, refetch } = useSocketApi('/api/v1/alerts/rules', null, apiBase, {
    wsRequest,
    wsConnected,
  });

  // Real-time alerts from WebSocket
  const [realtimeAlerts, setRealtimeAlerts] = useState([]);

  // Undo delete state
  const [pendingDelete, setPendingDelete] = useState(null);
  const undoTimeoutRef = useRef(null);

  // Ref to hold wsRequest to avoid stale closures in setTimeout callbacks
  const wsRequestRef = useRef(wsRequest);

  // Import state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importData, setImportData] = useState(null);
  const [importOption, setImportOption] = useState('skip');
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('name-asc');

  // Toast helper
  const showToast = useCallback(
    (message, type = 'info') => {
      if (onToast) {
        onToast(message, type);
      }
    },
    [onToast]
  );

  // Normalize rules data from Django API
  const data = useMemo(() => {
    if (!rulesData) return { rules: [] };
    if (Array.isArray(rulesData)) return { rules: rulesData };
    if (rulesData.results) return { rules: rulesData.results };
    if (rulesData.rules) return rulesData;
    return { rules: [] };
  }, [rulesData]);

  // Socket.IO for real-time alert notifications
  const { connected: alertsConnected, on: onAlertEvent } = useSocketIO({
    enabled: true,
    apiBase,
    namespace: '/alerts',
    path: '/socket.io',
  });

  // Track event listener unsubscribers to prevent stacking on reconnect
  const alertListenersRef = useRef({ triggered: null, snapshot: null });

  // Set up alert event listeners
  useEffect(() => {
    // Always clean up previous listeners first to prevent stacking
    if (alertListenersRef.current.triggered) {
      alertListenersRef.current.triggered();
      alertListenersRef.current.triggered = null;
    }
    if (alertListenersRef.current.snapshot) {
      alertListenersRef.current.snapshot();
      alertListenersRef.current.snapshot = null;
    }

    if (!alertsConnected) return;

    const handleAlertTriggered = (data) => {
      setRealtimeAlerts((prev) => [data, ...prev].slice(0, 50));
    };

    const handleAlertSnapshot = (data) => {
      setRealtimeAlerts(data?.alerts || []);
    };

    alertListenersRef.current.triggered = onAlertEvent('alert:triggered', handleAlertTriggered);
    alertListenersRef.current.snapshot = onAlertEvent('alert:snapshot', handleAlertSnapshot);

    return () => {
      if (alertListenersRef.current.triggered) {
        alertListenersRef.current.triggered();
        alertListenersRef.current.triggered = null;
      }
      if (alertListenersRef.current.snapshot) {
        alertListenersRef.current.snapshot();
        alertListenersRef.current.snapshot = null;
      }
    };
  }, [alertsConnected, onAlertEvent]);

  // Keep wsRequestRef updated with current wsRequest
  useEffect(() => {
    wsRequestRef.current = wsRequest;
  }, [wsRequest]);

  // Cleanup undo timeout on unmount
  useEffect(() => {
    return () => {
      if (undoTimeoutRef.current) {
        clearTimeout(undoTimeoutRef.current);
      }
    };
  }, []);

  // Handle delete with undo support
  const handleDelete = useCallback(
    async (rule) => {
      if (!wsRequest || !wsConnected) {
        showToast('Not connected to server', 'error');
        return;
      }

      // Capture the rule ID for validation in the timeout callback
      const ruleIdToDelete = rule.id;
      const deleteTimestamp = Date.now();

      // Clear any existing undo timeout first to prevent orphaned timeouts
      if (undoTimeoutRef.current) {
        clearTimeout(undoTimeoutRef.current);
        undoTimeoutRef.current = null;
      }

      setPendingDelete({
        rule,
        timestamp: deleteTimestamp,
      });

      showToast(`Rule "${rule.name}" deleted. Click Undo to restore.`, 'warning');

      undoTimeoutRef.current = setTimeout(async () => {
        try {
          // Use wsRequestRef.current to access the latest wsRequest (avoids stale closure)
          const currentWsRequest = wsRequestRef.current;
          if (!currentWsRequest) {
            throw new Error('WebSocket not available');
          }

          // Validate that this is still the pending delete we intended
          // This prevents race conditions when multiple deletes are triggered rapidly
          // Note: We check against the captured ruleIdToDelete, not pendingDelete state
          // because pendingDelete may have been updated by a subsequent delete call
          const result = await currentWsRequest('alert-rule-delete', { id: ruleIdToDelete });
          if (result?.error) {
            throw new Error(result.error);
          }
          showToast(`Rule "${rule.name}" permanently deleted`, 'success');
          refetch();
        } catch (err) {
          console.error('Failed to delete rule:', err);
          showToast('Failed to delete rule', 'error');
        } finally {
          // Only clear pendingDelete if it's still the same rule we started with
          setPendingDelete((prev) => {
            if (prev?.rule?.id === ruleIdToDelete && prev?.timestamp === deleteTimestamp) {
              return null;
            }
            return prev;
          });
        }
      }, UNDO_GRACE_PERIOD);
    },
    [wsRequest, wsConnected, refetch, showToast]
  );

  // Handle undo delete
  const handleUndoDelete = useCallback(() => {
    if (undoTimeoutRef.current) {
      clearTimeout(undoTimeoutRef.current);
      undoTimeoutRef.current = null;
    }
    const ruleName = pendingDelete?.rule?.name || 'Rule';
    setPendingDelete(null);
    showToast(`"${ruleName}" restored`, 'success');
  }, [pendingDelete, showToast]);

  // Handle toggle rule enabled/disabled
  const handleToggle = useCallback(
    async (rule) => {
      if (!wsRequest || !wsConnected) {
        showToast('Not connected to server', 'error');
        return;
      }

      try {
        const result = await wsRequest('alert-rule-toggle', {
          id: rule.id,
          enabled: !rule.enabled,
        });
        if (result?.error) {
          throw new Error(result.error);
        }

        showToast(`Rule "${rule.name}" ${rule.enabled ? 'disabled' : 'enabled'}`, 'success');
        refetch();
      } catch (err) {
        console.error('Failed to toggle rule:', err);
        showToast('Failed to update rule', 'error');
      }
    },
    [wsRequest, wsConnected, refetch, showToast]
  );

  // Export all rules as JSON
  const handleExportAll = useCallback(() => {
    if (!data?.rules?.length) return;
    const exportData = exportAllRules(data.rules);
    downloadAsJson(exportData, generateFilename());
    showToast('All rules exported', 'success');
  }, [data?.rules, showToast]);

  // Export all rules as CSV
  const handleExportCsv = useCallback(() => {
    if (!data?.rules?.length) return;
    const date = new Date().toISOString().split('T')[0];
    downloadAsCsv(data.rules, `alert-rules-${date}.csv`);
    showToast('Rules exported as CSV', 'success');
  }, [data?.rules, showToast]);

  // Export single rule
  const handleExportRule = useCallback(
    (rule) => {
      const exportData = exportSingleRule(rule);
      downloadAsJson(exportData, generateFilename(rule.name));
      showToast(`Rule "${rule.name}" exported`, 'success');
    },
    [showToast]
  );

  // Handle file selection for import
  const handleFileSelect = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const result = await parseImportFile(file);
    setImportData(result);
    setShowImportModal(true);
    setImportOption('skip');

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  // Perform the actual import
  const handleImport = useCallback(async () => {
    if (!importData?.valid || !importData.rules.length) return;

    if (!wsRequest || !wsConnected) {
      showToast('Not connected to server', 'error');
      return;
    }

    setImporting(true);
    const existingRules = data?.rules || [];
    const { duplicates, unique } = findDuplicates(importData.rules, existingRules);

    let rulesToImport = unique;
    let importCount = 0;

    try {
      if (importOption === 'replace' && duplicates.length > 0) {
        for (const dup of duplicates) {
          const existing = existingRules.find(
            (r) => r.name.toLowerCase() === dup.name.toLowerCase()
          );
          if (existing) {
            await wsRequest('alert-rule-delete', { id: existing.id });
          }
        }
        rulesToImport = [...unique, ...duplicates];
      }

      for (const rule of rulesToImport) {
        const result = await wsRequest('alert-rule-create', convertToApiFormat(rule));
        if (result && !result.error) {
          importCount++;
        }
      }

      showToast(`${importCount} rule${importCount !== 1 ? 's' : ''} imported`, 'success');
      refetch();
    } catch (err) {
      console.error('Import failed:', err);
      showToast('Import failed', 'error');
    } finally {
      setImporting(false);
      setShowImportModal(false);
      setImportData(null);
    }
  }, [wsRequest, wsConnected, data?.rules, importData, importOption, refetch, showToast]);

  // Filter and sort rules
  const filteredRules = useMemo(() => {
    if (!data?.rules) return [];

    let rules = [...data.rules];

    // Exclude rule pending deletion
    if (pendingDelete?.rule) {
      rules = rules.filter((r) => r.id !== pendingDelete.rule.id);
    }

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      rules = rules.filter(
        (rule) =>
          rule.name?.toLowerCase().includes(query) ||
          rule.description?.toLowerCase().includes(query)
      );
    }

    // Priority filter
    if (priorityFilter !== 'all') {
      rules = rules.filter((rule) => rule.priority === priorityFilter);
    }

    // Status filter
    if (statusFilter !== 'all') {
      const isEnabled = statusFilter === 'enabled';
      rules = rules.filter((rule) => rule.enabled === isEnabled);
    }

    // Sort
    rules.sort((a, b) => {
      switch (sortBy) {
        case 'name-asc':
          return (a.name || '').localeCompare(b.name || '');
        case 'name-desc':
          return (b.name || '').localeCompare(a.name || '');
        case 'priority': {
          const priorityOrder = { critical: 0, emergency: 1, warning: 2, info: 3 };
          return (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3);
        }
        case 'created':
          return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        default:
          return 0;
      }
    });

    return rules;
  }, [data?.rules, searchQuery, priorityFilter, statusFilter, sortBy, pendingDelete]);

  // Clear all filters
  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setPriorityFilter('all');
    setStatusFilter('all');
  }, []);

  const hasActiveFilters = searchQuery || priorityFilter !== 'all' || statusFilter !== 'all';

  return {
    // Data
    rules: data?.rules || [],
    filteredRules,
    realtimeAlerts,
    refetch,

    // Filter state
    searchQuery,
    setSearchQuery,
    priorityFilter,
    setPriorityFilter,
    statusFilter,
    setStatusFilter,
    sortBy,
    setSortBy,
    hasActiveFilters,
    clearFilters,

    // Delete state
    pendingDelete,
    handleDelete,
    handleUndoDelete,

    // Rule operations
    handleToggle,
    handleExportAll,
    handleExportCsv,
    handleExportRule,

    // Import state and operations
    showImportModal,
    setShowImportModal,
    importData,
    setImportData,
    importOption,
    setImportOption,
    importing,
    fileInputRef,
    handleFileSelect,
    handleImport,

    // Toast
    showToast,
  };
}
