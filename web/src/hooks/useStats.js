import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Hook for fetching extended statistics data from Django API
 * Provides tracking quality, engagement, favorites, flight patterns,
 * geographic stats, and combined stats data
 *
 * Django API endpoints:
 * - /api/v1/stats/tracking-quality - Tracking quality metrics
 * - /api/v1/stats/engagement - Engagement stats
 * - /api/v1/stats/favorites - Favorites
 * - /api/v1/stats/flight-patterns - Flight patterns
 * - /api/v1/stats/geographic - Geographic stats
 * - /api/v1/stats/combined - Combined stats (all in one request)
 *
 * WebSocket: /ws/stats/ - StatsConsumer for real-time stats
 */
export function useStats(apiBase = '', options = {}) {
  const { wsRequest, wsConnected, hours = 24 } = options;

  // Stats data state
  const [trackingQuality, setTrackingQuality] = useState(null);
  const [engagement, setEngagement] = useState(null);
  const [favorites, setFavorites] = useState(null);
  const [flightPatterns, setFlightPatterns] = useState(null);
  const [geographicStats, setGeographicStats] = useState(null);
  const [combinedStats, setCombinedStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Track mounted state to prevent setState on unmounted component
  const mountedRef = useRef(true);

  // Helper to fetch data via WebSocket or HTTP
  const fetchData = useCallback(async (endpoint, socketEvent) => {
    try {
      // Try WebSocket first if available
      if (wsRequest && wsConnected && socketEvent) {
        try {
          const result = await wsRequest(socketEvent, { hours });
          if (result && !result.error) {
            return result;
          }
        } catch (wsErr) {
          console.debug(`WebSocket request failed for ${socketEvent}:`, wsErr.message);
          // Fall through to HTTP
        }
      }

      // HTTP fallback
      const baseUrl = (apiBase || '').replace(/\/$/, ''); // Strip trailing slash
      const res = await fetch(`${baseUrl}${endpoint}?hours=${hours}`);
      if (!res.ok) {
        // Return null for 404s (endpoint may not exist yet)
        if (res.status === 404) return null;
        throw new Error(`HTTP ${res.status}`);
      }

      // Check content type before parsing
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        return null;
      }
      return await res.json();
    } catch (err) {
      console.debug(`Failed to fetch ${endpoint}:`, err.message);
      return null;
    }
  }, [apiBase, wsRequest, wsConnected, hours]);

  // Fetch all stats - try combined endpoint first, then individual endpoints as fallback
  const fetchAllStats = useCallback(async () => {
    if (!mountedRef.current) return;
    setLoading(true);
    setError(null);

    try {
      // First try the combined endpoint (more efficient)
      const combined = await fetchData('/api/v1/stats/combined', 'stats-combined');

      if (combined && !combined.error) {
        // Combined endpoint returned data - extract individual sections
        if (!mountedRef.current) return;
        setCombinedStats(combined);
        setTrackingQuality(combined.tracking_quality || null);
        setEngagement(combined.engagement || null);
        setFavorites(combined.favorites || null);
        setFlightPatterns(combined.flight_patterns || null);
        setGeographicStats(combined.geographic || null);
      } else {
        // Combined endpoint not available, fetch individual endpoints
        const [
          tracking,
          engagementData,
          favoritesData,
          patterns,
          geographic
        ] = await Promise.all([
          fetchData('/api/v1/stats/tracking-quality', 'stats-tracking-quality'),
          fetchData('/api/v1/stats/engagement', 'stats-engagement'),
          fetchData('/api/v1/stats/favorites', 'stats-favorites'),
          fetchData('/api/v1/stats/flight-patterns', 'stats-flight-patterns'),
          fetchData('/api/v1/stats/geographic', 'stats-geographic')
        ]);

        // Check mounted before setting state
        if (!mountedRef.current) return;

        setTrackingQuality(tracking);
        setEngagement(engagementData);
        setFavorites(favoritesData);
        setFlightPatterns(patterns);
        setGeographicStats(geographic);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err.message);
        console.error('Failed to fetch stats:', err);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [fetchData]);

  // Fetch on mount and when hours change
  useEffect(() => {
    mountedRef.current = true;
    fetchAllStats();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchAllStats]);

  return {
    // New Django API stats
    trackingQuality,
    engagement,
    favorites,
    flightPatterns,
    geographicStats,
    combinedStats,
    // Legacy compatibility aliases
    sessionAnalytics: engagement,
    timeComparison: null, // Not available in new API
    acarsStats: null, // ACARS stats fetched separately via useSocketApi
    achievements: null, // Not available in new API
    // State
    loading,
    error,
    refetch: fetchAllStats
  };
}

export default useStats;
