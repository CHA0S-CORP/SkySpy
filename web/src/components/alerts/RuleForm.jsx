import React, { useState } from 'react';
import { X, Plus } from 'lucide-react';

export function RuleForm({ rule, prefillAircraft, apiBase, onClose, onSave }) {
  const defaultCondition = { type: 'icao', operator: 'eq', value: '' };
  const defaultGroup = { logic: 'AND', conditions: [{ ...defaultCondition }] };

  const [form, setForm] = useState(() => {
    if (rule) {
      return {
        ...rule,
        conditions: rule.conditions || {
          logic: 'AND',
          groups: [{ logic: 'AND', conditions: [{ type: rule.type || 'icao', operator: rule.operator || 'eq', value: rule.value || '' }] }]
        }
      };
    }
    // Pre-fill from aircraft if provided
    if (prefillAircraft) {
      const aircraftName = prefillAircraft.flight?.trim() || prefillAircraft.hex;
      return {
        name: `Track ${aircraftName}`,
        description: `Alert when ${aircraftName} (${prefillAircraft.hex}) is detected`,
        priority: 'info',
        enabled: true,
        starts_at: '',
        expires_at: '',
        api_url: '',
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
      api_url: '',
      conditions: {
        logic: 'AND',
        groups: [{ ...defaultGroup }]
      }
    };
  });

  const handleSubmit = async (e) => {
    e.preventDefault();

    const firstCond = form.conditions?.groups?.[0]?.conditions?.[0];
    const payload = {
      name: form.name,
      description: form.description,
      priority: form.priority,
      enabled: form.enabled,
      conditions: form.conditions,
      starts_at: form.starts_at || null,
      expires_at: form.expires_at || null,
      api_url: form.api_url || null,
      type: firstCond?.type,
      operator: firstCond?.operator,
      value: firstCond?.value
    };

    const url = rule ? `${apiBase}/api/v1/alerts/rules/${rule.id}` : `${apiBase}/api/v1/alerts/rules`;
    await fetch(url, {
      method: rule ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    onSave();
  };

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

  const conditionTypes = [
    { value: 'icao', label: 'ICAO' },
    { value: 'callsign', label: 'Callsign' },
    { value: 'squawk', label: 'Squawk' },
    { value: 'altitude', label: 'Altitude' },
    { value: 'vertical_rate', label: 'Vertical Rate' },
    { value: 'proximity', label: 'Proximity (nm)' },
    { value: 'speed', label: 'Speed (kts)' },
    { value: 'military', label: 'Military' },
    { value: 'emergency', label: 'Emergency' },
    { value: 'aircraft_type', label: 'Aircraft Type' }
  ];

  const operators = [
    { value: 'eq', label: '=' },
    { value: 'neq', label: '≠' },
    { value: 'contains', label: 'contains' },
    { value: 'lt', label: '<' },
    { value: 'gt', label: '>' },
    { value: 'lte', label: '≤' },
    { value: 'gte', label: '≥' }
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-large" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{rule ? 'Edit Rule' : 'New Alert Rule'}</h3>
          <button onClick={onClose}><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-content">
          <div className="form-group">
            <label>Rule Name</label>
            <input
              type="text"
              value={form.name || ''}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="e.g., Military Aircraft Alert"
              required
            />
          </div>

          <div className="form-group">
            <label>Conditions</label>
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
                        >
                          <option value="AND">Match ALL</option>
                          <option value="OR">Match ANY</option>
                        </select>
                      )}
                    </div>

                    <div className="condition-rows">
                      {group.conditions.map((cond, ci) => (
                        <div key={ci} className="condition-row">
                          <select
                            value={cond.type}
                            onChange={e => updateCondition(gi, ci, 'type', e.target.value)}
                          >
                            {conditionTypes.map(t => (
                              <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                          </select>
                          <select
                            value={cond.operator}
                            onChange={e => updateCondition(gi, ci, 'operator', e.target.value)}
                          >
                            {operators.map(o => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={cond.value}
                            onChange={e => updateCondition(gi, ci, 'value', e.target.value)}
                            placeholder="Value"
                          />
                          <button
                            type="button"
                            className="remove-condition-btn"
                            onClick={() => removeCondition(gi, ci)}
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ))}
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

          <div className="form-row">
            <div className="form-group">
              <label>Priority</label>
              <select value={form.priority || 'info'} onChange={e => setForm({ ...form, priority: e.target.value })}>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="emergency">Emergency</option>
              </select>
            </div>
            <div className="form-group">
              <label>API URL Override</label>
              <input
                type="text"
                value={form.api_url || ''}
                onChange={e => setForm({ ...form, api_url: e.target.value })}
                placeholder="Optional: custom notification URL"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Starts At (Optional)</label>
              <input
                type="datetime-local"
                value={form.starts_at ? form.starts_at.slice(0, 16) : ''}
                onChange={e => setForm({ ...form, starts_at: e.target.value ? new Date(e.target.value).toISOString() : '' })}
              />
            </div>
            <div className="form-group">
              <label>Expires At (Optional)</label>
              <input
                type="datetime-local"
                value={form.expires_at ? form.expires_at.slice(0, 16) : ''}
                onChange={e => setForm({ ...form, expires_at: e.target.value ? new Date(e.target.value).toISOString() : '' })}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Description</label>
            <textarea
              value={form.description || ''}
              onChange={e => setForm({ ...form, description: e.target.value })}
              rows={2}
              placeholder="Optional description"
            />
          </div>

          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary">Save Rule</button>
          </div>
        </form>
      </div>
    </div>
  );
}
