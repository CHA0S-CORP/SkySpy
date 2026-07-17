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
  { id: 'history', icon: 'history', label: 'History', feature: 'history' },
  { id: 'audio', icon: 'wave', label: 'Radio', feature: 'audio' },
  { id: 'alerts', icon: 'bell', label: 'Alerts', feature: 'alerts' },
  { id: 'system', icon: 'activity', label: 'System', feature: 'system' },
  { id: 'assistant', icon: 'message', label: 'Assistant', feature: 'aircraft' },
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
  const { canAccessFeature, config: authConfig } = useAuth();

  const visibleItems = useMemo(() => {
    if (!authConfig.authEnabled || authConfig.publicMode) {
      return NAV_ITEMS.filter((item) => !item.permission);
    }
    return NAV_ITEMS.filter((item) => {
      if (item.permission) return canAccessFeature(item.permission.split('.')[0], 'write');
      if (!item.feature) return true;
      return canAccessFeature(item.feature, 'read');
    });
  }, [authConfig.authEnabled, authConfig.publicMode, canAccessFeature]);

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

      <div className="v2-nav__section">
        <button
          type="button"
          className="v2-nav__item"
          onClick={() => setServicesOpen(!servicesOpen)}
          aria-expanded={servicesOpen}
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

      <div className="v2-nav__spacer" />
      <div className="v2-nav__live">
        <LiveIndicator connected={connected} />
        <span className="v2-nav__version">v2.5.0</span>
      </div>
      <div className="v2-nav__copyright">© CHAOS CORP</div>
    </nav>
  );
}
