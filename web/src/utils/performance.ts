/**
 * Performance utilities for debouncing, throttling, and memoization
 */

/**
 * Creates a debounced version of a function that delays invoking until after
 * `ms` milliseconds have elapsed since the last time the debounced function was invoked.
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return function (this: ThisParameterType<T>, ...args: Parameters<T>): void {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      fn.apply(this, args);
      timeoutId = null;
    }, ms);
  };
}

/**
 * Creates a throttled version of a function that only invokes at most once
 * per every `ms` milliseconds.
 */
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return function (this: ThisParameterType<T>, ...args: Parameters<T>): void {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;

    if (timeSinceLastCall >= ms) {
      lastCall = now;
      fn.apply(this, args);
    } else if (timeoutId === null) {
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        timeoutId = null;
        fn.apply(this, args);
      }, ms - timeSinceLastCall);
    }
  };
}

/**
 * Creates a memoized version of a function that caches results based on arguments.
 * Uses a Map for caching with JSON.stringify for key generation.
 */
export function memoize<T extends (...args: any[]) => any>(
  fn: T
): (...args: Parameters<T>) => ReturnType<T> {
  const cache = new Map<string, ReturnType<T>>();

  return function (this: ThisParameterType<T>, ...args: Parameters<T>): ReturnType<T> {
    const key = JSON.stringify(args);

    if (cache.has(key)) {
      return cache.get(key)!;
    }

    const result = fn.apply(this, args);
    cache.set(key, result);
    return result;
  };
}

/**
 * Creates a throttled version of a function that uses requestAnimationFrame
 * to limit invocations to once per animation frame (~16ms at 60fps).
 */
export function rafThrottle<T extends (...args: any[]) => void>(
  fn: T
): (...args: Parameters<T>) => void {
  let rafId: number | null = null;
  let lastArgs: Parameters<T> | null = null;

  return function (this: ThisParameterType<T>, ...args: Parameters<T>): void {
    lastArgs = args;

    if (rafId === null) {
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (lastArgs !== null) {
          fn.apply(this, lastArgs);
        }
      });
    }
  };
}
