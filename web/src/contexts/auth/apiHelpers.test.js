import { describe, it, expect, vi } from 'vitest';
import { safeJson, createUserData, createDefaultConfig } from './apiHelpers';

describe('apiHelpers', () => {
  describe('safeJson', () => {
    it('should parse JSON from response with application/json content-type', async () => {
      const mockData = { foo: 'bar', count: 42 };
      const mockResponse = {
        headers: {
          get: vi.fn().mockReturnValue('application/json'),
        },
        json: vi.fn().mockResolvedValue(mockData),
      };

      const result = await safeJson(mockResponse);

      expect(result).toEqual(mockData);
      expect(mockResponse.headers.get).toHaveBeenCalledWith('content-type');
      expect(mockResponse.json).toHaveBeenCalled();
    });

    it('should parse JSON with charset in content-type', async () => {
      const mockData = { message: 'success' };
      const mockResponse = {
        headers: {
          get: vi.fn().mockReturnValue('application/json; charset=utf-8'),
        },
        json: vi.fn().mockResolvedValue(mockData),
      };

      const result = await safeJson(mockResponse);

      expect(result).toEqual(mockData);
    });

    it('should return null for non-JSON content-type', async () => {
      const mockResponse = {
        headers: {
          get: vi.fn().mockReturnValue('text/html'),
        },
        json: vi.fn(),
      };

      const result = await safeJson(mockResponse);

      expect(result).toBeNull();
      expect(mockResponse.json).not.toHaveBeenCalled();
    });

    it('should return null when content-type header is missing', async () => {
      const mockResponse = {
        headers: {
          get: vi.fn().mockReturnValue(null),
        },
        json: vi.fn(),
      };

      const result = await safeJson(mockResponse);

      expect(result).toBeNull();
      expect(mockResponse.json).not.toHaveBeenCalled();
    });

    it('should return null when JSON parsing fails', async () => {
      const mockResponse = {
        headers: {
          get: vi.fn().mockReturnValue('application/json'),
        },
        json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
      };

      const result = await safeJson(mockResponse);

      expect(result).toBeNull();
    });

    it('should handle text/plain content-type', async () => {
      const mockResponse = {
        headers: {
          get: vi.fn().mockReturnValue('text/plain'),
        },
        json: vi.fn(),
      };

      const result = await safeJson(mockResponse);

      expect(result).toBeNull();
    });

    it('should handle empty content-type string', async () => {
      const mockResponse = {
        headers: {
          get: vi.fn().mockReturnValue(''),
        },
        json: vi.fn(),
      };

      const result = await safeJson(mockResponse);

      expect(result).toBeNull();
    });
  });

  describe('createUserData', () => {
    it('should return default user data for null input', () => {
      const result = createUserData(null);

      expect(result).toEqual({
        id: null,
        username: '',
        email: '',
        displayName: '',
        permissions: [],
        roles: [],
      });
    });

    it('should return default user data for undefined input', () => {
      const result = createUserData(undefined);

      expect(result).toEqual({
        id: null,
        username: '',
        email: '',
        displayName: '',
        permissions: [],
        roles: [],
      });
    });

    it('should create user data from complete API response', () => {
      const apiData = {
        id: 1,
        username: 'testuser',
        email: 'test@example.com',
        display_name: 'Test User',
        permissions: ['view_alerts', 'edit_alerts'],
        roles: ['admin', 'user'],
      };

      const result = createUserData(apiData);

      expect(result).toEqual({
        id: 1,
        username: 'testuser',
        email: 'test@example.com',
        displayName: 'Test User',
        permissions: ['view_alerts', 'edit_alerts'],
        roles: ['admin', 'user'],
      });
    });

    it('should handle camelCase displayName', () => {
      const apiData = {
        id: 2,
        username: 'cameluser',
        displayName: 'Camel Case User',
      };

      const result = createUserData(apiData);

      expect(result.displayName).toBe('Camel Case User');
    });

    it('should prefer snake_case display_name over camelCase', () => {
      const apiData = {
        id: 3,
        display_name: 'Snake Case',
        displayName: 'Camel Case',
      };

      const result = createUserData(apiData);

      // display_name is checked first
      expect(result.displayName).toBe('Snake Case');
    });

    it('should handle missing optional fields', () => {
      const apiData = {
        id: 4,
        username: 'minimaluser',
      };

      const result = createUserData(apiData);

      expect(result).toEqual({
        id: 4,
        username: 'minimaluser',
        email: '',
        displayName: '',
        permissions: [],
        roles: [],
      });
    });

    it('should handle null values in fields', () => {
      const apiData = {
        id: null,
        username: null,
        email: null,
        display_name: null,
        permissions: null,
        roles: null,
      };

      const result = createUserData(apiData);

      expect(result).toEqual({
        id: null,
        username: '',
        email: '',
        displayName: '',
        permissions: [],
        roles: [],
      });
    });

    it('should handle empty object input', () => {
      const result = createUserData({});

      expect(result).toEqual({
        id: null,
        username: '',
        email: '',
        displayName: '',
        permissions: [],
        roles: [],
      });
    });

    it('should preserve extra fields passed in data', () => {
      const apiData = {
        id: 5,
        username: 'extrauser',
        extraField: 'should be ignored',
      };

      const result = createUserData(apiData);

      // Result should only have standard fields
      expect(result.extraField).toBeUndefined();
      expect(Object.keys(result)).toEqual([
        'id',
        'username',
        'email',
        'displayName',
        'permissions',
        'roles',
      ]);
    });

    it('should handle id as 0', () => {
      const apiData = {
        id: 0,
        username: 'zerouser',
      };

      const result = createUserData(apiData);

      expect(result.id).toBe(0);
    });
  });

  describe('createDefaultConfig', () => {
    it('should create default config with auth enabled', () => {
      const result = createDefaultConfig(true);

      expect(result).toEqual({
        authEnabled: true,
        publicMode: false,
        oidcEnabled: false,
        localAuthEnabled: true,
        apiKeyEnabled: false,
        features: {},
      });
    });

    it('should create default config with auth disabled', () => {
      const result = createDefaultConfig(false);

      expect(result).toEqual({
        authEnabled: false,
        publicMode: true,
        oidcEnabled: false,
        localAuthEnabled: false,
        apiKeyEnabled: false,
        features: {},
      });
    });

    it('should default to auth enabled when no argument provided', () => {
      const result = createDefaultConfig();

      expect(result).toEqual({
        authEnabled: true,
        publicMode: false,
        oidcEnabled: false,
        localAuthEnabled: true,
        apiKeyEnabled: false,
        features: {},
      });
    });

    it('should set publicMode opposite to authEnabled', () => {
      expect(createDefaultConfig(true).publicMode).toBe(false);
      expect(createDefaultConfig(false).publicMode).toBe(true);
    });

    it('should set localAuthEnabled same as authEnabled', () => {
      expect(createDefaultConfig(true).localAuthEnabled).toBe(true);
      expect(createDefaultConfig(false).localAuthEnabled).toBe(false);
    });

    it('should always disable oidcEnabled and apiKeyEnabled', () => {
      const enabledConfig = createDefaultConfig(true);
      const disabledConfig = createDefaultConfig(false);

      expect(enabledConfig.oidcEnabled).toBe(false);
      expect(enabledConfig.apiKeyEnabled).toBe(false);
      expect(disabledConfig.oidcEnabled).toBe(false);
      expect(disabledConfig.apiKeyEnabled).toBe(false);
    });

    it('should always return empty features object', () => {
      expect(createDefaultConfig(true).features).toEqual({});
      expect(createDefaultConfig(false).features).toEqual({});
    });
  });
});
