import React, { useEffect, useMemo, useState } from 'react';
import { Icon, LiveIndicator } from '../primitives';
import { useAlertNotifications } from '../../../hooks/useAlertNotifications';
import { useAuth } from '../../../contexts/AuthContext';

// Nav items per the design (icons lifted from the mocks); feature/permission
// semantics carried over from the legacy Sidebar.
const NAV_ITEMS = [
  { id: 'map', icon: 'map', label: 'Live Map', feature: 'aircraft' },
  { id: 'aircraft', icon: 'plane', label: 'Aircraft List', feature: 'aircraft' },
  { id: 'stats', icon: 'bar-chart', label: 'Statistics', feature: 'aircraft' },
  { id: 'analytics', icon: 'line-chart', label: 'Analytics', feature: 'aircraft' },
  { id: 'airframes', icon: 'layers', label: 'Airframes', feature: 'aircraft' },
  { id: 'weather', icon: 'cloud', label: 'Weather', feature: 'weather' },
  { id: 'wildfires', icon: 'flame', label: 'Wildfires', feature: 'wildfires' },
  { id: 'history', icon: 'history', label: 'History', feature: 'history' },
  { id: 'audio', icon: 'wave', label: 'Radio', feature: 'audio' },
  { id: 'alerts', icon: 'bell', label: 'Alerts', feature: 'alerts' },
  {
    id: 'system',
    icon: 'activity',
    label: 'System',
    feature: 'system',
    permission: 'system.view_status',
    devVisible: true,
  },
  // Assistant is publicly discoverable (map/dashboard is public), but the chat
  // itself requires sign-in — the screen renders a sign-in gate for anonymous
  // users (CanUseAssistant returns 401/403). So keep it as a plain feature item:
  // shown in public mode, permission-gated when auth is enforced (hybrid/private).
  { id: 'assistant', icon: 'message', label: 'Assistant', feature: 'assistant' },
  {
    id: 'access',
    icon: 'shield',
    label: 'Access Control',
    feature: 'roles',
    permission: 'roles.view',
  },
  {
    id: 'admin',
    icon: 'sliders',
    label: 'Admin Config',
    feature: 'system',
    permission: 'system.manage',
  },
];

const EXTERNAL_SERVICES = [
  { id: 'tar1090', label: 'tar1090', path: '/tar1090/', desc: 'ADS-B Map' },
  { id: 'graphs', label: 'Graphs1090', path: '/graphs1090/', desc: 'Statistics' },
  { id: 'piaware', label: 'PiAware', path: '/piaware/', desc: 'FlightAware' },
  { id: 'uat', label: 'UAT 978', path: '/uat/', desc: 'UAT Receiver' },
  { id: 'acars', label: 'ACARS', path: '/acars/', desc: 'ACARS Hub' },
  { id: 'ais', label: 'AIS', path: '/ais/', desc: 'Ship Tracking' },
  { id: 'grafana', label: 'Grafana', path: '/grafana/', desc: 'Dashboards' },
  { id: 'prometheus', label: 'Prometheus', path: '/prometheus/', desc: 'Metrics' },
];

/**
 * 214px left nav rail (design "Shared chrome"): nav items, amber alerts badge,
 * red Cannonball entry, Services section, pulsing LIVE dot + version footer.
 *
 * @param {object} props
 * @param {string} props.activeTab
 * @param {(tab: string) => void} props.onNavigate
 * @param {boolean} props.connected
 * @param {string} [props.className]
 */
