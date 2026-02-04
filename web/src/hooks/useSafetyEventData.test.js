import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSafetyEventData } from './useSafetyEventData';

describe('useSafetyEventData', () => {
  let mockWsRequest;

  beforeEach(() => {
    vi.useFakeTimers();
    mockWsRequest = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const defaultProps = {
    eventId: 'event-123',
    apiBase: 'http://localhost:8000',
    wsRequest: null,
    wsConnected: false,
  };

  describe('initial state', () => {
    it('should initialize with loading state and resolve to error when not connected', async () => {
      vi.useRealTimers();

      const { result } = renderHook(() => useSafetyEventData(defaultProps));

      // Initial state
      expect(result.current.event).toBeNull();
      expect(result.current.trackData).toEqual({});
      expect(result.current.acknowledged).toBe(false);
      expect(result.current.acknowledging).toBe(false);

      // Will quickly resolve to error state since not connected
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });

    it('should report connected status from props', async () => {
      vi.useRealTimers();

      mockWsRequest.mockResolvedValue({ id: 'event-123' });

      const { result } = renderHook(() =>
        useSafetyEventData({ ...defaultProps, wsConnected: true, wsRequest: mockWsRequest })
      );

      expect(result.current.connected).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });
  });

  describe('error handling', () => {
    it('should set error when no event ID provided', async () => {
      vi.useRealTimers();

      const { result } = renderHook(() => useSafetyEventData({ ...defaultProps, eventId: null }));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('No event ID provided');
    });

    it('should set error when socket not connected', async () => {
      vi.useRealTimers();

      const { result } = renderHook(() =>
        useSafetyEventData({ ...defaultProps, wsRequest: null, wsConnected: false })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Socket not connected');
    });

    it('should set error when event not found', async () => {
      vi.useRealTimers();

      mockWsRequest.mockResolvedValue({ error: 'Not found', error_type: 'not_found' });

      const { result } = renderHook(() =>
        useSafetyEventData({
          ...defaultProps,
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Safety event not found');
    });

    it('should handle fetch errors', async () => {
      vi.useRealTimers();

      mockWsRequest.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() =>
        useSafetyEventData({
          ...defaultProps,
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Network error');
    });
  });

  describe('fetching event data', () => {
    it('should fetch event data via WebSocket', async () => {
      vi.useRealTimers();

      const mockEvent = {
        id: 'event-123',
        event_type: 'proximity',
        severity: 'warning',
        icao: 'ABC123',
        callsign: 'UAL123',
        acknowledged: false,
      };

      mockWsRequest.mockResolvedValue(mockEvent);

      const { result } = renderHook(() =>
        useSafetyEventData({
          ...defaultProps,
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.event).toEqual(mockEvent);
      expect(result.current.error).toBeNull();
      expect(mockWsRequest).toHaveBeenCalledWith('safety-event-detail', {
        event_id: 'event-123',
        id: 'event-123',
      });
    });

    it('should handle nested data structure from DRF', async () => {
      vi.useRealTimers();

      const mockEvent = {
        id: 'event-123',
        event_type: 'tcas',
        severity: 'critical',
      };

      mockWsRequest.mockResolvedValue({ data: mockEvent });

      const { result } = renderHook(() =>
        useSafetyEventData({
          ...defaultProps,
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      await waitFor(() => {
        expect(result.current.event).toEqual(mockEvent);
      });
    });

    it('should set acknowledged from event data', async () => {
      vi.useRealTimers();

      mockWsRequest.mockResolvedValue({
        id: 'event-123',
        acknowledged: true,
      });

      const { result } = renderHook(() =>
        useSafetyEventData({
          ...defaultProps,
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      await waitFor(() => {
        expect(result.current.acknowledged).toBe(true);
      });
    });

    it('should set acknowledged from resolved field', async () => {
      vi.useRealTimers();

      mockWsRequest.mockResolvedValue({
        id: 'event-123',
        resolved: true,
      });

      const { result } = renderHook(() =>
        useSafetyEventData({
          ...defaultProps,
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      await waitFor(() => {
        expect(result.current.acknowledged).toBe(true);
      });
    });
  });

  describe('fetching track data', () => {
    it('should fetch track data for involved aircraft', async () => {
      vi.useRealTimers();

      const mockEvent = {
        id: 'event-123',
        icao: 'ABC123',
        icao_hex: 'ABC123',
      };

      const mockSightings = {
        sightings: [
          { lat: 37.5, lon: -122.5, alt: 5000, time: '2024-01-01T12:00:00Z' },
          { lat: 37.6, lon: -122.4, alt: 6000, time: '2024-01-01T12:01:00Z' },
        ],
      };

      mockWsRequest.mockResolvedValueOnce(mockEvent).mockResolvedValueOnce(mockSightings);

      const { result } = renderHook(() =>
        useSafetyEventData({
          ...defaultProps,
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      await waitFor(() => {
        expect(result.current.trackData['ABC123']).toBeDefined();
      });

      expect(result.current.trackData['ABC123']).toHaveLength(2);
    });

    it('should fetch track data for both aircraft in two-aircraft events', async () => {
      vi.useRealTimers();

      const mockEvent = {
        id: 'event-123',
        icao: 'ABC123',
        icao_2: 'DEF456',
      };

      mockWsRequest
        .mockResolvedValueOnce(mockEvent)
        .mockResolvedValueOnce({ sightings: [{ lat: 37.5, lon: -122.5 }] })
        .mockResolvedValueOnce({ sightings: [{ lat: 37.6, lon: -122.4 }] });

      const { result } = renderHook(() =>
        useSafetyEventData({
          ...defaultProps,
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      await waitFor(() => {
        expect(Object.keys(result.current.trackData)).toHaveLength(2);
      });
    });

    it('should handle missing track data gracefully', async () => {
      vi.useRealTimers();

      const mockEvent = {
        id: 'event-123',
        icao: 'ABC123',
      };

      mockWsRequest.mockResolvedValueOnce(mockEvent).mockResolvedValueOnce({ sightings: [] }); // Empty sightings

      const { result } = renderHook(() =>
        useSafetyEventData({
          ...defaultProps,
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.trackData).toEqual({});
    });
  });

  describe('acknowledging events', () => {
    it('should acknowledge event via WebSocket', async () => {
      vi.useRealTimers();

      const mockEvent = {
        id: 'event-123',
        acknowledged: false,
      };

      mockWsRequest.mockResolvedValueOnce(mockEvent).mockResolvedValueOnce({ success: true });

      const { result } = renderHook(() =>
        useSafetyEventData({
          ...defaultProps,
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      await waitFor(() => {
        expect(result.current.event).toBeDefined();
      });

      await act(async () => {
        await result.current.acknowledgeEvent();
      });

      expect(mockWsRequest).toHaveBeenCalledWith('safety-acknowledge', {
        event_id: 'event-123',
        id: 'event-123',
      });
      expect(result.current.acknowledged).toBe(true);
    });

    it('should not acknowledge if already acknowledged', async () => {
      vi.useRealTimers();

      mockWsRequest.mockResolvedValue({ id: 'event-123', acknowledged: true });

      const { result } = renderHook(() =>
        useSafetyEventData({
          ...defaultProps,
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      await waitFor(() => {
        expect(result.current.acknowledged).toBe(true);
      });

      const initialCallCount = mockWsRequest.mock.calls.length;

      await act(async () => {
        await result.current.acknowledgeEvent();
      });

      // Should not have made additional calls
      expect(mockWsRequest.mock.calls.length).toBe(initialCallCount);
    });

    it('should not acknowledge if currently acknowledging', async () => {
      vi.useRealTimers();

      let resolveAck;
      mockWsRequest
        .mockResolvedValueOnce({ id: 'event-123', acknowledged: false })
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveAck = () => resolve({ success: true });
            })
        );

      const { result } = renderHook(() =>
        useSafetyEventData({
          ...defaultProps,
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      await waitFor(() => {
        expect(result.current.event).toBeDefined();
      });

      // Start first acknowledgment
      act(() => {
        result.current.acknowledgeEvent();
      });

      // Try second acknowledgment while first is pending
      await act(async () => {
        await result.current.acknowledgeEvent();
      });

      // Should only have 2 calls (event fetch + first ack)
      expect(mockWsRequest.mock.calls.length).toBe(2);

      // Resolve the pending ack
      await act(async () => {
        resolveAck();
      });
    });

    it('should not acknowledge if socket not connected', async () => {
      vi.useRealTimers();

      const { result } = renderHook(() =>
        useSafetyEventData({
          ...defaultProps,
          wsRequest: null,
          wsConnected: false,
        })
      );

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await act(async () => {
        await result.current.acknowledgeEvent();
      });

      expect(consoleSpy).toHaveBeenCalledWith('Socket not connected');
      consoleSpy.mockRestore();
    });

    it('should handle acknowledge errors', async () => {
      vi.useRealTimers();

      mockWsRequest
        .mockResolvedValueOnce({ id: 'event-123', acknowledged: false })
        .mockResolvedValueOnce({ error: 'Failed to acknowledge' });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() =>
        useSafetyEventData({
          ...defaultProps,
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      await waitFor(() => {
        expect(result.current.event).toBeDefined();
      });

      await act(async () => {
        await result.current.acknowledgeEvent();
      });

      expect(result.current.acknowledged).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to acknowledge event:',
        'Failed to acknowledge'
      );
      consoleSpy.mockRestore();
    });
  });

  describe('real-time updates via custom events', () => {
    it('should update event when receiving event_updated event', async () => {
      vi.useRealTimers();

      mockWsRequest.mockResolvedValue({
        id: 'event-123',
        severity: 'warning',
        acknowledged: false,
      });

      const { result } = renderHook(() =>
        useSafetyEventData({
          ...defaultProps,
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      await waitFor(() => {
        expect(result.current.event).toBeDefined();
      });

      act(() => {
        window.dispatchEvent(
          new CustomEvent('skyspy:safety:event_updated', {
            detail: {
              id: 'event-123',
              severity: 'critical',
            },
          })
        );
      });

      expect(result.current.event.severity).toBe('critical');
    });

    it('should update acknowledged state when receiving event_resolved', async () => {
      vi.useRealTimers();

      mockWsRequest.mockResolvedValue({
        id: 'event-123',
        acknowledged: false,
      });

      const { result } = renderHook(() =>
        useSafetyEventData({
          ...defaultProps,
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      await waitFor(() => {
        expect(result.current.event).toBeDefined();
      });

      expect(result.current.acknowledged).toBe(false);

      act(() => {
        window.dispatchEvent(
          new CustomEvent('skyspy:safety:event_resolved', {
            detail: {
              id: 'event-123',
              resolved: true,
            },
          })
        );
      });

      expect(result.current.acknowledged).toBe(true);
    });

    it('should ignore events for different event IDs', async () => {
      vi.useRealTimers();

      mockWsRequest.mockResolvedValue({
        id: 'event-123',
        severity: 'warning',
      });

      const { result } = renderHook(() =>
        useSafetyEventData({
          ...defaultProps,
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      await waitFor(() => {
        expect(result.current.event).toBeDefined();
      });

      act(() => {
        window.dispatchEvent(
          new CustomEvent('skyspy:safety:event_updated', {
            detail: {
              id: 'event-456', // Different ID
              severity: 'critical',
            },
          })
        );
      });

      // Should remain unchanged
      expect(result.current.event.severity).toBe('warning');
    });
  });

  describe('race condition handling', () => {
    it('should handle rapid eventId changes', async () => {
      vi.useRealTimers();

      let resolveFirst;
      let resolveSecond;

      mockWsRequest
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirst = () => resolve({ id: 'event-1', name: 'First' });
            })
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveSecond = () => resolve({ id: 'event-2', name: 'Second' });
            })
        );

      const { result, rerender } = renderHook((props) => useSafetyEventData(props), {
        initialProps: {
          ...defaultProps,
          eventId: 'event-1',
          wsRequest: mockWsRequest,
          wsConnected: true,
        },
      });

      // Change eventId before first request completes
      rerender({
        ...defaultProps,
        eventId: 'event-2',
        wsRequest: mockWsRequest,
        wsConnected: true,
      });

      // Resolve second request first
      await act(async () => {
        resolveSecond();
      });

      await waitFor(() => {
        expect(result.current.event?.id).toBe('event-2');
      });

      // Resolve first request after (should be ignored as stale)
      await act(async () => {
        resolveFirst();
      });

      // Should still show second event
      expect(result.current.event?.id).toBe('event-2');
    });
  });

  describe('setEvent', () => {
    it('should allow manual event updates', async () => {
      vi.useRealTimers();

      mockWsRequest.mockResolvedValue({
        id: 'event-123',
        severity: 'warning',
      });

      const { result } = renderHook(() =>
        useSafetyEventData({
          ...defaultProps,
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      await waitFor(() => {
        expect(result.current.event).toBeDefined();
      });

      act(() => {
        result.current.setEvent({ id: 'event-123', severity: 'critical', custom: true });
      });

      expect(result.current.event.severity).toBe('critical');
      expect(result.current.event.custom).toBe(true);
    });
  });
});
