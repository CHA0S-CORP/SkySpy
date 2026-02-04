import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AircraftDetailPage } from './AircraftDetailPage';

// Mock the hooks
vi.mock('./hooks/useAircraftDetail', () => ({
  useAircraftDetail: vi.fn(),
}));

// Mock lazy-loaded components
vi.mock('./tabs/OverviewTab', () => ({
  OverviewTab: ({ info, aircraft }) => (
    <div data-testid="overview-tab">
      OverviewTab - {info?.type_name || 'No info'}
    </div>
  ),
}));

vi.mock('./tabs/CommunicationsTab', () => ({
  CommunicationsTab: () => <div data-testid="communications-tab">CommunicationsTab</div>,
}));

vi.mock('./tabs/SafetyTab', () => ({
  SafetyTab: () => <div data-testid="safety-tab">SafetyTab</div>,
}));

vi.mock('./tabs/TrackTab', () => ({
  TrackTab: () => <div data-testid="track-tab">TrackTab</div>,
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Radar: () => <span data-testid="radar-icon">Radar</span>,
  AlertTriangle: () => <span data-testid="alert-icon">AlertTriangle</span>,
  RefreshCw: () => <span data-testid="refresh-icon">RefreshCw</span>,
  X: () => <span data-testid="x-icon">X</span>,
  Share2: () => <span data-testid="share-icon">Share2</span>,
  Check: () => <span data-testid="check-icon">Check</span>,
  Camera: () => <span data-testid="camera-icon">Camera</span>,
  ExternalLink: () => <span data-testid="external-link-icon">ExternalLink</span>,
  LayoutDashboard: () => <span data-testid="layout-icon">LayoutDashboard</span>,
  MessageSquare: () => <span data-testid="message-icon">MessageSquare</span>,
  Map: () => <span data-testid="map-icon">Map</span>,
}));

import { useAircraftDetail } from './hooks/useAircraftDetail';

