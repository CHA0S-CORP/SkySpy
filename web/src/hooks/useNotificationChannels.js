import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Hook for managing notification channels via Socket.IO.
 * Provides CRUD operations and channel testing.
 *
 * @param {Object} options - Configuration options
 * @param {string} options.apiBase - API base URL (unused, kept for compatibility)
 * @param {Function} options.wsRequest - WebSocket request function from useSocketIOData
 * @param {boolean} options.wsConnected - Whether WebSocket is connected
 */
export function useNotificationChannels({ apiBase = '', wsRequest, wsConnected } = {}) {
  const [channels, setChannels] = useState([]);
  const [channelTypes, setChannelTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);
  const mountedRef = useRef(true);

  // Track connection state
  useEffect(() => {
    setConnected(!!wsConnected);
  }, [wsConnected]);

  // Fetch all channels via Socket.IO
  const fetchChannels = useCallback(async () => {
    if (!wsRequest || !wsConnected) {
      if (mountedRef.current) {
        setError('Socket not connected');
        setLoading(false);
      }
      return;
    }

    try {
      setLoading(true);
      const data = await wsRequest('notification-channels', {});

      if (mountedRef.current) {
        // Handle both array and results formats
        const channelList = Array.isArray(data) ? data : data?.results || data?.channels || [];
        setChannels(Array.isArray(channelList) ? channelList : []);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err.message || 'Failed to fetch channels');
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [wsRequest, wsConnected]);

  // Fetch channel types via Socket.IO
  const fetchChannelTypes = useCallback(async () => {
    if (!wsRequest || !wsConnected) {
      return;
    }

    try {
      const data = await wsRequest('notification-channel-types', {});
      if (mountedRef.current) {
        setChannelTypes(data?.types || data || []);
      }
    } catch (err) {
      console.warn('Failed to fetch channel types:', err);
    }
  }, [wsRequest, wsConnected]);

  // Create a new channel via Socket.IO
  const createChannel = useCallback(
    async (channelData) => {
      if (!wsRequest || !wsConnected) {
        throw new Error('Socket not connected');
      }

      const data = await wsRequest('notification-channel-create', channelData);
      if (data?.error) {
        throw new Error(data.error);
      }
      await fetchChannels();
      return data;
    },
    [wsRequest, wsConnected, fetchChannels]
  );

  // Update a channel via Socket.IO
  const updateChannel = useCallback(
    async (id, channelData) => {
      if (!wsRequest || !wsConnected) {
        throw new Error('Socket not connected');
      }

      const data = await wsRequest('notification-channel-update', { id, ...channelData });
      if (data?.error) {
        throw new Error(data.error);
      }
      await fetchChannels();
      return data;
    },
    [wsRequest, wsConnected, fetchChannels]
  );

  // Delete a channel via Socket.IO
  const deleteChannel = useCallback(
    async (id) => {
      if (!wsRequest || !wsConnected) {
        throw new Error('Socket not connected');
      }

      const data = await wsRequest('notification-channel-delete', { id });
      if (data?.error) {
        throw new Error(data.error);
      }
      await fetchChannels();
    },
    [wsRequest, wsConnected, fetchChannels]
  );

  // Test a channel via Socket.IO
  const testChannel = useCallback(
    async (id) => {
      if (!wsRequest || !wsConnected) {
        throw new Error('Socket not connected');
      }

      const data = await wsRequest('notification-channel-test', { id });
      if (data?.error) {
        throw new Error(data.error);
      }
      // Refresh channels to get updated verification status
      await fetchChannels();
      return data;
    },
    [wsRequest, wsConnected, fetchChannels]
  );

  // Toggle channel enabled status
  const toggleChannel = useCallback(
    async (channel) => {
      return updateChannel(channel.id, { enabled: !channel.enabled });
    },
    [updateChannel]
  );

  // Initial fetch when connection is established
  useEffect(() => {
    mountedRef.current = true;

    if (wsConnected && wsRequest) {
      fetchChannels();
      fetchChannelTypes();
    }

    return () => {
      mountedRef.current = false;
    };
  }, [wsConnected, wsRequest, fetchChannels, fetchChannelTypes]);

  return {
    channels,
    channelTypes,
    loading,
    error,
    connected,
    refetch: fetchChannels,
    createChannel,
    updateChannel,
    deleteChannel,
    testChannel,
    toggleChannel,
  };
}

export default useNotificationChannels;
