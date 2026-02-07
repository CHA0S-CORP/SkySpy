import { useState, useCallback, useEffect, useRef, useMemo } from 'react';

/**
 * Time range presets for playback mode
 */
export const TIME_RANGE_PRESETS = [
  { hours: 1, label: 'Last 1 hour' },
  { hours: 6, label: 'Last 6 hours' },
  { hours: 24, label: 'Last 24 hours' },
];

/**
 * Available playback speeds
 */
export const PLAYBACK_SPEEDS = [1, 2, 4, 8, 16];

/**
 * Helper to safely parse JSON from fetch response
 */
const safeJson = async (res) => {
  if (!res.ok) return null;
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
};

/**
 * Interpolate heading (handles 360/0 wraparound)
 */
const interpolateHeading = (h1, h2, ratio) => {
  if (h1 == null || h2 == null) return h1 || h2;

  // Normalize to 0-360
  h1 = ((h1 % 360) + 360) % 360;
  h2 = ((h2 % 360) + 360) % 360;

  // Find shortest path
  let delta = h2 - h1;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;

  const result = h1 + delta * ratio;
  return ((result % 360) + 360) % 360;
};

/**
 * Hook for managing historical track playback mode
 *
 * Features:
 * - Fetches historical sightings data for a time range
 * - Manages playback state (playing, paused, speed, currentTime)
 * - Interpolates aircraft positions between data points
 * - Provides formatted time displays
 * - Supports playback speeds: 1x, 2x, 4x, 8x, 16x
 *
 * @param {Object} options
 * @param {string} options.apiBaseUrl - Base URL for API calls
 * @param {Function} options.wsRequest - WebSocket request function
 * @param {boolean} options.wsConnected - Whether WebSocket is connected
 * @param {number} options.feederLat - Feeder latitude for filtering
 * @param {number} options.feederLon - Feeder longitude for filtering
 * @param {number} options.radarRange - Radar range in nm
 */
