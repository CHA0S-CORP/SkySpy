import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  USER_KEY,
  getAccessToken,
  getRefreshToken,
  storeTokens,
  clearAuthData,
  getStoredUser,
  storeUser,
  parseJwt,
  isTokenExpired,
  getTokenExpiration,
  getAuthHeader,
  buildAuthenticatedWsUrl,
  authFetch,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  FEATURE_PERMISSIONS,
} from './auth';

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: vi.fn((key) => store[key] || null),
    setItem: vi.fn((key, value) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get store() {
      return store;
    },
  };
})();

// Mock fetch
const fetchMock = vi.fn();

beforeEach(() => {
  Object.defineProperty(global, 'localStorage', { value: localStorageMock, writable: true });
  global.fetch = fetchMock;
  localStorageMock.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('token storage keys', () => {
  it('should export correct key names', () => {
    expect(ACCESS_TOKEN_KEY).toBe('skyspy_access_token');
    expect(REFRESH_TOKEN_KEY).toBe('skyspy_refresh_token');
    expect(USER_KEY).toBe('skyspy_user');
  });
});

describe('getAccessToken', () => {
  it('should return token from localStorage', () => {
    localStorageMock.setItem(ACCESS_TOKEN_KEY, 'test-token');
    expect(getAccessToken()).toBe('test-token');
  });

  it('should return null if no token', () => {
    expect(getAccessToken()).toBeNull();
  });
});

describe('getRefreshToken', () => {
  it('should return refresh token from localStorage', () => {
    localStorageMock.setItem(REFRESH_TOKEN_KEY, 'refresh-token');
    expect(getRefreshToken()).toBe('refresh-token');
  });

  it('should return null if no refresh token', () => {
    expect(getRefreshToken()).toBeNull();
  });
});

describe('storeTokens', () => {
  it('should store access token', () => {
    storeTokens('access-token', null);
    expect(localStorageMock.setItem).toHaveBeenCalledWith(ACCESS_TOKEN_KEY, 'access-token');
  });

  it('should store refresh token', () => {
    storeTokens(null, 'refresh-token');
    expect(localStorageMock.setItem).toHaveBeenCalledWith(REFRESH_TOKEN_KEY, 'refresh-token');
  });

  it('should store both tokens', () => {
    storeTokens('access-token', 'refresh-token');
    expect(localStorageMock.setItem).toHaveBeenCalledWith(ACCESS_TOKEN_KEY, 'access-token');
    expect(localStorageMock.setItem).toHaveBeenCalledWith(REFRESH_TOKEN_KEY, 'refresh-token');
  });

  it('should not store null access token', () => {
    storeTokens(null, 'refresh-token');
    expect(localStorageMock.setItem).not.toHaveBeenCalledWith(ACCESS_TOKEN_KEY, null);
  });

  it('should not store null refresh token', () => {
    storeTokens('access-token', null);
    expect(localStorageMock.setItem).not.toHaveBeenCalledWith(REFRESH_TOKEN_KEY, null);
  });
});

describe('clearAuthData', () => {
  it('should remove all auth data from localStorage', () => {
    localStorageMock.setItem(ACCESS_TOKEN_KEY, 'access');
    localStorageMock.setItem(REFRESH_TOKEN_KEY, 'refresh');
    localStorageMock.setItem(USER_KEY, '{}');

    clearAuthData();

    expect(localStorageMock.removeItem).toHaveBeenCalledWith(ACCESS_TOKEN_KEY);
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(REFRESH_TOKEN_KEY);
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(USER_KEY);
  });
});

describe('getStoredUser', () => {
  it('should return parsed user object', () => {
    const user = { id: 1, username: 'test' };
    localStorageMock.setItem(USER_KEY, JSON.stringify(user));
    expect(getStoredUser()).toEqual(user);
  });

  it('should return null if no user stored', () => {
    expect(getStoredUser()).toBeNull();
  });

  it('should return null for invalid JSON', () => {
    localStorageMock.setItem(USER_KEY, 'invalid-json');
    // Need to make getItem return the invalid JSON
    localStorageMock.getItem.mockReturnValueOnce('invalid-json');
    expect(getStoredUser()).toBeNull();
  });
});

describe('storeUser', () => {
  it('should store user as JSON', () => {
    const user = { id: 1, username: 'test' };
    storeUser(user);
    expect(localStorageMock.setItem).toHaveBeenCalledWith(USER_KEY, JSON.stringify(user));
  });

  it('should not store null user', () => {
    storeUser(null);
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });

  it('should not store undefined user', () => {
    storeUser(undefined);
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });
});

describe('parseJwt', () => {
  // Create a valid JWT for testing
  const createJwt = (payload) => {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payloadB64 = btoa(JSON.stringify(payload));
    return `${header}.${payloadB64}.signature`;
  };

  it('should parse valid JWT payload', () => {
    const payload = { sub: '123', name: 'Test User', exp: 1234567890 };
    const token = createJwt(payload);
    const result = parseJwt(token);
    expect(result).toEqual(payload);
  });

  it('should return null for null token', () => {
    expect(parseJwt(null)).toBeNull();
  });

  it('should return null for undefined token', () => {
    expect(parseJwt(undefined)).toBeNull();
  });

  it('should return null for non-string token', () => {
    expect(parseJwt(123)).toBeNull();
    expect(parseJwt({})).toBeNull();
  });

  it('should return null for token without 3 parts', () => {
    expect(parseJwt('only.two')).toBeNull();
    expect(parseJwt('one')).toBeNull();
    expect(parseJwt('a.b.c.d')).toBeNull();
  });

  it('should return null for empty payload section', () => {
    expect(parseJwt('header..signature')).toBeNull();
  });

  it('should return null for invalid base64', () => {
    // Using console spy to suppress warning
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseJwt('header.!!!invalid!!!.signature')).toBeNull();
    consoleSpy.mockRestore();
  });

  it('should return null for invalid JSON in payload', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const header = btoa('{}');
    const invalidPayload = btoa('not json');
    expect(parseJwt(`${header}.${invalidPayload}.sig`)).toBeNull();
    consoleSpy.mockRestore();
  });

  it('should handle base64url encoding', () => {
    // Base64url uses - instead of + and _ instead of /
    const payload = { data: 'test+/value' };
    const header = btoa('{}');
    const payloadB64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_');
    const token = `${header}.${payloadB64}.sig`;
    const result = parseJwt(token);
    expect(result).toEqual(payload);
  });
});

