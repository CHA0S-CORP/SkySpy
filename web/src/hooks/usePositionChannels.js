import { useState, useEffect, useRef, useCallback } from 'react';
import { useNativeWebSocket } from './useNativeWebSocket';

/**
 * Interpolate between two track/heading values, handling the 360 degree wrap-around.
 */
function interpolateTrack(from, to, t) {
  if (from === null || from === undefined || !Number.isFinite(from)) {
    return Number.isFinite(to) ? to : 0;
  }
  if (to === null || to === undefined || !Number.isFinite(to)) {
    return Number.isFinite(from) ? from : 0;
  }
  if (!Number.isFinite(t)) {
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

  // Normalize result and guard against NaN
  result = ((result % 360) + 360) % 360;
  return Number.isFinite(result) ? result : 0;
}

/**
 * High-frequency position update hook using Django Channels WebSocket.
 *
 * Uses refs instead of state for interpolated positions to avoid
 * triggering 60Hz React re-renders. Components should use the
 * `getPosition` or `positionsRef` to access current positions.
 *
 * @param {boolean} enabled - Whether to connect
 * @param {string} apiBase - API base URL
 * @param {boolean} interpolate - Enable position interpolation (default: true)
 * @param {number} interpolationMs - Interpolation duration in ms (default: 1000)
 */
export function usePositionChannels(enabled, apiBase, interpolate = true, interpolationMs = 1000) {
  // Connection state (low-frequency, ok to use React state)
  const [connected, setConnected] = useState(false);
  const [count, setCount] = useState(0);

  // HIGH-FREQUENCY DATA: Use refs instead of state to avoid re-renders
  const interpolatedPositionsRef = useRef({});
  const targetPositionsRef = useRef({});
  const prevPositionsRef = useRef({});
  const lastUpdateRef = useRef({});

  // Animation frame reference
  const animationFrameRef = useRef(null);
  const mountedRef = useRef(true);
  const interpolateRef = useRef(interpolate);
  const interpolationMsRef = useRef(interpolationMs);

  // Keep settings refs in sync
  useEffect(() => {
    interpolateRef.current = interpolate;
    interpolationMsRef.current = interpolationMs;
  }, [interpolate, interpolationMs]);

  /**
   * Handle incoming WebSocket messages
   */
  const handleMessage = useCallback((data) => {
    if (!mountedRef.current) return;

    const { type } = data;

    try {
      // Handle batched messages (from rate-limited/batched consumers)
      if (type === 'batch' && Array.isArray(data.messages)) {
        data.messages.forEach(msg => { if (msg) handleMessage(msg); });
        return;
      }

      // Initial snapshot - handle both aircraft:snapshot (backend) and positions:snapshot (legacy)
      if (type === 'aircraft:snapshot' || type === 'positions:snapshot') {
        // Backend sends aircraft:snapshot with data.aircraft array
        // Legacy positions:snapshot has data.positions object
        const aircraftArray = data?.data?.aircraft;
        const positionsObj = data?.data?.positions;

        const now = performance.now();

        // Clear existing data on snapshot (fresh state)
        interpolatedPositionsRef.current = {};
        targetPositionsRef.current = {};
        prevPositionsRef.current = {};
        lastUpdateRef.current = {};

        if (Array.isArray(aircraftArray)) {
          // Convert aircraft array to positions map
          for (const ac of aircraftArray) {
            const icao = ac.hex || ac.icao_hex;
            if (icao && Number.isFinite(ac.lat) && Number.isFinite(ac.lon)) {
              const pos = {
                lat: ac.lat,
                lon: ac.lon,
                alt: ac.alt_baro || ac.alt,
                track: ac.track,
                gs: ac.gs,
                vr: ac.vr || ac.baro_rate,
              };
              targetPositionsRef.current[icao] = pos;
              prevPositionsRef.current[icao] = pos;
              lastUpdateRef.current[icao] = now;
              interpolatedPositionsRef.current[icao] = pos;
            }
          }
        } else if (positionsObj && typeof positionsObj === 'object') {
          // Legacy positions format
          for (const [icao, pos] of Object.entries(positionsObj)) {
            if (pos && typeof pos === 'object' &&
                Number.isFinite(pos.lat) && Number.isFinite(pos.lon)) {
              targetPositionsRef.current[icao] = pos;
              prevPositionsRef.current[icao] = pos;
              lastUpdateRef.current[icao] = now;
              interpolatedPositionsRef.current[icao] = pos;
            }
          }
        }

        setCount(Object.keys(targetPositionsRef.current).length);
        console.log('Position snapshot:', Object.keys(targetPositionsRef.current).length, 'aircraft');
      }

      // Position updates
      else if (type === 'positions:update') {
        if (!data?.data) return;

        // Debug: Log position updates
        const updateCount = Array.isArray(data.data.positions) ? data.data.positions.length : Object.keys(data.data.positions || {}).length;
        console.log('[usePositionChannels] positions:update received:', updateCount, 'positions');

        const now = performance.now();
        const positionsData = data.data.positions;
        const removedIcaos = Array.isArray(data.data.removed) ? data.data.removed : [];

        // Handle both array format (backend) and object format (legacy)
        const positionsArray = Array.isArray(positionsData) ? positionsData : [];
        const positionsMap = !Array.isArray(positionsData) && positionsData ? positionsData : null;

        // Process array format (from backend task)
        for (const pos of positionsArray) {
          const icao = pos.hex || pos.icao_hex;
          if (!icao || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lon)) {
            continue;
          }

          const posData = {
            lat: pos.lat,
            lon: pos.lon,
            alt: pos.alt,
            track: pos.track,
            gs: pos.gs,
            vr: pos.vr,
          };

          // Store current target as previous for interpolation
          if (targetPositionsRef.current[icao]) {
            prevPositionsRef.current[icao] = { ...targetPositionsRef.current[icao] };
          } else {
            prevPositionsRef.current[icao] = posData;
          }

          targetPositionsRef.current[icao] = posData;
          lastUpdateRef.current[icao] = now;

          // If not interpolating, update interpolated positions directly
          if (!interpolateRef.current) {
            interpolatedPositionsRef.current[icao] = posData;
          }
        }

        // Process legacy object/map format
        if (positionsMap) {
          for (const [icao, pos] of Object.entries(positionsMap)) {
            if (!pos || typeof pos !== 'object' ||
                !Number.isFinite(pos.lat) || !Number.isFinite(pos.lon)) {
              continue;
            }

            // Store current target as previous for interpolation
            if (targetPositionsRef.current[icao]) {
              prevPositionsRef.current[icao] = { ...targetPositionsRef.current[icao] };
            } else {
              prevPositionsRef.current[icao] = pos;
            }

            targetPositionsRef.current[icao] = pos;
            lastUpdateRef.current[icao] = now;

            // If not interpolating, update interpolated positions directly
            if (!interpolateRef.current) {
              interpolatedPositionsRef.current[icao] = pos;
            }
          }
        }

        // Remove aircraft
        for (const icao of removedIcaos) {
          if (typeof icao === 'string') {
            delete targetPositionsRef.current[icao];
            delete prevPositionsRef.current[icao];
            delete lastUpdateRef.current[icao];
            delete interpolatedPositionsRef.current[icao];
          }
        }

        // Update count
        if (mountedRef.current) {
          setCount(Object.keys(targetPositionsRef.current).length);
        }
      }
    } catch (err) {
      console.error('Error processing position message:', type, err);
    }
  }, []);

  // Ref to store the send function for use in callbacks
  const wsSendRef = useRef(null);

  /**
   * Handle connection
   */
  const handleConnect = useCallback(() => {
    console.log('Position Channels WebSocket connected');
    setConnected(true);
    // Subscribe to positions topic using the ref
    if (wsSendRef.current) {
      wsSendRef.current({ action: 'subscribe', topics: ['aircraft'] });
    }
  }, []);

  /**
   * Handle disconnection
   */
  const handleDisconnect = useCallback(() => {
    console.log('Position Channels WebSocket disconnected');
    if (mountedRef.current) {
      setConnected(false);
      // Clear stale position data
      interpolatedPositionsRef.current = {};
      targetPositionsRef.current = {};
      prevPositionsRef.current = {};
      lastUpdateRef.current = {};
      setCount(0);
    }
  }, []);

  // Use native WebSocket with faster reconnection for positions
  const {
    connected: wsConnected,
    send: wsSend,
  } = useNativeWebSocket({
    enabled,
    apiBase,
    path: 'aircraft',
    queryParams: { topics: 'aircraft' },
    onMessage: handleMessage,
    onConnect: handleConnect,
    onDisconnect: handleDisconnect,
    reconnectConfig: {
      initialDelay: 500,
      maxDelay: 5000,
      multiplier: 2,
      jitter: 0.2,
      maxAttempts: Infinity,
    },
  });

  // Keep wsSendRef in sync with wsSend for use in callbacks
  useEffect(() => {
    wsSendRef.current = wsSend;
  }, [wsSend]);

  // Interpolation animation loop - updates refs only, no React state
  useEffect(() => {
    if (!enabled || !interpolate) return;

    mountedRef.current = true;

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

        // Validate target position
        if (!target || !Number.isFinite(target.lat) || !Number.isFinite(target.lon)) {
          continue;
        }

        // Calculate interpolation progress (0 to 1)
        const t = Math.min(elapsed / duration, 1);

        // Ease-out cubic for smooth deceleration
        const eased = 1 - Math.pow(1 - t, 3);

        // Interpolate position with NaN guards
        const prevLat = Number.isFinite(prev?.lat) ? prev.lat : target.lat;
        const prevLon = Number.isFinite(prev?.lon) ? prev.lon : target.lon;

        const interpLat = prevLat + (target.lat - prevLat) * eased;
        const interpLon = prevLon + (target.lon - prevLon) * eased;

        // Final NaN guard
        interpolated[icao] = {
          lat: Number.isFinite(interpLat) ? interpLat : target.lat,
          lon: Number.isFinite(interpLon) ? interpLon : target.lon,
          alt: target.alt,
          track: interpolateTrack(prev?.track, target.track, eased),
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
      mountedRef.current = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [enabled, interpolate]);

  // Sync connection state
  useEffect(() => {
    if (mountedRef.current) {
      setConnected(wsConnected);
    }
  }, [wsConnected]);

  /**
   * Get interpolated position for a specific aircraft.
   * Reads from a ref, not state, so it won't cause re-renders.
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

export default usePositionChannels;
