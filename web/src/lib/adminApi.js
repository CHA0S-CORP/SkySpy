// Admin RBAC fetch layer for the Access Control console (roles, users,
// feature-access, API keys, permission catalog). These endpoints require a
// signed-in admin, so — like useSystemConfig — we attach the JWT bearer from
// localStorage rather than going through lib/api.js's apiRequest (which is
// cookie/anon-scoped and never sends Authorization).

import { ACCESS_TOKEN_KEY } from '../contexts/auth/tokenStorage';

const API_BASE = '/api/v1';

/** Flatten a DRF error body into a single human string. */
function parseError(data, status) {
  if (!data) return `HTTP ${status}`;
  if (typeof data === 'string') return data;
  if (data.detail)
    return typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
  if (data.error) return data.error;
  if (data.non_field_errors) {
    return Array.isArray(data.non_field_errors)
      ? data.non_field_errors.join(', ')
      : String(data.non_field_errors);
  }
  const parts = [];
  for (const [field, errors] of Object.entries(data)) {
    parts.push(`${field}: ${Array.isArray(errors) ? errors.join(', ') : errors}`);
  }
  return parts.length ? parts.join('; ') : `HTTP ${status}`;
}

function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  // The app stores the JWT under ACCESS_TOKEN_KEY ('skyspy_access_token');
  // fall back to the legacy 'access_token' for safety.
  const token = localStorage.getItem(ACCESS_TOKEN_KEY) || localStorage.getItem('access_token');
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function request(path, { method = 'GET', body, params } = {}) {
  let url = `${API_BASE}${path}`;
  if (params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') qs.append(k, v);
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }

  const res = await fetch(url, {
    method,
    headers: authHeaders(),
    credentials: 'include',
    body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
  });

  let data = null;
  const ct = res.headers.get('content-type');
  if (ct && ct.includes('application/json')) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const err = new Error(parseError(data, res.status));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const adminApi = {
  // Permission catalog — features + per-permission action labels for the matrix.
  getPermissionCatalog: () => request('/auth/permissions/'),

  roles: {
    list: () => request('/admin/roles/'),
    create: (body) => request('/admin/roles/', { method: 'POST', body }),
    update: (id, body) => request(`/admin/roles/${id}/`, { method: 'PATCH', body }),
    remove: (id) => request(`/admin/roles/${id}/`, { method: 'DELETE' }),
    resetDefaults: (id) => request(`/admin/roles/${id}/reset_defaults/`, { method: 'POST' }),
    initializeDefaults: () => request('/admin/roles/initialize_defaults/', { method: 'POST' }),
  },

  users: {
    list: () => request('/admin/users/'),
    // body: { username, password, email?, display_name?, role_ids? }
    create: (body) => request('/admin/users/', { method: 'POST', body }),
    update: (id, body) => request(`/admin/users/${id}/`, { method: 'PATCH', body }),
    // role can be a numeric id or the role name; expires_at optional ISO string.
    assignRole: (id, role, expiresAt) =>
      request(`/admin/users/${id}/assign_role/`, {
        method: 'POST',
        body: { role, expires_at: expiresAt ?? null },
      }),
    removeRole: (id, role) =>
      request(`/admin/users/${id}/remove_role/`, { method: 'POST', body: { role } }),
  },

  featureAccess: {
    list: () => request('/admin/feature-access/'),
    update: (feature, body) =>
      request(`/admin/feature-access/${feature}/`, { method: 'PATCH', body }),
    initializeDefaults: () =>
      request('/admin/feature-access/initialize_defaults/', { method: 'POST' }),
  },

  apiKeys: {
    list: () => request('/admin/api-keys/'),
    create: (body) => request('/admin/api-keys/', { method: 'POST', body }),
    regenerate: (id) => request(`/admin/api-keys/${id}/regenerate/`, { method: 'POST' }),
    revoke: (id) => request(`/admin/api-keys/${id}/`, { method: 'DELETE' }),
  },
};

export default adminApi;
