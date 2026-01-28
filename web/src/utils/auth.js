/**
 * Authentication Utilities
 *
 * Helper functions for token management and authentication.
 */

// Token storage keys
export const ACCESS_TOKEN_KEY = 'skyspy_access_token';
export const REFRESH_TOKEN_KEY = 'skyspy_refresh_token';
export const USER_KEY = 'skyspy_user';

/**
 * Get stored access token
 */
export function getAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

/**
 * Get stored refresh token
 */
export function getRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

/**
 * Store tokens in localStorage
 */
export function storeTokens(accessToken, refreshToken) {
  if (accessToken) {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  }
  if (refreshToken) {
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  }
}

/**
 * Clear all auth data from localStorage
 */
export function clearAuthData() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/**
 * Get stored user data
 */
export function getStoredUser() {
  try {
    const userJson = localStorage.getItem(USER_KEY);
    return userJson ? JSON.parse(userJson) : null;
  } catch {
    return null;
  }
}

/**
 * Store user data
 */
export function storeUser(user) {
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
}

/**
 * Parse JWT token payload
 */
export function parseJwt(token) {
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
 * Check if token is expired or about to expire
 */
export function isTokenExpired(token, bufferSeconds = 30) {
  if (!token) return true;
  const payload = parseJwt(token);
  if (!payload || !payload.exp) return true;
  const expiresAt = payload.exp * 1000;
  return Date.now() >= expiresAt - bufferSeconds * 1000;
}

/**
 * Get token expiration time in milliseconds
 */
export function getTokenExpiration(token) {
  if (!token) return 0;
  const payload = parseJwt(token);
  if (!payload || !payload.exp) return 0;
  return payload.exp * 1000;
}

/**
 * Create authorization header value
 */
export function getAuthHeader() {
  const token = getAccessToken();
  return token ? `Bearer ${token}` : null;
}

/**
 * Build WebSocket URL with authentication token
 */
export function buildAuthenticatedWsUrl(baseUrl, token = null) {
  const authToken = token || getAccessToken();
  if (!authToken) {
    return baseUrl;
  }

  // Add token as query parameter
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}token=${encodeURIComponent(authToken)}`;
}

/**
 * Make authenticated fetch request
 */
export async function authFetch(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const token = getAccessToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return fetch(url, {
    ...options,
    headers,
  });
}

/**
 * Permission check helper
 */
export function hasPermission(permissions, permission) {
  if (!permissions || !Array.isArray(permissions)) {
    return false;
  }
  return permissions.includes(permission);
}

/**
 * Check if user has any of the specified permissions
 */
export function hasAnyPermission(permissions, requiredPermissions) {
  if (!permissions || !Array.isArray(permissions)) {
    return false;
  }
  return requiredPermissions.some(p => permissions.includes(p));
}

/**
 * Check if user has all specified permissions
 */
export function hasAllPermissions(permissions, requiredPermissions) {
  if (!permissions || !Array.isArray(permissions)) {
    return false;
  }
  return requiredPermissions.every(p => permissions.includes(p));
}

/**
 * Feature permission mapping
 */
export const FEATURE_PERMISSIONS = {
  aircraft: {
    view: 'aircraft.view',
    viewMilitary: 'aircraft.view_military',
    viewDetails: 'aircraft.view_details',
  },
  alerts: {
    view: 'alerts.view',
    create: 'alerts.create',
    edit: 'alerts.edit',
    delete: 'alerts.delete',
    manageAll: 'alerts.manage_all',
  },
  safety: {
    view: 'safety.view',
    acknowledge: 'safety.acknowledge',
    manage: 'safety.manage',
  },
  audio: {
    view: 'audio.view',
    upload: 'audio.upload',
    transcribe: 'audio.transcribe',
    delete: 'audio.delete',
  },
  acars: {
    view: 'acars.view',
    viewFull: 'acars.view_full',
  },
  history: {
    view: 'history.view',
    export: 'history.export',
  },
  system: {
    viewStatus: 'system.view_status',
    viewMetrics: 'system.view_metrics',
    manage: 'system.manage',
  },
  users: {
    view: 'users.view',
    create: 'users.create',
    edit: 'users.edit',
    delete: 'users.delete',
  },
  roles: {
    view: 'roles.view',
    create: 'roles.create',
    edit: 'roles.edit',
    delete: 'roles.delete',
  },
};
