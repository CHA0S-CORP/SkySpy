import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAlertRules } from './useAlertRules';

// Mock dependencies
vi.mock('./index', () => ({
  useSocketApi: vi.fn(() => ({
    data: null,
    refetch: vi.fn(),
  })),
}));

vi.mock('./socket', () => ({
  useSocketIO: vi.fn(() => ({
    connected: false,
    on: vi.fn(() => vi.fn()),
  })),
}));

vi.mock('../utils/ruleImportExport', () => ({
  exportAllRules: vi.fn((rules) => ({ rules, version: '1.0' })),
  exportSingleRule: vi.fn((rule) => ({ rule, version: '1.0' })),
  downloadAsJson: vi.fn(),
  downloadAsCsv: vi.fn(),
  generateFilename: vi.fn(() => 'rules-export.json'),
  parseImportFile: vi.fn(),
  findDuplicates: vi.fn((rules, existing) => ({
    duplicates: [],
    unique: rules,
  })),
  convertToApiFormat: vi.fn((rule) => rule),
}));

vi.mock('../components/alerts/alertConstants', () => ({
  UNDO_GRACE_PERIOD: 5000,
}));

import { useSocketApi } from './index';
import { useSocketIO } from './socket';
import {
  exportAllRules,
  downloadAsJson,
  downloadAsCsv,
  parseImportFile,
  findDuplicates,
} from '../utils/ruleImportExport';

