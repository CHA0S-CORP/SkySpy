import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAircraftInfoErrors } from './useAircraftInfoErrors';

describe('useAircraftInfoErrors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('basic error operations', () => {
    it('should start with empty errors', () => {
      const { result } = renderHook(() => useAircraftInfoErrors());
      expect(result.current.errorCount).toBe(0);
      expect(result.current.errors).toEqual({});
    });

    it('should record errors', () => {
      const { result } = renderHook(() => useAircraftInfoErrors());

      act(() => {
        result.current.recordError('ABC123', {
          error_type: 'fetch_failed',
          error_message: 'Network error',
          source: 'test',
        });
      });

      expect(result.current.errorCount).toBe(1);
      expect(result.current.errors['ABC123']).toBeDefined();
      expect(result.current.errors['ABC123'].error_type).toBe('fetch_failed');
      expect(result.current.errors['ABC123'].error_message).toBe('Network error');
      expect(result.current.errors['ABC123'].timestamp).toBeDefined();
    });

    it('should normalize ICAO to uppercase', () => {
      const { result } = renderHook(() => useAircraftInfoErrors());

      act(() => {
        result.current.recordError('abc123', {
          error_type: 'not_found',
          error_message: 'Not found',
          source: 'test',
        });
      });

      expect(result.current.errors['ABC123']).toBeDefined();
      expect(result.current.getError('abc123')).toBeDefined();
      expect(result.current.getError('ABC123')).toBeDefined();
    });

    it('should get errors', () => {
      const { result } = renderHook(() => useAircraftInfoErrors());

      act(() => {
        result.current.recordError('ABC123', {
          error_type: 'timeout',
          error_message: 'Request timed out',
          source: 'test',
        });
      });

      const error = result.current.getError('ABC123');
      expect(error).toBeDefined();
      expect(error.error_type).toBe('timeout');
    });

    it('should return null for non-existent errors', () => {
      const { result } = renderHook(() => useAircraftInfoErrors());
      expect(result.current.getError('NOTFOUND')).toBeNull();
      expect(result.current.getError(null)).toBeNull();
      expect(result.current.getError(undefined)).toBeNull();
    });

    it('should clear specific errors', () => {
      const { result } = renderHook(() => useAircraftInfoErrors());

      act(() => {
        result.current.recordError('ABC123', { error_type: 'error1', error_message: 'Error 1', source: 'test' });
        result.current.recordError('DEF456', { error_type: 'error2', error_message: 'Error 2', source: 'test' });
      });

      expect(result.current.errorCount).toBe(2);

      act(() => {
        result.current.clearError('ABC123');
      });

      expect(result.current.errorCount).toBe(1);
      expect(result.current.getError('ABC123')).toBeNull();
      expect(result.current.getError('DEF456')).toBeDefined();
    });

    it('should clear all errors', () => {
      const { result } = renderHook(() => useAircraftInfoErrors());

      act(() => {
        result.current.recordError('ABC123', { error_type: 'error1', error_message: 'Error 1', source: 'test' });
        result.current.recordError('DEF456', { error_type: 'error2', error_message: 'Error 2', source: 'test' });
        result.current.recordError('GHI789', { error_type: 'error3', error_message: 'Error 3', source: 'test' });
      });

      expect(result.current.errorCount).toBe(3);

      act(() => {
        result.current.clearAllErrors();
      });

      expect(result.current.errorCount).toBe(0);
      expect(result.current.errors).toEqual({});
    });

    it('should add timestamp automatically if not provided', () => {
      const { result } = renderHook(() => useAircraftInfoErrors());

      const beforeTime = new Date().toISOString();
      act(() => {
        result.current.recordError('ABC123', {
          error_type: 'test',
          error_message: 'Test error',
          source: 'test',
        });
      });
      const afterTime = new Date().toISOString();

      const error = result.current.getError('ABC123');
      expect(error.timestamp).toBeDefined();
      expect(error.timestamp >= beforeTime).toBe(true);
      expect(error.timestamp <= afterTime).toBe(true);
    });

    it('should preserve provided timestamp', () => {
      const { result } = renderHook(() => useAircraftInfoErrors());
      const customTimestamp = '2024-01-01T00:00:00.000Z';

      act(() => {
        result.current.recordError('ABC123', {
          error_type: 'test',
          error_message: 'Test error',
          source: 'test',
          timestamp: customTimestamp,
        });
      });

      expect(result.current.getError('ABC123').timestamp).toBe(customTimestamp);
    });
  });

  describe('external error integration', () => {
    it('should check external getAirframeError if provided', () => {
      const getAirframeError = vi.fn().mockReturnValue({
        error_type: 'external_error',
        error_message: 'From WebSocket',
        source: 'websocket',
      });

      const { result } = renderHook(() =>
        useAircraftInfoErrors({ getAirframeError })
      );

      // Local error should take precedence
      act(() => {
        result.current.recordError('ABC123', {
          error_type: 'local_error',
          error_message: 'Local error',
          source: 'local',
        });
      });

      expect(result.current.getError('ABC123').error_type).toBe('local_error');

      // For unknown ICAO, should check external
      const externalError = result.current.getError('EXTERNAL');
      expect(getAirframeError).toHaveBeenCalledWith('EXTERNAL');
      expect(externalError.error_type).toBe('external_error');
    });

    it('should call external clearAirframeError when clearing', () => {
      const clearAirframeError = vi.fn();

      const { result } = renderHook(() =>
        useAircraftInfoErrors({ clearAirframeError })
      );

      act(() => {
        result.current.recordError('ABC123', {
          error_type: 'test',
          error_message: 'Test',
          source: 'test',
        });
      });

      act(() => {
        result.current.clearError('ABC123');
      });

      expect(clearAirframeError).toHaveBeenCalledWith('ABC123');
    });
  });

  describe('edge cases', () => {
    it('should handle clearing non-existent error gracefully', () => {
      const { result } = renderHook(() => useAircraftInfoErrors());

      // Should not throw
      act(() => {
        result.current.clearError('NOTFOUND');
      });

      expect(result.current.errorCount).toBe(0);
    });

    it('should handle null/undefined ICAO gracefully', () => {
      const { result } = renderHook(() => useAircraftInfoErrors());

      act(() => {
        result.current.recordError(null, { error_type: 'test', error_message: 'Test', source: 'test' });
        result.current.recordError(undefined, { error_type: 'test', error_message: 'Test', source: 'test' });
      });

      expect(result.current.errorCount).toBe(0);

      act(() => {
        result.current.clearError(null);
        result.current.clearError(undefined);
      });

      // Should not throw
      expect(result.current.errorCount).toBe(0);
    });

    it('should overwrite existing errors for same ICAO', () => {
      const { result } = renderHook(() => useAircraftInfoErrors());

      act(() => {
        result.current.recordError('ABC123', {
          error_type: 'error1',
          error_message: 'First error',
          source: 'test',
        });
      });

      act(() => {
        result.current.recordError('ABC123', {
          error_type: 'error2',
          error_message: 'Second error',
          source: 'test',
        });
      });

      expect(result.current.errorCount).toBe(1);
      expect(result.current.getError('ABC123').error_type).toBe('error2');
      expect(result.current.getError('ABC123').error_message).toBe('Second error');
    });
  });
});
