import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSocketIOData } from './useSocketIOData';

// Mock useSocketIO
const mockEmit = vi.fn(() => true);
const mockOn = vi.fn(() => vi.fn());
const mockReconnect = vi.fn();

vi.mock('./useSocketIO', () => ({
  useSocketIO: vi.fn(() => ({
    connected: false,
    connecting: false,
    error: null,
    emit: mockEmit,
    on: mockOn,
    reconnect: mockReconnect,
    isReady: false,
  })),
}));

// Mock channel processors
vi.mock('../channels', () => ({
  DEMO_AIRCRAFT: [],
  generateDemoAircraft: vi.fn(() => []),
  normalizeAircraft: vi.fn((ac) => ac),
  processAircraftSnapshot: vi.fn((data, setAircraft, setStats) => {
    if (data?.data?.aircraft) {
      const aircraftMap = {};
      data.data.aircraft.forEach((ac) => {
        aircraftMap[ac.hex] = ac;
      });
      setAircraft(aircraftMap);
      setStats({ count: data.data.aircraft.length });
    }
  }),
  processAircraftUpdate: vi.fn((data, setAircraft) => {
    if (data?.data?.aircraft) {
      setAircraft((prev) => ({
        ...prev,
        [data.data.aircraft.hex]: data.data.aircraft,
      }));
    }
  }),
  processAircraftNew: vi.fn((data, setAircraft) => {
    if (data?.data?.aircraft) {
      setAircraft((prev) => ({
        ...prev,
        [data.data.aircraft.hex]: data.data.aircraft,
      }));
    }
  }),
  processAircraftRemove: vi.fn((data, setAircraft) => {
    if (data?.data?.hex) {
      setAircraft((prev) => {
        const next = { ...prev };
        delete next[data.data.hex];
        return next;
      });
    }
  }),
  processSafetySnapshot: vi.fn((data, setSafetyEvents) => {
    if (data?.data?.events) {
      setSafetyEvents(data.data.events);
    }
  }),
  processSafetyEvent: vi.fn((data, setSafetyEvents) => {
    if (data?.data) {
      setSafetyEvents((prev) => [data.data, ...prev]);
    }
  }),
  processSafetyEventUpdated: vi.fn(),
  processSafetyEventResolved: vi.fn(),
  processAlertTriggered: vi.fn((data, setAlerts) => {
    if (data?.data) {
      setAlerts((prev) => [data.data, ...prev]);
    }
  }),
  processAlertSnapshot: vi.fn((data, setAlerts) => {
    if (data?.data?.alerts) {
      setAlerts(data.data.alerts);
    }
  }),
  processAcarsMessage: vi.fn((data, setAcarsMessages) => {
    if (data?.data) {
      setAcarsMessages((prev) => [data.data, ...prev]);
    }
  }),
  processAcarsSnapshot: vi.fn((data, setAcarsMessages) => {
    if (data?.data?.messages) {
      setAcarsMessages(data.data.messages);
    }
  }),
  processAudioTransmission: vi.fn((data, setAudioTransmissions) => {
    if (data?.data) {
      setAudioTransmissions((prev) => [data.data, ...prev]);
    }
  }),
  processAirspaceData: vi.fn((data, setAirspaceData) => {
    if (data?.data) {
      setAirspaceData(data.data);
    }
  }),
  forceFlushAircraftBatch: vi.fn(),
  unregisterAircraftBatch: vi.fn(),
}));

import { useSocketIO } from './useSocketIO';
import {
  processAircraftSnapshot,
  processAircraftUpdate,
  processAircraftNew,
  processAircraftRemove,
  processSafetySnapshot,
  processSafetyEvent,
  processAlertTriggered,
  processAlertSnapshot,
  processAcarsMessage,
  processAcarsSnapshot,
  processAudioTransmission,
  processAirspaceData,
  forceFlushAircraftBatch,
} from '../channels';

