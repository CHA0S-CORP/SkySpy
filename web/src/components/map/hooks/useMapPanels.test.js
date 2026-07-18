import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMapPanels } from './useMapPanels';

// The global setup.js localStorage mock does not store values; use a real store
const createLocalStorageMock = () => {
  let store = {};
  return {
    getItem: vi.fn((key) => store[key] ?? null),
    setItem: vi.fn((key, value) => {
      store[key] = String(value);
    }),
    removeItem: vi.fn((key) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
};

describe('useMapPanels', () => {
  let originalLocalStorage;

  beforeEach(() => {
    originalLocalStorage = global.localStorage;
    global.localStorage = createLocalStorageMock();
  });

  afterEach(() => {
    global.localStorage = originalLocalStorage;
  });

  it('persists showAircraftList when set with a boolean', () => {
    const { result } = renderHook(() => useMapPanels());

    act(() => {
      result.current.setShowAircraftList(true);
    });

    expect(result.current.showAircraftList).toBe(true);
    expect(localStorage.getItem('adsb-show-aircraft-list')).toBe('true');
  });

  it('persists the resolved value when togglePanel uses a functional updater', () => {
    const { result } = renderHook(() => useMapPanels());

    act(() => {
      result.current.togglePanel('aircraftList');
    });

    expect(result.current.showAircraftList).toBe(true);
    // Must store 'true'/'false', not a stringified updater function
    expect(localStorage.getItem('adsb-show-aircraft-list')).toBe('true');

    act(() => {
      result.current.togglePanel('aircraftList');
    });

    expect(result.current.showAircraftList).toBe(false);
    expect(localStorage.getItem('adsb-show-aircraft-list')).toBe('false');
  });

  it('restores persisted showAircraftList after toggling', () => {
    const first = renderHook(() => useMapPanels());
    act(() => {
      first.result.current.togglePanel('aircraftList');
    });
    first.unmount();

    const second = renderHook(() => useMapPanels());
    expect(second.result.current.showAircraftList).toBe(true);
  });

  it('supports functional updaters for setListExpanded', () => {
    const { result } = renderHook(() => useMapPanels());

    act(() => {
      result.current.setListExpanded((prev) => !prev);
    });

    // Default is true, so toggling yields false
    expect(result.current.listExpanded).toBe(false);
    expect(localStorage.getItem('adsb-list-expanded')).toBe('false');
  });
});
