import React, { useState, useEffect, useCallback } from 'react';
import { X, Menu } from 'lucide-react';
import './styles/index.css';

// Layout components
import { Sidebar, Header, SettingsModal } from './components/layout';

// View components
import { AircraftList, StatsView, HistoryView, AudioView, AlertsView, SystemView, SafetyEventPage, NotamsView, ArchiveView, CannonballMode } from './components/views';

// Map components
import { MapView } from './components/map';

// Aircraft components
import { AircraftDetailPage } from './components/aircraft/AircraftDetailPage';

// Auth components
import { LoginPage, ProtectedRoute } from './components/auth';
import { useAuth } from './contexts/AuthContext';

// Hooks
import { useChannelsSocket } from './hooks/useChannelsSocket';
import { usePositionChannels } from './hooks/usePositionChannels';

// Utils
import { getConfig } from './utils';

// Helper to safely parse JSON from fetch response
const safeJson = async (res) => {
  if (!res.ok) return null;
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) return null;
  try { return await res.json(); } catch { return null; }
};

// ============================================================================
// Hash Routing Utilities
// ============================================================================

const VALID_TABS = ['map', 'aircraft', 'stats', 'history', 'audio', 'notams', 'archive', 'alerts', 'system', 'airframe', 'event', 'login'];

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
  const [tailHexLookup, setTailHexLookup] = useState({}); // Registration → ICAO hex lookup cache
  const [showCannonball, setShowCannonball] = useState(false);

  // Auth context
  const {
    status: authStatus,
    isAuthenticated,
    config: authConfig,
    getAccessToken,
  } = useAuth();

  const activeTab = hashState.tab;
  const hashParams = hashState.params;

  // Redirect to map after successful login
  useEffect(() => {
    if (activeTab === 'login' && isAuthenticated) {
      window.location.hash = '#map';
    }
  }, [activeTab, isAuthenticated]);

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

  const {
    aircraft,
    connected,
    stats,
    safetyEvents,
    acarsMessages,
    antennaAnalytics,
    request: wsRequest,
    getAirframeError,
    clearAirframeError,
  } = useChannelsSocket(true, config.apiBaseUrl, 'all');

  // High-frequency position updates for smooth map rendering
  // Uses refs instead of state to avoid 60Hz re-renders
  const {
    positionsRef,
    connected: positionSocketConnected,
  } = usePositionChannels(activeTab === 'map', config.apiBaseUrl, true, 1000);

  // Fetch status via WebSocket or fallback to HTTP
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
          const res = await fetch(`${config.apiBaseUrl}/api/v1/system/status`);
          const data = await safeJson(res);
          if (data) setStatus(data);
        } catch (err) {
          console.log('App status HTTP fetch error:', err.message);
        }
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [wsRequest, connected, config.apiBaseUrl]);

  // Fetch online users count via WebSocket (with HTTP fallback)
  useEffect(() => {
    const fetchOnlineUsers = async () => {
      // Try WebSocket first if connected
      if (wsRequest && connected) {
        try {
          const data = await wsRequest('ws-status', {});
          if (data && !data.error) {
            setOnlineUsers(data.subscribers || data.socketio_connections || 0);
            return;
          }
        } catch (err) {
          // Fall through to HTTP
        }
      }

      // HTTP fallback - use system status endpoint
      try {
        const res = await fetch(`${config.apiBaseUrl}/api/v1/system/status`);
        const data = await safeJson(res);
        if (data) setOnlineUsers(data.websocket_connections || data.subscribers || 0);
      } catch (err) {
        // Silently fail
      }
    };

    fetchOnlineUsers();
    const interval = setInterval(fetchOnlineUsers, 30000); // Reduced from 5s - online count doesn't need frequent updates
    return () => clearInterval(interval);
  }, [config.apiBaseUrl, wsRequest, connected]);

  // Lookup ICAO hex from tail/registration when on airframe page with tail param
  useEffect(() => {
    if (activeTab !== 'airframe' || !hashParams.tail) return;

    const tail = hashParams.tail.trim().toUpperCase();

    // Check if already in cache
    if (tail in tailHexLookup) return;

    // Check if live aircraft has this tail
    const liveAircraft = aircraft.find(a => a.r?.toUpperCase() === tail);
    if (liveAircraft?.hex) {
      setTailHexLookup(prev => ({ ...prev, [tail]: liveAircraft.hex }));
      return;
    }

    // Look up from sightings API (prefer WebSocket)
    const lookupTail = async () => {
      try {
        let data;
        if (wsRequest && connected) {
          const result = await wsRequest('sightings', { registration: tail, hours: 168, limit: 1 });
          if (result && (result.sightings || result.results)) {
            data = result;
          } else {
            throw new Error('Invalid sightings response');
          }
        } else {
          // Django API uses /api/v1/sightings (was /api/v1/history/sightings)
          const res = await fetch(`${config.apiBaseUrl}/api/v1/sightings?registration=${encodeURIComponent(tail)}&hours=168&limit=1`);
          data = await safeJson(res);
          if (!data) throw new Error('HTTP request failed');
        }
        const sightings = data?.sightings || data?.results || [];
        if (sightings.length > 0 && sightings[0].icao_hex) {
          setTailHexLookup(prev => ({ ...prev, [tail]: sightings[0].icao_hex }));
        } else {
          setTailHexLookup(prev => ({ ...prev, [tail]: null }));
        }
      } catch (err) {
        setTailHexLookup(prev => ({ ...prev, [tail]: null }));
      }
    };

    lookupTail();
  }, [activeTab, hashParams.tail, aircraft, config.apiBaseUrl, tailHexLookup, wsRequest, connected]);

  // Show login page if on login tab
  if (activeTab === 'login') {
    return (
      <div className="app view-login">
        <LoginPage />
      </div>
    );
  }

  // Show loading while auth is initializing
  if (authStatus === 'loading') {
    return (
      <div className="app view-loading">
        <div className="auth-loading">
          <div className="spinner" />
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  // Wrap main content with ProtectedRoute for auth-required modes
  const mainContent = (
    <div className={`app ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${mobileMenuOpen ? 'mobile-menu-open' : ''} view-${activeTab}`}>
      <Sidebar
        activeTab={activeTab}
        setActiveTab={(tab) => { setActiveTab(tab); setMobileMenuOpen(false); }}
        connected={connected}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
        stats={stats}
        onOpenSettings={() => setShowSettings(true)}
        onLaunchCannonball={() => setShowCannonball(true)}
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
              acarsMessages={acarsMessages}
              wsRequest={wsRequest}
              wsConnected={connected}
              getAirframeError={getAirframeError}
              clearAirframeError={clearAirframeError}
              onViewHistoryEvent={(eventId) => {
                setTargetSafetyEventId(eventId);
                setActiveTab('history');
              }}
              hashParams={hashParams}
              setHashParams={setHashParams}
              positionsRef={positionsRef}
              positionSocketConnected={positionSocketConnected}
            />
          )}
          {activeTab === 'aircraft' && <AircraftList aircraft={aircraft} onSelectAircraft={(hex) => setActiveTab('airframe', { icao: hex })} />}
          {activeTab === 'stats' && <StatsView apiBase={config.apiBaseUrl} onSelectAircraft={(hex) => setActiveTab('airframe', { icao: hex })} wsRequest={wsRequest} wsConnected={connected} aircraft={aircraft} stats={stats} antennaAnalytics={antennaAnalytics} />}
          {activeTab === 'history' && (
            <HistoryView
              apiBase={config.apiBaseUrl}
              onSelectAircraft={(hex) => setActiveTab('airframe', { icao: hex })}
              onSelectByTail={(tail) => setActiveTab('airframe', { tail })}
              onViewEvent={(eventId) => setActiveTab('event', { id: eventId })}
              targetEventId={targetSafetyEventId}
              onEventViewed={() => setTargetSafetyEventId(null)}
              hashParams={hashParams}
              setHashParams={setHashParams}
              wsRequest={wsRequest}
              wsConnected={connected}
            />
          )}
          {activeTab === 'audio' && <AudioView apiBase={config.apiBaseUrl} onSelectAircraft={(hex, callsign) => setActiveTab('airframe', { icao: hex, call: callsign })} />}
          {activeTab === 'notams' && <NotamsView apiBase={config.apiBaseUrl} />}
          {activeTab === 'archive' && <ArchiveView apiBase={config.apiBaseUrl} hashParams={hashParams} setHashParams={setHashParams} />}
          {activeTab === 'alerts' && <AlertsView apiBase={config.apiBaseUrl} wsRequest={wsRequest} wsConnected={connected} aircraft={aircraft} feederLocation={status?.location} onLaunchCannonball={() => setShowCannonball(true)} />}
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

            // Use the hex from found aircraft, or fall back to the icao param, or lookup from tail
            const tailKey = hashParams.tail?.trim().toUpperCase();
            const lookedUpHex = tailKey ? tailHexLookup[tailKey] : null;
            const hex = foundAircraft?.hex || hashParams.icao || lookedUpHex;

            // Show loading state while looking up tail
            if (hashParams.tail && !hashParams.icao && !foundAircraft && !(tailKey in tailHexLookup)) {
              return (
                <div className="not-found-message" style={{ padding: '2rem', textAlign: 'center' }}>
                  <p>Looking up aircraft: {hashParams.tail}...</p>
                </div>
              );
            }

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
                initialTab={hashParams.tab}
                onTabChange={(tab) => setHashParams({ tab })}
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

      {showCannonball && (
        <CannonballMode
          apiBase={config.apiBaseUrl}
          onExit={() => setShowCannonball(false)}
          aircraft={aircraft}
        />
      )}
    </div>
  );

  // Wrap with ProtectedRoute if auth is enabled
  if (authConfig.authEnabled && !authConfig.publicMode) {
    return <ProtectedRoute>{mainContent}</ProtectedRoute>;
  }

  return mainContent;
}
