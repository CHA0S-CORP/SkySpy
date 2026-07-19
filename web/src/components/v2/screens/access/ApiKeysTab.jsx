import React, { useState } from 'react';
import { Icon, Chip, Modal, toast, EmptyState } from '../../primitives';
import { useAuth } from '../../../../contexts/AuthContext';
import { adminApi } from '../../../../lib/adminApi';

/**
 * API Keys tab — list, create (raw key shown once), regenerate, revoke. Keys
 * inherit their owner's permissions unless scoped; scoping UI is intentionally
 * minimal here (name only) — scopes can be tightened via the model/admin.
 */
export function ApiKeysTab({ ac }) {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('users.view');
  const { apiKeys, reloadKeys } = ac;
  const [showCreate, setShowCreate] = useState(false);
  const [revealed, setRevealed] = useState(null); // { name, key }

  const regenerate = async (id, name) => {
    if (!window.confirm(`Regenerate key "${name}"? The old key stops working immediately.`)) return;
    try {
      const res = await adminApi.apiKeys.regenerate(id);
      await reloadKeys();
      if (res?.key) setRevealed({ name, key: res.key });
    } catch (e) {
      toast(e.message);
    }
  };

  const revoke = async (id, name) => {
    if (!window.confirm(`Revoke key "${name}"?`)) return;
    try {
      await adminApi.apiKeys.revoke(id);
      await reloadKeys();
      toast('Key revoked');
    } catch (e) {
      toast(e.message);
    }
  };

  return (
    <div className="v2-access-keys">
      <div className="v2-access-keys__toolbar">
        {canManage && (
          <button
            type="button"
            className="v2-btn v2-btn--primary"
            onClick={() => setShowCreate(true)}
          >
            <Icon name="plus" size={14} strokeWidth={2} /> New API key
          </button>
        )}
      </div>

      {apiKeys.length === 0 ? (
        <EmptyState icon="lock" message="No API keys yet." />
      ) : (
        <div className="v2-access-tablewrap">
          <table className="v2-access-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Prefix</th>
                <th>Scopes</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {apiKeys.map((k) => (
                <tr key={k.id} className={k.is_active ? '' : 'is-revoked'}>
                  <td>{k.name}</td>
                  <td>
                    <Chip mono>{k.key_prefix}…</Chip>
                  </td>
                  <td>{k.scopes?.length ? k.scopes.join(', ') : 'all (owner perms)'}</td>
                  <td>
                    {k.is_active ? (
                      <Chip active color="#3ecf8e">
                        active
                      </Chip>
                    ) : (
                      <Chip mono>revoked</Chip>
                    )}
                  </td>
                  <td className="v2-access-keys__row-actions">
                    {canManage && k.is_active && (
                      <>
                        <button
                          type="button"
                          className="v2-btn"
                          onClick={() => regenerate(k.id, k.name)}
                        >
                          Regenerate
                        </button>
                        <button
                          type="button"
                          className="v2-btn v2-btn--danger"
                          onClick={() => revoke(k.id, k.name)}
                        >
                          Revoke
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateKeyModal
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onCreated={async (created) => {
            setShowCreate(false);
            await reloadKeys();
            if (created?.key) setRevealed({ name: created.name, key: created.key });
          }}
        />
      )}

      {revealed && (
        <Modal
          open
          onOpenChange={(o) => !o && setRevealed(null)}
          title="API key — copy it now"
          width="480px"
        >
          <div className="v2-access-form">
            <p className="v2-access-roles__hint">
              This is the only time the full key for <strong>{revealed.name}</strong> is shown.
            </p>
            <code className="v2-access-keys__reveal">{revealed.key}</code>
            <div className="v2-access-form__actions">
              <button
                type="button"
                className="v2-btn"
                onClick={() => {
                  navigator.clipboard?.writeText(revealed.key);
                  toast('Copied');
                }}
              >
                Copy
              </button>
              <button
                type="button"
                className="v2-btn v2-btn--primary"
                onClick={() => setRevealed(null)}
              >
                Done
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CreateKeyModal({ open, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      toast('Name is required');
      return;
    }
    setBusy(true);
    try {
      const key = await adminApi.apiKeys.create({ name: name.trim() });
      toast('API key created');
      onCreated(key);
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title="New API key" width="420px">
      <div className="v2-access-form">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ingest-bot" />
        </label>
        <div className="v2-access-form__actions">
          <button type="button" className="v2-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="v2-btn v2-btn--primary" onClick={submit} disabled={busy}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default ApiKeysTab;
