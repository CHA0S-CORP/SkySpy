import { describe, it, expect } from 'vitest';
import { normalizeOperator, stringMatch, numericMatch } from './operators';

describe('normalizeOperator', () => {
  describe('equality operators', () => {
    it('should normalize "equals" to "eq"', () => {
      expect(normalizeOperator('equals')).toBe('eq');
    });

    it('should pass through "eq"', () => {
      expect(normalizeOperator('eq')).toBe('eq');
    });

    it('should normalize "not_equals" to "neq"', () => {
      expect(normalizeOperator('not_equals')).toBe('neq');
    });

    it('should pass through "neq"', () => {
      expect(normalizeOperator('neq')).toBe('neq');
    });
  });

  describe('string operators', () => {
    it('should pass through "contains"', () => {
      expect(normalizeOperator('contains')).toBe('contains');
    });

    it('should normalize "starts_with" to "startswith"', () => {
      expect(normalizeOperator('starts_with')).toBe('startswith');
    });

    it('should pass through "startswith"', () => {
      expect(normalizeOperator('startswith')).toBe('startswith');
    });

    it('should normalize "ends_with" to "endswith"', () => {
      expect(normalizeOperator('ends_with')).toBe('endswith');
    });

    it('should pass through "endswith"', () => {
      expect(normalizeOperator('endswith')).toBe('endswith');
    });
  });

  describe('comparison operators', () => {
    it('should normalize "greater_than" to "gt"', () => {
      expect(normalizeOperator('greater_than')).toBe('gt');
    });

    it('should pass through "gt"', () => {
      expect(normalizeOperator('gt')).toBe('gt');
    });

    it('should normalize "less_than" to "lt"', () => {
      expect(normalizeOperator('less_than')).toBe('lt');
    });

    it('should pass through "lt"', () => {
      expect(normalizeOperator('lt')).toBe('lt');
    });

    it('should pass through "gte"', () => {
      expect(normalizeOperator('gte')).toBe('gte');
    });

    it('should pass through "lte"', () => {
      expect(normalizeOperator('lte')).toBe('lte');
    });
  });

  describe('unknown operators', () => {
    it('should default to "eq" for unknown operators', () => {
      expect(normalizeOperator('unknown')).toBe('eq');
    });

    it('should default to "eq" for undefined', () => {
      expect(normalizeOperator(undefined)).toBe('eq');
    });

    it('should default to "eq" for null', () => {
      expect(normalizeOperator(null)).toBe('eq');
    });

    it('should default to "eq" for empty string', () => {
      expect(normalizeOperator('')).toBe('eq');
    });
  });
});