describe('useSocketIOData', () => {
  let eventHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    eventHandlers = {};

    mockOn.mockImplementation((event, handler) => {
      eventHandlers[event] = handler;
      return vi.fn();
    });

    useSocketIO.mockReturnValue({
      connected: false,
      connecting: false,
      error: null,
      emit: mockEmit,
      on: mockOn,
      reconnect: mockReconnect,
      isReady: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should start with empty state', () => {
      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      expect(result.current.aircraft).toEqual([]);
      expect(result.current.aircraftMap).toEqual({});
      expect(result.current.stats).toEqual({ count: 0 });
      expect(result.current.safetyEvents).toEqual([]);
      expect(result.current.acarsMessages).toEqual([]);
      expect(result.current.alerts).toEqual([]);
      expect(result.current.airspaceData).toEqual({ advisories: [], boundaries: [] });
    });

    it('should pass enabled flag to useSocketIO', () => {
      renderHook(() => useSocketIOData(false, 'http://localhost:8000'));

      expect(useSocketIO).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: false,
          apiBase: 'http://localhost:8000',
        })
      );
    });

    it('should use default topics when not provided', () => {
      renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      expect(useSocketIO).toHaveBeenCalledWith(
        expect.objectContaining({
          namespace: '/',
          path: '/socket.io',
        })
      );
    });
  });

  describe('connection state', () => {
    it('should expose connection state from useSocketIO', () => {
      useSocketIO.mockReturnValue({
        connected: true,
        connecting: false,
        error: null,
        emit: mockEmit,
        on: mockOn,
        reconnect: mockReconnect,
        isReady: true,
      });

      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      expect(result.current.connected).toBe(true);
      expect(result.current.connecting).toBe(false);
      expect(result.current.isReady).toBe(true);
      expect(result.current.error).toBeNull();
    });

    it('should expose error from useSocketIO', () => {
      const error = new Error('Connection failed');
      useSocketIO.mockReturnValue({
        connected: false,
        connecting: false,
        error,
        emit: mockEmit,
        on: mockOn,
        reconnect: mockReconnect,
        isReady: false,
      });

      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      expect(result.current.error).toBe(error);
    });
  });

  describe('event handling', () => {
    beforeEach(() => {
      useSocketIO.mockReturnValue({
        connected: true,
        connecting: false,
        error: null,
        emit: mockEmit,
        on: mockOn,
        reconnect: mockReconnect,
        isReady: true,
      });
    });

    it('should setup event listeners when ready', () => {
      renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      expect(mockOn).toHaveBeenCalledWith('aircraft:snapshot', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('aircraft:update', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('aircraft:new', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('aircraft:remove', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('safety:snapshot', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('safety:event', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('alert:triggered', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('acars:message', expect.any(Function));
    });

    it('should process aircraft:snapshot events', () => {
      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      const aircraftData = {
        aircraft: [
          { hex: 'ABC123', lat: 40.0, lon: -74.0 },
          { hex: 'DEF456', lat: 41.0, lon: -75.0 },
        ],
      };

      act(() => {
        eventHandlers['aircraft:snapshot'](aircraftData);
      });

      expect(processAircraftSnapshot).toHaveBeenCalledWith(
        { type: 'aircraft:snapshot', data: aircraftData },
        expect.any(Function),
        expect.any(Function)
      );
    });

    it('should process aircraft:update events', () => {
      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      const updateData = {
        aircraft: { hex: 'ABC123', lat: 40.5, lon: -74.5 },
      };

      act(() => {
        eventHandlers['aircraft:update'](updateData);
      });

      expect(processAircraftUpdate).toHaveBeenCalledWith(
        { type: 'aircraft:update', data: updateData },
        expect.any(Function)
      );
    });

    it('should process aircraft:new events', () => {
      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      const newData = {
        aircraft: { hex: 'NEW123', lat: 42.0, lon: -76.0 },
      };

      act(() => {
        eventHandlers['aircraft:new'](newData);
      });

      expect(processAircraftNew).toHaveBeenCalledWith(
        { type: 'aircraft:new', data: newData },
        expect.any(Function)
      );
    });

    it('should process aircraft:remove events', () => {
      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      const removeData = { hex: 'ABC123' };

      act(() => {
        eventHandlers['aircraft:remove'](removeData);
      });

      expect(processAircraftRemove).toHaveBeenCalledWith(
        { type: 'aircraft:remove', data: removeData },
        expect.any(Function)
      );
    });

    it('should process aircraft:heartbeat events', () => {
      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      const heartbeatData = { count: 42, timestamp: '2024-01-01T00:00:00Z' };

      act(() => {
        eventHandlers['aircraft:heartbeat'](heartbeatData);
      });

      expect(result.current.stats.count).toBe(42);
      expect(result.current.stats.timestamp).toBe('2024-01-01T00:00:00Z');
    });

    it('should process safety events', () => {
      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      const eventData = {
        id: 1,
        event_type: 'proximity',
        severity: 'warning',
      };

      act(() => {
        eventHandlers['safety:event'](eventData);
      });

      expect(processSafetyEvent).toHaveBeenCalledWith(
        { type: 'safety:event', data: eventData },
        expect.any(Function)
      );
    });

    it('should process alert events', () => {
      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      const alertData = {
        id: 1,
        rule_name: 'Test Alert',
        triggered_at: '2024-01-01T00:00:00Z',
      };

      act(() => {
        eventHandlers['alert:triggered'](alertData);
      });

      expect(processAlertTriggered).toHaveBeenCalledWith(
        { type: 'alert:triggered', data: alertData },
        expect.any(Function)
      );
    });

    it('should process ACARS messages', () => {
      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      const acarsData = {
        id: 1,
        message: 'ACARS message content',
        label: 'H1',
      };

      act(() => {
        eventHandlers['acars:message'](acarsData);
      });

      expect(processAcarsMessage).toHaveBeenCalledWith(
        { type: 'acars:message', data: acarsData },
        expect.any(Function)
      );
    });

    it('should process audio transmissions', () => {
      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      const audioData = {
        id: 1,
        frequency: '123.450',
        duration: 5.5,
      };

      act(() => {
        eventHandlers['audio:transmission'](audioData);
      });

      expect(processAudioTransmission).toHaveBeenCalledWith(
        { type: 'audio:transmission', data: audioData },
        expect.any(Function)
      );
    });

    it('should process airspace data', () => {
      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      const airspaceData = {
        advisories: [{ id: 1, type: 'TFR' }],
        boundaries: [],
      };

      act(() => {
        eventHandlers['airspace:snapshot'](airspaceData);
      });

      expect(processAirspaceData).toHaveBeenCalledWith(
        { type: 'airspace:snapshot', data: airspaceData },
        expect.any(Function)
      );
    });
  });

  describe('batch messages', () => {
    beforeEach(() => {
      useSocketIO.mockReturnValue({
        connected: true,
        connecting: false,
        error: null,
        emit: mockEmit,
        on: mockOn,
        reconnect: mockReconnect,
        isReady: true,
      });
    });

    it('should process batch messages', () => {
      renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      const batchData = {
        messages: [
          { type: 'aircraft:update', data: { aircraft: { hex: 'ABC123', lat: 40.0 } } },
          { type: 'aircraft:update', data: { aircraft: { hex: 'DEF456', lat: 41.0 } } },
        ],
      };

      act(() => {
        eventHandlers['batch'](batchData);
      });

      // Should have processed both updates
      expect(processAircraftUpdate).toHaveBeenCalledTimes(2);
    });
  });

  describe('request/response', () => {
    beforeEach(() => {
      useSocketIO.mockReturnValue({
        connected: true,
        connecting: false,
        error: null,
        emit: mockEmit,
        on: mockOn,
        reconnect: mockReconnect,
        isReady: true,
      });
    });

    it('should send requests and resolve responses', async () => {
      vi.useRealTimers();

      // Capture emit call to get request_id
      let capturedRequestId;
      mockEmit.mockImplementation((event, data) => {
        if (event === 'request') {
          capturedRequestId = data.request_id;
        }
        return true;
      });

      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      // Start request
      const requestPromise = result.current.request('test-request', { param: 'value' });

      // Wait a tick for the emit to happen
      await new Promise((r) => setTimeout(r, 10));

      // Simulate response
      act(() => {
        eventHandlers['response']({
          request_id: capturedRequestId,
          data: { result: 'success' },
        });
      });

      const response = await requestPromise;
      expect(response).toEqual({ result: 'success' });
    });

    it('should reject when not connected', async () => {
      vi.useRealTimers();

      useSocketIO.mockReturnValue({
        connected: false,
        connecting: false,
        error: null,
        emit: mockEmit,
        on: mockOn,
        reconnect: mockReconnect,
        isReady: false,
      });

      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      await expect(result.current.request('test-request', {})).rejects.toThrow(
        'Socket.IO not connected'
      );
    });

    it('should reject on error response', async () => {
      vi.useRealTimers();

      // Capture emit call to get request_id
      let capturedRequestId;
      mockEmit.mockImplementation((event, data) => {
        if (event === 'request') {
          capturedRequestId = data.request_id;
        }
        return true;
      });

      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      const requestPromise = result.current.request('test-request', {});

      // Wait a tick for the emit to happen
      await new Promise((r) => setTimeout(r, 10));

      act(() => {
        eventHandlers['error']({
          request_id: capturedRequestId,
          message: 'Request failed',
        });
      });

      await expect(requestPromise).rejects.toThrow('Request failed');
    });

    it('should timeout requests', async () => {
      vi.useFakeTimers();

      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      let requestPromise;
      await act(async () => {
        requestPromise = result.current.request('test-request', {}, 1000);
        // Add catch to prevent unhandled rejection warning
        requestPromise.catch(() => {});
      });

      // Advance past timeout
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      await expect(requestPromise).rejects.toThrow('Request timeout');

      vi.useRealTimers();
    });

    it('should reject when emit fails', async () => {
      vi.useRealTimers();

      mockEmit.mockReturnValue(false);

      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      await expect(result.current.request('test-request', {})).rejects.toThrow(
        'Socket.IO emit failed'
      );
    });
  });

  describe('subscribe/unsubscribe', () => {
    beforeEach(() => {
      useSocketIO.mockReturnValue({
        connected: true,
        connecting: false,
        error: null,
        emit: mockEmit,
        on: mockOn,
        reconnect: mockReconnect,
        isReady: true,
      });
    });

    it('should subscribe to topics', () => {
      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      result.current.subscribe('new-topic');

      expect(mockEmit).toHaveBeenCalledWith('subscribe', {
        topics: ['new-topic'],
      });
    });

    it('should subscribe to multiple topics', () => {
      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      result.current.subscribe(['topic1', 'topic2']);

      expect(mockEmit).toHaveBeenCalledWith('subscribe', {
        topics: ['topic1', 'topic2'],
      });
    });

    it('should unsubscribe from topics', () => {
      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      result.current.unsubscribe('old-topic');

      expect(mockEmit).toHaveBeenCalledWith('unsubscribe', {
        topics: ['old-topic'],
      });
    });

    it('should not subscribe when not ready', () => {
      useSocketIO.mockReturnValue({
        connected: false,
        connecting: false,
        error: null,
        emit: mockEmit,
        on: mockOn,
        reconnect: mockReconnect,
        isReady: false,
      });

      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      mockEmit.mockClear();
      result.current.subscribe('topic');

      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  describe('send', () => {
    it('should send events when connected', () => {
      useSocketIO.mockReturnValue({
        connected: true,
        connecting: false,
        error: null,
        emit: mockEmit,
        on: mockOn,
        reconnect: mockReconnect,
        isReady: true,
      });

      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      result.current.send('custom-event', { data: 'test' });

      expect(mockEmit).toHaveBeenCalledWith('custom-event', { data: 'test' });
    });

    it('should not send when not connected', () => {
      useSocketIO.mockReturnValue({
        connected: false,
        connecting: false,
        error: null,
        emit: mockEmit,
        on: mockOn,
        reconnect: mockReconnect,
        isReady: false,
      });

      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      mockEmit.mockClear();
      result.current.send('custom-event', { data: 'test' });

      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  describe('reconnect', () => {
    it('should expose reconnect function', () => {
      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      result.current.reconnect();

      expect(mockReconnect).toHaveBeenCalled();
    });
  });

  describe('airframe errors', () => {
    beforeEach(() => {
      useSocketIO.mockReturnValue({
        connected: true,
        connecting: false,
        error: null,
        emit: mockEmit,
        on: mockOn,
        reconnect: mockReconnect,
        isReady: true,
      });
    });

    it('should track airframe errors', () => {
      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      act(() => {
        eventHandlers['airframe:error']({
          icao_hex: 'ABC123',
          error_type: 'lookup_failed',
          error_message: 'Aircraft not found',
          source: 'opensky',
        });
      });

      const error = result.current.getAirframeError('ABC123');
      expect(error).toBeDefined();
      expect(error.error_type).toBe('lookup_failed');
    });

    it('should normalize ICAO to uppercase', () => {
      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      act(() => {
        eventHandlers['airframe:error']({
          icao_hex: 'abc123',
          error_type: 'lookup_failed',
          error_message: 'Aircraft not found',
          source: 'opensky',
        });
      });

      const error = result.current.getAirframeError('abc123');
      expect(error).toBeDefined();
    });

    it('should clear airframe errors', () => {
      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      act(() => {
        eventHandlers['airframe:error']({
          icao_hex: 'ABC123',
          error_type: 'lookup_failed',
          error_message: 'Aircraft not found',
          source: 'opensky',
        });
      });

      expect(result.current.getAirframeError('ABC123')).toBeDefined();

      act(() => {
        result.current.clearAirframeError('ABC123');
      });

      expect(result.current.getAirframeError('ABC123')).toBeNull();
    });

    it('should get all airframe errors', () => {
      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      act(() => {
        eventHandlers['airframe:error']({
          icao_hex: 'ABC123',
          error_type: 'error1',
          error_message: 'Error 1',
          source: 'test',
        });
        eventHandlers['airframe:error']({
          icao_hex: 'DEF456',
          error_type: 'error2',
          error_message: 'Error 2',
          source: 'test',
        });
      });

      const errors = result.current.getAirframeErrors();
      expect(errors.size).toBe(2);
      expect(errors.get('ABC123')).toBeDefined();
      expect(errors.get('DEF456')).toBeDefined();
    });
  });

  describe('NOTAM handling', () => {
    beforeEach(() => {
      useSocketIO.mockReturnValue({
        connected: true,
        connecting: false,
        error: null,
        emit: mockEmit,
        on: mockOn,
        reconnect: mockReconnect,
        isReady: true,
      });
    });

    it('should process notam:snapshot events', () => {
      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      act(() => {
        eventHandlers['notam:snapshot']({
          notams: [{ notam_id: '1', text: 'Test NOTAM' }],
          tfrs: [{ notam_id: '2', type: 'TFR' }],
          stats: { total: 2 },
        });
      });

      expect(result.current.notams).toHaveLength(1);
      expect(result.current.tfrs).toHaveLength(1);
      expect(result.current.notamStats).toEqual({ total: 2 });
    });

    it('should handle notam:new events', () => {
      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      act(() => {
        eventHandlers['notam:new']({ notam_id: '1', text: 'New NOTAM' });
      });

      expect(result.current.notams).toHaveLength(1);
    });

    it('should handle notam:expired events', () => {
      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      // First add a NOTAM
      act(() => {
        eventHandlers['notam:snapshot']({
          notams: [{ notam_id: '1', text: 'Test NOTAM' }],
          tfrs: [],
          stats: { total: 1 },
        });
      });

      expect(result.current.notams).toHaveLength(1);

      // Then expire it
      act(() => {
        eventHandlers['notam:expired']({ notam_id: '1' });
      });

      expect(result.current.notams).toHaveLength(0);
    });
  });

  describe('stats updates', () => {
    beforeEach(() => {
      useSocketIO.mockReturnValue({
        connected: true,
        connecting: false,
        error: null,
        emit: mockEmit,
        on: mockOn,
        reconnect: mockReconnect,
        isReady: true,
      });
    });

    it('should process stats:update events (backend {stat_type, stats} shape)', () => {
      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      act(() => {
        eventHandlers['stats:update']({
          stat_type: 'flight_patterns',
          stats: { patterns: ['test'] },
        });
      });

      expect(result.current.extendedStats.flightPatterns).toEqual({ patterns: ['test'] });
    });

    it('should update antenna analytics from stats (incl. antenna_analytics key)', () => {
      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      act(() => {
        eventHandlers['stats:update']({
          stat_type: 'antenna_analytics',
          stats: { range: 100, messages: 1000 },
        });
      });

      expect(result.current.antennaAnalytics).toEqual({ range: 100, messages: 1000 });
      expect(result.current.extendedStats.antenna).toEqual({ range: 100, messages: 1000 });
    });

    it('should store stats:tick payloads', () => {
      const { result } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      act(() => {
        eventHandlers['stats:tick']({
          ts: '2026-07-16T10:00:00Z',
          traffic: { aircraft: 142 },
          series: [],
        });
      });

      expect(result.current.statsTick?.traffic.aircraft).toBe(142);
    });
  });

  describe('cleanup', () => {
    it('should clean up on unmount', () => {
      const { unmount } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      unmount();

      expect(forceFlushAircraftBatch).toHaveBeenCalled();
    });
  });

  describe('aircraft array memoization', () => {
    it('should return same array reference when aircraft map unchanged', () => {
      const { result, rerender } = renderHook(() => useSocketIOData(true, 'http://localhost:8000'));

      const aircraft1 = result.current.aircraft;
      rerender();
      const aircraft2 = result.current.aircraft;

      expect(aircraft1).toBe(aircraft2);
    });
  });
});
