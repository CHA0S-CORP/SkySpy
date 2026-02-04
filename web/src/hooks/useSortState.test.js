import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSortState } from './useSortState';

describe('useSortState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('should use default field and direction', () => {
      const { result } = renderHook(() =>
        useSortState({
          defaultField: 'name',
          defaultDirection: 'asc',
        })
      );

      expect(result.current.sortField).toBe('name');
      expect(result.current.sortDirection).toBe('asc');
    });

    it('should default direction to desc if not specified', () => {
      const { result } = renderHook(() =>
        useSortState({
          defaultField: 'date',
        })
      );

      expect(result.current.sortDirection).toBe('desc');
    });
  });

  describe('handleSort', () => {
    it('should toggle direction when clicking same field', () => {
      const { result } = renderHook(() =>
        useSortState({
          defaultField: 'name',
          defaultDirection: 'asc',
        })
      );

      expect(result.current.sortDirection).toBe('asc');

      act(() => {
        result.current.handleSort('name');
      });

      expect(result.current.sortDirection).toBe('desc');

      act(() => {
        result.current.handleSort('name');
      });

      expect(result.current.sortDirection).toBe('asc');
    });

    it('should change field and use default direction when clicking different field', () => {
      const { result } = renderHook(() =>
        useSortState({
          defaultField: 'name',
          defaultDirection: 'asc',
          sortConfig: {
            name: { type: 'string' },
            date: { type: 'date' },
          },
        })
      );

      act(() => {
        result.current.handleSort('date');
      });

      expect(result.current.sortField).toBe('date');
      expect(result.current.sortDirection).toBe('asc');
    });

    it('should use field-specific default direction', () => {
      const { result } = renderHook(() =>
        useSortState({
          defaultField: 'name',
          defaultDirection: 'asc',
          sortConfig: {
            name: { type: 'string' },
            date: { type: 'date', defaultDirection: 'desc' },
          },
        })
      );

      act(() => {
        result.current.handleSort('date');
      });

      expect(result.current.sortField).toBe('date');
      expect(result.current.sortDirection).toBe('desc');
    });
  });

  describe('sortedData', () => {
    it('should return empty array if no data', () => {
      const { result } = renderHook(() =>
        useSortState({
          defaultField: 'name',
          data: [],
        })
      );

      expect(result.current.sortedData).toEqual([]);
    });

    it('should return original data if no sortField', () => {
      const data = [{ name: 'B' }, { name: 'A' }];
      const { result } = renderHook(() =>
        useSortState({
          defaultField: null,
          data,
        })
      );

      expect(result.current.sortedData).toEqual(data);
    });

    it('should sort strings alphabetically (asc)', () => {
      const data = [{ name: 'Charlie' }, { name: 'Alice' }, { name: 'Bob' }];
      const { result } = renderHook(() =>
        useSortState({
          defaultField: 'name',
          defaultDirection: 'asc',
          data,
          sortConfig: { name: { type: 'string' } },
        })
      );

      expect(result.current.sortedData.map((d) => d.name)).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('should sort strings alphabetically (desc)', () => {
      const data = [{ name: 'Alice' }, { name: 'Charlie' }, { name: 'Bob' }];
      const { result } = renderHook(() =>
        useSortState({
          defaultField: 'name',
          defaultDirection: 'desc',
          data,
          sortConfig: { name: { type: 'string' } },
        })
      );

      expect(result.current.sortedData.map((d) => d.name)).toEqual(['Charlie', 'Bob', 'Alice']);
    });

    it('should sort numbers correctly (asc)', () => {
      const data = [{ value: 30 }, { value: 10 }, { value: 20 }];
      const { result } = renderHook(() =>
        useSortState({
          defaultField: 'value',
          defaultDirection: 'asc',
          data,
          sortConfig: { value: { type: 'number' } },
        })
      );

      expect(result.current.sortedData.map((d) => d.value)).toEqual([10, 20, 30]);
    });

    it('should sort numbers correctly (desc)', () => {
      const data = [{ value: 10 }, { value: 30 }, { value: 20 }];
      const { result } = renderHook(() =>
        useSortState({
          defaultField: 'value',
          defaultDirection: 'desc',
          data,
          sortConfig: { value: { type: 'number' } },
        })
      );

      expect(result.current.sortedData.map((d) => d.value)).toEqual([30, 20, 10]);
    });

    it('should handle null/undefined number values', () => {
      const data = [{ value: 20 }, { value: null }, { value: 10 }];
      const { result } = renderHook(() =>
        useSortState({
          defaultField: 'value',
          defaultDirection: 'asc',
          data,
          sortConfig: { value: { type: 'number' } },
        })
      );

      expect(result.current.sortedData.map((d) => d.value)).toEqual([10, 20, null]);
    });

    it('should sort dates correctly', () => {
      const data = [
        { date: '2024-03-15' },
        { date: '2024-01-01' },
        { date: '2024-02-20' },
      ];
      const { result } = renderHook(() =>
        useSortState({
          defaultField: 'date',
          defaultDirection: 'asc',
          data,
          sortConfig: { date: { type: 'date' } },
        })
      );

      expect(result.current.sortedData.map((d) => d.date)).toEqual([
        '2024-01-01',
        '2024-02-20',
        '2024-03-15',
      ]);
    });

    it('should handle null date values', () => {
      const data = [{ date: '2024-03-15' }, { date: null }, { date: '2024-01-01' }];
      const { result } = renderHook(() =>
        useSortState({
          defaultField: 'date',
          defaultDirection: 'asc',
          data,
          sortConfig: { date: { type: 'date' } },
        })
      );

      expect(result.current.sortedData[0].date).toBeNull();
    });

    it('should use custom comparator for custom type', () => {
      const data = [{ status: 'pending' }, { status: 'active' }, { status: 'done' }];
      const statusOrder = { active: 1, pending: 2, done: 3 };
      const comparator = (a, b) => statusOrder[a] - statusOrder[b];

      const { result } = renderHook(() =>
        useSortState({
          defaultField: 'status',
          defaultDirection: 'asc',
          data,
          sortConfig: { status: { type: 'custom', comparator } },
        })
      );

      expect(result.current.sortedData.map((d) => d.status)).toEqual(['active', 'pending', 'done']);
    });

    it('should handle nested field paths', () => {
      const data = [
        { details: { distance: 30 } },
        { details: { distance: 10 } },
        { details: { distance: 20 } },
      ];
      const { result } = renderHook(() =>
        useSortState({
          defaultField: 'distance',
          defaultDirection: 'asc',
          data,
          sortConfig: { distance: { type: 'number', path: 'details.distance' } },
        })
      );

      expect(result.current.sortedData.map((d) => d.details.distance)).toEqual([10, 20, 30]);
    });

    it('should not mutate original data', () => {
      const data = [{ name: 'B' }, { name: 'A' }];
      const originalData = [...data];

      renderHook(() =>
        useSortState({
          defaultField: 'name',
          defaultDirection: 'asc',
          data,
          sortConfig: { name: { type: 'string' } },
        })
      );

      expect(data).toEqual(originalData);
    });
  });

  describe('resetSort', () => {
    it('should reset to default values', () => {
      const { result } = renderHook(() =>
        useSortState({
          defaultField: 'name',
          defaultDirection: 'asc',
          sortConfig: { name: {}, date: {} },
        })
      );

      // Change to date field (uses defaultDirection 'asc')
      act(() => {
        result.current.handleSort('date');
      });

      expect(result.current.sortField).toBe('date');
      // When switching to a new field, it uses defaultDirection
      expect(result.current.sortDirection).toBe('asc');

      // Toggle to desc
      act(() => {
        result.current.handleSort('date');
      });

      expect(result.current.sortDirection).toBe('desc');

      act(() => {
        result.current.resetSort();
      });

      expect(result.current.sortField).toBe('name');
      expect(result.current.sortDirection).toBe('asc');
    });

    it('should clear localStorage when resetting with viewKey', async () => {
      const { result } = renderHook(() =>
        useSortState({
          viewKey: 'test-view',
          defaultField: 'name',
          defaultDirection: 'asc',
          sortConfig: { name: {}, date: {} },
        })
      );

      act(() => {
        result.current.handleSort('date');
      });

      // Wait for useEffect to call localStorage.setItem
      await waitFor(() => {
        expect(localStorage.setItem).toHaveBeenCalledWith('sort-test-view-field', 'date');
      });

      act(() => {
        result.current.resetSort();
      });

      expect(localStorage.removeItem).toHaveBeenCalledWith('sort-test-view-field');
      expect(localStorage.removeItem).toHaveBeenCalledWith('sort-test-view-direction');
    });
  });

  describe('localStorage persistence', () => {
    it('should save sort state to localStorage with viewKey', async () => {
      const { result } = renderHook(() =>
        useSortState({
          viewKey: 'test-view',
          defaultField: 'name',
          defaultDirection: 'asc',
          sortConfig: { name: {}, date: {} },
        })
      );

      act(() => {
        result.current.handleSort('date');
      });

      // Wait for useEffect to call localStorage.setItem
      await waitFor(() => {
        expect(localStorage.setItem).toHaveBeenCalledWith('sort-test-view-field', 'date');
        expect(localStorage.setItem).toHaveBeenCalledWith('sort-test-view-direction', 'asc');
      });
    });

    it('should not save to localStorage when no viewKey', async () => {
      // Clear mocks to track only calls from this test
      vi.clearAllMocks();

      const { result } = renderHook(() =>
        useSortState({
          defaultField: 'name',
          sortConfig: { name: {}, date: {} },
        })
      );

      act(() => {
        result.current.handleSort('date');
      });

      // Give time for any potential useEffect to run
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should not have saved any sort keys with 'sort-' prefix
      const sortCalls = localStorage.setItem.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].startsWith('sort-')
      );
      expect(sortCalls.length).toBe(0);
    });
  });

  describe('direct setters', () => {
    it('should allow setting sort field directly', () => {
      const { result } = renderHook(() =>
        useSortState({
          defaultField: 'name',
          sortConfig: { name: {}, date: {} },
        })
      );

      act(() => {
        result.current.setSortField('date');
      });

      expect(result.current.sortField).toBe('date');
    });

    it('should allow setting sort direction directly', () => {
      const { result } = renderHook(() =>
        useSortState({
          defaultField: 'name',
          defaultDirection: 'asc',
        })
      );

      act(() => {
        result.current.setSortDirection('desc');
      });

      expect(result.current.sortDirection).toBe('desc');
    });
  });
});
