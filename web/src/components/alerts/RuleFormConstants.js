/**
 * Constants and configuration objects for the RuleForm component
 */

// Severity configuration
export const SEVERITY_CONFIG = {
  info: { label: 'Info', iconName: 'Info', color: '#3b82f6' },
  warning: { label: 'Warning', iconName: 'AlertTriangle', color: '#f59e0b' },
  critical: { label: 'Critical', iconName: 'AlertCircle', color: '#ef4444' },
  emergency: { label: 'Emergency', iconName: 'AlertCircle', color: '#dc2626' },
};

// All available condition types
export const CONDITION_TYPES = [
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

// Operators for string condition types
export const STRING_OPERATORS = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'startswith', label: 'starts with' },
  { value: 'endswith', label: 'ends with' },
];

// Operators for numeric condition types
export const NUMERIC_OPERATORS = [
  { value: 'eq', label: '=' },
  { value: 'lt', label: '<' },
  { value: 'gt', label: '>' },
  { value: 'lte', label: '<=' },
  { value: 'gte', label: '>=' },
];

// Rule templates for quick setup
export const RULE_TEMPLATES = [
  {
    id: 'military',
    name: 'Military Aircraft',
    icon: 'shield',
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
    icon: 'alert',
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
    icon: 'arrow-down',
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
    icon: 'map-pin',
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
    icon: 'helicopter',
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
    icon: 'shield-alert',
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
export const CHANNEL_TYPE_INFO = {
  discord: { label: 'Discord', icon: 'message-square', color: '#5865F2' },
  slack: { label: 'Slack', icon: 'briefcase', color: '#4A154B' },
  telegram: { label: 'Telegram', icon: 'send', color: '#0088cc' },
  pushover: { label: 'Pushover', icon: 'smartphone', color: '#249DF1' },
  email: { label: 'Email', icon: 'mail', color: '#EA4335' },
  webhook: { label: 'Webhook', icon: 'link', color: '#6366f1' },
  ntfy: { label: 'ntfy', icon: 'bell', color: '#57A773' },
  gotify: { label: 'Gotify', icon: 'megaphone', color: '#1e88e5' },
  home_assistant: { label: 'Home Assistant', icon: 'home', color: '#41BDF5' },
  twilio: { label: 'Twilio SMS', icon: 'phone', color: '#F22F46' },
  custom: { label: 'Custom', icon: 'settings', color: '#6b7280' },
};

// Default condition and group structures
export const DEFAULT_CONDITION = { type: 'icao', operator: 'eq', value: '' };
export const DEFAULT_GROUP = { logic: 'AND', conditions: [{ ...DEFAULT_CONDITION }] };

/**
 * Get operators based on condition type
 * @param {string} type - The condition type
 * @returns {Array} - Array of operator options
 */
export function getOperatorsForType(type) {
  const condType = CONDITION_TYPES.find(t => t.value === type);
  if (condType?.isBoolean) {
    return [{ value: 'eq', label: 'is' }];
  }
  if (condType?.type === 'number') {
    return NUMERIC_OPERATORS;
  }
  return STRING_OPERATORS;
}

/**
 * Initialize form state based on edit rule or prefill
 * @param {Object} ruleToEdit - Existing rule being edited
 * @param {Object} prefillAircraft - Aircraft to prefill from
 * @param {Object} defaultGroup - Default group structure
 * @returns {Object} - Initial form state
 */
export function initializeForm(ruleToEdit, prefillAircraft, defaultGroup) {
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

/**
 * Validate form data
 * @param {Object} form - Form state
 * @returns {Object} - Validation errors object
 */
export function validateForm(form) {
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

  return errors;
}
