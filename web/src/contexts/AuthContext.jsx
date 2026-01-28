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

// Helper to safely parse JSON from fetch response
const safeJson = async (res) => {
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) return null;
  try { return await res.json(); } catch { return null; }
};

const AuthContext = createContext(null);

// Token storage keys
const ACCESS_TOKEN_KEY = 'skyspy_access_token';
const REFRESH_TOKEN_KEY = 'skyspy_refresh_token';
const USER_KEY = 'skyspy_user';

/**
 * Get stored tokens from localStorage
 */
function getStoredTokens() {
  return {
    accessToken: localStorage.getItem(ACCESS_TOKEN_KEY),
    refreshToken: localStorage.getItem(REFRESH_TOKEN_KEY),
  };
}

/**
 * Store tokens in localStorage
 */
function storeTokens(accessToken, refreshToken) {
  if (accessToken) {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  }
  if (refreshToken) {
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  }
}

/**
 * Clear stored tokens
 */
function clearTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/**
 * Get stored user from localStorage
 */
function getStoredUser() {
  try {
    const userJson = localStorage.getItem(USER_KEY);
    return userJson ? JSON.parse(userJson) : null;
  } catch {
    return null;
  }
}

/**
 * Store user in localStorage
 */
function storeUser(user) {
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
}

/**
 * Parse JWT token to get expiration
 */
function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

/**
 * Check if token is expired or about to expire (within 30 seconds)
 */
function isTokenExpired(token, bufferSeconds = 30) {
  if (!token) return true;
  const payload = parseJwt(token);
  if (!payload || !payload.exp) return true;
  const expiresAt = payload.exp * 1000;
  return Date.now() >= expiresAt - bufferSeconds * 1000;
}