describe('isTokenExpired', () => {
  const createJwt = (exp) => {
    const header = btoa(JSON.stringify({ alg: 'HS256' }));
    const payload = btoa(JSON.stringify({ exp }));
    return `${header}.${payload}.sig`;
  };

  it('should return true for null token', () => {
    expect(isTokenExpired(null)).toBe(true);
  });

  it('should return true for expired token', () => {
    const expiredToken = createJwt(Math.floor(Date.now() / 1000) - 100);
    expect(isTokenExpired(expiredToken)).toBe(true);
  });

  it('should return true for token expiring within buffer', () => {
    // Token expires in 20 seconds, buffer is 30
    const soonExpiredToken = createJwt(Math.floor(Date.now() / 1000) + 20);
    expect(isTokenExpired(soonExpiredToken, 30)).toBe(true);
  });

  it('should return false for valid token', () => {
    // Token expires in 1 hour
    const validToken = createJwt(Math.floor(Date.now() / 1000) + 3600);
    expect(isTokenExpired(validToken)).toBe(false);
  });

  it('should return true for token without exp claim', () => {
    const header = btoa('{}');
    const payload = btoa(JSON.stringify({ sub: '123' }));
    const token = `${header}.${payload}.sig`;
    expect(isTokenExpired(token)).toBe(true);
  });

  it('should use default buffer of 30 seconds', () => {
    // Token expires in 25 seconds (less than default 30 buffer)
    const token = createJwt(Math.floor(Date.now() / 1000) + 25);
    expect(isTokenExpired(token)).toBe(true);
  });
});

