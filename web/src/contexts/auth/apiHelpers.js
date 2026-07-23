/**
 * API helper functions for authentication
 */

/**
 * Helper to safely parse JSON from fetch response
 */
export const safeJson = async (res) => {
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
};

/**
 * Create user data object from API response
 * Handles both snake_case (Django) and camelCase field names
 *
 * @param {Object} data - API response data
 * @returns {Object} Normalized user data object
 */
export function createUserData(data) {
  if (!data) {
    return {
      id: null,
      username: '',
      email: '',
      displayName: '',
      isSuperuser: false,
      isStaff: false,
      permissions: [],
      roles: [],
    };
  }

  return {
    id: data.id ?? null,
    username: data.username || '',
    email: data.email || '',
    // Support both snake_case (display_name) and camelCase (displayName)
    displayName: data.display_name || data.displayName || '',
    isSuperuser: data.is_superuser ?? data.isSuperuser ?? false,
    isStaff: data.is_staff ?? data.isStaff ?? false,
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
    authMode: authEnabled ? 'hybrid' : 'public',
    publicMode: !authEnabled,
    oidcEnabled: false,
    localAuthEnabled: authEnabled,
    apiKeyEnabled: false,
    devMode: false,
    mapClusterZoomThreshold: 8,
    features: {},
  };
}