describe('stringMatch', () => {
  describe('equals/eq operator', () => {
    it('should match exact strings', () => {
      expect(stringMatch('UAL123', 'UAL123', 'eq')).toBe(true);
    });

    it('should be case insensitive', () => {
      expect(stringMatch('ual123', 'UAL123', 'eq')).toBe(true);
      expect(stringMatch('UAL123', 'ual123', 'eq')).toBe(true);
    });

    it('should handle "equals" as alias', () => {
      expect(stringMatch('UAL123', 'UAL123', 'equals')).toBe(true);
    });

    it('should not match different strings', () => {
      expect(stringMatch('UAL123', 'DAL456', 'eq')).toBe(false);
    });

    it('should trim whitespace', () => {
      expect(stringMatch('  UAL123  ', 'UAL123', 'eq')).toBe(true);
      expect(stringMatch('UAL123', '  UAL123  ', 'eq')).toBe(true);
    });

    it('should handle empty strings', () => {
      expect(stringMatch('', '', 'eq')).toBe(true);
      expect(stringMatch('', 'UAL123', 'eq')).toBe(false);
    });

    it('should handle null/undefined', () => {
      expect(stringMatch(null, 'test', 'eq')).toBe(false);
      expect(stringMatch('test', null, 'eq')).toBe(false);
      expect(stringMatch(undefined, 'test', 'eq')).toBe(false);
      expect(stringMatch(null, null, 'eq')).toBe(true);
    });
  });

  describe('neq/not_equals operator', () => {
    it('should not match equal strings', () => {
      expect(stringMatch('UAL123', 'UAL123', 'neq')).toBe(false);
    });

    it('should match different strings', () => {
      expect(stringMatch('UAL123', 'DAL456', 'neq')).toBe(true);
    });

    it('should handle "not_equals" alias', () => {
      expect(stringMatch('UAL123', 'DAL456', 'not_equals')).toBe(true);
    });

    it('should be case insensitive', () => {
      expect(stringMatch('ual123', 'UAL123', 'neq')).toBe(false);
    });
  });

  describe('contains operator', () => {
    it('should match substring', () => {
      expect(stringMatch('UAL123', '12', 'contains')).toBe(true);
    });

    it('should match at beginning', () => {
      expect(stringMatch('UAL123', 'UAL', 'contains')).toBe(true);
    });

    it('should match at end', () => {
      expect(stringMatch('UAL123', '123', 'contains')).toBe(true);
    });

    it('should match full string', () => {
      expect(stringMatch('UAL123', 'UAL123', 'contains')).toBe(true);
    });

    it('should not match missing substring', () => {
      expect(stringMatch('UAL123', 'DAL', 'contains')).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(stringMatch('UAL123', 'ual', 'contains')).toBe(true);
    });

    it('should handle empty target (always matches)', () => {
      expect(stringMatch('UAL123', '', 'contains')).toBe(true);
    });
  });

  describe('startswith/starts_with operator', () => {
    it('should match string prefix', () => {
      expect(stringMatch('UAL123', 'UAL', 'startswith')).toBe(true);
    });

    it('should handle "starts_with" alias', () => {
      expect(stringMatch('UAL123', 'UAL', 'starts_with')).toBe(true);
    });

    it('should not match non-prefix', () => {
      expect(stringMatch('UAL123', '123', 'startswith')).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(stringMatch('UAL123', 'ual', 'startswith')).toBe(true);
    });

    it('should match full string', () => {
      expect(stringMatch('UAL123', 'UAL123', 'startswith')).toBe(true);
    });

    it('should handle empty target (always matches)', () => {
      expect(stringMatch('UAL123', '', 'startswith')).toBe(true);
    });
  });

  describe('endswith/ends_with operator', () => {
    it('should match string suffix', () => {
      expect(stringMatch('UAL123', '123', 'endswith')).toBe(true);
    });

    it('should handle "ends_with" alias', () => {
      expect(stringMatch('UAL123', '123', 'ends_with')).toBe(true);
    });

    it('should not match non-suffix', () => {
      expect(stringMatch('UAL123', 'UAL', 'endswith')).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(stringMatch('UAL123ABC', 'abc', 'endswith')).toBe(true);
    });

    it('should match full string', () => {
      expect(stringMatch('UAL123', 'UAL123', 'endswith')).toBe(true);
    });

    it('should handle empty target (always matches)', () => {
      expect(stringMatch('UAL123', '', 'endswith')).toBe(true);
    });
  });

  describe('default behavior', () => {
    it('should default to equality for unknown operator', () => {
      expect(stringMatch('UAL123', 'UAL123', 'unknown')).toBe(true);
      expect(stringMatch('UAL123', 'DAL456', 'unknown')).toBe(false);
    });
  });
});

