/**
 * Token storage utilities for authentication
 * Handles localStorage operations for access/refresh tokens and user data
 */

// Token storage keys
export const ACCESS_TOKEN_KEY = 'skyspy_access_token';
export const REFRESH_TOKEN_KEY = 'skyspy_refresh_token';
export const USER_KEY = 'skyspy_user';

/**
 * Get stored tokens from localStorage
 */
export function getStoredTokens() {
  return {
    accessToken: localStorage.getItem(ACCESS_TOKEN_KEY),
    refreshToken: localStorage.getItem(REFRESH_TOKEN_KEY),
  };
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
 * Clear stored tokens
 */
export function clearTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/**
 * Get stored user from localStorage
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
 * Store user in localStorage
 */
export function storeUser(user) {
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
}
