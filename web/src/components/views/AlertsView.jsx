import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Upload, Download, AlertCircle, Undo2 } from 'lucide-react';
import { AlertHistory } from './AlertHistory';
import { RuleForm } from './RuleForm';
import { NotificationChannelsManager } from './NotificationChannelsManager';
import { ConfirmModal } from '../common/ConfirmModal';
import {
  AlertRuleCard,
  AlertsFilterToolbar,
  TestRuleModal,
  ImportRulesModal,
  UNDO_GRACE_PERIOD
} from '../alerts';
import { useAlertRules } from '../../hooks/useAlertRules';

export function AlertsView({ apiBase, wsRequest, wsConnected, aircraft = [], feederLocation = null, onToast }) {
  const [activeTab, setActiveTab] = useState('rules');
  const [showForm, setShowForm] = useState(false);
  const [editRule, setEditRule] = useState(null);
  const [prefillAircraft, setPrefillAircraft] = useState(null);
  const [testRule, setTestRule] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState({ isOpen: false, rule: null });

  const {
    rules,
    filteredRules,
    realtimeAlerts,
    refetch,
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
    pendingDelete,
    handleDelete,
    handleUndoDelete,
    handleToggle,
    handleExportAll,
    handleExportRule,
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
    showToast,
  } = useAlertRules({ apiBase, wsRequest, wsConnected, onToast });

  // Listen for create alert from aircraft popup
  useEffect(() => {
    const handleCreateAlert = (e) => {
      const aircraft = e.detail;
      setPrefillAircraft(aircraft);
      setEditRule(null);
      setShowForm(true);
    };
    window.addEventListener('createAlertFromAircraft', handleCreateAlert);
    return () => window.removeEventListener('createAlertFromAircraft', handleCreateAlert);
  }, []);

  const handleDuplicate = useCallback((rule) => {
    const duplicatedRule = {
      ...rule,
      id: undefined,
      name: `${rule.name} (Copy)`,
      enabled: false
    };
    setEditRule(duplicatedRule);
    setShowForm(true);
  }, []);

  const handleEdit = useCallback((rule) => {
    setEditRule(rule);
    setShowForm(true);
  }, []);

  const handleConfirmDelete = useCallback((rule) => {
    setDeleteConfirm({ isOpen: true, rule });
  }, []);

  const handleDeleteConfirmed = useCallback(() => {
    if (deleteConfirm.rule) {
      handleDelete(deleteConfirm.rule);
    }
    setDeleteConfirm({ isOpen: false, rule: null });
  }, [deleteConfirm.rule, handleDelete]);

  const handleNewRule = useCallback(() => {
    setEditRule(null);
    setShowForm(true);
  }, []);

  const handleFormClose = useCallback(() => {
    setShowForm(false);
    setPrefillAircraft(null);
  }, []);

  const handleFormSave = useCallback(() => {
    setShowForm(false);
    setPrefillAircraft(null);
    refetch();
  }, [refetch]);

  return (
    <div className="alerts-container" role="region" aria-label="Alert Management">
      <div className="alerts-header">
        <div className="alerts-tabs" role="tablist" aria-label="Alert sections">
          <button
            className={`alert-tab ${activeTab === 'rules' ? 'active' : ''}`}
            onClick={() => setActiveTab('rules')}
            role="tab"
            aria-selected={activeTab === 'rules'}
            aria-controls="rules-panel"
            id="rules-tab"
          >
            Rules
          </button>
          <button
            className={`alert-tab ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
            role="tab"
            aria-selected={activeTab === 'history'}
            aria-controls="history-panel"
            id="history-tab"
          >
            History
            {realtimeAlerts.length > 0 && (
              <span className="alert-tab-badge">{realtimeAlerts.length}</span>
            )}
          </button>
          <button
            className={`alert-tab ${activeTab === 'notifications' ? 'active' : ''}`}
            onClick={() => setActiveTab('notifications')}
            role="tab"
            aria-selected={activeTab === 'notifications'}
            aria-controls="notifications-panel"
            id="notifications-tab"
          >
            Notifications
          </button>
        </div>
        {activeTab === 'rules' && (
          <div className="alerts-toolbar" role="toolbar" aria-label="Rule actions">
            <input
              type="file"
              ref={fileInputRef}
              accept=".json"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
              aria-hidden="true"
            />
            <button
              className="btn-secondary"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Import rules from JSON file"
            >
              <Upload size={16} aria-hidden="true" /> Import
            </button>
            <button
              className="btn-secondary"
              onClick={handleExportAll}
              disabled={!rules?.length}
              aria-label={`Export all ${rules?.length || 0} rules to JSON file`}
            >
              <Download size={16} aria-hidden="true" /> Export All
            </button>
            <button
              className="btn-primary"
              onClick={handleNewRule}
              aria-label="Create new alert rule"
            >
              <Plus size={16} aria-hidden="true" /> New Rule
            </button>
          </div>
        )}
      </div>

      {/* Undo Delete Banner */}
      {pendingDelete && (
        <div className="undo-delete-banner" role="alert" aria-live="assertive">
          <span>Rule "{pendingDelete.rule.name}" will be deleted</span>
          <button
            className="btn-secondary btn-sm"
            onClick={handleUndoDelete}
          >
            <Undo2 size={14} /> Undo
          </button>
          <div
            className="undo-progress"
            style={{ animationDuration: `${UNDO_GRACE_PERIOD}ms` }}
          />
        </div>
      )}

      {activeTab === 'rules' ? (
        <div role="tabpanel" id="rules-panel" aria-labelledby="rules-tab">
          <AlertsFilterToolbar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            priorityFilter={priorityFilter}
            onPriorityFilterChange={setPriorityFilter}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            sortBy={sortBy}
            onSortChange={setSortBy}
            ruleCount={filteredRules.length}
          />

          {/* Rules List */}
          <div
            className="rules-list"
            role="list"
            aria-label="Alert rules"
          >
            {filteredRules.length === 0 ? (
              <div className="rules-empty" role="status">
                <AlertCircle size={32} aria-hidden="true" />
                <p>No rules found</p>
                {hasActiveFilters ? (
                  <button
                    className="btn-secondary"
                    onClick={clearFilters}
                  >
                    Clear Filters
                  </button>
                ) : (
                  <button
                    className="btn-primary"
                    onClick={handleNewRule}
                  >
                    <Plus size={16} aria-hidden="true" /> Create First Rule
                  </button>
                )}
              </div>
            ) : (
              filteredRules.map(rule => (
                <AlertRuleCard
                  key={rule.id}
                  rule={rule}
                  onToggle={handleToggle}
                  onEdit={handleEdit}
                  onDuplicate={handleDuplicate}
                  onDelete={handleConfirmDelete}
                  onTest={setTestRule}
                  onExport={handleExportRule}
                />
              ))
            )}
          </div>
        </div>
      ) : activeTab === 'history' ? (
        <div role="tabpanel" id="history-panel" aria-labelledby="history-tab">
          <AlertHistory
            apiBase={apiBase}
            wsRequest={wsRequest}
            wsConnected={wsConnected}
            onToast={showToast}
          />
        </div>
      ) : (
        <div role="tabpanel" id="notifications-panel" aria-labelledby="notifications-tab">
          <NotificationChannelsManager apiBase={apiBase} />
        </div>
      )}

      {showForm && (
        <RuleForm
          editRule={editRule}
          prefillAircraft={prefillAircraft}
          apiBase={apiBase}
          aircraft={aircraft}
          feederLocation={feederLocation}
          onClose={handleFormClose}
          onSave={handleFormSave}
          onToast={showToast}
        />
      )}

      {/* Test Rule Modal */}
      {testRule && (
        <TestRuleModal
          rule={testRule}
          aircraft={aircraft}
          feederLocation={feederLocation}
          onClose={() => setTestRule(null)}
        />
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={deleteConfirm.isOpen}
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setDeleteConfirm({ isOpen: false, rule: null })}
        title="Delete Rule"
        message={`Are you sure you want to delete "${deleteConfirm.rule?.name}"? You'll have ${UNDO_GRACE_PERIOD / 1000} seconds to undo this action.`}
        confirmText="Delete"
        variant="danger"
      />

      {/* Import Modal */}
      {showImportModal && (
        <ImportRulesModal
          importData={importData}
          existingRules={rules}
          importOption={importOption}
          onImportOptionChange={setImportOption}
          importing={importing}
          onImport={handleImport}
          onClose={() => {
            setShowImportModal(false);
            setImportData(null);
          }}
        />
      )}
    </div>
  );
}
