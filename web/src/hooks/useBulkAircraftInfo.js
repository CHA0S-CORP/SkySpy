import { useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE_URL } from '../utils/config';

// The bulk airframe endpoint is cache-only and cheap, but still capped server-side.
const MAX_HEXES = 100;
// Don't refetch on every socket tick; wait for the hex set to settle first.
const DEBOUNCE_MS = 400;

/**
 * Dedupe + upper-case + cap a list of ICAO hexes. Returns a stable, sorted array
 * so callers can key on the joined string and skip redundant refetches.
 * @param {(string|undefined|null)[]} hexes
 * @returns {string[]}
 */
export function normalizeHexes(hexes) {
  if (!Array.isArray(hexes)) return [];
  const seen = new Set();
  for (const h of hexes) {
    if (h == null) continue;
    const up = String(h).trim().toUpperCase();
    if (up) seen.add(up);
  }
  return Array.from(seen).sort().slice(0, MAX_HEXES);
}

/**
 * Aggregate the privacy/interest flags for one airframe record. The
 * AircraftInfoSerializer exposes is_pia / is_ladd / is_interesting only inside
 * per-source `source_data` rows (no top-level fields), so OR them across every
 * reporting source — mirroring how DetailScreen derives its flags.
 * @param {object} info - AircraftInfoSerializer data
 * @returns {{ isPia: boolean, isLadd: boolean, isInteresting: boolean }}
 */
export function aggregateFlags(info) {
  const sources = Array.isArray(info?.source_data) ? info.source_data : [];
  const any = (key) => sources.some((s) => s && s[key]);
  return {
    isPia: any('is_pia'),
    isLadd: any('is_ladd'),
    isInteresting: any('is_interesting'),
  };
}

async function getJson(url, fallback) {
  try {
    const res = await fetch(url);
    if (!res.ok) return fallback;
    const ct = res.headers.get('content-type');
    if (!ct || !ct.includes('application/json')) return fallback;
    return await res.json();
  } catch {
    return fallback;
  }
}

/**
 * Off-hot-path enrichment for the socket-driven aircraft list. Given the ICAO
 * hexes currently shown, fetches the cache-only bulk airframe endpoint
 * (GET /api/v1/airframes/bulk?icao=…) and returns a { [HEX]: info } map, where
 * each info carries the raw AircraftInfoSerializer data plus aggregated
 * isPia/isLadd/isInteresting flags and photo_thumbnail_url.
 *
 * Re-fetches only when the *set* of hexes changes meaningfully (keyed on the
 * sorted-hex string, debounced) — never on every socket tick. Resilient: any
 * network/parse failure resolves to the last-known map (or {}).
 *
 * @param {(string|undefined|null)[]} hexes
 * @param {string} [apiBase] - defaults to the app's relative API base ('')
 * @returns {{ [hex: string]: object }}
 */
export function useBulkAircraftInfo(hexes, apiBase = API_BASE_URL) {
  const normalized = useMemo(() => normalizeHexes(hexes), [hexes]);
  // Stable key: only a real change to the hex *set* should drive a refetch.
  const key = normalized.join(',');

  const [map, setMap] = useState({});
  // Keep the latest map available to the effect without re-subscribing on it.
  const mapRef = useRef(map);
  mapRef.current = map;

  useEffect(() => {
    if (!key) {
      // Nothing to enrich — clear stale data so absent rows render nothing extra.
      if (Object.keys(mapRef.current).length > 0) setMap({});
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      const url = `${apiBase}/api/v1/airframes/bulk?icao=${encodeURIComponent(key)}`;
      const data = await getJson(url, null);
      if (cancelled) return;
      // Resilient to errors / unexpected shapes: fall back to {}.
      const aircraft = data && typeof data.aircraft === 'object' ? data.aircraft : null;
      if (!aircraft) {
        setMap({});
        return;
      }
      const next = {};
      for (const [hex, info] of Object.entries(aircraft)) {
        if (!info || typeof info !== 'object') continue;
        const up = String(hex).toUpperCase();
        next[up] = { ...info, ...aggregateFlags(info) };
      }
      setMap(next);
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, apiBase]);

  return map;
}
