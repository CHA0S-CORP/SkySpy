/**
 * Pure model for the v2 Alerts screen: priority config, condition-builder
 * field/op mappings (design labels → backend rule types/operators), payload
 * building, and client-side "Matching N" preview evaluation.
 */

export const PRIORITY_CONFIG = {
  info: { color: 'var(--accent2)', label: 'INFO', icon: 'info' },
  warning: { color: 'var(--warn)', label: 'WARNING', icon: 'alert-triangle' },
  critical: { color: 'var(--danger)', label: 'CRITICAL', icon: 'alert-circle' },
  emergency: { color: 'var(--danger)', label: 'EMERGENCY', icon: 'alert-circle' },
};

export function priorityConfig(priority) {
  return PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.info;
}

/** Design field label → backend rule `type` + live aircraft field. */
export const FIELD_OPTIONS = [
  { label: 'ICAO Hex', type: 'icao', field: 'hex' },
  { label: 'Callsign', type: 'callsign', field: 'flight' },
  { label: 'Category', type: 'category', field: 'category' },
  { label: 'Altitude', type: 'altitude', field: 'alt' },
  { label: 'Speed', type: 'speed', field: 'gs' },
  { label: 'Distance', type: 'distance', field: 'distance_nm' },
  { label: 'Squawk', type: 'squawk', field: 'squawk' },
  { label: 'Type', type: 'type', field: 't' },
  { label: 'Operator', type: 'operator', field: 'ownOp' },
  // Backend has a dedicated 'military' rule type with dbFlags handling -
  // matching Category against the string 'military' can never trigger
  { label: 'Military', type: 'military', field: 'military' },
];

/** Design operator label → backend operator. "in list" compiles to a regex. */
export const OP_OPTIONS = [
  { label: 'equals', op: 'eq' },
  { label: 'contains', op: 'contains' },
  { label: 'greater than', op: 'gt' },
  { label: 'less than', op: 'lt' },
  { label: 'in list', op: 'regex' },
];

