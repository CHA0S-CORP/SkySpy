import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useNotificationChannels } from './useNotificationChannels';

describe('useNotificationChannels', () => {
  let mockWsRequest;

  beforeEach(() => {
    mockWsRequest = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('should start with empty channels', () => {
      const { result } = renderHook(() =>
        useNotificationChannels({ wsRequest: mockWsRequest, wsConnected: false })
      );

      expect(result.current.channels).toEqual([]);
      expect(result.current.channelTypes).toEqual([]);
    });

    it('should start with loading true when connected', () => {
      mockWsRequest.mockImplementation(() => new Promise(() => {}));

      const { result } = renderHook(() =>
        useNotificationChannels({ wsRequest: mockWsRequest, wsConnected: true })
      );

      expect(result.current.loading).toBe(true);
    });

    it('should not fetch when not connected', () => {
      const { result } = renderHook(() =>
        useNotificationChannels({ wsRequest: mockWsRequest, wsConnected: false })
      );

      // When not connected, the hook doesn't call fetchChannels
      // so loading stays true and error is not set until manual refetch
      expect(result.current.loading).toBe(true);
      expect(result.current.connected).toBe(false);
    });

    it('should track connection state', () => {
      const { result, rerender } = renderHook(
        ({ wsConnected }) =>
          useNotificationChannels({ wsRequest: mockWsRequest, wsConnected }),
        { initialProps: { wsConnected: false } }
      );

      expect(result.current.connected).toBe(false);

      rerender({ wsConnected: true });

      expect(result.current.connected).toBe(true);
    });
  });

  describe('fetchChannels', () => {
    it('should fetch channels via WebSocket', async () => {
      const channels = [
        { id: 1, name: 'Email', type: 'email', enabled: true },
        { id: 2, name: 'SMS', type: 'sms', enabled: false },
      ];

      mockWsRequest.mockResolvedValue(channels);

      const { result } = renderHook(() =>
        useNotificationChannels({ wsRequest: mockWsRequest, wsConnected: true })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockWsRequest).toHaveBeenCalledWith('notification-channels', {});
      expect(result.current.channels).toEqual(channels);
      expect(result.current.error).toBeNull();
    });

    it('should handle results format response', async () => {
      const channels = [{ id: 1, name: 'Email' }];
      mockWsRequest.mockResolvedValue({ results: channels });

      const { result } = renderHook(() =>
        useNotificationChannels({ wsRequest: mockWsRequest, wsConnected: true })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.channels).toEqual(channels);
    });

    it('should handle channels format response', async () => {
      const channels = [{ id: 1, name: 'Email' }];
      mockWsRequest.mockResolvedValue({ channels });

      const { result } = renderHook(() =>
        useNotificationChannels({ wsRequest: mockWsRequest, wsConnected: true })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.channels).toEqual(channels);
    });

    it('should handle fetch error', async () => {
      mockWsRequest.mockRejectedValue(new Error('Connection failed'));

      const { result } = renderHook(() =>
        useNotificationChannels({ wsRequest: mockWsRequest, wsConnected: true })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Connection failed');
    });
  });

  describe('fetchChannelTypes', () => {
    it('should fetch channel types', async () => {
      const types = ['email', 'sms', 'push', 'webhook'];
      mockWsRequest
        .mockResolvedValueOnce([]) // channels
        .mockResolvedValueOnce({ types }); // channel types

      const { result } = renderHook(() =>
        useNotificationChannels({ wsRequest: mockWsRequest, wsConnected: true })
      );

      await waitFor(() => {
        expect(result.current.channelTypes).toEqual(types);
      });

      expect(mockWsRequest).toHaveBeenCalledWith('notification-channel-types', {});
    });

    it('should handle types as array response', async () => {
      const types = ['email', 'sms'];
      mockWsRequest
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(types);

      const { result } = renderHook(() =>
        useNotificationChannels({ wsRequest: mockWsRequest, wsConnected: true })
      );

      await waitFor(() => {
        expect(result.current.channelTypes).toEqual(types);
      });
    });
  });

  describe('createChannel', () => {
    it('should create a channel and refetch', async () => {
      mockWsRequest
        .mockResolvedValueOnce([]) // Initial fetch
        .mockResolvedValueOnce([]) // Channel types
        .mockResolvedValueOnce({ id: 1, name: 'New Channel' }) // Create
        .mockResolvedValueOnce([{ id: 1, name: 'New Channel' }]); // Refetch

      const { result } = renderHook(() =>
        useNotificationChannels({ wsRequest: mockWsRequest, wsConnected: true })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      let createResult;
      await act(async () => {
        createResult = await result.current.createChannel({ name: 'New Channel', type: 'email' });
      });

      expect(mockWsRequest).toHaveBeenCalledWith('notification-channel-create', {
        name: 'New Channel',
        type: 'email',
      });
      expect(createResult).toEqual({ id: 1, name: 'New Channel' });
    });

    it('should throw when not connected', async () => {
      const { result } = renderHook(() =>
        useNotificationChannels({ wsRequest: mockWsRequest, wsConnected: false })
      );

      await expect(
        result.current.createChannel({ name: 'Test' })
      ).rejects.toThrow('Socket not connected');
    });

    it('should throw on error response', async () => {
      mockWsRequest
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({ error: 'Validation failed' });

      const { result } = renderHook(() =>
        useNotificationChannels({ wsRequest: mockWsRequest, wsConnected: true })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(
        result.current.createChannel({ name: 'Test' })
      ).rejects.toThrow('Validation failed');
    });
  });

  describe('updateChannel', () => {
    it('should update a channel and refetch', async () => {
      mockWsRequest
        .mockResolvedValueOnce([{ id: 1, name: 'Old Name' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({ id: 1, name: 'New Name' })
        .mockResolvedValueOnce([{ id: 1, name: 'New Name' }]);

      const { result } = renderHook(() =>
        useNotificationChannels({ wsRequest: mockWsRequest, wsConnected: true })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.updateChannel(1, { name: 'New Name' });
      });

      expect(mockWsRequest).toHaveBeenCalledWith('notification-channel-update', {
        id: 1,
        name: 'New Name',
      });
    });

    it('should throw when not connected', async () => {
      const { result } = renderHook(() =>
        useNotificationChannels({ wsRequest: mockWsRequest, wsConnected: false })
      );

      await expect(
        result.current.updateChannel(1, { name: 'Test' })
      ).rejects.toThrow('Socket not connected');
    });
  });

  describe('deleteChannel', () => {
    it('should delete a channel and refetch', async () => {
      mockWsRequest
        .mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce([{ id: 2 }]);

      const { result } = renderHook(() =>
        useNotificationChannels({ wsRequest: mockWsRequest, wsConnected: true })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.deleteChannel(1);
      });

      expect(mockWsRequest).toHaveBeenCalledWith('notification-channel-delete', { id: 1 });
    });

    it('should throw when not connected', async () => {
      const { result } = renderHook(() =>
        useNotificationChannels({ wsRequest: mockWsRequest, wsConnected: false })
      );

      await expect(result.current.deleteChannel(1)).rejects.toThrow('Socket not connected');
    });
  });

  describe('testChannel', () => {
    it('should test a channel and refetch', async () => {
      mockWsRequest
        .mockResolvedValueOnce([{ id: 1, verified: false }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({ success: true, message: 'Test sent' })
        .mockResolvedValueOnce([{ id: 1, verified: true }]);

      const { result } = renderHook(() =>
        useNotificationChannels({ wsRequest: mockWsRequest, wsConnected: true })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      let testResult;
      await act(async () => {
        testResult = await result.current.testChannel(1);
      });

      expect(mockWsRequest).toHaveBeenCalledWith('notification-channel-test', { id: 1 });
      expect(testResult).toEqual({ success: true, message: 'Test sent' });
    });

    it('should throw on error response', async () => {
      mockWsRequest
        .mockResolvedValueOnce([{ id: 1 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({ error: 'Test failed' });

      const { result } = renderHook(() =>
        useNotificationChannels({ wsRequest: mockWsRequest, wsConnected: true })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(result.current.testChannel(1)).rejects.toThrow('Test failed');
    });
  });

  describe('toggleChannel', () => {
    it('should toggle channel enabled status', async () => {
      mockWsRequest
        .mockResolvedValueOnce([{ id: 1, enabled: true }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({ id: 1, enabled: false })
        .mockResolvedValueOnce([{ id: 1, enabled: false }]);

      const { result } = renderHook(() =>
        useNotificationChannels({ wsRequest: mockWsRequest, wsConnected: true })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.toggleChannel({ id: 1, enabled: true });
      });

      expect(mockWsRequest).toHaveBeenCalledWith('notification-channel-update', {
        id: 1,
        enabled: false,
      });
    });

    it('should enable disabled channel', async () => {
      mockWsRequest
        .mockResolvedValueOnce([{ id: 1, enabled: false }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({ id: 1, enabled: true })
        .mockResolvedValueOnce([{ id: 1, enabled: true }]);

      const { result } = renderHook(() =>
        useNotificationChannels({ wsRequest: mockWsRequest, wsConnected: true })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.toggleChannel({ id: 1, enabled: false });
      });

      expect(mockWsRequest).toHaveBeenCalledWith('notification-channel-update', {
        id: 1,
        enabled: true,
      });
    });
  });

  describe('refetch', () => {
    it('should provide refetch function', async () => {
      mockWsRequest.mockResolvedValue([]);

      const { result } = renderHook(() =>
        useNotificationChannels({ wsRequest: mockWsRequest, wsConnected: true })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(typeof result.current.refetch).toBe('function');
    });

    it('should refetch channels when called', async () => {
      mockWsRequest.mockResolvedValue([{ id: 1 }]);

      const { result } = renderHook(() =>
        useNotificationChannels({ wsRequest: mockWsRequest, wsConnected: true })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const initialCallCount = mockWsRequest.mock.calls.filter(
        (call) => call[0] === 'notification-channels'
      ).length;

      await act(async () => {
        await result.current.refetch();
      });

      const finalCallCount = mockWsRequest.mock.calls.filter(
        (call) => call[0] === 'notification-channels'
      ).length;

      expect(finalCallCount).toBeGreaterThan(initialCallCount);
    });
  });

  describe('unmount handling', () => {
    it('should not update state after unmount', async () => {
      let resolvePromise;
      mockWsRequest.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePromise = () => resolve([{ id: 1 }]);
          })
      );

      const { result, unmount } = renderHook(() =>
        useNotificationChannels({ wsRequest: mockWsRequest, wsConnected: true })
      );

      expect(result.current.loading).toBe(true);

      unmount();

      // Resolve after unmount - should not throw
      await act(async () => {
        resolvePromise();
      });
    });
  });
});
