import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  X, Plus, ChevronDown, ChevronUp, Plane, Eye, Save, Trash2, Info,
  AlertTriangle, AlertCircle, Bell, Check, Zap, FileText
} from 'lucide-react';
import { findMatchingAircraft, getRelevantValues } from '../../utils/alertEvaluator';
import { useNotificationChannels } from '../../hooks/useNotificationChannels';

// Severity configuration
const SEVERITY_CONFIG = {
  info: { label: 'Info', Icon: Info, color: '#3b82f6' },
  warning: { label: 'Warning', Icon: AlertTriangle, color: '#f59e0b' },
  critical: { label: 'Critical', Icon: AlertCircle, color: '#ef4444' },
  emergency: { label: 'Emergency', Icon: AlertCircle, color: '#dc2626' },
};

// All available condition types (unified from both forms)
const CONDITION_TYPES = [
  { value: 'icao', label: 'ICAO Hex', placeholder: 'e.g., A12345' },
  { value: 'callsign', label: 'Callsign', placeholder: 'e.g., UAL123' },
  { value: 'squawk', label: 'Squawk Code', placeholder: 'e.g., 7700', validation: /^\d{4}$/ },
  { value: 'altitude_above', label: 'Altitude Above (ft)', placeholder: 'e.g., 10000', type: 'number' },
  { value: 'altitude_below', label: 'Altitude Below (ft)', placeholder: 'e.g., 5000', type: 'number' },
  { value: 'speed_above', label: 'Speed Above (kts)', placeholder: 'e.g., 300', type: 'number' },
  { value: 'speed_below', label: 'Speed Below (kts)', placeholder: 'e.g., 100', type: 'number' },
  { value: 'vertical_rate', label: 'Vertical Rate (ft/min)', placeholder: 'e.g., -2000', type: 'number' },
  { value: 'distance_within', label: 'Distance Within (nm)', placeholder: 'e.g., 10', type: 'number' },
  { value: 'distance_from_mobile', label: 'Distance From Mobile (nm)', placeholder: 'e.g., 5', type: 'number' },
  { value: 'military', label: 'Military Aircraft', isBoolean: true },
  { value: 'emergency', label: 'Emergency', isBoolean: true },
  { value: 'law_enforcement', label: 'Law Enforcement', isBoolean: true },
  { value: 'helicopter', label: 'Helicopter', isBoolean: true },
  { value: 'type', label: 'Aircraft Type', placeholder: 'e.g., B738' },
  { value: 'registration', label: 'Registration', placeholder: 'e.g., N12345' },
  { value: 'category', label: 'Category', placeholder: 'e.g., A3' },
];

// Operators for different condition types
const STRING_OPERATORS = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'startswith', label: 'starts with' },
  { value: 'endswith', label: 'ends with' },
];

const NUMERIC_OPERATORS = [
  { value: 'eq', label: '=' },
  { value: 'lt', label: '<' },
  { value: 'gt', label: '>' },
  { value: 'lte', label: '<=' },
  { value: 'gte', label: '>=' },
];

