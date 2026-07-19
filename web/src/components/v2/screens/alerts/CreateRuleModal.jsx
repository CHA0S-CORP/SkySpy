import React, { useEffect, useMemo, useState } from 'react';
import { Icon, Modal, Switch } from '../../primitives';
import { useNotificationChannels } from '../../../../hooks/queries/useNotificationChannels';
import {
  CLASS_OPTIONS,
  FIELD_OPTIONS,
  OP_OPTIONS,
  PRIORITY_CONFIG,
  TEMPLATES,
  buildRulePayload,
  matchCount,
  ruleToForm,
} from './alertsModel';

const EMPTY_COND = { field: 'ICAO Hex', op: 'equals', val: '' };

/**
 * Create / Edit Alert Rule modal (design: Alerts.dc.html modal) — quick-start
 * templates, priority segmented buttons, conditions builder, live match preview,
 * per-rule notification targets. When `rule` is provided the modal edits it and
 * calls `onUpdate({ id, ...payload })`; otherwise it creates via `onCreate`.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {(open: boolean) => void} props.onOpenChange
 * @param {(payload: object) => Promise<void>} props.onCreate - receives alert-rule-create params
 * @param {(payload: object) => Promise<void>} [props.onUpdate] - receives alert-rule-update params (with id)
 * @param {object|null} [props.rule] - existing rule to edit (null = create)
 * @param {object[]} props.aircraft - live aircraft for the match preview
 */
