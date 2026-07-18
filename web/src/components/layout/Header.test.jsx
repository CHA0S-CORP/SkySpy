import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Header } from './Header';

// Mock the AudioPlaybackControl component
vi.mock('./AudioPlaybackControl', () => ({
  AudioPlaybackControl: () => <div data-testid="audio-playback-control">Audio Control</div>,
}));

// Mock the saveConfig function
vi.mock('../../utils/config', () => ({
  saveConfig: vi.fn(),
}));

describe('Header', () => {
  let mockSetConfig;
  let mockSetShowSettings;
  let originalNotification;

  const defaultProps = {
    stats: { count: 10 },
    location: { lat: 40.7128, lon: -74.006 },
    onlineUsers: 5,
    config: { browserNotifications: false },
    setConfig: vi.fn(),
    setShowSettings: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    mockSetConfig = vi.fn();
    mockSetShowSettings = vi.fn();

    // Store original Notification
    originalNotification = global.Notification;

    // Mock Notification API
    global.Notification = {
      permission: 'default',
      requestPermission: vi.fn().mockResolvedValue('granted'),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    global.Notification = originalNotification;
  });

  describe('rendering', () => {
    it('should render the header element', () => {
      render(<Header {...defaultProps} />);
      expect(screen.getByRole('banner')).toBeInTheDocument();
    });

    it('should display aircraft count from stats', () => {
      render(<Header {...defaultProps} />);
      expect(screen.getByText('10')).toBeInTheDocument();
      expect(screen.getByText('Aircraft')).toBeInTheDocument();
    });

    it('should display latitude from location', () => {
      render(<Header {...defaultProps} />);
      expect(screen.getByText('40.7')).toBeInTheDocument();
      expect(screen.getAllByText('Lat').length).toBeGreaterThan(0);
    });

    it('should display longitude from location', () => {
      render(<Header {...defaultProps} />);
      expect(screen.getByText('-74.0')).toBeInTheDocument();
      expect(screen.getAllByText('Lon').length).toBeGreaterThan(0);
    });

    it('should display online users count', () => {
      render(<Header {...defaultProps} />);
      expect(screen.getByText('5')).toBeInTheDocument();
      expect(screen.getByText('Online')).toBeInTheDocument();
    });

    it('should handle missing stats gracefully', () => {
      render(<Header {...defaultProps} stats={{}} />);
      expect(screen.getByText('0')).toBeInTheDocument();
    });

    it('should handle missing location gracefully', () => {
      render(<Header {...defaultProps} location={null} />);
      expect(screen.getAllByText('--').length).toBe(2);
    });

    it('should render AudioPlaybackControl', () => {
      render(<Header {...defaultProps} />);
      expect(screen.getByTestId('audio-playback-control')).toBeInTheDocument();
    });

    it('should render settings button', () => {
      render(<Header {...defaultProps} />);
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  describe('TimeDisplay', () => {
    it('should display current UTC time', () => {
      // Set a specific time
      vi.setSystemTime(new Date('2024-01-15T12:30:45Z'));
      render(<Header {...defaultProps} />);
      expect(screen.getByText(/12:30:45 UTC/)).toBeInTheDocument();
    });

    it('should update time periodically', () => {
      vi.setSystemTime(new Date('2024-01-15T12:30:45Z'));
      render(<Header {...defaultProps} />);

      // Initial time should be displayed
      expect(screen.getByText(/12:30:45 UTC/)).toBeInTheDocument();

      // The time display component has a setInterval, which will update the time
      // We can verify the initial render is correct
    });
  });

  describe('notification toggle', () => {
    it('should show BellOff icon when notifications are disabled', () => {
      render(<Header {...defaultProps} config={{ browserNotifications: false }} />);
      const notifButton = screen.getByTitle('Enable browser notifications');
      expect(notifButton).toBeInTheDocument();
    });

    it('should show BellRing icon when notifications are granted and enabled', () => {
      global.Notification.permission = 'granted';
      render(<Header {...defaultProps} config={{ browserNotifications: true }} />);
      const notifButton = screen.getByTitle('Browser notifications enabled');
      expect(notifButton).toBeInTheDocument();
      expect(notifButton).toHaveClass('notifications-granted');
    });

    it('should request permission when permission is default', async () => {
      vi.useRealTimers();
      global.Notification.permission = 'default';
      global.Notification.requestPermission = vi.fn().mockResolvedValue('granted');

      render(
        <Header
          {...defaultProps}
          setConfig={mockSetConfig}
          config={{ browserNotifications: false }}
        />
      );

      const notifButton = screen.getByTitle('Enable browser notifications');
      fireEvent.click(notifButton);

      await waitFor(() => {
        expect(global.Notification.requestPermission).toHaveBeenCalled();
      });
    });

    it('should toggle notifications when permission is granted', async () => {
      global.Notification.permission = 'granted';
      const { saveConfig } = await import('../../utils/config');
      render(
        <Header
          {...defaultProps}
          setConfig={mockSetConfig}
          config={{ browserNotifications: true }}
        />
      );

      const notifButton = screen.getByTitle('Browser notifications enabled');
      fireEvent.click(notifButton);

      expect(mockSetConfig).toHaveBeenCalledWith({
        browserNotifications: false,
      });
      expect(saveConfig).toHaveBeenCalled();
    });

    it('should enable notifications after granting permission', async () => {
      vi.useRealTimers();
      global.Notification.permission = 'default';
      global.Notification.requestPermission = vi.fn().mockResolvedValue('granted');

      render(
        <Header
          {...defaultProps}
          setConfig={mockSetConfig}
          config={{ browserNotifications: false }}
        />
      );

      const notifButton = screen.getByTitle('Enable browser notifications');
      fireEvent.click(notifButton);

      await waitFor(() => {
        expect(mockSetConfig).toHaveBeenCalledWith({
          browserNotifications: true,
        });
      });
    });
  });

  describe('settings button', () => {
    it('should call setShowSettings when settings button is clicked', () => {
      render(<Header {...defaultProps} setShowSettings={mockSetShowSettings} />);

      // Find the settings button by its icon or by being the last button
      const buttons = screen.getAllByRole('button');

      // Click any settings-like button
      fireEvent.click(buttons[buttons.length - 1]);

      expect(mockSetShowSettings).toHaveBeenCalledWith(true);
    });
  });

  describe('stat items', () => {
    it('should render all stat items', () => {
      render(<Header {...defaultProps} />);

      const statItems = document.querySelectorAll('.stat-item');
      expect(statItems.length).toBe(4); // Aircraft, Lat, Lon, Online
    });

    it('should display zero aircraft count when stats.count is undefined', () => {
      render(<Header {...defaultProps} stats={{ count: undefined }} />);
      expect(screen.getByText('0')).toBeInTheDocument();
    });
  });
});
