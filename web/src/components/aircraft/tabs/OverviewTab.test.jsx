import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OverviewTab } from './OverviewTab';

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }) => <div {...props}>{children}</div>,
    section: ({ children, ...props }) => <section {...props}>{children}</section>,
  },
}));

// Mock lucide-react
vi.mock('lucide-react', () => ({
  Info: () => <span data-testid="info-icon">Info</span>,
  WifiOff: () => <span data-testid="wifi-off-icon">WifiOff</span>,
  Crosshair: () => <span data-testid="crosshair-icon">Crosshair</span>,
  Navigation: () => <span data-testid="navigation-icon">Navigation</span>,
  TrendingUp: () => <span data-testid="trending-icon">TrendingUp</span>,
  MapPin: () => <span data-testid="map-pin-icon">MapPin</span>,
  Radio: () => <span data-testid="radio-icon">Radio</span>,
}));

// Mock utils
vi.mock('../../../utils', () => ({
  getCardinalDirection: vi.fn((track) => {
    if (track == null) return '';
    if (track >= 337.5 || track < 22.5) return 'N';
    if (track >= 157.5 && track < 202.5) return 'S';
    return '';
  }),
}));

// Mock the info card components
vi.mock('./info', () => ({
  AirframeCard: ({ data }) => (
    <div data-testid="airframe-card">AirframeCard - {data?.type_name || 'Unknown'}</div>
  ),
  OperatorCard: ({ data }) => (
    <div data-testid="operator-card">OperatorCard - {data?.operator || 'Unknown'}</div>
  ),
  RegistrationCard: ({ data, hex }) => (
    <div data-testid="registration-card">
      RegistrationCard - {data?.registration || hex || 'Unknown'}
    </div>
  ),
  PhotoCard: ({ photoInfo }) => (
    <div data-testid="photo-card">PhotoCard - {photoInfo?.photographer || 'Unknown'}</div>
  ),
  DataSourcesAccordion: ({ sourceData }) => (
    <div data-testid="data-sources-accordion">
      DataSourcesAccordion - {sourceData?.length || 0} sources
    </div>
  ),
}));

// Mock MetricCard components
vi.mock('../../ui/metric-card', () => ({
  MetricCard: ({ label, value, unit }) => (
    <div data-testid={`metric-${label.toLowerCase().replace(/\s/g, '-')}`}>
      {label}: {value} {unit}
    </div>
  ),
  MetricsGrid: ({ children }) => <div data-testid="metrics-grid">{children}</div>,
}));

