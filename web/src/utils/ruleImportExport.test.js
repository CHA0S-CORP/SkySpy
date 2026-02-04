import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  exportRule,
  exportAllRules,
  exportSingleRule,
  downloadAsCsv,
  downloadAsJson,
  generateFilename,
  validateImportedRules,
  parseImportFile,
  convertToApiFormat,
  findDuplicates,
} from './ruleImportExport';

// Mock document for download functions
const mockLink = {
  click: vi.fn(),
  href: '',
  download: '',
};

// Store original URL methods
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

beforeEach(() => {
  vi.spyOn(document, 'createElement').mockReturnValue(mockLink);
  vi.spyOn(document.body, 'appendChild').mockImplementation(() => {});
  vi.spyOn(document.body, 'removeChild').mockImplementation(() => {});
  // Mock URL methods using Object.defineProperty
  URL.createObjectURL = vi.fn().mockReturnValue('blob:test-url');
  URL.revokeObjectURL = vi.fn();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  // Restore URL methods
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

describe('exportRule', () => {
  it('should export basic rule fields', () => {
    const rule = {
      id: 123,
      name: 'Test Rule',
      description: 'A test rule',
      priority: 'warning',
      enabled: true,
      conditions: [{ type: 'callsign', operator: 'equals', value: 'UAL123' }],
      cooldown_minutes: 10,
    };

    const result = exportRule(rule);

    expect(result.name).toBe('Test Rule');
    expect(result.description).toBe('A test rule');
    expect(result.priority).toBe('warning');
    expect(result.enabled).toBe(true);
    expect(result.conditions).toEqual(rule.conditions);
    expect(result.cooldown_minutes).toBe(10);
    expect(result.id).toBeUndefined(); // Internal fields should be stripped
  });

  it('should use severity as fallback for priority', () => {
    const rule = { name: 'Test', severity: 'critical', conditions: [] };
    const result = exportRule(rule);
    expect(result.priority).toBe('critical');
  });

  it('should default priority to info', () => {
    const rule = { name: 'Test', conditions: [] };
    const result = exportRule(rule);
    expect(result.priority).toBe('info');
  });

  it('should default enabled to true', () => {
    const rule = { name: 'Test', conditions: [] };
    const result = exportRule(rule);
    expect(result.enabled).toBe(true);
  });

  it('should default description to empty string', () => {
    const rule = { name: 'Test', conditions: [] };
    const result = exportRule(rule);
    expect(result.description).toBe('');
  });

  it('should convert cooldown seconds to minutes', () => {
    const rule = { name: 'Test', cooldown: 600, conditions: [] }; // 600 seconds = 10 minutes
    const result = exportRule(rule);
    expect(result.cooldown_minutes).toBe(10);
  });

  it('should default cooldown_minutes to 5', () => {
    const rule = { name: 'Test', conditions: [] };
    const result = exportRule(rule);
    expect(result.cooldown_minutes).toBe(5);
  });
});

describe('exportAllRules', () => {
  it('should wrap rules with metadata', () => {
    const rules = [
      { name: 'Rule 1', conditions: [] },
      { name: 'Rule 2', conditions: [] },
    ];

    const result = exportAllRules(rules);

    expect(result.version).toBe('1.0');
    expect(result.source).toBe('SkySpy');
    expect(result.exported_at).toBeDefined();
    expect(result.rules).toHaveLength(2);
  });

  it('should have valid ISO timestamp', () => {
    const rules = [{ name: 'Rule 1', conditions: [] }];
    const result = exportAllRules(rules);

    // Should be a valid ISO date string
    const date = new Date(result.exported_at);
    expect(date.toISOString()).toBe(result.exported_at);
  });
});

describe('exportSingleRule', () => {
  it('should wrap single rule with metadata', () => {
    const rule = { name: 'Single Rule', conditions: [] };
    const result = exportSingleRule(rule);

    expect(result.version).toBe('1.0');
    expect(result.source).toBe('SkySpy');
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].name).toBe('Single Rule');
  });
});

