import { useState, useEffect, useCallback, useRef } from 'react';

// Hazard type configuration with colors and icons
export const HAZARD_CONFIG = {
  IFR: { color: '#8b8b8b', icon: 'Cloud', label: 'IFR' },
  TURB: { color: '#ffa500', icon: 'Wind', label: 'Turbulence' },
  ICE: { color: '#00bfff', icon: 'Snowflake', label: 'Icing' },
  TS: { color: '#ff4444', icon: 'CloudLightning', label: 'Thunderstorm' },
  MT_OBSC: { color: '#a0a0a0', icon: 'Mountain', label: 'Mountain Obscuration' },
  VOLCANIC_ASH: { color: '#8b0000', icon: 'AlertTriangle', label: 'Volcanic Ash' },
  LLWS: { color: '#ff6600', icon: 'Wind', label: 'Low Level Wind Shear' },
  SFC_WND: { color: '#cc9900', icon: 'Wind', label: 'Surface Wind' },
  FZLVL: { color: '#66ccff', icon: 'Snowflake', label: 'Freezing Level' },
};

// Storage key for acknowledged advisories
const ACKNOWLEDGED_KEY = 'skyspy_acknowledged_advisories';

/**
 * Hook for fetching and managing airspace advisories via Socket.IO
 *
 * @param {Function} wsRequest - Request function from useSocketIOData
 * @param {boolean} wsConnected - Whether Socket.IO is connected
 * @param {object} options - Additional options
 * @param {string} options.hazardFilter - Filter by hazard type (null = all)
 * @param {number} options.refreshInterval - Auto-refresh interval in ms (default: 60000)
 */
export function useAirspaceAdvisories(wsRequest, wsConnected, options = {}) {
  const { hazardFilter = null, refreshInterval = 60000 } = options;

  const [advisories, setAdvisories] = useState([]);
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

  // Acknowledge an advisory
  const acknowledgeAdvisory = useCallback(
    (advisoryId) => {
      setAcknowledged((prev) => {
        const newSet = new Set(prev);
        newSet.add(advisoryId);
        persistAcknowledged(newSet);
        return newSet;
      });
    },
    [persistAcknowledged]
  );

  // Unacknowledge an advisory
  const unacknowledgeAdvisory = useCallback(
    (advisoryId) => {
      setAcknowledged((prev) => {
        const newSet = new Set(prev);
        newSet.delete(advisoryId);
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

  // Fetch advisories
  const fetchAdvisories = useCallback(async () => {
    if (!wsRequest || !wsConnected) {
      setError('Socket not connected');
      setLoading(false);
      return;
    }

    // Debounce - don't fetch more than once per 5 seconds
    const now = Date.now();
    if (now - lastFetchRef.current < 5000) return;
    lastFetchRef.current = now;

    setLoading(true);
    setError(null);

    try {
      const params = hazardFilter ? { hazard: hazardFilter } : {};
      const response = await wsRequest('airspaces', params, 20000);

      if (!mountedRef.current) return;

      const data = response?.advisories || response?.data || [];

      // Filter out expired advisories
      const now = new Date();
      const activeAdvisories = data.filter((adv) => {
        if (!adv.valid_to) return true;
        const validTo = new Date(adv.valid_to);
        return validTo > now;
      });

      setAdvisories(activeAdvisories);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      console.error('Airspace advisories fetch error:', err);
      setError(err.message || 'Failed to fetch advisories');
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [wsRequest, wsConnected, hazardFilter]);

  // Initial fetch when connected
  useEffect(() => {
    mountedRef.current = true;

    if (!wsConnected || !wsRequest) {
      return;
    }

    // Fetch with small delay after connection
    const timeout = setTimeout(() => {
      fetchAdvisories();
    }, 500);

    return () => {
      mountedRef.current = false;
      clearTimeout(timeout);
    };
  }, [wsConnected, wsRequest, fetchAdvisories]);

  // Auto-refresh interval
  useEffect(() => {
    if (!wsConnected || !wsRequest || !refreshInterval) {
      return;
    }

    const interval = setInterval(fetchAdvisories, refreshInterval);
    return () => clearInterval(interval);
  }, [wsConnected, wsRequest, refreshInterval, fetchAdvisories]);

  // Listen for real-time updates
  useEffect(() => {
    // Note: The socket event listeners would be set up in the parent component
    // that manages the socket connection. This hook just provides the data
    // management layer.
  }, []);

  // Filter advisories by hazard type if needed (client-side filtering)
  const filteredAdvisories = hazardFilter
    ? advisories.filter((adv) => adv.hazard === hazardFilter)
    : advisories;

  // Get unacknowledged count
  const unacknowledgedCount = filteredAdvisories.filter(
    (adv) => !acknowledged.has(adv.id)
  ).length;

  // Get advisories grouped by hazard type
  const advisoriesByHazard = filteredAdvisories.reduce((acc, adv) => {
    const hazard = adv.hazard || 'OTHER';
    if (!acc[hazard]) acc[hazard] = [];
    acc[hazard].push(adv);
    return acc;
  }, {});

  return {
    advisories: filteredAdvisories,
    advisoriesByHazard,
    loading,
    error,
    acknowledged,
    acknowledgeAdvisory,
    unacknowledgeAdvisory,
    clearAcknowledged,
    unacknowledgedCount,
    totalCount: filteredAdvisories.length,
    refresh: fetchAdvisories,
    isAcknowledged: (id) => acknowledged.has(id),
  };
}

export default useAirspaceAdvisories;
