import React, { useState } from 'react';
import {
  Plane, Radio, Activity, Bell, BarChart3, History,
  Map as MapIcon, Radar, Layers, ExternalLink, LayoutDashboard,
  LineChart, MessageSquare, Ship, Database, ChevronDown,
  ChevronLeft, ChevronRight
} from 'lucide-react';

export function Sidebar({ activeTab, setActiveTab, connected, collapsed, setCollapsed }) {
  const [servicesExpanded, setServicesExpanded] = useState(false);
  
  const tabs = [
    { id: 'map', icon: Radar, label: 'Live Map' },
    { id: 'aircraft', icon: Plane, label: 'Aircraft List' },
    { id: 'stats', icon: BarChart3, label: 'Statistics' },
    { id: 'history', icon: History, label: 'History' },
    { id: 'alerts', icon: Bell, label: 'Alerts' },
    { id: 'system', icon: Activity, label: 'System' }
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

  return (
    <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="logo">
          <img src="/static/logo.png" alt="SkySpy" className="logo-image" />
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
        {tabs.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            className={`nav-item ${activeTab === id ? 'active' : ''}`}
            onClick={() => setActiveTab(id)}
            title={collapsed ? label : undefined}
          >
            <Icon size={18} />
            {!collapsed && <span>{label}</span>}
          </button>
        ))}

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