export function useTrackPlayback({
  apiBaseUrl = '',
  wsRequest,
  wsConnected,
  feederLat: _feederLat,
  feederLon: _feederLon,
  radarRange: _radarRange = 50,
} = {}) {
  // Core playback state
  const [isPlayback, setIsPlayback] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeedState] = useState(1);
  const [playbackPercent, setPlaybackPercent] = useState(0);
  const [selectedHours, setSelectedHours] = useState(1);

  // Custom time range state
  const [customTimeRange, setCustomTimeRange] = useState(null); // { start: Date, end: Date }

  // Data state
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [historySightings, setHistorySightings] = useState([]);

  // Refs for animation
  const animationFrameRef = useRef(null);
  const lastTimeRef = useRef(null);
  const playbackStateRef = useRef({ isPlaying: false, speed: 1, percent: 0 });

  // Keep ref in sync with state
  useEffect(() => {
    playbackStateRef.current = {
      isPlaying,
      speed: playbackSpeed,
      percent: playbackPercent,
    };
  }, [isPlaying, playbackSpeed, playbackPercent]);

  /**
   * Calculate time range based on selected hours or custom range
   */
  const timeRange = useMemo(() => {
    if (!isPlayback) return null;

    if (customTimeRange) {
      return customTimeRange;
    }

    const end = new Date();
    const start = new Date(end.getTime() - selectedHours * 60 * 60 * 1000);
    return { start, end };
  }, [isPlayback, selectedHours, customTimeRange]);

  /**
   * Calculate current playback time based on percent
   */
  const currentTime = useMemo(() => {
    if (!timeRange) return null;
    const totalMs = timeRange.end.getTime() - timeRange.start.getTime();
    const currentMs = timeRange.start.getTime() + (playbackPercent / 100) * totalMs;
    return new Date(currentMs);
  }, [timeRange, playbackPercent]);

  /**
   * Format time for display
   */
  const formattedTime = useMemo(() => {
    if (!currentTime) return '--:--:--';
    return currentTime.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }, [currentTime]);

  /**
   * Format date for display
   */
  const formattedDate = useMemo(() => {
    if (!currentTime) return '';
    return currentTime.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }, [currentTime]);

  /**
   * Format duration for display
   */
  const duration = useMemo(() => {
    if (customTimeRange) {
      const diffMs = customTimeRange.end.getTime() - customTimeRange.start.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);
      if (diffHours < 1) {
        const minutes = Math.round(diffHours * 60);
        return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
      }
      return `${diffHours.toFixed(1)} hours`;
    }
    if (selectedHours === 1) return '1 hour';
    return `${selectedHours} hours`;
  }, [selectedHours, customTimeRange]);

  /**
   * Calculate history stats
   */
  const historyStats = useMemo(() => {
    const uniqueIcaos = new Set(historySightings.map((s) => s.icao_hex?.toUpperCase()));
    return {
      uniqueAircraft: uniqueIcaos.size,
      totalSightings: historySightings.length,
    };
  }, [historySightings]);

  /**
   * Group sightings by aircraft ICAO for efficient lookup
   */
  const sightingsByAircraft = useMemo(() => {
    const grouped = {};
    historySightings.forEach((sighting) => {
      const icao = sighting.icao_hex?.toUpperCase();
      if (!icao) return;
      if (!grouped[icao]) grouped[icao] = [];
      grouped[icao].push(sighting);
    });
    // Sort each aircraft's sightings by timestamp
    Object.keys(grouped).forEach((icao) => {
      grouped[icao].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    });
    return grouped;
  }, [historySightings]);

  /**
   * Get interpolated aircraft positions at the current playback time
   */
  const getPlaybackAircraft = useCallback(() => {
    if (!isPlayback || !currentTime || !timeRange) return [];

    const aircraft = [];
    const currentTimeMs = currentTime.getTime();

    Object.entries(sightingsByAircraft).forEach(([icao, sightings]) => {
      if (sightings.length === 0) return;

      // Find the two sightings that bracket the current time
      let before = null;
      let after = null;

      for (let i = 0; i < sightings.length; i++) {
        const sightingTime = new Date(sightings[i].timestamp).getTime();
        if (sightingTime <= currentTimeMs) {
          before = sightings[i];
        } else if (sightingTime > currentTimeMs && !after) {
          after = sightings[i];
          break;
        }
      }

      // If we have no data before current time, skip this aircraft
      if (!before) return;

      // If we only have before data (no future point), use it directly
      // But only if it's within 5 minutes of current time (aircraft may have left)
      const beforeTime = new Date(before.timestamp).getTime();
      const timeSinceBefore = currentTimeMs - beforeTime;
      const maxStaleMs = 5 * 60 * 1000; // 5 minutes

      if (timeSinceBefore > maxStaleMs) return;

      let position;
      if (!after) {
        // No future point, use the last known position
        position = { ...before };
      } else {
        // Interpolate between before and after
        const afterTime = new Date(after.timestamp).getTime();
        const totalDelta = afterTime - beforeTime;
        const currentDelta = currentTimeMs - beforeTime;
        const ratio = totalDelta > 0 ? currentDelta / totalDelta : 0;

        position = {
          ...before,
          lat: before.lat + (after.lat - before.lat) * ratio,
          lon: before.lon + (after.lon - before.lon) * ratio,
          altitude:
            before.altitude != null && after.altitude != null
              ? Math.round(before.altitude + (after.altitude - before.altitude) * ratio)
              : before.altitude,
          gs:
            before.gs != null && after.gs != null
              ? Math.round(before.gs + (after.gs - before.gs) * ratio)
              : before.gs,
          track: interpolateHeading(before.track, after.track, ratio),
          vr:
            before.vr != null && after.vr != null
              ? Math.round(before.vr + (after.vr - before.vr) * ratio)
              : before.vr,
        };
      }

      // Convert to aircraft format expected by map
      aircraft.push({
        hex: icao,
        flight: position.callsign?.trim() || '',
        lat: position.lat,
        lon: position.lon,
        alt: position.altitude,
        gs: position.gs,
        track: position.track,
        vr: position.vr,
        squawk: position.squawk,
        timestamp: position.timestamp,
        // Add flag to indicate this is playback data
        isPlayback: true,
      });
    });

    return aircraft;
  }, [isPlayback, currentTime, timeRange, sightingsByAircraft]);

  /**
   * Fetch historical sightings
   */
  const fetchHistory = useCallback(
    async (hours, customRange = null) => {
      setIsLoading(true);
      setError(null);

      try {
        let data;
        const params = {};

        if (customRange) {
          params.start = customRange.start.toISOString();
          params.end = customRange.end.toISOString();
        } else {
          params.hours = hours;
        }
        params.limit = 100000; // Get lots of data for playback

        // Try WebSocket first if available
        if (wsRequest && wsConnected) {
          const result = await wsRequest('sightings', params);

          if (result?.error) {
            throw new Error(result.error);
          }

          data = result;
        } else {
          // Fall back to HTTP
          const searchParams = new URLSearchParams();
          Object.entries(params).forEach(([key, value]) => {
            searchParams.set(key, String(value));
          });

          const res = await fetch(`${apiBaseUrl}/api/v1/sightings?${searchParams}`);
          data = await safeJson(res);

          if (!data) {
            throw new Error('Failed to fetch history data');
          }
        }

        const sightings = data?.sightings || data?.results || [];
        setHistorySightings(sightings);
        setIsLoading(false);
        return true;
      } catch (err) {
        console.error('[TrackPlayback] Failed to fetch history:', err);
        setError(err.message || 'Failed to load history');
        setIsLoading(false);
        return false;
      }
    },
    [apiBaseUrl, wsRequest, wsConnected]
  );

  /**
   * Enter playback mode with a preset time range
   */
  const enterPlayback = useCallback(
    async (hours) => {
      setSelectedHours(hours);
      setCustomTimeRange(null);
      setIsPlayback(true);
      setPlaybackPercent(0);
      setIsPlaying(false);
      setPlaybackSpeedState(1);

      const success = await fetchHistory(hours);
      if (!success) {
        // If fetch failed, exit playback mode
        setIsPlayback(false);
      }
    },
    [fetchHistory]
  );

  /**
   * Set a custom time range for playback
   */
  const setTimeRange = useCallback(
    async (start, end) => {
      const customRange = { start: new Date(start), end: new Date(end) };
      setCustomTimeRange(customRange);
      setIsPlayback(true);
      setPlaybackPercent(0);
      setIsPlaying(false);
      setPlaybackSpeedState(1);

      const success = await fetchHistory(null, customRange);
      if (!success) {
        // If fetch failed, exit playback mode
        setIsPlayback(false);
      }
    },
    [fetchHistory]
  );

  /**
   * Exit playback mode
   */
  const exitPlayback = useCallback(() => {
    // Stop any running animation
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    setIsPlayback(false);
    setIsPlaying(false);
    setPlaybackPercent(0);
    setHistorySightings([]);
    setError(null);
    setCustomTimeRange(null);
    setPlaybackSpeedState(1);
  }, []);

  /**
   * Play playback
   */
  const play = useCallback(() => {
    setIsPlaying(true);
  }, []);

  /**
   * Pause playback
   */
  const pause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  /**
   * Toggle play/pause
   */
  const togglePlayPause = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);

  /**
   * Set playback speed
   */
  const setSpeed = useCallback((speed) => {
    // Validate speed is one of the allowed values
    if (PLAYBACK_SPEEDS.includes(speed)) {
      setPlaybackSpeedState(speed);
    }
  }, []);

  /**
   * Cycle to next speed
   */
  const cycleSpeedUp = useCallback(() => {
    setPlaybackSpeedState((prev) => {
      const currentIndex = PLAYBACK_SPEEDS.indexOf(prev);
      const nextIndex = Math.min(currentIndex + 1, PLAYBACK_SPEEDS.length - 1);
      return PLAYBACK_SPEEDS[nextIndex];
    });
  }, []);

  /**
   * Cycle to previous speed
   */
  const cycleSpeedDown = useCallback(() => {
    setPlaybackSpeedState((prev) => {
      const currentIndex = PLAYBACK_SPEEDS.indexOf(prev);
      const nextIndex = Math.max(currentIndex - 1, 0);
      return PLAYBACK_SPEEDS[nextIndex];
    });
  }, []);

  /**
   * Seek to a specific percent (0-100)
   */
  const seekPercent = useCallback((percent) => {
    setPlaybackPercent(Math.max(0, Math.min(100, percent)));
  }, []);

  /**
   * Seek to a specific time
   */
  const seekTo = useCallback(
    (time) => {
      if (!timeRange) return;
      const targetTime = new Date(time).getTime();
      const totalMs = timeRange.end.getTime() - timeRange.start.getTime();
      const percent = ((targetTime - timeRange.start.getTime()) / totalMs) * 100;
      setPlaybackPercent(Math.max(0, Math.min(100, percent)));
    },
    [timeRange]
  );

  /**
   * Skip forward by a number of seconds
   */
  const skipForward = useCallback(
    (seconds = 60) => {
      if (!timeRange) return;
      const totalMs = timeRange.end.getTime() - timeRange.start.getTime();
      const incrementPercent = ((seconds * 1000) / totalMs) * 100;
      setPlaybackPercent((prev) => Math.min(100, prev + incrementPercent));
    },
    [timeRange]
  );

  /**
   * Skip backward by a number of seconds
   */
  const skipBackward = useCallback(
    (seconds = 60) => {
      if (!timeRange) return;
      const totalMs = timeRange.end.getTime() - timeRange.start.getTime();
      const decrementPercent = ((seconds * 1000) / totalMs) * 100;
      setPlaybackPercent((prev) => Math.max(0, prev - decrementPercent));
    },
    [timeRange]
  );

  /**
   * Skip to start
   */
  const skipToStart = useCallback(() => {
    setPlaybackPercent(0);
    setIsPlaying(false);
  }, []);

  /**
   * Skip to end
   */
  const skipToEnd = useCallback(() => {
    setPlaybackPercent(100);
    setIsPlaying(false);
  }, []);

  /**
   * Animation loop for playback
   */
  useEffect(() => {
    if (!isPlaying || !isPlayback) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    lastTimeRef.current = performance.now();

    const animate = (frameTime) => {
      const { isPlaying: playing, speed, percent } = playbackStateRef.current;

      if (!playing) {
        animationFrameRef.current = null;
        return;
      }

      const deltaTime = frameTime - lastTimeRef.current;
      lastTimeRef.current = frameTime;

      // Calculate percent increment based on speed
      // At 1x speed, we want to cover 100% over the duration of the time range
      // increment per ms = 100 / (totalMs) * speed
      const totalMs = customTimeRange
        ? customTimeRange.end.getTime() - customTimeRange.start.getTime()
        : selectedHours * 60 * 60 * 1000;
      const incrementPerMs = (100 / totalMs) * speed;
      const increment = deltaTime * incrementPerMs;

      const newPercent = percent + increment;

      if (newPercent >= 100) {
        setPlaybackPercent(100);
        setIsPlaying(false);
      } else {
        setPlaybackPercent(newPercent);
        animationFrameRef.current = requestAnimationFrame(animate);
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isPlaying, isPlayback, selectedHours, customTimeRange]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return {
    // State
    isPlayback,
    isPlaying,
    playbackSpeed,
    playbackPercent,
    currentTime,
    timeRange,
    formattedTime,
    formattedDate,
    duration,
    isLoading,
    error,
    historyStats,
    historySightings,

    // Computed
    getPlaybackAircraft,

    // Actions
    play,
    pause,
    togglePlayPause,
    setSpeed,
    cycleSpeedUp,
    cycleSpeedDown,
    seekTo,
    seekPercent,
    skipForward,
    skipBackward,
    skipToStart,
    skipToEnd,
    setTimeRange,
    enterPlayback,
    exitPlayback,

    // Constants
    timeRangePresets: TIME_RANGE_PRESETS,
    availableSpeeds: PLAYBACK_SPEEDS,
  };
}

export default useTrackPlayback;
