import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSystemConfig } from './useSystemConfig';

describe('useSystemConfig', () => {
  let mockFetch;
  let mockOnToast;
  let originalCreateElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnToast = vi.fn();
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Save original document.createElement
    originalCreateElement = document.createElement.bind(document);

    // Mock localStorage
    global.localStorage = {
      getItem: vi.fn(() => 'test-token'),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Restore document.createElement
    if (originalCreateElement) {
      document.createElement = originalCreateElement;
    }
  });

  describe('initialization', () => {
    it('should start with loading state', () => {
      mockFetch.mockImplementation(() => new Promise(() => {}));

      const { result } = renderHook(() =>
        useSystemConfig({
          apiBase: 'http://localhost:8000',
          onToast: mockOnToast,
        })
      );

      expect(result.current.loading).toBe(true);
      expect(result.current.categories).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it('should fetch configs on mount', async () => {
      vi.useRealTimers();

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            categories: [
              {
                name: 'General',
                configs: [
                  { key: 'SITE_NAME', value: 'SkySpy', data_type: 'str' },
                ],
              },
            ],
          }),
      });

      const { result } = renderHook(() =>
        useSystemConfig({
          apiBase: 'http://localhost:8000',
          onToast: mockOnToast,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/v1/admin/config/',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );

      expect(result.current.categories).toHaveLength(1);
      expect(result.current.categories[0].name).toBe('General');
    });

    it('should handle fetch error', async () => {
      vi.useRealTimers();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ detail: 'Forbidden' }),
      });

      const { result } = renderHook(() =>
        useSystemConfig({
          apiBase: 'http://localhost:8000',
          onToast: mockOnToast,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Forbidden');
      expect(mockOnToast).toHaveBeenCalledWith(
        'Failed to load configuration: Forbidden',
        'error'
      );
    });
  });

  describe('allConfigs computed', () => {
    it('should flatten all configs from categories', async () => {
      vi.useRealTimers();

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            categories: [
              {
                name: 'General',
                configs: [
                  { key: 'SITE_NAME', value: 'SkySpy' },
                  { key: 'DEBUG', value: 'false' },
                ],
              },
              {
                name: 'Security',
                configs: [{ key: 'SECRET_KEY', value: '***' }],
              },
            ],
          }),
      });

      const { result } = renderHook(() =>
        useSystemConfig({
          apiBase: 'http://localhost:8000',
          onToast: mockOnToast,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.allConfigs).toHaveLength(3);
    });
  });

  describe('pending changes', () => {
    beforeEach(() => {
      vi.useRealTimers();

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            categories: [
              {
                name: 'General',
                configs: [{ key: 'SITE_NAME', value: 'SkySpy' }],
              },
            ],
          }),
      });
    });

    it('should track pending changes with updateValue', async () => {
      const { result } = renderHook(() =>
        useSystemConfig({
          apiBase: 'http://localhost:8000',
          onToast: mockOnToast,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.updateValue('SITE_NAME', 'New Name');
      });

      expect(result.current.pendingChanges).toEqual({ SITE_NAME: 'New Name' });
      expect(result.current.pendingChangeCount).toBe(1);
      expect(result.current.hasChange('SITE_NAME')).toBe(true);
    });

    it('should reset specific pending change', async () => {
      const { result } = renderHook(() =>
        useSystemConfig({
          apiBase: 'http://localhost:8000',
          onToast: mockOnToast,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.updateValue('SITE_NAME', 'New Name');
        result.current.updateValue('DEBUG', 'true');
      });

      expect(result.current.pendingChangeCount).toBe(2);

      act(() => {
        result.current.resetValue('SITE_NAME');
      });

      expect(result.current.pendingChanges).toEqual({ DEBUG: 'true' });
      expect(result.current.pendingChangeCount).toBe(1);
    });

    it('should clear all pending changes', async () => {
      const { result } = renderHook(() =>
        useSystemConfig({
          apiBase: 'http://localhost:8000',
          onToast: mockOnToast,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.updateValue('SITE_NAME', 'New Name');
        result.current.updateValue('DEBUG', 'true');
      });

      act(() => {
        result.current.clearPendingChanges();
      });

      expect(result.current.pendingChanges).toEqual({});
      expect(result.current.pendingChangeCount).toBe(0);
    });

    it('should return pending value from getConfigValue', async () => {
      const { result } = renderHook(() =>
        useSystemConfig({
          apiBase: 'http://localhost:8000',
          onToast: mockOnToast,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Original value
      expect(result.current.getConfigValue('SITE_NAME')).toBe('SkySpy');

      act(() => {
        result.current.updateValue('SITE_NAME', 'New Name');
      });

      // Pending value takes precedence
      expect(result.current.getConfigValue('SITE_NAME')).toBe('New Name');
    });
  });

  describe('saveValue', () => {
    beforeEach(() => {
      vi.useRealTimers();

      // Initial fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            categories: [
              {
                name: 'General',
                configs: [{ key: 'SITE_NAME', value: 'SkySpy' }],
              },
            ],
          }),
      });
    });

    it('should save single value', async () => {
      // Save request
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ key: 'SITE_NAME', value: 'New Name' }),
      });

      // Refetch after save
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            categories: [
              {
                name: 'General',
                configs: [{ key: 'SITE_NAME', value: 'New Name' }],
              },
            ],
          }),
      });

      const { result } = renderHook(() =>
        useSystemConfig({
          apiBase: 'http://localhost:8000',
          onToast: mockOnToast,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.updateValue('SITE_NAME', 'New Name');
      });

      const success = await result.current.saveValue('SITE_NAME', 'New Name');

      expect(success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/v1/admin/config/SITE_NAME/',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ value: 'New Name' }),
        })
      );
      expect(mockOnToast).toHaveBeenCalledWith('Configuration saved', 'success');
    });

    it('should handle save error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ detail: 'Invalid value' }),
      });

      const { result } = renderHook(() =>
        useSystemConfig({
          apiBase: 'http://localhost:8000',
          onToast: mockOnToast,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const success = await result.current.saveValue('SITE_NAME', 'Invalid');

      expect(success).toBe(false);
      expect(mockOnToast).toHaveBeenCalledWith('Failed to save: Invalid value', 'error');
    });

    it('should set saving state during save', async () => {
      // Save request
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ key: 'SITE_NAME', value: 'New Name' }),
      });

      // Refetch after save
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            categories: [
              {
                name: 'General',
                configs: [{ key: 'SITE_NAME', value: 'New Name' }],
              },
            ],
          }),
      });

      const { result } = renderHook(() =>
        useSystemConfig({
          apiBase: 'http://localhost:8000',
          onToast: mockOnToast,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Call saveValue and verify it completes
      const success = await result.current.saveValue('SITE_NAME', 'New Name');
      expect(success).toBe(true);
      expect(result.current.saving).toBe(false);
    });
  });

  describe('saveAllPendingChanges', () => {
    beforeEach(() => {
      vi.useRealTimers();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            categories: [
              {
                name: 'General',
                configs: [
                  { key: 'SITE_NAME', value: 'SkySpy' },
                  { key: 'DEBUG', value: 'false' },
                ],
              },
            ],
          }),
      });
    });

    it('should return true when no pending changes', async () => {
      const { result } = renderHook(() =>
        useSystemConfig({
          apiBase: 'http://localhost:8000',
          onToast: mockOnToast,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const success = await result.current.saveAllPendingChanges();

      expect(success).toBe(true);
    });

    it('should save all pending changes via bulk endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            updated: ['SITE_NAME', 'DEBUG'],
            errors: {},
          }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            categories: [
              {
                name: 'General',
                configs: [
                  { key: 'SITE_NAME', value: 'New Name' },
                  { key: 'DEBUG', value: 'true' },
                ],
              },
            ],
          }),
      });

      const { result } = renderHook(() =>
        useSystemConfig({
          apiBase: 'http://localhost:8000',
          onToast: mockOnToast,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.updateValue('SITE_NAME', 'New Name');
        result.current.updateValue('DEBUG', 'true');
      });

      const success = await result.current.saveAllPendingChanges();

      expect(success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/v1/admin/config/bulk_update/',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            updates: { SITE_NAME: 'New Name', DEBUG: 'true' },
          }),
        })
      );
      expect(mockOnToast).toHaveBeenCalledWith('Saved 2 configurations', 'success');
    });

    it('should show warning for partial errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            updated: ['SITE_NAME'],
            errors: { DEBUG: 'Invalid value' },
          }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ categories: [] }),
      });

      const { result } = renderHook(() =>
        useSystemConfig({
          apiBase: 'http://localhost:8000',
          onToast: mockOnToast,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.updateValue('SITE_NAME', 'New Name');
        result.current.updateValue('DEBUG', 'invalid');
      });

      await result.current.saveAllPendingChanges();

      expect(mockOnToast).toHaveBeenCalledWith(
        'Some configs failed to save: DEBUG',
        'warning'
      );
    });

    it('should show warning when restart required', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            updated: ['WORKERS'],
            errors: {},
            requires_restart: ['WORKERS'],
          }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ categories: [] }),
      });

      const { result } = renderHook(() =>
        useSystemConfig({
          apiBase: 'http://localhost:8000',
          onToast: mockOnToast,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.updateValue('WORKERS', '4');
      });

      await result.current.saveAllPendingChanges();

      expect(mockOnToast).toHaveBeenCalledWith(
        'Some changes require a restart to take effect',
        'warning'
      );
    });
  });

  describe('resetToDefault', () => {
    beforeEach(() => {
      vi.useRealTimers();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            categories: [
              {
                name: 'General',
                configs: [{ key: 'SITE_NAME', value: 'Custom Name' }],
              },
            ],
          }),
      });
    });

    it('should reset config to default', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            categories: [
              {
                name: 'General',
                configs: [{ key: 'SITE_NAME', value: 'SkySpy' }],
              },
            ],
          }),
      });

      const { result } = renderHook(() =>
        useSystemConfig({
          apiBase: 'http://localhost:8000',
          onToast: mockOnToast,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const success = await result.current.resetToDefault('SITE_NAME');

      expect(success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/v1/admin/config/reset_to_default/',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ keys: ['SITE_NAME'] }),
        })
      );
      expect(mockOnToast).toHaveBeenCalledWith('Configuration reset to default', 'success');
    });
  });

  describe('validateValue', () => {
    beforeEach(() => {
      vi.useRealTimers();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ categories: [] }),
      });
    });

    it('should validate value successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ valid: true, errors: [] }),
      });

      const { result } = renderHook(() =>
        useSystemConfig({
          apiBase: 'http://localhost:8000',
          onToast: mockOnToast,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const validation = await result.current.validateValue('SITE_NAME', 'New Name');

      expect(validation).toEqual({ valid: true, errors: [] });
    });

    it('should return validation errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ valid: false, errors: ['Value too short'] }),
      });

      const { result } = renderHook(() =>
        useSystemConfig({
          apiBase: 'http://localhost:8000',
          onToast: mockOnToast,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const validation = await result.current.validateValue('SITE_NAME', '');

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Value too short');
    });

    it('should handle validation request failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const { result } = renderHook(() =>
        useSystemConfig({
          apiBase: 'http://localhost:8000',
          onToast: mockOnToast,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const validation = await result.current.validateValue('SITE_NAME', 'test');

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Failed to validate');
    });
  });

  describe('audit log', () => {
    beforeEach(() => {
      vi.useRealTimers();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ categories: [] }),
      });
    });

    it('should fetch audit log', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            audit_log: [
              { id: 1, config_key: 'SITE_NAME', old_value: 'Old', new_value: 'New' },
            ],
          }),
      });

      const { result } = renderHook(() =>
        useSystemConfig({
          apiBase: 'http://localhost:8000',
          onToast: mockOnToast,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.fetchAuditLog();
      });

      expect(result.current.auditLog).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/admin/config/audit_log/'),
        expect.any(Object)
      );
    });

    it('should filter audit log by config key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ audit_log: [] }),
      });

      const { result } = renderHook(() =>
        useSystemConfig({
          apiBase: 'http://localhost:8000',
          onToast: mockOnToast,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.fetchAuditLog('SITE_NAME', 48);
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('config_key=SITE_NAME'),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('hours=48'),
        expect.any(Object)
      );
    });
  });

  describe('export/import', () => {
    beforeEach(() => {
      vi.useRealTimers();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            categories: [
              {
                name: 'General',
                configs: [{ key: 'SITE_NAME', value: 'SkySpy' }],
              },
            ],
          }),
      });

      // Mock URL.createObjectURL and URL.revokeObjectURL
      global.URL.createObjectURL = vi.fn(() => 'blob:test');
      global.URL.revokeObjectURL = vi.fn();
    });

    it('should export configs', async () => {
      // Mock for this specific test - only for anchor element creation
      const mockLink = {
        href: '',
        download: '',
        click: vi.fn(),
        style: {},
      };
      const originalCreateElementLocal = document.createElement.bind(document);
      document.createElement = (tag) => {
        if (tag === 'a') return mockLink;
        return originalCreateElementLocal(tag);
      };
      const originalAppendChild = document.body.appendChild.bind(document.body);
      const originalRemoveChild = document.body.removeChild.bind(document.body);
      document.body.appendChild = vi.fn((el) => {
        if (el === mockLink) return el;
        return originalAppendChild(el);
      });
      document.body.removeChild = vi.fn((el) => {
        if (el === mockLink) return el;
        return originalRemoveChild(el);
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            configs: { SITE_NAME: 'SkySpy' },
            exported_at: '2024-01-01T00:00:00Z',
          }),
      });

      const { result } = renderHook(() =>
        useSystemConfig({
          apiBase: 'http://localhost:8000',
          onToast: mockOnToast,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.exportConfigs();
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/admin/config/export/'),
        expect.any(Object)
      );
      expect(mockOnToast).toHaveBeenCalledWith('Configuration exported', 'success');
    });

    it('should import configs', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            imported: 2,
            skipped: 1,
            errors: {},
          }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ categories: [] }),
      });

      const { result } = renderHook(() =>
        useSystemConfig({
          apiBase: 'http://localhost:8000',
          onToast: mockOnToast,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Create a mock file object with text() method
      const mockFile = {
        name: 'config.json',
        type: 'application/json',
        text: vi.fn().mockResolvedValue(JSON.stringify({ configs: { SITE_NAME: 'Imported' } })),
      };

      const importResult = await result.current.importConfigs(mockFile);

      expect(importResult.imported).toBe(2);
      expect(mockOnToast).toHaveBeenCalledWith('Imported 2 configs, skipped 1', 'success');
    });

    it('should support dry run import', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            would_import: 2,
            would_skip: 1,
            dry_run: true,
          }),
      });

      const { result } = renderHook(() =>
        useSystemConfig({
          apiBase: 'http://localhost:8000',
          onToast: mockOnToast,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Create a mock file object with text() method
      const mockFile = {
        name: 'config.json',
        type: 'application/json',
        text: vi.fn().mockResolvedValue('{}'),
      };

      const importResult = await result.current.importConfigs(mockFile, { dryRun: true });

      expect(importResult.dry_run).toBe(true);
    });
  });

  describe('revealSensitiveValue', () => {
    beforeEach(() => {
      vi.useRealTimers();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ categories: [] }),
      });
    });

    it('should reveal sensitive value', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ value: 'actual-secret-value' }),
      });

      const { result } = renderHook(() =>
        useSystemConfig({
          apiBase: 'http://localhost:8000',
          onToast: mockOnToast,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const value = await result.current.revealSensitiveValue('SECRET_KEY');

      expect(value).toBe('actual-secret-value');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/v1/admin/config/SECRET_KEY/reveal/',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should handle reveal error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ detail: 'Permission denied' }),
      });

      const { result } = renderHook(() =>
        useSystemConfig({
          apiBase: 'http://localhost:8000',
          onToast: mockOnToast,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const value = await result.current.revealSensitiveValue('SECRET_KEY');

      expect(value).toBeNull();
      expect(mockOnToast).toHaveBeenCalledWith(
        'Failed to reveal value: Permission denied',
        'error'
      );
    });
  });

  describe('hasRestartRequired', () => {
    it('should detect when pending changes require restart', async () => {
      vi.useRealTimers();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            categories: [
              {
                name: 'System',
                configs: [
                  { key: 'WORKERS', value: '2', requires_restart: true },
                  { key: 'DEBUG', value: 'false', requires_restart: false },
                ],
              },
            ],
          }),
      });

      const { result } = renderHook(() =>
        useSystemConfig({
          apiBase: 'http://localhost:8000',
          onToast: mockOnToast,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.hasRestartRequired).toBe(false);

      act(() => {
        result.current.updateValue('WORKERS', '4');
      });

      expect(result.current.hasRestartRequired).toBe(true);

      act(() => {
        result.current.clearPendingChanges();
      });

      expect(result.current.hasRestartRequired).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should abort requests on unmount', async () => {
      const abortSpy = vi.spyOn(AbortController.prototype, 'abort');

      mockFetch.mockImplementation(() => new Promise(() => {}));

      const { unmount } = renderHook(() =>
        useSystemConfig({
          apiBase: 'http://localhost:8000',
          onToast: mockOnToast,
        })
      );

      unmount();

      expect(abortSpy).toHaveBeenCalled();

      abortSpy.mockRestore();
    });
  });
});