// Rule templates for quick setup
const RULE_TEMPLATES = [
  {
    id: 'military',
    name: 'Military Aircraft',
    icon: '🎖️',
    description: 'Alert when military aircraft are detected',
    rule: {
      name: 'Military Aircraft Alert',
      priority: 'warning',
      conditions: { logic: 'AND', groups: [{ logic: 'AND', conditions: [{ type: 'military', operator: 'eq', value: 'true' }] }] },
      cooldown: 300,
    },
  },
  {
    id: 'emergency',
    name: 'Emergency Squawk',
    icon: '🚨',
    description: 'Alert on emergency squawk codes (7500, 7600, 7700)',
    rule: {
      name: 'Emergency Alert',
      priority: 'critical',
      conditions: { logic: 'AND', groups: [{ logic: 'AND', conditions: [{ type: 'emergency', operator: 'eq', value: 'true' }] }] },
      cooldown: 60,
    },
  },
  {
    id: 'low_flying',
    name: 'Low Flying Aircraft',
    icon: '📉',
    description: 'Alert when aircraft fly below a certain altitude',
    rule: {
      name: 'Low Flying Aircraft',
      priority: 'info',
      conditions: { logic: 'AND', groups: [{ logic: 'AND', conditions: [{ type: 'altitude_below', operator: 'lt', value: '2000' }] }] },
      cooldown: 300,
    },
  },
  {
    id: 'nearby',
    name: 'Nearby Aircraft',
    icon: '📍',
    description: 'Alert when aircraft come within range',
    rule: {
      name: 'Nearby Aircraft Alert',
      priority: 'info',
      conditions: { logic: 'AND', groups: [{ logic: 'AND', conditions: [{ type: 'distance_within', operator: 'lte', value: '5' }] }] },
      cooldown: 300,
    },
  },
  {
    id: 'helicopter',
    name: 'Helicopter Activity',
    icon: '🚁',
    description: 'Alert when helicopters are detected',
    rule: {
      name: 'Helicopter Alert',
      priority: 'info',
      conditions: { logic: 'AND', groups: [{ logic: 'AND', conditions: [{ type: 'helicopter', operator: 'eq', value: 'true' }] }] },
      cooldown: 300,
    },
  },
  {
    id: 'law_enforcement',
    name: 'Law Enforcement',
    icon: '🚔',
    description: 'Alert when law enforcement aircraft are detected',
    rule: {
      name: 'Law Enforcement Alert',
      priority: 'warning',
      conditions: { logic: 'AND', groups: [{ logic: 'AND', conditions: [{ type: 'law_enforcement', operator: 'eq', value: 'true' }] }] },
      cooldown: 300,
    },
  },
];

// Channel type display info
const CHANNEL_TYPE_INFO = {
  discord: { label: 'Discord', icon: '💬', color: '#5865F2' },
  slack: { label: 'Slack', icon: '💼', color: '#4A154B' },
  telegram: { label: 'Telegram', icon: '✈️', color: '#0088cc' },
  pushover: { label: 'Pushover', icon: '📱', color: '#249DF1' },
  email: { label: 'Email', icon: '📧', color: '#EA4335' },
  webhook: { label: 'Webhook', icon: '🔗', color: '#6366f1' },
  ntfy: { label: 'ntfy', icon: '🔔', color: '#57A773' },
  gotify: { label: 'Gotify', icon: '📣', color: '#1e88e5' },
  home_assistant: { label: 'Home Assistant', icon: '🏠', color: '#41BDF5' },
  twilio: { label: 'Twilio SMS', icon: '📲', color: '#F22F46' },
  custom: { label: 'Custom', icon: '⚙️', color: '#6b7280' },
};

/**
 * Consolidated RuleForm component with:
 * - Live preview of matching aircraft
 * - Notification channel selection
 * - Rule templates
 * - Input validation
 * - Full accessibility support
 */
