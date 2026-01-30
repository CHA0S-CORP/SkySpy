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
  const { data: rulesData, refetch } = useSocketApi('/api/v1/alerts/rules', null, apiBase, { wsRequest, wsConnected });

  // Real-time alerts from WebSocket
  const [realtimeAlerts, setRealtimeAlerts] = useState([]);

  // Undo delete state
  const [pendingDelete, setPendingDelete] = useState(null);
  const undoTimeoutRef = useRef(null);

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
  const showToast = useCallback((message, type = 'info') => {
    if (onToast) {
      onToast(message, type);
    }
  }, [onToast]);

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

  // Set up alert event listeners
  useEffect(() => {
    if (!alertsConnected) return;

    const handleAlertTriggered = (data) => {
      setRealtimeAlerts(prev => [data, ...prev].slice(0, 50));
    };

    const handleAlertSnapshot = (data) => {
      setRealtimeAlerts(data?.alerts || []);
    };

    const unsubTriggered = onAlertEvent('alert:triggered', handleAlertTriggered);
    const unsubSnapshot = onAlertEvent('alert:snapshot', handleAlertSnapshot);

    return () => {
      unsubTriggered?.();
      unsubSnapshot?.();
    };
  }, [alertsConnected, onAlertEvent]);

  // Cleanup undo timeout on unmount
  useEffect(() => {
    return () => {
      if (undoTimeoutRef.current) {
        clearTimeout(undoTimeoutRef.current);
      }
    };
  }, []);

  // Handle delete with undo support
  const handleDelete = useCallback(async (rule) => {
    setPendingDelete({
      rule,
      timestamp: Date.now(),
    });

    if (undoTimeoutRef.current) {
      clearTimeout(undoTimeoutRef.current);
    }

    showToast(`Rule "${rule.name}" deleted. Click Undo to restore.`, 'warning');

    undoTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${apiBase}/api/v1/alerts/rules/${rule.id}`, { method: 'DELETE' });
        if (!res.ok) {
          throw new Error('Failed to delete rule');
        }
        showToast(`Rule "${rule.name}" permanently deleted`, 'success');
        refetch();
      } catch (err) {
        console.error('Failed to delete rule:', err);
        showToast('Failed to delete rule', 'error');
      } finally {
        setPendingDelete(null);
      }
    }, UNDO_GRACE_PERIOD);
  }, [apiBase, refetch, showToast]);

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
  const handleToggle = useCallback(async (rule) => {
    try {
      const res = await fetch(`${apiBase}/api/v1/alerts/rules/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !rule.enabled })
      });

      if (!res.ok) {
        throw new Error('Failed to toggle rule');
      }

      showToast(`Rule "${rule.name}" ${rule.enabled ? 'disabled' : 'enabled'}`, 'success');
      refetch();
    } catch (err) {
      console.error('Failed to toggle rule:', err);
      showToast('Failed to update rule', 'error');
    }
  }, [apiBase, refetch, showToast]);

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
  const handleExportRule = useCallback((rule) => {
    const exportData = exportSingleRule(rule);
    downloadAsJson(exportData, generateFilename(rule.name));
    showToast(`Rule "${rule.name}" exported`, 'success');
  }, [showToast]);

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

    setImporting(true);
    const existingRules = data?.rules || [];
    const { duplicates, unique } = findDuplicates(importData.rules, existingRules);

    let rulesToImport = unique;
    let importCount = 0;

    try {
      if (importOption === 'replace' && duplicates.length > 0) {
        for (const dup of duplicates) {
          const existing = existingRules.find(r => r.name.toLowerCase() === dup.name.toLowerCase());
          if (existing) {
            await fetch(`${apiBase}/api/v1/alerts/rules/${existing.id}`, { method: 'DELETE' });
          }
        }
        rulesToImport = [...unique, ...duplicates];
      }

      for (const rule of rulesToImport) {
        const res = await fetch(`${apiBase}/api/v1/alerts/rules`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(convertToApiFormat(rule))
        });
        if (res.ok) {
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
  }, [apiBase, data?.rules, importData, importOption, refetch, showToast]);

  // Filter and sort rules
  const filteredRules = useMemo(() => {
    if (!data?.rules) return [];

    let rules = [...data.rules];

    // Exclude rule pending deletion
    if (pendingDelete?.rule) {
      rules = rules.filter(r => r.id !== pendingDelete.rule.id);
    }

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      rules = rules.filter(rule =>
        rule.name?.toLowerCase().includes(query) ||
        rule.description?.toLowerCase().includes(query)
      );
    }

    // Priority filter
    if (priorityFilter !== 'all') {
      rules = rules.filter(rule => rule.priority === priorityFilter);
    }

    // Status filter
    if (statusFilter !== 'all') {
      const isEnabled = statusFilter === 'enabled';
      rules = rules.filter(rule => rule.enabled === isEnabled);
    }

    // Sort
    rules.sort((a, b) => {
      switch (sortBy) {
        case 'name-asc':
          return (a.name || '').localeCompare(b.name || '');
        case 'name-desc':
          return (b.name || '').localeCompare(a.name || '');
        case 'priority':
          const priorityOrder = { critical: 0, emergency: 1, warning: 2, info: 3 };
          return (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3);
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