export function NavRail({ activeTab, onNavigate, connected, className = '' }) {
  const [servicesOpen, setServicesOpen] = useState(false);
  const { unacknowledgedCount, markAllAsRead } = useAlertNotifications();
  const { canAccessFeature, config: authConfig, user } = useAuth();

  const visibleItems = useMemo(() => {
    const publicMode = !authConfig.authEnabled || authConfig.publicMode;
    // Real permission check straight off the signed-in user — unlike the context's
    // hasPermission(), this does NOT return true for everyone in public mode, so a
    // logged-in user only sees permission-gated items they actually hold.
    const holdsPerm = (perm) =>
      !!user && (user.isSuperuser || (user.permissions || []).includes(perm));

    return NAV_ITEMS.filter((item) => {
      // Permission-gated items (AI Assistant, System, Admin).
      if (item.permission) {
        // A signed-in user with the permission (or a superuser) always sees it —
        // in any mode. This is why a logged-in admin gets Admin Console / AI / System.
        if (holdsPerm(item.permission)) return true;
        // Anonymous: in local dev (devMode) surface the AI/system entries flagged
        // devVisible so they work without logging in; never in production
        // (devMode === false) and never Admin (no devVisible).
        if (publicMode) return Boolean(item.devVisible) && authConfig.devMode !== false;
        return false;
      }
      if (!item.feature) return true;
      if (publicMode) return true;
      return canAccessFeature(item.feature, 'read');
    });
  }, [authConfig.authEnabled, authConfig.publicMode, authConfig.devMode, canAccessFeature, user]);

  // Cannonball + the Services section are RBAC features (cannonball/services):
  // shown in full public mode, else gated on the feature's read access (which
  // resolves to cannonball.view / services.view for a role).
  const publicMode = !authConfig.authEnabled || authConfig.publicMode;
  const showCannonball = publicMode || canAccessFeature('cannonball', 'read');
  const showServices = publicMode || canAccessFeature('services', 'read');

  useEffect(() => {
    if (activeTab === 'alerts' && unacknowledgedCount > 0) {
      markAllAsRead();
    }
  }, [activeTab, unacknowledgedCount, markAllAsRead]);

  return (
    <nav className={`v2-nav ${className}`} data-testid="v2-nav" aria-label="Primary">
      <div className="v2-nav__eyebrow">NAVIGATION</div>
      {visibleItems.map(({ id, icon, label }) => (
        <button
          key={id}
          type="button"
          className={`v2-nav__item ${activeTab === id ? 'v2-nav__item--active' : ''}`}
          onClick={() => onNavigate(id)}
          data-testid={`v2-nav-${id}`}
          aria-current={activeTab === id ? 'page' : undefined}
        >
          <Icon name={icon} size={17} strokeWidth={1.8} />
          {label}
          {id === 'alerts' && unacknowledgedCount > 0 && (
            <span
              className="v2-nav__badge"
              title={`${unacknowledgedCount} unread alert${unacknowledgedCount !== 1 ? 's' : ''}`}
            >
              {unacknowledgedCount > 99 ? '99+' : unacknowledgedCount}
            </span>
          )}
        </button>
      ))}

      {showCannonball && (
        <button
          type="button"
          className={`v2-nav__item v2-nav__item--cannonball ${
            activeTab === 'cannonball' ? 'v2-nav__item--active' : ''
          }`}
          onClick={() => onNavigate('cannonball')}
          data-testid="v2-nav-cannonball"
        >
          <Icon name="target" size={17} strokeWidth={1.8} />
          Cannonball
        </button>
      )}

      {showServices && (
        <div className="v2-nav__section">
          <button
            type="button"
            className="v2-nav__item"
            onClick={() => setServicesOpen(!servicesOpen)}
            aria-expanded={servicesOpen}
            data-testid="v2-nav-services"
          >
            <Icon name="rows" size={17} strokeWidth={1.8} />
            Services
            <Icon
              name="chevron-down"
              size={14}
              strokeWidth={2}
              className={`v2-nav__chevron ${servicesOpen ? 'v2-nav__chevron--open' : ''}`}
            />
          </button>
          {servicesOpen && (
            <div className="v2-nav__sub">
              {EXTERNAL_SERVICES.map(({ id, label, path, desc }) => (
                <a
                  key={id}
                  href={path}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="v2-nav__item"
                  title={desc}
                >
                  {label}
                  <Icon name="external-link" size={12} className="v2-nav__chevron" />
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="v2-nav__spacer" />
      <div className="v2-nav__live">
        <LiveIndicator connected={connected} />
        <span className="v2-nav__version">v2.5.0</span>
      </div>
      <div className="v2-nav__copyright">© CHAOS CORP</div>
    </nav>
  );
}
