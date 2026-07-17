import React, { createContext, useContext, useEffect, useState } from 'react';

/**
 * v2 theme provider (design handoff: radar | slate | amber).
 * Sets [data-theme] on <html>; "radar" is the :root default so no attribute.
 * Coexists with the legacy [data-pro-theme] attribute until legacy UI retires.
 */

export const V2_THEMES = ['radar', 'slate', 'amber'];
const STORAGE_KEY = 'skyspy-theme';

const ThemeContext = createContext({ theme: 'radar', setTheme: () => {} });

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return V2_THEMES.includes(saved) ? saved : 'radar';
    } catch {
      return 'radar';
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'radar') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // localStorage unavailable (private mode) — theme just won't persist
    }
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
