import React, { useState, useMemo, useEffect, useRef } from 'react';
import { X, Plus, ChevronDown, ChevronUp, Plane, Eye } from 'lucide-react';
import { findMatchingAircraft, getRelevantValues } from '../../utils/alertEvaluator';

export function RuleForm({ rule, editRule, prefillAircraft, apiBase, aircraft = [], feederLocation = null, onClose, onSave }) {
  // Support both 'rule' and 'editRule' props for backwards compatibility
  const ruleToEdit = editRule || rule;
  const defaultCondition = { type: 'icao', operator: 'eq', value: '' };
  const defaultGroup = { logic: 'AND', conditions: [{ ...defaultCondition }] };

  const [form, setForm] = useState(() => {
    if (ruleToEdit) {
      // Normalize conditions from Django API format
      let conditions = ruleToEdit.conditions;
      if (!conditions || (typeof conditions === 'object' && !conditions.groups)) {
        // Convert legacy format or empty conditions
        conditions = {
          logic: 'AND',
          groups: [{
            logic: 'AND',
            conditions: [{ type: ruleToEdit.type || 'icao', operator: ruleToEdit.operator || 'eq', value: ruleToEdit.value || '' }]
          }]
        };
      }
      return {
        ...ruleToEdit,
        conditions
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
      api_url: '',
      cooldown: 300,
      conditions: {
        logic: 'AND',
        groups: [{ ...defaultGroup }]
      }
    };
  });

  // Live preview state
  const [previewExpanded, setPreviewExpanded] = useState(true);
  const [debouncedForm, setDebouncedForm] = useState(form);
  const debounceTimeoutRef = useRef(null);

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

  // Calculate matching aircraft (debounced)
  const matchingAircraft = useMemo(() => {
    if (!aircraft || aircraft.length === 0) return [];
    // Build a temporary rule object for evaluation
    const tempRule = {
      conditions: debouncedForm.conditions
    };
    return findMatchingAircraft(tempRule, aircraft, feederLocation);
  }, [debouncedForm.conditions, aircraft, feederLocation]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const firstCond = form.conditions?.groups?.[0]?.conditions?.[0];
    const payload = {
      name: form.name,
      description: form.description,
      priority: form.priority,
      enabled: form.enabled,
      conditions: form.conditions,
      cooldown: form.cooldown || 300,
      starts_at: form.starts_at || null,
      expires_at: form.expires_at || null,
      api_url: form.api_url || null,
      // Include legacy fields for backwards compatibility
      type: firstCond?.type,
      operator: firstCond?.operator,
      value: firstCond?.value
    };

    const isEdit = ruleToEdit?.id;
    const url = isEdit
      ? `${apiBase}/api/v1/alerts/rules/${ruleToEdit.id}`
      : `${apiBase}/api/v1/alerts/rules`;

    try {
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
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

      onSave();
    } catch (err) {
      console.error('Failed to save rule:', err);
      alert(err.message || 'Failed to save rule');
    }
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
    { value: 'icao', label: 'ICAO Hex' },
    { value: 'callsign', label: 'Callsign' },
    { value: 'squawk', label: 'Squawk' },
    { value: 'altitude_above', label: 'Altitude Above' },
    { value: 'altitude_below', label: 'Altitude Below' },
    { value: 'speed_above', label: 'Speed Above' },
    { value: 'speed_below', label: 'Speed Below' },
    { value: 'vertical_rate', label: 'Vertical Rate' },
    { value: 'distance_within', label: 'Distance Within' },
    { value: 'military', label: 'Military' },
    { value: 'emergency', label: 'Emergency' },
    { value: 'type', label: 'Aircraft Type' },
    { value: 'registration', label: 'Registration' },
    { value: 'category', label: 'Category' }
  ];

  const operators = [
    { value: 'eq', label: '=' },
    { value: 'neq', label: '!=' },
    { value: 'contains', label: 'contains' },
    { value: 'startswith', label: 'starts with' },
    { value: 'lt', label: '<' },
    { value: 'gt', label: '>' },
    { value: 'lte', label: '<=' },
    { value: 'gte', label: '>=' }
  ];

  // Get appropriate operators for condition type
  const getOperatorsForType = (type) => {
    const booleanTypes = ['military', 'emergency'];
    const numericTypes = ['altitude_above', 'altitude_below', 'speed_above', 'speed_below', 'vertical_rate', 'distance_within'];

    if (booleanTypes.includes(type)) {
      return [{ value: 'eq', label: 'is' }];
    }
    if (numericTypes.includes(type)) {
      return operators.filter(o => ['eq', 'lt', 'gt', 'lte', 'gte'].includes(o.value));
    }
    return operators;
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="rule-form-title">
      <div className="modal modal-large" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 id="rule-form-title">{ruleToEdit ? 'Edit Rule' : 'New Alert Rule'}</h3>
          <button onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-content">
          <div className="form-group">
            <label htmlFor="rule-name">Rule Name</label>
            <input
              id="rule-name"
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
                      {group.conditions.map((cond, ci) => (
                        <div key={ci} className="condition-row">
                          <select
                            value={cond.type}
                            onChange={e => updateCondition(gi, ci, 'type', e.target.value)}
                            aria-label="Condition type"
                          >
                            {conditionTypes.map(t => (
                              <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                          </select>
                          <select
                            value={cond.operator}
                            onChange={e => updateCondition(gi, ci, 'operator', e.target.value)}
                            aria-label="Operator"
                          >
                            {getOperatorsForType(cond.type).map(o => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                          {!['military', 'emergency'].includes(cond.type) && (
                            <input
                              type="text"
                              value={cond.value}
                              onChange={e => updateCondition(gi, ci, 'value', e.target.value)}
                              placeholder="Value"
                              aria-label="Value"
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

          {/* Live Preview Panel */}
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
                    <div className="preview-aircraft-list" role="list" aria-label="Matching aircraft preview">
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
                              {values.squawk && (
                                <span className="preview-value">Sqwk: {values.squawk}</span>
                              )}
                              {values.type && (
                                <span className="preview-value">Type: {values.type}</span>
                              )}
                              {values.military && (
                                <span className="preview-value military">Military</span>
                              )}
                              {values.emergency && (
                                <span className="preview-value emergency">Emergency</span>
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

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="rule-priority">Priority</label>
              <select
                id="rule-priority"
                value={form.priority || 'info'}
                onChange={e => setForm({ ...form, priority: e.target.value })}
              >
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
                <option value="emergency">Emergency</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="rule-api-url">API URL Override</label>
              <input
                id="rule-api-url"
                type="text"
                value={form.api_url || ''}
                onChange={e => setForm({ ...form, api_url: e.target.value })}
                placeholder="Optional: custom notification URL"
              />
            </div>
          </div>

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

          <div className="form-group">
            <label htmlFor="rule-description">Description</label>
            <textarea
              id="rule-description"
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
