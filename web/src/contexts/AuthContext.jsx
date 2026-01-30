/**
 * Authentication Context for SkySpy
 *
 * Provides:
 * - Authentication state management
 * - Login/logout functionality
 * - Token refresh
 * - Permission checking
 * - OIDC integration
 */
import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getConfig } from '../utils/config';
import {
  getStoredTokens,
  storeTokens,
  clearTokens,
  getStoredUser,
  storeUser,
} from './auth/tokenStorage';
import { parseJwt, isTokenExpired } from './auth/jwtUtils';
import { safeJson, createUserData, createDefaultConfig } from './auth/apiHelpers';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading'); // 'loading' | 'anonymous' | 'authenticated'
  const [user, setUser] = useState(null);
  const [config, setConfig] = useState(createDefaultConfig(true));
  const [error, setError] = useState(null);

  const refreshTimeoutRef = useRef(null);
  const refreshInProgressRef = useRef(false);
  const refreshPromiseRef = useRef(null);
  const oidcPopupRef = useRef(null);
  const oidcCleanupRef = useRef(null);
  const apiBaseUrl = getConfig().apiBaseUrl;

  /**
   * Make authenticated API request
   */
  const authFetch = useCallback(async (url, options = {}) => {
    const { accessToken } = getStoredTokens();

    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        const newTokens = getStoredTokens();
        headers['Authorization'] = `Bearer ${newTokens.accessToken}`;
        return fetch(url, { ...options, headers });
      }
    }

    return response;
  }, []);

  /**
   * Schedule token refresh before expiration
   */
  const scheduleTokenRefresh = useCallback((token) => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }

    const payload = parseJwt(token);
    if (!payload || !payload.exp) return;

    const expiresAt = payload.exp * 1000;
    const refreshIn = expiresAt - Date.now() - 30000;

    if (refreshIn > 0) {
      refreshTimeoutRef.current = setTimeout(() => {
        refreshAccessToken();
      }, refreshIn);
    }
  }, []);

  /**
   * Refresh the access token (with race condition protection)
   */
  const refreshAccessToken = useCallback(async () => {
    const { refreshToken } = getStoredTokens();
    if (!refreshToken) return false;

    if (refreshInProgressRef.current && refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    refreshInProgressRef.current = true;

    const doRefresh = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh: refreshToken }),
        });

        if (!response.ok) {
          clearTokens();
          setUser(null);
          setStatus('anonymous');
          return false;
        }

        const data = await safeJson(response);
        if (!data) {
          clearTokens();
          setUser(null);
          setStatus('anonymous');
          return false;
        }
        storeTokens(data.access, data.refresh);
        scheduleTokenRefresh(data.access);
        return true;
      } catch (err) {
        console.error('Token refresh failed:', err);
        return false;
      } finally {
        refreshInProgressRef.current = false;
        refreshPromiseRef.current = null;
      }
    };

    refreshPromiseRef.current = doRefresh();
    return refreshPromiseRef.current;
  }, [apiBaseUrl, scheduleTokenRefresh]);

  /**
   * Fetch auth configuration from server
   */
  const fetchAuthConfig = useCallback(async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/auth/config`);
      if (!response.ok) throw new Error('Failed to fetch auth config');

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Auth config endpoint returned non-JSON response');
      }

      const data = await response.json();
      setConfig({
        authEnabled: data.auth_enabled,
        publicMode: data.auth_mode === 'public',
        oidcEnabled: data.oidc_enabled,
        oidcProviderName: data.oidc_provider_name,
        localAuthEnabled: data.local_auth_enabled,
        apiKeyEnabled: data.api_key_enabled,
        features: data.features || {},
      });
      return data;
    } catch {
      setConfig(createDefaultConfig(false));
      return { auth_enabled: false };
    }
  }, [apiBaseUrl]);

  /**
   * Fetch current user profile
   */
  const fetchProfile = useCallback(async () => {
    try {
      const response = await authFetch(`${apiBaseUrl}/api/v1/auth/profile`);
      if (!response.ok) throw new Error('Failed to fetch profile');

      const data = await safeJson(response);
      if (!data) throw new Error('Invalid response');

      const userData = createUserData(data);
      setUser(userData);
      storeUser(userData);
      return userData;
    } catch (err) {
      console.error('Failed to fetch profile:', err);
      return null;
    }
  }, [apiBaseUrl, authFetch]);

  /**
   * Login with username and password
   */
  const login = useCallback(async (username, password) => {
    setError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await safeJson(response);
      if (!response.ok) throw new Error(data?.error || 'Login failed');
      if (!data) throw new Error('Invalid response');

      storeTokens(data.access, data.refresh);
      const userData = createUserData(data.user);
      setUser(userData);
      storeUser(userData);
      setStatus('authenticated');
      scheduleTokenRefresh(data.access);

      return { success: true };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    }
  }, [apiBaseUrl, scheduleTokenRefresh]);

  /**
   * Logout
   */
  const logout = useCallback(async () => {
    try {
      const { refreshToken } = getStoredTokens();
      await authFetch(`${apiBaseUrl}/api/v1/auth/logout`, {
        method: 'POST',
        body: JSON.stringify({ refresh: refreshToken }),
      });
    } catch (err) {
      console.error('Logout request failed:', err);
    }

    clearTokens();
    setUser(null);
    setStatus('anonymous');

    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }
  }, [apiBaseUrl, authFetch]);

  /**
   * Start OIDC login flow
   */
  const loginWithOIDC = useCallback(async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/auth/oidc/authorize`);
      const data = await safeJson(response);
      if (!response.ok || !data) {
        throw new Error('Failed to get OIDC authorization URL');
      }

      const popup = window.open(
        data.authorization_url,
        'oidc_login',
        'width=500,height=600,menubar=no,toolbar=no'
      );

      oidcPopupRef.current = popup;

      return new Promise((resolve, reject) => {
        let timeoutId = null;
        let popupCheckInterval = null;
        let isCleanedUp = false;

        const cleanup = () => {
          if (isCleanedUp) return;
          isCleanedUp = true;
          window.removeEventListener('message', handleMessage);
          if (timeoutId) clearTimeout(timeoutId);
          if (popupCheckInterval) clearInterval(popupCheckInterval);
          oidcCleanupRef.current = null;
          oidcPopupRef.current = null;
        };

        oidcCleanupRef.current = cleanup;

        const handleMessage = (event) => {
          if (isCleanedUp) return;
          if (event.data && event.data.type === 'oidc_callback') {
            cleanup();
            if (event.data.access) {
              storeTokens(event.data.access, event.data.refresh);
              const userData = createUserData(event.data.user);
              setUser(userData);
              storeUser(userData);
              setStatus('authenticated');
              scheduleTokenRefresh(event.data.access);
              resolve({ success: true });
            } else {
              reject(new Error('OIDC authentication failed'));
            }
          }
        };

        window.addEventListener('message', handleMessage);

        popupCheckInterval = setInterval(() => {
          if (isCleanedUp) return;
          if (popup && popup.closed) {
            cleanup();
            reject(new Error('OIDC login cancelled'));
          }
        }, 500);

        timeoutId = setTimeout(() => {
          if (isCleanedUp) return;
          cleanup();
          if (popup && !popup.closed) popup.close();
          reject(new Error('OIDC login timed out'));
        }, 300000);
      });
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    }
  }, [apiBaseUrl, scheduleTokenRefresh]);

  /**
   * Check if user has a specific permission
   */
  const hasPermission = useCallback((permission) => {
    if (!config.authEnabled || config.publicMode) return true;
    if (!user) return false;
    return user.permissions.includes(permission);
  }, [config.authEnabled, config.publicMode, user]);

  /**
   * Check if user has any of the specified permissions
   */
  const hasAnyPermission = useCallback((permissions) => {
    if (!config.authEnabled || config.publicMode) return true;
    if (!user) return false;
    return permissions.some(p => user.permissions.includes(p));
  }, [config.authEnabled, config.publicMode, user]);

  /**
   * Check if user has all specified permissions
   */
  const hasAllPermissions = useCallback((permissions) => {
    if (!config.authEnabled || config.publicMode) return true;
    if (!user) return false;
    return permissions.every(p => user.permissions.includes(p));
  }, [config.authEnabled, config.publicMode, user]);

  /**
   * Check if a feature is accessible
   */
  const canAccessFeature = useCallback((feature, action = 'read') => {
    if (!config.authEnabled || config.publicMode) return true;

    const featureConfig = config.features[feature];
    if (!featureConfig) return status === 'authenticated';
    if (!featureConfig.is_enabled) return false;

    const accessLevel = action === 'write' ? featureConfig.write_access : featureConfig.read_access;
    if (accessLevel === 'public') return true;
    if (accessLevel === 'authenticated') return status === 'authenticated';

    const permissionSuffix = action === 'write' ? 'edit' : 'view';
    return hasPermission(`${feature}.${permissionSuffix}`);
  }, [config, status, hasPermission]);

  /**
   * Get access token for WebSocket connections
   */
  const getAccessToken = useCallback(() => {
    const { accessToken } = getStoredTokens();
    if (accessToken && !isTokenExpired(accessToken)) return accessToken;
    return null;
  }, []);

  // Initialize auth state on mount
  useEffect(() => {
    const initAuth = async () => {
      const authConfig = await fetchAuthConfig();

      if (authConfig && !authConfig.auth_enabled) {
        setStatus('anonymous');
        return;
      }

      const { accessToken, refreshToken } = getStoredTokens();

      if (!accessToken && !refreshToken) {
        setStatus('anonymous');
        return;
      }

      if (accessToken && !isTokenExpired(accessToken)) {
        const storedUser = getStoredUser();
        if (storedUser) {
          setUser(storedUser);
          setStatus('authenticated');
          scheduleTokenRefresh(accessToken);
        } else {
          const profile = await fetchProfile();
          if (profile) {
            setStatus('authenticated');
            scheduleTokenRefresh(accessToken);
          } else {
            setStatus('anonymous');
          }
        }
        return;
      }

      if (refreshToken) {
        const refreshed = await refreshAccessToken();
        if (refreshed) {
          const profile = await fetchProfile();
          setStatus(profile ? 'authenticated' : 'anonymous');
        } else {
          setStatus('anonymous');
        }
        return;
      }

      setStatus('anonymous');
    };

    initAuth();

    return () => {
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
      if (oidcCleanupRef.current) oidcCleanupRef.current();
      if (oidcPopupRef.current && !oidcPopupRef.current.closed) oidcPopupRef.current.close();
    };
  }, [fetchAuthConfig, fetchProfile, refreshAccessToken, scheduleTokenRefresh]);

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo(() => ({
    status,
    user,
    config,
    error,
    isLoading: status === 'loading',
    isAuthenticated: status === 'authenticated',
    isAnonymous: status === 'anonymous',
    login,
    logout,
    loginWithOIDC,
    refreshAccessToken,
    authFetch,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    canAccessFeature,
    getAccessToken,
    clearError,
  }), [
    status, user, config, error, login, logout, loginWithOIDC,
    refreshAccessToken, authFetch, hasPermission, hasAnyPermission,
    hasAllPermissions, canAccessFeature, getAccessToken, clearError,
  ]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Hook to use auth context
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;