function toBackendCondition(cond) {
  const field = FIELD_OPTIONS.find((f) => f.label === cond.field) || FIELD_OPTIONS[0];
  const op = OP_OPTIONS.find((o) => o.label === cond.op) || OP_OPTIONS[0];
  if (op.label === 'in list') {
    const items = String(cond.val || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      // escape regex metacharacters in user-entered list items
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return { type: field.type, operator: 'regex', value: `^(${items.join('|')})$` };
  }
  return { type: field.type, operator: op.op, value: String(cond.val ?? '') };
}

/**
 * Build the backend `conditions` JSON (logic/groups shape evaluated by
 * services/alerts.py::_evaluate_complex_conditions).
 * @param {Array<{field: string, op: string, val: string}>} conds
 */
export function buildConditionsPayload(conds) {
  return {
    logic: 'AND',
    groups: [{ logic: 'AND', conditions: conds.map(toBackendCondition) }],
  };
}

/**
 * Build the full `alert-rule-create` params.
 * @param {{name: string, priority: string, conds: Array, cooldownSeconds: number, enabled: boolean}} form
 */
export function buildRulePayload({ name, priority, conds, cooldownSeconds, enabled }) {
  return {
    name: name.trim() || 'New Rule',
    description: summarizeConds(conds),
    enabled,
    priority,
    conditions: buildConditionsPayload(conds),
    cooldown_minutes: Math.max(1, Math.round((Number(cooldownSeconds) || 300) / 60)),
  };
}

/** Human/mono one-line condition summary (rule cards + descriptions). */
export function summarizeConds(conds) {
  return conds
    .filter((c) => c.val !== '' && c.val != null)
    .map((c) => `${c.field.toLowerCase()} ${c.op} ${c.val}`)
    .join(' AND ');
}

/** Mono condition line for an existing backend rule object. */
export function ruleCondSummary(rule) {
  const groups = rule.conditions?.groups;
  if (Array.isArray(groups) && groups.length) {
    const parts = [];
    for (const g of groups) {
      for (const c of g.conditions || []) {
        parts.push(`${c.type} ${c.operator} ${c.value}`);
      }
    }
    if (parts.length) return parts.join(` ${rule.conditions.logic || 'AND'} `);
  }
  if (rule.rule_type) return `${rule.rule_type} ${rule.operator || 'eq'} ${rule.value ?? ''}`;
  return rule.description || '—';
}

/** Evaluate one builder condition against a live aircraft (preview only). */
function evalCond(aircraft, cond) {
  const fieldDef = FIELD_OPTIONS.find((f) => f.label === cond.field);
  if (!fieldDef || cond.val === '' || cond.val == null) return false;
  let v = aircraft[fieldDef.field];
  if (fieldDef.field === 'alt' && typeof v !== 'number') v = aircraft.alt_baro;
  if (fieldDef.type === 'military') v = aircraft.military ? 'true' : 'false';
  if (v == null) return false;
  const val = String(cond.val);
  switch (cond.op) {
    case 'equals':
      return String(v).toUpperCase() === val.toUpperCase().trim();
    case 'contains':
      return String(v).toUpperCase().includes(val.toUpperCase().trim());
    case 'greater than':
      return Number(v) > Number(val);
    case 'less than':
      return Number(v) < Number(val);
    case 'in list':
      return val
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
        .includes(String(v).toUpperCase());
    default:
      return false;
  }
}

/**
 * "Matching N of M aircraft" live preview — AND across conditions.
 * @param {object[]} aircraft
 * @param {Array<{field: string, op: string, val: string}>} conds
 */
export function matchCount(aircraft, conds) {
  const active = conds.filter((c) => c.val !== '' && c.val != null);
  if (!active.length) return 0;
  return aircraft.filter((a) => active.every((c) => evalCond(a, c))).length;
}

/** Quick-start templates (from the mock). */
export const TEMPLATES = [
  {
    name: 'Military Aircraft',
    desc: 'Alert when military aircraft detected',
    color: 'var(--mil)',
    icon: 'shield',
    pre: {
      name: 'Military Aircraft Alert',
      pri: 'warning',
      field: 'Military',
      op: 'equals',
      val: 'true',
    },
  },
  {
    name: 'Emergency Squawk',
    desc: 'Codes 7500 / 7600 / 7700',
    color: 'var(--danger)',
    icon: 'alert-triangle',
    pre: {
      name: 'Emergency Squawk Alert',
      pri: 'emergency',
      field: 'Squawk',
      op: 'in list',
      val: '7500,7600,7700',
    },
  },
  {
    name: 'Low Flying Aircraft',
    desc: 'Below a certain altitude',
    color: 'var(--accent2)',
    icon: 'arrow-down',
    pre: {
      name: 'Low Flying Alert',
      pri: 'warning',
      field: 'Altitude',
      op: 'less than',
      val: '1000',
    },
  },
  {
    name: 'Nearby Aircraft',
    desc: 'Within range of station',
    color: 'var(--accent)',
    icon: 'map-pin',
    pre: {
      name: 'Nearby Aircraft Alert',
      pri: 'info',
      field: 'Distance',
      op: 'less than',
      val: '5',
    },
  },
  {
    name: 'Helicopter Activity',
    desc: 'Alert on rotary-wing',
    color: 'var(--warn)',
    icon: 'zap',
    pre: {
      name: 'Helicopter Alert',
      pri: 'info',
      field: 'Type',
      op: 'in list',
      val: 'H60,EC35,AS50',
    },
  },
  {
    name: 'Law Enforcement',
    desc: 'Police & sheriff units',
    color: 'var(--danger)',
    icon: 'shield',
    pre: {
      name: 'Law Enforcement Alert',
      pri: 'critical',
      field: 'Operator',
      op: 'contains',
      val: 'police',
    },
  },
];
