import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHashParamState, boolParam, csvParam } from './useHashParamState';
import { getHashParams } from '../lib/hashRoute';

describe('useHashParamState', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  afterEach(() => {
    window.location.hash = '';
  });

  describe('initial value', () => {
    it('reads the value from the URL', () => {
      window.location.hash = '#aircraft?q=hello';
      const { result } = renderHook(() => useHashParamState('q', ''));
      expect(result.current[0]).toBe('hello');
    });

    it('falls back to the default when the param is absent', () => {
      window.location.hash = '#aircraft';
      const { result } = renderHook(() => useHashParamState('q', 'def'));
      expect(result.current[0]).toBe('def');
    });
  });

  describe('writing', () => {
    it('updates both the URL and the returned value', () => {
      window.location.hash = '#aircraft';
      const { result } = renderHook(() => useHashParamState('q', ''));
      act(() => result.current[1]('foo'));
      expect(getHashParams().q).toBe('foo');
      expect(result.current[0]).toBe('foo');
    });

    it('omits the param when the value equals the default', () => {
      window.location.hash = '#aircraft?q=foo';
      const { result } = renderHook(() => useHashParamState('q', ''));
      act(() => result.current[1](''));
      expect('q' in getHashParams()).toBe(false);
    });

    it('does not clobber other params on the same tab', () => {
      window.location.hash = '#aircraft?filter=military';
      const { result } = renderHook(() => useHashParamState('sort', 'dist'));
      act(() => result.current[1]('alt'));
      expect(getHashParams()).toMatchObject({ filter: 'military', sort: 'alt' });
    });

    it('supports functional updates against the live value', () => {
      window.location.hash = '#aircraft?n=1';
      const { result } = renderHook(() =>
        useHashParamState('n', 0, { parse: Number, serialize: String })
      );
      act(() => result.current[1]((prev) => prev + 1));
      expect(getHashParams().n).toBe('2');
      expect(result.current[0]).toBe(2);
    });
  });

  describe('helpers', () => {
    it('boolParam round-trips as 1 / absent', () => {
      window.location.hash = '#stats';
      const { result } = renderHook(() => useHashParamState('mil', false, boolParam));
      expect(result.current[0]).toBe(false);
      act(() => result.current[1](true));
      expect(getHashParams().mil).toBe('1');
      expect(result.current[0]).toBe(true);
      act(() => result.current[1](false));
      expect('mil' in getHashParams()).toBe(false);
    });

    it('csvParam round-trips a list', () => {
      window.location.hash = '#map?filter=A,B';
      const { result } = renderHook(() => useHashParamState('filter', [], csvParam));
      expect(result.current[0]).toEqual(['A', 'B']);
      act(() => result.current[1](['C', 'D', 'E']));
      expect(getHashParams().filter).toBe('C,D,E');
    });
  });

  describe('debounce', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('delays the URL write until the debounce elapses', () => {
      window.location.hash = '#aircraft';
      const { result } = renderHook(() => useHashParamState('q', '', { debounceMs: 300 }));
      act(() => result.current[1]('ab'));
      expect('q' in getHashParams()).toBe(false);
      act(() => vi.advanceTimersByTime(300));
      expect(getHashParams().q).toBe('ab');
    });
  });
});
