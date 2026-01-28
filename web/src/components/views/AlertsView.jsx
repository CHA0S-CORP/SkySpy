import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Plus, Eye, EyeOff, Settings, Trash2, Download, Upload, X, ChevronDown, FileJson,
  AlertTriangle, CheckCircle, Info, AlertCircle, Search, Copy, Clock, Zap, Filter,
  ArrowUpAZ, ArrowDownAZ, Calendar, Activity, TestTube2, Plane
} from 'lucide-react';
import { useSocketApi } from '../../hooks';
import { useNativeWebSocket } from '../../hooks/useNativeWebSocket';
import { AlertHistory } from './AlertHistory';
import { RuleForm } from './RuleForm';
import { NotificationChannelsManager } from './NotificationChannelsManager';
import {
  exportAllRules,
  exportSingleRule,
  downloadAsJson,
  downloadAsCsv,
  generateFilename,
  parseImportFile,
  findDuplicates,
  convertToApiFormat,
} from '../../utils/ruleImportExport';
import { findMatchingAircraft, getRelevantValues } from '../../utils/alertEvaluator';

// Test Rule Modal - shows matching aircraft for a rule
function TestRuleModal({ rule, aircraft, feederLocation, onClose }) {
  const matches = useMemo(() => {
    if (!rule || !aircraft) return [];
    return findMatchingAircraft(rule, aircraft, feederLocation);
  }, [rule, aircraft, feederLocation]);

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="test-modal-title">
      <div className="modal modal-medium" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 id="test-modal-title">
            <TestTube2 size={20} aria-hidden="true" style={{ marginRight: '8px' }} />
            Test Rule: {rule?.name}
          </h3>
          <button onClick={onClose} aria-label="Close test results"><X size={20} /></button>
        </div>
        <div className="modal-content">
          <div className="test-results-summary" role="status" aria-live="polite">
            <span className={`match-count ${matches.length > 0 ? 'has-matches' : ''}`}>
              {matches.length} of {aircraft?.length || 0} aircraft match
            </span>
          </div>

          {matches.length > 0 ? (
            <div className="test-results-list" role="list" aria-label="Matching aircraft">
              {matches.slice(0, 20).map(ac => {
                const values = getRelevantValues(rule, ac);
                return (
                  <div key={ac.hex} className="test-result-item" role="listitem">
                    <div className="test-result-header">
                      <Plane size={16} aria-hidden="true" />
                      <span className="test-callsign">{ac.flight?.trim() || 'N/A'}</span>
                      <span className="test-hex">{ac.hex}</span>
                    </div>
                    <div className="test-result-values">
                      {values.altitude != null && (
                        <span className="test-value">Alt: {values.altitude}ft</span>
                      )}
                      {values.speed != null && (
                        <span className="test-value">Spd: {values.speed}kts</span>
                      )}
                      {values.distance != null && (
                        <span className="test-value">Dist: {values.distance.toFixed(1)}nm</span>
                      )}
                      {ac.calculatedDistance != null && !values.distance && (
                        <span className="test-value">Dist: {ac.calculatedDistance.toFixed(1)}nm</span>
                      )}
                      {values.squawk && (
                        <span className="test-value">Sqwk: {values.squawk}</span>
                      )}
                      {values.type && (
                        <span className="test-value">Type: {values.type}</span>
                      )}
                      {values.military && (
                        <span className="test-value military">Military</span>
                      )}
                      {values.emergency && (
                        <span className="test-value emergency">Emergency</span>
                      )}
                    </div>
                    {ac.matchReasons && ac.matchReasons.length > 0 && (
                      <div className="test-result-reasons">
                        {ac.matchReasons.map((reason, i) => (
                          <span key={i} className="match-reason">{reason}</span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {matches.length > 20 && (
                <div className="test-result-more">
                  ...and {matches.length - 20} more aircraft
                </div>
              )}
            </div>
          ) : (
            <div className="test-results-empty" role="status">
              <p>No aircraft currently match this rule.</p>
              <p className="hint">Try adjusting the conditions or wait for matching aircraft to appear.</p>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// Priority configuration with colors and icons
const PRIORITY_CONFIG = {
  info: {
    label: 'Info',
    color: 'var(--accent-cyan)',
    bgColor: 'rgba(0, 200, 255, 0.15)',
    Icon: Info
  },
  warning: {
    label: 'Warning',
    color: 'var(--accent-yellow)',
    bgColor: 'rgba(210, 153, 34, 0.15)',
    Icon: AlertTriangle
  },
  critical: {
    label: 'Critical',
    color: 'var(--accent-red)',
    bgColor: 'rgba(248, 81, 73, 0.15)',
    Icon: AlertCircle
  },
  emergency: {
    label: 'Emergency',
    color: 'var(--accent-red)',
    bgColor: 'rgba(248, 81, 73, 0.15)',
    Icon: AlertCircle
  }
};

// Format condition for readable display
function formatCondition(condition) {
  const { type, operator, value } = condition;
  const operatorMap = {
    'eq': '=',
    'ne': '!=',
    'gt': '>',
    'lt': '<',
    'gte': '>=',
    'lte': '<=',
    'contains': 'contains',
    'starts_with': 'starts with',
    'ends_with': 'ends with',
    'in': 'in',
    'not_in': 'not in',
    'regex': 'matches'
  };
  const readableOp = operatorMap[operator] || operator;
  return `${type} ${readableOp} ${value}`;
}

// Format cooldown for display
function formatCooldown(seconds) {
  if (!seconds) return 'None';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

// Format relative time
function formatRelativeTime(dateString) {
  if (!dateString) return 'Never';
  const date = new Date(dateString);
  const now = new Date();
  const diff = now - date;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'Just now';
}

export function AlertsView({ apiBase, wsRequest, wsConnected, aircraft = [], feederLocation = null }) {
  const [activeTab, setActiveTab] = useState('rules');
  const { data: rulesData, refetch } = useSocketApi('/api/v1/alerts/rules', null, apiBase, { wsRequest, wsConnected });
  const [showForm, setShowForm] = useState(false);
  const [editRule, setEditRule] = useState(null);
  const [prefillAircraft, setPrefillAircraft] = useState(null);
  const [testRule, setTestRule] = useState(null);
  const [realtimeAlerts, setRealtimeAlerts] = useState([]);

  // Normalize rules data from Django API (may be array, or {results: [...]} or {rules: [...]})
  const data = useMemo(() => {
    if (!rulesData) return { rules: [] };
    if (Array.isArray(rulesData)) return { rules: rulesData };
    if (rulesData.results) return { rules: rulesData.results };
    if (rulesData.rules) return rulesData;
    return { rules: [] };
  }, [rulesData]);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('name-asc');

  // Import/Export state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importData, setImportData] = useState(null);
  const [importOption, setImportOption] = useState('skip'); // 'skip' or 'replace'
  const [importing, setImporting] = useState(false);
  const [exportDropdown, setExportDropdown] = useState(null); // rule id for dropdown
  const fileInputRef = useRef(null);

  // WebSocket for real-time alert notifications
  const { subscribe: alertsSubscribe } = useNativeWebSocket({
    enabled: true,
    apiBase,
    path: 'alerts',
    onMessage: useCallback((message) => {
      if (message.type === 'alert:triggered') {
        // Add new alert to the beginning of the list
        setRealtimeAlerts(prev => [message.data, ...prev].slice(0, 50));
      } else if (message.type === 'alert:snapshot') {
        // Replace all alerts with snapshot data
        setRealtimeAlerts(message.data?.alerts || []);
      }
    }, []),
  });

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

  const handleDelete = async (id) => {
    if (!confirm('Delete this rule?')) return;
    await fetch(`${apiBase}/api/v1/alerts/rules/${id}`, { method: 'DELETE' });
    refetch();
  };

  const handleToggle = async (rule) => {
    await fetch(`${apiBase}/api/v1/alerts/rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !rule.enabled })
    });
    refetch();
  };

  const handleDuplicate = (rule) => {
    // Create a copy of the rule without the ID
    const duplicatedRule = {
      ...rule,
      id: undefined,
      name: `${rule.name} (Copy)`,
      enabled: false // Start duplicated rules as disabled
    };
    setEditRule(duplicatedRule);
    setShowForm(true);
  };

  // Export all rules as JSON
  const handleExportAll = () => {
    if (!data?.rules?.length) return;
    const exportData = exportAllRules(data.rules);
    downloadAsJson(exportData, generateFilename());
  };

  // Export all rules as CSV
  const handleExportCsv = () => {
    if (!data?.rules?.length) return;
    const date = new Date().toISOString().split('T')[0];
    downloadAsCsv(data.rules, `alert-rules-${date}.csv`);
  };

  // Export single rule
  const handleExportRule = (rule) => {
    const exportData = exportSingleRule(rule);
    downloadAsJson(exportData, generateFilename(rule.name));
    setExportDropdown(null);
  };

  // Handle file selection for import
  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const result = await parseImportFile(file);
    setImportData(result);
    setShowImportModal(true);
    setImportOption('skip');

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Perform the actual import
  const handleImport = async () => {
    if (!importData?.valid || !importData.rules.length) return;

    setImporting(true);
    const existingRules = data?.rules || [];
    const { duplicates, unique } = findDuplicates(importData.rules, existingRules);

    let rulesToImport = unique;

    if (importOption === 'replace' && duplicates.length > 0) {
      // Delete existing duplicates first
      for (const dup of duplicates) {
        const existing = existingRules.find(r => r.name.toLowerCase() === dup.name.toLowerCase());
        if (existing) {
          await fetch(`${apiBase}/api/v1/alerts/rules/${existing.id}`, { method: 'DELETE' });
        }
      }
      rulesToImport = [...unique, ...duplicates];
    }

    // Create new rules
    for (const rule of rulesToImport) {
      await fetch(`${apiBase}/api/v1/alerts/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(convertToApiFormat(rule))
      });
    }

    setImporting(false);
    setShowImportModal(false);
    setImportData(null);
    refetch();
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    if (exportDropdown === null) return;
    const handleClick = () => setExportDropdown(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [exportDropdown]);

  // Filter and sort rules
  const filteredRules = useMemo(() => {
    if (!data?.rules) return [];

    let rules = [...data.rules];

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
          const priorityOrder = { critical: 0, emergency: 0, warning: 1, info: 2 };
          return (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2);
        case 'created':
          return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        default:
          return 0;
      }
    });

    return rules;
  }, [data?.rules, searchQuery, priorityFilter, statusFilter, sortBy]);

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
              disabled={!data?.rules?.length}
              aria-label={`Export all ${data?.rules?.length || 0} rules to JSON file`}
            >
              <Download size={16} aria-hidden="true" /> Export All
            </button>
            <button
              className="btn-primary"
              onClick={() => { setEditRule(null); setShowForm(true); }}
              aria-label="Create new alert rule"
            >
              <Plus size={16} aria-hidden="true" /> New Rule
            </button>
          </div>
        )}
      </div>

      {activeTab === 'rules' ? (
        <>
          {/* Search & Filter Toolbar */}
          <div className="rules-toolbar">
            <div className="rules-search">
              <Search size={16} aria-hidden="true" />
              <input
                type="text"
                placeholder="Search rules..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search rules by name or description"
              />
            </div>

            <div className="rules-filters">
              <div className="filter-select">
                <Filter size={14} aria-hidden="true" />
                <select
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value)}
                  aria-label="Filter by priority"
                >
                  <option value="all">All Priorities</option>
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="critical">Critical</option>
                </select>
                <ChevronDown size={14} className="select-arrow" aria-hidden="true" />
              </div>

              <div className="filter-select">
                <Activity size={14} aria-hidden="true" />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  aria-label="Filter by status"
                >
                  <option value="all">All Status</option>
                  <option value="enabled">Enabled</option>
                  <option value="disabled">Disabled</option>
                </select>
                <ChevronDown size={14} className="select-arrow" aria-hidden="true" />
              </div>

              <div className="filter-select">
                {sortBy === 'name-asc' ? <ArrowUpAZ size={14} aria-hidden="true" /> :
                 sortBy === 'name-desc' ? <ArrowDownAZ size={14} aria-hidden="true" /> :
                 sortBy === 'priority' ? <AlertCircle size={14} aria-hidden="true" /> :
                 <Calendar size={14} aria-hidden="true" />}
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  aria-label="Sort rules"
                >
                  <option value="name-asc">Name A-Z</option>
                  <option value="name-desc">Name Z-A</option>
                  <option value="priority">Priority</option>
                  <option value="created">Created Date</option>
                </select>
                <ChevronDown size={14} className="select-arrow" aria-hidden="true" />
              </div>
            </div>

            <div className="rules-count" aria-live="polite">
              {filteredRules.length} rule{filteredRules.length !== 1 ? 's' : ''}
            </div>
          </div>

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
                {searchQuery || priorityFilter !== 'all' || statusFilter !== 'all' ? (
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      setSearchQuery('');
                      setPriorityFilter('all');
                      setStatusFilter('all');
                    }}
                  >
                    Clear Filters
                  </button>
                ) : (
                  <button
                    className="btn-primary"
                    onClick={() => { setEditRule(null); setShowForm(true); }}
                  >
                    <Plus size={16} aria-hidden="true" /> Create First Rule
                  </button>
                )}
              </div>
            ) : (
              filteredRules.map(rule => {
                const priorityConfig = PRIORITY_CONFIG[rule.priority] || PRIORITY_CONFIG.info;
                const PriorityIcon = priorityConfig.Icon;

                return (
                  <article
                    key={rule.id}
                    className={`rule-card-enhanced ${rule.enabled ? '' : 'disabled'}`}
                    role="listitem"
                    aria-label={`${rule.name} - ${priorityConfig.label} priority${rule.enabled ? '' : ', disabled'}`}
                  >
                    <div className="rule-card-header">
                      <div
                        className={`rule-priority-badge ${rule.priority}`}
                        style={{
                          backgroundColor: priorityConfig.bgColor,
                          color: priorityConfig.color
                        }}
                      >
                        <PriorityIcon size={12} aria-hidden="true" />
                        <span>{priorityConfig.label}</span>
                      </div>

                      <h3 className="rule-card-name">{rule.name}</h3>

                      <div className="rule-card-toggle">
                        <button
                          className={`toggle-btn ${rule.enabled ? 'enabled' : ''}`}
                          onClick={() => handleToggle(rule)}
                          title={rule.enabled ? 'Disable rule' : 'Enable rule'}
                          aria-label={rule.enabled ? `Disable rule: ${rule.name}` : `Enable rule: ${rule.name}`}
                          aria-pressed={rule.enabled}
                        >
                          <div className="toggle-track">
                            <div className="toggle-thumb"></div>
                          </div>
                        </button>
                      </div>
                    </div>

                    {/* Conditions Summary */}
                    <div className="rule-card-conditions">
                      {rule.conditions?.groups ? (
                        rule.conditions.groups.map((group, gi) => (
                          <span key={gi} className="condition-group">
                            {gi > 0 && <strong className="logic-operator">{rule.conditions.logic || 'AND'}</strong>}
                            <span className="condition-group-inner">
                              {group.conditions?.map((c, ci) => (
                                <span key={ci} className="condition-item">
                                  {ci > 0 && <span className="condition-logic">{group.logic || 'AND'}</span>}
                                  <code>{formatCondition(c)}</code>
                                </span>
                              ))}
                            </span>
                          </span>
                        ))
                      ) : rule.type ? (
                        <code className="condition-simple">
                          {rule.type} {rule.operator} {rule.value}
                        </code>
                      ) : null}
                    </div>

                    {rule.description && (
                      <div className="rule-card-description">{rule.description}</div>
                    )}

                    {/* Stats Row */}
                    <div className="rule-card-stats">
                      <div className="stat-item">
                        <Clock size={12} aria-hidden="true" />
                        <span>Cooldown: {formatCooldown(rule.cooldown)}</span>
                      </div>
                      <div className="stat-item">
                        <Zap size={12} aria-hidden="true" />
                        <span>Triggers: {rule.trigger_count || 0}</span>
                      </div>
                      <div className="stat-item">
                        <Activity size={12} aria-hidden="true" />
                        <span>Last: {formatRelativeTime(rule.last_triggered)}</span>
                      </div>
                    </div>

                    {/* Schedule Info */}
                    {(rule.starts_at || rule.expires_at) && (
                      <div className="rule-card-schedule">
                        {rule.starts_at && <span>Starts: {new Date(rule.starts_at).toLocaleString()}</span>}
                        {rule.expires_at && <span>Expires: {new Date(rule.expires_at).toLocaleString()}</span>}
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="rule-card-actions">
                      <button
                        className="action-btn test"
                        onClick={() => setTestRule(rule)}
                        title="Test rule against current aircraft"
                        aria-label={`Test ${rule.name} against current aircraft`}
                      >
                        <TestTube2 size={14} aria-hidden="true" />
                        <span>Test</span>
                      </button>
                      <button
                        className="action-btn edit"
                        onClick={() => { setEditRule(rule); setShowForm(true); }}
                        title="Edit rule"
                        aria-label={`Edit ${rule.name}`}
                      >
                        <Settings size={14} aria-hidden="true" />
                        <span>Edit</span>
                      </button>
                      <button
                        className="action-btn duplicate"
                        onClick={() => handleDuplicate(rule)}
                        title="Duplicate rule"
                        aria-label={`Duplicate ${rule.name}`}
                      >
                        <Copy size={14} aria-hidden="true" />
                        <span>Duplicate</span>
                      </button>
                      <div className="rule-export-dropdown">
                        <button
                          className="action-btn export"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExportDropdown(exportDropdown === rule.id ? null : rule.id);
                          }}
                          title="Export"
                          aria-label={`Export ${rule.name}`}
                          aria-expanded={exportDropdown === rule.id}
                          aria-haspopup="menu"
                        >
                          <Download size={14} aria-hidden="true" />
                          <span>Export</span>
                        </button>
                        {exportDropdown === rule.id && (
                          <div className="export-dropdown-menu" role="menu">
                            <button onClick={() => handleExportRule(rule)} role="menuitem">
                              <FileJson size={14} aria-hidden="true" /> Export as JSON
                            </button>
                          </div>
                        )}
                      </div>
                      <button
                        className="action-btn delete"
                        onClick={() => handleDelete(rule.id)}
                        title="Delete rule"
                        aria-label={`Delete ${rule.name}`}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                        <span>Delete</span>
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </>
      ) : activeTab === 'history' ? (
        <div role="tabpanel" id="history-panel" aria-labelledby="history-tab">
          <AlertHistory apiBase={apiBase} wsRequest={wsRequest} wsConnected={wsConnected} />
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
          onClose={() => { setShowForm(false); setPrefillAircraft(null); }}
          onSave={() => { setShowForm(false); setPrefillAircraft(null); refetch(); }}
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

      {/* Import Modal */}
      {showImportModal && (
        <div
          className="modal-overlay"
          onClick={() => setShowImportModal(false)}
          role="presentation"
        >
          <div
            className="modal import-modal"
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-modal-title"
          >
            <div className="modal-header">
              <h3 id="import-modal-title">Import Alert Rules</h3>
              <button
                onClick={() => setShowImportModal(false)}
                aria-label="Close import dialog"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <div className="modal-content">
              {importData && (
                <>
                  <div className="import-file-info">
                    <FileJson size={20} />
                    <span>{importData.filename}</span>
                  </div>

                  {/* Validation Errors */}
                  {importData.errors.length > 0 && (
                    <div
                      className={`import-validation ${importData.valid ? 'warnings' : 'errors'}`}
                      role={importData.valid ? 'status' : 'alert'}
                      aria-live="polite"
                    >
                      <div className="validation-header">
                        <AlertTriangle size={16} aria-hidden="true" />
                        <span>{importData.valid ? 'Warnings' : 'Validation Errors'}</span>
                      </div>
                      <ul className="validation-list" aria-label={importData.valid ? 'Import warnings' : 'Import errors'}>
                        {importData.errors.slice(0, 10).map((error, i) => (
                          <li key={i}>{error}</li>
                        ))}
                        {importData.errors.length > 10 && (
                          <li className="more-errors" aria-label={`${importData.errors.length - 10} additional errors not shown`}>
                            ... and {importData.errors.length - 10} more
                          </li>
                        )}
                      </ul>
                    </div>
                  )}

                  {/* Rules Preview */}
                  {importData.valid && importData.rules.length > 0 && (
                    <>
                      <div className="import-preview" aria-live="polite">
                        <div className="preview-header">
                          <CheckCircle size={16} aria-hidden="true" />
                          <span>{importData.rules.length} rule{importData.rules.length !== 1 ? 's' : ''} ready to import</span>
                        </div>
                        <div className="preview-list" role="list" aria-label="Rules to import">
                          {importData.rules.map((rule, i) => {
                            const isDuplicate = data?.rules?.some(
                              r => r.name.toLowerCase() === rule.name.toLowerCase()
                            );
                            const priority = rule.priority || 'info';
                            const priorityConfig = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.info;
                            const PriorityIcon = priorityConfig.Icon;

                            return (
                              <div
                                key={i}
                                className={`preview-rule ${isDuplicate ? 'duplicate' : ''}`}
                                role="listitem"
                                aria-label={`${rule.name}${isDuplicate ? ' (duplicate)' : ''}`}
                              >
                                <span className={`rule-priority ${priority}`}>
                                  <PriorityIcon size={12} aria-hidden="true" className="priority-icon" />
                                  {priority}
                                </span>
                                <span className="preview-rule-name">{rule.name}</span>
                                {isDuplicate && (
                                  <span className="duplicate-badge" aria-label="This rule already exists">
                                    Duplicate
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Duplicate handling options */}
                      {data?.rules?.some(existing =>
                        importData.rules.some(r => r.name.toLowerCase() === existing.name.toLowerCase())
                      ) && (
                        <fieldset className="import-options">
                          <legend className="import-option-label">Handle duplicates:</legend>
                          <div className="import-option-buttons" role="radiogroup" aria-label="Duplicate handling options">
                            <button
                              className={`import-option-btn ${importOption === 'skip' ? 'active' : ''}`}
                              onClick={() => setImportOption('skip')}
                              role="radio"
                              aria-checked={importOption === 'skip'}
                            >
                              Skip duplicates
                            </button>
                            <button
                              className={`import-option-btn ${importOption === 'replace' ? 'active' : ''}`}
                              onClick={() => setImportOption('replace')}
                              role="radio"
                              aria-checked={importOption === 'replace'}
                            >
                              Replace duplicates
                            </button>
                          </div>
                        </fieldset>
                      )}
                    </>
                  )}

                  {/* Actions */}
                  <div className="import-actions" role="group" aria-label="Import actions">
                    <button
                      className="btn-secondary"
                      onClick={() => setShowImportModal(false)}
                      aria-label="Cancel import"
                    >
                      Cancel
                    </button>
                    <button
                      className="btn-primary"
                      onClick={handleImport}
                      disabled={!importData.valid || importing}
                      aria-busy={importing}
                      aria-label={importing ? 'Importing rules, please wait' : `Import ${importData.rules.length} rules`}
                    >
                      {importing ? 'Importing...' : `Import ${importData.rules.length} Rule${importData.rules.length !== 1 ? 's' : ''}`}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
