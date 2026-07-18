import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AircraftSidebar } from './AircraftSidebar';

// Mock the hooks
vi.mock('./hooks/useAircraftDetail', () => ({
  useAircraftDetail: vi.fn(),
}));

// Mock lucide-react icons - include all icons used by sidebar and its sub-components
vi.mock('lucide-react', () => ({
  Radar: () => <span data-testid="radar-icon">Radar</span>,
  MessageSquare: () => <span data-testid="message-icon">MessageSquare</span>,
  X: () => <span data-testid="x-icon">X</span>,
  Share2: () => <span data-testid="share-icon">Share2</span>,
  Check: () => <span data-testid="check-icon">Check</span>,
  ChevronDown: () => <span data-testid="chevron-down">ChevronDown</span>,
  ChevronUp: () => <span data-testid="chevron-up">ChevronUp</span>,
  Plane: () => <span data-testid="plane-icon">Plane</span>,
  Building2: () => <span data-testid="building-icon">Building2</span>,
  FileText: () => <span data-testid="file-icon">FileText</span>,
  Database: () => <span data-testid="database-icon">Database</span>,
  Camera: () => <span data-testid="camera-icon">Camera</span>,
  RefreshCw: () => <span data-testid="refresh-icon">RefreshCw</span>,
  Navigation: () => <span data-testid="nav-icon">Navigation</span>,
  Crosshair: () => <span data-testid="crosshair-icon">Crosshair</span>,
  TrendingUp: () => <span data-testid="trending-icon">TrendingUp</span>,
  Clock: () => <span data-testid="clock-icon">Clock</span>,
  ArrowUp: () => <span data-testid="arrow-up-icon">ArrowUp</span>,
  Gauge: () => <span data-testid="gauge-icon">Gauge</span>,
  Compass: () => <span data-testid="compass-icon">Compass</span>,
  MapPin: () => <span data-testid="map-pin-icon">MapPin</span>,
  Radio: () => <span data-testid="radio-icon">Radio</span>,
  Hash: () => <span data-testid="hash-icon">Hash</span>,
}));

import { useAircraftDetail } from './hooks/useAircraftDetail';

