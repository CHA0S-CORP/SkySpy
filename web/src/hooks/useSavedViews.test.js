import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSavedViews } from './useSavedViews';

describe('useSavedViews', () => {
  let localStorageMock;

  beforeEach(() => {
    // Mock localStorage
    localStorageMock = {
      store: {},
      getItem: vi.fn((key) => localStorageMock.store[key] || null),
      setItem: vi.fn((key, value) => {
        localStorageMock.store[key] = value;
      }),
      removeItem: vi.fn((key) => {
        delete localStorageMock.store[key];
      }),
      clear: vi.fn(() => {
        localStorageMock.store = {};
      }),
    };
    Object.defineProperty(window, 'localStorage', { value: localStorageMock });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with empty array when no stored data', () => {
      const { result } = renderHook(() => useSavedViews());
      expect(result.current.savedViews).toEqual([]);
    });

    it('should load saved views from localStorage', () => {
      const storedViews = [
        { id: '1', name: 'Test View', filters: {} },
      ];
      localStorageMock.store['skyspy_saved_views_history'] = JSON.stringify(storedViews);

      const { result } = renderHook(() => useSavedViews('history'));
      expect(result.current.savedViews).toEqual(storedViews);
    });

    it('should handle invalid JSON in localStorage', () => {
      localStorageMock.store['skyspy_saved_views_history'] = 'invalid json';
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useSavedViews('history'));
      expect(result.current.savedViews).toEqual([]);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle non-array stored data', () => {
      localStorageMock.store['skyspy_saved_views_history'] = JSON.stringify({ notAnArray: true });

      const { result } = renderHook(() => useSavedViews('history'));
      expect(result.current.savedViews).toEqual([]);
    });

    it('should use namespace in storage key', () => {
      renderHook(() => useSavedViews('custom'));
      expect(localStorageMock.getItem).toHaveBeenCalledWith('skyspy_saved_views_custom');
    });
  });

  describe('saveView', () => {
    it('should add a new view', () => {
      const { result } = renderHook(() => useSavedViews());

      act(() => {
        result.current.saveView({ name: 'New View', filters: { search: 'test' } });
      });

      expect(result.current.savedViews).toHaveLength(1);
      expect(result.current.savedViews[0].name).toBe('New View');
      expect(result.current.savedViews[0].filters).toEqual({ search: 'test' });
    });

    it('should generate id for new view', () => {
      const { result } = renderHook(() => useSavedViews());

      act(() => {
        result.current.saveView({ name: 'New View', filters: {} });
      });

      expect(result.current.savedViews[0].id).toBeDefined();
    });

    it('should add createdAt timestamp', () => {
      const { result } = renderHook(() => useSavedViews());

      act(() => {
        result.current.saveView({ name: 'New View', filters: {} });
      });

      expect(result.current.savedViews[0].createdAt).toBeDefined();
    });

    it('should update existing view with same name', () => {
      const { result } = renderHook(() => useSavedViews());

      act(() => {
        result.current.saveView({ name: 'My View', filters: { search: 'first' } });
      });

      act(() => {
        result.current.saveView({ name: 'My View', filters: { search: 'second' } });
      });

      expect(result.current.savedViews).toHaveLength(1);
      expect(result.current.savedViews[0].filters.search).toBe('second');
    });

    it('should add updatedAt when updating existing view', () => {
      const { result } = renderHook(() => useSavedViews());

      act(() => {
        result.current.saveView({ name: 'My View', filters: {}, createdAt: '2024-01-01T00:00:00Z' });
      });

      act(() => {
        result.current.saveView({ name: 'My View', filters: { updated: true } });
      });

      expect(result.current.savedViews[0].updatedAt).toBeDefined();
    });

    it('should preserve existing id when updating', () => {
      const { result } = renderHook(() => useSavedViews());

      act(() => {
        result.current.saveView({ name: 'My View', filters: {} });
      });

      const originalId = result.current.savedViews[0].id;

      act(() => {
        result.current.saveView({ name: 'My View', filters: { updated: true } });
      });

      expect(result.current.savedViews[0].id).toBe(originalId);
    });

    it('should persist to localStorage', () => {
      const { result } = renderHook(() => useSavedViews('history'));

      act(() => {
        result.current.saveView({ name: 'New View', filters: {} });
      });

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'skyspy_saved_views_history',
        expect.any(String)
      );
    });
  });

  describe('deleteView', () => {
    it('should remove view by id', () => {
      const storedViews = [
        { id: '1', name: 'View 1', filters: {} },
        { id: '2', name: 'View 2', filters: {} },
      ];
      localStorageMock.store['skyspy_saved_views_history'] = JSON.stringify(storedViews);

      const { result } = renderHook(() => useSavedViews('history'));

      act(() => {
        result.current.deleteView('1');
      });

      expect(result.current.savedViews).toHaveLength(1);
      expect(result.current.savedViews[0].id).toBe('2');
    });

    it('should do nothing if id not found', () => {
      const storedViews = [{ id: '1', name: 'View 1', filters: {} }];
      localStorageMock.store['skyspy_saved_views_history'] = JSON.stringify(storedViews);

      const { result } = renderHook(() => useSavedViews('history'));

      act(() => {
        result.current.deleteView('999');
      });

      expect(result.current.savedViews).toHaveLength(1);
    });
  });

  describe('getView', () => {
    it('should return view by id', () => {
      const storedViews = [
        { id: '1', name: 'View 1', filters: { search: 'test' } },
        { id: '2', name: 'View 2', filters: {} },
      ];
      localStorageMock.store['skyspy_saved_views_history'] = JSON.stringify(storedViews);

      const { result } = renderHook(() => useSavedViews('history'));

      const view = result.current.getView('1');
      expect(view).toEqual(storedViews[0]);
    });

    it('should return undefined for non-existent id', () => {
      const { result } = renderHook(() => useSavedViews());

      const view = result.current.getView('999');
      expect(view).toBeUndefined();
    });
  });

  describe('renameView', () => {
    it('should rename view by id', () => {
      const storedViews = [{ id: '1', name: 'Old Name', filters: {} }];
      localStorageMock.store['skyspy_saved_views_history'] = JSON.stringify(storedViews);

      const { result } = renderHook(() => useSavedViews('history'));

      act(() => {
        result.current.renameView('1', 'New Name');
      });

      expect(result.current.savedViews[0].name).toBe('New Name');
    });

    it('should add updatedAt when renaming', () => {
      const storedViews = [{ id: '1', name: 'Old Name', filters: {} }];
      localStorageMock.store['skyspy_saved_views_history'] = JSON.stringify(storedViews);

      const { result } = renderHook(() => useSavedViews('history'));

      act(() => {
        result.current.renameView('1', 'New Name');
      });

      expect(result.current.savedViews[0].updatedAt).toBeDefined();
    });

    it('should not modify other views', () => {
      const storedViews = [
        { id: '1', name: 'View 1', filters: {} },
        { id: '2', name: 'View 2', filters: {} },
      ];
      localStorageMock.store['skyspy_saved_views_history'] = JSON.stringify(storedViews);

      const { result } = renderHook(() => useSavedViews('history'));

      act(() => {
        result.current.renameView('1', 'New Name');
      });

      expect(result.current.savedViews[1].name).toBe('View 2');
    });
  });

  describe('clearAllViews', () => {
    it('should remove all views', () => {
      const storedViews = [
        { id: '1', name: 'View 1', filters: {} },
        { id: '2', name: 'View 2', filters: {} },
      ];
      localStorageMock.store['skyspy_saved_views_history'] = JSON.stringify(storedViews);

      const { result } = renderHook(() => useSavedViews('history'));

      act(() => {
        result.current.clearAllViews();
      });

      expect(result.current.savedViews).toEqual([]);
    });

    it('should persist empty array to localStorage', () => {
      const storedViews = [{ id: '1', name: 'View 1', filters: {} }];
      localStorageMock.store['skyspy_saved_views_history'] = JSON.stringify(storedViews);

      const { result } = renderHook(() => useSavedViews('history'));

      act(() => {
        result.current.clearAllViews();
      });

      expect(localStorageMock.setItem).toHaveBeenLastCalledWith(
        'skyspy_saved_views_history',
        '[]'
      );
    });
  });

  describe('localStorage persistence', () => {
    it('should handle localStorage errors gracefully on load', () => {
      localStorageMock.getItem = vi.fn(() => {
        throw new Error('Storage error');
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useSavedViews());
      expect(result.current.savedViews).toEqual([]);

      consoleSpy.mockRestore();
    });

    it('should handle localStorage errors gracefully on save', () => {
      localStorageMock.setItem = vi.fn(() => {
        throw new Error('Storage error');
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useSavedViews());

      act(() => {
        result.current.saveView({ name: 'Test', filters: {} });
      });

      // Should still update state even if localStorage fails
      expect(result.current.savedViews).toHaveLength(1);

      consoleSpy.mockRestore();
    });
  });

  describe('namespace isolation', () => {
    it('should isolate views by namespace', () => {
      localStorageMock.store['skyspy_saved_views_history'] = JSON.stringify([
        { id: '1', name: 'History View', filters: {} },
      ]);
      localStorageMock.store['skyspy_saved_views_acars'] = JSON.stringify([
        { id: '2', name: 'ACARS View', filters: {} },
      ]);

      const { result: historyResult } = renderHook(() => useSavedViews('history'));
      const { result: acarsResult } = renderHook(() => useSavedViews('acars'));

      expect(historyResult.current.savedViews[0].name).toBe('History View');
      expect(acarsResult.current.savedViews[0].name).toBe('ACARS View');
    });
  });
});
