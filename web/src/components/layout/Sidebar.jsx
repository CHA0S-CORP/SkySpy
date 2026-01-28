import { useState, useEffect, useMemo } from 'react';
import {
  Plane, Radio, Bell, Activity, BarChart3, History,
  Map as MapIcon, Radar, ChevronLeft, ChevronRight, ChevronDown,
  Layers, ExternalLink, Ship, LineChart, MessageSquare,
  LayoutDashboard, Database, Clock, Settings, FileWarning, Archive,
  Crosshair
} from 'lucide-react';
import { useAlertNotifications } from '../../hooks/useAlertNotifications';
import { useAuth } from '../../contexts/AuthContext';

// Tab definitions with feature permissions
const tabs = [
  { id: 'map', icon: Radar, label: 'Live Map', feature: 'aircraft' },
  { id: 'aircraft', icon: Plane, label: 'Aircraft List', feature: 'aircraft' },
  { id: 'stats', icon: BarChart3, label: 'Statistics', feature: 'aircraft' },
  { id: 'history', icon: History, label: 'History', feature: 'history' },
  { id: 'audio', icon: Radio, label: 'Radio', feature: 'audio' },
  { id: 'notams', icon: FileWarning, label: 'NOTAMs', feature: 'aircraft' },
  { id: 'archive', icon: Archive, label: 'Archive', feature: 'history' },
  { id: 'alerts', icon: Bell, label: 'Alerts', feature: 'alerts' },
  { id: 'system', icon: Activity, label: 'System', feature: 'system' }
];

const externalServices = [
  { id: 'tar1090', icon: MapIcon, label: 'tar1090', path: '/tar1090/', desc: 'ADS-B Map' },
  { id: 'graphs', icon: LineChart, label: 'Graphs1090', path: '/graphs1090/', desc: 'Statistics' },
  { id: 'piaware', icon: Plane, label: 'PiAware', path: '/piaware/', desc: 'FlightAware' },
  { id: 'uat', icon: Radio, label: 'UAT 978', path: '/uat/', desc: 'UAT Receiver' },
  { id: 'acars', icon: MessageSquare, label: 'ACARS', path: '/acars/', desc: 'ACARS Hub' },
  { id: 'ais', icon: Ship, label: 'AIS', path: '/ais/', desc: 'Ship Tracking' },
  { id: 'grafana', icon: LayoutDashboard, label: 'Grafana', path: '/grafana/', desc: 'Dashboards' },
  { id: 'prometheus', icon: Database, label: 'Prometheus', path: '/prometheus/', desc: 'Metrics' },
];

export function Sidebar({ activeTab, setActiveTab, connected, collapsed, setCollapsed, stats, onOpenSettings, onLaunchCannonball }) {
  const [servicesExpanded, setServicesExpanded] = useState(false);
  const [time, setTime] = useState(new Date());
  const { unacknowledgedCount, markAllAsRead } = useAlertNotifications();
  const { canAccessFeature, config: authConfig } = useAuth();

  // Filter tabs based on permissions
  const visibleTabs = useMemo(() => {
    // If auth is disabled or public mode, show all tabs
    if (!authConfig.authEnabled || authConfig.publicMode) {
      return tabs;
    }

    // Filter based on feature access
    return tabs.filter(tab => {
      if (!tab.feature) return true;
      return canAccessFeature(tab.feature, 'read');
    });
  }, [authConfig.authEnabled, authConfig.publicMode, canAccessFeature]);

  // Mark alerts as read when user navigates to alerts tab
  useEffect(() => {
    if (activeTab === 'alerts' && unacknowledgedCount > 0) {
      markAllAsRead();
    }
  }, [activeTab, unacknowledgedCount, markAllAsRead]);

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      {/* Mobile Stats Bar - shown only on mobile */}
      <div className="mobile-sidebar-stats">
        <div className="mobile-stat">
          <Plane size={14} />
          <span>{stats?.count || 0}</span>
        </div>
        <div className="mobile-stat">
          <Clock size={14} />
          <span>{time.toISOString().slice(11, 19)}Z</span>
        </div>
        <button className="mobile-settings-btn" onClick={onOpenSettings} title="Settings">
          <Settings size={16} />
        </button>
      </div>

      <div className="sidebar-header">
        <div className="logo">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="SkySpy" className="logo-image" />
          {!collapsed && (
            <span className="logo-text">
              <span className="logo-sky">Sky</span>
              <span className="logo-spy">Spy</span>
            </span>
          )}
        </div>
      </div>

      <button
        className="sidebar-toggle"
        onClick={() => setCollapsed(!collapsed)}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>

      <nav className="sidebar-nav">
        {visibleTabs.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            className={`nav-item ${activeTab === id ? 'active' : ''}`}
            onClick={() => setActiveTab(id)}
            title={collapsed ? label : undefined}
          >
            <Icon size={18} />
            {!collapsed && <span>{label}</span>}
            {id === 'alerts' && unacknowledgedCount > 0 && (
              <span className="nav-badge" title={`${unacknowledgedCount} unread alert${unacknowledgedCount !== 1 ? 's' : ''}`}>
                {unacknowledgedCount > 99 ? '99+' : unacknowledgedCount}
              </span>
            )}
          </button>
        ))}

        {/* Cannonball Mode Button */}
        {onLaunchCannonball && (
          <button
            className="nav-item cannonball-btn"
            onClick={onLaunchCannonball}
            title={collapsed ? 'Cannonball Mode' : undefined}
          >
            <Crosshair size={18} />
            {!collapsed && <span>Cannonball</span>}
          </button>
        )}

        <div className="nav-divider" />

        <button
          className={`nav-item services-toggle ${servicesExpanded ? 'expanded' : ''}`}
          onClick={() => setServicesExpanded(!servicesExpanded)}
          title={collapsed ? 'External Services' : undefined}
        >
          <Layers size={18} />
          {!collapsed && (
            <>
              <span>Services</span>
              <ChevronDown size={14} className={`toggle-icon ${servicesExpanded ? 'rotated' : ''}`} />
            </>
          )}
        </button>

        {(servicesExpanded || collapsed) && (
          <div className={`services-list ${collapsed ? 'collapsed-services' : ''}`}>
            {externalServices.map(({ id, icon: Icon, label, path, desc }) => (
              <a
                key={id}
                href={path}
                target="_blank"
                rel="noopener noreferrer"
                className="nav-item service-link"
                title={collapsed ? `${label} - ${desc}` : desc}
              >
                <Icon size={16} />
                {!collapsed && <span>{label}</span>}
                {!collapsed && <ExternalLink size={12} className="external-icon" />}
              </a>
            ))}
          </div>
        )}
      </nav>

      <div className="sidebar-footer">
        {!collapsed ? (
          <>
            <div className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
              <span className="status-dot" />
              <span>{connected ? 'LIVE' : 'OFFLINE'}</span>
            </div>
            <div className="footer-info">
              <div className="version">v2.5.0</div>
              <div className="copyright">© CHAOS.CORP</div>
            </div>
          </>
        ) : (
          <>
            <div className={`connection-dot ${connected ? 'connected' : 'disconnected'}`} title={connected ? 'Connected' : 'Disconnected'}>
              <span className="status-dot" />
            </div>
            <div className="version-mini">2.5</div>
          </>
        )}
      </div>
    </div>
  );
}

export default Sidebar;
