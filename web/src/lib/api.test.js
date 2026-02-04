import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiError, parseDRFError, api } from './api';

describe('api', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('ApiError', () => {
    it('should create error with basic properties', () => {
      const error = new ApiError('Test error', 404);

      expect(error.message).toBe('Test error');
      expect(error.status).toBe(404);
      expect(error.data).toBeNull();
      expect(error.isCorsError).toBe(false);
      expect(error.isTimeout).toBe(false);
      expect(error.name).toBe('ApiError');
    });

    it('should create error with all properties', () => {
      const errorData = { detail: 'Not found' };
      const error = new ApiError('CORS error', 0, errorData, true, false);

      expect(error.message).toBe('CORS error');
      expect(error.status).toBe(0);
      expect(error.data).toEqual(errorData);
      expect(error.isCorsError).toBe(true);
      expect(error.isTimeout).toBe(false);
    });

    it('should create timeout error', () => {
      const error = new ApiError('Request timeout', 0, null, false, true);

      expect(error.isTimeout).toBe(true);
      expect(error.isCorsError).toBe(false);
    });

    it('should be instanceof Error', () => {
      const error = new ApiError('Test', 500);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ApiError);
    });
  });

  describe('parseDRFError', () => {
    it('should return default message for null data', () => {
      expect(parseDRFError(null)).toBe('Unknown error occurred');
    });

    it('should return default message for undefined data', () => {
      expect(parseDRFError(undefined)).toBe('Unknown error occurred');
    });

    it('should return string data directly', () => {
      expect(parseDRFError('Simple error message')).toBe('Simple error message');
    });

    it('should parse { detail: "message" } format', () => {
      expect(parseDRFError({ detail: 'Authentication failed' })).toBe('Authentication failed');
    });

    it('should parse { error: "message" } format', () => {
      expect(parseDRFError({ error: 'Invalid token' })).toBe('Invalid token');
    });

    it('should parse { message: "message" } format', () => {
      expect(parseDRFError({ message: 'Operation failed' })).toBe('Operation failed');
    });

    it('should parse { non_field_errors: ["error"] } format', () => {
      expect(parseDRFError({ non_field_errors: ['Invalid credentials'] })).toBe('Invalid credentials');
    });

    it('should join multiple non_field_errors', () => {
      const data = { non_field_errors: ['Error 1', 'Error 2', 'Error 3'] };
      expect(parseDRFError(data)).toBe('Error 1, Error 2, Error 3');
    });

    it('should parse field-level errors with arrays', () => {
      const data = { username: ['This field is required.'] };
      expect(parseDRFError(data)).toBe('username: This field is required.');
    });

    it('should parse multiple field-level errors', () => {
      const data = {
        username: ['Too short', 'Invalid characters'],
        email: ['Invalid email format'],
      };
      const result = parseDRFError(data);
      expect(result).toContain('username: Too short, Invalid characters');
      expect(result).toContain('email: Invalid email format');
    });

    it('should parse field-level errors with string values', () => {
      const data = { password: 'Password is too weak' };
      expect(parseDRFError(data)).toBe('password: Password is too weak');
    });

    it('should return default for empty object', () => {
      expect(parseDRFError({})).toBe('Unknown error occurred');
    });

    it('should prioritize detail over other formats', () => {
      const data = {
        detail: 'Primary error',
        error: 'Secondary error',
        non_field_errors: ['Tertiary error'],
      };
      expect(parseDRFError(data)).toBe('Primary error');
    });

    it('should prioritize error over non_field_errors', () => {
      const data = {
        error: 'Primary error',
        non_field_errors: ['Secondary error'],
      };
      expect(parseDRFError(data)).toBe('Primary error');
    });
  });

  describe('api request handling', () => {
    const mockJsonResponse = (data, status = 200, headers = {}) => {
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: {
          get: (name) => {
            if (name === 'content-type') return 'application/json';
            return headers[name] || null;
          },
        },
        json: () => Promise.resolve(data),
      });
    };

    const mockNonJsonResponse = (status = 200, contentType = 'text/html') => {
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: {
          get: (name) => {
            if (name === 'content-type') return contentType;
            return null;
          },
        },
        json: () => Promise.reject(new Error('Not JSON')),
      });
    };

    describe('getAircraft', () => {
      it('should fetch aircraft list', async () => {
        const mockData = { count: 2, aircraft: [{ hex: 'ABC123' }, { hex: 'DEF456' }] };
        global.fetch.mockReturnValue(mockJsonResponse(mockData));

        const result = await api.getAircraft();

        expect(global.fetch).toHaveBeenCalledWith(
          '/api/v1/aircraft/',
          expect.objectContaining({
            method: 'GET',
            headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
          })
        );
        expect(result).toEqual(mockData);
      });

      it('should pass query parameters', async () => {
        global.fetch.mockReturnValue(mockJsonResponse({ count: 0, aircraft: [] }));

        await api.getAircraft({ military_only: true, limit: 50 });

        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('military_only=true'),
          expect.any(Object)
        );
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('limit=50'),
          expect.any(Object)
        );
      });
    });

    describe('getAircraftDetail', () => {
      it('should fetch aircraft by hex', async () => {
        const mockData = { hex: 'ABC123', flight: 'UAL123' };
        global.fetch.mockReturnValue(mockJsonResponse(mockData));

        const result = await api.getAircraftDetail('ABC123');

        expect(global.fetch).toHaveBeenCalledWith(
          '/api/v1/aircraft/ABC123/',
          expect.any(Object)
        );
        expect(result).toEqual(mockData);
      });
    });

    describe('alert endpoints', () => {
      it('should get alert rules', async () => {
        const mockData = { count: 1, rules: [{ id: 1, name: 'Test Rule' }] };
        global.fetch.mockReturnValue(mockJsonResponse(mockData));

        const result = await api.getAlertRules();

        expect(global.fetch).toHaveBeenCalledWith(
          '/api/v1/alerts/rules/',
          expect.any(Object)
        );
        expect(result).toEqual(mockData);
      });

      it('should create alert rule', async () => {
        const newRule = { name: 'New Rule', conditions: {} };
        const mockData = { id: 2, ...newRule };
        global.fetch.mockReturnValue(mockJsonResponse(mockData, 201));

        const result = await api.createAlertRule(newRule);

        expect(global.fetch).toHaveBeenCalledWith(
          '/api/v1/alerts/rules/',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify(newRule),
          })
        );
        expect(result).toEqual(mockData);
      });

      it('should update alert rule', async () => {
        const updates = { name: 'Updated Rule' };
        const mockData = { id: 1, name: 'Updated Rule' };
        global.fetch.mockReturnValue(mockJsonResponse(mockData));

        const result = await api.updateAlertRule(1, updates);

        expect(global.fetch).toHaveBeenCalledWith(
          '/api/v1/alerts/rules/1/',
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify(updates),
          })
        );
        expect(result).toEqual(mockData);
      });

      it('should delete alert rule', async () => {
        global.fetch.mockReturnValue(mockJsonResponse(null, 204));

        await api.deleteAlertRule(1);

        expect(global.fetch).toHaveBeenCalledWith(
          '/api/v1/alerts/rules/1/',
          expect.objectContaining({ method: 'DELETE' })
        );
      });

      it('should toggle alert rule', async () => {
        const mockData = { id: 1, enabled: false };
        global.fetch.mockReturnValue(mockJsonResponse(mockData));

        const result = await api.toggleAlertRule(1);

        expect(global.fetch).toHaveBeenCalledWith(
          '/api/v1/alerts/rules/1/toggle/',
          expect.objectContaining({ method: 'POST' })
        );
        expect(result).toEqual(mockData);
      });
    });

    describe('error handling', () => {
      it('should throw ApiError for 404 response', async () => {
        global.fetch.mockReturnValue(mockJsonResponse({ detail: 'Not found' }, 404));

        await expect(api.getAircraftDetail('NOTFOUND')).rejects.toThrow(ApiError);

        try {
          await api.getAircraftDetail('NOTFOUND');
        } catch (error) {
          expect(error.status).toBe(404);
          expect(error.message).toBe('Not found');
        }
      });

      it('should throw ApiError for 401 response', async () => {
        global.fetch.mockReturnValue(mockJsonResponse({ detail: 'Authentication required' }, 401));

        await expect(api.getAlertRules()).rejects.toThrow(ApiError);

        try {
          await api.getAlertRules();
        } catch (error) {
          expect(error.status).toBe(401);
        }
      });

      it('should throw ApiError for 500 response', async () => {
        global.fetch.mockReturnValue(mockJsonResponse({ error: 'Internal server error' }, 500));

        await expect(api.getSystemStatus()).rejects.toThrow(ApiError);
      });

      it('should handle non-JSON error response', async () => {
        global.fetch.mockReturnValue(mockNonJsonResponse(500, 'text/html'));

        try {
          await api.getSystemStatus();
        } catch (error) {
          expect(error).toBeInstanceOf(ApiError);
          expect(error.message).toBe('HTTP 500');
        }
      });

      it('should throw timeout error when fetch aborts', async () => {
        // Directly mock fetch to reject with AbortError (simulating timeout)
        const abortError = new Error('The operation was aborted');
        abortError.name = 'AbortError';
        global.fetch.mockRejectedValue(abortError);

        try {
          await api.getAircraft();
          expect.fail('Expected promise to reject');
        } catch (error) {
          expect(error).toBeInstanceOf(ApiError);
          expect(error.isTimeout).toBe(true);
          expect(error.message).toContain('timeout');
          expect(error.status).toBe(0);
        }
      });

      it('should throw CORS error on TypeError with Failed to fetch', async () => {
        const corsError = new TypeError('Failed to fetch');
        global.fetch.mockRejectedValue(corsError);

        try {
          await api.getAircraft();
        } catch (error) {
          expect(error).toBeInstanceOf(ApiError);
          expect(error.isCorsError).toBe(true);
          expect(error.message).toContain('CORS');
        }
      });

      it('should throw network error for other fetch failures', async () => {
        const networkError = new Error('Network unavailable');
        global.fetch.mockRejectedValue(networkError);

        try {
          await api.getAircraft();
        } catch (error) {
          expect(error).toBeInstanceOf(ApiError);
          expect(error.message).toBe('Network unavailable');
          expect(error.isCorsError).toBe(false);
          expect(error.isTimeout).toBe(false);
        }
      });
    });

    describe('URL building', () => {
      it('should omit null params', async () => {
        global.fetch.mockReturnValue(mockJsonResponse({}));

        await api.getAircraft({ limit: null, offset: 10 });

        expect(global.fetch).toHaveBeenCalledWith(
          '/api/v1/aircraft/?offset=10',
          expect.any(Object)
        );
      });

      it('should omit undefined params', async () => {
        global.fetch.mockReturnValue(mockJsonResponse({}));

        await api.getAircraft({ limit: undefined, offset: 0 });

        expect(global.fetch).toHaveBeenCalledWith(
          '/api/v1/aircraft/?offset=0',
          expect.any(Object)
        );
      });

      it('should include boolean false params', async () => {
        global.fetch.mockReturnValue(mockJsonResponse({}));

        await api.getAlertRules({ enabled: false });

        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('enabled=false'),
          expect.any(Object)
        );
      });
    });

    describe('admin endpoints', () => {
      it('should get admin configs', async () => {
        const mockData = { configs: [] };
        global.fetch.mockReturnValue(mockJsonResponse(mockData));

        const result = await api.admin.getConfigs();

        expect(global.fetch).toHaveBeenCalledWith(
          '/api/v1/admin/configs/',
          expect.any(Object)
        );
        expect(result).toEqual(mockData);
      });

      it('should update admin config', async () => {
        const updates = { value: 'new-value' };
        global.fetch.mockReturnValue(mockJsonResponse({ id: 1, ...updates }));

        await api.admin.updateConfig(1, updates);

        expect(global.fetch).toHaveBeenCalledWith(
          '/api/v1/admin/configs/1/',
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify(updates),
          })
        );
      });
    });

    describe('credentials and headers', () => {
      it('should include credentials for session auth', async () => {
        global.fetch.mockReturnValue(mockJsonResponse({}));

        await api.getAircraft();

        expect(global.fetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ credentials: 'include' })
        );
      });

      it('should set Content-Type header', async () => {
        global.fetch.mockReturnValue(mockJsonResponse({}));

        await api.getAircraft();

        expect(global.fetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
          })
        );
      });
    });
  });

  describe('specific endpoint coverage', () => {
    const mockJsonResponse = (data, status = 200) => {
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: {
          get: () => 'application/json',
        },
        json: () => Promise.resolve(data),
      });
    };

    beforeEach(() => {
      global.fetch.mockReturnValue(mockJsonResponse({}));
    });

    it('should call getAircraftHistory', async () => {
      await api.getAircraftHistory('ABC123', { hours: 24 });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/sightings/'),
        expect.any(Object)
      );
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('icao=ABC123'),
        expect.any(Object)
      );
    });

    it('should call getStats', async () => {
      await api.getStats({ hours: 24 });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/history/stats/'),
        expect.any(Object)
      );
    });

    it('should call getAcarsMessages', async () => {
      await api.getAcarsMessages({ limit: 100 });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/acars/'),
        expect.any(Object)
      );
    });

    it('should call getSafetyEvents', async () => {
      await api.getSafetyEvents({ severity: 'high' });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/safety/events/'),
        expect.any(Object)
      );
    });

    it('should call getNotams', async () => {
      await api.getNotams({ icao: 'KJFK' });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/notams/'),
        expect.any(Object)
      );
    });

    it('should call lookupAircraft', async () => {
      await api.lookupAircraft('ABC123');
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/lookup/aircraft/ABC123',
        expect.any(Object)
      );
    });

    it('should call lookupRoute', async () => {
      await api.lookupRoute('UAL123');
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/lookup/route/UAL123',
        expect.any(Object)
      );
    });

    it('should call getMapGeoJson', async () => {
      await api.getMapGeoJson();
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/map/geojson/',
        expect.any(Object)
      );
    });

    it('should call toggleFavorite', async () => {
      await api.toggleFavorite('ABC123');
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/stats/favorites/toggle/ABC123/',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should call acknowledgeAlert', async () => {
      await api.acknowledgeAlert(1);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/alerts/history/1/acknowledge/',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should call acknowledgeSafetyEvent', async () => {
      await api.acknowledgeSafetyEvent(1);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/safety/events/1/acknowledge/',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });
});