export function RuleForm({
  editRule = null,
  rule = null,  // Alias for editRule for backwards compatibility
  prefillAircraft = null,
  apiBase = '',
  aircraft = [],
  feederLocation = null,
  onClose,
  onSave,
  onToast,
}) {
  // Support both 'rule' and 'editRule' props
  const ruleToEdit = editRule || rule;

  // Default structures
  const defaultCondition = { type: 'icao', operator: 'eq', value: '' };
  const defaultGroup = { logic: 'AND', conditions: [{ ...defaultCondition }] };

  // Form state
  const [form, setForm] = useState(() => initializeForm(ruleToEdit, prefillAircraft, defaultGroup));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});
  const [showTemplates, setShowTemplates] = useState(!ruleToEdit && !prefillAircraft);

  // Notification channels
  const [selectedChannelIds, setSelectedChannelIds] = useState(ruleToEdit?.notification_channel_ids || []);
  const [useGlobalNotifications, setUseGlobalNotifications] = useState(ruleToEdit?.use_global_notifications !== false);
  const { channels, loading: channelsLoading } = useNotificationChannels(apiBase);

  // Live preview state
  const [previewExpanded, setPreviewExpanded] = useState(true);
  const [debouncedForm, setDebouncedForm] = useState(form);
  const debounceTimeoutRef = useRef(null);

  // Focus management
  const modalRef = useRef(null);
  const firstInputRef = useRef(null);
  const previousActiveElement = useRef(null);
  const errorRef = useRef(null);

  // Initialize form based on edit rule or prefill
  function initializeForm(ruleToEdit, prefillAircraft, defaultGroup) {
    if (ruleToEdit) {
      let conditions = ruleToEdit.conditions;
      if (!conditions || (typeof conditions === 'object' && !conditions.groups)) {
        conditions = {
          logic: 'AND',
          groups: [{
            logic: 'AND',
            conditions: [{ type: ruleToEdit.type || 'icao', operator: ruleToEdit.operator || 'eq', value: ruleToEdit.value || '' }]
          }]
        };
      }
      return { ...ruleToEdit, conditions };
    }

    if (prefillAircraft) {
      const aircraftName = prefillAircraft.flight?.trim() || prefillAircraft.hex;
      return {
        name: `Track ${aircraftName}`,
        description: `Alert when ${aircraftName} (${prefillAircraft.hex}) is detected`,
        priority: 'info',
        enabled: true,
        starts_at: '',
        expires_at: '',
        cooldown: 300,
        conditions: {
          logic: 'AND',
          groups: [{
            logic: 'OR',
            conditions: [
              { type: 'icao', operator: 'eq', value: prefillAircraft.hex },
              ...(prefillAircraft.flight ? [{ type: 'callsign', operator: 'contains', value: prefillAircraft.flight.trim() }] : [])
            ]
          }]
        }
      };
    }

    return {
      name: '',
      description: '',
      priority: 'info',
      enabled: true,
      starts_at: '',
      expires_at: '',
      cooldown: 300,
      conditions: { logic: 'AND', groups: [{ ...defaultGroup }] }
    };
  }

  // Store previous focus and focus first input on mount
  useEffect(() => {
    previousActiveElement.current = document.activeElement;
    const timer = setTimeout(() => {
      firstInputRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  // Focus error message when it appears
  useEffect(() => {
    if (error && errorRef.current) {
      errorRef.current.focus();
    }
  }, [error]);

  // Debounce form changes for preview
  useEffect(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    debounceTimeoutRef.current = setTimeout(() => {
      setDebouncedForm(form);
    }, 300);
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [form]);

  // Calculate matching aircraft
  const matchingAircraft = useMemo(() => {
    if (!aircraft || aircraft.length === 0) return [];
    const tempRule = { conditions: debouncedForm.conditions };
    return findMatchingAircraft(tempRule, aircraft, feederLocation);
  }, [debouncedForm.conditions, aircraft, feederLocation]);

  // Close handler with focus restoration
  const handleClose = useCallback(() => {
    previousActiveElement.current?.focus();
    onClose?.();
  }, [onClose]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
        return;
      }

      // Focus trap
      if (e.key === 'Tab' && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleClose]);

  // Validate form
  const validateForm = () => {
    const errors = {};

    if (!form.name?.trim()) {
      errors.name = 'Rule name is required';
    }

    // Validate conditions
    const groups = form.conditions?.groups || [];
    if (groups.length === 0) {
      errors.conditions = 'At least one condition is required';
    } else {
      groups.forEach((group, gi) => {
        group.conditions?.forEach((cond, ci) => {
          const condType = CONDITION_TYPES.find(t => t.value === cond.type);
          if (condType && !condType.isBoolean && !cond.value?.trim()) {
            errors[`cond_${gi}_${ci}`] = 'Value is required';
          }
          if (condType?.validation && cond.value && !condType.validation.test(cond.value)) {
            errors[`cond_${gi}_${ci}`] = `Invalid format for ${condType.label}`;
          }
        });
      });
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Submit handler
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!validateForm()) {
      return;
    }

    setSaving(true);

    try {
      const firstCond = form.conditions?.groups?.[0]?.conditions?.[0];
      const payload = {
        name: form.name.trim(),
        description: form.description?.trim() || '',
        priority: form.priority,
        enabled: form.enabled,
        conditions: form.conditions,
        cooldown: form.cooldown || 300,
        starts_at: form.starts_at || null,
        expires_at: form.expires_at || null,
        notification_channel_ids: selectedChannelIds,
        use_global_notifications: useGlobalNotifications,
        // Legacy fields for backwards compatibility
        type: firstCond?.type,
        operator: firstCond?.operator,
        value: firstCond?.value,
      };

      const isEdit = ruleToEdit?.id;
      const url = isEdit
        ? `${apiBase}/api/v1/alerts/rules/${ruleToEdit.id}`
        : `${apiBase}/api/v1/alerts/rules`;

      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const contentType = res.headers.get('content-type');
        let errorMsg = `Failed to save rule (HTTP ${res.status})`;
        if (contentType && contentType.includes('application/json')) {
          const data = await res.json();
          errorMsg = data.error || data.detail ||
                     (data.non_field_errors && data.non_field_errors[0]) ||
                     Object.values(data).flat()[0] || errorMsg;
        }
        throw new Error(errorMsg);
      }

      onToast?.(isEdit ? 'Rule updated' : 'Rule created', 'success');
      onSave?.();
      handleClose();
    } catch (err) {
      console.error('Failed to save rule:', err);
      setError(err.message || 'Failed to save rule');
    } finally {
      setSaving(false);
    }
  };

  // Apply template
  const applyTemplate = (template) => {
    setForm({
      ...form,
      ...template.rule,
      enabled: true,
    });
    setShowTemplates(false);
  };

  // Condition management
  const updateGroupLogic = (groupIndex, logic) => {
    const newGroups = [...(form.conditions?.groups || [])];
    newGroups[groupIndex] = { ...newGroups[groupIndex], logic };
    setForm({ ...form, conditions: { ...form.conditions, groups: newGroups } });
  };

  const updateCondition = (groupIndex, condIndex, field, value) => {
    const newGroups = [...(form.conditions?.groups || [])];
    const newConditions = [...newGroups[groupIndex].conditions];
    newConditions[condIndex] = { ...newConditions[condIndex], [field]: value };
    newGroups[groupIndex] = { ...newGroups[groupIndex], conditions: newConditions };
    setForm({ ...form, conditions: { ...form.conditions, groups: newGroups } });

    // Clear validation error for this field
    setValidationErrors(prev => {
      const next = { ...prev };
      delete next[`cond_${groupIndex}_${condIndex}`];
      return next;
    });
  };

  const addCondition = (groupIndex) => {
    const newGroups = [...(form.conditions?.groups || [])];
    newGroups[groupIndex] = {
      ...newGroups[groupIndex],
      conditions: [...newGroups[groupIndex].conditions, { ...defaultCondition }]
    };
    setForm({ ...form, conditions: { ...form.conditions, groups: newGroups } });
  };

  const removeCondition = (groupIndex, condIndex) => {
    let newGroups = [...(form.conditions?.groups || [])];
    newGroups[groupIndex] = {
      ...newGroups[groupIndex],
      conditions: newGroups[groupIndex].conditions.filter((_, i) => i !== condIndex)
    };
    if (newGroups[groupIndex].conditions.length === 0) {
      newGroups = newGroups.filter((_, i) => i !== groupIndex);
    }
    if (newGroups.length === 0) {
      newGroups = [{ ...defaultGroup }];
    }
    setForm({ ...form, conditions: { ...form.conditions, groups: newGroups } });
  };

  const addGroup = () => {
    setForm({
      ...form,
      conditions: {
        ...form.conditions,
        groups: [...(form.conditions?.groups || []), { ...defaultGroup }]
      }
    });
  };

  // Get operators for condition type
  const getOperatorsForType = (type) => {
    const condType = CONDITION_TYPES.find(t => t.value === type);
    if (condType?.isBoolean) {
      return [{ value: 'eq', label: 'is' }];
    }
    if (condType?.type === 'number') {
      return NUMERIC_OPERATORS;
    }
    return STRING_OPERATORS;
  };

  // Toggle channel selection
  const toggleChannelSelection = (channelId) => {
    setSelectedChannelIds(prev =>
      prev.includes(channelId)
        ? prev.filter(id => id !== channelId)
        : [...prev, channelId]
    );
  };

  return (
    <div
      className="modal-overlay rule-form-overlay"
      onClick={handleClose}
      role="presentation"
    >
      <div
        className="modal modal-large rule-form"
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rule-form-title"
      >
        <div className="modal-header rule-form-header">
          <h3 id="rule-form-title">
            {ruleToEdit ? 'Edit Alert Rule' : 'Create Alert Rule'}
          </h3>
          <button
            className="close-btn"
            onClick={handleClose}
            aria-label="Close form (Escape)"
            type="button"
          >
            <X size={20} />
          </button>
        </div>

        {/* Keyboard hints */}
        <div className="keyboard-hints" aria-hidden="true">
          <span><kbd>Esc</kbd> Close</span>
          <span><kbd>Tab</kbd> Next field</span>
        </div>

        {/* Templates section */}
        {showTemplates && !ruleToEdit && (
          <div className="rule-templates-section">
            <div className="templates-header">
              <FileText size={16} />
              <span>Quick Start Templates</span>
              <button
                type="button"
                className="templates-toggle"
                onClick={() => setShowTemplates(false)}
              >
                <X size={14} /> Skip
              </button>
            </div>
            <div className="templates-grid">
              {RULE_TEMPLATES.map(template => (
                <button
                  key={template.id}
                  type="button"
                  className="template-card"
                  onClick={() => applyTemplate(template)}
                >
                  <span className="template-icon">{template.icon}</span>
                  <span className="template-name">{template.name}</span>
                  <span className="template-desc">{template.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="modal-content">
          {error && (
            <div
              className="rule-form-error"
              role="alert"
              aria-live="assertive"
              ref={errorRef}
              tabIndex="-1"
            >
              <AlertCircle size={16} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {/* Rule Name */}
          <div className="form-group">
            <label htmlFor="rule-name">Rule Name *</label>
            <input
              id="rule-name"
              ref={firstInputRef}
              type="text"
              value={form.name || ''}
              onChange={e => {
                setForm({ ...form, name: e.target.value });
                setValidationErrors(prev => ({ ...prev, name: undefined }));
              }}
              placeholder="e.g., Military Aircraft Alert"
              required
              aria-required="true"
              aria-invalid={!!validationErrors.name}
              aria-describedby={validationErrors.name ? 'name-error' : undefined}
            />
            {validationErrors.name && (
              <span id="name-error" className="field-error">{validationErrors.name}</span>
            )}
          </div>

          {/* Priority/Severity */}
          <div className="form-group">
            <label id="severity-label">Priority</label>
            <div className="severity-options" role="radiogroup" aria-labelledby="severity-label">
              {Object.entries(SEVERITY_CONFIG).map(([value, config]) => {
                const { label, Icon, color } = config;
                return (
                  <label
                    key={value}
                    className={`severity-option ${form.priority === value ? 'selected' : ''}`}
                    style={{ '--severity-color': color }}
                  >
                    <input
                      type="radio"
                      name="priority"
                      value={value}
                      checked={form.priority === value}
                      onChange={(e) => setForm({ ...form, priority: e.target.value })}
                    />
                    <Icon size={14} aria-hidden="true" className="severity-icon" />
                    <span>{label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Conditions Builder */}
          <div className="form-group">
            <label>Conditions *</label>
            {validationErrors.conditions && (
              <span className="field-error">{validationErrors.conditions}</span>
            )}
            <div className="conditions-builder">
              <div className="condition-groups">
                {form.conditions?.groups?.map((group, gi) => (
                  <div key={gi} className="condition-group">
                    <div className="condition-group-header">
                      {gi > 0 && (
                        <select
                          className="logic-select"
                          value={form.conditions?.logic || 'AND'}
                          onChange={e => setForm({ ...form, conditions: { ...form.conditions, logic: e.target.value } })}
                          aria-label="Logic between groups"
                        >
                          <option value="AND">AND</option>
                          <option value="OR">OR</option>
                        </select>
                      )}
                      <span className="group-label">Group {gi + 1}</span>
                      {group.conditions.length > 1 && (
                        <select
                          className="logic-select"
                          value={group.logic}
                          onChange={e => updateGroupLogic(gi, e.target.value)}
                          aria-label="Logic within group"
                        >
                          <option value="AND">Match ALL</option>
                          <option value="OR">Match ANY</option>
                        </select>
                      )}
                    </div>

                    <div className="condition-rows">
                      {group.conditions.map((cond, ci) => {
                        const condType = CONDITION_TYPES.find(t => t.value === cond.type);
                        const operators = getOperatorsForType(cond.type);
                        const hasError = validationErrors[`cond_${gi}_${ci}`];

                        return (
                          <div key={ci} className={`condition-row ${hasError ? 'has-error' : ''}`}>
                            <select
                              value={cond.type}
                              onChange={e => updateCondition(gi, ci, 'type', e.target.value)}
                              aria-label="Condition type"
                            >
                              {CONDITION_TYPES.map(t => (
                                <option key={t.value} value={t.value}>{t.label}</option>
                              ))}
                            </select>

                            <select
                              value={cond.operator}
                              onChange={e => updateCondition(gi, ci, 'operator', e.target.value)}
                              aria-label="Operator"
                            >
                              {operators.map(o => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>

                            {!condType?.isBoolean && (
                              <input
                                type={condType?.type === 'number' ? 'number' : 'text'}
                                value={cond.value || ''}
                                onChange={e => updateCondition(gi, ci, 'value', e.target.value)}
                                placeholder={condType?.placeholder || 'Value'}
                                aria-label="Value"
                                aria-invalid={!!hasError}
                              />
                            )}

                            <button
                              type="button"
                              className="remove-condition-btn"
                              onClick={() => removeCondition(gi, ci)}
                              aria-label="Remove condition"
                            >
                              <X size={16} />
                            </button>

                            {hasError && (
                              <span className="condition-error">{hasError}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <button type="button" className="add-condition-btn" onClick={() => addCondition(gi)}>
                      <Plus size={14} /> Add Condition
                    </button>
                  </div>
                ))}
              </div>

              <button type="button" className="add-group-btn" onClick={addGroup}>
                <Plus size={14} /> Add Condition Group (OR)
              </button>
            </div>
          </div>

          {/* Live Preview */}
          {aircraft && aircraft.length > 0 && (
            <div className="live-preview-panel">
              <button
                type="button"
                className="preview-toggle"
                onClick={() => setPreviewExpanded(!previewExpanded)}
                aria-expanded={previewExpanded}
                aria-controls="preview-content"
              >
                <Eye size={16} aria-hidden="true" />
                <span className="preview-summary">
                  Matching <strong>{matchingAircraft.length}</strong> of {aircraft.length} aircraft
                </span>
                {previewExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>

              {previewExpanded && (
                <div id="preview-content" className="preview-content">
                  {matchingAircraft.length > 0 ? (
                    <div className="preview-aircraft-list" role="list">
                      {matchingAircraft.slice(0, 5).map(ac => {
                        const values = getRelevantValues({ conditions: form.conditions }, ac);
                        return (
                          <div key={ac.hex} className="preview-aircraft-item" role="listitem">
                            <div className="preview-aircraft-header">
                              <Plane size={14} aria-hidden="true" />
                              <span className="preview-callsign">{ac.flight?.trim() || 'N/A'}</span>
                              <span className="preview-hex">{ac.hex}</span>
                            </div>
                            <div className="preview-aircraft-values">
                              {values.altitude != null && (
                                <span className="preview-value">Alt: {values.altitude}ft</span>
                              )}
                              {values.speed != null && (
                                <span className="preview-value">Spd: {values.speed}kts</span>
                              )}
                              {(values.distance != null || ac.calculatedDistance != null) && (
                                <span className="preview-value">
                                  Dist: {(values.distance ?? ac.calculatedDistance ?? 0).toFixed(1)}nm
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {matchingAircraft.length > 5 && (
                        <div className="preview-more">
                          ...and {matchingAircraft.length - 5} more aircraft
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="preview-empty">
                      No aircraft currently match these conditions
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Cooldown */}
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="cooldown">Cooldown (seconds)</label>
              <input
                id="cooldown"
                type="number"
                value={form.cooldown || 300}
                onChange={(e) => setForm({ ...form, cooldown: parseInt(e.target.value) || 0 })}
                min={0}
                max={86400}
              />
              <span className="form-hint">Time between repeated alerts for same aircraft</span>
            </div>

            <div className="form-group">
              <label className="checkbox-label" style={{ marginTop: '24px' }}>
                <input
                  type="checkbox"
                  checked={form.enabled !== false}
                  onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                />
                <span>Enabled</span>
              </label>
            </div>
          </div>

          {/* Schedule */}
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="rule-starts-at">Starts At (Optional)</label>
              <input
                id="rule-starts-at"
                type="datetime-local"
                value={form.starts_at ? form.starts_at.slice(0, 16) : ''}
                onChange={e => setForm({ ...form, starts_at: e.target.value ? new Date(e.target.value).toISOString() : '' })}
              />
            </div>
            <div className="form-group">
              <label htmlFor="rule-expires-at">Expires At (Optional)</label>
              <input
                id="rule-expires-at"
                type="datetime-local"
                value={form.expires_at ? form.expires_at.slice(0, 16) : ''}
                onChange={e => setForm({ ...form, expires_at: e.target.value ? new Date(e.target.value).toISOString() : '' })}
              />
            </div>
          </div>

          {/* Notification Channels */}
          <fieldset className="form-group notification-channels-fieldset">
            <legend>
              <Bell size={16} aria-hidden="true" />
              Notification Channels
            </legend>

            <div className="form-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={useGlobalNotifications}
                  onChange={(e) => setUseGlobalNotifications(e.target.checked)}
                />
                <span>Use global notifications (from server config)</span>
              </label>
            </div>

            {channels.length > 0 ? (
              <div className="notification-channels-list" role="group" aria-label="Select notification channels">
                {channels.filter(c => c.enabled).map(channel => {
                  const typeInfo = CHANNEL_TYPE_INFO[channel.channel_type] || CHANNEL_TYPE_INFO.custom;
                  const isSelected = selectedChannelIds.includes(channel.id);

                  return (
                    <button
                      key={channel.id}
                      type="button"
                      className={`channel-select-btn ${isSelected ? 'selected' : ''}`}
                      onClick={() => toggleChannelSelection(channel.id)}
                      aria-pressed={isSelected}
                      style={{ '--channel-color': typeInfo.color }}
                    >
                      <span className="channel-icon">{typeInfo.icon}</span>
                      <span className="channel-name">{channel.name}</span>
                      {isSelected && <Check size={14} className="check-icon" />}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="no-channels-hint">
                {channelsLoading ? 'Loading channels...' : 'No notification channels configured. Add channels in the Notifications tab.'}
              </p>
            )}

            {selectedChannelIds.length > 0 && (
              <span className="channels-selected-count">
                {selectedChannelIds.length} channel{selectedChannelIds.length !== 1 ? 's' : ''} selected
              </span>
            )}
          </fieldset>

          {/* Description */}
          <div className="form-group">
            <label htmlFor="rule-description">Description (Optional)</label>
            <textarea
              id="rule-description"
              value={form.description || ''}
              onChange={e => setForm({ ...form, description: e.target.value })}
              rows={2}
              placeholder="Optional description"
            />
          </div>

          {/* Actions */}
          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={handleClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={saving}
              aria-busy={saving}
            >
              <Save size={16} aria-hidden="true" />
              {saving ? 'Saving...' : 'Save Rule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default RuleForm;
