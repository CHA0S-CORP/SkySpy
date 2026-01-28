import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Save, Plus, Trash2, Info, AlertTriangle, AlertCircle, Bell, BellOff, Check } from 'lucide-react';
import { useNotificationChannels } from '../../hooks/useNotificationChannels';

// Severity icons that don't rely on color alone
const SEVERITY_ICONS = {
  info: Info,
  warning: AlertTriangle,
  critical: AlertCircle,
};

const CONDITION_TYPES = [
  { value: 'callsign', label: 'Callsign' },
  { value: 'hex', label: 'ICAO Hex' },
  { value: 'squawk', label: 'Squawk Code' },
  { value: 'altitude_above', label: 'Altitude Above' },
  { value: 'altitude_below', label: 'Altitude Below' },
  { value: 'speed_above', label: 'Speed Above' },
  { value: 'speed_below', label: 'Speed Below' },
  { value: 'distance_within', label: 'Distance Within' },
  { value: 'distance_from_mobile', label: 'Distance From Mobile' },
  { value: 'military', label: 'Military Aircraft' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'type', label: 'Aircraft Type' },
  { value: 'law_enforcement', label: 'Law Enforcement' },
  { value: 'helicopter', label: 'Helicopter' },
];

const SEVERITY_LEVELS = [
  { value: 'info', label: 'Info', color: '#3b82f6' },
  { value: 'warning', label: 'Warning', color: '#f59e0b' },
  { value: 'critical', label: 'Critical', color: '#ef4444' },
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

export function RuleForm({
  apiBase,
  onClose,
  onSave,
  editRule = null,
  prefillAircraft = null
}) {
  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [severity, setSeverity] = useState('info');
  const [conditions, setConditions] = useState([{ type: 'callsign', value: '', operator: 'equals' }]);
  const [cooldown, setCooldown] = useState(300);
  const [selectedChannelIds, setSelectedChannelIds] = useState([]);
  const [useGlobalNotifications, setUseGlobalNotifications] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Fetch available notification channels
  const { channels, loading: channelsLoading } = useNotificationChannels(apiBase);

  // Refs for focus management
  const modalRef = useRef(null);
  const firstInputRef = useRef(null);
  const previousActiveElement = useRef(null);
  const errorRef = useRef(null);

  // Initialize form with edit rule or prefill data
  useEffect(() => {
    if (editRule) {
      setName(editRule.name || '');
      setEnabled(editRule.enabled !== false);
      setSeverity(editRule.severity || editRule.priority || 'info');

      // Convert Django API conditions format (with groups) to simple array format
      let parsedConditions = [{ type: 'callsign', value: '', operator: 'equals' }];
      if (editRule.conditions) {
        if (Array.isArray(editRule.conditions)) {
          // Already in simple format
          parsedConditions = editRule.conditions.map(c => ({
            type: c.type,
            value: c.value || '',
            operator: c.operator === 'eq' ? 'equals' :
                      c.operator === 'contains' ? 'contains' :
                      c.operator === 'startswith' ? 'starts_with' : c.operator || 'equals'
          }));
        } else if (editRule.conditions.groups && Array.isArray(editRule.conditions.groups)) {
          // Django groups format - flatten to simple array
          parsedConditions = editRule.conditions.groups.flatMap(g =>
            (g.conditions || []).map(c => ({
              type: c.type,
              value: c.value || '',
              operator: c.operator === 'eq' ? 'equals' :
                        c.operator === 'contains' ? 'contains' :
                        c.operator === 'startswith' ? 'starts_with' : c.operator || 'equals'
            }))
          );
        }
        if (parsedConditions.length === 0) {
          parsedConditions = [{ type: 'callsign', value: '', operator: 'equals' }];
        }
      }
      setConditions(parsedConditions);

      setCooldown(editRule.cooldown || 300);
      setSelectedChannelIds(editRule.notification_channel_ids || []);
      setUseGlobalNotifications(editRule.use_global_notifications !== false);
    } else if (prefillAircraft) {
      setName(`Alert for ${prefillAircraft.flight?.trim() || prefillAircraft.hex}`);
      setConditions([
        { type: 'hex', value: prefillAircraft.hex, operator: 'equals' }
      ]);
    }
  }, [editRule, prefillAircraft]);

  // Store previous focus element and focus first input on mount
  useEffect(() => {
    previousActiveElement.current = document.activeElement;
    // Focus first input after a brief delay to ensure modal is rendered
    const timer = setTimeout(() => {
      firstInputRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  // Return focus when modal closes
  const handleClose = useCallback(() => {
    previousActiveElement.current?.focus();
    onClose?.();
  }, [onClose]);

  // Focus error message when it appears
  useEffect(() => {
    if (error && errorRef.current) {
      errorRef.current.focus();
    }
  }, [error]);

  // Keyboard navigation handler
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Escape to close
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
        return;
      }

      // Focus trap - Tab key
      if (e.key === 'Tab' && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          // Shift + Tab: if on first element, go to last
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          // Tab: if on last element, go to first
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

  const handleAddCondition = () => {
    setConditions([...conditions, { type: 'callsign', value: '', operator: 'equals' }]);
  };

  const handleRemoveCondition = (index) => {
    if (conditions.length > 1) {
      setConditions(conditions.filter((_, i) => i !== index));
    }
  };

  const handleConditionChange = (index, field, value) => {
    const updated = [...conditions];
    updated[index] = { ...updated[index], [field]: value };
    setConditions(updated);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      // Convert simple conditions array to Django API format with groups
      const conditionsPayload = Array.isArray(conditions) && conditions.length > 0
        ? {
            logic: 'AND',
            groups: [{
              logic: 'AND',
              conditions: conditions.map(c => ({
                type: c.type,
                operator: c.operator === 'equals' ? 'eq' :
                          c.operator === 'contains' ? 'contains' :
                          c.operator === 'starts_with' ? 'startswith' : c.operator,
                value: c.value
              }))
            }]
          }
        : conditions;

      const rule = {
        name,
        enabled,
        priority: severity,
        conditions: conditionsPayload,
        cooldown,
        notification_channel_ids: selectedChannelIds,
        use_global_notifications: useGlobalNotifications,
      };

      const url = editRule?.id
        ? `${apiBase}/api/v1/alerts/rules/${editRule.id}`
        : `${apiBase}/api/v1/alerts/rules`;

      // Use PATCH for updates, POST for creates
      const method = editRule?.id ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rule),
      });

      if (!res.ok) {
        let errorMsg = 'Failed to save rule';
        try {
          const ct = res.headers.get('content-type');
          if (ct && ct.includes('application/json')) {
            const data = await res.json();
            // Handle Django REST Framework error format
            errorMsg = data.error || data.detail ||
                       (data.non_field_errors && data.non_field_errors[0]) ||
                       Object.values(data).flat()[0] || errorMsg;
          }
        } catch {}
        throw new Error(errorMsg);
      }

      onSave?.();
      onClose?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
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
      className="rule-form-overlay"
      onClick={handleClose}
      role="presentation"
    >
      <div
        className="rule-form"
        ref={modalRef}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rule-form-title"
        aria-describedby="rule-form-description"
      >
        <div className="rule-form-header">
          <h3 id="rule-form-title">{editRule ? 'Edit Alert Rule' : 'Create Alert Rule'}</h3>
          <p id="rule-form-description" className="sr-only">
            {editRule ? 'Modify the settings for this alert rule' : 'Create a new alert rule to monitor aircraft'}
          </p>
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
          <span><kbd>Enter</kbd> Save</span>
          <span><kbd>Tab</kbd> Next field</span>
        </div>

        <form onSubmit={handleSubmit}>
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

          <div className="form-group">
            <label htmlFor="rule-name">Rule Name</label>
            <input
              id="rule-name"
              ref={firstInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Alert Rule"
              required
              aria-required="true"
              aria-describedby="rule-name-hint"
            />
            <span id="rule-name-hint" className="sr-only">Enter a descriptive name for this alert rule</span>
          </div>

          <div className="form-group">
            <label id="severity-label">Severity</label>
            <div
              className="severity-options"
              role="radiogroup"
              aria-labelledby="severity-label"
              aria-describedby="severity-hint"
            >
              {SEVERITY_LEVELS.map(level => {
                const SeverityIcon = SEVERITY_ICONS[level.value];
                return (
                  <label
                    key={level.value}
                    className={`severity-option ${severity === level.value ? 'selected' : ''}`}
                    style={{ '--severity-color': level.color }}
                  >
                    <input
                      type="radio"
                      name="severity"
                      value={level.value}
                      checked={severity === level.value}
                      onChange={(e) => setSeverity(e.target.value)}
                      aria-describedby={`severity-${level.value}-desc`}
                    />
                    <SeverityIcon size={14} aria-hidden="true" className="severity-icon" />
                    <span>{level.label}</span>
                    <span id={`severity-${level.value}-desc`} className="sr-only">
                      {level.value === 'info' && 'Informational alerts for general monitoring'}
                      {level.value === 'warning' && 'Warning alerts for situations requiring attention'}
                      {level.value === 'critical' && 'Critical alerts for urgent situations'}
                    </span>
                  </label>
                );
              })}
            </div>
            <span id="severity-hint" className="sr-only">Select the priority level for this alert</span>
          </div>

          <fieldset className="form-group conditions-fieldset">
            <legend id="conditions-label">Conditions</legend>
            <div
              className="conditions-list"
              role="list"
              aria-describedby="conditions-hint"
            >
              <p id="conditions-hint" className="sr-only">
                Define one or more conditions that must be met to trigger this alert
              </p>
              {conditions.map((condition, index) => (
                <div
                  key={index}
                  className="condition-row"
                  role="listitem"
                  aria-label={`Condition ${index + 1} of ${conditions.length}`}
                >
                  <label htmlFor={`condition-type-${index}`} className="sr-only">
                    Condition {index + 1} type
                  </label>
                  <select
                    id={`condition-type-${index}`}
                    value={condition.type}
                    onChange={(e) => handleConditionChange(index, 'type', e.target.value)}
                    aria-label={`Condition ${index + 1} type`}
                  >
                    {CONDITION_TYPES.map(type => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>

                  {!['military', 'emergency', 'law_enforcement', 'helicopter'].includes(condition.type) && (
                    <>
                      <label htmlFor={`condition-operator-${index}`} className="sr-only">
                        Condition {index + 1} operator
                      </label>
                      <select
                        id={`condition-operator-${index}`}
                        value={condition.operator}
                        onChange={(e) => handleConditionChange(index, 'operator', e.target.value)}
                        className="operator-select"
                        aria-label={`Condition ${index + 1} operator`}
                      >
                        <option value="equals">equals</option>
                        <option value="contains">contains</option>
                        <option value="starts_with">starts with</option>
                      </select>

                      <label htmlFor={`condition-value-${index}`} className="sr-only">
                        Condition {index + 1} value
                      </label>
                      <input
                        id={`condition-value-${index}`}
                        type="text"
                        value={condition.value}
                        onChange={(e) => handleConditionChange(index, 'value', e.target.value)}
                        placeholder="Value"
                        aria-label={`Condition ${index + 1} value`}
                      />
                    </>
                  )}

                  {conditions.length > 1 && (
                    <button
                      type="button"
                      className="remove-condition"
                      onClick={() => handleRemoveCondition(index)}
                      aria-label={`Remove condition ${index + 1}: ${condition.type} ${condition.operator || ''} ${condition.value || ''}`}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      <span className="sr-only">Remove condition</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              className="add-condition"
              onClick={handleAddCondition}
              aria-describedby="add-condition-hint"
            >
              <Plus size={14} aria-hidden="true" />
              Add Condition
            </button>
            <span id="add-condition-hint" className="sr-only">Add another condition to this rule</span>
          </fieldset>

          <div className="form-group">
            <label htmlFor="cooldown">Cooldown (seconds)</label>
            <input
              id="cooldown"
              type="number"
              value={cooldown}
              onChange={(e) => setCooldown(parseInt(e.target.value) || 0)}
              min={0}
              max={86400}
              aria-describedby="cooldown-hint"
            />
            <span id="cooldown-hint" className="form-hint">
              Time between repeated alerts for the same aircraft
            </span>
          </div>

          {/* Notification Channels Section */}
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

          <div className="form-group checkbox-group">
            <label className="checkbox-label">
              <input
                id="enabled"
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                aria-describedby="enabled-hint"
              />
              <span>Enabled</span>
            </label>
            <span id="enabled-hint" className="sr-only">
              When enabled, this rule will actively monitor for matching aircraft
            </span>
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="cancel-btn"
              onClick={handleClose}
              aria-label="Cancel and close form"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="save-btn"
              disabled={saving}
              aria-busy={saving}
              aria-describedby="save-hint"
            >
              <Save size={16} aria-hidden="true" />
              {saving ? 'Saving...' : 'Save Rule'}
            </button>
            <span id="save-hint" className="sr-only">
              {saving ? 'Saving rule, please wait' : 'Save this alert rule'}
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}

export default RuleForm;