describe('getTokenExpiration', () => {
  const createJwt = (exp) => {
    const header = btoa(JSON.stringify({ alg: 'HS256' }));
    const payload = btoa(JSON.stringify({ exp }));
    return `${header}.${payload}.sig`;
  };

  it('should return 0 for null token', () => {
    expect(getTokenExpiration(null)).toBe(0);
  });

  it('should return 0 for token without exp', () => {
    const header = btoa('{}');
    const payload = btoa(JSON.stringify({ sub: '123' }));
    const token = `${header}.${payload}.sig`;
    expect(getTokenExpiration(token)).toBe(0);
  });

  it('should return expiration in milliseconds', () => {
    const expSeconds = Math.floor(Date.now() / 1000) + 3600;
    const token = createJwt(expSeconds);
    expect(getTokenExpiration(token)).toBe(expSeconds * 1000);
  });
});

describe('getAuthHeader', () => {
  it('should return Bearer header with token', () => {
    localStorageMock.setItem(ACCESS_TOKEN_KEY, 'test-token');
    localStorageMock.getItem.mockReturnValueOnce('test-token');
    expect(getAuthHeader()).toBe('Bearer test-token');
  });

  it('should return null if no token', () => {
    expect(getAuthHeader()).toBeNull();
  });
});

describe('buildAuthenticatedWsUrl', () => {
  it('should add token as query parameter', () => {
    localStorageMock.setItem(ACCESS_TOKEN_KEY, 'ws-token');
    localStorageMock.getItem.mockReturnValueOnce('ws-token');
    const result = buildAuthenticatedWsUrl('wss://example.com/socket');
    expect(result).toBe('wss://example.com/socket?token=ws-token');
  });

  it('should use provided token over stored token', () => {
    localStorageMock.setItem(ACCESS_TOKEN_KEY, 'stored-token');
    const result = buildAuthenticatedWsUrl('wss://example.com/socket', 'provided-token');
    expect(result).toBe('wss://example.com/socket?token=provided-token');
  });

  it('should use & if URL already has query params', () => {
    localStorageMock.getItem.mockReturnValueOnce('token');
    const result = buildAuthenticatedWsUrl('wss://example.com/socket?existing=param', 'token');
    expect(result).toBe('wss://example.com/socket?existing=param&token=token');
  });

  it('should return base URL if no token', () => {
    const result = buildAuthenticatedWsUrl('wss://example.com/socket');
    expect(result).toBe('wss://example.com/socket');
  });

  it('should encode token value', () => {
    const result = buildAuthenticatedWsUrl('wss://example.com', 'token+with/special=chars');
    expect(result).toContain(encodeURIComponent('token+with/special=chars'));
  });
});

describe('authFetch', () => {
  it('should add Authorization header when token exists', async () => {
    localStorageMock.getItem.mockReturnValueOnce('auth-token');
    fetchMock.mockResolvedValueOnce({ ok: true });

    await authFetch('https://api.example.com/data');

    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/data', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer auth-token',
      },
    });
  });

  it('should not add Authorization header when no token', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    await authFetch('https://api.example.com/data');

    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/data', {
      headers: {
        'Content-Type': 'application/json',
      },
    });
  });

  it('should merge custom headers', async () => {
    localStorageMock.getItem.mockReturnValueOnce('token');
    fetchMock.mockResolvedValueOnce({ ok: true });

    await authFetch('https://api.example.com/data', {
      headers: { 'X-Custom-Header': 'value' },
    });

    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/data', {
      headers: {
        'Content-Type': 'application/json',
        'X-Custom-Header': 'value',
        Authorization: 'Bearer token',
      },
    });
  });

  it('should pass through other options', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    await authFetch('https://api.example.com/data', {
      method: 'POST',
      body: JSON.stringify({ data: 'test' }),
    });

    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/data', {
      method: 'POST',
      body: JSON.stringify({ data: 'test' }),
      headers: {
        'Content-Type': 'application/json',
      },
    });
  });
});

describe('hasPermission', () => {
  it('should return true if permission exists', () => {
    expect(hasPermission(['read', 'write', 'delete'], 'write')).toBe(true);
  });

  it('should return false if permission does not exist', () => {
    expect(hasPermission(['read', 'write'], 'delete')).toBe(false);
  });

  it('should return false for null permissions', () => {
    expect(hasPermission(null, 'read')).toBe(false);
  });

  it('should return false for undefined permissions', () => {
    expect(hasPermission(undefined, 'read')).toBe(false);
  });

  it('should return false for non-array permissions', () => {
    expect(hasPermission('read', 'read')).toBe(false);
    expect(hasPermission({}, 'read')).toBe(false);
  });

  it('should return false for empty array', () => {
    expect(hasPermission([], 'read')).toBe(false);
  });
});