describe('AircraftDetailPage', () => {
  const defaultProps = {
    hex: 'abc123',
    apiUrl: 'http://localhost:8000',
    onClose: vi.fn(),
    onSelectAircraft: vi.fn(),
    onViewHistoryEvent: vi.fn(),
    onViewEvent: vi.fn(),
    aircraft: {
      hex: 'abc123',
      flight: 'UAL123',
      lat: 37.7749,
      lon: -122.4194,
      alt_baro: 35000,
      gs: 450,
    },
    aircraftInfo: null,
    trackHistory: [],
    feederLocation: { lat: 37.5, lon: -122.0 },
    wsRequest: vi.fn(),
    wsConnected: true,
    initialTab: 'overview',
    onTabChange: vi.fn(),
  };

  const mockHookReturn = {
    info: { type_name: 'Boeing 737-800', operator: 'United Airlines' },
    loading: false,
    error: null,
    retry: vi.fn(),
    activeTab: 'overview',
    setActiveTab: vi.fn(),
    tailInfo: { flag: '🇺🇸', country: '🇺🇸 US', tailNumber: 'N12345' },
    baseUrl: 'http://localhost:8000',
    shareSuccess: false,
    handleShare: vi.fn(),
    calculateDistance: vi.fn().mockReturnValue(15.5),
    photoInfo: { photo_url: 'https://example.com/photo.jpg', photographer: 'Test' },
    photoUrl: 'https://example.com/photo.jpg',
    photoState: 'loaded',
    photoRetryCount: 0,
    useThumbnail: false,
    photoStatus: null,
    handlePhotoError: vi.fn(),
    handlePhotoLoad: vi.fn(),
    retryPhoto: vi.fn(),
    acarsMessages: [],
    acarsHours: 24,
    setAcarsHours: vi.fn(),
    acarsCompactMode: false,
    setAcarsCompactMode: vi.fn(),
    acarsQuickFilters: {},
    setAcarsQuickFilters: vi.fn(),
    expandedMessages: {},
    setExpandedMessages: vi.fn(),
    allMessagesExpanded: false,
    setAllMessagesExpanded: vi.fn(),
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
    radioTransmissions: [],
    radioHours: 24,
    setRadioHours: vi.fn(),
    radioLoading: false,
    radioSearchQuery: '',
    setRadioSearchQuery: vi.fn(),
    radioStatusFilter: 'all',
    setRadioStatusFilter: vi.fn(),
    radioPlayingId: null,
    radioAudioProgress: {},
    radioAudioDurations: {},
    radioExpandedTranscript: null,
    setRadioExpandedTranscript: vi.fn(),
    radioAutoplay: false,
    filteredRadioTransmissions: [],
    handleRadioPlay: vi.fn(),
    handleRadioSeek: vi.fn(),
    toggleRadioAutoplay: vi.fn(),
    sightings: [],
    showTrackMap: false,
    setShowTrackMap: vi.fn(),
    replayPosition: 0,
    setReplayPosition: vi.fn(),
    isPlaying: false,
    setIsPlaying: vi.fn(),
    trackReplayPosition: 0,
    setTrackReplayPosition: vi.fn(),
    trackIsPlaying: false,
    setTrackIsPlaying: vi.fn(),
    trackReplaySpeed: 1,
    setTrackReplaySpeed: vi.fn(),
    showTrackPoints: false,
    setShowTrackPoints: vi.fn(),
    trackLiveMode: true,
    setTrackLiveMode: vi.fn(),
    showTelemOverlay: true,
    setShowTelemOverlay: vi.fn(),
    graphZoom: 1,
    setGraphZoom: vi.fn(),
    graphScrollOffset: 0,
    setGraphScrollOffset: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useAircraftDetail.mockReturnValue(mockHookReturn);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('rendering', () => {
    it('should render the aircraft detail page with correct aria attributes', async () => {
      render(<AircraftDetailPage {...defaultProps} />);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute('aria-label', 'Aircraft details for UAL123');
    });

    it('should render with hex when no flight callsign', async () => {
      const propsWithoutFlight = {
        ...defaultProps,
        aircraft: { ...defaultProps.aircraft, flight: null },
      };
      render(<AircraftDetailPage {...propsWithoutFlight} />);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-label', 'Aircraft details for abc123');
    });
  });

  describe('loading state', () => {
    it('should display loading indicator when loading', () => {
      useAircraftDetail.mockReturnValue({
        ...mockHookReturn,
        loading: true,
      });

      render(<AircraftDetailPage {...defaultProps} />);

      expect(screen.getByText('Loading aircraft data...')).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
    });
  });

  describe('error state', () => {
    it('should display error message and retry button when error occurs', () => {
      const mockRetry = vi.fn();
      useAircraftDetail.mockReturnValue({
        ...mockHookReturn,
        error: { message: 'Failed to load aircraft data' },
        retry: mockRetry,
      });

      render(<AircraftDetailPage {...defaultProps} />);

      expect(screen.getByText('Failed to Load')).toBeInTheDocument();
      expect(screen.getByText('Failed to load aircraft data')).toBeInTheDocument();

      const retryButton = screen.getByRole('button', { name: /retry/i });
      expect(retryButton).toBeInTheDocument();

      fireEvent.click(retryButton);
      expect(mockRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe('tab navigation', () => {
    it('should render tab navigation component', async () => {
      render(<AircraftDetailPage {...defaultProps} />);

      // TabNavigation should be rendered
      const tabList = screen.getByRole('tablist');
      expect(tabList).toBeInTheDocument();
    });

    it('should call setActiveTab when tab is changed', async () => {
      const mockSetActiveTab = vi.fn();
      useAircraftDetail.mockReturnValue({
        ...mockHookReturn,
        setActiveTab: mockSetActiveTab,
      });

      render(<AircraftDetailPage {...defaultProps} />);

      // Find and click the Safety tab
      const safetyTab = screen.getByRole('tab', { name: /safety/i });
      fireEvent.click(safetyTab);

      expect(mockSetActiveTab).toHaveBeenCalledWith('safety');
    });
  });

  describe('tab content rendering', () => {
    it('should render OverviewTab when activeTab is overview', async () => {
      useAircraftDetail.mockReturnValue({
        ...mockHookReturn,
        activeTab: 'overview',
      });

      render(<AircraftDetailPage {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('overview-tab')).toBeInTheDocument();
      });
    });

    it('should render CommunicationsTab when activeTab is communications', async () => {
      useAircraftDetail.mockReturnValue({
        ...mockHookReturn,
        activeTab: 'communications',
      });

      render(<AircraftDetailPage {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('communications-tab')).toBeInTheDocument();
      });
    });

    it('should render SafetyTab when activeTab is safety', async () => {
      useAircraftDetail.mockReturnValue({
        ...mockHookReturn,
        activeTab: 'safety',
      });

      render(<AircraftDetailPage {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('safety-tab')).toBeInTheDocument();
      });
    });

    it('should render TrackTab when activeTab is track', async () => {
      useAircraftDetail.mockReturnValue({
        ...mockHookReturn,
        activeTab: 'track',
      });

      render(<AircraftDetailPage {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('track-tab')).toBeInTheDocument();
      });
    });

    it('should fallback to OverviewTab for unknown tab', async () => {
      useAircraftDetail.mockReturnValue({
        ...mockHookReturn,
        activeTab: 'unknown_tab',
      });

      render(<AircraftDetailPage {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('overview-tab')).toBeInTheDocument();
      });
    });
  });

  describe('header interactions', () => {
    it('should call handleShare when share button is clicked', () => {
      const mockHandleShare = vi.fn();
      useAircraftDetail.mockReturnValue({
        ...mockHookReturn,
        handleShare: mockHandleShare,
      });

      render(<AircraftDetailPage {...defaultProps} />);

      const shareButton = screen.getByRole('button', { name: /share/i });
      fireEvent.click(shareButton);

      expect(mockHandleShare).toHaveBeenCalledTimes(1);
    });

    it('should call onClose when close button is clicked', () => {
      const mockOnClose = vi.fn();
      render(<AircraftDetailPage {...defaultProps} onClose={mockOnClose} />);

      const closeButton = screen.getByRole('button', { name: /close/i });
      fireEvent.click(closeButton);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('should show success state after sharing', () => {
      useAircraftDetail.mockReturnValue({
        ...mockHookReturn,
        shareSuccess: true,
      });

      render(<AircraftDetailPage {...defaultProps} />);

      const shareButton = screen.getByRole('button', { name: /link copied/i });
      expect(shareButton).toHaveClass('success');
    });
  });

  describe('external links', () => {
    it('should render external links section', () => {
      render(<AircraftDetailPage {...defaultProps} />);

      const linksNav = screen.getByRole('navigation', { name: /external resources/i });
      expect(linksNav).toBeInTheDocument();

      expect(screen.getByRole('link', { name: /flightaware/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /adsbexchange/i })).toBeInTheDocument();
    });
  });

  describe('badge counts', () => {
    it('should pass correct counts to TabNavigation', () => {
      useAircraftDetail.mockReturnValue({
        ...mockHookReturn,
        radioTransmissions: [{ id: 1 }, { id: 2 }],
        acarsMessages: [{ id: 1 }],
        safetyEvents: [{ id: 1 }, { id: 2 }, { id: 3 }],
      });

      render(<AircraftDetailPage {...defaultProps} />);

      // Communications badge should show 3 (2 radio + 1 ACARS)
      const commsBadge = screen.getByLabelText(/3 comms/i);
      expect(commsBadge).toBeInTheDocument();

      // Safety badge should show 3
      const safetyBadge = screen.getByLabelText(/3 safety/i);
      expect(safetyBadge).toBeInTheDocument();
    });
  });
});
