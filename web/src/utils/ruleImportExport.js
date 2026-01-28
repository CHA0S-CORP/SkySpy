// ============================================================================
// Alert Rule Import/Export Utilities
// ============================================================================

const EXPORT_VERSION = '1.0';

// Valid condition types from RuleForm.jsx
const VALID_CONDITION_TYPES = [
  'callsign', 'hex', 'squawk', 'altitude_above', 'altitude_below',
  'speed_above', 'speed_below', 'distance_within', 'military', 'emergency', 'type'
];

const VALID_OPERATORS = ['equals', 'contains', 'starts_with'];
const VALID_PRIORITIES = ['info', 'warning', 'critical', 'emergency'];

/**
 * Format a single rule for export (strips internal fields)
 */
export function exportRule(rule) {
  return {
    name: rule.name,
    description: rule.description || '',
    priority: rule.priority || rule.severity || 'info',
    enabled: rule.enabled !== false,
    conditions: rule.conditions || [],
    cooldown_minutes: typeof rule.cooldown === 'number'
      ? Math.round(rule.cooldown / 60)
      : (rule.cooldown_minutes || 5),
  };
}

/**
 * Format multiple rules for export with metadata
 */
export function exportAllRules(rules) {
  return {
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    source: 'SkySpy',
    rules: rules.map(exportRule),
  };
}

/**
 * Format a single rule for export with metadata wrapper
 */
export function exportSingleRule(rule) {
  return {
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    source: 'SkySpy',
    rules: [exportRule(rule)],
  };
}

/**
 * Export rules as CSV format
 */
