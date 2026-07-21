import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';

// Mock all heavy dependencies
vi.mock('./components/layout', () => ({
  SettingsModal: ({ onClose }) => (
    <div data-testid="settings-modal">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

// SupportChatDock pulls in useAssistantChat -> useQueryClient; App tests only
// exercise routing/wiring and don't wrap in a QueryClientProvider, so stub it.
vi.mock('./components/v2/screens/assistant/SupportChatDock', () => ({
  SupportChatDock: () => null,
}));

// Shell is unit-tested separately; App tests only exercise routing/wiring
vi.mock('./components/v2/shell', () => ({
  AppShell: ({
    activeTab,
    onNavigate,
    connected,
    aircraftCount,
    onlineUsers,
    onOpenSettings,
    children,
  }) => (
    <div
      data-testid="v2-app"
      className={`v2-app v2-shell view-${activeTab}`}
      data-active-tab={activeTab}
      data-connected={connected}
    >
      <button onClick={() => onNavigate('map')}>Map</button>
      <button onClick={() => onNavigate('aircraft')}>Aircraft</button>
      <button onClick={() => onNavigate('alerts')}>Alerts</button>
      <span data-testid="aircraft-count">{aircraftCount}</span>
      <span data-testid="online-users">{onlineUsers}</span>
      <button onClick={onOpenSettings}>Settings</button>
      {children}
    </div>
  ),
}));

vi.mock('./components/v2/screens/system/SystemScreen', () => ({
  SystemScreen: () => <div data-testid="v2-system">System Screen</div>,
}));

vi.mock('./components/v2/screens/alerts/AlertsScreen', () => ({
  AlertsScreen: () => <div data-testid="v2-alerts">Alerts Screen</div>,
}));

vi.mock('./components/v2/screens/radio/RadioScreen', () => ({
  RadioScreen: () => <div data-testid="v2-radio">Radio Screen</div>,
}));

vi.mock('./components/v2/screens/stats/StatsScreen', () => ({
  StatsScreen: () => <div data-testid="v2-stats">Stats Screen</div>,
}));

vi.mock('./components/v2/screens/history/HistoryScreen', () => ({
  HistoryScreen: ({ hashParams }) => (
    <div data-testid="v2-history" data-tab={hashParams?.data || 'sessions'}>
      History Screen
    </div>
  ),
}));

vi.mock('./components/views', () => ({
  AircraftList: () => <div data-testid="aircraft-list">Aircraft List</div>,
  StatsView: () => <div data-testid="stats-view">Stats View</div>,
  HistoryView: () => <div data-testid="history-view">History View</div>,
  AudioView: () => <div data-testid="audio-view">Audio View</div>,
  AlertsView: () => <div data-testid="alerts-view">Alerts View</div>,
  SystemView: () => <div data-testid="system-view">System View</div>,
  SafetyEventPage: () => <div data-testid="safety-event-page">Safety Event</div>,
  NotamsView: () => <div data-testid="notams-view">NOTAMs View</div>,
  ArchiveView: () => <div data-testid="archive-view">Archive View</div>,
  CannonballMode: () => <div data-testid="cannonball-mode">Cannonball Mode</div>,
  AdminConfigView: () => <div data-testid="admin-config-view">Admin Config</div>,
}));

vi.mock('./components/map', () => ({
  MapView: () => <div data-testid="map-view">Map View</div>,
}));

vi.mock('./components/livemap/LiveMapView', () => ({
  LiveMapView: () => <div data-testid="live-map-view">Live Map View</div>,
}));

vi.mock('./components/v2/screens/detail/DetailScreen', () => ({
  DetailScreen: ({ hex }) => <div data-testid="v2-detail">Aircraft {hex}</div>,
}));

vi.mock('./components/v2/screens/cannonball/CannonballScreen', () => ({
  CannonballScreen: () => <div data-testid="v2-cannonball">Cannonball Screen</div>,
}));

vi.mock('./components/auth', () => ({
  LoginPage: () => <div data-testid="login-page">Login</div>,
  ProtectedRoute: ({ children }) => <div data-testid="protected-route">{children}</div>,
}));

vi.mock('./components/common/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }) => <div data-testid="error-boundary">{children}</div>,
}));

vi.mock('./hooks/socket', () => ({
  useSocketIOData: vi.fn(() => ({
    aircraft: [],
    connected: true,
    isReady: true,
    stats: { count: 10 },
    safetyEvents: [],
    acarsMessages: [],
    antennaAnalytics: null,
    extendedStats: null,
    request: vi.fn(),
    getAirframeError: vi.fn(),
    clearAirframeError: vi.fn(),
  })),
  useSocketIOPositions: vi.fn(() => ({
    positionsRef: { current: new Map() },
    connected: true,
  })),
}));

vi.mock('./contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    status: 'anonymous',
    isAuthenticated: false,
    config: {
      authEnabled: false,
      publicMode: true,
    },
    getAccessToken: vi.fn(),
  })),
}));

