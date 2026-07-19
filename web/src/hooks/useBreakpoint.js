import { useEffect, useState } from 'react';

/**
 * Canonical SkySpy responsive breakpoints (px). Kept in sync with the CSS
 * media queries used across the v2 stylesheets (shell 1200, tablet 1024,
 * phone 768, small phone 480).
 */
export const BREAKPOINTS = { sm: 480, md: 768, lg: 1024, xl: 1200 };

/**
 * @typedef {'sm'|'md'|'lg'|'xl'} Breakpoint
 * @typedef {{ width: number, bp: Breakpoint, isMobile: boolean, isTablet: boolean, isDesktop: boolean }} BreakpointState
 */

/** @param {number} w @returns {Breakpoint} */
function bucket(w) {
  if (w <= BREAKPOINTS.sm) return 'sm';
  if (w <= BREAKPOINTS.md) return 'md';
  if (w <= BREAKPOINTS.lg) return 'lg';
  return 'xl';
}

/** @param {number} w @returns {BreakpointState} */
function stateFor(w) {
  const bp = bucket(w);
  return {
    width: w,
    bp,
    // Phone (<=768). Toolbar/panels switch to sheets here.
    isMobile: w <= BREAKPOINTS.md,
    // Tablet band (769-1024).
    isTablet: w > BREAKPOINTS.md && w <= BREAKPOINTS.lg,
    isDesktop: w > BREAKPOINTS.lg,
  };
}

/**
 * Centralized viewport-size hook. Replaces scattered `window.innerWidth`
 * reads with one resize-subscribed source of truth so responsive JS (e.g.
 * rendering the map detail panel as a bottom sheet) stays coordinated.
 *
 * SSR-safe: assumes desktop when `window` is absent.
 *
 * @returns {BreakpointState}
 *
 * @example
 * const { isMobile } = useBreakpoint();
 * return isMobile ? <BottomSheet ... /> : <SidePanel ... />;
 */
export function useBreakpoint() {
  const [state, setState] = useState(() =>
    stateFor(typeof window === 'undefined' ? BREAKPOINTS.xl + 1 : window.innerWidth)
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () =>
      setState((prev) => {
        const next = stateFor(window.innerWidth);
        // Avoid re-render churn on every resize pixel — only when a bucket flips.
        return next.bp === prev.bp ? prev : next;
      });
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return state;
}

export default useBreakpoint;
