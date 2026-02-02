import React, { useState, useCallback, useRef } from 'react';
import {
  Settings,
  Save,
  Download,
  Upload,
  AlertTriangle,
  RefreshCw,
  Search,
  History,
  X,
} from 'lucide-react';
import { useSystemConfig } from '../../../hooks/useSystemConfig';
import { ConfigCategory } from './ConfigCategory';
import { ConfigAuditLog } from './ConfigAuditLog';

/**
 * Category icons mapping
 * @todo Use for category headers
 */
const _CATEGORY_ICONS = {
  adsb_sources: Settings,
  location: Settings,
  safety: AlertTriangle,
  alerts: AlertTriangle,
  acars: Settings,
  storage: Settings,
  transcription: Settings,
  external_apis: Settings,
  monitoring: Settings,
  notifications: Settings,
  aircraft_data: Settings,
  display: Settings,
  advanced: Settings,
};

/**
 * Main configuration page component.
 * Provides a tabbed interface for managing system configuration.
 */
export function ConfigPage({ apiBase = '', onToast }) {
  const {
    categories,
    loading,
    error,
    refetch,
    updateValue,
    resetValue,
    clearPendingChanges,
    saveAllPendingChanges,
    resetToDefault,
    revealSensitiveValue,
    pendingChanges: _pendingChanges,
    pendingChangeCount,
    hasChange,
    hasRestartRequired,
    getConfigValue,
    saving,
    auditLog,
    auditLogLoading,
    fetchAuditLog,
    exportConfigs,
    importConfigs,
    showToast,
  } = useSystemConfig({ apiBase, onToast });

  // UI state
  const [activeTab, setActiveTab] = useState('settings');
  const [expandedCategories, setExpandedCategories] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [importError, setImportError] = useState(null);
  const fileInputRef = useRef(null);

  // Toggle category expansion
  const handleToggleCategory = useCallback((categoryKey) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryKey)) {
        next.delete(categoryKey);
      } else {
        next.add(categoryKey);
      }
      return next;
    });
  }, []);

  // Expand all categories
  const expandAll = useCallback(() => {
    setExpandedCategories(new Set(categories.map((c) => c.category)));
  }, [categories]);

  // Collapse all categories
  const collapseAll = useCallback(() => {
    setExpandedCategories(new Set());
  }, []);

  // Filter categories by search
  const filteredCategories = searchQuery
    ? categories
        .map((cat) => ({
          ...cat,
          configs: cat.configs.filter(
            (config) =>
              config.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
              config.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
              (config.description &&
                config.description.toLowerCase().includes(searchQuery.toLowerCase()))
          ),
        }))
        .filter((cat) => cat.configs.length > 0)
    : categories;

  // Handle save all
  const handleSaveAll = async () => {
    const success = await saveAllPendingChanges();
    if (success && hasRestartRequired) {
      showToast('Some changes require a restart to take effect', 'warning');
    }
  };

  // Handle discard changes
  const handleDiscard = () => {
    clearPendingChanges();
    showToast('Changes discarded', 'info');
  };

  // Handle file selection for import
  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportFile(file);
    setImportError(null);

    try {
      const preview = await importConfigs(file, { dryRun: true });
      setImportPreview(preview);
      setShowImportModal(true);
    } catch (err) {
      setImportError(err.message);
      setShowImportModal(true);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Handle import confirmation
  const handleImportConfirm = async () => {
    if (!importFile) return;

    try {
      await importConfigs(importFile, { dryRun: false });
      setShowImportModal(false);
      setImportFile(null);
      setImportPreview(null);
    } catch {
      // Error handled in hook
    }
  };

  // Handle reset to default (planned feature)
  const _handleResetToDefault = async (key) => {
    const config = categories.flatMap((c) => c.configs).find((c) => c.key === key);
    if (config) {
      const confirmed = window.confirm(
        `Reset "${config.display_name}" to its default value?\n\nDefault: ${config.default_value || '(empty)'}`
      );
      if (confirmed) {
        await resetToDefault(key);
      }
    }
  };

  if (loading) {
    return (
      <div className="config-page config-page-loading">
        <div className="config-loading-spinner">
          <RefreshCw size={24} className="spinning" />
          <span>Loading configuration...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="config-page config-page-error">
        <AlertTriangle size={24} />
        <h3>Failed to load configuration</h3>
        <p>{error}</p>
        <button onClick={refetch} className="config-retry-btn">
          <RefreshCw size={16} />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="config-page">
      {/* Header */}
      <div className="config-header">
        <div className="config-header-title">
          <Settings size={24} />
          <h1>System Configuration</h1>
        </div>

        <div className="config-header-actions">
          {pendingChangeCount > 0 && (
            <div className="config-pending-banner">
              <span>
                {pendingChangeCount} unsaved change{pendingChangeCount !== 1 ? 's' : ''}
              </span>
              {hasRestartRequired && (
                <span className="config-restart-warning">
                  <AlertTriangle size={14} />
                  Restart required
                </span>
              )}
              <button onClick={handleDiscard} className="config-discard-btn">
                Discard
              </button>
              <button onClick={handleSaveAll} disabled={saving} className="config-save-btn">
                {saving ? <RefreshCw size={14} className="spinning" /> : <Save size={14} />}
                Save All
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="config-tabs">
        <button
          className={`config-tab ${activeTab === 'settings' ? 'config-tab-active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          <Settings size={16} />
          Settings
        </button>
        <button
          className={`config-tab ${activeTab === 'history' ? 'config-tab-active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          <History size={16} />
          Audit Log
        </button>
      </div>

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div className="config-settings-tab">
          {/* Toolbar */}
          <div className="config-toolbar">
            <div className="config-search">
              <Search size={16} />
              <input
                type="text"
                placeholder="Search settings..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="config-search-clear">
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="config-toolbar-actions">
              <button onClick={expandAll} className="config-toolbar-btn">
                Expand All
              </button>
              <button onClick={collapseAll} className="config-toolbar-btn">
                Collapse All
              </button>
              <button onClick={() => exportConfigs(false)} className="config-toolbar-btn">
                <Download size={14} />
                Export
              </button>
              <label className="config-toolbar-btn config-import-btn">
                <Upload size={14} />
                Import
                <input
                  type="file"
                  accept=".json"
                  onChange={handleFileSelect}
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                />
              </label>
              <button onClick={refetch} className="config-toolbar-btn" title="Refresh">
                <RefreshCw size={14} />
              </button>
            </div>
          </div>

          {/* Categories */}
          <div className="config-categories">
            {filteredCategories.length === 0 ? (
              <div className="config-no-results">No settings match your search.</div>
            ) : (
              filteredCategories.map((category) => (
                <ConfigCategory
                  key={category.category}
                  category={category}
                  expanded={searchQuery ? true : expandedCategories.has(category.category)}
                  onToggle={handleToggleCategory}
                  getConfigValue={getConfigValue}
                  onConfigChange={updateValue}
                  onConfigReset={resetValue}
                  onReveal={revealSensitiveValue}
                  hasChange={hasChange}
                  disabled={saving}
                />
              ))
            )}
          </div>
        </div>
      )}

      {/* Audit Log Tab */}
      {activeTab === 'history' && (
        <div className="config-history-tab">
          <ConfigAuditLog auditLog={auditLog} loading={auditLogLoading} onRefresh={fetchAuditLog} />
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div className="config-modal-overlay" onClick={() => setShowImportModal(false)}>
          <div className="config-modal" onClick={(e) => e.stopPropagation()}>
            <div className="config-modal-header">
              <h3>Import Configuration</h3>
              <button onClick={() => setShowImportModal(false)} className="config-modal-close">
                <X size={18} />
              </button>
            </div>

            <div className="config-modal-content">
              {importError ? (
                <div className="config-import-error">
                  <AlertTriangle size={20} />
                  <p>{importError}</p>
                </div>
              ) : importPreview ? (
                <div className="config-import-preview">
                  <p>This import will:</p>
                  <ul>
                    <li>Update {importPreview.imported} configurations</li>
                    {importPreview.skipped > 0 && (
                      <li>Skip {importPreview.skipped} read-only configurations</li>
                    )}
                    {importPreview.errors && Object.keys(importPreview.errors).length > 0 && (
                      <li className="config-import-errors">
                        {Object.keys(importPreview.errors).length} configurations have errors:
                        <ul>
                          {Object.entries(importPreview.errors).map(([key, error]) => (
                            <li key={key}>
                              <code>{key}</code>: {error}
                            </li>
                          ))}
                        </ul>
                      </li>
                    )}
                  </ul>
                </div>
              ) : (
                <p>Loading preview...</p>
              )}
            </div>

            <div className="config-modal-footer">
              <button onClick={() => setShowImportModal(false)} className="config-modal-cancel">
                Cancel
              </button>
              <button
                onClick={handleImportConfirm}
                disabled={!!importError || !importPreview}
                className="config-modal-confirm"
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ConfigPage;
