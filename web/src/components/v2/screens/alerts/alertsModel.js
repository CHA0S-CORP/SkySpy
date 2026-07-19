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

// ADS-B emitter categories flagged as general aviation (light/small/rotor).
const GA_EMITTER_CATEGORIES = ['A1', 'A2', 'A7', 'B1', 'B2', 'B4', 'B6'];

// Aircraft role classes for the "class" rule filter (multiselect). Values must
// match AlertService._classify_aircraft() in services/alerts.py.
export const CLASS_OPTIONS = [
  { value: 'commercial', label: 'Commercial' },
  { value: 'ga', label: 'General Aviation' },
  { value: 'fire', label: 'Fire' },
  { value: 'police', label: 'Police' },
  { value: 'military', label: 'Military' },
];
const CLASS_VALUES = CLASS_OPTIONS.map((c) => c.value);

/**
 * Derive role/classification badges (MIL / LE / FIRE / MEDEVAC / NEWS / GA /
 * LADD / PIA / INTERESTING) for an aircraft from its airframe record plus the
 * live socket entry. Mirrors the DetailScreen flag logic so the alert detail
 * reads the same. LE public-safety roles (fire/medical/news) are split out of
 * the law_enforcement classification by keyword so the badge is specific.
 *
 * @param {object} [airframe] - AircraftInfo record (info.data)
 * @param {object} [live] - live socket aircraft entry
 * @returns {{key:string,label:string,color:string,title:string}[]}
 */
export function deriveTypeBadges(airframe = {}, live = {}) {
  const badges = [];
  const sources = Array.isArray(airframe.source_data) ? airframe.source_data : [];
  const anySource = (k) => sources.some((s) => s?.[k]);

  const isMil =
    live?.military === true || airframe.is_military === true || anySource('is_military');

  // Law-enforcement / public-safety classification (law_enforcement_db) — nested
  // on ownership_flags as {category, description, ...} when present.
  const le =
    airframe.ownership_flags && typeof airframe.ownership_flags === 'object'
      ? airframe.ownership_flags.law_enforcement
      : null;
  const leText = `${le?.category || ''} ${le?.description || ''}`.toLowerCase();
  const isFire = /fire|air ?tanker|helitack/.test(leText);
  const isMed = /medevac|med(ical|ivac)|life ?(flight|star|guard)|air ambulance|\bems\b/.test(
    leText
  );
  const isNews = /news|media/.test(leText);

  if (isMil) badges.push({ key: 'mil', label: 'MIL', color: 'var(--mil)', title: 'Military' });
  if (le) {
    if (isFire)
      badges.push({
        key: 'fire',
        label: 'FIRE',
        color: '#ff7a1a',
        title: le.description || 'Firefighting / air tanker',
      });
    else if (isMed)
      badges.push({
        key: 'med',
        label: 'MEDEVAC',
        color: 'var(--accent2)',
        title: le.description || 'Medical / air ambulance',
      });
    else if (isNews)
      badges.push({
        key: 'news',
        label: 'NEWS',
        color: 'var(--dim)',
        title: le.description || 'News media',
      });
    else
      badges.push({
        key: 'le',
        label: 'LE',
        color: 'var(--danger)',
        title: [le.category, le.description].filter(Boolean).join(' — ') || 'Law enforcement',
      });
  }

  // General aviation from the ADS-B emitter category (only when nothing more
  // specific classified it).
  const cat = live?.category || airframe.category;
  if (!isMil && !le && GA_EMITTER_CATEGORIES.includes(cat))
    badges.push({ key: 'ga', label: 'GA', color: 'var(--accent2)', title: 'General aviation' });

  if (anySource('is_ladd'))
    badges.push({
      key: 'ladd',
      label: 'LADD',
      color: 'var(--dim)',
      title: 'FAA Limiting Aircraft Data Displayed',
    });
  if (anySource('is_pia'))
    badges.push({ key: 'pia', label: 'PIA', color: 'var(--dim)', title: 'Privacy ICAO Address' });
  if (anySource('is_interesting') || airframe.is_interesting === true)
    badges.push({
      key: 'interesting',
      label: 'INTERESTING',
      color: 'var(--warn)',
      title: 'Flagged as interesting',
    });

  return badges;
}

