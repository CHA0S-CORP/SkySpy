import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SafetyTab } from './SafetyTab';

// Mock lucide-react
vi.mock('lucide-react', () => ({
  AlertTriangle: () => <span data-testid="alert-icon">AlertTriangle</span>,
  ChevronDown: () => <span data-testid="chevron-down">ChevronDown</span>,
  ChevronUp: () => <span data-testid="chevron-up">ChevronUp</span>,
  Map: () => <span data-testid="map-icon">Map</span>,
  History: () => <span data-testid="history-icon">History</span>,
  ExternalLink: () => <span data-testid="external-link">ExternalLink</span>,
  Play: () => <span data-testid="play-icon">Play</span>,
  Pause: () => <span data-testid="pause-icon">Pause</span>,
  SkipBack: () => <span data-testid="skip-back">SkipBack</span>,
  SkipForward: () => <span data-testid="skip-forward">SkipForward</span>,
}));

// Mock Leaflet
vi.mock('leaflet', () => ({
  default: {
    map: vi.fn().mockReturnValue({
      remove: vi.fn(),
      removeLayer: vi.fn(),
      addLayer: vi.fn(),
      fitBounds: vi.fn(),
      setView: vi.fn(),
    }),
    tileLayer: vi.fn().mockReturnValue({ addTo: vi.fn() }),
    marker: vi.fn().mockReturnValue({ addTo: vi.fn() }),
    polyline: vi.fn().mockReturnValue({ addTo: vi.fn() }),
    circleMarker: vi.fn().mockReturnValue({
      addTo: vi.fn().mockReturnValue({ bindPopup: vi.fn() }),
    }),
    divIcon: vi.fn(),
    latLngBounds: vi.fn().mockReturnValue({ pad: vi.fn() }),
  },
}));

// Mock the helper components
vi.mock('../components/ReplayControls', () => ({
  ReplayControlsCompact: () => <div data-testid="replay-controls">ReplayControls</div>,
}));

// Mock safetyConstants
vi.mock('./safetyConstants', () => ({
  getSeverityClass: (severity) => `severity-${severity?.toLowerCase() || 'unknown'}`,
  formatEventType: (type) => type?.replace(/_/g, ' ') || 'Unknown Event',
}));

// Mock safetyMapUtils
vi.mock('./safetyMapUtils', () => ({
  safeJson: vi.fn().mockImplementation(async (res) => {
    if (!res.ok) return null;
    return res.json();
  }),
}));

