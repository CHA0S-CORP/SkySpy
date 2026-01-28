import { useState, useEffect, useCallback, useRef } from 'react';

// Helper to safely parse JSON from fetch response
const safeJson = async (res) => {
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) return null;
  try { return await res.json(); } catch { return null; }
};

/**
 * Hook for managing notification channels.
 * Provides CRUD operations and channel testing.
 */
export function useNotificationChannels(apiBase = '') {
  const [channels, setChannels] = useState([]);
  const [channelTypes, setChannelTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  // Fetch all channels
  const fetchChannels = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${apiBase}/api/v1/notifications/channels/`);
      const data = await safeJson(res);
      if (!data) throw new Error(`HTTP ${res.status}`);
      if (mountedRef.current) {
        setChannels(data.results || data || []);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err.message);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [apiBase]);

  // Fetch channel types
  const fetchChannelTypes = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/v1/notifications/channels/types/`);
      const data = await safeJson(res);
      if (!data) throw new Error(`HTTP ${res.status}`);
      if (mountedRef.current) {
        setChannelTypes(data.types || data || []);
      }
    } catch (err) {
      console.warn('Failed to fetch channel types:', err);
    }
  }, [apiBase]);

  // Create a new channel
  const createChannel = useCallback(async (channelData) => {
    const res = await fetch(`${apiBase}/api/v1/notifications/channels/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(channelData),
    });
    const data = await safeJson(res);
    if (!res.ok) {
      throw new Error(data?.error || data?.detail || 'Failed to create channel');
    }
    await fetchChannels();
    return data;
  }, [apiBase, fetchChannels]);

  // Update a channel
  const updateChannel = useCallback(async (id, channelData) => {
    const res = await fetch(`${apiBase}/api/v1/notifications/channels/${id}/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(channelData),
    });
    const data = await safeJson(res);
    if (!res.ok) {
      throw new Error(data?.error || data?.detail || 'Failed to update channel');
    }
    await fetchChannels();
    return data;
  }, [apiBase, fetchChannels]);

  // Delete a channel
  const deleteChannel = useCallback(async (id) => {
    const res = await fetch(`${apiBase}/api/v1/notifications/channels/${id}/`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const data = await safeJson(res);
      throw new Error(data?.error || data?.detail || 'Failed to delete channel');
    }
    await fetchChannels();
  }, [apiBase, fetchChannels]);

  // Test a channel
  const testChannel = useCallback(async (id) => {
    const res = await fetch(`${apiBase}/api/v1/notifications/channels/${id}/test/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await safeJson(res);
    if (!res.ok) {
      throw new Error(data?.error || data?.detail || 'Test failed');
    }
    // Refresh channels to get updated verification status
    await fetchChannels();
    return data;
  }, [apiBase, fetchChannels]);

  // Toggle channel enabled status
  const toggleChannel = useCallback(async (channel) => {
    return updateChannel(channel.id, { enabled: !channel.enabled });
  }, [updateChannel]);

  useEffect(() => {
    mountedRef.current = true;
    fetchChannels();
    fetchChannelTypes();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchChannels, fetchChannelTypes]);

  return {
    channels,
    channelTypes,
    loading,
    error,
    refetch: fetchChannels,
    createChannel,
    updateChannel,
    deleteChannel,
    testChannel,
    toggleChannel,
  };
}

export default useNotificationChannels;