export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading'); // 'loading' | 'anonymous' | 'authenticated'
  const [user, setUser] = useState(null);
  const [config, setConfig] = useState({
    authEnabled: true,
    publicMode: false,
    oidcEnabled: false,
    localAuthEnabled: true,
    features: {},
  });
  const [error, setError] = useState(null);

  const refreshTimeoutRef = useRef(null);
  const refreshInProgressRef = useRef(false); // Prevent race conditions
  const refreshPromiseRef = useRef(null); // Share refresh promise across concurrent calls
  const oidcPopupRef = useRef(null); // Track OIDC popup window
  const oidcCleanupRef = useRef(null); // Store OIDC cleanup function for unmount
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

    // If unauthorized and we have a refresh token, try to refresh
    if (response.status === 401) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        // Retry with new token
        const newTokens = getStoredTokens();
        headers['Authorization'] = `Bearer ${newTokens.accessToken}`;
        return fetch(url, { ...options, headers });
      }
    }

    return response;
  }, []);

  /**
   * Refresh the access token (with race condition protection)
   */
  const refreshAccessToken = useCallback(async () => {
    const { refreshToken } = getStoredTokens();
    if (!refreshToken) {
      return false;
    }

    // If refresh is already in progress, wait for the existing promise
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
          // Refresh failed - clear tokens and set anonymous
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
  }, [apiBaseUrl]);

  /**
   * Schedule token refresh before expiration
   */
  const scheduleTokenRefresh = useCallback((token) => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }

    const payload = parseJwt(token);
    if (!payload || !payload.exp) return;

    // Refresh 30 seconds before expiration
    const expiresAt = payload.exp * 1000;
    const refreshIn = expiresAt - Date.now() - 30000;

    if (refreshIn > 0) {
      refreshTimeoutRef.current = setTimeout(() => {
        refreshAccessToken();
      }, refreshIn);
    }
  }, [refreshAccessToken]);

  /**
   * Fetch auth configuration from server
   */
  const fetchAuthConfig = useCallback(async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/auth/config`);
      if (!response.ok) {
        throw new Error('Failed to fetch auth config');
      }
      // Check content type to avoid parsing HTML as JSON
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
      // Auth endpoint unavailable - default to public mode (no auth required)
      setConfig({
        authEnabled: false,
        publicMode: true,
        oidcEnabled: false,
        localAuthEnabled: false,
        features: {},
      });
      return { auth_enabled: false };
    }
  }, [apiBaseUrl]);

  /**
   * Fetch current user profile
   */
  const fetchProfile = useCallback(async () => {
    try {
      const response = await authFetch(`${apiBaseUrl}/api/v1/auth/profile`);
      if (!response.ok) {
        throw new Error('Failed to fetch profile');
      }
      const data = await safeJson(response);
      if (!data) throw new Error('Invalid response');
      const userData = {
        id: data.id,
        username: data.username,
        email: data.email,
        displayName: data.display_name,
        permissions: data.permissions || [],
        roles: data.roles || [],
      };
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
      if (!response.ok) {
        throw new Error(data?.error || 'Login failed');
      }
      if (!data) throw new Error('Invalid response');

      storeTokens(data.access, data.refresh);

      const userData = {
        id: data.user.id,
        username: data.user.username,
        email: data.user.email,
        displayName: data.user.display_name,
        permissions: data.user.permissions || [],
        roles: data.user.roles || [],
      };
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

    // Clear local state regardless of server response
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

      // Open popup for OIDC flow
      const popup = window.open(
        data.authorization_url,
        'oidc_login',
        'width=500,height=600,menubar=no,toolbar=no'
      );

      // Store popup reference for unmount cleanup
      oidcPopupRef.current = popup;

      // Listen for message from popup
      return new Promise((resolve, reject) => {
        let timeoutId = null;
        let popupCheckInterval = null;
        let isCleanedUp = false;

        const cleanup = () => {
          // Prevent double cleanup
          if (isCleanedUp) return;
          isCleanedUp = true;

          window.removeEventListener('message', handleMessage);
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          if (popupCheckInterval) {
            clearInterval(popupCheckInterval);
            popupCheckInterval = null;
          }
          // Clear refs
          oidcCleanupRef.current = null;
          oidcPopupRef.current = null;
        };

        // Store cleanup function in ref for component unmount
        oidcCleanupRef.current = cleanup;

        const handleMessage = (event) => {
          // Ignore messages after cleanup
          if (isCleanedUp) return;

          if (event.data && event.data.type === 'oidc_callback') {
            cleanup();

            if (event.data.access) {
              storeTokens(event.data.access, event.data.refresh);

              const userData = {
                id: event.data.user.id,
                username: event.data.user.username,
                email: event.data.user.email,
                displayName: event.data.user.display_name,
                permissions: event.data.user.permissions || [],
                roles: event.data.user.roles || [],
              };
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

        // Check if popup is closed by user
        popupCheckInterval = setInterval(() => {
          // Stop checking after cleanup
          if (isCleanedUp) return;

          if (popup && popup.closed) {
            cleanup();
            reject(new Error('OIDC login cancelled'));
          }
        }, 500);

        // Timeout after 5 minutes
        timeoutId = setTimeout(() => {
          // Ignore timeout after cleanup
          if (isCleanedUp) return;

          cleanup();
          if (popup && !popup.closed) {
            popup.close();
          }
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
    if (!config.authEnabled || config.publicMode) {
      return true;
    }
    if (!user) {
      return false;
    }
    return user.permissions.includes(permission);
  }, [config.authEnabled, config.publicMode, user]);

  /**
   * Check if user has any of the specified permissions
   */
  const hasAnyPermission = useCallback((permissions) => {
    if (!config.authEnabled || config.publicMode) {
      return true;
    }
    if (!user) {
      return false;
    }
    return permissions.some(p => user.permissions.includes(p));
  }, [config.authEnabled, config.publicMode, user]);

  /**
   * Check if user has all specified permissions
   */
  const hasAllPermissions = useCallback((permissions) => {
    if (!config.authEnabled || config.publicMode) {
      return true;
    }
    if (!user) {
      return false;
    }
    return permissions.every(p => user.permissions.includes(p));
  }, [config.authEnabled, config.publicMode, user]);

  /**
   * Check if a feature is accessible
   */
  const canAccessFeature = useCallback((feature, action = 'read') => {
    if (!config.authEnabled || config.publicMode) {
      return true;
    }

    const featureConfig = config.features[feature];
    if (!featureConfig) {
      // Unknown feature - require authentication
      return status === 'authenticated';
    }

    if (!featureConfig.is_enabled) {
      return false;
    }

    const accessLevel = action === 'write' ? featureConfig.write_access : featureConfig.read_access;

    if (accessLevel === 'public') {
      return true;
    }

    if (accessLevel === 'authenticated') {
      return status === 'authenticated';
    }

    // Permission required
    const permissionSuffix = action === 'write' ? 'edit' : 'view';
    return hasPermission(`${feature}.${permissionSuffix}`);
  }, [config, status, hasPermission]);

  /**
   * Get access token for WebSocket connections
   */
  const getAccessToken = useCallback(() => {
    const { accessToken } = getStoredTokens();

    // Check if token is expired and try to use cached user
    if (accessToken && !isTokenExpired(accessToken)) {
      return accessToken;
    }

    return null;
  }, []);

  // Initialize auth state on mount
  useEffect(() => {
    const initAuth = async () => {
      // Fetch auth config first
      const authConfig = await fetchAuthConfig();

      if (authConfig && !authConfig.auth_enabled) {
        // Auth disabled - set anonymous and done
        setStatus('anonymous');
        return;
      }

      // Check for existing tokens
      const { accessToken, refreshToken } = getStoredTokens();

      if (!accessToken && !refreshToken) {
        // No tokens - anonymous
        setStatus('anonymous');
        return;
      }

      // Try to use existing access token
      if (accessToken && !isTokenExpired(accessToken)) {
        // Token valid - fetch profile
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

      // Access token expired - try refresh
      if (refreshToken) {
        const refreshed = await refreshAccessToken();
        if (refreshed) {
          const profile = await fetchProfile();
          if (profile) {
            setStatus('authenticated');
          } else {
            setStatus('anonymous');
          }
        } else {
          setStatus('anonymous');
        }
        return;
      }

      // No valid tokens
      setStatus('anonymous');
    };

    initAuth();

    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      // Cleanup OIDC flow if in progress
      if (oidcCleanupRef.current) {
        oidcCleanupRef.current();
      }
      // Close OIDC popup if still open
      if (oidcPopupRef.current && !oidcPopupRef.current.closed) {
        oidcPopupRef.current.close();
      }
    };
  }, [fetchAuthConfig, fetchProfile, refreshAccessToken, scheduleTokenRefresh]);

  // Memoize clearError to prevent creating new function on each render
  const clearError = useCallback(() => setError(null), []);

  // Memoize the context value to prevent unnecessary re-renders
  const value = useMemo(() => ({
    // State
    status,
    user,
    config,
    error,
    isLoading: status === 'loading',
    isAuthenticated: status === 'authenticated',
    isAnonymous: status === 'anonymous',

    // Actions
    login,
    logout,
    loginWithOIDC,
    refreshAccessToken,

    // Helpers
    authFetch,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    canAccessFeature,
    getAccessToken,

    // Clear error
    clearError,
  }), [
    status,
    user,
    config,
    error,
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
