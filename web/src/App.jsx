import React, { useState, useEffect, useCallback } from 'react';
import './styles/index.css';

// Layout components
import { SettingsModal } from './components/layout';
import { AppShell } from './components/v2/shell';
import { AircraftListScreen } from './components/v2/screens/list/AircraftListScreen';
import { SystemScreen } from './components/v2/screens/system/SystemScreen';
import { AssistantScreen } from './components/v2/screens/assistant/AssistantScreen';
import { SupportChatDock } from './components/v2/screens/assistant/SupportChatDock';
import { PageContextProvider } from './components/v2/screens/assistant/pageContext';
import { AlertsScreen } from './components/v2/screens/alerts/AlertsScreen';
import { RadioScreen } from './components/v2/screens/radio/RadioScreen';
import { HistoryScreen } from './components/v2/screens/history/HistoryScreen';
import { StatsScreen } from './components/v2/screens/stats/StatsScreen';
import { AdvancedAnalyticsScreen } from './components/v2/screens/analytics/AdvancedAnalyticsScreen';
import { AirframesScreen } from './components/v2/screens/airframes/AirframesScreen';

// View components
// Note: NotamsView and ArchiveView are now integrated into HistoryView
import { SafetyEventPage, AdminConfigView } from './components/views';
import { CannonballScreen } from './components/v2/screens/cannonball/CannonballScreen';

// Map components
import { MapView } from './components/map';

import { DetailScreen } from './components/v2/screens/detail/DetailScreen';
import { NotamDetailScreen } from './components/v2/screens/notam/NotamDetailScreen';
import { LiveMapView } from './components/livemap/LiveMapView';

// Auth components
import { LoginPage, ProtectedRoute } from './components/auth';
import { useAuth } from './contexts/AuthContext';

// Error handling
import { ErrorBoundary } from './components/common/ErrorBoundary';

// Hooks
import { useSocketIOData, useSocketIOPositions } from './hooks/socket';

// Utils
import { getConfig } from './utils';

// Helper to safely parse JSON from fetch response
const safeJson = async (res) => {
  if (!res.ok) return null;
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
};

// ============================================================================
// Hash Routing Utilities
// ============================================================================

const VALID_TABS = [
  'map',
  'aircraft',
  'stats',
  'analytics',
  'airframes',
  'history',
  'audio',
  'notams',
  'pireps',
  'archive',
  'alerts',
  'system',
  'assistant',
  'admin',
  'airframe',
  'event',
  'notam',
  'login',
  'cannonball',
];

// Legacy standalone routes folded into History tabs (kept for bookmarks)
const HISTORY_TAB_ALIASES = ['notams', 'pireps', 'archive'];

