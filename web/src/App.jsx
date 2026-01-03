import React, { useState, useEffect, useCallback } from 'react';
import { X, Menu } from 'lucide-react';
import './styles/index.css';

// Layout components
import { Sidebar, Header, SettingsModal } from './components/layout';

// View components
import { AircraftList, StatsView, HistoryView, AudioView, AlertsView, SystemView, SafetyEventPage } from './components/views';

// Map components
import { MapView } from './components/map';

// Aircraft components
import { AircraftDetailPage } from './components/aircraft/AircraftDetailPage';

// Hooks
import { useWebSocket } from './hooks';

// Utils
import { getConfig } from './utils';

// ============================================================================
// Hash Routing Utilities
// ============================================================================

const VALID_TABS = ['map', 'aircraft', 'stats', 'history', 'audio', 'alerts', 'system', 'airframe', 'event'];

function parseHash() {
  const hash = window.location.hash.slice(1); // Remove #
  if (!hash) return { tab: 'map', params: {} };

  const [path, queryString] = hash.split('?');
  const tab = VALID_TABS.includes(path) ? path : 'map';
  const params = {};

  if (queryString) {
    const searchParams = new URLSearchParams(queryString);
    for (const [key, value] of searchParams) {
      params[key] = value;
    }
  }

  return { tab, params };
}

function buildHash(tab, params = {}) {
  const paramEntries = Object.entries(params).filter(([, v]) => v != null && v !== '');
  if (paramEntries.length === 0) return `#${tab}`;
  const queryString = new URLSearchParams(paramEntries).toString();
  return `#${tab}?${queryString}`;
}

// ============================================================================
// Main App
// ============================================================================

export default function App() {
  const [hashState, setHashState] = useState(parseHash);
  const [config, setConfig] = useState(getConfig);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [status, setStatus] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState(0);
  const [selectedAircraftHex, setSelectedAircraftHex] = useState(null);
  const [targetSafetyEventId, setTargetSafetyEventId] = useState(null);

  const activeTab = hashState.tab;
  const hashParams = hashState.params;

  // Update hash when navigating
  const setActiveTab = useCallback((tab, params = {}) => {
    const newHash = buildHash(tab, params);
    window.location.hash = newHash;
  }, []);

  // Update hash params without changing tab
  const setHashParams = useCallback((params) => {
    const newHash = buildHash(hashState.tab, { ...hashState.params, ...params });
    window.location.hash = newHash;
  }, [hashState]);

  // Listen for hash changes (back/forward navigation, manual URL changes)
  useEffect(() => {
    const handleHashChange = () => {
      setHashState(parseHash());
    };

    window.addEventListener('hashchange', handleHashChange);

    // Set initial hash if empty
    if (!window.location.hash) {
      window.location.hash = '#map';
    }

    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

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

  // Fetch online users count more frequently
  useEffect(() => {
    const fetchOnlineUsers = async () => {
      try {
        const res = await fetch(`${config.apiBaseUrl}/api/v1/ws/status`);
        if (res.ok) {
          const data = await res.json();
          setOnlineUsers(data.subscribers || data.socketio_connections || 0);
        }
      } catch (err) {
        // Silently fail
      }
    };

    fetchOnlineUsers();
    const interval = setInterval(fetchOnlineUsers, 5000);
    return () => clearInterval(interval);
  }, [config.apiBaseUrl]);

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
          onlineUsers={onlineUsers}
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
              hashParams={hashParams}
              setHashParams={setHashParams}
            />
          )}
          {activeTab === 'aircraft' && <AircraftList aircraft={aircraft} onSelectAircraft={(hex) => setActiveTab('airframe', { icao: hex })} />}
          {activeTab === 'stats' && <StatsView apiBase={config.apiBaseUrl} onSelectAircraft={(hex) => setActiveTab('airframe', { icao: hex })} />}
          {activeTab === 'history' && (
            <HistoryView
              apiBase={config.apiBaseUrl}
              onSelectAircraft={(hex) => setActiveTab('airframe', { icao: hex })}
              onViewEvent={(eventId) => setActiveTab('event', { id: eventId })}
              targetEventId={targetSafetyEventId}
              onEventViewed={() => setTargetSafetyEventId(null)}
              hashParams={hashParams}
              setHashParams={setHashParams}
              wsRequest={wsRequest}
              wsConnected={connected}
            />
          )}
          {activeTab === 'audio' && <AudioView apiBase={config.apiBaseUrl} />}
          {activeTab === 'alerts' && <AlertsView apiBase={config.apiBaseUrl} />}
          {activeTab === 'system' && <SystemView apiBase={config.apiBaseUrl} wsRequest={wsRequest} wsConnected={connected} />}
          {activeTab === 'airframe' && (hashParams.icao || hashParams.call || hashParams.tail) && (() => {
            // Find aircraft by icao, callsign, or tail number
            const findAircraft = () => {
              if (hashParams.icao) {
                return aircraft.find(a => a.hex?.toLowerCase() === hashParams.icao.toLowerCase());
              }
              if (hashParams.call) {
                return aircraft.find(a => a.flight?.trim().toLowerCase() === hashParams.call.toLowerCase());
              }
              if (hashParams.tail) {
                return aircraft.find(a => a.r?.toLowerCase() === hashParams.tail.toLowerCase());
              }
              return null;
            };
            const foundAircraft = findAircraft();
            // Use the hex from found aircraft, or fall back to the icao param
            const hex = foundAircraft?.hex || hashParams.icao;

            return hex ? (
              <AircraftDetailPage
                hex={hex}
                apiUrl={config.apiBaseUrl}
                onClose={() => setActiveTab('map')}
                onSelectAircraft={(h) => setActiveTab('airframe', { icao: h })}
                onViewHistoryEvent={(eventId) => {
                  setTargetSafetyEventId(eventId);
                  setActiveTab('history', { data: 'safety' });
                }}
                onViewEvent={(eventId) => setActiveTab('event', { id: eventId })}
                aircraft={foundAircraft}
                feederLocation={status?.location}
                wsRequest={wsRequest}
                wsConnected={connected}
              />
            ) : (
              <div className="not-found-message" style={{ padding: '2rem', textAlign: 'center' }}>
                <p>Aircraft not found: {hashParams.call || hashParams.tail || hashParams.icao}</p>
                <button onClick={() => setActiveTab('map')} style={{ marginTop: '1rem', padding: '0.5rem 1rem', cursor: 'pointer' }}>
                  Return to Map
                </button>
              </div>
            );
          })()}
          {activeTab === 'event' && hashParams.id && (
            <SafetyEventPage
              eventId={hashParams.id}
              apiBase={config.apiBaseUrl}
              onClose={() => setActiveTab('map')}
              onSelectAircraft={(hex) => setActiveTab('airframe', { icao: hex })}
              wsRequest={wsRequest}
              wsConnected={connected}
            />
          )}
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
              onSelectAircraft={(hex) => {
                setSelectedAircraftHex(null);
                setActiveTab('airframe', { icao: hex });
              }}
              onViewHistoryEvent={(eventId) => {
                setSelectedAircraftHex(null);
                setTargetSafetyEventId(eventId);
                setActiveTab('history', { data: 'safety' });
              }}
              onViewEvent={(eventId) => {
                setSelectedAircraftHex(null);
                setActiveTab('event', { id: eventId });
              }}
              aircraft={aircraft.find(a => a.hex === selectedAircraftHex)}
              feederLocation={status?.location}
              wsRequest={wsRequest}
              wsConnected={connected}
            />
          </div>
        </div>
      )}
    </div>
  );
}
