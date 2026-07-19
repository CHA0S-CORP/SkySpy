// Single source for attaching the JWT bearer to fetch calls. The backend
// authorizes via the Authorization header (preferred) OR the access_token
// cookie; when JWT_AUTH_COOKIE=False (the default) the header is the ONLY way,
// so any authed request that omits it 401s a signed-in user. Read the token
// straight from storage so plain `fetch` callers don't need the AuthContext.
import { ACCESS_TOKEN_KEY } from '../contexts/auth/tokenStorage';

/** Current access token, or null when signed out. */
export function getAccessToken() {
  try {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Merge the bearer Authorization header into `headers` when a token exists.
 * Anonymous callers get `headers` unchanged (→ 401/403, the intended gate).
 * @param {Record<string,string>} [headers]
 * @returns {Record<string,string>}
 */
export function withAuth(headers = {}) {
  const token = getAccessToken();
  return token ? { ...headers, Authorization: `Bearer ${token}` } : { ...headers };
}
