import { useState, useEffect, useCallback, useRef } from 'react';

// NOTAM type configuration with colors and icons
export const NOTAM_TYPE_CONFIG = {
  D: { color: '#60a5fa', icon: 'Info', label: 'NOTAM D' },
  FDC: { color: '#f59e0b', icon: 'AlertCircle', label: 'FDC NOTAM' },
  TFR: { color: '#ef4444', icon: 'Shield', label: 'TFR' },
  GPS: { color: '#8b5cf6', icon: 'Navigation', label: 'GPS NOTAM' },
  MIL: { color: '#10b981', icon: 'Shield', label: 'Military' },
  POINTER: { color: '#6b7280', icon: 'ExternalLink', label: 'Pointer' },
};

// Storage key for acknowledged NOTAMs
const ACKNOWLEDGED_KEY = 'skyspy_acknowledged_notams';

/**
 * Hook for fetching and managing NOTAMs via Socket.IO for map display
 *
 * @param {Function} wsRequest - Request function from useSocketIOData
 * @param {boolean} wsConnected - Whether Socket.IO is connected
 * @param {object} options - Additional options
 * @param {string} options.typeFilter - Filter by NOTAM type (null = all)
 * @param {number} options.refreshInterval - Auto-refresh interval in ms (default: 300000 = 5 min)
 * @param {number} options.lat - Center latitude for area filtering
 * @param {number} options.lon - Center longitude for area filtering
 * @param {number} options.radius - Radius in nm for area filtering
 */
export function useNotams(wsRequest, wsConnected, options = {}) {
  const { typeFilter = null, refreshInterval = 300000, lat, lon, radius } = options;

  const [notams, setNotams] = useState([]);
  const [tfrs, setTfrs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [acknowledged, setAcknowledged] = useState(() => {
    try {
      const stored = localStorage.getItem(ACKNOWLEDGED_KEY);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  const lastFetchRef = useRef(0);
  const mountedRef = useRef(true);

  // Persist acknowledged set to localStorage
  const persistAcknowledged = useCallback((newSet) => {
    try {
      localStorage.setItem(ACKNOWLEDGED_KEY, JSON.stringify([...newSet]));
    } catch {
      // Storage might be full or disabled
    }
  }, []);

  // Acknowledge a NOTAM
  const acknowledgeNotam = useCallback(
    (notamId) => {
      setAcknowledged((prev) => {
        const newSet = new Set(prev);
        newSet.add(notamId);
        persistAcknowledged(newSet);
        return newSet;
      });
    },
    [persistAcknowledged]
  );

  // Unacknowledge a NOTAM
  const unacknowledgeNotam = useCallback(
    (notamId) => {
      setAcknowledged((prev) => {
        const newSet = new Set(prev);
        newSet.delete(notamId);
        persistAcknowledged(newSet);
        return newSet;
      });
    },
    [persistAcknowledged]
  );

  // Clear all acknowledged
  const clearAcknowledged = useCallback(() => {
    setAcknowledged(new Set());
    persistAcknowledged(new Set());
  }, [persistAcknowledged]);

  // Fetch NOTAMs
  const fetchNotams = useCallback(async () => {
    if (!wsRequest || !wsConnected) {
      setError('Socket not connected');
      setLoading(false);
      return;
    }

    // Debounce - don't fetch more than once per 10 seconds
    const now = Date.now();
    if (now - lastFetchRef.current < 10000) return;
    lastFetchRef.current = now;

    setLoading(true);
    setError(null);

    try {
      const params = {};
      if (lat && lon) {
        params.lat = lat;
        params.lon = lon;
      }
      if (radius) {
        params.radius = radius;
      }
      if (typeFilter) {
        params.type = typeFilter;
      }

      const response = await wsRequest('notams-list', params, 30000);

      if (!mountedRef.current) return;

      // Handle response format - could be { notams, tfrs } or just array
      let notamsData = [];
      let tfrsData = [];

      if (response?.notams) {
        notamsData = response.notams;
        tfrsData = response.tfrs || [];
      } else if (Array.isArray(response)) {
        notamsData = response;
      } else if (response?.data) {
        notamsData = response.data;
      }

      // Filter out expired NOTAMs
      const now = new Date();
      const activeNotams = notamsData.filter((notam) => {
        if (!notam.effective_end || notam.is_permanent) return true;
        const effectiveEnd = new Date(notam.effective_end);
        return effectiveEnd > now;
      });

      setNotams(activeNotams);
      setTfrs(tfrsData);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      console.error('NOTAMs fetch error:', err);
      setError(err.message || 'Failed to fetch NOTAMs');
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [wsRequest, wsConnected, typeFilter, lat, lon, radius]);

  // Initial fetch when connected
  useEffect(() => {
    mountedRef.current = true;

    if (!wsConnected || !wsRequest) {
      return;
    }

    // Fetch with small delay after connection
    const timeout = setTimeout(() => {
      fetchNotams();
    }, 1000);

    return () => {
      mountedRef.current = false;
      clearTimeout(timeout);
    };
  }, [wsConnected, wsRequest, fetchNotams]);

  // Auto-refresh interval
  useEffect(() => {
    if (!wsConnected || !wsRequest || !refreshInterval) {
      return;
    }

    const interval = setInterval(fetchNotams, refreshInterval);
    return () => clearInterval(interval);
  }, [wsConnected, wsRequest, refreshInterval, fetchNotams]);

  // Combine NOTAMs and TFRs for display
  const allNotams = [...notams, ...tfrs.map((tfr) => ({ ...tfr, type: 'TFR' }))];

  // Filter by type if needed (client-side filtering)
  const filteredNotams = typeFilter ? allNotams.filter((n) => n.type === typeFilter) : allNotams;

  // Get unacknowledged count
  const unacknowledgedCount = filteredNotams.filter(
    (n) => !acknowledged.has(n.notam_id || n.id)
  ).length;

  // Get NOTAMs grouped by type
  const notamsByType = filteredNotams.reduce((acc, notam) => {
    const type = notam.type || 'D';
    if (!acc[type]) acc[type] = [];
    acc[type].push(notam);
    return acc;
  }, {});

  return {
    notams: filteredNotams,
    notamsByType,
    loading,
    error,
    acknowledged,
    acknowledgeNotam,
    unacknowledgeNotam,
    clearAcknowledged,
    unacknowledgedCount,
    totalCount: filteredNotams.length,
    refresh: fetchNotams,
    isAcknowledged: (id) => acknowledged.has(id),
  };
}

export default useNotams;
