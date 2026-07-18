import React, { createContext, useContext, useEffect, useRef } from 'react';

/**
 * Page-context plumbing for the app-wide support chat.
 *
 * The dock sends the agent a snapshot of "what the user is currently looking
 * at" so they can ask about the page without restating it. Context comes from
 * three layers, cheapest-coupling first:
 *   1. base   — the active tab + hash params (always available, from App).
 *   2. snapshot — visible text of the main content region (universal, zero
 *      per-screen wiring — literally the data on screen).
 *   3. registered — optional richer, structured context a screen opts into via
 *      usePublishPageContext (e.g. the detail screen publishes the airframe).
 */

const PageContextStore = createContext(null);

export const TAB_LABELS = {
  map: 'Live Map',
  aircraft: 'Aircraft List',
  stats: 'Statistics',
  analytics: 'Analytics',
  history: 'History',
  audio: 'Radio',
  alerts: 'Alerts',
  system: 'System',
  airframe: 'Aircraft Detail',
  event: 'Safety Event',
  notam: 'NOTAM',
  assistant: 'Assistant',
  cannonball: 'Cannonball',
};

export function tabLabel(tab) {
  return TAB_LABELS[tab] || tab || 'this page';
}

export function PageContextProvider({ tab, params, children }) {
  const baseRef = useRef({ tab, params });
  baseRef.current = { tab, params };
  const registeredRef = useRef(null);

  const apiRef = useRef(null);
  if (!apiRef.current) {
    apiRef.current = {
      setRegistered: (v) => {
        registeredRef.current = v;
      },
      read: () => ({ base: baseRef.current, registered: registeredRef.current }),
    };
  }

  return <PageContextStore.Provider value={apiRef.current}>{children}</PageContextStore.Provider>;
}

/** Screens opt into richer context: usePublishPageContext(() => ({...}), [deps]). */
export function usePublishPageContext(builder, deps = []) {
  const store = useContext(PageContextStore);
  useEffect(() => {
    if (!store) return undefined;
    try {
      store.setRegistered(typeof builder === 'function' ? builder() : builder);
    } catch {
      store.setRegistered(null);
    }
    return () => store.setRegistered(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function usePageContextStore() {
  return useContext(PageContextStore);
}

/** Grab the visible text of the main content region — the data the user sees. */
export function snapshotVisibleText(maxChars = 1800) {
  if (typeof document === 'undefined') return '';
  const main = document.querySelector('.v2-main');
  if (!main) return '';
  const text = (main.innerText || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.slice(0, maxChars);
}

/** Compose the full context string sent to the agent at send-time. */
export function composePageContext(store) {
  const read = store?.read?.();
  const base = read?.base || {};
  const tab = base.tab;
  const lines = [`Page: ${tabLabel(tab)} (#${tab || 'map'})`];

  const params = base.params || {};
  const paramKeys = Object.keys(params);
  if (paramKeys.length) lines.push(`URL params: ${JSON.stringify(params)}`);

  const registered = read?.registered;
  if (registered) {
    lines.push(typeof registered === 'string' ? registered : `Page data: ${JSON.stringify(registered)}`);
  }

  const snap = snapshotVisibleText();
  if (snap) lines.push(`Visible on screen:\n${snap}`);

  return lines.join('\n');
}

export default PageContextProvider;
