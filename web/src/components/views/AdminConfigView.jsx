import React, { useCallback } from 'react';
import { ConfigPage } from '../admin/config';
import { useToast } from '../../hooks/useToast';

/**
 * Admin Configuration View
 * Wrapper for ConfigPage that provides the view-level integration.
 */
export function AdminConfigView({ apiBase = '' }) {
  const { showToast: toastFn } = useToast();

  const handleToast = useCallback((message, type = 'info') => {
    if (toastFn) {
      toastFn(message, type);
    } else {
      console.log(`[Toast ${type}]:`, message);
    }
  }, [toastFn]);

  return (
    <div className="view-admin-config">
      <ConfigPage apiBase={apiBase} onToast={handleToast} />
    </div>
  );
}

export default AdminConfigView;
