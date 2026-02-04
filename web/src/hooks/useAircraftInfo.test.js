import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAircraftInfo } from './useAircraftInfo';

// Mock the composed hooks
const mockCacheGetCached = vi.fn();
const mockCacheSetCacheEntry = vi.fn();
const mockCacheDeleteCacheEntry = vi.fn();
const mockCacheClearCache = vi.fn();
const mockCacheSetCacheEntries = vi.fn();
const mockCacheIsInCacheRef = vi.fn();

const mockErrorsGetError = vi.fn();
const mockErrorsClearError = vi.fn();
const mockErrorsRecordError = vi.fn();

const mockFetcherFetchSingle = vi.fn();
const mockFetcherFetchBulk = vi.fn();
const mockPendingFetches = { current: new Set() };

const mockBulkQueueForLookup = vi.fn();
const mockBulkPrefetchForAircraft = vi.fn();
const mockBulkClearBulkQueue = vi.fn();

vi.mock('./aircraft-info', () => ({
  useAircraftInfoCache: vi.fn(() => ({
    getCached: mockCacheGetCached,
    setCacheEntry: mockCacheSetCacheEntry,
    deleteCacheEntry: mockCacheDeleteCacheEntry,
    clearCache: mockCacheClearCache,
    setCacheEntries: mockCacheSetCacheEntries,
    isInCacheRef: mockCacheIsInCacheRef,
    allCached: {},
    cacheSize: 0,
  })),
  useAircraftInfoFetcher: vi.fn(() => ({
    fetchSingle: mockFetcherFetchSingle,
    fetchBulk: mockFetcherFetchBulk,
    pendingFetches: mockPendingFetches,
    retryQueueSize: 0,
  })),
  useAircraftInfoBulk: vi.fn(() => ({
    queueForLookup: mockBulkQueueForLookup,
    prefetchForAircraft: mockBulkPrefetchForAircraft,
    clearBulkQueue: mockBulkClearBulkQueue,
  })),
  useAircraftInfoErrors: vi.fn(() => ({
    getError: mockErrorsGetError,
    clearError: mockErrorsClearError,
    recordError: mockErrorsRecordError,
    errors: {},
    errorCount: 0,
  })),
}));

import {
  useAircraftInfoCache,
  useAircraftInfoFetcher,
  useAircraftInfoBulk,
  useAircraftInfoErrors,
} from './aircraft-info';