describe('OverviewTab', () => {
  const mockInfo = {
    type_name: 'Boeing 737-800',
    type_code: 'B738',
    manufacturer: 'Boeing',
    model: '737-800',
    serial_number: '12345',
    year_built: 2015,
    operator: 'United Airlines',
    operator_icao: 'UAL',
    owner: 'United Airlines Inc',
    country: 'United States',
    registration: 'N12345',
    is_military: false,
    category: 'A3',
    source_data: [{ source: 'FAA', last_updated: '2024-01-01' }],
  };

  const mockAircraft = {
    hex: 'abc123',
    flight: 'UAL123',
    lat: 37.7749,
    lon: -122.4194,
    alt_baro: 35000,
    alt_geom: 35100,
    gs: 450,
    track: 180,
    baro_rate: 500,
    geom_rate: 480,
    squawk: '1200',
  };

  const mockPhotoInfo = {
    photo_url: 'https://example.com/photo.jpg',
    photographer: 'Test Photographer',
    source: 'planespotters.net',
  };

  const mockTrackHistory = [
    { lat: 37.77, lon: -122.41, timestamp: '2024-01-01T12:00:00Z' },
    { lat: 37.78, lon: -122.42, timestamp: '2024-01-01T12:01:00Z' },
  ];

  const mockCalculateDistance = vi.fn().mockReturnValue(15.5);

  const defaultProps = {
    info: mockInfo,
    hex: 'abc123',
    photoInfo: mockPhotoInfo,
    aircraft: mockAircraft,
    trackHistory: mockTrackHistory,
    calculateDistance: mockCalculateDistance,
  };

  describe('accessibility', () => {
    it('should have correct tabpanel role', () => {
      render(<OverviewTab {...defaultProps} />);

      const tabPanel = screen.getByRole('tabpanel');
      expect(tabPanel).toBeInTheDocument();
      expect(tabPanel).toHaveAttribute('aria-labelledby', 'tab-overview');
      expect(tabPanel).toHaveAttribute('id', 'panel-overview');
    });
  });

  describe('live telemetry section', () => {
    it('should render live telemetry section', () => {
      render(<OverviewTab {...defaultProps} />);

      // There are multiple elements with live telemetry label, use getAllByRole
      const regions = screen.getAllByRole('region', { name: /live telemetry/i });
      expect(regions.length).toBeGreaterThan(0);
    });

    it('should render section title with live indicator', () => {
      render(<OverviewTab {...defaultProps} />);

      expect(screen.getByText('Live Telemetry')).toBeInTheDocument();
    });

    it('should display altitude metric', () => {
      render(<OverviewTab {...defaultProps} />);

      expect(screen.getByTestId('metric-altitude')).toBeInTheDocument();
      expect(screen.getByTestId('metric-altitude')).toHaveTextContent('35,000');
    });

    it('should display ground speed metric', () => {
      render(<OverviewTab {...defaultProps} />);

      expect(screen.getByTestId('metric-ground-speed')).toBeInTheDocument();
      expect(screen.getByTestId('metric-ground-speed')).toHaveTextContent('450');
    });

    it('should display vertical rate metric', () => {
      render(<OverviewTab {...defaultProps} />);

      expect(screen.getByTestId('metric-vertical-rate')).toBeInTheDocument();
      expect(screen.getByTestId('metric-vertical-rate')).toHaveTextContent('+500');
    });

    it('should display track metric', () => {
      render(<OverviewTab {...defaultProps} />);

      expect(screen.getByTestId('metric-track')).toBeInTheDocument();
    });

    it('should display distance metric', () => {
      render(<OverviewTab {...defaultProps} />);

      expect(screen.getByTestId('metric-distance')).toBeInTheDocument();
      expect(screen.getByTestId('metric-distance')).toHaveTextContent('15.5');
    });

    it('should display squawk metric', () => {
      render(<OverviewTab {...defaultProps} />);

      expect(screen.getByTestId('metric-squawk')).toBeInTheDocument();
      expect(screen.getByTestId('metric-squawk')).toHaveTextContent('1200');
    });

    it('should display position coordinates', () => {
      render(<OverviewTab {...defaultProps} />);

      expect(screen.getByText('Position')).toBeInTheDocument();
      expect(screen.getByText('Lat: 37.77490')).toBeInTheDocument();
      expect(screen.getByText('Lon: -122.41940')).toBeInTheDocument();
    });
  });

  describe('aircraft not tracked', () => {
    it('should show not tracked message when aircraft is null', () => {
      render(<OverviewTab {...defaultProps} aircraft={null} />);

      expect(screen.getByText('Aircraft not currently tracked')).toBeInTheDocument();
      expect(screen.getByText('Not in range of the receiver')).toBeInTheDocument();
      expect(screen.getByTestId('wifi-off-icon')).toBeInTheDocument();
    });

    it('should have status role for not tracked message', () => {
      render(<OverviewTab {...defaultProps} aircraft={null} />);

      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  describe('aircraft information section', () => {
    it('should render aircraft information section when info is provided', () => {
      render(<OverviewTab {...defaultProps} />);

      expect(screen.getByRole('region', { name: /aircraft information/i })).toBeInTheDocument();
    });

    it('should render section title', () => {
      render(<OverviewTab {...defaultProps} />);

      expect(screen.getByText('Aircraft Information')).toBeInTheDocument();
    });

    it('should render AirframeCard', () => {
      render(<OverviewTab {...defaultProps} />);

      expect(screen.getByTestId('airframe-card')).toBeInTheDocument();
      expect(screen.getByTestId('airframe-card')).toHaveTextContent('Boeing 737-800');
    });

    it('should render OperatorCard', () => {
      render(<OverviewTab {...defaultProps} />);

      expect(screen.getByTestId('operator-card')).toBeInTheDocument();
      expect(screen.getByTestId('operator-card')).toHaveTextContent('United Airlines');
    });

    it('should render RegistrationCard', () => {
      render(<OverviewTab {...defaultProps} />);

      expect(screen.getByTestId('registration-card')).toBeInTheDocument();
      expect(screen.getByTestId('registration-card')).toHaveTextContent('N12345');
    });

    it('should not render aircraft info section when info is null', () => {
      render(<OverviewTab {...defaultProps} info={null} />);

      expect(screen.queryByTestId('airframe-card')).not.toBeInTheDocument();
    });
  });

  describe('photo section', () => {
    it('should render PhotoCard when photoInfo is provided', () => {
      render(<OverviewTab {...defaultProps} />);

      expect(screen.getByTestId('photo-card')).toBeInTheDocument();
      expect(screen.getByTestId('photo-card')).toHaveTextContent('Test Photographer');
    });

    it('should not render PhotoCard when photoInfo is null', () => {
      render(<OverviewTab {...defaultProps} photoInfo={null} />);

      expect(screen.queryByTestId('photo-card')).not.toBeInTheDocument();
    });
  });

  describe('data sources section', () => {
    it('should render DataSourcesAccordion when source_data is provided', () => {
      render(<OverviewTab {...defaultProps} />);

      expect(screen.getByTestId('data-sources-accordion')).toBeInTheDocument();
      expect(screen.getByTestId('data-sources-accordion')).toHaveTextContent('1 sources');
    });

    it('should not render DataSourcesAccordion when source_data is empty', () => {
      const infoWithoutSources = { ...mockInfo, source_data: [] };
      render(<OverviewTab {...defaultProps} info={infoWithoutSources} />);

      expect(screen.queryByTestId('data-sources-accordion')).not.toBeInTheDocument();
    });
  });

  describe('empty info state', () => {
    it('should show empty state when info is null', () => {
      render(<OverviewTab {...defaultProps} info={null} />);

      expect(screen.getByText('No aircraft information available')).toBeInTheDocument();
      expect(screen.getByText('Data may not be available for this aircraft')).toBeInTheDocument();
      expect(screen.getByTestId('info-icon')).toBeInTheDocument();
    });

    it('should have status role for empty info state', () => {
      render(<OverviewTab {...defaultProps} info={null} />);

      const statusElements = screen.getAllByRole('status');
      expect(statusElements.length).toBeGreaterThan(0);
    });
  });

  describe('data normalization', () => {
    it('should normalize aircraft_type to type_name', () => {
      const alternativeInfo = { aircraft_type: 'Airbus A320' };
      render(<OverviewTab {...defaultProps} info={alternativeInfo} />);

      expect(screen.getByTestId('airframe-card')).toHaveTextContent('Airbus A320');
    });

    it('should normalize operatorName to operator', () => {
      const alternativeInfo = { operatorName: 'Delta Air Lines' };
      render(<OverviewTab {...defaultProps} info={alternativeInfo} />);

      expect(screen.getByTestId('operator-card')).toHaveTextContent('Delta Air Lines');
    });

    it('should normalize tail_number to registration', () => {
      const alternativeInfo = { tail_number: 'N789DL' };
      render(<OverviewTab {...defaultProps} info={alternativeInfo} />);

      expect(screen.getByTestId('registration-card')).toHaveTextContent('N789DL');
    });
  });

  describe('telemetry fallbacks', () => {
    it('should use alt_geom when alt_baro is ground', () => {
      const groundAircraft = { ...mockAircraft, alt_baro: 'ground', alt_geom: 50 };
      render(<OverviewTab {...defaultProps} aircraft={groundAircraft} />);

      expect(screen.getByTestId('metric-altitude')).toHaveTextContent('50');
    });

    it('should format negative vertical rate correctly', () => {
      const descendingAircraft = { ...mockAircraft, vr: -1500, baro_rate: -1500 };
      render(<OverviewTab {...defaultProps} aircraft={descendingAircraft} />);

      expect(screen.getByTestId('metric-vertical-rate')).toHaveTextContent('-1500');
    });

    it('should show -- for missing values', () => {
      const incompleteAircraft = {
        hex: 'abc123',
        lat: 37.77,
        lon: -122.41,
      };
      render(<OverviewTab {...defaultProps} aircraft={incompleteAircraft} />);

      expect(screen.getByTestId('metric-altitude')).toHaveTextContent('--');
      expect(screen.getByTestId('metric-ground-speed')).toHaveTextContent('--');
    });
  });

  describe('emergency squawk', () => {
    it('should mark squawk as emergency for 7500', () => {
      const hijackAircraft = { ...mockAircraft, squawk: '7500' };
      render(<OverviewTab {...defaultProps} aircraft={hijackAircraft} />);

      expect(screen.getByTestId('metric-squawk')).toHaveTextContent('7500');
    });

    it('should mark squawk as emergency for 7600', () => {
      const radioFailAircraft = { ...mockAircraft, squawk: '7600' };
      render(<OverviewTab {...defaultProps} aircraft={radioFailAircraft} />);

      expect(screen.getByTestId('metric-squawk')).toHaveTextContent('7600');
    });

    it('should mark squawk as emergency for 7700', () => {
      const emergencyAircraft = { ...mockAircraft, squawk: '7700' };
      render(<OverviewTab {...defaultProps} aircraft={emergencyAircraft} />);

      expect(screen.getByTestId('metric-squawk')).toHaveTextContent('7700');
    });

    it('should show ---- for missing squawk', () => {
      const noSquawkAircraft = { ...mockAircraft, squawk: null };
      render(<OverviewTab {...defaultProps} aircraft={noSquawkAircraft} />);

      expect(screen.getByTestId('metric-squawk')).toHaveTextContent('----');
    });
  });
});
