import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

/**
 * High-frequency position update hook for map rendering.
 *
 * IMPORTANT: This hook uses refs instead of state for interpolated positions
 * to avoid triggering 60Hz React re-renders. Components should use the
 * `getPosition` or `getPositionsRef` functions to access current positions,
 * typically within their own requestAnimationFrame loops.
 *
 * Features:
 * - Minimal payload (lat, lon, alt, track, gs, vr only)
 * - Lower position change thresholds (~11m vs ~111m)
 * - Client-side position interpolation for smooth animation
 * - Separate socket connection to avoid blocking other updates
 * - No state updates during interpolation (prevents re-renders)
 *
 * @param {boolean} enabled - Whether to connect
 * @param {string} apiBase - API base URL
 * @param {boolean} interpolate - Enable position interpolation (default: true)
 * @param {number} interpolationMs - Interpolation duration in ms (default: 1000)
 */
export function usePositionSocket(enabled, apiBase, interpolate = true, interpolationMs = 1000) {
  // Connection state (low-frequency, ok to use React state)
  const [connected, setConnected] = useState(false);
  const [count, setCount] = useState(0);

  // HIGH-FREQUENCY DATA: Use refs instead of state to avoid re-renders
  // Current interpolated positions (updated 60x/sec by animation loop)
  const interpolatedPositionsRef = useRef({});
  // Target positions (where aircraft are heading, from socket)
  const targetPositionsRef = useRef({});
  // Previous positions (where aircraft were, for interpolation)
  const prevPositionsRef = useRef({});
  // Last update timestamp for each aircraft
  const lastUpdateRef = useRef({});

  // Animation frame reference
  const animationFrameRef = useRef(null);
  // Socket reference
  const socketRef = useRef(null);
  // Mounted state
  const mountedRef = useRef(true);
  // Interpolation settings refs
  const interpolateRef = useRef(interpolate);
  const interpolationMsRef = useRef(interpolationMs);

  // Keep settings refs in sync
  useEffect(() => {
    interpolateRef.current = interpolate;
    interpolationMsRef.current = interpolationMs;
  }, [interpolate, interpolationMs]);

  // Interpolation animation loop - updates refs only, no React state
  useEffect(() => {
    if (!enabled || !interpolate) return;

    const animate = () => {
      if (!mountedRef.current) return;

      const now = performance.now();
      const targets = targetPositionsRef.current;
      const prevs = prevPositionsRef.current;
      const lastUpdates = lastUpdateRef.current;
      const duration = interpolationMsRef.current;

      const interpolated = {};

      for (const icao in targets) {
        const target = targets[icao];
        const prev = prevs[icao] || target;
        const lastUpdate = lastUpdates[icao] || now;
        const elapsed = now - lastUpdate;

        // Calculate interpolation progress (0 to 1)
        const t = Math.min(elapsed / duration, 1);

        // Ease-out cubic for smooth deceleration
        const eased = 1 - Math.pow(1 - t, 3);

        // Interpolate position
        interpolated[icao] = {
          lat: prev.lat + (target.lat - prev.lat) * eased,
          lon: prev.lon + (target.lon - prev.lon) * eased,
          alt: target.alt,
          track: interpolateTrack(prev.track, target.track, eased),
          gs: target.gs,
          vr: target.vr,
        };
      }

      // Update ref directly - NO setState here to avoid re-renders
      interpolatedPositionsRef.current = interpolated;

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [enabled, interpolate]);

  // Socket connection
  useEffect(() => {
    if (!enabled) return;

    mountedRef.current = true;

    // Build Socket.IO URL
    let socketUrl;
    if (apiBase) {
      try {
        const url = new URL(apiBase, window.location.origin);
        socketUrl = `${url.protocol}//${url.host}`;
      } catch (e) {
        socketUrl = window.location.origin;
      }
    } else {
      socketUrl = window.location.origin;
    }

    console.log('Position socket connecting to:', socketUrl);

    // Create dedicated Socket.IO connection for positions
    const socket = io(socketUrl, {
      path: '/socket.io',
      transports: ['websocket'], // WebSocket only for lower latency
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      timeout: 10000,
      query: { topics: 'positions' },
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Position socket connected:', socket.id);
      setConnected(true);
      socket.emit('subscribe', { topics: ['positions'] });
    });

    socket.on('disconnect', (reason) => {
      console.log('Position socket disconnected:', reason);
      setConnected(false);
    });

    socket.on('connect_error', (error) => {
      console.error('Position socket error:', error.message);
    });

    // Initial snapshot
    socket.on('positions:snapshot', (data) => {
      if (!data?.positions) return;

      const now = performance.now();

      for (const [icao, pos] of Object.entries(data.positions)) {
        targetPositionsRef.current[icao] = pos;
        prevPositionsRef.current[icao] = pos;
        lastUpdateRef.current[icao] = now;
        // Also set interpolated immediately for snapshot
        interpolatedPositionsRef.current[icao] = pos;
      }

      setCount(Object.keys(data.positions).length);
      console.log('Position snapshot:', Object.keys(data.positions).length, 'aircraft');
    });

    // Position updates
    socket.on('positions:update', (data) => {
      if (!data) return;

      const now = performance.now();
      const updatedPositions = data.positions || {};
      const removedIcaos = data.removed || [];

      // Update targets and track previous positions
      for (const [icao, pos] of Object.entries(updatedPositions)) {
        // Store current target as previous for interpolation
        if (targetPositionsRef.current[icao]) {
          prevPositionsRef.current[icao] = { ...targetPositionsRef.current[icao] };
        } else {
          prevPositionsRef.current[icao] = pos;
        }

        // Set new target
        targetPositionsRef.current[icao] = pos;
        lastUpdateRef.current[icao] = now;
      }

      // Remove aircraft
      for (const icao of removedIcaos) {
        delete targetPositionsRef.current[icao];
        delete prevPositionsRef.current[icao];
        delete lastUpdateRef.current[icao];
        delete interpolatedPositionsRef.current[icao];
      }

      // Update count (low-frequency, ok for state)
      setCount(Object.keys(targetPositionsRef.current).length);

      // If not interpolating, update interpolated positions directly
      if (!interpolateRef.current) {
        for (const [icao, pos] of Object.entries(updatedPositions)) {
          interpolatedPositionsRef.current[icao] = pos;
        }
      }
    });

    return () => {
      console.log('Position socket cleanup');
      mountedRef.current = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (socket) {
        socket.disconnect();
        socketRef.current = null;
      }
    };
  }, [enabled, apiBase]);

  /**
   * Get interpolated position for a specific aircraft.
   * This reads from a ref, not state, so it won't cause re-renders.
   */
  const getPosition = useCallback((icao) => {
    return interpolatedPositionsRef.current[icao?.toUpperCase()] || null;
  }, []);

  /**
   * Get the ref containing all interpolated positions.
   * Use this in requestAnimationFrame loops for direct access without re-renders.
   */
  const getPositionsRef = useCallback(() => {
    return interpolatedPositionsRef;
  }, []);

  /**
   * Get a snapshot of all interpolated positions (creates a copy).
   * Use sparingly as this creates a new object.
   */
  const getPositionsSnapshot = useCallback(() => {
    return { ...interpolatedPositionsRef.current };
  }, []);

  return {
    // Connection state (can trigger re-renders, but low frequency)
    connected,
    count,

    // Position accessors (read from refs, no re-renders)
    getPosition,
    getPositionsRef,
    getPositionsSnapshot,

    // Direct ref access for performance-critical code
    positionsRef: interpolatedPositionsRef,
  };
}

/**
 * Interpolate between two track/heading values, handling the 360° wrap-around.
 */
function interpolateTrack(from, to, t) {
  if (from === null || from === undefined || to === null || to === undefined) {
    return to;
  }

  // Normalize to 0-360
  from = ((from % 360) + 360) % 360;
  to = ((to % 360) + 360) % 360;

  // Find shortest path
  let diff = to - from;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;

  // Interpolate
  let result = from + diff * t;

  // Normalize result
  return ((result % 360) + 360) % 360;
}

export default usePositionSocket;
