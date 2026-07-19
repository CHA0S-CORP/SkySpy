import React, { useState } from 'react';
import { Switch, Select, toast, EmptyState } from '../../primitives';
import { useAuth } from '../../../../contexts/AuthContext';
import { adminApi } from '../../../../lib/adminApi';

const ACCESS_OPTIONS = [
  { value: 'public', label: 'Public (anonymous)' },
  { value: 'authenticated', label: 'Signed-in users' },
  { value: 'permission', label: 'Role permission' },
];

/**
 * Feature Access tab — the access-level layer above role permissions. Per feature:
 * enable/disable, and set read/write to public / authenticated / permission. This
 * is where an admin decides what is exposed anonymously vs gated behind a role.
 */
export function FeatureAccessTab({ ac }) {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('system.manage') || hasPermission('roles.edit');
  const { features, reloadFeatures } = ac;
  const [busy, setBusy] = useState(null);

  const patch = async (feature, body) => {
    setBusy(feature);
    try {
      await adminApi.featureAccess.update(feature, body);
      await reloadFeatures();
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (!features.length) {
    return (
      <EmptyState
        icon="sliders"
        message="No feature-access rows yet."
        action={
          <button
            type="button"
            className="v2-btn v2-btn--primary"
            onClick={async () => {
              try {
                await adminApi.featureAccess.initializeDefaults();
                await reloadFeatures();
                toast('Initialized feature access');
              } catch (e) {
                toast(e.message);
              }
            }}
          >
            Initialize defaults
          </button>
        }
      />
    );
  }

  return (
    <div className="v2-access-features">
      <div className="v2-access-tablewrap">
        <table className="v2-access-table">
          <thead>
            <tr>
              <th>Feature</th>
              <th>Enabled</th>
              <th>Read access</th>
              <th>Write access</th>
            </tr>
          </thead>
          <tbody>
            {features.map((f) => (
              <tr key={f.feature} className={busy === f.feature ? 'is-busy' : ''}>
                <td>
                  <div className="v2-access-users__name">{f.feature_display || f.feature}</div>
                  <div className="v2-access-users__sub">{f.feature}</div>
                </td>
                <td>
                  <Switch
                    checked={f.is_enabled}
                    onCheckedChange={(v) => patch(f.feature, { is_enabled: v })}
                    label={`${f.feature} enabled`}
                    disabled={!canEdit}
                  />
                </td>
                <td>
                  <Select
                    label={`${f.feature} read access`}
                    value={f.read_access}
                    onChange={(v) => patch(f.feature, { read_access: v })}
                    options={ACCESS_OPTIONS}
                    disabled={!canEdit}
                  />
                </td>
                <td>
                  <Select
                    label={`${f.feature} write access`}
                    value={f.write_access}
                    onChange={(v) => patch(f.feature, { write_access: v })}
                    options={ACCESS_OPTIONS}
                    disabled={!canEdit}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="v2-access-roles__hint">
        “Public” exposes a feature’s reads to anonymous visitors. “Role permission” gates it to
        roles that hold the matching <code>&lt;feature&gt;.view</code> / <code>.edit</code>{' '}
        permission.
      </p>
    </div>
  );
}

export default FeatureAccessTab;
