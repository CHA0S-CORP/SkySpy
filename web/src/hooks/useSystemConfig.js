import { useState, useEffect, useCallback, useMemo } from 'react';

/**
 * Parse Django REST Framework error responses.
 */
const parseDRFError = (data) => {
  if (!data) return 'Unknown error';
  if (typeof data === 'string') return data;
  if (data.detail) {
    return typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
  }
  if (data.non_field_errors) {
    return Array.isArray(data.non_field_errors)
      ? data.non_field_errors.join(', ')
      : data.non_field_errors;
  }
  const fieldErrors = [];
  for (const [field, errors] of Object.entries(data)) {
    if (Array.isArray(errors)) {
      fieldErrors.push(`${field}: ${errors.join(', ')}`);
    } else if (typeof errors === 'string') {
      fieldErrors.push(`${field}: ${errors}`);
    }
  }
  if (fieldErrors.length > 0) {
    return fieldErrors.join('; ');
  }
  return JSON.stringify(data);
};

/**
 * Get auth headers for API requests.
 */
const getAuthHeaders = () => {
  const token = localStorage.getItem('access_token');
  const headers = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
};

/**
 * Hook for managing system configuration.
 * Provides CRUD operations for admin configuration management.
 *
 * @param {Object} options
 * @param {string} options.apiBase - API base URL
 * @param {Function} options.onToast - Toast notification callback
 * @returns {Object} Configuration state and operations
 */
