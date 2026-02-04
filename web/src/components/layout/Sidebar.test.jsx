import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { Sidebar } from './Sidebar';

// Mock the hooks
vi.mock('../../hooks/useAlertNotifications', () => ({
  useAlertNotifications: vi.fn(() => ({
    unacknowledgedCount: 0,
    markAllAsRead: vi.fn(),
  })),
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    canAccessFeature: vi.fn(() => true),
    config: {
      authEnabled: false,
      publicMode: true,
    },
  })),
}));

describe('Sidebar', () => {
  const defaultProps = {
    activeTab: 'map',
    setActiveTab: vi.fn(),
    connected: true,
    collapsed: false,
    setCollapsed: vi.fn(),
    stats: { count: 10 },
    onOpenSettings: vi.fn(),
    onLaunchCannonball: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('rendering', () => {
    it('should render the sidebar', () => {
      render(<Sidebar {...defaultProps} />);
      expect(document.querySelector('.sidebar')).toBeInTheDocument();
    });

    it('should render the logo', () => {
      render(<Sidebar {...defaultProps} />);
      expect(screen.getByAltText('SkySpy')).toBeInTheDocument();
    });

    it('should render logo text when not collapsed', () => {
      render(<Sidebar {...defaultProps} collapsed={false} />);
      expect(screen.getByText('Sky')).toBeInTheDocument();
      expect(screen.getByText('Spy')).toBeInTheDocument();
    });

    it('should hide logo text when collapsed', () => {
      render(<Sidebar {...defaultProps} collapsed={true} />);
      expect(screen.queryByText('Sky')).not.toBeInTheDocument();
    });

    it('should render navigation items', () => {
      render(<Sidebar {...defaultProps} />);
      expect(screen.getByText('Live Map')).toBeInTheDocument();
      expect(screen.getByText('Aircraft List')).toBeInTheDocument();
      expect(screen.getByText('Statistics')).toBeInTheDocument();
      expect(screen.getByText('History')).toBeInTheDocument();
      expect(screen.getByText('Radio')).toBeInTheDocument();
      expect(screen.getByText('Alerts')).toBeInTheDocument();
      expect(screen.getByText('System')).toBeInTheDocument();
    });

    it('should render the collapse toggle button', () => {
      render(<Sidebar {...defaultProps} />);
      const toggleBtn = screen.getByTitle('Collapse sidebar');
      expect(toggleBtn).toBeInTheDocument();
    });

    it('should show expand title when collapsed', () => {
      render(<Sidebar {...defaultProps} collapsed={true} />);
      const toggleBtn = screen.getByTitle('Expand sidebar');
      expect(toggleBtn).toBeInTheDocument();
    });
  });

  describe('active tab highlighting', () => {
    it('should highlight the active tab', () => {
      render(<Sidebar {...defaultProps} activeTab="map" />);
      const mapNavItem = screen.getByText('Live Map').closest('.nav-item');
      expect(mapNavItem).toHaveClass('active');
    });

    it('should highlight different active tab', () => {
      render(<Sidebar {...defaultProps} activeTab="aircraft" />);
      const aircraftNavItem = screen.getByText('Aircraft List').closest('.nav-item');
      expect(aircraftNavItem).toHaveClass('active');
    });

    it('should not highlight inactive tabs', () => {
      render(<Sidebar {...defaultProps} activeTab="map" />);
      const statsNavItem = screen.getByText('Statistics').closest('.nav-item');
      expect(statsNavItem).not.toHaveClass('active');
    });
  });

  describe('tab navigation', () => {
    it('should call setActiveTab when a nav item is clicked', () => {
      const setActiveTab = vi.fn();
      render(<Sidebar {...defaultProps} setActiveTab={setActiveTab} />);

      fireEvent.click(screen.getByText('Statistics'));
      expect(setActiveTab).toHaveBeenCalledWith('stats');
    });

    it('should navigate to different tabs', () => {
      const setActiveTab = vi.fn();
      render(<Sidebar {...defaultProps} setActiveTab={setActiveTab} />);

      fireEvent.click(screen.getByText('Alerts'));
      expect(setActiveTab).toHaveBeenCalledWith('alerts');

      fireEvent.click(screen.getByText('History'));
      expect(setActiveTab).toHaveBeenCalledWith('history');
    });
  });

  describe('collapse/expand functionality', () => {
    it('should call setCollapsed when toggle button is clicked', () => {
      const setCollapsed = vi.fn();
      render(<Sidebar {...defaultProps} collapsed={false} setCollapsed={setCollapsed} />);

      const toggleBtn = screen.getByTitle('Collapse sidebar');
      fireEvent.click(toggleBtn);

      expect(setCollapsed).toHaveBeenCalledWith(true);
    });

    it('should call setCollapsed with false when expanding', () => {
      const setCollapsed = vi.fn();
      render(<Sidebar {...defaultProps} collapsed={true} setCollapsed={setCollapsed} />);

      const toggleBtn = screen.getByTitle('Expand sidebar');
      fireEvent.click(toggleBtn);

      expect(setCollapsed).toHaveBeenCalledWith(false);
    });

    it('should add collapsed class when collapsed', () => {
      render(<Sidebar {...defaultProps} collapsed={true} />);
      expect(document.querySelector('.sidebar')).toHaveClass('collapsed');
    });

    it('should not show nav item labels when collapsed', () => {
      render(<Sidebar {...defaultProps} collapsed={true} />);
      // When collapsed, labels should not be visible, but icons should have titles
      const buttons = screen.getAllByRole('button');
      const mapButton = buttons.find((btn) => btn.getAttribute('title') === 'Live Map');
      expect(mapButton).toBeInTheDocument();
    });
  });

  describe('connection status', () => {
    it('should show LIVE status when connected', () => {
      render(<Sidebar {...defaultProps} connected={true} />);
      expect(screen.getByText('LIVE')).toBeInTheDocument();
    });

    it('should show OFFLINE status when disconnected', () => {
      render(<Sidebar {...defaultProps} connected={false} />);
      expect(screen.getByText('OFFLINE')).toBeInTheDocument();
    });

    it('should apply connected class when connected', () => {
      render(<Sidebar {...defaultProps} connected={true} />);
      expect(document.querySelector('.connection-status')).toHaveClass('connected');
    });

    it('should apply disconnected class when disconnected', () => {
      render(<Sidebar {...defaultProps} connected={false} />);
      expect(document.querySelector('.connection-status')).toHaveClass('disconnected');
    });
  });

  describe('mobile stats bar', () => {
    it('should render mobile stats bar', () => {
      render(<Sidebar {...defaultProps} />);
      expect(document.querySelector('.mobile-sidebar-stats')).toBeInTheDocument();
    });

    it('should display aircraft count in mobile stats', () => {
      render(<Sidebar {...defaultProps} stats={{ count: 25 }} />);
      const mobileStats = document.querySelector('.mobile-sidebar-stats');
      expect(within(mobileStats).getByText('25')).toBeInTheDocument();
    });

    it('should render mobile settings button', () => {
      render(<Sidebar {...defaultProps} />);
      const settingsBtn = screen.getByTitle('Settings');
      expect(settingsBtn).toBeInTheDocument();
    });

    it('should call onOpenSettings when mobile settings clicked', () => {
      const onOpenSettings = vi.fn();
      render(<Sidebar {...defaultProps} onOpenSettings={onOpenSettings} />);

      const settingsBtn = screen.getByTitle('Settings');
      fireEvent.click(settingsBtn);

      expect(onOpenSettings).toHaveBeenCalled();
    });
  });

  describe('external services', () => {
    it('should render services toggle', () => {
      render(<Sidebar {...defaultProps} />);
      expect(screen.getByText('Services')).toBeInTheDocument();
    });

    it('should expand services when toggle is clicked', () => {
      render(<Sidebar {...defaultProps} />);

      const servicesToggle = screen.getByText('Services').closest('.nav-item');
      fireEvent.click(servicesToggle);

      expect(screen.getByText('tar1090')).toBeInTheDocument();
      expect(screen.getByText('Grafana')).toBeInTheDocument();
    });

    it('should have external links for services', () => {
      render(<Sidebar {...defaultProps} />);

      const servicesToggle = screen.getByText('Services').closest('.nav-item');
      fireEvent.click(servicesToggle);

      const tar1090Link = screen.getByText('tar1090').closest('a');
      expect(tar1090Link).toHaveAttribute('href', '/tar1090/');
      expect(tar1090Link).toHaveAttribute('target', '_blank');
      expect(tar1090Link).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });

  describe('Cannonball mode', () => {
    it('should render cannonball button when handler provided', () => {
      render(<Sidebar {...defaultProps} onLaunchCannonball={vi.fn()} />);
      expect(screen.getByText('Cannonball')).toBeInTheDocument();
    });

    it('should not render cannonball button when handler not provided', () => {
      render(<Sidebar {...defaultProps} onLaunchCannonball={null} />);
      expect(screen.queryByText('Cannonball')).not.toBeInTheDocument();
    });

    it('should call onLaunchCannonball when clicked', () => {
      const onLaunchCannonball = vi.fn();
      render(<Sidebar {...defaultProps} onLaunchCannonball={onLaunchCannonball} />);

      fireEvent.click(screen.getByText('Cannonball'));
      expect(onLaunchCannonball).toHaveBeenCalled();
    });
  });

  describe('alert badge', () => {
    it('should show alert badge when there are unacknowledged alerts', async () => {
      const { useAlertNotifications } = await import('../../hooks/useAlertNotifications');
      useAlertNotifications.mockReturnValue({
        unacknowledgedCount: 5,
        markAllAsRead: vi.fn(),
      });

      render(<Sidebar {...defaultProps} />);
      expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('should not show alert badge when count is 0', async () => {
      const { useAlertNotifications } = await import('../../hooks/useAlertNotifications');
      useAlertNotifications.mockReturnValue({
        unacknowledgedCount: 0,
        markAllAsRead: vi.fn(),
      });

      render(<Sidebar {...defaultProps} />);
      expect(document.querySelector('.nav-badge')).not.toBeInTheDocument();
    });

    it('should show 99+ for counts over 99', async () => {
      const { useAlertNotifications } = await import('../../hooks/useAlertNotifications');
      useAlertNotifications.mockReturnValue({
        unacknowledgedCount: 150,
        markAllAsRead: vi.fn(),
      });

      render(<Sidebar {...defaultProps} />);
      expect(screen.getByText('99+')).toBeInTheDocument();
    });

    it('should mark alerts as read when navigating to alerts tab', async () => {
      vi.useRealTimers();
      const markAllAsRead = vi.fn();
      const { useAlertNotifications } = await import('../../hooks/useAlertNotifications');
      useAlertNotifications.mockReturnValue({
        unacknowledgedCount: 5,
        markAllAsRead,
      });

      render(<Sidebar {...defaultProps} activeTab="alerts" />);

      await waitFor(() => {
        expect(markAllAsRead).toHaveBeenCalled();
      });
    });
  });

  describe('footer', () => {
    it('should display version number', () => {
      render(<Sidebar {...defaultProps} />);
      expect(screen.getByText('v2.5.0')).toBeInTheDocument();
    });

    it('should display copyright', () => {
      render(<Sidebar {...defaultProps} />);
      expect(screen.getByText(/CHAOS.CORP/)).toBeInTheDocument();
    });

    it('should show mini version when collapsed', () => {
      render(<Sidebar {...defaultProps} collapsed={true} />);
      expect(screen.getByText('2.5')).toBeInTheDocument();
    });
  });

  describe('permission-based tab visibility', () => {
    it('should filter tabs based on feature access when auth is enabled', async () => {
      const { useAuth } = await import('../../contexts/AuthContext');
      useAuth.mockReturnValue({
        canAccessFeature: vi.fn((feature) => feature !== 'alerts'),
        config: {
          authEnabled: true,
          publicMode: false,
        },
      });

      render(<Sidebar {...defaultProps} />);
      expect(screen.queryByText('Alerts')).not.toBeInTheDocument();
    });

    it('should show all tabs in public mode', async () => {
      const { useAuth } = await import('../../contexts/AuthContext');
      useAuth.mockReturnValue({
        canAccessFeature: vi.fn(() => true),
        config: {
          authEnabled: true,
          publicMode: true,
        },
      });

      render(<Sidebar {...defaultProps} />);
      expect(screen.getByText('Alerts')).toBeInTheDocument();
      expect(screen.getByText('System')).toBeInTheDocument();
    });
  });
});
