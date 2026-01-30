import { useState, useEffect, useMemo, useRef } from 'react';
import { useSocketApi } from './useSocketApi';
import {
  TIME_RANGE_HOURS,
  buildFilterParams,
  computeStatsFromAircraft,
  computeTopAircraft,
  computeAltitudeData,
  computeFleetBreakdown,
  computeSafetyEventsByType
} from '../components/views/stats/statsHelpers';

/**
 * Custom hook for managing all stats data fetching and state
 * Consolidates data fetching logic from StatsView
 *
 * Now supports real-time pushed stats via Socket.IO stats:update events.
 * When pushed data is available, it's used instead of polling.
 */
export function useStatsData({
  apiBase,
  wsRequest,
  wsConnected,
  wsAircraft,
  wsStats,
  antennaAnalyticsProp,
  extendedStatsProp,
  filters
}) {
  const {
    timeRange,
    showMilitaryOnly,
    categoryFilter,
    minAltitude,
    maxAltitude,
    minDistance,
    maxDistance,
    aircraftType
  } = filters;

  // Local antenna analytics state - uses prop if available, otherwise fetches once on mount
  const [localAntennaAnalytics, setLocalAntennaAnalytics] = useState(null);
  const antennaAnalytics = antennaAnalyticsProp || localAntennaAnalytics;

  // Throughput history for graphs
  const [throughputHistory, setThroughputHistory] = useState([]);
  const [aircraftHistory, setAircraftHistory] = useState([]);
  const [lastMessageCount, setLastMessageCount] = useState(null);
  const [messageRate, setMessageRate] = useState(0);

  // Convert time range to hours
  const selectedHours = TIME_RANGE_HOURS[timeRange] || 24;

  // Build filter query params
  const filterParams = buildFilterParams({
    hours: selectedHours,
    showMilitaryOnly,
    categoryFilter,
    minAltitude,
    maxAltitude,
    minDistance,
    maxDistance,
    aircraftType
  });

  // Socket options
  const socketOpts = { wsRequest, wsConnected };

  // Fetch antenna analytics on mount if not provided via prop
  useEffect(() => {
    if (!antennaAnalyticsProp && wsRequest && wsConnected) {
      wsRequest('antenna-analytics', {})
        .then(data => {
          if (data && !data.error) {
            setLocalAntennaAnalytics(data);
          }
        })
        .catch(err => console.debug('Antenna analytics fetch error:', err.message));
    }
  }, [antennaAnalyticsProp, wsRequest, wsConnected]);

  // Aircraft data from WebSocket push (array of aircraft objects)
  const aircraftData = wsAircraft || null;

  // Compute real-time stats from pushed aircraft array (client-side)
  const computedStats = useMemo(() => {
    return computeStatsFromAircraft(wsAircraft, wsStats);
  }, [wsAircraft, wsStats]);

  // Fetch detailed stats only when socket not connected or for filtered queries
  const { data: fetchedStats } = useSocketApi(
    `/api/v1/aircraft/stats?${filterParams}`,
    wsConnected ? null : 30000,
    apiBase,
    socketOpts
  );

  // Use computed stats from WebSocket push, fall back to fetched
  const stats = computedStats || fetchedStats;

  // Top aircraft - computed from pushed aircraft data or fetched once
  const computedTop = useMemo(() => {
    return computeTopAircraft(wsAircraft);
  }, [wsAircraft]);

  const { data: fetchedTop } = useSocketApi(
    '/api/v1/aircraft/top',
    wsConnected ? null : 30000,
    apiBase,
    socketOpts
  );

  const top = computedTop || fetchedTop;

  // Historical data - fetch once, refresh only on filter change (no interval polling)
  const { data: histStats } = useSocketApi(`/api/v1/history/stats?${filterParams}`, null, apiBase, socketOpts);
  const { data: acarsStats, loading: acarsStatsLoading } = useSocketApi(`/api/v1/acars/stats?hours=${selectedHours}`, null, apiBase, socketOpts);
  const { data: safetyStats } = useSocketApi(`/api/v1/safety/stats?hours=${selectedHours}`, null, apiBase, socketOpts);
  const { data: sessionsData } = useSocketApi(`/api/v1/sessions?hours=${selectedHours}&limit=500${showMilitaryOnly ? '&military_only=true' : ''}`, null, apiBase, socketOpts);

  // System status from Django API - very infrequent polling (5 min) or socket request
  const { data: systemData } = useSocketApi('/api/v1/system/status', wsConnected ? null : 300000, apiBase, socketOpts);

  // Analytics endpoints - fetch once, no polling (data doesn't change rapidly)
  const { data: trendsData } = useSocketApi(`/api/v1/history/trends?${filterParams}&interval=hour`, null, apiBase, socketOpts);
  const { data: topPerformersData } = useSocketApi(`/api/v1/history/top?${filterParams}&limit=10`, null, apiBase, socketOpts);
  const { data: distanceAnalytics } = useSocketApi(`/api/v1/history/analytics/distance?${filterParams}`, null, apiBase, socketOpts);
  const { data: speedAnalytics } = useSocketApi(`/api/v1/history/analytics/speed?${filterParams}`, null, apiBase, socketOpts);
  const { data: correlationData } = useSocketApi(`/api/v1/history/analytics/correlation?${filterParams}`, null, apiBase, socketOpts);

  // Extended stats from Django API (with pushed data override)
  // When Socket.IO pushes stats:update events, use that data instead of fetching
  const { data: fetchedFlightPatterns, loading: flightPatternsLoading } = useSocketApi(`/api/v1/stats/flight-patterns?${filterParams}`, null, apiBase, socketOpts);
  const { data: fetchedGeographic, loading: geographicLoading } = useSocketApi(`/api/v1/stats/geographic?${filterParams}`, null, apiBase, socketOpts);
  const { data: fetchedTrackingQuality, loading: trackingQualityLoading } = useSocketApi(`/api/v1/stats/tracking-quality?${filterParams}`, null, apiBase, socketOpts);
  const { data: fetchedEngagement, loading: engagementLoading } = useSocketApi(`/api/v1/stats/engagement?${filterParams}`, null, apiBase, socketOpts);
  const { data: favoritesData, loading: favoritesLoading } = useSocketApi(`/api/v1/stats/favorites?hours=${selectedHours}`, null, apiBase, socketOpts);

  // Use pushed stats when available, otherwise use fetched data
  const flightPatternsData = extendedStatsProp?.flightPatterns || fetchedFlightPatterns;
  const geographicData = extendedStatsProp?.geographic || fetchedGeographic;
  const trackingQualityData = extendedStatsProp?.trackingQuality || fetchedTrackingQuality;
  const engagementData = extendedStatsProp?.engagement || fetchedEngagement;

  // Track throughput over time
  useEffect(() => {
    if (!stats) return;

    const now = Date.now();
    const currentMessages = stats.messages || 0;

    let rate = 0;
    if (lastMessageCount !== null && throughputHistory.length > 0) {
      const lastPoint = throughputHistory[throughputHistory.length - 1];
      const timeDiff = (now - lastPoint.time) / 1000;
      if (timeDiff > 0) {
        rate = (currentMessages - lastMessageCount) / timeDiff;
        if (rate < 0) rate = 0;
      }
    }
    setLastMessageCount(currentMessages);
    setMessageRate(rate);

    const newPoint = {
      time: now,
      messages: rate,
      aircraft: stats.total || 0,
      withPosition: stats.with_position || 0
    };

    setThroughputHistory(prev => [...prev, newPoint].slice(-60));
    setAircraftHistory(prev => [...prev, { time: now, count: stats.total || 0 }].slice(-60));
  }, [stats]);

  // Computed data for charts
  const altitudeData = useMemo(() => computeAltitudeData(stats), [stats]);
  const fleetBreakdown = useMemo(() => computeFleetBreakdown(sessionsData, showMilitaryOnly), [sessionsData, showMilitaryOnly]);
  const safetyEventsByType = useMemo(() => computeSafetyEventsByType(safetyStats), [safetyStats]);

  const emergencyAircraft = stats?.emergency_squawks || [];

  return {
    // Core stats
    stats,
    top,
    aircraftData,
    emergencyAircraft,
    messageRate,

    // Historical data
    histStats,
    acarsStats,
    acarsStatsLoading,
    safetyStats,
    sessionsData,
    systemData,

    // Analytics data
    trendsData,
    topPerformersData,
    distanceAnalytics,
    speedAnalytics,
    correlationData,

    // Extended stats
    flightPatternsData,
    flightPatternsLoading,
    geographicData,
    geographicLoading,
    trackingQualityData,
    trackingQualityLoading,
    engagementData,
    engagementLoading,
    favoritesData,
    favoritesLoading,

    // Antenna analytics
    antennaAnalytics,

    // Chart data
    altitudeData,
    fleetBreakdown,
    safetyEventsByType,
    throughputHistory,
    aircraftHistory,

    // Helpers
    selectedHours,
    filterParams
  };
}

export default useStatsData;
