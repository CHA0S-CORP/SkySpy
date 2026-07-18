import { useEffect, useRef } from 'react';

// Refresh lastSeen every minute (matches the 1-min throttle inside updateLastSeen)
const KEEP_ALIVE_INTERVAL_MS = 60 * 1000;
// Prune departed aircraft on a slower cadence so brief coverage gaps don't wipe positions
const PRUNE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Keeps custom data block positions alive for aircraft that are still being
 * tracked, and prunes positions for aircraft that have departed.
 *
 * Without this, useDataBlockPositions' 30-minute expiry deletes Shift+drag
 * custom positions even for aircraft continuously on screen, because lastSeen
 * is only stamped at drag time.
 *
 * @param {Array<{hex?: string}>} aircraft - Currently tracked aircraft
 * @param {function(Set<string>): void} updateLastSeen - From useDataBlockPositions
 * @param {function(Set<string>): void} pruneStaleAircraft - From useDataBlockPositions
 */
export function useDataBlockKeepAlive(aircraft, updateLastSeen, pruneStaleAircraft) {
  const aircraftRef = useRef(aircraft);
  aircraftRef.current = aircraft;

  useEffect(() => {
    const buildActiveHexes = () =>
      new Set((aircraftRef.current || []).map((ac) => ac?.hex?.toUpperCase()).filter(Boolean));

    const keepAlive = () => {
      const activeHexes = buildActiveHexes();
      if (activeHexes.size > 0) updateLastSeen(activeHexes);
    };
    const prune = () => {
      const activeHexes = buildActiveHexes();
      // Skip when empty (e.g. feed hiccup) so we don't wipe all saved positions
      if (activeHexes.size > 0) pruneStaleAircraft(activeHexes);
    };

    keepAlive();
    const keepAliveId = setInterval(keepAlive, KEEP_ALIVE_INTERVAL_MS);
    const pruneId = setInterval(prune, PRUNE_INTERVAL_MS);
    return () => {
      clearInterval(keepAliveId);
      clearInterval(pruneId);
    };
  }, [updateLastSeen, pruneStaleAircraft]);
}

export default useDataBlockKeepAlive;
