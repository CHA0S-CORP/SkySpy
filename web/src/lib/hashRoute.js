// Hash-routing core. Single source of truth for the app's `#<tab>?<params>`
// URL scheme, shared by App.jsx (top-level routing) and useHashParamState
// (per-screen deep-linked view state). Keeping parse/build here means both read
// and write the exact same format.

export const VALID_TABS = [
  'map',
  'aircraft',
  'stats',
  'analytics',
  'airframes',
  'weather',
  'wildfires',
  'history',
  'audio',
  'notams',
  'pireps',
  'archive',
  'alerts',
  'system',
  'assistant',
  'admin',
  'access',
  'airframe',
  'event',
  'notam',
  'pirep',
  'login',
  'cannonball',
];

// Legacy standalone routes folded into History tabs (kept for bookmarks).
export const HISTORY_TAB_ALIASES = ['notams', 'pireps', 'archive'];

/**
 * Parse a hash string (defaults to the live `window.location.hash`) into
 * `{ tab, params }`. Unknown tabs fall back to 'map'; legacy history aliases
 * (#notams/#pireps/#archive) canonicalize to `history` with a `data` param.
 * @param {string} [hash]
 * @returns {{ tab: string, params: Record<string,string> }}
 */
export function parseHash(hash = window.location.hash) {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return { tab: 'map', params: {} };

  const [path, queryString] = raw.split('?');
  let tab = VALID_TABS.includes(path) ? path : 'map';
  /** @type {Record<string, string>} */
  const params = {};

  if (queryString) {
    const searchParams = new URLSearchParams(queryString);
    for (const [key, value] of searchParams) {
      params[key] = value;
    }
  }

  if (HISTORY_TAB_ALIASES.includes(tab)) {
    params.data = tab;
    tab = 'history';
  }

  return { tab, params };
}

/**
 * Build a `#tab?query` hash. Null/undefined/'' params are dropped so the URL
 * stays clean (and a param can be cleared by passing an empty value).
 * @param {string} tab
 * @param {Record<string, unknown>} [params]
 * @returns {string}
 */
export function buildHash(tab, params = {}) {
  const paramEntries = Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => /** @type {[string, string]} */ ([k, String(v)]));
  if (paramEntries.length === 0) return `#${tab}`;
  const queryString = new URLSearchParams(paramEntries).toString();
  return `#${tab}?${queryString}`;
}

/** Live params for the current URL. */
export function getHashParams() {
  return parseHash().params;
}

/** Live tab for the current URL. */
export function getHashTab() {
  return parseHash().tab;
}

/**
 * Merge a param patch into the CURRENT url and write it back. Reads the live
 * hash (not a cached React snapshot) so several independent writers in one tick
 * compose instead of clobbering each other. Pass a param value of null/''/
 * undefined to remove it.
 *
 * `replace: true` (used for in-screen filter/search churn) rewrites the current
 * history entry via replaceState so Back isn't spammed — and dispatches a
 * synthetic `hashchange` since replaceState doesn't fire one. `replace: false`
 * (navigation) assigns location.hash, pushing a new entry.
 *
 * @param {Record<string, unknown>} patch
 * @param {{ replace?: boolean }} [opts]
 */
export function setHashParams(patch, { replace = false } = {}) {
  const { tab, params } = parseHash();
  const newHash = buildHash(tab, { ...params, ...patch });
  if (newHash === (window.location.hash || `#${tab}`)) return;
  if (replace) {
    const { pathname, search } = window.location;
    window.history.replaceState(null, '', `${pathname}${search}${newHash}`);
  } else {
    window.location.hash = newHash;
  }
  // Notify subscribers synchronously. replaceState never fires hashchange; and
  // assigning location.hash fires it only on a later tick, so dispatching now
  // keeps useHashParamState in sync within the same event. A real browser's own
  // (async) hashchange that follows is an idempotent no-op.
  window.dispatchEvent(new Event('hashchange'));
}

/**
 * Navigate to a tab, replacing any current params (push — a new history entry).
 * @param {string} tab
 * @param {Record<string, unknown>} [params]
 */
export function navigate(tab, params = {}) {
  window.location.hash = buildHash(tab, params);
}
