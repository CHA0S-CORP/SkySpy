import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCannonballAPI } from './useCannonballAPI';

// Mock the socket hook
vi.mock('./socket', () => ({
  useSocketIOCannonball: vi.fn(() => ({
    threats: [],
    threatCount: 0,
    connected: true,
    connecting: false,
    sessionId: 'test-session-123',
    error: null,
    lastUpdate: null,
    updatePosition: vi.fn().mockReturnValue({ ok: true }),
    setThreatRadius: vi.fn(),
    requestThreats: vi.fn(),
    request: vi.fn().mockResolvedValue({ success: true }),
    reconnect: vi.fn(),
  })),
}));

import { useSocketIOCannonball } from './socket';

describe('useCannonballAPI', () => {
  let mockSocketHook;

  beforeEach(() => {
    mockSocketHook = {
      threats: [],
      threatCount: 0,
      connected: true,
      connecting: false,
      sessionId: 'test-session-123',
      error: null,
      lastUpdate: null,
      updatePosition: vi.fn().mockReturnValue({ ok: true }),
      setThreatRadius: vi.fn(),
      requestThreats: vi.fn(),
      request: vi.fn().mockResolvedValue({ success: true }),
      reconnect: vi.fn(),
    };

    vi.mocked(useSocketIOCannonball).mockReturnValue(mockSocketHook);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with default values', () => {
      const { result } = renderHook(() => useCannonballAPI());

      expect(result.current.sessions).toEqual([]);
      expect(result.current.patterns).toEqual([]);
      expect(result.current.alerts).toEqual([]);
      expect(result.current.stats).toBeNull();
    });

    it('should pass options to socket hook', () => {
      renderHook(() =>
        useCannonballAPI({
          apiBase: 'http://localhost:8000',
          enabled: true,
          threatRadius: 30,
        })
      );

      expect(useSocketIOCannonball).toHaveBeenCalledWith({
        enabled: true,
        apiBase: 'http://localhost:8000',
        threatRadius: 30,
      });
    });

    it('should expose connection state from socket hook', () => {
      const { result } = renderHook(() => useCannonballAPI());

      expect(result.current.connected).toBe(true);
      expect(result.current.connecting).toBe(false);
      expect(result.current.sessionId).toBe('test-session-123');
    });
  });

  describe('updateLocation', () => {
    it('should send location update via socket when connected', () => {
      const { result } = renderHook(() => useCannonballAPI());

      const response = result.current.updateLocation(37.7749, -122.4194, 90, 50);

      expect(mockSocketHook.updatePosition).toHaveBeenCalledWith(37.7749, -122.4194, 90, 50);
      expect(response).toEqual({ ok: true });
    });

    it('should return error when not connected', () => {
      mockSocketHook.connected = false;
      vi.mocked(useSocketIOCannonball).mockReturnValue(mockSocketHook);

      const { result } = renderHook(() => useCannonballAPI());

      const response = result.current.updateLocation(37.7749, -122.4194);

      expect(response).toEqual({ ok: false, error: 'Not connected' });
      expect(mockSocketHook.updatePosition).not.toHaveBeenCalled();
    });

    it('should handle null heading and speed', () => {
      const { result } = renderHook(() => useCannonballAPI());

      result.current.updateLocation(37.7749, -122.4194);

      expect(mockSocketHook.updatePosition).toHaveBeenCalledWith(37.7749, -122.4194, null, null);
    });
  });

  describe('setThreatRadius', () => {
    it('should set threat radius via socket when connected', () => {
      const { result } = renderHook(() => useCannonballAPI());

      result.current.setThreatRadius(50);

      expect(mockSocketHook.setThreatRadius).toHaveBeenCalledWith(50);
    });

    it('should not call socket when not connected', () => {
      mockSocketHook.connected = false;
      vi.mocked(useSocketIOCannonball).mockReturnValue(mockSocketHook);

      const { result } = renderHook(() => useCannonballAPI());

      result.current.setThreatRadius(50);

      expect(mockSocketHook.setThreatRadius).not.toHaveBeenCalled();
    });
  });

  describe('requestThreats', () => {
    it('should request threats via socket when connected', () => {
      const { result } = renderHook(() => useCannonballAPI());

      result.current.requestThreats();

      expect(mockSocketHook.requestThreats).toHaveBeenCalled();
    });

    it('should not call socket when not connected', () => {
      mockSocketHook.connected = false;
      vi.mocked(useSocketIOCannonball).mockReturnValue(mockSocketHook);

      const { result } = renderHook(() => useCannonballAPI());

      result.current.requestThreats();

      expect(mockSocketHook.requestThreats).not.toHaveBeenCalled();
    });
  });

  describe('fetchSessions', () => {
    it('should fetch sessions and update state', async () => {
      mockSocketHook.request.mockResolvedValue({
        sessions: [
          { id: 1, active: true },
          { id: 2, active: false },
        ],
      });

      const { result } = renderHook(() => useCannonballAPI());

      let response;
      await act(async () => {
        response = await result.current.fetchSessions();
      });

      expect(mockSocketHook.request).toHaveBeenCalledWith('sessions', { active_only: true });
      expect(result.current.sessions).toEqual([
        { id: 1, active: true },
        { id: 2, active: false },
      ]);
      expect(response.sessions).toBeDefined();
    });

    it('should fetch all sessions when activeOnly is false', async () => {
      mockSocketHook.request.mockResolvedValue({ sessions: [] });

      const { result } = renderHook(() => useCannonballAPI());

      await act(async () => {
        await result.current.fetchSessions(false);
      });

      expect(mockSocketHook.request).toHaveBeenCalledWith('sessions', { active_only: false });
    });

    it('should return error when not connected', async () => {
      mockSocketHook.connected = false;
      vi.mocked(useSocketIOCannonball).mockReturnValue(mockSocketHook);

      const { result } = renderHook(() => useCannonballAPI());

      let response;
      await act(async () => {
        response = await result.current.fetchSessions();
      });

      expect(response).toEqual({ error: 'Not connected' });
    });

    it('should handle fetch error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockSocketHook.request.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useCannonballAPI());

      let response;
      await act(async () => {
        response = await result.current.fetchSessions();
      });

      expect(response).toEqual({ error: 'Network error' });
      consoleSpy.mockRestore();
    });
  });

  describe('fetchPatterns', () => {
    it('should fetch patterns and update state', async () => {
      mockSocketHook.request.mockResolvedValue({
        patterns: [
          { id: 1, type: 'circling' },
          { id: 2, type: 'loitering' },
        ],
      });

      const { result } = renderHook(() => useCannonballAPI());

      let response;
      await act(async () => {
        response = await result.current.fetchPatterns(48);
      });

      expect(mockSocketHook.request).toHaveBeenCalledWith('patterns', { hours: 48 });
      expect(result.current.patterns).toEqual([
        { id: 1, type: 'circling' },
        { id: 2, type: 'loitering' },
      ]);
    });

    it('should use default hours parameter', async () => {
      mockSocketHook.request.mockResolvedValue({ patterns: [] });

      const { result } = renderHook(() => useCannonballAPI());

      await act(async () => {
        await result.current.fetchPatterns();
      });

      expect(mockSocketHook.request).toHaveBeenCalledWith('patterns', { hours: 24 });
    });
  });

  describe('fetchAlerts', () => {
    it('should fetch alerts and update state', async () => {
      mockSocketHook.request.mockResolvedValue({
        alerts: [
          { id: 1, acknowledged: false },
          { id: 2, acknowledged: true },
        ],
      });

      const { result } = renderHook(() => useCannonballAPI());

      await act(async () => {
        await result.current.fetchAlerts();
      });

      expect(mockSocketHook.request).toHaveBeenCalledWith('alerts', { unacknowledged: false });
      expect(result.current.alerts).toEqual([
        { id: 1, acknowledged: false },
        { id: 2, acknowledged: true },
      ]);
    });

    it('should fetch only unacknowledged alerts when specified', async () => {
      mockSocketHook.request.mockResolvedValue({ alerts: [] });

      const { result } = renderHook(() => useCannonballAPI());

      await act(async () => {
        await result.current.fetchAlerts(true);
      });

      expect(mockSocketHook.request).toHaveBeenCalledWith('alerts', { unacknowledged: true });
    });
  });

  describe('acknowledgeAlert', () => {
    it('should acknowledge single alert and update state', async () => {
      mockSocketHook.request.mockResolvedValue({ success: true });

      const { result } = renderHook(() => useCannonballAPI());

      // First set up some alerts
      mockSocketHook.request.mockResolvedValueOnce({
        alerts: [
          { id: 1, acknowledged: false },
          { id: 2, acknowledged: false },
        ],
      });

      await act(async () => {
        await result.current.fetchAlerts();
      });

      // Now acknowledge one
      mockSocketHook.request.mockResolvedValueOnce({ success: true });

      let response;
      await act(async () => {
        response = await result.current.acknowledgeAlert(1);
      });

      expect(mockSocketHook.request).toHaveBeenCalledWith('alert-acknowledge', { id: 1 });
      expect(response).toEqual({ ok: true });
      expect(result.current.alerts[0].acknowledged).toBe(true);
      expect(result.current.alerts[1].acknowledged).toBe(false);
    });

    it('should return error when not connected', async () => {
      mockSocketHook.connected = false;
      vi.mocked(useSocketIOCannonball).mockReturnValue(mockSocketHook);

      const { result } = renderHook(() => useCannonballAPI());

      let response;
      await act(async () => {
        response = await result.current.acknowledgeAlert(1);
      });

      expect(response).toEqual({ ok: false, error: 'Not connected' });
    });
  });

  describe('acknowledgeAllAlerts', () => {
    it('should acknowledge all alerts and update state', async () => {
      const { result } = renderHook(() => useCannonballAPI());

      // First set up some alerts
      mockSocketHook.request.mockResolvedValueOnce({
        alerts: [
          { id: 1, acknowledged: false },
          { id: 2, acknowledged: false },
        ],
      });

      await act(async () => {
        await result.current.fetchAlerts();
      });

      // Now acknowledge all
      mockSocketHook.request.mockResolvedValueOnce({ success: true });

      let response;
      await act(async () => {
        response = await result.current.acknowledgeAllAlerts();
      });

      expect(mockSocketHook.request).toHaveBeenCalledWith('alert-acknowledge-all', {});
      expect(response).toEqual({ ok: true });
      expect(result.current.alerts.every((a) => a.acknowledged)).toBe(true);
    });
  });

  describe('fetchStats', () => {
    it('should fetch stats and update state', async () => {
      const mockStats = {
        totalSessions: 10,
        totalThreats: 50,
        averageRadius: 25,
      };
      mockSocketHook.request.mockResolvedValue(mockStats);

      const { result } = renderHook(() => useCannonballAPI());

      let response;
      await act(async () => {
        response = await result.current.fetchStats();
      });

      expect(mockSocketHook.request).toHaveBeenCalledWith('stats-summary', {});
      expect(result.current.stats).toEqual(mockStats);
      expect(response).toEqual(mockStats);
    });
  });

  describe('checkKnownAircraft', () => {
    it('should check if aircraft is known', async () => {
      mockSocketHook.request.mockResolvedValue({
        known: true,
        agency: 'FAA',
        type: 'helicopter',
      });

      const { result } = renderHook(() => useCannonballAPI());

      let response;
      await act(async () => {
        response = await result.current.checkKnownAircraft('ABC123');
      });

      expect(mockSocketHook.request).toHaveBeenCalledWith('known-aircraft-check', {
        icao_hex: 'ABC123',
      });
      expect(response).toEqual({
        known: true,
        agency: 'FAA',
        type: 'helicopter',
      });
    });

    it('should return null when not connected', async () => {
      mockSocketHook.connected = false;
      vi.mocked(useSocketIOCannonball).mockReturnValue(mockSocketHook);

      const { result } = renderHook(() => useCannonballAPI());

      let response;
      await act(async () => {
        response = await result.current.checkKnownAircraft('ABC123');
      });

      expect(response).toBeNull();
    });
  });

  describe('activate/deactivate', () => {
    it('should return connected status on activate', async () => {
      const { result } = renderHook(() => useCannonballAPI());

      let response;
      await act(async () => {
        response = await result.current.activate();
      });

      expect(response).toEqual({
        ok: true,
        data: { session_id: 'test-session-123' },
      });
    });

    it('should return ok on deactivate', async () => {
      const { result } = renderHook(() => useCannonballAPI());

      let response;
      await act(async () => {
        response = await result.current.deactivate();
      });

      expect(response).toEqual({ ok: true });
    });
  });

  describe('reconnect', () => {
    it('should expose reconnect function from socket hook', () => {
      const { result } = renderHook(() => useCannonballAPI());

      result.current.reconnect();

      expect(mockSocketHook.reconnect).toHaveBeenCalled();
    });
  });

  describe('threat data pass-through', () => {
    it('should pass through threat data from socket hook', () => {
      mockSocketHook.threats = [
        { id: 1, hex: 'ABC123', distance: 5 },
        { id: 2, hex: 'DEF456', distance: 10 },
      ];
      mockSocketHook.threatCount = 2;
      mockSocketHook.lastUpdate = '2024-01-01T00:00:00Z';
      vi.mocked(useSocketIOCannonball).mockReturnValue(mockSocketHook);

      const { result } = renderHook(() => useCannonballAPI());

      expect(result.current.threats).toEqual([
        { id: 1, hex: 'ABC123', distance: 5 },
        { id: 2, hex: 'DEF456', distance: 10 },
      ]);
      expect(result.current.threatCount).toBe(2);
      expect(result.current.lastUpdate).toBe('2024-01-01T00:00:00Z');
    });
  });
});
