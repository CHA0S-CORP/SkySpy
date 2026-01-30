/**
 * High-frequency position update hook using Socket.IO (replaces usePositionChannels).
 *
 * Features:
 * - Uses refs instead of state to avoid 60Hz React re-renders
 * - Position interpolation with ease-out cubic smoothing
 * - Track/heading interpolation with 360-degree wrap-around handling
 * - Components access positions via getPosition or positionsRef
 *
 * @module useSocketIOPositions
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSocketIO } from './useSocketIO';

/**
 * Interpolate between two track/heading values, handling the 360 degree wrap-around.
 *
 * @param {number} from - Starting angle
 * @param {number} to - Target angle
 * @param {number} t - Interpolation factor (0-1)
 * @returns {number} Interpolated angle
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
 * High-frequency position update hook using Socket.IO.
 *
 * Uses refs instead of state for interpolated positions to avoid
 * triggering 60Hz React re-renders. Components should use the
 * `getPosition` or `positionsRef` to access current positions.
 *
 * @param {boolean} enabled - Whether to connect
 * @param {string} apiBase - API base URL
 * @param {boolean} interpolate - Enable position interpolation (default: true)
 * @param {number} interpolationMs - Interpolation duration in ms (default: 1000)
 * @returns {Object} Position state and accessors
 */
export function useSocketIOPositions(enabled, apiBase, interpolate = true, interpolationMs = 1000) {
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
  const socketEmitRef = useRef(null);

  // Keep settings refs in sync
  useEffect(() => {
    interpolateRef.current = interpolate;
    interpolationMsRef.current = interpolationMs;
  }, [interpolate, interpolationMs]);

  /**
   * Handle incoming position messages
   */
  const handleMessage = useCallback((type, data) => {
    if (!mountedRef.current) return;

    try {
      // Handle batched messages
      if (type === 'batch' && Array.isArray(data?.messages)) {
        data.messages.forEach(msg => {
          if (msg && msg.type) {
            handleMessage(msg.type, msg.data || msg);
          }
        });
        return;
      }

      // Initial snapshot - handle both aircraft:snapshot and positions:snapshot
      if (type === 'aircraft:snapshot' || type === 'positions:snapshot') {
        const aircraftArray = data?.aircraft;
        const positionsObj = data?.positions;

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
        console.log('[useSocketIOPositions] Position snapshot:', Object.keys(targetPositionsRef.current).length, 'aircraft');
      }

      // Position updates
      else if (type === 'positions:update') {
        // Debug: Log position updates
        const updateCount = Array.isArray(data?.positions)
          ? data.positions.length
          : Object.keys(data?.positions || {}).length;
        console.log('[useSocketIOPositions] positions:update received:', updateCount, 'positions');

        const now = performance.now();
        const positionsData = data?.positions;
        const removedIcaos = Array.isArray(data?.removed) ? data.removed : [];

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
      console.error('[useSocketIOPositions] Error processing message:', type, err);
    }
  }, []);

  /**
   * Handle Socket.IO connection
   * Note: Topic subscription is deferred to the event listener setup effect
   */
  const handleConnect = useCallback(() => {
    console.log('[useSocketIOPositions] Socket.IO connected');
    setConnected(true);
    // Don't subscribe here - wait for event listeners to be set up first
  }, []);

  /**
   * Handle Socket.IO disconnection
   */
  const handleDisconnect = useCallback(() => {
    console.log('[useSocketIOPositions] Socket.IO disconnected');

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

  // Setup Socket.IO connection with faster reconnection for positions
  const {
    connected: socketConnected,
    isReady: socketReady,
    emit,
    on,
  } = useSocketIO({
    enabled,
    apiBase,
    namespace: '/',
    path: '/socket.io',
    onConnect: handleConnect,
    onDisconnect: handleDisconnect,
    reconnectConfig: {
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
    },
  });

  // Store emit ref for use in callbacks
  useEffect(() => {
    socketEmitRef.current = emit;
  }, [emit]);

  // Setup event listeners - subscriptions are queued by useSocketIO if socket isn't ready
  useEffect(() => {
    if (!enabled) return;

    // Listen for position-related events
    const eventTypes = [
      'aircraft:snapshot',
      'positions:snapshot',
      'positions:update',
      'batch',
    ];

    console.log('[useSocketIOPositions] Setting up event listeners');

    const unsubscribers = eventTypes.map(eventType => {
      return on(eventType, (data) => handleMessage(eventType, data));
    });

    return () => {
      unsubscribers.forEach(unsub => unsub && unsub());
    };
  }, [enabled, on, handleMessage]);

  // Subscribe to topics when socket becomes ready
  useEffect(() => {
    if (!enabled || !socketReady) return;

    console.log('[useSocketIOPositions] Socket ready, subscribing to aircraft topic');
    emit('subscribe', { topics: ['aircraft'] });
  }, [enabled, socketReady, emit]);

  // Mount/unmount tracking - single source of truth for mountedRef
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Cancel any pending animation frame on unmount
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, []);

  // Interpolation animation loop - updates refs only, no React state
  useEffect(() => {
    if (!enabled || !interpolate) {
      // Cancel animation when disabled
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

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
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [enabled, interpolate]);

  // Sync connection state
  useEffect(() => {
    if (mountedRef.current) {
      setConnected(socketConnected);
    }
  }, [socketConnected]);

  /**
   * Get interpolated position for a specific aircraft.
   * Reads from a ref, not state, so it won't cause re-renders.
   *
   * @param {string} icao - Aircraft ICAO hex code
   * @returns {Object|null} Position object or null if not found
   */
  const getPosition = useCallback((icao) => {
    return interpolatedPositionsRef.current[icao?.toUpperCase()] || null;
  }, []);

  /**
   * Get the ref containing all interpolated positions.
   * Use this in requestAnimationFrame loops for direct access without re-renders.
   *
   * @returns {React.MutableRefObject} Ref to positions object
   */
  const getPositionsRef = useCallback(() => {
    return interpolatedPositionsRef;
  }, []);

  /**
   * Get a snapshot of all interpolated positions (creates a copy).
   * Use sparingly as this creates a new object.
   *
   * @returns {Object} Copy of all current positions
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

export default useSocketIOPositions;
