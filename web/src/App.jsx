import React, { useState } from 'react';
import { X, Menu } from 'lucide-react';
import './App.css';

// Import hooks
import { useSSE, useApi } from './hooks';

// Import utilities
import { getConfig, saveConfig } from './utils';

// Import components
import { Sidebar, Header, SettingsModal } from './components';
import { AircraftList, StatsView, HistoryView, AlertsView, SystemView } from './components/views';

// MapView is complex (~5000 lines) and would need further decomposition
// For now, import from the map module (to be created)
import { MapView } from './components/map';

export default function App() {
  const [activeTab, setActiveTab] = useState('map');
  const [config, setConfig] = useState(getConfig);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const { aircraft, connected, stats, safetyEvents } = useSSE(true, config.apiBaseUrl);
  const { data: status } = useApi('/api/v1/status', 30000, config.apiBaseUrl);

  return (
    <div className={`app ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${mobileMenuOpen ? 'mobile-menu-open' : ''}`}>
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={(tab) => { setActiveTab(tab); setMobileMenuOpen(false); }} 
        connected={connected}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
      />
      
      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div className="mobile-menu-overlay" onClick={() => setMobileMenuOpen(false)} />
      )}
      
      {/* Mobile menu toggle */}
      <button 
        className="mobile-menu-toggle"
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        aria-label="Toggle menu"
      >
        {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
      </button>
      
      <div className="main-content">
        <Header
          stats={stats}
          location={status?.location}
          config={config}
          setConfig={setConfig}
          setShowSettings={setShowSettings}
        />
        
        <div className="content-area">
          {activeTab === 'map' && (
            <MapView
              aircraft={aircraft}
              config={config}
              setConfig={setConfig}
              feederLocation={status?.location}
              safetyEvents={safetyEvents}
            />
          )}
          {activeTab === 'aircraft' && <AircraftList aircraft={aircraft} />}
          {activeTab === 'stats' && <StatsView apiBase={config.apiBaseUrl} />}
          {activeTab === 'history' && <HistoryView apiBase={config.apiBaseUrl} />}
          {activeTab === 'alerts' && <AlertsView apiBase={config.apiBaseUrl} />}
          {activeTab === 'system' && <SystemView apiBase={config.apiBaseUrl} />}
        </div>
      </div>

      {showSettings && (
        <SettingsModal
          config={config}
          setConfig={setConfig}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
