/**
 * JWT token parsing and validation utilities
 */

/**
 * Parse JWT token to get payload
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
 * Check if token is expired or about to expire (within buffer seconds)
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
export function getTokenExpirationMs(token) {
  if (!token) return null;
  const payload = parseJwt(token);
  if (!payload || !payload.exp) return null;
  return payload.exp * 1000;
}
