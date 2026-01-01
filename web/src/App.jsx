import React, { useState, useEffect } from 'react';
import { X, Menu } from 'lucide-react';
import './App.css';

// Layout components
import { Sidebar, Header, SettingsModal } from './components/layout';

// View components
import { AircraftList, StatsView, HistoryView, AudioView, AlertsView, SystemView } from './components/views';

// Map components
import { MapView } from './components/map';

// Aircraft components
import { AircraftDetailPage } from './components/aircraft/AircraftDetailPage';

// Hooks
import { useWebSocket } from './hooks';

// Utils
import { getConfig } from './utils';

// ============================================================================
// Main App
// ============================================================================

export default function App() {
  const [activeTab, setActiveTab] = useState('map');
  const [config, setConfig] = useState(getConfig);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [status, setStatus] = useState(null);
  const [selectedAircraftHex, setSelectedAircraftHex] = useState(null);
  const [targetSafetyEventId, setTargetSafetyEventId] = useState(null);

  const { aircraft, connected, stats, safetyEvents, request: wsRequest } = useWebSocket(true, config.apiBaseUrl, 'all');

  // Fetch status via Socket.IO or fallback to HTTP
  useEffect(() => {
    const fetchStatus = async () => {
      if (wsRequest && connected) {
        try {
          const data = await wsRequest('status', {});
          if (data && !data.error) setStatus(data);
        } catch (err) {
          console.log('App status WS request error:', err.message);
        }
      } else {
        try {
          const res = await fetch(`${config.apiBaseUrl}/api/v1/status`);
          if (res.ok) setStatus(await res.json());
        } catch (err) {
          console.log('App status HTTP fetch error:', err.message);
        }
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [wsRequest, connected, config.apiBaseUrl]);

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
          onlineUsers={status?.socketio_connections || status?.sse_subscribers || 0}
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
              wsRequest={wsRequest}
              wsConnected={connected}
              onViewHistoryEvent={(eventId) => {
                setTargetSafetyEventId(eventId);
                setActiveTab('history');
              }}
            />
          )}
          {activeTab === 'aircraft' && <AircraftList aircraft={aircraft} onSelectAircraft={setSelectedAircraftHex} />}
          {activeTab === 'stats' && <StatsView apiBase={config.apiBaseUrl} onSelectAircraft={setSelectedAircraftHex} />}
          {activeTab === 'history' && (
            <HistoryView
              apiBase={config.apiBaseUrl}
              onSelectAircraft={setSelectedAircraftHex}
              targetEventId={targetSafetyEventId}
              onEventViewed={() => setTargetSafetyEventId(null)}
            />
          )}
          {activeTab === 'audio' && <AudioView apiBase={config.apiBaseUrl} />}
          {activeTab === 'alerts' && <AlertsView apiBase={config.apiBaseUrl} />}
          {activeTab === 'system' && <SystemView apiBase={config.apiBaseUrl} wsRequest={wsRequest} wsConnected={connected} />}
        </div>
      </div>

      {showSettings && (
        <SettingsModal
          config={config}
          setConfig={setConfig}
          onClose={() => setShowSettings(false)}
        />
      )}

      {selectedAircraftHex && (
        <div className="aircraft-detail-overlay" onClick={() => setSelectedAircraftHex(null)}>
          <div className="aircraft-detail-modal" onClick={e => e.stopPropagation()}>
            <AircraftDetailPage
              hex={selectedAircraftHex}
              apiUrl={config.apiBaseUrl}
              onClose={() => setSelectedAircraftHex(null)}
              onSelectAircraft={setSelectedAircraftHex}
              onViewHistoryEvent={(eventId) => {
                setSelectedAircraftHex(null);
                setTargetSafetyEventId(eventId);
                setActiveTab('history');
              }}
              aircraft={aircraft.find(a => a.hex === selectedAircraftHex)}
              feederLocation={status?.location}
            />
          </div>
        </div>
      )}
    </div>
  );
}