describe('useAircraftInfo', () => {
  let mockWsRequest;

  beforeEach(() => {
    vi.clearAllMocks();

    mockWsRequest = vi.fn();
    mockCacheGetCached.mockReturnValue(null);
    mockCacheIsInCacheRef.mockReturnValue(false);
    mockErrorsGetError.mockReturnValue(null);
    mockFetcherFetchSingle.mockResolvedValue({ icao_hex: 'TEST' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should initialize all composed hooks', () => {
      renderHook(() =>
        useAircraftInfo({
          wsRequest: mockWsRequest,
          wsConnected: true,
          apiBaseUrl: 'http://localhost:8000',
        })
      );

      expect(useAircraftInfoCache).toHaveBeenCalledWith(
        expect.objectContaining({
          cacheTTL: 30 * 60 * 1000,
          maxCacheSize: 1000,
        })
      );

      expect(useAircraftInfoErrors).toHaveBeenCalled();

      expect(useAircraftInfoFetcher).toHaveBeenCalledWith(
        expect.objectContaining({
          wsRequest: mockWsRequest,
          wsConnected: true,
          apiBaseUrl: 'http://localhost:8000',
          maxRetries: 3,
          bulkBatchSize: 50,
        })
      );

      expect(useAircraftInfoBulk).toHaveBeenCalledWith(
        expect.objectContaining({
          debounceMs: 100,
          staggerMs: 50,
        })
      );
    });

    it('should use custom options when provided', () => {
      renderHook(() =>
        useAircraftInfo({
          wsRequest: mockWsRequest,
          wsConnected: true,
          cacheTTL: 60000,
          bulkBatchSize: 100,
          maxRetries: 5,
        })
      );

      expect(useAircraftInfoCache).toHaveBeenCalledWith(
        expect.objectContaining({
          cacheTTL: 60000,
        })
      );

      expect(useAircraftInfoFetcher).toHaveBeenCalledWith(
        expect.objectContaining({
          maxRetries: 5,
          bulkBatchSize: 100,
        })
      );
    });
  });

  describe('getInfo', () => {
    it('should return cached info when available', () => {
      const cachedData = { icao_hex: 'ABC123', registration: 'N12345' };
      mockCacheGetCached.mockReturnValue(cachedData);

      const { result } = renderHook(() =>
        useAircraftInfo({
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      const info = result.current.getInfo('ABC123');

      expect(info).toEqual(cachedData);
      expect(mockBulkQueueForLookup).not.toHaveBeenCalled();
    });

    it('should normalize ICAO to uppercase', () => {
      mockCacheGetCached.mockReturnValue(null);

      const { result } = renderHook(() =>
        useAircraftInfo({
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      result.current.getInfo('abc123');

      expect(mockCacheGetCached).toHaveBeenCalledWith('ABC123');
      expect(mockBulkQueueForLookup).toHaveBeenCalledWith('ABC123');
    });

    it('should queue for lookup when not cached', () => {
      mockCacheGetCached.mockReturnValue(null);

      const { result } = renderHook(() =>
        useAircraftInfo({
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      const info = result.current.getInfo('ABC123');

      expect(info).toBeNull();
      expect(mockBulkQueueForLookup).toHaveBeenCalledWith('ABC123');
    });

    it('should return null for invalid ICAO', () => {
      const { result } = renderHook(() =>
        useAircraftInfo({
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      expect(result.current.getInfo(null)).toBeNull();
      expect(result.current.getInfo(undefined)).toBeNull();
      expect(result.current.getInfo('')).toBeNull();
      expect(result.current.getInfo(123)).toBeNull();

      expect(mockBulkQueueForLookup).not.toHaveBeenCalled();
    });
  });

  describe('getCached', () => {
    it('should return cached data directly', () => {
      const cachedData = { icao_hex: 'ABC123' };
      mockCacheGetCached.mockReturnValue(cachedData);

      const { result } = renderHook(() =>
        useAircraftInfo({
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      expect(result.current.getCached('ABC123')).toEqual(cachedData);
    });

    it('should not trigger fetch', () => {
      mockCacheGetCached.mockReturnValue(null);

      const { result } = renderHook(() =>
        useAircraftInfo({
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      result.current.getCached('ABC123');

      expect(mockBulkQueueForLookup).not.toHaveBeenCalled();
    });
  });

  describe('refreshInfo', () => {
    it('should clear cache and fetch fresh data', async () => {
      vi.useRealTimers();

      const freshData = { icao_hex: 'ABC123', registration: 'N54321' };
      mockFetcherFetchSingle.mockResolvedValue(freshData);

      const { result } = renderHook(() =>
        useAircraftInfo({
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      const refreshedInfo = await result.current.refreshInfo('ABC123');

      expect(mockCacheDeleteCacheEntry).toHaveBeenCalledWith('ABC123');
      expect(mockFetcherFetchSingle).toHaveBeenCalledWith('ABC123');
      expect(refreshedInfo).toEqual(freshData);
    });

    it('should normalize ICAO to uppercase', async () => {
      vi.useRealTimers();

      const { result } = renderHook(() =>
        useAircraftInfo({
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      await result.current.refreshInfo('abc123');

      expect(mockCacheDeleteCacheEntry).toHaveBeenCalledWith('ABC123');
      expect(mockFetcherFetchSingle).toHaveBeenCalledWith('ABC123');
    });

    it('should return null for invalid ICAO', async () => {
      vi.useRealTimers();

      const { result } = renderHook(() =>
        useAircraftInfo({
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      const refreshed = await result.current.refreshInfo(null);

      expect(refreshed).toBeNull();
      expect(mockCacheDeleteCacheEntry).not.toHaveBeenCalled();
    });
  });

  describe('clearCache', () => {
    it('should clear cache and bulk queue', () => {
      const { result } = renderHook(() =>
        useAircraftInfo({
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      result.current.clearCache();

      expect(mockCacheClearCache).toHaveBeenCalled();
      expect(mockBulkClearBulkQueue).toHaveBeenCalled();
    });
  });

  describe('prefetchForAircraft', () => {
    it('should call bulk prefetch', () => {
      const { result } = renderHook(() =>
        useAircraftInfo({
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      const aircraftList = [{ hex: 'ABC123' }, { hex: 'DEF456' }];

      result.current.prefetchForAircraft(aircraftList);

      expect(mockBulkPrefetchForAircraft).toHaveBeenCalledWith(aircraftList);
    });
  });

  describe('error handling', () => {
    it('should expose getError', () => {
      const errorData = {
        error_type: 'not_found',
        error_message: 'Aircraft not found',
      };
      mockErrorsGetError.mockReturnValue(errorData);

      const { result } = renderHook(() =>
        useAircraftInfo({
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      expect(result.current.getError('ABC123')).toEqual(errorData);
    });

    it('should expose clearError', () => {
      const { result } = renderHook(() =>
        useAircraftInfo({
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      result.current.clearError('ABC123');

      expect(mockErrorsClearError).toHaveBeenCalledWith('ABC123');
    });

    it('should expose errors object', () => {
      useAircraftInfoErrors.mockReturnValue({
        getError: mockErrorsGetError,
        clearError: mockErrorsClearError,
        recordError: mockErrorsRecordError,
        errors: { ABC123: { error_type: 'test' } },
        errorCount: 1,
      });

      const { result } = renderHook(() =>
        useAircraftInfo({
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      expect(result.current.errors).toEqual({ ABC123: { error_type: 'test' } });
      expect(result.current.errorCount).toBe(1);
    });
  });

  describe('external error integration', () => {
    it('should pass getAirframeError to errors hook', () => {
      const mockGetAirframeError = vi.fn();
      const mockClearAirframeError = vi.fn();

      renderHook(() =>
        useAircraftInfo({
          wsRequest: mockWsRequest,
          wsConnected: true,
          getAirframeError: mockGetAirframeError,
          clearAirframeError: mockClearAirframeError,
        })
      );

      expect(useAircraftInfoErrors).toHaveBeenCalledWith(
        expect.objectContaining({
          getAirframeError: mockGetAirframeError,
          clearAirframeError: mockClearAirframeError,
        })
      );
    });
  });

  describe('stats', () => {
    it('should expose cache size', () => {
      useAircraftInfoCache.mockReturnValue({
        getCached: mockCacheGetCached,
        setCacheEntry: mockCacheSetCacheEntry,
        deleteCacheEntry: mockCacheDeleteCacheEntry,
        clearCache: mockCacheClearCache,
        setCacheEntries: mockCacheSetCacheEntries,
        isInCacheRef: mockCacheIsInCacheRef,
        allCached: {},
        cacheSize: 42,
      });

      const { result } = renderHook(() =>
        useAircraftInfo({
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      expect(result.current.cacheSize).toBe(42);
    });

    it('should expose retry queue size', () => {
      useAircraftInfoFetcher.mockReturnValue({
        fetchSingle: mockFetcherFetchSingle,
        fetchBulk: mockFetcherFetchBulk,
        pendingFetches: mockPendingFetches,
        retryQueueSize: 5,
      });

      const { result } = renderHook(() =>
        useAircraftInfo({
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      expect(result.current.retryQueueSize).toBe(5);
    });

    it('should expose pending count', () => {
      const pendingSet = new Set(['ABC123', 'DEF456', 'GHI789']);
      useAircraftInfoFetcher.mockReturnValue({
        fetchSingle: mockFetcherFetchSingle,
        fetchBulk: mockFetcherFetchBulk,
        pendingFetches: { current: pendingSet },
        retryQueueSize: 0,
      });

      const { result } = renderHook(() =>
        useAircraftInfo({
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      expect(result.current.pendingCount).toBe(3);
    });
  });

  describe('cache object', () => {
    it('should expose allCached as cache', () => {
      useAircraftInfoCache.mockReturnValue({
        getCached: mockCacheGetCached,
        setCacheEntry: mockCacheSetCacheEntry,
        deleteCacheEntry: mockCacheDeleteCacheEntry,
        clearCache: mockCacheClearCache,
        setCacheEntries: mockCacheSetCacheEntries,
        isInCacheRef: mockCacheIsInCacheRef,
        allCached: {
          ABC123: { icao_hex: 'ABC123' },
          DEF456: { icao_hex: 'DEF456' },
        },
        cacheSize: 2,
      });

      const { result } = renderHook(() =>
        useAircraftInfo({
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      expect(result.current.cache).toEqual({
        ABC123: { icao_hex: 'ABC123' },
        DEF456: { icao_hex: 'DEF456' },
      });
    });
  });

  describe('callback wiring', () => {
    it('should wire onSuccess to cache and error clearing', () => {
      let capturedOnSuccess;
      useAircraftInfoFetcher.mockImplementation((options) => {
        capturedOnSuccess = options.onSuccess;
        return {
          fetchSingle: mockFetcherFetchSingle,
          fetchBulk: mockFetcherFetchBulk,
          pendingFetches: mockPendingFetches,
          retryQueueSize: 0,
        };
      });

      renderHook(() =>
        useAircraftInfo({
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      const data = { icao_hex: 'ABC123', registration: 'N12345' };
      capturedOnSuccess('ABC123', data);

      expect(mockCacheSetCacheEntry).toHaveBeenCalledWith('ABC123', data);
      expect(mockErrorsClearError).toHaveBeenCalledWith('ABC123');
    });

    it('should wire onError to cache deletion and error recording', () => {
      let capturedOnError;
      useAircraftInfoFetcher.mockImplementation((options) => {
        capturedOnError = options.onError;
        return {
          fetchSingle: mockFetcherFetchSingle,
          fetchBulk: mockFetcherFetchBulk,
          pendingFetches: mockPendingFetches,
          retryQueueSize: 0,
        };
      });

      renderHook(() =>
        useAircraftInfo({
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      const errorInfo = { error_type: 'fetch_failed', error_message: 'Network error' };
      capturedOnError('ABC123', errorInfo);

      expect(mockCacheDeleteCacheEntry).toHaveBeenCalledWith('ABC123');
      expect(mockErrorsRecordError).toHaveBeenCalledWith('ABC123', errorInfo);
    });

    it('should wire onCacheUpdate to batch cache updates', () => {
      let capturedOnCacheUpdate;
      useAircraftInfoFetcher.mockImplementation((options) => {
        capturedOnCacheUpdate = options.onCacheUpdate;
        return {
          fetchSingle: mockFetcherFetchSingle,
          fetchBulk: mockFetcherFetchBulk,
          pendingFetches: mockPendingFetches,
          retryQueueSize: 0,
        };
      });

      renderHook(() =>
        useAircraftInfo({
          wsRequest: mockWsRequest,
          wsConnected: true,
        })
      );

      const results = {
        abc123: { icao_hex: 'ABC123' },
        def456: { icao_hex: 'DEF456' },
      };
      capturedOnCacheUpdate(results);

      // Should normalize to uppercase
      expect(mockCacheSetCacheEntries).toHaveBeenCalledWith({
        ABC123: { icao_hex: 'ABC123' },
        DEF456: { icao_hex: 'DEF456' },
      });
      expect(mockErrorsClearError).toHaveBeenCalledWith('ABC123');
      expect(mockErrorsClearError).toHaveBeenCalledWith('DEF456');
    });
  });
});
