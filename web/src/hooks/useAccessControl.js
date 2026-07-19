import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../lib/adminApi';

/**
 * Loads everything the Access Control console needs (permission catalog, roles,
 * users, feature-access, API keys) and exposes per-resource reloaders. Mutations
 * live on `adminApi`; tabs call those then invoke the matching reload so the UI
 * reflects the server (the permission strings are the single source of truth).
 */
export function useAccessControl() {
  const [catalog, setCatalog] = useState([]);
  const [roles, setRoles] = useState([]);
  const [users, setUsers] = useState([]);
  const [features, setFeatures] = useState([]);
  const [apiKeys, setApiKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reloadRoles = useCallback(async () => {
    const data = await adminApi.roles.list();
    setRoles(data?.roles ?? []);
  }, []);

  const reloadUsers = useCallback(async () => {
    const data = await adminApi.users.list();
    setUsers(data?.users ?? []);
  }, []);

  const reloadFeatures = useCallback(async () => {
    const data = await adminApi.featureAccess.list();
    setFeatures(data?.features ?? []);
  }, []);

  const reloadKeys = useCallback(async () => {
    const data = await adminApi.apiKeys.list();
    setApiKeys(data?.api_keys ?? []);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    // allSettled, not all: a transient failure of one resource (e.g. a throttled
    // api-keys call) must not blank the whole console — load what we can and
    // surface a single error only if something actually failed.
    const results = await Promise.allSettled([
      adminApi.getPermissionCatalog().then((cat) => setCatalog(Array.isArray(cat) ? cat : [])),
      reloadRoles(),
      reloadUsers(),
      reloadFeatures(),
      reloadKeys(),
    ]);
    const failed = results.find((r) => r.status === 'rejected');
    setError(failed ? failed.reason?.message || 'Some access data failed to load' : null);
    setLoading(false);
  }, [reloadRoles, reloadUsers, reloadFeatures, reloadKeys]);

  useEffect(() => {
    reload();
  }, [reload]);

  return {
    catalog,
    roles,
    users,
    features,
    apiKeys,
    loading,
    error,
    reload,
    reloadRoles,
    reloadUsers,
    reloadFeatures,
    reloadKeys,
  };
}

export default useAccessControl;
