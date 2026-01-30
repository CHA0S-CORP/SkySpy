/**
 * Cache utilities for aircraft info
 */

// Maximum cache size for LRU eviction
export const MAX_CACHE_SIZE = 1000;

/**
 * Check if cached data is still valid
 */
export function isCacheEntryValid(entry, cacheTTL) {
  if (!entry || !entry.fetchedAt) return false;
  if (entry.error) return false; // Don't use errored entries
  return Date.now() - entry.fetchedAt < cacheTTL;
}

/**
 * Enforce max cache size with LRU eviction
 * Returns a new cache object with oldest entries removed if over limit
 */
export function enforceMaxCacheSize(cacheObj, maxSize = MAX_CACHE_SIZE) {
  const entries = Object.entries(cacheObj);
  if (entries.length <= maxSize) {
    return cacheObj;
  }
  // Sort by fetchedAt (oldest first) and keep only the most recent entries
  entries.sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
  const toKeep = entries.slice(entries.length - maxSize);
  const result = {};
  for (const [icao, entry] of toKeep) {
    result[icao] = entry;
  }
  return result;
}

/**
 * Clean up expired entries and enforce max size
 */
export function cleanupCache(cacheObj, cacheTTL, maxSize = MAX_CACHE_SIZE) {
  const now = Date.now();
  const entries = Object.entries(cacheObj);

  // First pass: remove expired entries
  let validEntries = entries.filter(([, entry]) =>
    now - entry.fetchedAt < cacheTTL * 2
  );

  // Second pass: LRU eviction if still over max size
  if (validEntries.length > maxSize) {
    validEntries.sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
    validEntries = validEntries.slice(validEntries.length - maxSize);
  }

  // Convert back to object
  const next = {};
  for (const [icao, entry] of validEntries) {
    next[icao] = entry;
  }
  return next;
}
