import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

/**
 * Hook for tracking session statistics for Pro Mode
 * Tracks metrics over the current browsing session including:
 * - Session duration
 * - Total unique aircraft tracked
 * - Peak simultaneous count (and timestamp)
 * - Aircraft by category breakdown
 * - Top 5 most seen aircraft types
 * - Max range achieved
 * - Total position updates
 */

// Category names for breakdown display
const CATEGORY_NAMES = {
  A0: 'Unknown',
  A1: 'Light',
  A2: 'Small',
  A3: 'Large',
  A4: 'High Vortex',
  A5: 'Heavy',
  A6: 'High Perf',
  A7: 'Rotorcraft',
  B0: 'Unknown',
  B1: 'Glider',
  B2: 'Lighter-than-air',
  B3: 'Parachutist',
  B4: 'Ultralight',
  B5: 'Reserved',
  B6: 'UAV',
  B7: 'Space Vehicle',
  C0: 'Emergency',
  C1: 'Surface Vehicle',
  C2: 'Point Obstacle',
  C3: 'Cluster Obstacle',
};

/**
 * @typedef {Object} SessionStats
 * @property {number} sessionStartTime - Timestamp when session started
 * @property {number} sessionDuration - Duration in milliseconds
 * @property {string} sessionDurationFormatted - Human-readable duration
 * @property {number} uniqueAircraftCount - Total unique aircraft seen
 * @property {number} currentCount - Current number of aircraft
 * @property {number} peakSimultaneousCount - Maximum aircraft at one time
 * @property {number} peakSimultaneousTime - Timestamp of peak
 * @property {Object} categoryBreakdown - Aircraft counts by category
 * @property {Array} topAircraftTypes - Top 5 most seen aircraft types
 * @property {number} maxRangeNm - Maximum range seen in nautical miles
 * @property {string} maxRangeAircraft - Aircraft hex that achieved max range
 * @property {number} totalPositionUpdates - Total position updates received
 */

/**
 * Track session statistics
 * @param {Array} aircraft - Current aircraft array from socket/API
 * @param {Object} options - Configuration options
 * @param {boolean} options.enabled - Whether to track stats (default: true)
 * @param {number} options.updateInterval - How often to update duration (default: 1000ms)
 * @returns {SessionStats}
 */
