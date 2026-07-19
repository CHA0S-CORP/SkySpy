import React, { useEffect, useMemo, useState } from 'react';
import { Icon, Chip, Modal, toast, EmptyState } from '../../primitives';
import { useAuth } from '../../../../contexts/AuthContext';
import { adminApi } from '../../../../lib/adminApi';

/**
 * Roles tab — the heart of the console. Pick a role, toggle its access in a
 * feature × action matrix. Each cell is a permission string (e.g. `alerts.edit`);
 * saving writes the role's `permissions` array, which is exactly what the nav /
 * feature gates read. System (built-in) roles are editable with a reset button.
 */
export function RolesTab({ ac }) {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('roles.edit');
  const canCreate = hasPermission('roles.create');
  const canDelete = hasPermission('roles.delete');

  const { catalog, roles, reloadRoles } = ac;
  const [selectedId, setSelectedId] = useState(roles[0]?.id ?? null);
  const [draft, setDraft] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const selected = useMemo(
    () => roles.find((r) => r.id === selectedId) ?? null,
    [roles, selectedId]
  );

  // Reset the draft whenever the selected role (or its server perms) changes.
  useEffect(() => {
    if (!selectedId && roles.length) setSelectedId(roles[0].id);
  }, [roles, selectedId]);

  useEffect(() => {
    setDraft(new Set(selected?.permissions ?? []));
  }, [selected]);

  const dirty = useMemo(() => {
    const orig = new Set(selected?.permissions ?? []);
    if (orig.size !== draft.size) return true;
    for (const p of draft) if (!orig.has(p)) return true;
    return false;
  }, [draft, selected]);

  const toggle = (perm) => {
    if (!canEdit) return;
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(perm)) next.delete(perm);
      else next.add(perm);
      return next;
    });
  };

  const toggleFeature = (feature, allOn) => {
    if (!canEdit) return;
    setDraft((prev) => {
      const next = new Set(prev);
      for (const a of feature.actions) {
        if (allOn) next.delete(a.key);
        else next.add(a.key);
      }
      return next;
    });
  };

  const save = async () => {
    if (!selected || !dirty) return;
    setSaving(true);
    try {
      await adminApi.roles.update(selected.id, { permissions: [...draft] });
      await reloadRoles();
      toast(`Saved ${selected.display_name}`);
    } catch (e) {
      toast(e.message);
    } finally {
      setSaving(false);
    }
  };

  const resetDefaults = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await adminApi.roles.resetDefaults(selected.id);
      await reloadRoles();
      toast(`Reset ${selected.display_name} to defaults`);
    } catch (e) {
      toast(e.message);
    } finally {
      setSaving(false);
    }
  };

  const removeRole = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete role "${selected.display_name}"? Users lose its access.`)) return;
    try {
      await adminApi.roles.remove(selected.id);
      setSelectedId(null);
      await reloadRoles();
      toast('Role deleted');
    } catch (e) {
      toast(e.message);
    }
  };

  return (
    <div className="v2-access-roles">
      <aside className="v2-access-roles__list">
        {roles
          .slice()
          .sort((a, b) => b.priority - a.priority)
          .map((r) => (
            <button
              key={r.id}
              type="button"
              className={`v2-access-roles__item ${r.id === selectedId ? 'is-active' : ''}`}
              onClick={() => setSelectedId(r.id)}
            >
              <span className="v2-access-roles__name">{r.display_name}</span>
              <span className="v2-access-roles__meta">
                {r.is_system && <Chip mono>SYSTEM</Chip>}
                <span className="v2-access-roles__count">{r.user_count} users</span>
              </span>
            </button>
          ))}
        {canCreate && (
          <button
            type="button"
            className="v2-access-roles__add"
            onClick={() => setShowCreate(true)}
          >
            <Icon name="plus" size={14} strokeWidth={2} /> New role
          </button>
        )}
      </aside>

      <section className="v2-access-roles__editor">
        {!selected ? (
          <EmptyState icon="shield" message="Select a role to edit its access." />
        ) : (
          <>
            <div className="v2-access-roles__editorhead">
              <div>
                <h2>{selected.display_name}</h2>
                <p className="v2-access-roles__code">
                  {selected.name}
                  {selected.description ? ` — ${selected.description}` : ''}
                </p>
              </div>
              <div className="v2-access-roles__actions">
                {selected.is_system && canEdit && (
                  <button
                    type="button"
                    className="v2-btn"
                    onClick={resetDefaults}
                    disabled={saving}
                  >
                    <Icon name="refresh" size={14} strokeWidth={2} /> Reset defaults
                  </button>
                )}
                {!selected.is_system && canDelete && (
                  <button
                    type="button"
                    className="v2-btn v2-btn--danger"
                    onClick={removeRole}
                    disabled={saving}
                  >
                    <Icon name="trash" size={14} strokeWidth={2} /> Delete
                  </button>
                )}
                <button
                  type="button"
                  className="v2-btn v2-btn--primary"
                  onClick={save}
                  disabled={!canEdit || !dirty || saving}
                >
                  {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
                </button>
              </div>
            </div>

            <div className="v2-access-matrix">
              {catalog.map((feature) => {
                const total = feature.actions.length;
                const on = feature.actions.filter((a) => draft.has(a.key)).length;
                const allOn = on === total;
                return (
                  <div key={feature.feature} className="v2-access-matrix__row">
                    <div className="v2-access-matrix__feature">
                      <button
                        type="button"
                        className="v2-access-matrix__featurebtn"
                        onClick={() => toggleFeature(feature, allOn)}
                        disabled={!canEdit}
                        title={allOn ? 'Clear all' : 'Grant all'}
                      >
                        <span
                          className={`v2-access-matrix__all ${on ? (allOn ? 'is-full' : 'is-partial') : ''}`}
                        >
                          {allOn && <Icon name="check" size={12} strokeWidth={2.5} />}
                        </span>
                        {feature.display_name}
                      </button>
                    </div>
                    <div className="v2-access-matrix__cells">
                      {feature.actions.map((a) => {
                        const active = draft.has(a.key);
                        return (
                          <button
                            key={a.key}
                            type="button"
                            className={`v2-access-cell ${active ? 'is-on' : ''}`}
                            onClick={() => toggle(a.key)}
                            disabled={!canEdit}
                            title={a.key}
                          >
                            <span className="v2-access-cell__box">
                              {active && <Icon name="check" size={12} strokeWidth={2.5} />}
                            </span>
                            {a.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="v2-access-roles__hint">
              Changes apply to a user on their next sign-in or token refresh.
            </p>
          </>
        )}
      </section>

      {showCreate && (
        <CreateRoleModal
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onCreated={async (id) => {
            setShowCreate(false);
            await reloadRoles();
            if (id) setSelectedId(id);
          }}
        />
      )}
    </div>
  );
}

function CreateRoleModal({ open, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_');
    if (!slug) {
      toast('Role name is required');
      return;
    }
    setBusy(true);
    try {
      const role = await adminApi.roles.create({
        name: slug,
        display_name: displayName.trim() || slug,
        permissions: [],
        priority: 15,
      });
      toast('Role created');
      onCreated(role?.id);
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title="New role" width="420px">
      <div className="v2-access-form">
        <label>
          Name (id)
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="dispatcher" />
        </label>
        <label>
          Display name
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Dispatcher"
          />
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

export default RolesTab;