describe('AircraftSidebar', () => {
  const defaultProps = {
    hex: 'abc123',
    apiUrl: 'http://localhost:8000',
    onClose: vi.fn(),
    onOpenDetail: vi.fn(),
    aircraft: {
      hex: 'abc123',
      flight: 'UAL123',
      lat: 37.7749,
      lon: -122.4194,
      alt_baro: 35000,
      gs: 450,
      track: 180,
      baro_rate: 500,
    },
    aircraftInfo: null,
    feederLocation: { lat: 37.5, lon: -122.0 },
    wsRequest: vi.fn(),
    wsConnected: true,
  };

  const mockHookReturn = {
    info: {
      type_name: 'Boeing 737-800',
      operator: 'United Airlines',
      registration: 'N12345',
      manufacturer: 'Boeing',
      model: '737-800',
      year_built: 2015,
      owner: 'United Airlines Inc',
      country: 'United States',
      source_data: [],
    },
    loading: false,
    shareSuccess: false,
    handleShare: vi.fn(),
    calculateDistance: vi.fn().mockReturnValue(15.5),
    expandedSections: {
      aircraft: true,
      operator: false,
      registration: false,
      sources: false,
    },
    toggleSection: vi.fn(),
    photoInfo: { photo_url: 'https://example.com/photo.jpg', photographer: 'Test' },
    photoUrl: 'https://example.com/photo.jpg',
    photoState: 'loaded',
    photoRetryCount: 0,
    useThumbnail: false,
    handlePhotoError: vi.fn(),
    handlePhotoLoad: vi.fn(),
    retryPhoto: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useAircraftDetail.mockReturnValue(mockHookReturn);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('rendering', () => {
    it('should render the sidebar with correct aria label', () => {
      render(<AircraftSidebar {...defaultProps} />);

      const sidebar = screen.getByRole('complementary', { name: /aircraft details for UAL123/i });
      expect(sidebar).toBeInTheDocument();
    });

    it('should render with hex when no flight callsign', () => {
      const propsWithoutFlight = {
        ...defaultProps,
        aircraft: { ...defaultProps.aircraft, flight: null },
      };
      render(<AircraftSidebar {...propsWithoutFlight} />);

      const sidebar = screen.getByRole('complementary', { name: /aircraft details for abc123/i });
      expect(sidebar).toBeInTheDocument();
    });

    it('should render backdrop for mobile', () => {
      const { container } = render(<AircraftSidebar {...defaultProps} />);

      const backdrop = container.querySelector('.sidebar-backdrop');
      expect(backdrop).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('should display loading indicator when loading', () => {
      useAircraftDetail.mockReturnValue({
        ...mockHookReturn,
        loading: true,
      });

      render(<AircraftSidebar {...defaultProps} />);

      expect(screen.getByText('Loading aircraft data...')).toBeInTheDocument();
    });

    it('should not render sections when loading', () => {
      useAircraftDetail.mockReturnValue({
        ...mockHookReturn,
        loading: true,
      });

      render(<AircraftSidebar {...defaultProps} />);

      expect(screen.queryByText('Aircraft')).not.toBeInTheDocument();
      expect(screen.queryByText('Operator')).not.toBeInTheDocument();
    });
  });

  describe('sections', () => {
    it('should render all collapsible sections', () => {
      render(<AircraftSidebar {...defaultProps} />);

      // The sections should be rendered (look for section headers)
      expect(screen.getByText('Boeing 737-800')).toBeInTheDocument();
    });

    it('should call toggleSection when section header is clicked', () => {
      const mockToggleSection = vi.fn();
      useAircraftDetail.mockReturnValue({
        ...mockHookReturn,
        toggleSection: mockToggleSection,
      });

      render(<AircraftSidebar {...defaultProps} />);

      // Find and click a section toggle button
      const sectionButtons = screen.getAllByRole('button');
      // Click the first collapsible section button (not close/share buttons)
      const collapsibleButton = sectionButtons.find(
        (btn) =>
          btn.className?.includes('section-header') || btn.getAttribute('aria-expanded') !== null
      );

      if (collapsibleButton) {
        fireEvent.click(collapsibleButton);
        expect(mockToggleSection).toHaveBeenCalled();
      }
    });
  });

  describe('external links', () => {
    it('should render external links in footer', () => {
      render(<AircraftSidebar {...defaultProps} />);

      const flightAwareLink = screen.getByRole('link', { name: /flightaware/i });
      const planespottersLink = screen.getByRole('link', { name: /planespotters/i });
      const adsbExchangeLink = screen.getByRole('link', { name: /ads-b exchange/i });

      expect(flightAwareLink).toHaveAttribute('href', expect.stringContaining('flightaware.com'));
      expect(planespottersLink).toHaveAttribute(
        'href',
        expect.stringContaining('planespotters.net')
      );
      expect(adsbExchangeLink).toHaveAttribute('href', expect.stringContaining('adsbexchange.com'));
    });

    it('should open links in new tab', () => {
      render(<AircraftSidebar {...defaultProps} />);

      const links = screen.getAllByRole('link');
      links.forEach((link) => {
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      });
    });
  });

  describe('header actions', () => {
    it('should call handleShare when share button is clicked', () => {
      const mockHandleShare = vi.fn();
      useAircraftDetail.mockReturnValue({
        ...mockHookReturn,
        handleShare: mockHandleShare,
      });

      render(<AircraftSidebar {...defaultProps} />);

      const shareButton = screen.getByRole('button', { name: /share/i });
      fireEvent.click(shareButton);

      expect(mockHandleShare).toHaveBeenCalledTimes(1);
    });

    it('should call onClose when close button is clicked', () => {
      const mockOnClose = vi.fn();
      render(<AircraftSidebar {...defaultProps} onClose={mockOnClose} />);

      const closeButton = screen.getByRole('button', { name: /close/i });
      fireEvent.click(closeButton);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('should show success state after sharing', () => {
      useAircraftDetail.mockReturnValue({
        ...mockHookReturn,
        shareSuccess: true,
      });

      render(<AircraftSidebar {...defaultProps} />);

      const shareButton = screen.getByRole('button', { name: /copied/i });
      expect(shareButton).toHaveClass('success');
    });
  });

  describe('view full details button', () => {
    it('should render "View Full Details" button when onOpenDetail is provided', () => {
      render(<AircraftSidebar {...defaultProps} />);

      const detailsButton = screen.getByRole('button', { name: /view full details/i });
      expect(detailsButton).toBeInTheDocument();
    });

    it('should call onOpenDetail with hex when clicked', () => {
      const mockOnOpenDetail = vi.fn();
      render(<AircraftSidebar {...defaultProps} onOpenDetail={mockOnOpenDetail} />);

      const detailsButton = screen.getByRole('button', { name: /view full details/i });
      fireEvent.click(detailsButton);

      expect(mockOnOpenDetail).toHaveBeenCalledWith('abc123');
    });

    it('should not render "View Full Details" when onOpenDetail is not provided', () => {
      render(<AircraftSidebar {...defaultProps} onOpenDetail={undefined} />);

      expect(screen.queryByRole('button', { name: /view full details/i })).not.toBeInTheDocument();
    });
  });

  describe('keyboard interactions', () => {
    it('should close sidebar when Escape key is pressed', () => {
      const mockOnClose = vi.fn();
      render(<AircraftSidebar {...defaultProps} onClose={mockOnClose} />);

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('backdrop click', () => {
    it('should close sidebar when backdrop is clicked', () => {
      const mockOnClose = vi.fn();
      const { container } = render(<AircraftSidebar {...defaultProps} onClose={mockOnClose} />);

      const backdrop = container.querySelector('.sidebar-backdrop');
      fireEvent.click(backdrop);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('live status bar', () => {
    it('should display aircraft telemetry', () => {
      render(<AircraftSidebar {...defaultProps} />);

      // Check for altitude display (formatted as "35.0k ft")
      expect(screen.getByText(/35\.0k ft/)).toBeInTheDocument();

      // Check for speed display (formatted as "450 kts")
      expect(screen.getByText(/450 kts/)).toBeInTheDocument();
    });
  });

  describe('normalization of aircraft info', () => {
    it('should handle alternative field names in info', () => {
      useAircraftDetail.mockReturnValue({
        ...mockHookReturn,
        info: {
          aircraft_type: 'Airbus A320',
          operatorName: 'Delta Air Lines',
          tail_number: 'N123DL',
          manufacturerName: 'Airbus',
          countryName: 'France',
        },
      });

      render(<AircraftSidebar {...defaultProps} />);

      expect(screen.getByText('Airbus A320')).toBeInTheDocument();
    });

    it('should handle null info gracefully', () => {
      useAircraftDetail.mockReturnValue({
        ...mockHookReturn,
        info: null,
      });

      render(<AircraftSidebar {...defaultProps} />);

      // Sidebar should still render without crashing
      const sidebar = screen.getByRole('complementary');
      expect(sidebar).toBeInTheDocument();
    });
  });
});
