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

  it('keeps the same playing stream across navigation and closing controls', () => {
    localStorage.getItem.mockImplementation((key) =>
      key === 'skyspy-live-radios-v1'
        ? JSON.stringify([{ url: 'https://radio.example.org/stream', label: 'Tower', volume: 0.4 }])
        : null
    );
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function () {
      fireEvent.playing(this);
      return Promise.resolve();
    });
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    const shell = (activeTab) => (
      <ThemeProvider>
        <AppShell
          activeTab={activeTab}
          onNavigate={vi.fn()}
          connected
          aircraftCount={1}
          onOpenSettings={vi.fn()}
        >
          <div>{activeTab}</div>
        </AppShell>
      </ThemeProvider>
    );
    const view = render(shell('audio'));
    fireEvent.click(screen.getByRole('button', { name: 'Play Tower' }));
    const audio = document.querySelector('audio');
    pause.mockClear();
    view.rerender(shell('map'));
    expect(document.querySelector('audio')).toBe(audio);
    expect(screen.getByRole('button', { name: 'Stop Tower' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close radio controls' }));
    expect(document.getElementById('live-radio-controls')).not.toBeVisible();
    expect(audio.src).toBe('https://radio.example.org/stream');
    expect(pause).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Live radio controls' }));
    fireEvent.change(screen.getByLabelText('Tower volume'), { target: { value: '25' } });
    expect(audio.volume).toBe(0.25);
    fireEvent.click(screen.getByRole('button', { name: 'Stop Tower' }));
    expect(audio.hasAttribute('src')).toBe(false);
    expect(play).toHaveBeenCalledTimes(1);
    view.unmount();
    play.mockRestore();
    pause.mockRestore();
    load.mockRestore();
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
