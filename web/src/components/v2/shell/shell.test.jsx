import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppShell } from './AppShell';
import { ThemeProvider } from '../../../providers/ThemeProvider';

const markAllAsRead = vi.fn();
let unacknowledgedCount = 0;
let deniedFeatures = new Set();
let authConfig = { authEnabled: false, publicMode: true, devMode: true };

vi.mock('../../../hooks/useAlertNotifications', () => ({
  useAlertNotifications: () => ({
    get unacknowledgedCount() {
      return unacknowledgedCount;
    },
    markAllAsRead,
  }),
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    canAccessFeature: (feature) => !deniedFeatures.has(feature),
    hasPermission: () => true,
    status: 'anonymous',
    user: null,
    isAuthenticated: false,
    logout: vi.fn(),
    config: authConfig,
  }),
}));

function renderShell(props = {}) {
  return render(
    <ThemeProvider>
      <AppShell
        activeTab="map"
        onNavigate={vi.fn()}
        connected
        aircraftCount={204}
        location={{ lat: 32.8, lon: -117.2 }}
        onlineUsers={2}
        onOpenSettings={vi.fn()}
        {...props}
      >
        <div data-testid="routed-view" />
      </AppShell>
    </ThemeProvider>
  );
}

describe('AppShell', () => {
  beforeEach(() => {
    unacknowledgedCount = 0;
    deniedFeatures = new Set();
    authConfig = { authEnabled: false, publicMode: true, devMode: true };
    localStorage.getItem.mockReset().mockReturnValue(null);
  });

  it('renders header stats, nav, and routed content', () => {
    renderShell();
    expect(screen.getByTestId('v2-aircraft-count')).toHaveTextContent('204');
    expect(screen.getByText('32.8')).toBeInTheDocument();
    expect(screen.getByText('-117.2')).toBeInTheDocument();
    expect(screen.getByTestId('v2-nav')).toBeInTheDocument();
    expect(screen.getByTestId('routed-view')).toBeInTheDocument();
  });

  it('marks active nav item and navigates', () => {
    const onNavigate = vi.fn();
    renderShell({ onNavigate });
    expect(screen.getByTestId('v2-nav-map')).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByTestId('v2-nav-stats'));
    expect(onNavigate).toHaveBeenCalledWith('stats');
  });

  it('shows LIVE when connected and OFFLINE when not', () => {
    const { unmount } = renderShell();
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    unmount();
    renderShell({ connected: false });
    expect(screen.getByText('OFFLINE')).toBeInTheDocument();
  });

  it('shows alerts badge when unacknowledged alerts exist', () => {
    unacknowledgedCount = 3;
    renderShell();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders theme switcher and switches theme', () => {
    renderShell();
    fireEvent.click(screen.getByTitle('Amber theme'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('amber');
  });

  it('flush content pane for map, padded otherwise', () => {
    const { unmount } = renderShell({ activeTab: 'map' });
    expect(document.querySelector('.v2-content--flush')).toBeTruthy();
    unmount();
    renderShell({ activeTab: 'admin' });
    expect(document.querySelector('.v2-content--flush')).toBeNull();
  });

  it('gates Weather and Wildfires nav on their RBAC features', () => {
    const { unmount } = renderShell();
    // Accessible by default (canAccessFeature true).
    expect(screen.getByTestId('v2-nav-weather')).toBeInTheDocument();
    expect(screen.getByTestId('v2-nav-wildfires')).toBeInTheDocument();
    unmount();

    // Enforced auth so feature items are gated on canAccessFeature (public mode
    // shows every feature item regardless).
    authConfig = { authEnabled: true, publicMode: false, devMode: false };
    deniedFeatures = new Set(['weather', 'wildfires']);
    renderShell();
    expect(screen.queryByTestId('v2-nav-weather')).toBeNull();
    expect(screen.queryByTestId('v2-nav-wildfires')).toBeNull();
    // A non-gated item still shows.
    expect(screen.getByTestId('v2-nav-map')).toBeInTheDocument();
  });

  it('opens settings from the header', () => {
    const onOpenSettings = vi.fn();
    renderShell({ onOpenSettings });
    fireEvent.click(screen.getByTestId('v2-settings-btn'));
    expect(onOpenSettings).toHaveBeenCalled();
  });
});
