import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';

// Helper to create JWT token
const createJwt = (payload) => {
  const header = { alg: 'HS256', typ: 'JWT' };
  const base64Header = btoa(JSON.stringify(header))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  const base64Payload = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  const signature = 'test-signature';
  return `${base64Header}.${base64Payload}.${signature}`;
};

// Create tokens that expire in the future
const createValidToken = (expiresInSeconds = 3600) => {
  return createJwt({
    sub: 'user123',
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
    iat: Math.floor(Date.now() / 1000),
  });
};

const createExpiredToken = () => {
  return createJwt({
    sub: 'user123',
    exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
    iat: Math.floor(Date.now() / 1000) - 7200,
  });
};

describe('AuthContext', () => {
  let originalFetch;
  let storedValues;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    originalFetch = global.fetch;
    global.fetch = vi.fn();

    // Reset localStorage mock
    storedValues = {};
    localStorage.getItem.mockImplementation((key) => storedValues[key] || null);
    localStorage.setItem.mockImplementation((key, value) => {
      storedValues[key] = value;
    });
    localStorage.removeItem.mockImplementation((key) => {
      delete storedValues[key];
    });
    localStorage.clear.mockImplementation(() => {
      storedValues = {};
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // Helper to create mock fetch response
  const mockFetchResponse = (data, status = 200, contentType = 'application/json') => {
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name) => (name === 'content-type' ? contentType : null),
      },
      json: () => Promise.resolve(data),
    });
  };

  // Helper to setup auth config response
  const setupAuthConfigResponse = (config = {}) => {
    const defaultConfig = {
      auth_enabled: true,
      auth_mode: 'authenticated',
      oidc_enabled: false,
      oidc_provider_name: null,
      local_auth_enabled: true,
      api_key_enabled: false,
      features: {},
    };
    return mockFetchResponse({ ...defaultConfig, ...config });
  };

  // Wrapper for renderHook
  const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

  describe('useAuth hook', () => {
    it('should throw error when used outside AuthProvider', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => useAuth());
      }).toThrow('useAuth must be used within an AuthProvider');

      consoleError.mockRestore();
    });
  });

  describe('initial state', () => {
    it('should start with loading status', async () => {
      global.fetch.mockReturnValue(new Promise(() => {})); // Never resolves

      const { result } = renderHook(() => useAuth(), { wrapper });

      expect(result.current.status).toBe('loading');
      expect(result.current.isLoading).toBe(true);
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.isAnonymous).toBe(false);
    });

    it('should become anonymous when auth is disabled', async () => {
      global.fetch.mockReturnValue(setupAuthConfigResponse({ auth_enabled: false }));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('anonymous');
      });

      expect(result.current.isAnonymous).toBe(true);
      expect(result.current.isAuthenticated).toBe(false);
    });

    it('should become anonymous when no tokens are stored', async () => {
      global.fetch.mockReturnValue(setupAuthConfigResponse());

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('anonymous');
      });
    });

    it('should restore authenticated state from valid stored token', async () => {
      const validToken = createValidToken();
      const userData = {
        isSuperuser: false,
        id: 1,
        username: 'testuser',
        email: 'test@example.com',
        display_name: 'Test User',
        permissions: ['view_alerts'],
        roles: ['user'],
      };

      storedValues['skyspy_access_token'] = validToken;
      storedValues['skyspy_refresh_token'] = 'refresh-token';
      storedValues['skyspy_user'] = JSON.stringify(userData);

      global.fetch.mockReturnValue(setupAuthConfigResponse());

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('authenticated');
      });

      expect(result.current.user).toEqual(
        expect.objectContaining({
          username: 'testuser',
        })
      );
    });

    it('should fetch profile when token valid but no stored user', async () => {
      const validToken = createValidToken();
      const profileData = {
        id: 1,
        username: 'profileuser',
        email: 'profile@example.com',
        display_name: 'Profile User',
        permissions: [],
        roles: [],
      };

      storedValues['skyspy_access_token'] = validToken;
      storedValues['skyspy_refresh_token'] = 'refresh-token';

      global.fetch
        .mockReturnValueOnce(setupAuthConfigResponse())
        .mockReturnValueOnce(mockFetchResponse(profileData));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('authenticated');
      });

      expect(result.current.user.username).toBe('profileuser');
    });

    it('should attempt refresh when access token is expired', async () => {
      const expiredToken = createExpiredToken();
      const newValidToken = createValidToken();

      storedValues['skyspy_access_token'] = expiredToken;
      storedValues['skyspy_refresh_token'] = 'valid-refresh-token';

      const profileData = {
        id: 1,
        username: 'refresheduser',
        email: 'refreshed@example.com',
        permissions: [],
        roles: [],
      };

      global.fetch
        .mockReturnValueOnce(setupAuthConfigResponse())
        .mockReturnValueOnce(mockFetchResponse({ access: newValidToken, refresh: 'new-refresh' }))
        .mockReturnValueOnce(mockFetchResponse(profileData));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('authenticated');
      });
    });

    it('should become anonymous when refresh fails', async () => {
      const expiredToken = createExpiredToken();

      storedValues['skyspy_access_token'] = expiredToken;
      storedValues['skyspy_refresh_token'] = 'invalid-refresh-token';

      global.fetch
        .mockReturnValueOnce(setupAuthConfigResponse())
        .mockReturnValueOnce(mockFetchResponse({ error: 'Invalid refresh token' }, 401));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('anonymous');
      });
    });
  });

  describe('login', () => {
    it('should login successfully with valid credentials', async () => {
      const validToken = createValidToken();
      const loginResponse = {
        access: validToken,
        refresh: 'new-refresh-token',
        user: {
          id: 1,
          username: 'loginuser',
          email: 'login@example.com',
          permissions: ['view_alerts'],
          roles: ['user'],
        },
      };

      global.fetch
        .mockReturnValueOnce(setupAuthConfigResponse())
        .mockReturnValueOnce(mockFetchResponse(loginResponse));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('anonymous');
      });

      let loginResult;
      await act(async () => {
        loginResult = await result.current.login('loginuser', 'password123');
      });

      expect(loginResult.success).toBe(true);
      expect(result.current.status).toBe('authenticated');
      expect(result.current.user.username).toBe('loginuser');
      expect(storedValues['skyspy_access_token']).toBe(validToken);
    });

    it('should handle login failure', async () => {
      global.fetch
        .mockReturnValueOnce(setupAuthConfigResponse())
        .mockReturnValueOnce(mockFetchResponse({ error: 'Invalid credentials' }, 401));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('anonymous');
      });

      let loginResult;
      await act(async () => {
        loginResult = await result.current.login('wronguser', 'wrongpassword');
      });

      expect(loginResult.success).toBe(false);
      expect(loginResult.error).toBe('Invalid credentials');
      expect(result.current.status).toBe('anonymous');
      expect(result.current.error).toBe('Invalid credentials');
    });

    it('should clear previous error on new login attempt', async () => {
      global.fetch
        .mockReturnValueOnce(setupAuthConfigResponse())
        .mockReturnValueOnce(mockFetchResponse({ error: 'First error' }, 401))
        .mockReturnValueOnce(mockFetchResponse({ error: 'Second error' }, 401));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('anonymous');
      });

      await act(async () => {
        await result.current.login('user1', 'pass1');
      });

      expect(result.current.error).toBe('First error');

      await act(async () => {
        await result.current.login('user2', 'pass2');
      });

      expect(result.current.error).toBe('Second error');
    });
  });

  describe('logout', () => {
    it('should logout successfully', async () => {
      const validToken = createValidToken();
      const userData = { id: 1, username: 'testuser', isSuperuser: false };

      storedValues['skyspy_access_token'] = validToken;
      storedValues['skyspy_refresh_token'] = 'refresh-token';
      storedValues['skyspy_user'] = JSON.stringify(userData);

      global.fetch
        .mockReturnValueOnce(setupAuthConfigResponse())
        .mockReturnValueOnce(mockFetchResponse({})); // Logout response

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('authenticated');
      });

      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.status).toBe('anonymous');
      expect(result.current.user).toBeNull();
      expect(storedValues['skyspy_access_token']).toBeUndefined();
      expect(storedValues['skyspy_refresh_token']).toBeUndefined();
    });

    it('should clear tokens even if logout API fails', async () => {
      const validToken = createValidToken();
      const userData = { id: 1, username: 'testuser', isSuperuser: false };

      storedValues['skyspy_access_token'] = validToken;
      storedValues['skyspy_refresh_token'] = 'refresh-token';
      storedValues['skyspy_user'] = JSON.stringify(userData);

      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Create a rejected promise that we handle properly
      const networkError = Promise.reject(new Error('Network error'));
      // Catch the error to prevent unhandled rejection
      networkError.catch(() => {});

      global.fetch.mockReturnValueOnce(setupAuthConfigResponse()).mockReturnValueOnce(networkError);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('authenticated');
      });

      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.status).toBe('anonymous');
      expect(result.current.user).toBeNull();

      consoleError.mockRestore();
    });
  });

  describe('token refresh', () => {
    it('should refresh token successfully', async () => {
      const validToken = createValidToken();
      const newToken = createValidToken(7200);

      storedValues['skyspy_access_token'] = validToken;
      storedValues['skyspy_refresh_token'] = 'refresh-token';
      storedValues['skyspy_user'] = JSON.stringify({
        id: 1,
        username: 'testuser',
        isSuperuser: false,
      });

      global.fetch
        .mockReturnValueOnce(setupAuthConfigResponse())
        .mockReturnValueOnce(mockFetchResponse({ access: newToken, refresh: 'new-refresh' }));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('authenticated');
      });

      let refreshResult;
      await act(async () => {
        refreshResult = await result.current.refreshAccessToken();
      });

      expect(refreshResult).toBe(true);
      expect(storedValues['skyspy_access_token']).toBe(newToken);
    });

    it('should return false when no refresh token', async () => {
      global.fetch.mockReturnValue(setupAuthConfigResponse());

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('anonymous');
      });

      let refreshResult;
      await act(async () => {
        refreshResult = await result.current.refreshAccessToken();
      });

      expect(refreshResult).toBe(false);
    });

    it('should prevent concurrent refresh calls', async () => {
      const validToken = createValidToken();

      storedValues['skyspy_access_token'] = validToken;
      storedValues['skyspy_refresh_token'] = 'refresh-token';
      storedValues['skyspy_user'] = JSON.stringify({
        id: 1,
        username: 'testuser',
        isSuperuser: false,
      });

      let resolveRefresh;
      const refreshPromise = new Promise((resolve) => {
        resolveRefresh = resolve;
      });

      global.fetch
        .mockReturnValueOnce(setupAuthConfigResponse())
        .mockReturnValueOnce(refreshPromise);

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('authenticated');
      });

      // Start two concurrent refreshes
      let refresh1, refresh2;
      act(() => {
        refresh1 = result.current.refreshAccessToken();
        refresh2 = result.current.refreshAccessToken();
      });

      // Resolve the refresh
      resolveRefresh({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ access: createValidToken(), refresh: 'new-refresh' }),
      });

      const [result1, result2] = await Promise.all([refresh1, refresh2]);

      // Both should return the same result (from the same refresh operation)
      expect(result1).toBe(result2);
      // Only one fetch call should have been made for refresh
      expect(global.fetch).toHaveBeenCalledTimes(2); // 1 for config, 1 for refresh
    });
  });

  describe('authFetch', () => {
    it('should include Authorization header with token', async () => {
      const validToken = createValidToken();

      storedValues['skyspy_access_token'] = validToken;
      storedValues['skyspy_refresh_token'] = 'refresh-token';
      storedValues['skyspy_user'] = JSON.stringify({
        id: 1,
        username: 'testuser',
        isSuperuser: false,
      });

      global.fetch
        .mockReturnValueOnce(setupAuthConfigResponse())
        .mockReturnValueOnce(mockFetchResponse({ data: 'test' }));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('authenticated');
      });

      await act(async () => {
        await result.current.authFetch('/api/test');
      });

      expect(global.fetch).toHaveBeenLastCalledWith(
        '/api/test',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${validToken}`,
          }),
        })
      );
    });

    it('should refresh token on 401 and retry', async () => {
      const validToken = createValidToken();
      const newToken = createValidToken(7200);

      storedValues['skyspy_access_token'] = validToken;
      storedValues['skyspy_refresh_token'] = 'refresh-token';
      storedValues['skyspy_user'] = JSON.stringify({
        id: 1,
        username: 'testuser',
        isSuperuser: false,
      });

      global.fetch
        .mockReturnValueOnce(setupAuthConfigResponse())
        .mockReturnValueOnce(mockFetchResponse({}, 401)) // First request returns 401
        .mockReturnValueOnce(mockFetchResponse({ access: newToken, refresh: 'new-refresh' })) // Refresh succeeds
        .mockReturnValueOnce(mockFetchResponse({ data: 'success' })); // Retry succeeds

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('authenticated');
      });

      let response;
      await act(async () => {
        response = await result.current.authFetch('/api/protected');
      });

      expect(response.status).toBe(200);
    });
  });

  describe('permissions', () => {
    it('should return true for hasPermission when auth is disabled', async () => {
      global.fetch.mockReturnValue(setupAuthConfigResponse({ auth_enabled: false }));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('anonymous');
      });

      expect(result.current.hasPermission('any_permission')).toBe(true);
    });

    it('should return true for hasPermission when in public mode', async () => {
      global.fetch.mockReturnValue(setupAuthConfigResponse({ auth_mode: 'public' }));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('anonymous');
      });

      expect(result.current.hasPermission('any_permission')).toBe(true);
    });

    it('should return false for hasPermission when no user', async () => {
      global.fetch.mockReturnValue(setupAuthConfigResponse());

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('anonymous');
      });

      expect(result.current.hasPermission('view_alerts')).toBe(false);
    });

    it('should check user permissions correctly', async () => {
      const validToken = createValidToken();
      const userData = {
        isSuperuser: false,
        id: 1,
        username: 'testuser',
        permissions: ['view_alerts', 'edit_alerts'],
        roles: ['user'],
      };

      storedValues['skyspy_access_token'] = validToken;
      storedValues['skyspy_refresh_token'] = 'refresh-token';
      storedValues['skyspy_user'] = JSON.stringify(userData);

      global.fetch.mockReturnValue(setupAuthConfigResponse());

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('authenticated');
      });

      expect(result.current.hasPermission('view_alerts')).toBe(true);
      expect(result.current.hasPermission('edit_alerts')).toBe(true);
      expect(result.current.hasPermission('admin')).toBe(false);
    });

    it('should check hasAnyPermission correctly', async () => {
      const validToken = createValidToken();
      const userData = {
        isSuperuser: false,
        id: 1,
        username: 'testuser',
        permissions: ['view_alerts'],
        roles: ['user'],
      };

      storedValues['skyspy_access_token'] = validToken;
      storedValues['skyspy_refresh_token'] = 'refresh-token';
      storedValues['skyspy_user'] = JSON.stringify(userData);

      global.fetch.mockReturnValue(setupAuthConfigResponse());

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('authenticated');
      });

      expect(result.current.hasAnyPermission(['view_alerts', 'admin'])).toBe(true);
      expect(result.current.hasAnyPermission(['admin', 'superuser'])).toBe(false);
    });

    it('should check hasAllPermissions correctly', async () => {
      const validToken = createValidToken();
      const userData = {
        isSuperuser: false,
        id: 1,
        username: 'testuser',
        permissions: ['view_alerts', 'edit_alerts'],
        roles: ['user'],
      };

      storedValues['skyspy_access_token'] = validToken;
      storedValues['skyspy_refresh_token'] = 'refresh-token';
      storedValues['skyspy_user'] = JSON.stringify(userData);

      global.fetch.mockReturnValue(setupAuthConfigResponse());

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('authenticated');
      });

      expect(result.current.hasAllPermissions(['view_alerts', 'edit_alerts'])).toBe(true);
      expect(result.current.hasAllPermissions(['view_alerts', 'admin'])).toBe(false);
    });
  });

  describe('canAccessFeature', () => {
    it('should return true when auth is disabled', async () => {
      global.fetch.mockReturnValue(setupAuthConfigResponse({ auth_enabled: false }));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('anonymous');
      });

      expect(result.current.canAccessFeature('alerts')).toBe(true);
      expect(result.current.canAccessFeature('alerts', 'write')).toBe(true);
    });

    it('should check feature access based on config', async () => {
      const validToken = createValidToken();
      const userData = {
        id: 1,
        username: 'testuser',
        isSuperuser: false,
        permissions: [],
        roles: [],
      };

      storedValues['skyspy_access_token'] = validToken;
      storedValues['skyspy_refresh_token'] = 'refresh-token';
      storedValues['skyspy_user'] = JSON.stringify(userData);

      global.fetch.mockReturnValue(
        setupAuthConfigResponse({
          features: {
            alerts: {
              is_enabled: true,
              read_access: 'public',
              write_access: 'authenticated',
            },
          },
        })
      );

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('authenticated');
      });

      expect(result.current.canAccessFeature('alerts', 'read')).toBe(true);
      expect(result.current.canAccessFeature('alerts', 'write')).toBe(true);
    });

    it('should deny access when feature is disabled', async () => {
      const validToken = createValidToken();
      const userData = {
        id: 1,
        username: 'testuser',
        isSuperuser: false,
        permissions: [],
        roles: [],
      };

      storedValues['skyspy_access_token'] = validToken;
      storedValues['skyspy_refresh_token'] = 'refresh-token';
      storedValues['skyspy_user'] = JSON.stringify(userData);

      global.fetch.mockReturnValue(
        setupAuthConfigResponse({
          features: {
            disabled_feature: {
              is_enabled: false,
              read_access: 'public',
              write_access: 'public',
            },
          },
        })
      );

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('authenticated');
      });

      expect(result.current.canAccessFeature('disabled_feature')).toBe(false);
    });
  });

  describe('getAccessToken', () => {
    it('should return valid access token', async () => {
      const validToken = createValidToken();

      storedValues['skyspy_access_token'] = validToken;
      storedValues['skyspy_refresh_token'] = 'refresh-token';
      storedValues['skyspy_user'] = JSON.stringify({
        id: 1,
        username: 'testuser',
        isSuperuser: false,
      });

      global.fetch.mockReturnValue(setupAuthConfigResponse());

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('authenticated');
      });

      expect(result.current.getAccessToken()).toBe(validToken);
    });

    it('should return null for expired token', async () => {
      const expiredToken = createExpiredToken();

      storedValues['skyspy_access_token'] = expiredToken;
      storedValues['skyspy_refresh_token'] = 'refresh-token';

      global.fetch
        .mockReturnValueOnce(setupAuthConfigResponse())
        .mockReturnValueOnce(mockFetchResponse({ error: 'Refresh failed' }, 401));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('anonymous');
      });

      expect(result.current.getAccessToken()).toBeNull();
    });

    it('should return null when no token stored', async () => {
      global.fetch.mockReturnValue(setupAuthConfigResponse());

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('anonymous');
      });

      expect(result.current.getAccessToken()).toBeNull();
    });
  });

  describe('clearError', () => {
    it('should clear error state', async () => {
      global.fetch
        .mockReturnValueOnce(setupAuthConfigResponse())
        .mockReturnValueOnce(mockFetchResponse({ error: 'Login failed' }, 401));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('anonymous');
      });

      await act(async () => {
        await result.current.login('user', 'pass');
      });

      expect(result.current.error).toBe('Login failed');

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe('auth config', () => {
    it('should set config from server response', async () => {
      global.fetch.mockReturnValue(
        setupAuthConfigResponse({
          auth_enabled: true,
          oidc_enabled: true,
          oidc_provider_name: 'Google',
          local_auth_enabled: true,
          api_key_enabled: true,
          features: { alerts: { is_enabled: true } },
        })
      );

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('anonymous');
      });

      expect(result.current.config.authEnabled).toBe(true);
      expect(result.current.config.oidcEnabled).toBe(true);
      expect(result.current.config.oidcProviderName).toBe('Google');
      expect(result.current.config.localAuthEnabled).toBe(true);
      expect(result.current.config.apiKeyEnabled).toBe(true);
      expect(result.current.config.features.alerts).toBeDefined();
    });

    it('should use default config when fetch fails', async () => {
      global.fetch.mockReturnValue(Promise.reject(new Error('Network error')));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('anonymous');
      });

      expect(result.current.config.authEnabled).toBe(false);
      expect(result.current.config.publicMode).toBe(true);
    });

    it('should use default config for non-JSON response', async () => {
      global.fetch.mockReturnValue(
        Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => 'text/html' },
        })
      );

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('anonymous');
      });

      expect(result.current.config.authEnabled).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should clear refresh timeout on unmount', async () => {
      const validToken = createValidToken(60); // Token expiring soon

      storedValues['skyspy_access_token'] = validToken;
      storedValues['skyspy_refresh_token'] = 'refresh-token';
      storedValues['skyspy_user'] = JSON.stringify({
        id: 1,
        username: 'testuser',
        isSuperuser: false,
      });

      global.fetch.mockReturnValue(setupAuthConfigResponse());

      const { result, unmount } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('authenticated');
      });

      // Unmount should clear any scheduled refresh
      unmount();

      // No errors should occur after unmount
      vi.advanceTimersByTime(60000);
    });
  });
});