export function downloadAsCsv(rules, filename) {
  const headers = ['name', 'description', 'priority', 'enabled', 'cooldown_minutes', 'conditions'];

  const rows = rules.map(rule => {
    const exportedRule = exportRule(rule);
    return [
      escapeCsvField(exportedRule.name),
      escapeCsvField(exportedRule.description),
      exportedRule.priority,
      exportedRule.enabled,
      exportedRule.cooldown_minutes,
      escapeCsvField(JSON.stringify(exportedRule.conditions)),
    ];
  });

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Escape a field for CSV format
 */
function escapeCsvField(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // If the field contains comma, newline, or quotes, wrap in quotes and escape internal quotes
  if (str.includes(',') || str.includes('\n') || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Trigger download of JSON data as file
 */
export function downloadAsJson(data, filename) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Generate filename for export
 */
export function generateFilename(ruleName = null) {
  const date = new Date().toISOString().split('T')[0];
  if (ruleName) {
    // Sanitize rule name for filename
    const safeName = ruleName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
    return `alert-rule-${safeName}-${date}.json`;
  }
  return `alert-rules-backup-${date}.json`;
}

/**
 * Validate a single condition object
 */
function validateCondition(condition, index) {
  const errors = [];

  if (!condition || typeof condition !== 'object') {
    errors.push(`Condition ${index + 1}: Invalid condition format`);
    return errors;
  }

  if (!condition.type || !VALID_CONDITION_TYPES.includes(condition.type)) {
    errors.push(`Condition ${index + 1}: Invalid type "${condition.type}". Valid types: ${VALID_CONDITION_TYPES.join(', ')}`);
  }

  // Boolean types don't need values
  if (!['military', 'emergency'].includes(condition.type)) {
    if (condition.operator && !VALID_OPERATORS.includes(condition.operator)) {
      errors.push(`Condition ${index + 1}: Invalid operator "${condition.operator}". Valid operators: ${VALID_OPERATORS.join(', ')}`);
    }

    if (condition.value === undefined || condition.value === null ||
        (typeof condition.value === 'string' && condition.value.trim() === '')) {
      errors.push(`Condition ${index + 1}: Value is required for type "${condition.type}"`);
    }
  }

  return errors;
}

/**
 * Validate a single rule object
 */
function validateRule(rule, index) {
  const errors = [];
  const ruleLabel = `Rule ${index + 1}${rule?.name ? ` ("${rule.name}")` : ''}`;

  if (!rule || typeof rule !== 'object') {
    errors.push(`${ruleLabel}: Invalid rule format`);
    return errors;
  }

  // Required fields
  if (!rule.name || typeof rule.name !== 'string' || rule.name.trim() === '') {
    errors.push(`${ruleLabel}: Name is required`);
  } else if (rule.name.trim().length < 3) {
    errors.push(`${ruleLabel}: Name must be at least 3 characters`);
  }

  // Optional but validated fields
  if (rule.priority && !VALID_PRIORITIES.includes(rule.priority)) {
    errors.push(`${ruleLabel}: Invalid priority "${rule.priority}". Valid values: ${VALID_PRIORITIES.join(', ')}`);
  }

  // Conditions validation
  if (!rule.conditions) {
    errors.push(`${ruleLabel}: Conditions are required`);
  } else if (!Array.isArray(rule.conditions)) {
    errors.push(`${ruleLabel}: Conditions must be an array`);
  } else if (rule.conditions.length === 0) {
    errors.push(`${ruleLabel}: At least one condition is required`);
  } else {
    rule.conditions.forEach((condition, condIndex) => {
      const conditionErrors = validateCondition(condition, condIndex);
      errors.push(...conditionErrors.map(e => `${ruleLabel} - ${e}`));
    });
  }

  // Cooldown validation
  if (rule.cooldown_minutes !== undefined) {
    const cooldown = Number(rule.cooldown_minutes);
    if (isNaN(cooldown) || cooldown < 0) {
      errors.push(`${ruleLabel}: Cooldown must be a non-negative number`);
    }
  }

  return errors;
}

/**
 * Validate imported rules data structure
 * Returns { valid: boolean, errors: string[], rules: array }
 */
export function validateImportedRules(data) {
  const errors = [];

  // Check for basic structure
  if (!data || typeof data !== 'object') {
    return {
      valid: false,
      errors: ['Invalid JSON: Expected an object'],
      rules: [],
    };
  }

  // Allow both wrapped format and plain array
  let rules;
  if (Array.isArray(data)) {
    // Plain array of rules
    rules = data;
  } else if (data.rules && Array.isArray(data.rules)) {
    // Wrapped format with metadata
    rules = data.rules;

    // Version check (warning only)
    if (data.version && data.version !== EXPORT_VERSION) {
      errors.push(`Warning: File was exported with version ${data.version}, current version is ${EXPORT_VERSION}`);
    }
  } else {
    return {
      valid: false,
      errors: ['Invalid format: Expected "rules" array or array of rules'],
      rules: [],
    };
  }

  if (rules.length === 0) {
    return {
      valid: false,
      errors: ['No rules found in file'],
      rules: [],
    };
  }

  // Validate each rule
  rules.forEach((rule, index) => {
    const ruleErrors = validateRule(rule, index);
    errors.push(...ruleErrors);
  });

  // Filter out warnings for validity check
  const criticalErrors = errors.filter(e => !e.startsWith('Warning:'));

  return {
    valid: criticalErrors.length === 0,
    errors,
    rules: criticalErrors.length === 0 ? rules : [],
  };
}

/**
 * Parse uploaded file and validate
 * Returns Promise<{ valid: boolean, errors: string[], rules: array, filename: string }>
 */
export function parseImportFile(file) {
  return new Promise((resolve) => {
    if (!file) {
      resolve({
        valid: false,
        errors: ['No file selected'],
        rules: [],
        filename: '',
      });
      return;
    }

    if (!file.name.endsWith('.json')) {
      resolve({
        valid: false,
        errors: ['File must be a JSON file (.json)'],
        rules: [],
        filename: file.name,
      });
      return;
    }

    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        const validation = validateImportedRules(data);
        resolve({
          ...validation,
          filename: file.name,
        });
      } catch (err) {
        resolve({
          valid: false,
          errors: [`Invalid JSON: ${err.message}`],
          rules: [],
          filename: file.name,
        });
      }
    };

    reader.onerror = () => {
      resolve({
        valid: false,
        errors: ['Failed to read file'],
        rules: [],
        filename: file.name,
      });
    };

    reader.readAsText(file);
  });
}

/**
 * Convert imported rule to API format
 */
export function convertToApiFormat(rule) {
  return {
    name: rule.name.trim(),
    description: rule.description || '',
    enabled: rule.enabled !== false,
    severity: rule.priority || 'info',
    priority: rule.priority || 'info',
    conditions: rule.conditions.map(c => ({
      type: c.type,
      operator: c.operator || 'equals',
      value: c.value ?? '',
    })),
    cooldown: typeof rule.cooldown_minutes === 'number'
      ? rule.cooldown_minutes * 60
      : 300, // Default 5 minutes in seconds
  };
}

/**
 * Check for duplicate rules by name
 */
export function findDuplicates(importedRules, existingRules) {
  const existingNames = new Set(existingRules.map(r => r.name.toLowerCase()));
  const duplicates = [];
  const unique = [];

  importedRules.forEach(rule => {
    if (existingNames.has(rule.name.toLowerCase())) {
      duplicates.push(rule);
    } else {
      unique.push(rule);
    }
  });

  return { duplicates, unique };
}