describe('numericMatch', () => {
  describe('null/undefined handling', () => {
    it('should return false for null aircraft value', () => {
      expect(numericMatch(null, '100', 'gt')).toBe(false);
    });

    it('should return false for undefined aircraft value', () => {
      expect(numericMatch(undefined, '100', 'gt')).toBe(false);
    });

    it('should return false for NaN target value', () => {
      expect(numericMatch(100, 'not-a-number', 'gt')).toBe(false);
    });

    it('should handle zero aircraft value', () => {
      expect(numericMatch(0, '100', 'lt')).toBe(true);
      expect(numericMatch(0, '0', 'eq')).toBe(true);
    });
  });

  describe('less_than/lt operator', () => {
    it('should return true when value is less than target', () => {
      expect(numericMatch(50, '100', 'lt')).toBe(true);
    });

    it('should return false when value equals target', () => {
      expect(numericMatch(100, '100', 'lt')).toBe(false);
    });

    it('should return false when value is greater than target', () => {
      expect(numericMatch(150, '100', 'lt')).toBe(false);
    });

    it('should handle "less_than" alias', () => {
      expect(numericMatch(50, '100', 'less_than')).toBe(true);
    });

    it('should handle negative numbers', () => {
      expect(numericMatch(-50, '0', 'lt')).toBe(true);
      expect(numericMatch(-50, '-100', 'lt')).toBe(false);
    });

    it('should handle decimal values', () => {
      expect(numericMatch(99.9, '100', 'lt')).toBe(true);
      expect(numericMatch(100.1, '100', 'lt')).toBe(false);
    });
  });

  describe('greater_than/gt operator', () => {
    it('should return true when value is greater than target', () => {
      expect(numericMatch(150, '100', 'gt')).toBe(true);
    });

    it('should return false when value equals target', () => {
      expect(numericMatch(100, '100', 'gt')).toBe(false);
    });

    it('should return false when value is less than target', () => {
      expect(numericMatch(50, '100', 'gt')).toBe(false);
    });

    it('should handle "greater_than" alias', () => {
      expect(numericMatch(150, '100', 'greater_than')).toBe(true);
    });

    it('should handle negative numbers', () => {
      expect(numericMatch(-50, '-100', 'gt')).toBe(true);
      expect(numericMatch(0, '-50', 'gt')).toBe(true);
    });
  });

  describe('lte operator', () => {
    it('should return true when value is less than target', () => {
      expect(numericMatch(50, '100', 'lte')).toBe(true);
    });

    it('should return true when value equals target', () => {
      expect(numericMatch(100, '100', 'lte')).toBe(true);
    });

    it('should return false when value is greater than target', () => {
      expect(numericMatch(150, '100', 'lte')).toBe(false);
    });
  });

  describe('gte operator', () => {
    it('should return true when value is greater than target', () => {
      expect(numericMatch(150, '100', 'gte')).toBe(true);
    });

    it('should return true when value equals target', () => {
      expect(numericMatch(100, '100', 'gte')).toBe(true);
    });

    it('should return false when value is less than target', () => {
      expect(numericMatch(50, '100', 'gte')).toBe(false);
    });
  });

  describe('eq/equals operator', () => {
    it('should return true when values are equal', () => {
      expect(numericMatch(100, '100', 'eq')).toBe(true);
    });

    it('should return false when values differ', () => {
      expect(numericMatch(99, '100', 'eq')).toBe(false);
    });

    it('should handle "equals" alias', () => {
      expect(numericMatch(100, '100', 'equals')).toBe(true);
    });

    it('should handle decimal precision', () => {
      expect(numericMatch(100.0, '100', 'eq')).toBe(true);
    });
  });

  describe('neq/not_equals operator', () => {
    it('should return true when values differ', () => {
      expect(numericMatch(99, '100', 'neq')).toBe(true);
    });

    it('should return false when values are equal', () => {
      expect(numericMatch(100, '100', 'neq')).toBe(false);
    });

    it('should handle "not_equals" alias', () => {
      expect(numericMatch(99, '100', 'not_equals')).toBe(true);
    });
  });

  describe('default behavior', () => {
    it('should default to equality for unknown operator', () => {
      expect(numericMatch(100, '100', 'unknown')).toBe(true);
      expect(numericMatch(99, '100', 'unknown')).toBe(false);
    });
  });

  describe('type coercion', () => {
    it('should parse string target values', () => {
      expect(numericMatch(100, '100', 'eq')).toBe(true);
    });

    it('should handle numeric target values', () => {
      expect(numericMatch(100, 100, 'eq')).toBe(true);
    });

    it('should handle string with whitespace', () => {
      expect(numericMatch(100, ' 100 ', 'eq')).toBe(true);
    });

    it('should handle scientific notation', () => {
      expect(numericMatch(1000, '1e3', 'eq')).toBe(true);
    });
  });
});