export function useSystemConfig({ apiBase = '', onToast } = {}) {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pendingChanges, setPendingChanges] = useState({});
  const [saving, setSaving] = useState(false);
  const [auditLog, setAuditLog] = useState([]);
  const [auditLogLoading, setAuditLogLoading] = useState(false);

  // Toast helper
  const showToast = useCallback(
    (message, type = 'info') => {
      if (onToast) {
        onToast(message, type);
      }
    },
    [onToast]
  );

  // Fetch all configurations
  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${apiBase}/api/v1/admin/config/`, {
        headers: getAuthHeaders(),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data ? parseDRFError(data) : `HTTP ${res.status}`);
      }

      const data = await res.json();
      setCategories(data.categories || []);
    } catch (err) {
      setError(err.message);
      showToast(`Failed to load configuration: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [apiBase, showToast]);

  // Initial fetch
  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  // Update a single configuration value (local state only)
  const updateValue = useCallback((key, value) => {
    setPendingChanges((prev) => ({
      ...prev,
      [key]: value,
    }));
  }, []);

  // Reset pending change for a key
  const resetValue = useCallback((key) => {
    setPendingChanges((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  // Clear all pending changes
  const clearPendingChanges = useCallback(() => {
    setPendingChanges({});
  }, []);

  // Save a single configuration value
  const saveValue = useCallback(
    async (key, value) => {
      setSaving(true);

      try {
        const res = await fetch(`${apiBase}/api/v1/admin/config/${encodeURIComponent(key)}/`, {
          method: 'PATCH',
          headers: getAuthHeaders(),
          body: JSON.stringify({ value: String(value) }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data ? parseDRFError(data) : `HTTP ${res.status}`);
        }

        // Remove from pending changes
        setPendingChanges((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });

        showToast('Configuration saved', 'success');
        await fetchConfigs();
        return true;
      } catch (err) {
        showToast(`Failed to save: ${err.message}`, 'error');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [apiBase, fetchConfigs, showToast]
  );

  // Save all pending changes
  const saveAllPendingChanges = useCallback(async () => {
    if (Object.keys(pendingChanges).length === 0) {
      return true;
    }

    setSaving(true);

    try {
      const res = await fetch(`${apiBase}/api/v1/admin/config/bulk_update/`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ updates: pendingChanges }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data ? parseDRFError(data) : `HTTP ${res.status}`);
      }

      const result = await res.json();

      if (result.errors && Object.keys(result.errors).length > 0) {
        const errorKeys = Object.keys(result.errors);
        showToast(`Some configs failed to save: ${errorKeys.join(', ')}`, 'warning');
      } else {
        showToast(`Saved ${result.updated?.length || 0} configurations`, 'success');
      }

      // Clear saved changes from pending
      if (result.updated) {
        setPendingChanges((prev) => {
          const next = { ...prev };
          for (const key of result.updated) {
            delete next[key];
          }
          return next;
        });
      }

      // Check for restart-required settings
      if (result.requires_restart?.length > 0) {
        showToast('Some changes require a restart to take effect', 'warning');
      }

      await fetchConfigs();
      return true;
    } catch (err) {
      showToast(`Failed to save: ${err.message}`, 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }, [apiBase, pendingChanges, fetchConfigs, showToast]);

  // Reset a configuration to its default value
  const resetToDefault = useCallback(
    async (key) => {
      setSaving(true);

      try {
        const res = await fetch(`${apiBase}/api/v1/admin/config/reset_to_default/`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ keys: [key] }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data ? parseDRFError(data) : `HTTP ${res.status}`);
        }

        // Clear from pending changes
        setPendingChanges((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });

        showToast('Configuration reset to default', 'success');
        await fetchConfigs();
        return true;
      } catch (err) {
        showToast(`Failed to reset: ${err.message}`, 'error');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [apiBase, fetchConfigs, showToast]
  );

  // Fetch audit log
  const fetchAuditLog = useCallback(
    async (configKey = null, hours = 24) => {
      setAuditLogLoading(true);

      try {
        let url = `${apiBase}/api/v1/admin/config/audit_log/?hours=${hours}&limit=100`;
        if (configKey) {
          url += `&config_key=${encodeURIComponent(configKey)}`;
        }

        const res = await fetch(url, {
          headers: getAuthHeaders(),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data ? parseDRFError(data) : `HTTP ${res.status}`);
        }

        const data = await res.json();
        setAuditLog(data.audit_log || []);
      } catch (err) {
        showToast(`Failed to load audit log: ${err.message}`, 'error');
      } finally {
        setAuditLogLoading(false);
      }
    },
    [apiBase, showToast]
  );

  // Export configurations
  const exportConfigs = useCallback(
    async (includeSensitive = false) => {
      try {
        const res = await fetch(
          `${apiBase}/api/v1/admin/config/export/?include_sensitive=${includeSensitive}`,
          { headers: getAuthHeaders() }
        );

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data ? parseDRFError(data) : `HTTP ${res.status}`);
        }

        const data = await res.json();

        // Download as JSON file
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `skyspy-config-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast('Configuration exported', 'success');
      } catch (err) {
        showToast(`Failed to export: ${err.message}`, 'error');
      }
    },
    [apiBase, showToast]
  );

  // Import configurations
  const importConfigs = useCallback(
    async (file, options = {}) => {
      const { skipReadonly = true, dryRun = false } = options;

      try {
        const text = await file.text();
        const imported = JSON.parse(text);

        // Extract configs from exported format
        const configs = imported.configs || imported;

        const res = await fetch(`${apiBase}/api/v1/admin/config/import_config/`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            configs,
            skip_readonly: skipReadonly,
            dry_run: dryRun,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data ? parseDRFError(data) : `HTTP ${res.status}`);
        }

        const result = await res.json();

        if (dryRun) {
          return result;
        }

        const message = `Imported ${result.imported} configs, skipped ${result.skipped}`;
        if (result.errors && Object.keys(result.errors).length > 0) {
          showToast(`${message}. Some errors occurred.`, 'warning');
        } else {
          showToast(message, 'success');
        }

        await fetchConfigs();
        return result;
      } catch (err) {
        showToast(`Failed to import: ${err.message}`, 'error');
        throw err;
      }
    },
    [apiBase, fetchConfigs, showToast]
  );

  // Validate a configuration value
  const validateValue = useCallback(
    async (key, value) => {
      try {
        const res = await fetch(`${apiBase}/api/v1/admin/config/validate/`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ key, value: String(value) }),
        });

        if (!res.ok) {
          return { valid: false, errors: ['Failed to validate'] };
        }

        return await res.json();
      } catch {
        return { valid: false, errors: ['Validation request failed'] };
      }
    },
    [apiBase]
  );

  // Reveal sensitive value
  const revealSensitiveValue = useCallback(
    async (key) => {
      try {
        const res = await fetch(
          `${apiBase}/api/v1/admin/config/${encodeURIComponent(key)}/reveal/`,
          {
            method: 'POST',
            headers: getAuthHeaders(),
          }
        );

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data ? parseDRFError(data) : `HTTP ${res.status}`);
        }

        const data = await res.json();
        return data.value;
      } catch (err) {
        showToast(`Failed to reveal value: ${err.message}`, 'error');
        return null;
      }
    },
    [apiBase, showToast]
  );

  // Compute all configs as flat array
  const allConfigs = useMemo(() => {
    const configs = [];
    for (const category of categories) {
      for (const config of category.configs || []) {
        configs.push(config);
      }
    }
    return configs;
  }, [categories]);

  // Get config value (with pending change if exists)
  const getConfigValue = useCallback(
    (key) => {
      if (key in pendingChanges) {
        return pendingChanges[key];
      }
      const config = allConfigs.find((c) => c.key === key);
      return config?.value ?? '';
    },
    [allConfigs, pendingChanges]
  );

  // Check if config has pending change
  const hasChange = useCallback(
    (key) => {
      return key in pendingChanges;
    },
    [pendingChanges]
  );

  // Count of pending changes
  const pendingChangeCount = Object.keys(pendingChanges).length;

  // Check if any pending changes require restart
  const hasRestartRequired = useMemo(() => {
    return Object.keys(pendingChanges).some((key) => {
      const config = allConfigs.find((c) => c.key === key);
      return config?.requires_restart;
    });
  }, [allConfigs, pendingChanges]);

  return {
    // Data
    categories,
    allConfigs,
    loading,
    error,

    // Operations
    refetch: fetchConfigs,
    updateValue,
    resetValue,
    clearPendingChanges,
    saveValue,
    saveAllPendingChanges,
    resetToDefault,
    validateValue,
    revealSensitiveValue,

    // Pending changes
    pendingChanges,
    pendingChangeCount,
    hasChange,
    hasRestartRequired,
    getConfigValue,
    saving,

    // Audit log
    auditLog,
    auditLogLoading,
    fetchAuditLog,

    // Export/Import
    exportConfigs,
    importConfigs,

    // Toast
    showToast,
  };
}