describe('hasAnyPermission', () => {
  it('should return true if any permission matches', () => {
    expect(hasAnyPermission(['read', 'write'], ['delete', 'write'])).toBe(true);
  });

  it('should return false if no permissions match', () => {
    expect(hasAnyPermission(['read', 'write'], ['delete', 'admin'])).toBe(false);
  });

  it('should return false for null permissions', () => {
    expect(hasAnyPermission(null, ['read'])).toBe(false);
  });

  it('should return false for non-array permissions', () => {
    expect(hasAnyPermission('read', ['read'])).toBe(false);
  });

  it('should return true if all required permissions are present', () => {
    expect(hasAnyPermission(['read', 'write', 'delete'], ['read'])).toBe(true);
  });
});

describe('hasAllPermissions', () => {
  it('should return true if all required permissions exist', () => {
    expect(hasAllPermissions(['read', 'write', 'delete'], ['read', 'write'])).toBe(true);
  });

  it('should return false if any required permission is missing', () => {
    expect(hasAllPermissions(['read', 'write'], ['read', 'write', 'delete'])).toBe(false);
  });

  it('should return false for null permissions', () => {
    expect(hasAllPermissions(null, ['read'])).toBe(false);
  });

  it('should return false for non-array permissions', () => {
    expect(hasAllPermissions('read', ['read'])).toBe(false);
  });

  it('should return true for empty required array', () => {
    expect(hasAllPermissions(['read', 'write'], [])).toBe(true);
  });
});

describe('FEATURE_PERMISSIONS', () => {
  it('should contain aircraft permissions', () => {
    expect(FEATURE_PERMISSIONS.aircraft).toBeDefined();
    expect(FEATURE_PERMISSIONS.aircraft.view).toBe('aircraft.view');
    expect(FEATURE_PERMISSIONS.aircraft.viewMilitary).toBe('aircraft.view_military');
  });

  it('should contain alerts permissions', () => {
    expect(FEATURE_PERMISSIONS.alerts).toBeDefined();
    expect(FEATURE_PERMISSIONS.alerts.view).toBe('alerts.view');
    expect(FEATURE_PERMISSIONS.alerts.create).toBe('alerts.create');
    expect(FEATURE_PERMISSIONS.alerts.edit).toBe('alerts.edit');
    expect(FEATURE_PERMISSIONS.alerts.delete).toBe('alerts.delete');
  });

  it('should contain safety permissions', () => {
    expect(FEATURE_PERMISSIONS.safety).toBeDefined();
    expect(FEATURE_PERMISSIONS.safety.view).toBe('safety.view');
  });

  it('should contain audio permissions', () => {
    expect(FEATURE_PERMISSIONS.audio).toBeDefined();
    expect(FEATURE_PERMISSIONS.audio.view).toBe('audio.view');
  });

  it('should contain acars permissions', () => {
    expect(FEATURE_PERMISSIONS.acars).toBeDefined();
    expect(FEATURE_PERMISSIONS.acars.view).toBe('acars.view');
  });

  it('should contain history permissions', () => {
    expect(FEATURE_PERMISSIONS.history).toBeDefined();
    expect(FEATURE_PERMISSIONS.history.view).toBe('history.view');
    expect(FEATURE_PERMISSIONS.history.export).toBe('history.export');
  });

  it('should contain system permissions', () => {
    expect(FEATURE_PERMISSIONS.system).toBeDefined();
    expect(FEATURE_PERMISSIONS.system.viewStatus).toBe('system.view_status');
  });

  it('should contain users permissions', () => {
    expect(FEATURE_PERMISSIONS.users).toBeDefined();
    expect(FEATURE_PERMISSIONS.users.view).toBe('users.view');
    expect(FEATURE_PERMISSIONS.users.create).toBe('users.create');
  });

  it('should contain roles permissions', () => {
    expect(FEATURE_PERMISSIONS.roles).toBeDefined();
    expect(FEATURE_PERMISSIONS.roles.view).toBe('roles.view');
    expect(FEATURE_PERMISSIONS.roles.create).toBe('roles.create');
  });
});
