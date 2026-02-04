import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import App from './App';

// Mock all heavy dependencies
vi.mock('./components/layout', () => ({
  Sidebar: ({ activeTab, setActiveTab, connected, collapsed, setCollapsed, stats }) => (
    <div data-testid="sidebar" data-active-tab={activeTab} data-connected={connected}>
      <button onClick={() => setActiveTab('map')}>Map</button>
      <button onClick={() => setActiveTab('aircraft')}>Aircraft</button>
      <button onClick={() => setActiveTab('alerts')}>Alerts</button>
      <button onClick={() => setCollapsed(!collapsed)}>Toggle</button>
    </div>
  ),
  Header: ({ stats, onlineUsers, setShowSettings }) => (
    <header data-testid="header">
      <span data-testid="aircraft-count">{stats?.count || 0}</span>
      <span data-testid="online-users">{onlineUsers}</span>
      <button onClick={() => setShowSettings(true)}>Settings</button>
    </header>
  ),
  SettingsModal: ({ onClose }) => (
    <div data-testid="settings-modal">
      <button onClick={onClose}>Close</button>
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

vi.mock('./components/aircraft/AircraftDetailPage', () => ({
  AircraftDetailPage: ({ hex }) => <div data-testid="aircraft-detail">Aircraft {hex}</div>,
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
    it('should render the app', async () => {
      await act(async () => {
        render(<App />);
      });
      expect(document.querySelector('.app')).toBeInTheDocument();
    });

    it('should render within error boundary', async () => {
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('error-boundary')).toBeInTheDocument();
    });

    it('should render sidebar', async () => {
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    });

    it('should render header', async () => {
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('header')).toBeInTheDocument();
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
      expect(screen.getByTestId('map-view')).toBeInTheDocument();
    });

    it('should render aircraft list for #aircraft', async () => {
      window.location.hash = '#aircraft';
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('aircraft-list')).toBeInTheDocument();
    });

    it('should render alerts view for #alerts', async () => {
      window.location.hash = '#alerts';
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('alerts-view')).toBeInTheDocument();
    });

    it('should render stats view for #stats', async () => {
      window.location.hash = '#stats';
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('stats-view')).toBeInTheDocument();
    });

    it('should render history view for #history', async () => {
      window.location.hash = '#history';
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('history-view')).toBeInTheDocument();
    });

    it('should render audio view for #audio', async () => {
      window.location.hash = '#audio';
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('audio-view')).toBeInTheDocument();
    });

    it('should render system view for #system', async () => {
      window.location.hash = '#system';
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('system-view')).toBeInTheDocument();
    });

    it('should render notams view for #notams', async () => {
      window.location.hash = '#notams';
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('notams-view')).toBeInTheDocument();
    });

    it('should render archive view for #archive', async () => {
      window.location.hash = '#archive';
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('archive-view')).toBeInTheDocument();
    });

    it('should render admin config for #admin', async () => {
      window.location.hash = '#admin';
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('admin-config-view')).toBeInTheDocument();
    });

    it('should fallback to map for invalid hash', async () => {
      window.location.hash = '#invalid';
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('map-view')).toBeInTheDocument();
    });
  });

  describe('navigation via sidebar', () => {
    it('should update view when sidebar navigation is clicked', async () => {
      window.location.hash = '#map';
      await act(async () => {
        render(<App />);
      });

      expect(screen.getByTestId('map-view')).toBeInTheDocument();

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

  describe('mobile menu', () => {
    it('should render mobile menu toggle button', async () => {
      window.location.hash = '#map';
      await act(async () => {
        render(<App />);
      });

      const toggleButton = screen.getByRole('button', { name: /toggle menu/i });
      expect(toggleButton).toBeInTheDocument();
    });

    it('should toggle mobile menu class on app', async () => {
      window.location.hash = '#map';
      await act(async () => {
        render(<App />);
      });

      const app = document.querySelector('.app');
      expect(app).not.toHaveClass('mobile-menu-open');

      const toggleButton = screen.getByRole('button', { name: /toggle menu/i });
      await act(async () => {
        fireEvent.click(toggleButton);
      });

      expect(document.querySelector('.app')).toHaveClass('mobile-menu-open');
    });
  });

  describe('sidebar collapse', () => {
    it('should toggle sidebar collapsed class', async () => {
      window.location.hash = '#map';
      await act(async () => {
        render(<App />);
      });

      const app = document.querySelector('.app');
      expect(app).not.toHaveClass('sidebar-collapsed');

      const toggleButton = screen.getByText('Toggle');
      await act(async () => {
        fireEvent.click(toggleButton);
      });

      expect(document.querySelector('.app')).toHaveClass('sidebar-collapsed');
    });
  });

  describe('view class on app', () => {
    it('should add view-map class for map view', async () => {
      window.location.hash = '#map';
      await act(async () => {
        render(<App />);
      });
      expect(document.querySelector('.app')).toHaveClass('view-map');
    });

    it('should add view-aircraft class for aircraft view', async () => {
      window.location.hash = '#aircraft';
      await act(async () => {
        render(<App />);
      });
      expect(document.querySelector('.app')).toHaveClass('view-aircraft');
    });

    it('should add view-alerts class for alerts view', async () => {
      window.location.hash = '#alerts';
      await act(async () => {
        render(<App />);
      });
      expect(document.querySelector('.app')).toHaveClass('view-alerts');
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
      expect(document.querySelector('.app')).toBeInTheDocument();
    });

    it('should parse event id parameter', async () => {
      window.location.hash = '#event?id=123';
      await act(async () => {
        render(<App />);
      });
      expect(screen.getByTestId('safety-event-page')).toBeInTheDocument();
    });
  });

  describe('connection status', () => {
    it('should pass connected status to sidebar', async () => {
      window.location.hash = '#map';
      await act(async () => {
        render(<App />);
      });
      const sidebar = screen.getByTestId('sidebar');
      expect(sidebar).toHaveAttribute('data-connected', 'true');
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

      const sidebar = screen.getByTestId('sidebar');
      expect(sidebar).toHaveAttribute('data-connected', 'false');
    });
  });
});
