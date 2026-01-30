/**
 * Fetch utilities for aircraft info
 */

/**
 * Helper to safely parse JSON from fetch response
 */
export async function safeJson(res) {
  if (!res.ok) return null;
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) return null;
  try { return await res.json(); } catch { return null; }
}

/**
 * Split array into batches
 */
export function createBatches(items, batchSize) {
  const batches = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Check if ICAO is valid for lookup (not TIS-B)
 */
export function isValidIcao(icao) {
  if (!icao) return false;
  return !icao.startsWith('~');
}

/**
 * Normalize ICAO to uppercase
 */
export function normalizeIcao(icao) {
  return icao?.toUpperCase() || '';
}
