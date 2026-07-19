import React from 'react';
import { Icon, Chip } from '../../primitives';
import { useAuth } from '../../../../contexts/AuthContext';

/**
 * Global tab — read-only status of the deployment-wide auth posture. The global
 * mode (public / hybrid / private) is set at deploy time via AUTH_MODE
 * (`make dev-auth` / `make dev-public` / env), not flipped live here. This tab
 * shows the effective mode and which features are currently anonymous-readable.
 */
export function GlobalTab({ ac }) {
  const { config } = useAuth();
  const publicMode = !config.authEnabled || config.publicMode;
  const mode = publicMode ? 'public' : config.authMode || 'enforced (hybrid/private)';

  const publicFeatures = (ac.features || []).filter(
    (f) => f.read_access === 'public' && f.is_enabled
  );
  const gatedFeatures = (ac.features || []).filter(
    (f) => f.read_access !== 'public' || !f.is_enabled
  );

  return (
    <div className="v2-access-global">
      <div className="v2-access-global__card">
        <div className="v2-access-global__mode">
          <Icon name={publicMode ? 'map' : 'lock'} size={22} strokeWidth={1.8} />
          <div>
            <div className="v2-access-global__eyebrow">EFFECTIVE AUTH MODE</div>
            <div className="v2-access-global__value">{mode}</div>
          </div>
        </div>
        <p className="v2-access-roles__hint">
          Global public access is set by the deployment (<code>AUTH_MODE</code> —{' '}
          <code>make dev-auth</code> for hybrid, <code>make dev-public</code> for public). Use{' '}
          <strong>Feature Access</strong> to scope individual features.{' '}
          {config.devMode && 'Dev mode relaxes gates locally.'}
        </p>
      </div>

      <div className="v2-access-global__cols">
        <div>
          <h3>
            <Icon name="map" size={14} strokeWidth={2} /> Anonymous-readable (
            {publicFeatures.length})
          </h3>
          <div className="v2-access-global__chips">
            {publicFeatures.length === 0 && <span className="v2-access-users__none">None</span>}
            {publicFeatures.map((f) => (
              <Chip key={f.feature}>{f.feature_display || f.feature}</Chip>
            ))}
          </div>
        </div>
        <div>
          <h3>
            <Icon name="lock" size={14} strokeWidth={2} /> Gated ({gatedFeatures.length})
          </h3>
          <div className="v2-access-global__chips">
            {gatedFeatures.map((f) => (
              <Chip key={f.feature} mono>
                {f.feature_display || f.feature}
                {!f.is_enabled ? ' (off)' : ''}
              </Chip>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default GlobalTab;