export function CreateRuleModal({ open, onOpenChange, onCreate, onUpdate, rule, aircraft }) {
  const [name, setName] = useState('');
  const [priority, setPriority] = useState('info');
  const [conds, setConds] = useState([EMPTY_COND]);
  const [cooldown, setCooldown] = useState('300');
  const [enabled, setEnabled] = useState(true);
  const [useGlobal, setUseGlobal] = useState(true);
  const [channelIds, setChannelIds] = useState([]);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: channels = [] } = useNotificationChannels();
  const isEdit = !!rule;

  // Prefill from the rule when opening in edit mode; clear for create.
  useEffect(() => {
    if (!open) return;
    if (rule) {
      const f = ruleToForm(rule);
      setName(f.name);
      setPriority(f.priority);
      setConds(f.conds);
      setCooldown(f.cooldownSeconds);
      setEnabled(f.enabled);
      setChannelIds(f.channelIds);
      setUseGlobal(f.useGlobal);
      setWebhookUrl(f.webhookUrl);
    } else {
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rule]);

  const matching = useMemo(() => matchCount(aircraft, conds), [aircraft, conds]);

  const toggleChannel = (id) =>
    setChannelIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));

  const applyTemplate = (t) => {
    setName(t.pre.name);
    setPriority(t.pre.pri);
    setConds([{ field: t.pre.field, op: t.pre.op, val: t.pre.val }]);
  };

  const setCond = (i, patch) =>
    setConds((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const removeCond = (i) =>
    setConds((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev));

  // Toggle one class value in a comma-list "Aircraft Class" condition.
  const toggleClassVal = (i, value) =>
    setConds((prev) =>
      prev.map((c, j) => {
        if (j !== i) return c;
        const set = new Set(
          String(c.val || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        );
        set.has(value) ? set.delete(value) : set.add(value);
        return { ...c, val: [...set].join(',') };
      })
    );

  // Switching a row's field to/from Aircraft Class resets the value so a stale
  // hex/callsign string can't leak into the class multiselect (or vice-versa).
  const changeField = (i, field) => {
    const wasClass = conds[i]?.field === 'Aircraft Class';
    const isClass = field === 'Aircraft Class';
    setCond(
      i,
      wasClass !== isClass ? { field, val: '', op: isClass ? 'is any of' : 'equals' } : { field }
    );
  };

  const reset = () => {
    setName('');
    setPriority('info');
    setConds([EMPTY_COND]);
    setCooldown('300');
    setEnabled(true);
    setUseGlobal(true);
    setChannelIds([]);
    setWebhookUrl('');
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = buildRulePayload({
        name,
        priority,
        conds,
        cooldownSeconds: cooldown,
        enabled,
        channelIds,
        useGlobal,
        webhookUrl,
      });
      if (isEdit) {
        await onUpdate({ id: rule.id, ...payload });
      } else {
        await onCreate(payload);
      }
      reset();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? 'Edit Alert Rule' : 'Create Alert Rule'}
      width="min(720px, 94vw)"
    >
      <div className="v2-alerts__modal">
        <div className="v2-alerts__modal-section-head">
          <Icon name="file" size={15} strokeWidth={1.7} style={{ color: 'var(--accent2)' }} />
          <span>Quick Start Templates</span>
        </div>
        <div className="v2-alerts__templates">
          {TEMPLATES.map((t) => (
            <button
              key={t.name}
              type="button"
              className="v2-alerts__template"
              onClick={() => applyTemplate(t)}
            >
              <Icon name={t.icon} size={20} strokeWidth={1.7} style={{ color: t.color }} />
              <span className="v2-alerts__template-name">{t.name}</span>
              <span className="v2-alerts__template-desc">{t.desc}</span>
            </button>
          ))}
        </div>

        <div className="v2-alerts__field-label">RULE NAME *</div>
        <input
          className="v2-alerts__name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Military Aircraft Alert"
          aria-label="Rule name"
        />

        <div className="v2-alerts__section-title">Priority</div>
        <div className="v2-alerts__pri-grid">
          {Object.entries(PRIORITY_CONFIG).map(([key, pc]) => {
            const on = priority === key;
            return (
              <button
                key={key}
                type="button"
                className={`v2-alerts__pri-btn ${on ? 'v2-alerts__pri-btn--on' : ''}`}
                style={
                  on
                    ? {
                        borderColor: pc.color,
                        background: `color-mix(in srgb, ${pc.color} 14%, transparent)`,
                      }
                    : undefined
                }
                onClick={() => setPriority(key)}
                aria-pressed={on}
              >
                <Icon name={pc.icon} size={17} strokeWidth={1.8} style={{ color: pc.color }} />
                <span>{pc.label}</span>
              </button>
            );
          })}
        </div>

        <div className="v2-alerts__section-title">Conditions *</div>
        <div className="v2-alerts__conds">
          <div className="v2-alerts__conds-group">GROUP 1</div>
          {conds.map((c, i) => {
            const isClass = c.field === 'Aircraft Class';
            const selectedClasses = isClass
              ? new Set(
                  String(c.val || '')
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)
                )
              : null;
            return (
              <div key={i} className="v2-alerts__cond-row">
                <select
                  className="v2-select"
                  value={c.field}
                  onChange={(e) => changeField(i, e.target.value)}
                  aria-label="Condition field"
                >
                  {FIELD_OPTIONS.map((f) => (
                    <option key={f.label} value={f.label}>
                      {f.label}
                    </option>
                  ))}
                </select>
                {isClass ? (
                  <div
                    className="v2-alerts__target-chips v2-alerts__cond-classes"
                    role="group"
                    aria-label="Aircraft classes"
                  >
                    {CLASS_OPTIONS.map((opt) => {
                      const on = selectedClasses.has(opt.value);
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          className={`v2-alerts__target-chip ${on ? 'v2-alerts__target-chip--on' : ''}`}
                          onClick={() => toggleClassVal(i, opt.value)}
                          aria-pressed={on}
                        >
                          <Icon name={on ? 'check' : 'plane'} size={13} strokeWidth={2} />
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <>
                    <select
                      className="v2-select v2-alerts__cond-op"
                      value={c.op}
                      onChange={(e) => setCond(i, { op: e.target.value })}
                      aria-label="Condition operator"
                    >
                      {OP_OPTIONS.map((o) => (
                        <option key={o.label} value={o.label}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <input
                      className="v2-input v2-alerts__cond-val"
                      value={c.val}
                      onChange={(e) => setCond(i, { val: e.target.value })}
                      placeholder="e.g., A12345"
                      aria-label="Condition value"
                    />
                  </>
                )}
                <button
                  type="button"
                  className="v2-iconbtn"
                  onClick={() => removeCond(i)}
                  aria-label="Remove condition"
                >
                  <Icon name="x" size={15} strokeWidth={1.9} />
                </button>
              </div>
            );
          })}
          <button
            type="button"
            className="v2-alerts__add-cond"
            onClick={() =>
              setConds((prev) => [...prev, { field: 'Callsign', op: 'contains', val: '' }])
            }
          >
            <Icon name="plus" size={14} strokeWidth={2} />
            Add Condition
          </button>
        </div>

        <div className="v2-alerts__match">
          <Icon name="eye" size={15} strokeWidth={1.7} style={{ color: 'var(--accent2)' }} />
          <span>
            Matching <strong className="v2-mono">{matching}</strong> of {aircraft.length} aircraft
          </span>
        </div>

        <div className="v2-alerts__modal-2col">
          <div>
            <div className="v2-alerts__field-label">COOLDOWN (SECONDS)</div>
            <input
              className="v2-input"
              style={{ width: '100%', fontFamily: 'var(--font-mono)' }}
              value={cooldown}
              onChange={(e) => setCooldown(e.target.value)}
              aria-label="Cooldown seconds"
            />
            <div className="v2-alerts__hint">Time between repeated alerts</div>
          </div>
          <div className="v2-alerts__enabled-row">
            <Switch checked={enabled} onCheckedChange={setEnabled} label="Enabled" />
            <span>Enabled</span>
          </div>
        </div>

        <div className="v2-alerts__section-title">Alert Targets</div>
        {channels.length === 0 ? (
          <div className="v2-alerts__hint">
            No channels configured. Add webhooks / Discord / Slack / ntfy in the Notifications tab.
          </div>
        ) : (
          <div className="v2-alerts__target-chips">
            {channels.map((ch) => {
              const on = channelIds.includes(ch.id);
              return (
                <button
                  key={ch.id}
                  type="button"
                  className={`v2-alerts__target-chip ${on ? 'v2-alerts__target-chip--on' : ''}`}
                  onClick={() => toggleChannel(ch.id)}
                  aria-pressed={on}
                >
                  <Icon name={on ? 'check' : 'link'} size={13} strokeWidth={2} />
                  {ch.name}
                </button>
              );
            })}
          </div>
        )}

        <div className="v2-alerts__field-label" style={{ marginTop: 10 }}>
          WEBHOOK URL (OPTIONAL)
        </div>
        <input
          className="v2-input"
          style={{ width: '100%', fontFamily: 'var(--font-mono)' }}
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          placeholder="https://… or any Apprise URL — fires just for this rule"
          aria-label="Rule webhook URL"
        />

        <div className="v2-alerts__global-row">
          <Icon name="bell" size={16} strokeWidth={1.7} style={{ color: 'var(--dim)' }} />
          <span>Use global notification channels</span>
          <Switch
            checked={useGlobal}
            onCheckedChange={setUseGlobal}
            label="Use global notification channels"
          />
        </div>

        <div className="v2-alerts__modal-actions">
          <button
            type="button"
            className="v2-btn v2-alerts__cancel"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button type="button" className="v2-alerts__create" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Rule'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