describe('SafetyTab', () => {
  const defaultProps = {
    hex: 'abc123',
    safetyEvents: [],
    safetyHours: 24,
    setSafetyHours: vi.fn(),
    expandedSnapshots: {},
    setExpandedSnapshots: vi.fn(),
    expandedSafetyMaps: {},
    setExpandedSafetyMaps: vi.fn(),
    safetyTrackData: {},
    setSafetyTrackData: vi.fn(),
    safetyReplayState: {},
    setSafetyReplayState: vi.fn(),
    onSelectAircraft: vi.fn(),
    onViewHistoryEvent: vi.fn(),
    onViewEvent: vi.fn(),
    baseUrl: 'http://localhost:8000',
    wsRequest: vi.fn(),
    wsConnected: true,
  };

  const mockSafetyEvent = {
    id: 1,
    event_type: 'loss_of_separation',
    severity: 'warning',
    timestamp: '2024-01-15T12:30:00Z',
    message: 'Separation loss detected between aircraft',
    icao: 'abc123',
    callsign: 'UAL123',
    icao_2: 'def456',
    callsign_2: 'DAL456',
    lat: 37.7749,
    lon: -122.4194,
    details: {
      altitude: 35000,
      vertical_rate: 1500,
      distance_nm: 2.5,
      altitude_diff_ft: 500,
    },
    aircraft_snapshot: {
      hex: 'abc123',
      flight: 'UAL123',
      lat: 37.7749,
      lon: -122.4194,
      alt_baro: 35000,
      gs: 450,
      track: 180,
    },
    aircraft_snapshot_2: {
      hex: 'def456',
      flight: 'DAL456',
      lat: 37.78,
      lon: -122.42,
      alt_baro: 35500,
      gs: 420,
      track: 90,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('empty state', () => {
    it('should render empty state when no safety events', () => {
      render(<SafetyTab {...defaultProps} />);

      expect(screen.getByText('No safety events')).toBeInTheDocument();
      expect(
        screen.getByText('No safety events recorded for this aircraft in the selected time range')
      ).toBeInTheDocument();
      expect(screen.getByTestId('alert-icon')).toBeInTheDocument();
    });

    it('should have correct role for empty state', () => {
      render(<SafetyTab {...defaultProps} />);

      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  describe('with safety events', () => {
    it('should render event count', () => {
      render(<SafetyTab {...defaultProps} safetyEvents={[mockSafetyEvent]} />);

      expect(screen.getByText(/1 safety event/)).toBeInTheDocument();
    });

    it('should render plural count for multiple events', () => {
      render(<SafetyTab {...defaultProps} safetyEvents={[mockSafetyEvent, { ...mockSafetyEvent, id: 2 }]} />);

      expect(screen.getByText(/2 safety events/)).toBeInTheDocument();
    });

    it('should render event severity badge', () => {
      render(<SafetyTab {...defaultProps} safetyEvents={[mockSafetyEvent]} />);

      expect(screen.getByText('WARNING')).toBeInTheDocument();
    });

    it('should render event type', () => {
      render(<SafetyTab {...defaultProps} safetyEvents={[mockSafetyEvent]} />);

      expect(screen.getByText('loss of separation')).toBeInTheDocument();
    });

    it('should render event message', () => {
      render(<SafetyTab {...defaultProps} safetyEvents={[mockSafetyEvent]} />);

      expect(screen.getByText('Separation loss detected between aircraft')).toBeInTheDocument();
    });

    it('should render event timestamp', () => {
      render(<SafetyTab {...defaultProps} safetyEvents={[mockSafetyEvent]} />);

      const timeElement = screen.getByRole('article').querySelector('time');
      expect(timeElement).toHaveAttribute('datetime', '2024-01-15T12:30:00Z');
    });

    it('should render event details', () => {
      render(<SafetyTab {...defaultProps} safetyEvents={[mockSafetyEvent]} />);

      expect(screen.getByText(/Alt: 35,000ft/)).toBeInTheDocument();
      expect(screen.getByText(/VS: \+1500fpm/)).toBeInTheDocument();
      expect(screen.getByText(/Dist: 2.5nm/)).toBeInTheDocument();
      expect(screen.getByText(/ΔAlt: 500ft/)).toBeInTheDocument();
    });
  });

  describe('time range filter', () => {
    it('should render time range dropdown', () => {
      render(<SafetyTab {...defaultProps} />);

      const select = screen.getByRole('combobox', { name: /time range/i });
      expect(select).toBeInTheDocument();
    });

    it('should display current hours selection', () => {
      render(<SafetyTab {...defaultProps} safetyHours={48} />);

      const select = screen.getByRole('combobox');
      expect(select).toHaveValue('48');
    });

    it('should call setSafetyHours when selection changes', () => {
      const mockSetSafetyHours = vi.fn();
      render(<SafetyTab {...defaultProps} setSafetyHours={mockSetSafetyHours} />);

      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: '72' } });

      expect(mockSetSafetyHours).toHaveBeenCalledWith(72);
    });

    it('should have correct time range options', () => {
      render(<SafetyTab {...defaultProps} />);

      expect(screen.getByRole('option', { name: /last 1 hour/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /last 6 hours/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /last 12 hours/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /last 24 hours/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /last 48 hours/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /last 72 hours/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /last 7 days/i })).toBeInTheDocument();
    });
  });

  describe('snapshot toggle', () => {
    it('should render show telemetry button when snapshot exists', () => {
      render(<SafetyTab {...defaultProps} safetyEvents={[mockSafetyEvent]} />);

      expect(screen.getByRole('button', { name: /show telemetry/i })).toBeInTheDocument();
    });

    it('should call setExpandedSnapshots when telemetry button is clicked', () => {
      const mockSetExpandedSnapshots = vi.fn();
      render(
        <SafetyTab
          {...defaultProps}
          safetyEvents={[mockSafetyEvent]}
          setExpandedSnapshots={mockSetExpandedSnapshots}
        />
      );

      const button = screen.getByRole('button', { name: /show telemetry/i });
      fireEvent.click(button);

      expect(mockSetExpandedSnapshots).toHaveBeenCalled();
    });

    it('should show hide telemetry when expanded', () => {
      render(
        <SafetyTab
          {...defaultProps}
          safetyEvents={[mockSafetyEvent]}
          expandedSnapshots={{ 1: true }}
        />
      );

      expect(screen.getByRole('button', { name: /hide telemetry/i })).toBeInTheDocument();
    });

    it('should render snapshot data when expanded', () => {
      render(
        <SafetyTab
          {...defaultProps}
          safetyEvents={[mockSafetyEvent]}
          expandedSnapshots={{ 1: true }}
        />
      );

      // Should show snapshot fields - there are multiple entries
      const callsignLabels = screen.getAllByText('Callsign');
      expect(callsignLabels.length).toBeGreaterThan(0);
      // Multiple elements with UAL123 exist, so use getAllByText
      const ual123Elements = screen.getAllByText('UAL123');
      expect(ual123Elements.length).toBeGreaterThan(0);
    });
  });

  describe('map toggle', () => {
    it('should render show map button', () => {
      render(<SafetyTab {...defaultProps} safetyEvents={[mockSafetyEvent]} />);

      expect(screen.getByRole('button', { name: /show map/i })).toBeInTheDocument();
    });

    it('should call setExpandedSafetyMaps when map button is clicked', () => {
      const mockSetExpandedMaps = vi.fn();
      render(
        <SafetyTab
          {...defaultProps}
          safetyEvents={[mockSafetyEvent]}
          setExpandedSafetyMaps={mockSetExpandedMaps}
        />
      );

      const button = screen.getByRole('button', { name: /show map/i });
      fireEvent.click(button);

      expect(mockSetExpandedMaps).toHaveBeenCalled();
    });
  });

  describe('action buttons', () => {
    it('should render View in History button', () => {
      render(<SafetyTab {...defaultProps} safetyEvents={[mockSafetyEvent]} />);

      expect(screen.getByRole('button', { name: /view in history/i })).toBeInTheDocument();
    });

    it('should call onViewHistoryEvent when View in History is clicked', () => {
      const mockOnViewHistory = vi.fn();
      render(
        <SafetyTab
          {...defaultProps}
          safetyEvents={[mockSafetyEvent]}
          onViewHistoryEvent={mockOnViewHistory}
        />
      );

      const button = screen.getByRole('button', { name: /view in history/i });
      fireEvent.click(button);

      expect(mockOnViewHistory).toHaveBeenCalledWith(1);
    });

    it('should render View Details button when event has id', () => {
      render(<SafetyTab {...defaultProps} safetyEvents={[mockSafetyEvent]} />);

      expect(screen.getByRole('button', { name: /view details/i })).toBeInTheDocument();
    });

    it('should call onViewEvent when View Details is clicked', () => {
      const mockOnViewEvent = vi.fn();
      render(
        <SafetyTab
          {...defaultProps}
          safetyEvents={[mockSafetyEvent]}
          onViewEvent={mockOnViewEvent}
        />
      );

      const button = screen.getByRole('button', { name: /view details/i });
      fireEvent.click(button);

      expect(mockOnViewEvent).toHaveBeenCalledWith(1);
    });
  });

  describe('other aircraft link', () => {
    it('should display link to other involved aircraft', () => {
      render(<SafetyTab {...defaultProps} safetyEvents={[mockSafetyEvent]} />);

      expect(screen.getByText(/With:/)).toBeInTheDocument();
    });

    it('should call onSelectAircraft when other aircraft link is clicked', () => {
      const mockOnSelectAircraft = vi.fn();
      render(
        <SafetyTab
          {...defaultProps}
          safetyEvents={[mockSafetyEvent]}
          onSelectAircraft={mockOnSelectAircraft}
        />
      );

      const otherAircraftButton = screen.getByRole('button', { name: /DAL456/i });
      fireEvent.click(otherAircraftButton);

      expect(mockOnSelectAircraft).toHaveBeenCalledWith('def456');
    });
  });

  describe('accessibility', () => {
    it('should have correct tabpanel role', () => {
      render(<SafetyTab {...defaultProps} />);

      const tabPanel = screen.getByRole('tabpanel');
      expect(tabPanel).toBeInTheDocument();
      expect(tabPanel).toHaveAttribute('aria-labelledby', 'tab-safety');
      expect(tabPanel).toHaveAttribute('id', 'panel-safety');
    });

    it('should render snapshot toggle button', () => {
      render(<SafetyTab {...defaultProps} safetyEvents={[mockSafetyEvent]} />);

      // The toggle button should be present
      const button = screen.getByRole('button', { name: /show telemetry/i });
      expect(button).toBeInTheDocument();
    });

    it('should have live region for event count', () => {
      render(<SafetyTab {...defaultProps} safetyEvents={[mockSafetyEvent]} />);

      const liveRegion = screen.getByText(/1 safety event/).closest('p');
      expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    });
  });

  describe('severity styling', () => {
    it('should apply correct class for warning severity', () => {
      const { container } = render(<SafetyTab {...defaultProps} safetyEvents={[mockSafetyEvent]} />);

      expect(container.querySelector('.severity-warning')).toBeInTheDocument();
    });

    it('should apply correct class for critical severity', () => {
      const criticalEvent = { ...mockSafetyEvent, severity: 'critical' };
      const { container } = render(<SafetyTab {...defaultProps} safetyEvents={[criticalEvent]} />);

      expect(container.querySelector('.severity-critical')).toBeInTheDocument();
    });

    it('should apply correct class for info severity', () => {
      const infoEvent = { ...mockSafetyEvent, severity: 'info' };
      const { container } = render(<SafetyTab {...defaultProps} safetyEvents={[infoEvent]} />);

      expect(container.querySelector('.severity-info')).toBeInTheDocument();
    });
  });

  describe('event without optional fields', () => {
    it('should handle event without details', () => {
      const eventWithoutDetails = { ...mockSafetyEvent, details: null };
      render(<SafetyTab {...defaultProps} safetyEvents={[eventWithoutDetails]} />);

      // Should render without crashing
      expect(screen.getByText('loss of separation')).toBeInTheDocument();
    });

    it('should handle event without second aircraft', () => {
      const singleAircraftEvent = {
        ...mockSafetyEvent,
        icao_2: null,
        callsign_2: null,
        aircraft_snapshot_2: null,
      };
      render(<SafetyTab {...defaultProps} safetyEvents={[singleAircraftEvent]} />);

      expect(screen.queryByText(/With:/)).not.toBeInTheDocument();
    });

    it('should handle event without snapshots', () => {
      const eventWithoutSnapshots = {
        ...mockSafetyEvent,
        aircraft_snapshot: null,
        aircraft_snapshot_2: null,
      };
      render(<SafetyTab {...defaultProps} safetyEvents={[eventWithoutSnapshots]} />);

      // Should not show telemetry toggle
      expect(screen.queryByRole('button', { name: /telemetry/i })).not.toBeInTheDocument();
    });
  });
});
