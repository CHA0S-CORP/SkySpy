import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBreakpoint, BREAKPOINTS } from './useBreakpoint';

function setWidth(w) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
}

describe('useBreakpoint', () => {
  const original = window.innerWidth;
  afterEach(() => setWidth(original));

  it('reports desktop for wide viewports', () => {
    setWidth(1440);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current.bp).toBe('xl');
    expect(result.current.isDesktop).toBe(true);
    expect(result.current.isMobile).toBe(false);
  });

  it('reports mobile at phone widths (<=768)', () => {
    setWidth(390);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current.isMobile).toBe(true);
    expect(result.current.bp).toBe('sm');
  });

  it('reports tablet band (769-1024)', () => {
    setWidth(900);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current.isTablet).toBe(true);
    expect(result.current.isMobile).toBe(false);
    expect(result.current.isDesktop).toBe(false);
  });

  it('classifies the md boundary (768) as mobile', () => {
    setWidth(BREAKPOINTS.md);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current.bp).toBe('md');
    expect(result.current.isMobile).toBe(true);
  });

  it('updates when the viewport crosses a bucket on resize', () => {
    setWidth(1440);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current.isMobile).toBe(false);

    act(() => {
      setWidth(400);
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current.isMobile).toBe(true);
  });
});
