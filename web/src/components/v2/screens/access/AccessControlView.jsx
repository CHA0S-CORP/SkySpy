import React, { useState } from 'react';
import { Icon, Tabs, EmptyState } from '../../primitives';
import { useAuth } from '../../../../contexts/AuthContext';
import { useAccessControl } from '../../../../hooks/useAccessControl';
import { RolesTab } from './RolesTab';
import { UsersTab } from './UsersTab';
import { FeatureAccessTab } from './FeatureAccessTab';
import { ApiKeysTab } from './ApiKeysTab';
import { GlobalTab } from './GlobalTab';

const TABS = [
  { value: 'roles', label: 'Roles' },
  { value: 'users', label: 'Users' },
  { value: 'features', label: 'Feature Access' },
  { value: 'keys', label: 'API Keys' },
  { value: 'global', label: 'Global' },
];

/**
 * Access Control console — the RBAC admin surface. Roles tab is the core: a
 * feature × action permission matrix per role. Menu/feature visibility for every
 * user is driven off the permission strings edited here.
 */
export function AccessControlView() {
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState('roles');
  const ac = useAccessControl();

  // Backstop the NavRail gate: someone deep-linking #access without roles.view
  // gets a message, not the console. (Backend enforces regardless.)
  if (!hasPermission('roles.view') && !hasPermission('users.view')) {
    return (
      <div className="v2-access">
        <EmptyState icon="lock" message="You don't have permission to manage access control." />
      </div>
    );
  }

  return (
    <div className="v2-access">
      <header className="v2-access__head">
        <div className="v2-access__title">
          <Icon name="shield" size={20} strokeWidth={1.8} />
          <div>
            <h1>Access Control</h1>
            <p>Control which roles can see and use each feature.</p>
          </div>
        </div>
      </header>

      <Tabs tabs={TABS} value={tab} onChange={setTab} className="v2-access__tabs" />

      {ac.error && <div className="v2-access__error">{ac.error}</div>}

      <div className="v2-access__body">
        {ac.loading ? (
          <div className="v2-access__loading">Loading…</div>
        ) : (
          <>
            {tab === 'roles' && <RolesTab ac={ac} />}
            {tab === 'users' && <UsersTab ac={ac} />}
            {tab === 'features' && <FeatureAccessTab ac={ac} />}
            {tab === 'keys' && <ApiKeysTab ac={ac} />}
            {tab === 'global' && <GlobalTab ac={ac} />}
          </>
        )}
      </div>
    </div>
  );
}

export default AccessControlView;