export function useSessionStats(aircraft = [], options = {}) {
  const { enabled = true, updateInterval = 1000 } = options;

  // Session start timestamp
  const sessionStartRef = useRef(Date.now());

  // Tracking refs (mutable for performance)
  const uniqueAircraftRef = useRef(new Set());
  const categoryCountsRef = useRef({});
  const typeCountsRef = useRef({});
  const peakCountRef = useRef({ count: 0, time: null });
  const maxRangeRef = useRef({ range: 0, hex: null });
  const positionUpdatesRef = useRef(0);
  const lastAircraftCountRef = useRef(0);

  // State for UI updates
  const [sessionDuration, setSessionDuration] = useState(0);
  const [stats, setStats] = useState({
    uniqueAircraftCount: 0,
    currentCount: 0,
    peakSimultaneousCount: 0,
    peakSimultaneousTime: null,
    categoryBreakdown: {},
    topAircraftTypes: [],
    maxRangeNm: 0,
    maxRangeAircraft: null,
    totalPositionUpdates: 0,
  });

  // Update session duration every second
  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(() => {
      setSessionDuration(Date.now() - sessionStartRef.current);
    }, updateInterval);

    return () => clearInterval(interval);
  }, [enabled, updateInterval]);

  // Process aircraft updates
  useEffect(() => {
    if (!enabled || !aircraft || aircraft.length === 0) return;

    // Count position updates (each aircraft with position is an update)
    const aircraftWithPosition = aircraft.filter((ac) => ac.lat && ac.lon);
    positionUpdatesRef.current += aircraftWithPosition.length;

    // Track unique aircraft
    aircraft.forEach((ac) => {
      if (ac.hex) {
        const isNew = !uniqueAircraftRef.current.has(ac.hex);
        uniqueAircraftRef.current.add(ac.hex);

        // Only count category/type for new aircraft to avoid over-counting
        if (isNew) {
          // Track category
          const category = ac.category || 'Unknown';
          categoryCountsRef.current[category] = (categoryCountsRef.current[category] || 0) + 1;

          // Track aircraft type
          const type = ac.t || ac.type || ac.desc || 'Unknown';
          if (type && type !== 'Unknown') {
            typeCountsRef.current[type] = (typeCountsRef.current[type] || 0) + 1;
          }
        }

        // Track max range
        const range = ac.distance_nm || ac.r_dst;
        if (range && range > maxRangeRef.current.range) {
          maxRangeRef.current = { range, hex: ac.hex };
        }
      }
    });

    // Track peak simultaneous count
    const currentCount = aircraftWithPosition.length;
    if (currentCount > peakCountRef.current.count) {
      peakCountRef.current = { count: currentCount, time: Date.now() };
    }

    // Update last count for change detection
    lastAircraftCountRef.current = currentCount;
  }, [aircraft, enabled]);

  // Update stats state periodically (debounced for performance)
  useEffect(() => {
    if (!enabled) return;

    const updateStats = () => {
      // Get top 5 aircraft types
      const sortedTypes = Object.entries(typeCountsRef.current)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([type, count]) => ({ type, count }));

      // Get category breakdown with names
      const categoryBreakdown = {};
      Object.entries(categoryCountsRef.current).forEach(([cat, count]) => {
        const name = CATEGORY_NAMES[cat] || cat;
        categoryBreakdown[name] = count;
      });

      const aircraftWithPosition = (aircraft || []).filter((ac) => ac.lat && ac.lon);

      setStats({
        uniqueAircraftCount: uniqueAircraftRef.current.size,
        currentCount: aircraftWithPosition.length,
        peakSimultaneousCount: peakCountRef.current.count,
        peakSimultaneousTime: peakCountRef.current.time,
        categoryBreakdown,
        topAircraftTypes: sortedTypes,
        maxRangeNm: maxRangeRef.current.range,
        maxRangeAircraft: maxRangeRef.current.hex,
        totalPositionUpdates: positionUpdatesRef.current,
      });
    };

    // Update stats every 2 seconds to avoid excessive re-renders
    const interval = setInterval(updateStats, 2000);
    updateStats(); // Initial update

    return () => clearInterval(interval);
  }, [aircraft, enabled]);

  // Format session duration
  const sessionDurationFormatted = useMemo(() => {
    const seconds = Math.floor(sessionDuration / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }, [sessionDuration]);

  // Format peak time
  const peakTimeFormatted = useMemo(() => {
    if (!stats.peakSimultaneousTime) return null;
    return new Date(stats.peakSimultaneousTime).toLocaleTimeString();
  }, [stats.peakSimultaneousTime]);

  // Reset session stats
  const resetSession = useCallback(() => {
    sessionStartRef.current = Date.now();
    uniqueAircraftRef.current = new Set();
    categoryCountsRef.current = {};
    typeCountsRef.current = {};
    peakCountRef.current = { count: 0, time: null };
    maxRangeRef.current = { range: 0, hex: null };
    positionUpdatesRef.current = 0;
    lastAircraftCountRef.current = 0;
    setSessionDuration(0);
    setStats({
      uniqueAircraftCount: 0,
      currentCount: 0,
      peakSimultaneousCount: 0,
      peakSimultaneousTime: null,
      categoryBreakdown: {},
      topAircraftTypes: [],
      maxRangeNm: 0,
      maxRangeAircraft: null,
      totalPositionUpdates: 0,
    });
  }, []);

  return {
    // Timing
    sessionStartTime: sessionStartRef.current,
    sessionDuration,
    sessionDurationFormatted,

    // Counts
    uniqueAircraftCount: stats.uniqueAircraftCount,
    currentCount: stats.currentCount,
    peakSimultaneousCount: stats.peakSimultaneousCount,
    peakSimultaneousTime: stats.peakSimultaneousTime,
    peakTimeFormatted,

    // Breakdowns
    categoryBreakdown: stats.categoryBreakdown,
    topAircraftTypes: stats.topAircraftTypes,

    // Range
    maxRangeNm: stats.maxRangeNm,
    maxRangeAircraft: stats.maxRangeAircraft,

    // Updates
    totalPositionUpdates: stats.totalPositionUpdates,

    // Actions
    resetSession,
  };
}

export default useSessionStats;
