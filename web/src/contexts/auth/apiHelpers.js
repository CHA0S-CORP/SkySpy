/**
 * API helper functions for authentication
 */

/**
 * Helper to safely parse JSON from fetch response
 */
export const safeJson = async (res) => {
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) return null;
  try { return await res.json(); } catch { return null; }
};

/**
 * Create user data object from API response
 */
export function createUserData(data) {
  return {
    id: data.id,
    username: data.username,
    email: data.email,
    displayName: data.display_name,
    permissions: data.permissions || [],
    roles: data.roles || [],
  };
}

/**
 * Create default auth config
 */
export function createDefaultConfig(authEnabled = true) {
  return {
    authEnabled,
    publicMode: !authEnabled,
    oidcEnabled: false,
    localAuthEnabled: authEnabled,
    apiKeyEnabled: false,
    features: {},
  };
}
