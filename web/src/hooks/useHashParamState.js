import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { getHashParams, setHashParams } from '../lib/hashRoute';

// Subscribe once to the `hashchange` event (fired by real navigation AND by the
// synthetic dispatch in hashRoute.setHashParams' replace path).
function subscribe(cb) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

/** Boolean param serialized as '1' (present) / absent. */
export const boolParam = {
  parse: (v) => v === '1' || v === 'true',
  serialize: (v) => (v ? '1' : ''),
};

/** Comma-separated list <-> string[]. */
export const csvParam = {
  parse: (v) =>
    v
      ? v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  serialize: (v) => (Array.isArray(v) ? v.join(',') : ''),
};

/**
 * Deep-linked view state backed by a hash query param. The URL is the source of
 * truth: the value is read from `#tab?<key>=…` and every set writes it back, so
 * the state survives reload, is shareable, and restores on back/forward. When
 * the value equals `defaultValue` the param is omitted to keep URLs clean.
 *
 * Screens don't need any props threaded from App — the hook subscribes to the
 * hash directly.
 *
 * @template T
 * @param {string} key - query param name (e.g. 'q', 'sort', 'range')
 * @param {T} defaultValue - value when the param is absent
 * @param {object} [opts]
 * @param {(raw: string) => T} [opts.parse] - decode the raw string
 * @param {(v: T) => string} [opts.serialize] - encode to a string
 * @param {boolean} [opts.replace=true] - replaceState (no history entry) vs push;
 *   default true so filter/search churn doesn't spam Back
 * @param {number} [opts.debounceMs=0] - delay writes (use for free-text inputs)
 * @returns {[T, (next: T | ((prev: T) => T)) => void]}
 */
export function useHashParamState(key, defaultValue, opts = {}) {
  const {
    parse = (v) => v,
    serialize = (v) => (v == null ? '' : String(v)),
    replace = true,
    debounceMs = 0,
  } = opts;

  const raw = useSyncExternalStore(
    subscribe,
    () => getHashParams()[key],
    () => undefined
  );
  const value = /** @type {T} */ (raw != null && raw !== '' ? parse(raw) : defaultValue);

  // Stash config + timer in refs so setValue keeps a stable identity and always
  // reads the freshest hash for functional updates.
  const cfg = useRef(/** @type {any} */ ({}));
  cfg.current = { parse, serialize, defaultValue, replace, debounceMs };
  const timer = useRef(null);

  const setValue = useCallback(
    (next) => {
      const c = cfg.current;
      const cur = getHashParams()[key];
      const prev = cur != null && cur !== '' ? c.parse(cur) : c.defaultValue;
      const resolved = typeof next === 'function' ? next(prev) : next;
      // Omit the param when it matches the default (keeps the URL minimal).
      const str = c.serialize(resolved);
      const write = str === c.serialize(c.defaultValue) ? '' : str;

      const commit = () => setHashParams({ [key]: write }, { replace: c.replace });
      if (c.debounceMs > 0) {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(commit, c.debounceMs);
      } else {
        commit();
      }
    },
    [key]
  );

  // Clear any pending debounced write on unmount so a timer that fires after the
  // component is gone doesn't mutate the URL for a screen the user already left.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return [value, setValue];
}