vi.mock('./utils', () => ({
  getConfig: vi.fn(() => ({
    apiBaseUrl: '',
    mapMode: 'pro',
    mapDarkMode: true,
  })),
}));

describe('App', () => {
  let originalLocation;
  let originalFetch;

  beforeEach(() => {
    vi.clearAllMocks();

    // Store originals
    originalLocation = window.location;
    originalFetch = global.fetch;

    // Mock window.location
    delete window.location;
    window.location = {
      hash: '#map',
      href: 'http://localhost/#map',
    };

    // Mock fetch
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ location: { lat: 40, lon: -74 }, websocket_connections: 5 }),
    });
  });

  afterEach(() => {
    window.location = originalLocation;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should render the app shell', async () => {
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('v2-app')).toBeInTheDocument();
    });

    it('should render within error boundary', async () => {
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('error-boundary')).toBeInTheDocument();
    });

    it('should pass aircraft count to the shell', async () => {
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('aircraft-count')).toHaveTextContent('10');
    });

    it('should set default hash to #map if empty', async () => {
      window.location.hash = '';
      await act(async () => {
        render(<App />);
      });
      expect(window.location.hash).toBe('#map');
    });
  });

  describe('hash-based routing', () => {
    it('should render map view for #map', async () => {
      window.location.hash = '#map';
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('live-map-view')).toBeInTheDocument();
    });

    it('should render aircraft list for #aircraft', async () => {
      window.location.hash = '#aircraft';
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('v2-aircraft-list')).toBeInTheDocument();
    });

    it('should render alerts view for #alerts', async () => {
      window.location.hash = '#alerts';
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('v2-alerts')).toBeInTheDocument();
    });

    it('should render stats view for #stats', async () => {
      window.location.hash = '#stats';
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('v2-stats')).toBeInTheDocument();
    });

    it('should render history view for #history', async () => {
      window.location.hash = '#history';
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('v2-history')).toBeInTheDocument();
    });

    it('should render audio view for #audio', async () => {
      window.location.hash = '#audio';
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('v2-radio')).toBeInTheDocument();
    });

    it('should render system view for #system', async () => {
      window.location.hash = '#system';
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('v2-system')).toBeInTheDocument();
    });

    it('should render history view for #notams (notams is now part of history)', async () => {
      window.location.hash = '#notams';
      await act(async () => {
        render(<App />);
      });
      // NOTAMs are folded into the History screen's tabs
      const history = screen.getByTestId('v2-history');
      expect(history).toBeInTheDocument();
      expect(history).toHaveAttribute('data-tab', 'notams');
    });

    it('should render history view for #archive (archive is now part of history)', async () => {
      window.location.hash = '#archive';
      await act(async () => {
        render(<App />);
      });
      // Archive is folded into the History screen's tabs
      const history = screen.getByTestId('v2-history');
      expect(history).toBeInTheDocument();
      expect(history).toHaveAttribute('data-tab', 'archive');
    });

    it('should render admin config for #admin', async () => {
      window.location.hash = '#admin';
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('admin-config-view')).toBeInTheDocument();
    });

    it('should render cannonball full-screen for #cannonball', async () => {
      window.location.hash = '#cannonball';
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('v2-cannonball')).toBeInTheDocument();
      // full-screen mode renders outside the shell
      expect(screen.queryByTestId('v2-app')).not.toBeInTheDocument();
    });

    it('should fallback to map for invalid hash', async () => {
      window.location.hash = '#invalid';
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('live-map-view')).toBeInTheDocument();
    });
  });

  describe('navigation via shell', () => {
    it('should update hash when nav is clicked', async () => {
      window.location.hash = '#map';
      await act(async () => {
        render(<App />);
      });

      expect(screen.getByTestId('live-map-view')).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByText('Aircraft'));
      });

      expect(window.location.hash).toBe('#aircraft');
    });
  });

  describe('settings modal', () => {
    it('should show settings modal when triggered', async () => {
      window.location.hash = '#map';
      await act(async () => {
        render(<App />);
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Settings'));
      });

      expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
    });

    it('should close settings modal when close is clicked', async () => {
      window.location.hash = '#map';
      await act(async () => {
        render(<App />);
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Settings'));
      });

      expect(screen.getByTestId('settings-modal')).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByText('Close'));
      });

      expect(screen.queryByTestId('settings-modal')).not.toBeInTheDocument();
    });
  });

  describe('login page', () => {
    it('should render login page for #login', async () => {
      window.location.hash = '#login';
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('login-page')).toBeInTheDocument();
    });

    it('should redirect to map after login when authenticated', async () => {
      const { useAuth } = await import('./contexts/AuthContext');
      useAuth.mockReturnValue({
        status: 'authenticated',
        isAuthenticated: true,
        config: { authEnabled: true, publicMode: false },
        getAccessToken: vi.fn(),
      });

      window.location.hash = '#login';
      await act(async () => {
        render(<App />);
      });

      expect(window.location.hash).toBe('#map');
    });
  });

  describe('loading state', () => {
    it('should show loading spinner while auth is loading', async () => {
      const { useAuth } = await import('./contexts/AuthContext');
      useAuth.mockReturnValue({
        status: 'loading',
        isAuthenticated: false,
        config: { authEnabled: true, publicMode: false },
        getAccessToken: vi.fn(),
      });

      window.location.hash = '#map';
      await act(async () => {
        render(<App />);
      });

      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });
  });

  describe('protected routes', () => {
    it('should wrap content with ProtectedRoute when auth is enabled', async () => {
      const { useAuth } = await import('./contexts/AuthContext');
      useAuth.mockReturnValue({
        status: 'authenticated',
        isAuthenticated: true,
        config: { authEnabled: true, publicMode: false },
        getAccessToken: vi.fn(),
      });

      window.location.hash = '#map';
      await act(async () => {
        render(<App />);
      });

      expect(screen.getByTestId('protected-route')).toBeInTheDocument();
    });

    it('should not wrap with ProtectedRoute in public mode', async () => {
      const { useAuth } = await import('./contexts/AuthContext');
      useAuth.mockReturnValue({
        status: 'anonymous',
        isAuthenticated: false,
        config: { authEnabled: true, publicMode: true },
        getAccessToken: vi.fn(),
      });

      window.location.hash = '#map';
      await act(async () => {
        render(<App />);
      });

      expect(screen.queryByTestId('protected-route')).not.toBeInTheDocument();
    });
  });

  describe('view class on shell', () => {
    it('should add view-map class for map view', async () => {
      window.location.hash = '#map';
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('v2-app')).toHaveClass('view-map');
    });

    it('should add view-aircraft class for aircraft view', async () => {
      window.location.hash = '#aircraft';
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('v2-app')).toHaveClass('view-aircraft');
    });

    it('should add view-alerts class for alerts view', async () => {
      window.location.hash = '#alerts';
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('v2-app')).toHaveClass('view-alerts');
    });
  });

  describe('hash parameters', () => {
    it('should parse hash parameters for airframe view', async () => {
      window.location.hash = '#airframe?icao=ABC123';
      await act(async () => {
        render(<App />);
      });
      // Should attempt to render aircraft detail
      // Note: may show "not found" since aircraft array is empty
      expect(screen.getByTestId('v2-app')).toBeInTheDocument();
    });

    it('should parse event id parameter', async () => {
      window.location.hash = '#event?id=123';
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('safety-event-page')).toBeInTheDocument();
    });

    it('should resolve tail to hex via the airframe registration endpoint', async () => {
      global.fetch = vi.fn((url) => {
        if (String(url).includes('/api/v1/airframes/registration/')) {
          return Promise.resolve({
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: () => Promise.resolve({ icao_hex: 'ABC123', registration: 'N12345' }),
          });
        }
        return Promise.resolve({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({}),
        });
      });

      window.location.hash = '#airframe?tail=N12345';
      // The airframe detail view uses react-query; wrap in a provider (as
      // production does via main.jsx) so DetailScreen doesn't throw here.
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      await act(async () => {
        render(
          <QueryClientProvider client={qc}>
            <App />
          </QueryClientProvider>
        );
      });

      await waitFor(() => {
        // Match the URL regardless of any options arg the fetch wrapper adds.
        expect(
          global.fetch.mock.calls.some(
            ([u]) => String(u) === '/api/v1/airframes/registration/N12345/'
          )
        ).toBe(true);
      });

      // Must NOT use the sightings API - it has no registration filter and
      // would silently return an arbitrary aircraft's sighting
      const sightingsCalls = global.fetch.mock.calls.filter(([url]) =>
        String(url).includes('/api/v1/sightings')
      );
      expect(sightingsCalls).toHaveLength(0);

      // The resolved hex should be passed through to the detail page
      await waitFor(() => {
        expect(screen.getByTestId('v2-detail')).toHaveTextContent('Aircraft ABC123');
      });
    });
  });

  describe('connection status', () => {
    it('should pass connected status to the shell', async () => {
      window.location.hash = '#map';
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('v2-app')).toHaveAttribute('data-connected', 'true');
    });

    it('should show disconnected when socket is not connected', async () => {
      const { useSocketIOData } = await import('./hooks/socket');
      useSocketIOData.mockReturnValue({
        aircraft: [],
        connected: false,
        isReady: false,
        stats: { count: 0 },
        safetyEvents: [],
        acarsMessages: [],
        antennaAnalytics: null,
        extendedStats: null,
        request: vi.fn(),
        getAirframeError: vi.fn(),
        clearAirframeError: vi.fn(),
      });

      window.location.hash = '#map';
      await act(async () => {
        render(<App />);
      });

      expect(screen.getByTestId('v2-app')).toHaveAttribute('data-connected', 'false');
    });
  });
});