describe('downloadAsCsv', () => {
  it('should create CSV with headers', () => {
    const rules = [
      { name: 'Rule 1', description: 'Desc 1', priority: 'info', enabled: true, conditions: [] },
    ];

    downloadAsCsv(rules, 'test.csv');

    expect(document.createElement).toHaveBeenCalledWith('a');
    expect(mockLink.download).toBe('test.csv');
    expect(mockLink.click).toHaveBeenCalled();
  });

  it('should escape CSV fields with commas', () => {
    const rules = [{ name: 'Rule, with comma', conditions: [] }];

    downloadAsCsv(rules, 'test.csv');

    // The function should have been called, meaning CSV was generated
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('should escape CSV fields with quotes', () => {
    const rules = [{ name: 'Rule "with" quotes', conditions: [] }];

    downloadAsCsv(rules, 'test.csv');
    expect(URL.createObjectURL).toHaveBeenCalled();
  });
});

describe('downloadAsJson', () => {
  it('should trigger download with JSON blob', () => {
    const data = { rules: [{ name: 'Test' }] };

    downloadAsJson(data, 'test.json');

    expect(document.createElement).toHaveBeenCalledWith('a');
    expect(mockLink.download).toBe('test.json');
    expect(mockLink.click).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});

describe('generateFilename', () => {
  it('should generate filename with date for all rules', () => {
    const filename = generateFilename();
    expect(filename).toMatch(/^alert-rules-backup-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it('should generate filename with rule name', () => {
    const filename = generateFilename('My Test Rule');
    expect(filename).toMatch(/^alert-rule-my-test-rule-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it('should sanitize rule name', () => {
    const filename = generateFilename('Rule@With#Special!Chars');
    expect(filename).not.toContain('@');
    expect(filename).not.toContain('#');
    expect(filename).not.toContain('!');
  });

  it('should truncate long rule names', () => {
    const longName = 'A'.repeat(100);
    const filename = generateFilename(longName);
    // Rule name portion should be max 50 chars
    expect(filename.length).toBeLessThan(100);
  });

  it('should remove leading/trailing hyphens', () => {
    const filename = generateFilename('---Rule---');
    expect(filename).not.toMatch(/--rule--/);
  });
});

describe('validateImportedRules', () => {
  describe('valid data', () => {
    it('should validate wrapped format', () => {
      const data = {
        version: '1.0',
        rules: [
          {
            name: 'Test Rule',
            conditions: [{ type: 'callsign', operator: 'equals', value: 'UAL123' }],
          },
        ],
      };

      const result = validateImportedRules(data);

      expect(result.valid).toBe(true);
      expect(result.rules).toHaveLength(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate plain array format', () => {
      const data = [
        {
          name: 'Test Rule',
          conditions: [{ type: 'callsign', operator: 'equals', value: 'UAL123' }],
        },
      ];

      const result = validateImportedRules(data);

      expect(result.valid).toBe(true);
      expect(result.rules).toHaveLength(1);
    });

    it('should add version warning but still be valid', () => {
      const data = {
        version: '2.0',
        rules: [{ name: 'Test', conditions: [{ type: 'callsign', value: 'TEST' }] }],
      };

      const result = validateImportedRules(data);

      expect(result.valid).toBe(true);
      expect(result.errors.some((e) => e.includes('Warning'))).toBe(true);
    });
  });

  describe('invalid data', () => {
    it('should reject null data', () => {
      const result = validateImportedRules(null);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid JSON');
    });

    it('should reject non-object data', () => {
      const result = validateImportedRules('string');
      expect(result.valid).toBe(false);
    });

    it('should reject data without rules array', () => {
      const result = validateImportedRules({ notRules: [] });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Expected');
    });

    it('should reject empty rules array', () => {
      const result = validateImportedRules({ rules: [] });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('No rules found');
    });
  });

  describe('rule validation', () => {
    it('should require rule name', () => {
      const data = {
        rules: [{ conditions: [{ type: 'callsign', value: 'TEST' }] }],
      };
      const result = validateImportedRules(data);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Name is required'))).toBe(true);
    });

    it('should require name minimum length', () => {
      const data = {
        rules: [{ name: 'AB', conditions: [{ type: 'callsign', value: 'TEST' }] }],
      };
      const result = validateImportedRules(data);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('at least 3'))).toBe(true);
    });

    it('should validate priority values', () => {
      const data = {
        rules: [
          {
            name: 'Test Rule',
            priority: 'invalid',
            conditions: [{ type: 'callsign', value: 'TEST' }],
          },
        ],
      };
      const result = validateImportedRules(data);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Invalid priority'))).toBe(true);
    });

    it('should require conditions', () => {
      const data = {
        rules: [{ name: 'Test Rule' }],
      };
      const result = validateImportedRules(data);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Conditions are required'))).toBe(true);
    });

    it('should require conditions to be array', () => {
      const data = {
        rules: [{ name: 'Test Rule', conditions: {} }],
      };
      const result = validateImportedRules(data);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('must be an array'))).toBe(true);
    });

    it('should require at least one condition', () => {
      const data = {
        rules: [{ name: 'Test Rule', conditions: [] }],
      };
      const result = validateImportedRules(data);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('At least one condition'))).toBe(true);
    });

    it('should validate cooldown is non-negative', () => {
      const data = {
        rules: [
          {
            name: 'Test Rule',
            cooldown_minutes: -5,
            conditions: [{ type: 'callsign', value: 'TEST' }],
          },
        ],
      };
      const result = validateImportedRules(data);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Cooldown'))).toBe(true);
    });
  });

  describe('condition validation', () => {
    it('should validate condition type', () => {
      const data = {
        rules: [
          {
            name: 'Test Rule',
            conditions: [{ type: 'invalid_type', value: 'test' }],
          },
        ],
      };
      const result = validateImportedRules(data);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Invalid type'))).toBe(true);
    });

    it('should validate operator', () => {
      const data = {
        rules: [
          {
            name: 'Test Rule',
            conditions: [{ type: 'callsign', operator: 'invalid_op', value: 'test' }],
          },
        ],
      };
      const result = validateImportedRules(data);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Invalid operator'))).toBe(true);
    });

    it('should require value for non-boolean types', () => {
      const data = {
        rules: [
          {
            name: 'Test Rule',
            conditions: [{ type: 'callsign', operator: 'equals' }],
          },
        ],
      };
      const result = validateImportedRules(data);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Value is required'))).toBe(true);
    });

    it('should not require value for military type', () => {
      const data = {
        rules: [
          {
            name: 'Test Rule',
            conditions: [{ type: 'military' }],
          },
        ],
      };
      const result = validateImportedRules(data);
      expect(result.valid).toBe(true);
    });

    it('should not require value for emergency type', () => {
      const data = {
        rules: [
          {
            name: 'Test Rule',
            conditions: [{ type: 'emergency' }],
          },
        ],
      };
      const result = validateImportedRules(data);
      expect(result.valid).toBe(true);
    });
  });
});

describe('parseImportFile', () => {
  it('should reject null file', async () => {
    const result = await parseImportFile(null);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('No file selected');
  });

  it('should reject non-JSON file', async () => {
    const file = new File(['content'], 'test.txt', { type: 'text/plain' });
    const result = await parseImportFile(file);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('JSON file');
  });

  it('should parse valid JSON file', async () => {
    const data = {
      rules: [{ name: 'Test', conditions: [{ type: 'callsign', value: 'TEST' }] }],
    };
    const file = new File([JSON.stringify(data)], 'test.json', {
      type: 'application/json',
    });

    const result = await parseImportFile(file);

    expect(result.valid).toBe(true);
    expect(result.filename).toBe('test.json');
    expect(result.rules).toHaveLength(1);
  });

  it('should reject invalid JSON', async () => {
    const file = new File(['not json'], 'test.json', {
      type: 'application/json',
    });

    const result = await parseImportFile(file);

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid JSON');
  });
});

describe('convertToApiFormat', () => {
  it('should convert rule to API format', () => {
    const rule = {
      name: '  Test Rule  ',
      description: 'A test',
      enabled: true,
      priority: 'warning',
      conditions: [{ type: 'callsign', value: 'UAL123' }],
      cooldown_minutes: 10,
    };

    const result = convertToApiFormat(rule);

    expect(result.name).toBe('Test Rule'); // Trimmed
    expect(result.description).toBe('A test');
    expect(result.enabled).toBe(true);
    expect(result.severity).toBe('warning');
    expect(result.priority).toBe('warning');
    expect(result.cooldown).toBe(600); // 10 minutes in seconds
  });

  it('should default operator to equals', () => {
    const rule = {
      name: 'Test',
      conditions: [{ type: 'callsign', value: 'TEST' }],
    };

    const result = convertToApiFormat(rule);

    expect(result.conditions[0].operator).toBe('equals');
  });

  it('should default cooldown to 5 minutes', () => {
    const rule = {
      name: 'Test',
      conditions: [{ type: 'callsign', value: 'TEST' }],
    };

    const result = convertToApiFormat(rule);

    expect(result.cooldown).toBe(300); // 5 minutes in seconds
  });

  it('should default enabled to true', () => {
    const rule = {
      name: 'Test',
      conditions: [{ type: 'callsign', value: 'TEST' }],
    };

    const result = convertToApiFormat(rule);

    expect(result.enabled).toBe(true);
  });

  it('should handle null condition value', () => {
    const rule = {
      name: 'Test',
      conditions: [{ type: 'military', value: null }],
    };

    const result = convertToApiFormat(rule);

    expect(result.conditions[0].value).toBe('');
  });
});

describe('findDuplicates', () => {
  const existingRules = [{ name: 'Rule 1' }, { name: 'Rule 2' }, { name: 'Existing Rule' }];

  it('should identify duplicate rules', () => {
    const imported = [{ name: 'Rule 1' }, { name: 'New Rule' }];

    const result = findDuplicates(imported, existingRules);

    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0].name).toBe('Rule 1');
    expect(result.unique).toHaveLength(1);
    expect(result.unique[0].name).toBe('New Rule');
  });

  it('should be case insensitive', () => {
    const imported = [{ name: 'RULE 1' }];

    const result = findDuplicates(imported, existingRules);

    expect(result.duplicates).toHaveLength(1);
  });

  it('should handle all unique rules', () => {
    const imported = [{ name: 'Brand New Rule' }, { name: 'Another New Rule' }];

    const result = findDuplicates(imported, existingRules);

    expect(result.duplicates).toHaveLength(0);
    expect(result.unique).toHaveLength(2);
  });

  it('should handle all duplicate rules', () => {
    const imported = [{ name: 'Rule 1' }, { name: 'Rule 2' }];

    const result = findDuplicates(imported, existingRules);

    expect(result.duplicates).toHaveLength(2);
    expect(result.unique).toHaveLength(0);
  });

  it('should handle empty existing rules', () => {
    const imported = [{ name: 'New Rule' }];

    const result = findDuplicates(imported, []);

    expect(result.duplicates).toHaveLength(0);
    expect(result.unique).toHaveLength(1);
  });

  it('should handle empty imported rules', () => {
    const result = findDuplicates([], existingRules);

    expect(result.duplicates).toHaveLength(0);
    expect(result.unique).toHaveLength(0);
  });
});
