import React, { useState, useEffect } from 'react';
import {
  Settings, Trash2, Download, Copy, Clock, Zap, Activity, TestTube2, FileJson
} from 'lucide-react';
import { PRIORITY_CONFIG, formatCondition, formatCooldown, formatRelativeTime } from './alertConstants';

export function AlertRuleCard({
  rule,
  onToggle,
  onEdit,
  onDuplicate,
  onDelete,
  onTest,
  onExport
}) {
  const [exportDropdown, setExportDropdown] = useState(false);

  const priorityConfig = PRIORITY_CONFIG[rule.priority] || PRIORITY_CONFIG.info;
  const PriorityIcon = priorityConfig.Icon;

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!exportDropdown) return;
    const handleClick = () => setExportDropdown(false);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [exportDropdown]);

  return (
    <article
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
            onClick={() => onToggle(rule)}
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
          onClick={() => onTest(rule)}
          title="Test rule against current aircraft"
          aria-label={`Test ${rule.name} against current aircraft`}
        >
          <TestTube2 size={14} aria-hidden="true" />
          <span>Test</span>
        </button>
        <button
          className="action-btn edit"
          onClick={() => onEdit(rule)}
          title="Edit rule"
          aria-label={`Edit ${rule.name}`}
        >
          <Settings size={14} aria-hidden="true" />
          <span>Edit</span>
        </button>
        <button
          className="action-btn duplicate"
          onClick={() => onDuplicate(rule)}
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
              setExportDropdown(!exportDropdown);
            }}
            title="Export"
            aria-label={`Export ${rule.name}`}
            aria-expanded={exportDropdown}
            aria-haspopup="menu"
          >
            <Download size={14} aria-hidden="true" />
            <span>Export</span>
          </button>
          {exportDropdown && (
            <div className="export-dropdown-menu" role="menu">
              <button onClick={() => { onExport(rule); setExportDropdown(false); }} role="menuitem">
                <FileJson size={14} aria-hidden="true" /> Export as JSON
              </button>
            </div>
          )}
        </div>
        <button
          className="action-btn delete"
          onClick={() => onDelete(rule)}
          title="Delete rule"
          aria-label={`Delete ${rule.name}`}
        >
          <Trash2 size={14} aria-hidden="true" />
          <span>Delete</span>
        </button>
      </div>
    </article>
  );
}