function parseHash() {
  const hash = window.location.hash.slice(1); // Remove #
  if (!hash) return { tab: 'map', params: {} };

  const [path, queryString] = hash.split('?');
  let tab = VALID_TABS.includes(path) ? path : 'map';
  const params = {};

  if (queryString) {
    const searchParams = new URLSearchParams(queryString);
    for (const [key, value] of searchParams) {
      params[key] = value;
    }
  }

  if (HISTORY_TAB_ALIASES.includes(tab)) {
    params.data = tab;
    tab = 'history';
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

  // Phase 5.1: Initialize pro mode theme CSS variables on app startup
  // (legacy [data-pro-theme]; coexists with the v2 [data-theme] until legacy UI retires)
  useEffect(() => {
    const savedTheme = localStorage.getItem('adsb-pro-theme') || 'cyan';
    document.documentElement.setAttribute('data-pro-theme', savedTheme);
  }, []);
  const [status, setStatus] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState(0);
  const [tailHexLookup, setTailHexLookup] = useState({}); // Registration → ICAO hex lookup cache
  const tailLookupInProgressRef = React.useRef(new Set()); // Track lookups in progress to avoid duplicates

  // Refs for tail lookup to avoid stale closures
  const apiBaseUrlRef = React.useRef(config.apiBaseUrl);

  // Auth context
  const {
    status: authStatus,
    isAuthenticated,
    config: authConfig,
    getAccessToken: _getAccessToken,
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
  const setHashParams = useCallback(
    (params) => {
      const newHash = buildHash(hashState.tab, { ...hashState.params, ...params });
      window.location.hash = newHash;
    },
    [hashState]
  );

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
    isReady,
    stats,
    safetyEvents,
    acarsMessages,
    antennaAnalytics,
    statsTick,
    request: wsRequest,
    getAirframeError,
    clearAirframeError,
  } = useSocketIOData(true, config.apiBaseUrl, 'all');

  // High-frequency position updates for smooth map rendering
  // Uses refs instead of state to avoid 60Hz re-renders
  const { positionsRef, connected: positionSocketConnected } = useSocketIOPositions(
    activeTab === 'map',
    config.apiBaseUrl,
    true,
    1000
  );

  // Backend reports feeder location as {latitude, longitude}; the UI
  // (Header, MapView) consumes {lat, lon}. Normalize once at the boundary -
  // without this the map/scope silently falls back to the default location.
  const normalizeStatus = (data) => {
    if (!data?.location) return data;
    const { latitude, longitude } = data.location;
    return {
      ...data,
      location: {
        ...data.location,
        lat: data.location.lat ?? latitude,
        lon: data.location.lon ?? longitude,
      },
    };
  };

  // Fetch status via WebSocket or fallback to HTTP
  useEffect(() => {
    const fetchStatus = async () => {
      if (wsRequest && connected) {
        try {
          const data = await wsRequest('status', {});
          if (data && !data.error) setStatus(normalizeStatus(data));
        } catch (err) {
          console.warn('App status WS request error:', err.message);
        }
      } else {
        try {
          const res = await fetch(`${config.apiBaseUrl}/api/v1/system/status`);
          const data = await safeJson(res);
          if (data) setStatus(normalizeStatus(data));
        } catch (err) {
          console.warn('App status HTTP fetch error:', err.message);
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

  // Keep ref in sync for tail lookup to avoid stale closures
  useEffect(() => {
    apiBaseUrlRef.current = config.apiBaseUrl;
  }, [config.apiBaseUrl]);

  // Lookup ICAO hex from tail/registration when on airframe page with tail param
  // Side effects run in the effect body (never inside a setState updater, which
  // must stay pure and can run twice under StrictMode)
  useEffect(() => {
    if (activeTab !== 'airframe' || !hashParams.tail) return;

    const tail = hashParams.tail.trim().toUpperCase();
    // Whitespace-only tail passes the truthy guard above but trims to '' -
    // don't issue a spurious /airframes/registration// lookup for it
    if (!tail) return;

    // Already cached or lookup in progress - nothing to do
    if (tail in tailHexLookup) return;
    if (tailLookupInProgressRef.current.has(tail)) return;

    // Check if live aircraft has this tail
    const liveAircraft = aircraft.find((a) => a.r?.toUpperCase() === tail);
    if (liveAircraft?.hex) {
      setTailHexLookup((prev) => (tail in prev ? prev : { ...prev, [tail]: liveAircraft.hex }));
      return;
    }

    // Mark lookup in progress and trigger async lookup
    tailLookupInProgressRef.current.add(tail);

    // Look up via the airframe registration endpoint, which resolves
    // registration → icao_hex. (The sightings API has no registration filter —
    // it would silently ignore the param and return an arbitrary aircraft.)
    // Uses a ref to read the current API base at execution time, avoiding stale closures
    const lookupTail = async () => {
      try {
        const currentApiBaseUrl = apiBaseUrlRef.current;
        const res = await fetch(
          `${currentApiBaseUrl}/api/v1/airframes/registration/${encodeURIComponent(tail)}/`
        );
        const data = await safeJson(res);
        if (data?.icao_hex) {
          setTailHexLookup((p) => ({ ...p, [tail]: data.icao_hex }));
        } else {
          setTailHexLookup((p) => ({ ...p, [tail]: null }));
        }
      } catch (err) {
        setTailHexLookup((p) => ({ ...p, [tail]: null }));
      } finally {
        tailLookupInProgressRef.current.delete(tail);
      }
    };

    lookupTail();
  }, [activeTab, hashParams.tail, aircraft, tailHexLookup]);

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
    <PageContextProvider tab={activeTab} params={hashParams}>
      <AppShell
        activeTab={activeTab}
        onNavigate={setActiveTab}
        connected={connected}
        aircraftCount={stats?.count ?? aircraft.length}
        location={status?.location}
        onlineUsers={onlineUsers}
        onOpenSettings={() => setShowSettings(true)}
      >
        <>
          {activeTab === 'map' &&
            (hashParams.legacy === '1' ? (
              <MapView
                aircraft={aircraft}
                config={config}
                setConfig={setConfig}
                feederLocation={status?.location}
                safetyEvents={safetyEvents}
                acarsMessages={acarsMessages}
                wsRequest={wsRequest}
                wsConnected={isReady}
                getAirframeError={getAirframeError}
                clearAirframeError={clearAirframeError}
                onViewHistoryEvent={() => setActiveTab('history', { data: 'safety' })}
                hashParams={hashParams}
                setHashParams={setHashParams}
                positionsRef={positionsRef}
                positionSocketConnected={positionSocketConnected}
              />
            ) : (
              <LiveMapView
                apiBase={config.apiBaseUrl}
                aircraft={aircraft}
                safetyEvents={safetyEvents}
                feederLocation={status?.location}
                positionsRef={positionsRef}
                wsRequest={wsRequest}
                wsConnected={isReady}
                onOpenFull={(hex) => setActiveTab('airframe', { icao: hex })}
              />
            ))}
          {activeTab === 'aircraft' && (
            <AircraftListScreen
              aircraft={aircraft}
              onSelectAircraft={(hex) => setActiveTab('airframe', { icao: hex })}
            />
          )}
          {activeTab === 'stats' && (
            <StatsScreen
              apiBase={config.apiBaseUrl}
              aircraft={aircraft}
              statsTick={statsTick}
              antennaAnalytics={antennaAnalytics}
              connected={isReady}
              onSelectAircraft={(hex) => setActiveTab('airframe', { icao: hex })}
            />
          )}
          {activeTab === 'analytics' && (
            <AdvancedAnalyticsScreen
              apiBase={config.apiBaseUrl}
              onSelectAircraft={(hex) => setActiveTab('airframe', { icao: hex })}
            />
          )}
          {activeTab === 'airframes' && <AirframesScreen />}
          {/* History view includes Sessions/Sightings/ACARS/Safety/NOTAMs/PIREPs/Archive tabs */}
          {activeTab === 'history' && (
            <HistoryScreen
              apiBase={config.apiBaseUrl}
              onSelectAircraft={(hex) => setActiveTab('airframe', { icao: hex })}
              onViewEvent={(eventId) => setActiveTab('event', { id: eventId })}
              onViewNotam={(notamId) => setActiveTab('notam', { id: notamId })}
              hashParams={hashParams}
            />
          )}
          {activeTab === 'audio' && (
            <RadioScreen
              apiBase={config.apiBaseUrl}
              aircraft={aircraft}
              onSelectAircraft={(hex, callsign) =>
                setActiveTab('airframe', { icao: hex, call: callsign })
              }
            />
          )}
          {activeTab === 'alerts' && (
            <AlertsScreen
              apiBase={config.apiBaseUrl}
              wsRequest={wsRequest}
              wsConnected={isReady}
              aircraft={aircraft}
            />
          )}
          {activeTab === 'system' && (
            <SystemScreen
              apiBase={config.apiBaseUrl}
              wsConnected={isReady}
              feederLocation={status?.location}
            />
          )}
          {activeTab === 'assistant' && <AssistantScreen />}
          {activeTab === 'admin' && <AdminConfigView apiBase={config.apiBaseUrl} />}
          {activeTab === 'airframe' &&
            (hashParams.icao || hashParams.call || hashParams.tail) &&
            (() => {
              // Find aircraft by icao, callsign, or tail number
              const findAircraft = () => {
                if (hashParams.icao) {
                  return aircraft.find(
                    (a) => a.hex?.toLowerCase() === hashParams.icao.toLowerCase()
                  );
                }
                if (hashParams.call) {
                  return aircraft.find(
                    (a) => a.flight?.trim().toLowerCase() === hashParams.call.toLowerCase()
                  );
                }
                if (hashParams.tail) {
                  return aircraft.find((a) => a.r?.toLowerCase() === hashParams.tail.toLowerCase());
                }
                return null;
              };
              const foundAircraft = findAircraft();

              // Use the hex from found aircraft, or fall back to the icao param, or lookup from tail
              const tailKey = hashParams.tail?.trim().toUpperCase();
              const lookedUpHex = tailKey ? tailHexLookup[tailKey] : null;
              const hex = foundAircraft?.hex || hashParams.icao || lookedUpHex;

              // Show loading state while looking up tail
              if (
                hashParams.tail &&
                !hashParams.icao &&
                !foundAircraft &&
                !(tailKey in tailHexLookup)
              ) {
                return (
                  <div
                    className="not-found-message"
                    style={{ padding: '2rem', textAlign: 'center' }}
                  >
                    <p>Looking up aircraft: {hashParams.tail}...</p>
                  </div>
                );
              }

              return hex ? (
                <DetailScreen
                  hex={hex}
                  apiBase={config.apiBaseUrl}
                  live={foundAircraft}
                  call={hashParams.call}
                  connected={isReady}
                  onClose={() => window.history.back()}
                  onViewEvent={(eventId) => setActiveTab('event', { id: eventId })}
                />
              ) : (
                <div className="not-found-message" style={{ padding: '2rem', textAlign: 'center' }}>
                  <p>Aircraft not found: {hashParams.call || hashParams.tail || hashParams.icao}</p>
                  <button
                    onClick={() => setActiveTab('map')}
                    style={{ marginTop: '1rem', padding: '0.5rem 1rem', cursor: 'pointer' }}
                  >
                    Return to Map
                  </button>
                </div>
              );
            })()}
          {activeTab === 'event' && hashParams.id && (
            <SafetyEventPage
              eventId={hashParams.id}
              apiBase={config.apiBaseUrl}
              onClose={() => window.history.back()}
              onSelectAircraft={(hex) => setActiveTab('airframe', { icao: hex })}
              wsRequest={wsRequest}
              wsConnected={isReady}
            />
          )}
          {activeTab === 'notam' && hashParams.id && (
            <NotamDetailScreen
              notamId={hashParams.id}
              apiBase={config.apiBaseUrl}
              onClose={() => window.history.back()}
            />
          )}
        </>
      </AppShell>

      {showSettings && (
        <SettingsModal
          config={config}
          setConfig={setConfig}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* App-wide support chat — available on every shell page except the full
          assistant screen itself. Sees the current page as context. */}
      {activeTab !== 'assistant' && (
        <SupportChatDock onExpand={() => setActiveTab('assistant')} />
      )}
    </PageContextProvider>
  );

  // Cannonball is a full-screen standalone mode (no shared chrome) — render it
  // outside the shell, like the login page. It still sits behind
  // ProtectedRoute: standalone means no chrome, not no auth.
  if (activeTab === 'cannonball') {
    const cannonball = (
      <CannonballScreen
        aircraft={aircraft}
        feederLocation={status?.location}
        onExit={() => setActiveTab('map')}
      />
    );
    return (
      <ErrorBoundary>
        {authConfig.authEnabled && !authConfig.publicMode ? (
          <ProtectedRoute>{cannonball}</ProtectedRoute>
        ) : (
          cannonball
        )}
      </ErrorBoundary>
    );
  }

  // Wrap with ProtectedRoute if auth is enabled
  if (authConfig.authEnabled && !authConfig.publicMode) {
    return (
      <ErrorBoundary>
        <ProtectedRoute>{mainContent}</ProtectedRoute>
      </ErrorBoundary>
    );
  }

  return <ErrorBoundary>{mainContent}</ErrorBoundary>;
}