describe('useAlertRules', () => {
  let mockWsRequest;
  let mockRefetch;
  let mockOnToast;
  let mockOnAlertEvent;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    mockWsRequest = vi.fn();
    mockRefetch = vi.fn();
    mockOnToast = vi.fn();
    mockOnAlertEvent = vi.fn(() => vi.fn());

    useSocketApi.mockReturnValue({
      data: { rules: [] },
      refetch: mockRefetch,
    });

    useSocketIO.mockReturnValue({
      connected: false,
      on: mockOnAlertEvent,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with empty rules', () => {
      const { result } = renderHook(() =>
        useAlertRules({
          apiBase: 'http://localhost:8000',
          wsRequest: mockWsRequest,
          wsConnected: true,
          onToast: mockOnToast,
        })
      );

      expect(result.current.rules).toEqual([]);
      expect(result.current.filteredRules).toEqual([]);
      expect(result.current.realtimeAlerts).toEqual([]);
    });

    it('should normalize rules data from API', () => {
      useSocketApi.mockReturnValue({
        data: [
          { id: 1, name: 'Rule 1' },
          { id: 2, name: 'Rule 2' },
        ],
        refetch: mockRefetch,
      });

      const { result } = renderHook(() =>
        useAlertRules({
          apiBase: 'http://localhost:8000',
          wsRequest: mockWsRequest,
          wsConnected: true,
          onToast: mockOnToast,
        })
      );

      expect(result.current.rules).toHaveLength(2);
    });

    it('should handle paginated results', () => {
      useSocketApi.mockReturnValue({
        data: {
          results: [
            { id: 1, name: 'Rule 1' },
            { id: 2, name: 'Rule 2' },
          ],
        },
        refetch: mockRefetch,
      });

      const { result } = renderHook(() =>
        useAlertRules({
          apiBase: 'http://localhost:8000',
          wsRequest: mockWsRequest,
          wsConnected: true,
          onToast: mockOnToast,
        })
      );

      expect(result.current.rules).toHaveLength(2);
    });
  });

  describe('filtering and sorting', () => {
    beforeEach(() => {
      useSocketApi.mockReturnValue({
        data: {
          rules: [
            {
              id: 1,
              name: 'Alpha Rule',
              priority: 'critical',
              enabled: true,
              created_at: '2024-01-01',
            },
            {
              id: 2,
              name: 'Beta Rule',
              priority: 'warning',
              enabled: false,
              created_at: '2024-01-02',
            },
            {
              id: 3,
              name: 'Gamma Rule',
              priority: 'info',
              enabled: true,
              created_at: '2024-01-03',
            },
          ],
        },
        refetch: mockRefetch,
      });
    });

    it('should filter rules by search query', () => {
      const { result } = renderHook(() =>
        useAlertRules({
          apiBase: 'http://localhost:8000',
          wsRequest: mockWsRequest,
          wsConnected: true,
          onToast: mockOnToast,
        })
      );

      act(() => {
        result.current.setSearchQuery('alpha');
      });

      expect(result.current.filteredRules).toHaveLength(1);
      expect(result.current.filteredRules[0].name).toBe('Alpha Rule');
    });

    it('should filter rules by priority', () => {
      const { result } = renderHook(() =>
        useAlertRules({
          apiBase: 'http://localhost:8000',
          wsRequest: mockWsRequest,
          wsConnected: true,
          onToast: mockOnToast,
        })
      );

      act(() => {
        result.current.setPriorityFilter('critical');
      });

      expect(result.current.filteredRules).toHaveLength(1);
      expect(result.current.filteredRules[0].priority).toBe('critical');
    });

    it('should filter rules by enabled status', () => {
      const { result } = renderHook(() =>
        useAlertRules({
          apiBase: 'http://localhost:8000',
          wsRequest: mockWsRequest,
          wsConnected: true,
          onToast: mockOnToast,
        })
      );

      act(() => {
        result.current.setStatusFilter('disabled');
      });

      expect(result.current.filteredRules).toHaveLength(1);
      expect(result.current.filteredRules[0].enabled).toBe(false);
    });

    it('should sort rules by name ascending', () => {
      const { result } = renderHook(() =>
        useAlertRules({
          apiBase: 'http://localhost:8000',
          wsRequest: mockWsRequest,
          wsConnected: true,
          onToast: mockOnToast,
        })
      );

      act(() => {
        result.current.setSortBy('name-asc');
      });

      expect(result.current.filteredRules[0].name).toBe('Alpha Rule');
      expect(result.current.filteredRules[2].name).toBe('Gamma Rule');
    });

    it('should sort rules by name descending', () => {
      const { result } = renderHook(() =>
        useAlertRules({
          apiBase: 'http://localhost:8000',
          wsRequest: mockWsRequest,
          wsConnected: true,
          onToast: mockOnToast,
        })
      );

      act(() => {
        result.current.setSortBy('name-desc');
      });

      expect(result.current.filteredRules[0].name).toBe('Gamma Rule');
      expect(result.current.filteredRules[2].name).toBe('Alpha Rule');
    });

    it('should sort rules by priority', () => {
      const { result } = renderHook(() =>
        useAlertRules({
          apiBase: 'http://localhost:8000',
          wsRequest: mockWsRequest,
          wsConnected: true,
          onToast: mockOnToast,
        })
      );

      act(() => {
        result.current.setSortBy('priority');
      });

      expect(result.current.filteredRules[0].priority).toBe('critical');
      expect(result.current.filteredRules[1].priority).toBe('warning');
      expect(result.current.filteredRules[2].priority).toBe('info');
    });

    it('should sort rules by created date', () => {
      const { result } = renderHook(() =>
        useAlertRules({
          apiBase: 'http://localhost:8000',
          wsRequest: mockWsRequest,
          wsConnected: true,
          onToast: mockOnToast,
        })
      );

      act(() => {
        result.current.setSortBy('created');
      });

      expect(result.current.filteredRules[0].name).toBe('Gamma Rule');
      expect(result.current.filteredRules[2].name).toBe('Alpha Rule');
    });

    it('should clear all filters', () => {
      const { result } = renderHook(() =>
        useAlertRules({
          apiBase: 'http://localhost:8000',
          wsRequest: mockWsRequest,
          wsConnected: true,
          onToast: mockOnToast,
        })
      );

      act(() => {
        result.current.setSearchQuery('test');
        result.current.setPriorityFilter('critical');
        result.current.setStatusFilter('enabled');
      });

      expect(result.current.hasActiveFilters).toBeTruthy();

      act(() => {
        result.current.clearFilters();
      });

      expect(result.current.searchQuery).toBe('');
      expect(result.current.priorityFilter).toBe('all');
      expect(result.current.statusFilter).toBe('all');
      expect(result.current.hasActiveFilters).toBeFalsy();
    });
  });

  describe('delete with undo', () => {
    beforeEach(() => {
      useSocketApi.mockReturnValue({
        data: {
          rules: [{ id: 1, name: 'Test Rule', priority: 'info', enabled: true }],
        },
        refetch: mockRefetch,
      });
    });

    it('should show toast when not connected', async () => {
      const { result } = renderHook(() =>
        useAlertRules({
          apiBase: 'http://localhost:8000',
          wsRequest: null,
          wsConnected: false,
          onToast: mockOnToast,
        })
      );

      await act(async () => {
        await result.current.handleDelete({ id: 1, name: 'Test Rule' });
      });

      expect(mockOnToast).toHaveBeenCalledWith('Not connected to server', 'error');
    });

    it('should set pending delete and show undo toast', async () => {
      const { result } = renderHook(() =>
        useAlertRules({
          apiBase: 'http://localhost:8000',
          wsRequest: mockWsRequest,
          wsConnected: true,
          onToast: mockOnToast,
        })
      );

      await act(async () => {
        await result.current.handleDelete({ id: 1, name: 'Test Rule' });
      });

      expect(result.current.pendingDelete).not.toBeNull();
      expect(result.current.pendingDelete.rule.id).toBe(1);
      expect(mockOnToast).toHaveBeenCalledWith(
        'Rule "Test Rule" deleted. Click Undo to restore.',
        'warning'
      );
    });

    it('should exclude pending delete from filtered rules', async () => {
      const { result } = renderHook(() =>
        useAlertRules({
          apiBase: 'http://localhost:8000',
          wsRequest: mockWsRequest,
          wsConnected: true,
          onToast: mockOnToast,
        })
      );

      expect(result.current.filteredRules).toHaveLength(1);

      await act(async () => {
        await result.current.handleDelete({ id: 1, name: 'Test Rule' });
      });

      expect(result.current.filteredRules).toHaveLength(0);
    });

    it('should actually delete after grace period', async () => {
      mockWsRequest.mockResolvedValue({ success: true });

      const { result } = renderHook(() =>
        useAlertRules({
          apiBase: 'http://localhost:8000',
          wsRequest: mockWsRequest,
          wsConnected: true,
          onToast: mockOnToast,
        })
      );

      await act(async () => {
        await result.current.handleDelete({ id: 1, name: 'Test Rule' });
      });

      // Advance past UNDO_GRACE_PERIOD (5000ms)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000);
      });

      expect(mockWsRequest).toHaveBeenCalledWith('alert-rule-delete', { id: 1 });
      expect(mockRefetch).toHaveBeenCalled();
    });

    it('should restore rule on undo', async () => {
      const { result } = renderHook(() =>
        useAlertRules({
          apiBase: 'http://localhost:8000',
          wsRequest: mockWsRequest,
          wsConnected: true,
          onToast: mockOnToast,
        })
      );

      await act(async () => {
        await result.current.handleDelete({ id: 1, name: 'Test Rule' });
      });

      expect(result.current.pendingDelete).not.toBeNull();

      act(() => {
        result.current.handleUndoDelete();
      });

      expect(result.current.pendingDelete).toBeNull();
      expect(mockOnToast).toHaveBeenCalledWith('"Test Rule" restored', 'success');

      // Advance past grace period - delete should not happen
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000);
      });

      expect(mockWsRequest).not.toHaveBeenCalledWith('alert-rule-delete', expect.any(Object));
    });
  });

  describe('toggle rule', () => {
    beforeEach(() => {
      useSocketApi.mockReturnValue({
        data: {
          rules: [{ id: 1, name: 'Test Rule', priority: 'info', enabled: true }],
        },
        refetch: mockRefetch,
      });
    });

    it('should show toast when not connected', async () => {
      const { result } = renderHook(() =>
        useAlertRules({
          apiBase: 'http://localhost:8000',
          wsRequest: null,
          wsConnected: false,
          onToast: mockOnToast,
        })
      );

      await act(async () => {
        await result.current.handleToggle({ id: 1, name: 'Test Rule', enabled: true });
      });

      expect(mockOnToast).toHaveBeenCalledWith('Not connected to server', 'error');
    });

    it('should toggle rule enabled state', async () => {
      mockWsRequest.mockResolvedValue({ success: true });

      const { result } = renderHook(() =>
        useAlertRules({
          apiBase: 'http://localhost:8000',
          wsRequest: mockWsRequest,
          wsConnected: true,
          onToast: mockOnToast,
        })
      );

      await act(async () => {
        await result.current.handleToggle({ id: 1, name: 'Test Rule', enabled: true });
      });

      expect(mockWsRequest).toHaveBeenCalledWith('alert-rule-toggle', {
        id: 1,
        enabled: false,
      });
      expect(mockRefetch).toHaveBeenCalled();
      expect(mockOnToast).toHaveBeenCalledWith('Rule "Test Rule" disabled', 'success');
    });

    it('should handle toggle error', async () => {
      mockWsRequest.mockResolvedValue({ error: 'Toggle failed' });

      const { result } = renderHook(() =>
        useAlertRules({
          apiBase: 'http://localhost:8000',
          wsRequest: mockWsRequest,
          wsConnected: true,
          onToast: mockOnToast,
        })
      );

      await act(async () => {
        await result.current.handleToggle({ id: 1, name: 'Test Rule', enabled: true });
      });

      expect(mockOnToast).toHaveBeenCalledWith('Failed to update rule', 'error');
    });
  });

  describe('export functionality', () => {
    beforeEach(() => {
      useSocketApi.mockReturnValue({
        data: {
          rules: [
            { id: 1, name: 'Rule 1' },
            { id: 2, name: 'Rule 2' },
          ],
        },
        refetch: mockRefetch,
      });
    });

    it('should export all rules as JSON', () => {
      const { result } = renderHook(() =>
        useAlertRules({
          apiBase: 'http://localhost:8000',
          wsRequest: mockWsRequest,
          wsConnected: true,
          onToast: mockOnToast,
        })
      );

      act(() => {
        result.current.handleExportAll();
      });

      expect(exportAllRules).toHaveBeenCalledWith(result.current.rules);
      expect(downloadAsJson).toHaveBeenCalled();
      expect(mockOnToast).toHaveBeenCalledWith('All rules exported', 'success');
    });

    it('should export rules as CSV', () => {
      const { result } = renderHook(() =>
        useAlertRules({
          apiBase: 'http://localhost:8000',
          wsRequest: mockWsRequest,
          wsConnected: true,
          onToast: mockOnToast,
        })
      );

      act(() => {
        result.current.handleExportCsv();
      });

      expect(downloadAsCsv).toHaveBeenCalled();
      expect(mockOnToast).toHaveBeenCalledWith('Rules exported as CSV', 'success');
    });

    it('should export single rule', () => {
      const { result } = renderHook(() =>
        useAlertRules({
          apiBase: 'http://localhost:8000',
          wsRequest: mockWsRequest,
          wsConnected: true,
          onToast: mockOnToast,
        })
      );

      act(() => {
        result.current.handleExportRule({ id: 1, name: 'Rule 1' });
      });

      expect(downloadAsJson).toHaveBeenCalled();
      expect(mockOnToast).toHaveBeenCalledWith('Rule "Rule 1" exported', 'success');
    });

    it('should not export when no rules', () => {
      useSocketApi.mockReturnValue({
        data: { rules: [] },
        refetch: mockRefetch,
      });

      const { result } = renderHook(() =>
        useAlertRules({
          apiBase: 'http://localhost:8000',
          wsRequest: mockWsRequest,
          wsConnected: true,
          onToast: mockOnToast,
        })
      );

      act(() => {
        result.current.handleExportAll();
      });

      expect(downloadAsJson).not.toHaveBeenCalled();
    });
  });

  describe('import functionality', () => {
    beforeEach(() => {
      useSocketApi.mockReturnValue({
        data: { rules: [] },
        refetch: mockRefetch,
      });

      parseImportFile.mockResolvedValue({
        valid: true,
        rules: [{ id: 1, name: 'Imported Rule' }],
      });

      findDuplicates.mockReturnValue({
        duplicates: [],
        unique: [{ id: 1, name: 'Imported Rule' }],
      });
    });

    it('should parse import file and show modal', async () => {
      vi.useRealTimers();

      const { result } = renderHook(() =>
        useAlertRules({
          apiBase: 'http://localhost:8000',
          wsRequest: mockWsRequest,
          wsConnected: true,
          onToast: mockOnToast,
        })
      );

      const mockFile = new File(['{}'], 'rules.json', { type: 'application/json' });
      const event = { target: { files: [mockFile] } };

      await act(async () => {
        await result.current.handleFileSelect(event);
      });

      expect(parseImportFile).toHaveBeenCalledWith(mockFile);
      expect(result.current.showImportModal).toBe(true);
      expect(result.current.importData).toEqual({
        valid: true,
        rules: [{ id: 1, name: 'Imported Rule' }],
      });
    });

    it('should import rules successfully', async () => {
      vi.useRealTimers();

      mockWsRequest.mockResolvedValue({ success: true });

      const { result } = renderHook(() =>
        useAlertRules({
          apiBase: 'http://localhost:8000',
          wsRequest: mockWsRequest,
          wsConnected: true,
          onToast: mockOnToast,
        })
      );

      // Setup import data
      const mockFile = new File(['{}'], 'rules.json', { type: 'application/json' });
      await act(async () => {
        await result.current.handleFileSelect({ target: { files: [mockFile] } });
      });

      await act(async () => {
        await result.current.handleImport();
      });

      expect(mockWsRequest).toHaveBeenCalledWith('alert-rule-create', expect.any(Object));
      expect(mockRefetch).toHaveBeenCalled();
      expect(mockOnToast).toHaveBeenCalledWith('1 rule imported', 'success');
    });

    it('should show toast when not connected during import', async () => {
      vi.useRealTimers();

      const { result } = renderHook(() =>
        useAlertRules({
          apiBase: 'http://localhost:8000',
          wsRequest: null,
          wsConnected: false,
          onToast: mockOnToast,
        })
      );

      // Setup import data
      const mockFile = new File(['{}'], 'rules.json', { type: 'application/json' });
      await act(async () => {
        await result.current.handleFileSelect({ target: { files: [mockFile] } });
      });

      await act(async () => {
        await result.current.handleImport();
      });

      expect(mockOnToast).toHaveBeenCalledWith('Not connected to server', 'error');
    });
  });

  describe('real-time alerts', () => {
    it('should setup alert event listeners when connected', () => {
      useSocketIO.mockReturnValue({
        connected: true,
        on: mockOnAlertEvent,
      });

      renderHook(() =>
        useAlertRules({
          apiBase: 'http://localhost:8000',
          wsRequest: mockWsRequest,
          wsConnected: true,
          onToast: mockOnToast,
        })
      );

      expect(mockOnAlertEvent).toHaveBeenCalledWith('alert:triggered', expect.any(Function));
      expect(mockOnAlertEvent).toHaveBeenCalledWith('alert:snapshot', expect.any(Function));
    });
  });

  describe('showToast helper', () => {
    it('should call onToast callback', () => {
      const { result } = renderHook(() =>
        useAlertRules({
          apiBase: 'http://localhost:8000',
          wsRequest: mockWsRequest,
          wsConnected: true,
          onToast: mockOnToast,
        })
      );

      act(() => {
        result.current.showToast('Test message', 'info');
      });

      expect(mockOnToast).toHaveBeenCalledWith('Test message', 'info');
    });

    it('should not throw when onToast is not provided', () => {
      const { result } = renderHook(() =>
        useAlertRules({
          apiBase: 'http://localhost:8000',
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      expect(() => {
        act(() => {
          result.current.showToast('Test message', 'info');
        });
      }).not.toThrow();
    });
  });
});
