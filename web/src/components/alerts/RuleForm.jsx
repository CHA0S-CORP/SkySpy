import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Save, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { useNotificationChannels } from '../../hooks/useNotificationChannels';
import { SEVERITY_CONFIG, DEFAULT_GROUP, initializeForm, validateForm } from './RuleFormConstants';
import { ConditionBuilder } from './ConditionBuilder';
import { LivePreview } from './LivePreview';
import { NotificationChannelSelector } from './NotificationChannelSelector';
import { RuleTemplates } from './RuleTemplates';

// Map icon names to components
const SEVERITY_ICONS = {
  Info: Info,
  AlertTriangle: AlertTriangle,
  AlertCircle: AlertCircle,
};

/**
 * SeveritySelector component - renders priority/severity options
 */
function SeveritySelector({ value, onChange }) {
  return (
    <div className="form-group">
      <label id="severity-label">Priority</label>
      <div className="severity-options" role="radiogroup" aria-labelledby="severity-label">
        {Object.entries(SEVERITY_CONFIG).map(([key, config]) => {
          const { label, iconName, color } = config;
          const Icon = SEVERITY_ICONS[iconName] || Info;
          return (
            <label
              key={key}
              className={`severity-option ${value === key ? 'selected' : ''}`}
              style={{ '--severity-color': color }}
            >
              <input
                type="radio"
                name="priority"
                value={key}
                checked={value === key}
                onChange={(e) => onChange(e.target.value)}
              />
              <Icon size={14} aria-hidden="true" className="severity-icon" />
              <span>{label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/**
 * ScheduleFields component - renders starts_at and expires_at fields
 */
function ScheduleFields({ startsAt, expiresAt, onChange }) {
  return (
    <div className="form-row">
      <div className="form-group">
        <label htmlFor="rule-starts-at">Starts At (Optional)</label>
        <input
          id="rule-starts-at"
          type="datetime-local"
          value={startsAt ? startsAt.slice(0, 16) : ''}
          onChange={e => onChange('starts_at', e.target.value ? new Date(e.target.value).toISOString() : '')}
        />
      </div>
      <div className="form-group">
        <label htmlFor="rule-expires-at">Expires At (Optional)</label>
        <input
          id="rule-expires-at"
          type="datetime-local"
          value={expiresAt ? expiresAt.slice(0, 16) : ''}
          onChange={e => onChange('expires_at', e.target.value ? new Date(e.target.value).toISOString() : '')}
        />
      </div>
    </div>
  );
}

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
  rule = null,
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

  // Form state
  const [form, setForm] = useState(() => initializeForm(ruleToEdit, prefillAircraft, DEFAULT_GROUP));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});
  const [showTemplates, setShowTemplates] = useState(!ruleToEdit && !prefillAircraft);

  // Notification channels
  const [selectedChannelIds, setSelectedChannelIds] = useState(ruleToEdit?.notification_channel_ids || []);
  const [useGlobalNotifications, setUseGlobalNotifications] = useState(ruleToEdit?.use_global_notifications !== false);
  const { channels, loading: channelsLoading } = useNotificationChannels(apiBase);

  // Focus management
  const modalRef = useRef(null);
  const firstInputRef = useRef(null);
  const previousActiveElement = useRef(null);
  const errorRef = useRef(null);

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

  // Submit handler
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const errors = validateForm(form);
    setValidationErrors(errors);
    if (Object.keys(errors).length > 0) {
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
  const applyTemplate = (templateRule) => {
    setForm({ ...form, ...templateRule });
    setShowTemplates(false);
  };

  // Update form field
  const updateField = (field, value) => {
    setForm({ ...form, [field]: value });
    if (field === 'name') {
      setValidationErrors(prev => ({ ...prev, name: undefined }));
    }
  };

  // Clear validation error
  const clearValidationError = (key) => {
    setValidationErrors(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
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
          <RuleTemplates
            onApply={applyTemplate}
            onSkip={() => setShowTemplates(false)}
          />
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
              onChange={e => updateField('name', e.target.value)}
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
          <SeveritySelector
            value={form.priority}
            onChange={(value) => updateField('priority', value)}
          />

          {/* Conditions Builder */}
          <div className="form-group">
            <label>Conditions *</label>
            <ConditionBuilder
              conditions={form.conditions}
              validationErrors={validationErrors}
              onChange={(conditions) => setForm({ ...form, conditions })}
              onValidationErrorsClear={clearValidationError}
            />
          </div>

          {/* Live Preview */}
          <LivePreview
            conditions={form.conditions}
            aircraft={aircraft}
            feederLocation={feederLocation}
          />

          {/* Cooldown */}
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="cooldown">Cooldown (seconds)</label>
              <input
                id="cooldown"
                type="number"
                value={form.cooldown || 300}
                onChange={(e) => updateField('cooldown', parseInt(e.target.value) || 0)}
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
                  onChange={(e) => updateField('enabled', e.target.checked)}
                />
                <span>Enabled</span>
              </label>
            </div>
          </div>

          {/* Schedule */}
          <ScheduleFields
            startsAt={form.starts_at}
            expiresAt={form.expires_at}
            onChange={updateField}
          />

          {/* Notification Channels */}
          <NotificationChannelSelector
            channels={channels}
            channelsLoading={channelsLoading}
            selectedChannelIds={selectedChannelIds}
            useGlobalNotifications={useGlobalNotifications}
            onToggleChannel={toggleChannelSelection}
            onToggleGlobal={setUseGlobalNotifications}
          />

          {/* Description */}
          <div className="form-group">
            <label htmlFor="rule-description">Description (Optional)</label>
            <textarea
              id="rule-description"
              value={form.description || ''}
              onChange={e => updateField('description', e.target.value)}
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
