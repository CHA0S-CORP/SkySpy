/**
 * Operator utilities for alert condition evaluation
 */

/**
 * Normalize operator names (frontend uses different names than backend)
 */
export function normalizeOperator(op) {
  const map = {
    'equals': 'eq',
    'eq': 'eq',
    'not_equals': 'neq',
    'neq': 'neq',
    'contains': 'contains',
    'starts_with': 'startswith',
    'startswith': 'startswith',
    'ends_with': 'endswith',
    'endswith': 'endswith',
    'greater_than': 'gt',
    'gt': 'gt',
    'less_than': 'lt',
    'lt': 'lt',
    'gte': 'gte',
    'lte': 'lte',
  };
  return map[op] || 'eq';
}

/**
 * String comparison helper
 */
export function stringMatch(acVal, targetVal, op) {
  const acUpper = (acVal || '').toUpperCase().trim();
  const targetUpper = (targetVal || '').toUpperCase().trim();

  switch (op) {
    case 'eq':
    case 'equals':
      return acUpper === targetUpper;
    case 'neq':
    case 'not_equals':
      return acUpper !== targetUpper;
    case 'contains':
      return acUpper.includes(targetUpper);
    case 'startswith':
    case 'starts_with':
      return acUpper.startsWith(targetUpper);
    case 'endswith':
    case 'ends_with':
      return acUpper.endsWith(targetUpper);
    default:
      return acUpper === targetUpper;
  }
}

/**
 * Numeric comparison helper
 */
export function numericMatch(acVal, targetVal, op) {
  if (acVal === null || acVal === undefined) return false;
  const targetNum = parseFloat(targetVal);
  if (isNaN(targetNum)) return false;

  switch (op) {
    case 'lt':
    case 'less_than':
      return acVal < targetNum;
    case 'gt':
    case 'greater_than':
      return acVal > targetNum;
    case 'lte':
      return acVal <= targetNum;
    case 'gte':
      return acVal >= targetNum;
    case 'eq':
    case 'equals':
      return acVal === targetNum;
    case 'neq':
    case 'not_equals':
      return acVal !== targetNum;
    default:
      return acVal === targetNum;
  }
}
