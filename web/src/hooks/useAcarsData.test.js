import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAcarsData } from './useAcarsData';

// Mock the historyConstants module
vi.mock('../components/history/historyConstants', () => ({
  ACARS_QUICK_FILTER_CATEGORIES: {
    position: { name: 'Position', labels: ['C1', 'SQ', '47'] },
    weather: { name: 'Weather', labels: ['15', '30', '31'] },
    oooi: { name: 'OOOI', labels: ['10', '11', '12', '13'] },
  },
  getAcarsLabelDescription: vi.fn((label) => `Description for ${label}`),
  safeJson: vi.fn(async (res) => {
    if (!res.ok) return null;
    try {
      return await res.json();
    } catch {
      return null;
    }
  }),
}));

describe('useAcarsData', () => {
  let mockFetch;
  let mockWsRequest;
  let mockLocalStorage;

  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    mockWsRequest = vi.fn();

    // Mock localStorage with fresh object each time
    mockLocalStorage = {};
    const localStorageMock = {
      getItem: vi.fn((key) => mockLocalStorage[key] ?? null),
      setItem: vi.fn((key, value) => {
        mockLocalStorage[key] = value;
      }),
      removeItem: vi.fn((key) => {
        delete mockLocalStorage[key];
      }),
      clear: vi.fn(() => {
        mockLocalStorage = {};
      }),
    };
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const defaultProps = {
    apiBase: 'http://localhost:8000',
    timeRange: '24h',
    wsRequest: null,
    wsConnected: false,
    viewType: 'acars',
  };

  describe('initial state', () => {
    it('should initialize with default values', () => {
      const { result } = renderHook(() => useAcarsData(defaultProps));

      expect(result.current.acarsSearch).toBe('');
      expect(result.current.acarsSource).toBe('all');
      expect(result.current.acarsHideEmpty).toBe(true);
      expect(result.current.acarsMessages).toEqual([]);
      expect(result.current.acarsSelectedLabels).toEqual([]);
      expect(result.current.acarsAirlineFilter).toBe('');
      expect(result.current.showLabelDropdown).toBe(false);
      expect(result.current.acarsCompactMode).toBe(false);
      expect(result.current.acarsQuickFilters).toEqual([]);
    });

    it('should load compact mode from localStorage', () => {
      window.localStorage.getItem.mockImplementation((key) => {
        if (key === 'acars-compact-mode') return 'true';
        return null;
      });

      const { result } = renderHook(() => useAcarsData(defaultProps));

      expect(result.current.acarsCompactMode).toBe(true);
    });

    it('should load quick filters from localStorage', () => {
      window.localStorage.getItem.mockImplementation((key) => {
        if (key === 'acars-quick-filters') return '["position", "weather"]';
        return null;
      });

      const { result } = renderHook(() => useAcarsData(defaultProps));

      expect(result.current.acarsQuickFilters).toEqual(['position', 'weather']);
    });
  });

  describe('ACARS message fetching', () => {
    it('should not fetch when viewType is not acars', async () => {
      vi.useRealTimers();

      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ messages: [] }),
      });

      renderHook(() => useAcarsData({ ...defaultProps, viewType: 'sessions' }));

      await new Promise((r) => setTimeout(r, 100));
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/acars'),
        expect.anything()
      );
    });

    it('should fetch ACARS messages via HTTP when viewType is acars', async () => {
      vi.useRealTimers();

      const mockMessages = [
        { id: 1, callsign: 'UAL123', text: 'Test message', label: 'H1' },
        { id: 2, callsign: 'DAL456', text: 'Another message', label: '10' },
      ];

      mockFetch.mockImplementation((url) => {
        if (url.includes('/labels')) {
          return Promise.resolve({
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: () => Promise.resolve({ labels: {} }),
          });
        }
        if (url.includes('/sightings')) {
          return Promise.resolve({
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: () => Promise.resolve({ sightings: [] }),
          });
        }
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ messages: mockMessages }),
        });
      });

      const { result } = renderHook(() => useAcarsData(defaultProps));

      await waitFor(() => {
        expect(result.current.acarsMessages).toEqual(mockMessages);
      });

      // Check that at least one call was to the acars endpoint (not labels)
      const acarsCall = mockFetch.mock.calls.find(
        (call) => call[0].includes('/api/v1/acars') && !call[0].includes('/labels')
      );
      expect(acarsCall).toBeDefined();
    });

    it('resolves message registration to icao_hex via the airframes endpoint', async () => {
      // Regression: the sightings API has no registration filter, so looking up
      // a registration there returned an arbitrary aircraft (wrong link). Must
      // use /airframes/registration/<reg>/ like the App.jsx tail lookup.
      vi.useRealTimers();

      mockFetch.mockImplementation((url) => {
        if (url.includes('/airframes/registration/')) {
          return Promise.resolve({
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: () => Promise.resolve({ icao_hex: 'ABCDEF', registration: 'N12345' }),
          });
        }
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ messages: [{ id: 1, registration: 'N12345' }] }),
        });
      });

      const { result } = renderHook(() => useAcarsData(defaultProps));

      await waitFor(() => {
        expect(result.current.regHexCache.N12345).toBe('ABCDEF');
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/v1/airframes/registration/N12345/'
      );
      // Must NOT resolve registration through the sightings API.
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('sightings?registration=')
      );
    });

    it('should fetch messages over HTTP even when WebSocket is connected', async () => {
      // Regression: there is no WS 'acars-messages' request type, and it does
      // not honour source/airline/label filters, so message fetching must use
      // HTTP (with filters) regardless of socket state — never a dead WS type.
      vi.useRealTimers();

      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ messages: [{ id: 1, text: 'HTTP message' }] }),
      });

      const { result } = renderHook(() =>
        useAcarsData({
          ...defaultProps,
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      await waitFor(() => {
        expect(result.current.acarsMessages.length).toBe(1);
      });

      expect(mockWsRequest).not.toHaveBeenCalledWith('acars-messages', expect.anything());
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/acars?'),
        expect.any(Object)
      );
    });

    it('should include source filter in query', async () => {
      vi.useRealTimers();

      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ messages: [] }),
      });

      const { result, rerender } = renderHook((props) => useAcarsData(props), {
        initialProps: defaultProps,
      });

      act(() => {
        result.current.setAcarsSource('vdl2');
      });

      rerender({ ...defaultProps });

      await waitFor(() => {
        const fetchCall = mockFetch.mock.calls.find((call) => call[0].includes('source=vdl2'));
        expect(fetchCall).toBeDefined();
      });
    });
  });

  describe('filtering', () => {
    const mockMessages = [
      { id: 1, callsign: 'UAL123', text: 'Test message', label: 'H1', icao_hex: 'ABC123' },
      { id: 2, callsign: 'DAL456', text: '', label: '10', icao_hex: 'DEF456' },
      { id: 3, callsign: 'SWA789', text: 'Weather report', label: '30', icao_hex: 'GHI789' },
      { id: 4, callsign: 'AAL111', text: 'Position', label: 'C1', icao_hex: 'JKL111' },
    ];

    it('should filter empty messages when acarsHideEmpty is true', async () => {
      vi.useRealTimers();

      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ messages: mockMessages }),
      });

      const { result } = renderHook(() => useAcarsData(defaultProps));

      await waitFor(() => {
        expect(result.current.acarsMessages.length).toBe(4);
      });

      // By default, acarsHideEmpty is true
      expect(result.current.filteredAcarsMessages.length).toBe(3);
      expect(result.current.filteredAcarsMessages.find((m) => m.id === 2)).toBeUndefined();
    });

    it('should include empty messages when acarsHideEmpty is false', async () => {
      vi.useRealTimers();

      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ messages: mockMessages }),
      });

      const { result } = renderHook(() => useAcarsData(defaultProps));

      await waitFor(() => {
        expect(result.current.acarsMessages.length).toBe(4);
      });

      act(() => {
        result.current.setAcarsHideEmpty(false);
      });

      expect(result.current.filteredAcarsMessages.length).toBe(4);
    });

    it('should filter by search term', async () => {
      vi.useRealTimers();

      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ messages: mockMessages }),
      });

      const { result } = renderHook(() => useAcarsData(defaultProps));

      await waitFor(() => {
        expect(result.current.acarsMessages.length).toBe(4);
      });

      act(() => {
        result.current.setAcarsSearch('UAL');
      });

      expect(result.current.filteredAcarsMessages.length).toBe(1);
      expect(result.current.filteredAcarsMessages[0].callsign).toBe('UAL123');
    });

    it('should filter by quick filter categories', async () => {
      vi.useRealTimers();

      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ messages: mockMessages }),
      });

      const { result } = renderHook(() => useAcarsData(defaultProps));

      await waitFor(() => {
        expect(result.current.acarsMessages.length).toBe(4);
      });

      act(() => {
        result.current.toggleQuickFilter('position');
      });

      // Only C1 label should match position category
      const filtered = result.current.filteredAcarsMessages;
      expect(filtered.length).toBe(1);
      expect(filtered[0].label).toBe('C1');
    });
  });

  describe('quick filter actions', () => {
    it('should toggle quick filter on and off', () => {
      const { result } = renderHook(() => useAcarsData(defaultProps));

      act(() => {
        result.current.toggleQuickFilter('position');
      });

      expect(result.current.acarsQuickFilters).toContain('position');

      act(() => {
        result.current.toggleQuickFilter('position');
      });

      expect(result.current.acarsQuickFilters).not.toContain('position');
    });

    it('should clear all quick filters', () => {
      const { result } = renderHook(() => useAcarsData(defaultProps));

      act(() => {
        result.current.toggleQuickFilter('position');
        result.current.toggleQuickFilter('weather');
      });

      expect(result.current.acarsQuickFilters).toHaveLength(2);

      act(() => {
        result.current.clearQuickFilters();
      });

      expect(result.current.acarsQuickFilters).toHaveLength(0);
    });

    it('should persist quick filters to localStorage', async () => {
      vi.useRealTimers();

      const { result } = renderHook(() => useAcarsData(defaultProps));

      act(() => {
        result.current.toggleQuickFilter('position');
      });

      await waitFor(() => {
        expect(window.localStorage.setItem).toHaveBeenCalledWith(
          'acars-quick-filters',
          '["position"]'
        );
      });
    });
  });

  describe('message expansion', () => {
    it('should toggle individual message expansion', () => {
      const { result } = renderHook(() => useAcarsData(defaultProps));

      act(() => {
        result.current.toggleMessageExpansion('msg-1');
      });

      expect(result.current.expandedMessages['msg-1']).toBe(true);

      act(() => {
        result.current.toggleMessageExpansion('msg-1');
      });

      expect(result.current.expandedMessages['msg-1']).toBe(false);
    });

    it('should toggle all messages expansion', () => {
      const { result } = renderHook(() => useAcarsData(defaultProps));

      expect(result.current.allMessagesExpanded).toBe(false);

      act(() => {
        result.current.toggleAllMessages();
      });

      expect(result.current.allMessagesExpanded).toBe(true);
      expect(result.current.expandedMessages).toEqual({});
    });
  });

  describe('compact mode', () => {
    it('should toggle compact mode', () => {
      const { result } = renderHook(() => useAcarsData(defaultProps));

      expect(result.current.acarsCompactMode).toBe(false);

      act(() => {
        result.current.setAcarsCompactMode(true);
      });

      expect(result.current.acarsCompactMode).toBe(true);
    });

    it('should persist compact mode to localStorage', async () => {
      vi.useRealTimers();

      const { result } = renderHook(() => useAcarsData(defaultProps));

      act(() => {
        result.current.setAcarsCompactMode(true);
      });

      await waitFor(() => {
        expect(window.localStorage.setItem).toHaveBeenCalledWith('acars-compact-mode', 'true');
      });
    });
  });

  describe('available labels', () => {
    it('should compute available labels from messages', async () => {
      vi.useRealTimers();

      const mockMessages = [
        { id: 1, label: 'H1' },
        { id: 2, label: 'H1' },
        { id: 3, label: '10' },
        { id: 4, label: 'C1' },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ messages: mockMessages }),
      });

      const { result } = renderHook(() => useAcarsData(defaultProps));

      await waitFor(() => {
        expect(result.current.acarsMessages.length).toBe(4);
      });

      expect(result.current.availableLabels).toHaveLength(3);
      // H1 should be first since it appears most frequently
      expect(result.current.availableLabels[0].label).toBe('H1');
      expect(result.current.availableLabels[0].count).toBe(2);
    });
  });

  describe('scroll handling', () => {
    it('should increase visible count on scroll near bottom', () => {
      const { result } = renderHook(() => useAcarsData(defaultProps));

      expect(result.current.visibleAcarsCount).toBe(50);

      act(() => {
        result.current.handleAcarsScroll({
          target: {
            scrollTop: 800,
            scrollHeight: 1000,
            clientHeight: 200,
          },
        });
      });

      expect(result.current.visibleAcarsCount).toBe(100);
    });

    it('should not increase visible count when not near bottom', () => {
      const { result } = renderHook(() => useAcarsData(defaultProps));

      expect(result.current.visibleAcarsCount).toBe(50);

      act(() => {
        result.current.handleAcarsScroll({
          target: {
            scrollTop: 0,
            scrollHeight: 1000,
            clientHeight: 200,
          },
        });
      });

      expect(result.current.visibleAcarsCount).toBe(50);
    });

    it('should reset visible count when filters change', async () => {
      vi.useRealTimers();

      const { result } = renderHook(() => useAcarsData(defaultProps));

      // Increase visible count
      act(() => {
        result.current.handleAcarsScroll({
          target: { scrollTop: 800, scrollHeight: 1000, clientHeight: 200 },
        });
      });

      expect(result.current.visibleAcarsCount).toBe(100);

      // Change filter
      act(() => {
        result.current.setAcarsSearch('test');
      });

      expect(result.current.visibleAcarsCount).toBe(50);
    });
  });

  describe('label reference fetching', () => {
    it('should fetch label reference on mount', async () => {
      vi.useRealTimers();

      mockFetch.mockImplementation((url) => {
        if (url.includes('/labels')) {
          return Promise.resolve({
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: () => Promise.resolve({ labels: { H1: { name: 'Departure' } } }),
          });
        }
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ messages: [] }),
        });
      });

      const { result } = renderHook(() => useAcarsData(defaultProps));

      await waitFor(() => {
        expect(result.current.labelReference).toEqual({ H1: { name: 'Departure' } });
      });
    });
  });
});
