import React, { useState } from 'react';
import { Icon, Chip, Select, Modal, toast, EmptyState } from '../../primitives';
import { useAuth } from '../../../../contexts/AuthContext';
import { adminApi } from '../../../../lib/adminApi';

/**
 * Users tab — create local users and assign/remove roles per user. Roles are the
 * unit of access; adding a role grants that role's permissions (and thus its
 * menus/features) to the user.
 */
export function UsersTab({ ac }) {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('users.edit');
  const canCreate = hasPermission('users.create');
  const { users, roles, reloadUsers } = ac;
  const [busyId, setBusyId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const assign = async (userId, roleName) => {
    if (!roleName) return;
    setBusyId(userId);
    try {
      await adminApi.users.assignRole(userId, roleName);
      await reloadUsers();
      toast('Role assigned');
    } catch (e) {
      toast(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (userId, roleName) => {
    setBusyId(userId);
    try {
      await adminApi.users.removeRole(userId, roleName);
      await reloadUsers();
      toast('Role removed');
    } catch (e) {
      toast(e.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="v2-access-users">
      {canCreate && (
        <div className="v2-access-keys__toolbar">
          <button
            type="button"
            className="v2-btn v2-btn--primary"
            onClick={() => setShowCreate(true)}
          >
            <Icon name="plus" size={14} strokeWidth={2} /> New user
          </button>
        </div>
      )}

      {!users.length ? (
        <EmptyState icon="users" message="No users found." />
      ) : (
        <div className="v2-access-tablewrap">
          <table className="v2-access-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Roles</th>
                {canEdit && <th>Add role</th>}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const assigned = new Set((u.roles || []).map((r) => r.name));
                const available = roles.filter((r) => !assigned.has(r.name));
                return (
                  <tr key={u.id} className={busyId === u.id ? 'is-busy' : ''}>
                    <td>
                      <div className="v2-access-users__name">{u.display_name || u.username}</div>
                      <div className="v2-access-users__sub">
                        {u.username}
                        {u.email ? ` · ${u.email}` : ''}
                        {u.is_active === false ? ' · disabled' : ''}
                      </div>
                    </td>
                    <td>
                      <div className="v2-access-users__roles">
                        {(u.roles || []).length === 0 && (
                          <span className="v2-access-users__none">—</span>
                        )}
                        {(u.roles || []).map((r) => (
                          <Chip key={r.name} active color="#5b8cff">
                            {r.display_name || r.name}
                            {canEdit && (
                              <button
                                type="button"
                                className="v2-access-users__x"
                                onClick={() => remove(u.id, r.name)}
                                title="Remove role"
                              >
                                <Icon name="x" size={11} strokeWidth={2.5} />
                              </button>
                            )}
                          </Chip>
                        ))}
                      </div>
                    </td>
                    {canEdit && (
                      <td>
                        <Select
                          label={`Add role to ${u.username}`}
                          value=""
                          onChange={(v) => assign(u.id, v)}
                          options={[
                            { value: '', label: 'Add role…' },
                            ...available.map((r) => ({
                              value: r.name,
                              label: r.display_name || r.name,
                            })),
                          ]}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateUserModal
          roles={roles}
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            setShowCreate(false);
            await reloadUsers();
          }}
        />
      )}
    </div>
  );
}

function CreateUserModal({ roles, onClose, onCreated }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [roleName, setRoleName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!username.trim() || !password) {
      toast('Username and password are required');
      return;
    }
    const role = roles.find((r) => r.name === roleName);
    setBusy(true);
    try {
      await adminApi.users.create({
        username: username.trim(),
        password,
        email: email.trim(),
        role_ids: role ? [role.id] : [],
      });
      toast('User created');
      onCreated();
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="New local user" width="420px">
      <div className="v2-access-form">
        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="jdoe"
          />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label>
          Email (optional)
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jdoe@example.com"
          />
        </label>
        <div className="v2-access-form__field">
          <span>Initial role (optional)</span>
          <Select
            label="Initial role"
            value={roleName}
            onChange={setRoleName}
            options={[
              { value: '', label: 'No role' },
              ...roles
                .slice()
                .sort((a, b) => a.priority - b.priority)
                .map((r) => ({ value: r.name, label: r.display_name || r.name })),
            ]}
          />
        </div>
        <div className="v2-access-form__actions">
          <button type="button" className="v2-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="v2-btn v2-btn--primary" onClick={submit} disabled={busy}>
            {busy ? 'Creating…' : 'Create user'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default UsersTab;
