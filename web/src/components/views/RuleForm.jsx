import React, { useState, useEffect } from 'react';
import { X, Save, Plus, Trash2 } from 'lucide-react';

const CONDITION_TYPES = [
  { value: 'callsign', label: 'Callsign' },
  { value: 'hex', label: 'ICAO Hex' },
  { value: 'squawk', label: 'Squawk Code' },
  { value: 'altitude_above', label: 'Altitude Above' },
  { value: 'altitude_below', label: 'Altitude Below' },
  { value: 'speed_above', label: 'Speed Above' },
  { value: 'speed_below', label: 'Speed Below' },
  { value: 'distance_within', label: 'Distance Within' },
  { value: 'military', label: 'Military Aircraft' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'type', label: 'Aircraft Type' },
];

const SEVERITY_LEVELS = [
  { value: 'info', label: 'Info', color: '#3b82f6' },
  { value: 'warning', label: 'Warning', color: '#f59e0b' },
  { value: 'critical', label: 'Critical', color: '#ef4444' },
];

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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Initialize form with edit rule or prefill data
  useEffect(() => {
    if (editRule) {
      setName(editRule.name || '');
      setEnabled(editRule.enabled !== false);
      setSeverity(editRule.severity || 'info');
      setConditions(editRule.conditions || [{ type: 'callsign', value: '', operator: 'equals' }]);
      setCooldown(editRule.cooldown || 300);
    } else if (prefillAircraft) {
      setName(`Alert for ${prefillAircraft.flight?.trim() || prefillAircraft.hex}`);
      setConditions([
        { type: 'hex', value: prefillAircraft.hex, operator: 'equals' }
      ]);
    }
  }, [editRule, prefillAircraft]);

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
      const rule = {
        name,
        enabled,
        severity,
        conditions,
        cooldown,
      };

      const url = editRule 
        ? `${apiBase}/api/v1/alerts/rules/${editRule.id}`
        : `${apiBase}/api/v1/alerts/rules`;
      
      const method = editRule ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rule),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save rule');
      }

      onSave?.();
      onClose?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rule-form-overlay" onClick={onClose}>
      <div className="rule-form" onClick={e => e.stopPropagation()}>
        <div className="rule-form-header">
          <h3>{editRule ? 'Edit Alert Rule' : 'Create Alert Rule'}</h3>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {error && (
            <div className="rule-form-error">{error}</div>
          )}

          <div className="form-group">
            <label>Rule Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Alert Rule"
              required
            />
          </div>

          <div className="form-group">
            <label>Severity</label>
            <div className="severity-options">
              {SEVERITY_LEVELS.map(level => (
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
                  />
                  <span>{level.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>Conditions</label>
            <div className="conditions-list">
              {conditions.map((condition, index) => (
                <div key={index} className="condition-row">
                  <select
                    value={condition.type}
                    onChange={(e) => handleConditionChange(index, 'type', e.target.value)}
                  >
                    {CONDITION_TYPES.map(type => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>

                  {!['military', 'emergency'].includes(condition.type) && (
                    <>
                      <select
                        value={condition.operator}
                        onChange={(e) => handleConditionChange(index, 'operator', e.target.value)}
                        className="operator-select"
                      >
                        <option value="equals">equals</option>
                        <option value="contains">contains</option>
                        <option value="starts_with">starts with</option>
                      </select>

                      <input
                        type="text"
                        value={condition.value}
                        onChange={(e) => handleConditionChange(index, 'value', e.target.value)}
                        placeholder="Value"
                      />
                    </>
                  )}

                  {conditions.length > 1 && (
                    <button
                      type="button"
                      className="remove-condition"
                      onClick={() => handleRemoveCondition(index)}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              className="add-condition"
              onClick={handleAddCondition}
            >
              <Plus size={14} />
              Add Condition
            </button>
          </div>

          <div className="form-group">
            <label>Cooldown (seconds)</label>
            <input
              type="number"
              value={cooldown}
              onChange={(e) => setCooldown(parseInt(e.target.value) || 0)}
              min={0}
              max={86400}
            />
            <span className="form-hint">
              Time between repeated alerts for the same aircraft
            </span>
          </div>

          <div className="form-group checkbox-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span>Enabled</span>
            </label>
          </div>

          <div className="form-actions">
            <button type="button" className="cancel-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="save-btn" disabled={saving}>
              <Save size={16} />
              {saving ? 'Saving...' : 'Save Rule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default RuleForm;