/** Design field label → backend rule `type` + live aircraft field. */
export const FIELD_OPTIONS = [
  { label: 'ICAO Hex', type: 'icao', field: 'hex' },
  { label: 'Callsign', type: 'callsign', field: 'flight' },
  // Aircraft role class (commercial/GA/fire/police/military) — rendered as a
  // multiselect; compiles to an anchored regex over the computed 'class' value.
  { label: 'Aircraft Class', type: 'class', field: 'class' },
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
  // Aircraft Class is a multiselect: `val` is a comma list of class values that
  // compiles to an anchored `^(a|b|c)$` regex matched (case-insensitively) by
  // the backend against the computed class string.
  if (field.type === 'class') {
    const items = String(cond.val || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => CLASS_VALUES.includes(s));
    return { type: 'class', operator: 'regex', value: `^(${items.join('|')})$` };
  }
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
 * @param {{name: string, priority: string, conds: Array, cooldownSeconds: number,
 *   enabled: boolean, channelIds?: Array<number|string>, useGlobal?: boolean,
 *   webhookUrl?: string}} form
 */
export function buildRulePayload({
  name,
  priority,
  conds,
  cooldownSeconds,
  enabled,
  channelIds,
  useGlobal,
  webhookUrl,
}) {
  const payload = {
    name: name.trim() || 'New Rule',
    description: summarizeConds(conds),
    enabled,
    priority,
    conditions: buildConditionsPayload(conds),
    cooldown_minutes: Math.max(1, Math.round((Number(cooldownSeconds) || 300) / 60)),
    use_global_notifications: useGlobal !== false,
  };
  if (Array.isArray(channelIds)) {
    // Normalize to numbers; the M2M expects channel PKs.
    payload.notification_channels = channelIds
      .map((id) => Number(id))
      .filter((n) => !Number.isNaN(n));
  }
  // Always include api_url (blank clears it) so editing can remove a webhook.
  payload.api_url = (webhookUrl || '').trim();
  return payload;
}

// Reverse maps for turning a stored rule back into editable form state.
const OP_LABEL_BY_BACKEND = OP_OPTIONS.reduce((m, o) => {
  m[o.op] = o.label;
  return m;
}, {});
const FIELD_LABEL_BY_TYPE = FIELD_OPTIONS.reduce((m, f) => {
  m[f.type] = f.label;
  return m;
}, {});

/** Reverse of toBackendCondition: one stored condition -> builder row. */
function backendCondToForm(c) {
  const field = FIELD_LABEL_BY_TYPE[c.type] || FIELD_OPTIONS[0].label;
  // Aircraft Class regex -> multiselect comma list.
  if (c.type === 'class') {
    const m = /^\^\((.*)\)\$$/.exec(String(c.value ?? ''));
    const val = m
      ? m[1]
          .split('|')
          .map((s) => s.trim().toLowerCase())
          .filter((s) => CLASS_VALUES.includes(s))
          .join(',')
      : '';
    return { field: 'Aircraft Class', op: 'is any of', val };
  }
  if (c.operator === 'regex') {
    // "in list" compiles to an anchored ^(a|b|c)$ regex — unpack it back.
    const m = /^\^\((.*)\)\$$/.exec(String(c.value ?? ''));
    if (m) {
      const val = m[1]
        .split('|')
        .map((s) => s.replace(/\\(.)/g, '$1')) // unescape regex metachars
        .join(',');
      return { field, op: 'in list', val };
    }
    // A raw regex we can't round-trip to a builder op — show it as contains.
    return { field, op: 'contains', val: String(c.value ?? '') };
  }
  return { field, op: OP_LABEL_BY_BACKEND[c.operator] || 'equals', val: String(c.value ?? '') };
}

/**
 * Turn a stored backend rule into CreateRuleModal form state (edit mode).
 * Handles the complex `conditions.groups` shape and legacy rule_type/op/value.
 * @param {object} rule
 */
export function ruleToForm(rule) {
  const groups = rule?.conditions?.groups;
  let conds = [];
  if (Array.isArray(groups)) {
    for (const g of groups) {
      for (const c of g.conditions || []) conds.push(backendCondToForm(c));
    }
  }
  if (!conds.length && rule?.rule_type) {
    conds = [
      backendCondToForm({
        type: rule.rule_type,
        operator: rule.operator || 'eq',
        value: rule.value,
      }),
    ];
  }
  if (!conds.length) conds = [{ field: 'ICAO Hex', op: 'equals', val: '' }];

  const channels = rule?.notification_channels;
  return {
    name: rule?.name || '',
    priority: rule?.priority || 'info',
    conds,
    cooldownSeconds: String(Math.max(1, rule?.cooldown_minutes ?? 5) * 60),
    enabled: rule?.enabled !== false,
    channelIds: Array.isArray(channels)
      ? channels.map((c) => (c && typeof c === 'object' ? c.id : c))
      : [],
    useGlobal: rule?.use_global_notifications !== false,
    webhookUrl: rule?.api_url || '',
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

/**
 * Best-effort role class from a live socket entry for the match preview. Fire
 * and police need airframe/ownership data absent from the live stream, so the
 * preview only distinguishes military / GA / commercial; the backend does the
 * full classification at trigger time.
 */
function previewClass(a) {
  if (a?.military === true) return 'military';
  if (GA_EMITTER_CATEGORIES.includes(a?.category)) return 'ga';
  return 'commercial';
}

/** Evaluate one builder condition against a live aircraft (preview only). */
function evalCond(aircraft, cond) {
  const fieldDef = FIELD_OPTIONS.find((f) => f.label === cond.field);
  if (!fieldDef || cond.val === '' || cond.val == null) return false;
  if (fieldDef.type === 'class') {
    const selected = String(cond.val)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    return selected.includes(previewClass(aircraft));
  }
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
  {
    name: 'Public Safety',
    desc: 'Fire, police & military',
    color: 'var(--warn)',
    icon: 'plane',
    pre: {
      name: 'Public Safety Alert',
      pri: 'warning',
      field: 'Aircraft Class',
      op: 'is any of',
      val: 'fire,police,military',
    },
  },
];
