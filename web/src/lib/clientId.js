/**
 * Stable per-browser client id.
 *
 * In public AUTH_MODE the user is anonymous, so saved assistant chat sessions
 * are owned by this id instead of an account. It's a UUID persisted in
 * localStorage and sent as the `X-Client-Id` header on chat requests; the
 * backend scopes sessions to it. Best-effort: if storage is unavailable we fall
 * back to a per-tab id so the app still works.
 */

const STORAGE_KEY = 'skyspy.clientId';

let cached = null;

function makeUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older/insecure contexts.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Return this browser's client id, creating and persisting it on first use. */
export function getClientId() {
  if (cached) return cached;
  try {
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = makeUuid();
      localStorage.setItem(STORAGE_KEY, id);
    }
    cached = id;
  } catch {
    // localStorage blocked (private mode / SSR) — use an ephemeral id.
    cached = makeUuid();
  }
  return cached;
}

export default getClientId;
