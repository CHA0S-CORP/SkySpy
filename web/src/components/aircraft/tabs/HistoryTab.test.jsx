import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HistoryTab } from './HistoryTab';

// Mock lucide-react
vi.mock('lucide-react', () => ({
  History: () => <span data-testid="history-icon">History</span>,
  Map: () => <span data-testid="map-icon">Map</span>,
  Play: () => <span data-testid="play-icon">Play</span>,
  Pause: () => <span data-testid="pause-icon">Pause</span>,
  SkipBack: () => <span data-testid="skip-back">SkipBack</span>,
  SkipForward: () => <span data-testid="skip-forward">SkipForward</span>,
  RotateCcw: () => <span data-testid="rotate-icon">RotateCcw</span>,
}));

// Mock Leaflet
vi.mock('leaflet', () => {
  const mockMapInstance = {
    remove: vi.fn(),
    removeLayer: vi.fn(),
    addLayer: vi.fn(),
    fitBounds: vi.fn(),
    setView: vi.fn(),
    panTo: vi.fn(),
  };

  return {
    default: {
      map: vi.fn().mockReturnValue(mockMapInstance),
      tileLayer: vi.fn().mockReturnValue({ addTo: vi.fn() }),
      marker: vi.fn().mockReturnValue({ addTo: vi.fn() }),
      polyline: vi.fn().mockReturnValue({ addTo: vi.fn() }),
      circleMarker: vi.fn().mockReturnValue({
        addTo: vi.fn().mockReturnValue({ bindPopup: vi.fn() }),
      }),
      divIcon: vi.fn(),
      latLngBounds: vi.fn().mockReturnValue({ pad: vi.fn() }),
    },
  };
});

// Mock MiniGraph
vi.mock('../components/MiniGraph', () => ({
  MiniGraph: ({ label }) => <div data-testid={`mini-graph-${label.toLowerCase()}`}>{label}</div>,
  useGraphInteraction: () => ({
    handleGraphWheel: vi.fn(),
    handleGraphDragStart: vi.fn(),
    handleGraphDragMove: vi.fn(),
    handleGraphDragEnd: vi.fn(),
    resetGraphZoom: vi.fn(),
  }),
}));

// Mock ReplayControls
vi.mock('../components/ReplayControls', () => ({
  ReplayControls: ({ onPlayToggle, onSkipToStart, onSkipToEnd, onPositionChange }) => (
    <div data-testid="replay-controls">
      <button data-testid="play-btn" onClick={onPlayToggle}>
        Play/Pause
      </button>
      <button data-testid="skip-start-btn" onClick={onSkipToStart}>
        Skip to Start
      </button>
      <button data-testid="skip-end-btn" onClick={onSkipToEnd}>
        Skip to End
      </button>
      <input
        data-testid="position-slider"
        type="range"
        onChange={(e) => onPositionChange(Number(e.target.value))}
      />
    </div>
  ),
}));

describe('HistoryTab', () => {
  const mockSightings = [
    {
      lat: 37.7749,
      lon: -122.4194,
      altitude: 35000,
      gs: 450,
      vr: 500,
      track: 180,
      timestamp: '2024-01-15T12:00:00Z',
      distance_nm: 15.5,
    },
    {
      lat: 37.78,
      lon: -122.42,
      altitude: 34500,
      gs: 445,
      vr: -200,
      track: 175,
      timestamp: '2024-01-15T11:59:00Z',
      distance_nm: 16.2,
    },
    {
      lat: 37.79,
      lon: -122.43,
      altitude: 34000,
      gs: 440,
      vr: -300,
      track: 170,
      timestamp: '2024-01-15T11:58:00Z',
      distance_nm: 17.0,
    },
  ];

  const defaultProps = {
    sightings: mockSightings,
    feederLocation: { lat: 37.5, lon: -122.0 },
    showTrackMap: false,
    setShowTrackMap: vi.fn(),
    replayPosition: 0,
    setReplayPosition: vi.fn(),
    isPlaying: false,
    setIsPlaying: vi.fn(),
    graphZoom: 1,
    setGraphZoom: vi.fn(),
    graphScrollOffset: 0,
    setGraphScrollOffset: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('empty state', () => {
    it('should render empty state when sightings array is empty', () => {
      render(<HistoryTab {...defaultProps} sightings={[]} />);

      expect(screen.getByText('No sighting history')).toBeInTheDocument();
      expect(
        screen.getByText('No position reports recorded in the last 24 hours')
      ).toBeInTheDocument();
      expect(screen.getByTestId('history-icon')).toBeInTheDocument();
    });

    it('should have correct role for empty state', () => {
      render(<HistoryTab {...defaultProps} sightings={[]} />);

      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  describe('with sightings data', () => {
    it('should display sighting count', () => {
      render(<HistoryTab {...defaultProps} />);

      expect(screen.getByText(/3 position reports in the last 24 hours/)).toBeInTheDocument();
    });

    it('should render map toggle button', () => {
      render(<HistoryTab {...defaultProps} />);

      expect(screen.getByRole('button', { name: /show map/i })).toBeInTheDocument();
    });

    it('should call setShowTrackMap when map toggle is clicked', () => {
      const mockSetShowTrackMap = vi.fn();
      render(<HistoryTab {...defaultProps} setShowTrackMap={mockSetShowTrackMap} />);

      const button = screen.getByRole('button', { name: /show map/i });
      fireEvent.click(button);

      expect(mockSetShowTrackMap).toHaveBeenCalledWith(true);
    });

    it('should show Hide Map when map is visible', () => {
      render(<HistoryTab {...defaultProps} showTrackMap={true} />);

      expect(screen.getByRole('button', { name: /hide map/i })).toBeInTheDocument();
    });
  });

  describe('history table', () => {
    it('should render table with correct headers', () => {
      render(<HistoryTab {...defaultProps} />);

      expect(screen.getByRole('columnheader', { name: 'Time' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Alt (ft)' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Speed (kts)' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Dist (nm)' })).toBeInTheDocument();
    });

    it('should render sighting rows', () => {
      render(<HistoryTab {...defaultProps} />);

      // Check for altitude values
      expect(screen.getByText('35,000')).toBeInTheDocument();
      expect(screen.getByText('34,500')).toBeInTheDocument();
      expect(screen.getByText('34,000')).toBeInTheDocument();

      // Check for speed values
      expect(screen.getByText('450')).toBeInTheDocument();
      expect(screen.getByText('445')).toBeInTheDocument();
      expect(screen.getByText('440')).toBeInTheDocument();

      // Check for distance values
      expect(screen.getByText('15.5')).toBeInTheDocument();
      expect(screen.getByText('16.2')).toBeInTheDocument();
      expect(screen.getByText('17.0')).toBeInTheDocument();
    });

    it('should limit displayed rows to 50', () => {
      // Create 60 sightings
      const manySightings = Array.from({ length: 60 }, (_, i) => ({
        lat: 37.77 + i * 0.01,
        lon: -122.41,
        altitude: 35000 - i * 100,
        gs: 450,
        vr: 0,
        track: 180,
        timestamp: new Date(2024, 0, 15, 12, i).toISOString(),
        distance_nm: 15.5 + i * 0.1,
      }));

      render(<HistoryTab {...defaultProps} sightings={manySightings} />);

      // Count data rows (excluding header)
      const rows = screen.getAllByRole('row');
      // 1 header row + 50 data rows = 51
      expect(rows.length).toBe(51);
    });
  });

  describe('map container', () => {
    it('should render map container when showTrackMap is true', () => {
      const { container } = render(<HistoryTab {...defaultProps} showTrackMap={true} />);

      expect(container.querySelector('.history-map')).toBeInTheDocument();
    });

    it('should not render map container when showTrackMap is false', () => {
      const { container } = render(<HistoryTab {...defaultProps} showTrackMap={false} />);

      expect(container.querySelector('.history-map')).not.toBeInTheDocument();
    });

    it('should render MiniGraphs when map is shown', () => {
      render(<HistoryTab {...defaultProps} showTrackMap={true} />);

      expect(screen.getByTestId('mini-graph-altitude')).toBeInTheDocument();
      expect(screen.getByTestId('mini-graph-speed')).toBeInTheDocument();
      expect(screen.getByTestId('mini-graph-v/s')).toBeInTheDocument();
    });

    it('should render ReplayControls when map is shown', () => {
      render(<HistoryTab {...defaultProps} showTrackMap={true} />);

      expect(screen.getByTestId('replay-controls')).toBeInTheDocument();
    });

    it('should render map legend when map is shown', () => {
      render(<HistoryTab {...defaultProps} showTrackMap={true} />);

      expect(screen.getByText('Current Position')).toBeInTheDocument();
      expect(screen.getByText('Start')).toBeInTheDocument();
    });

    it('should render feeder legend item when feederLocation is provided', () => {
      render(<HistoryTab {...defaultProps} showTrackMap={true} />);

      expect(screen.getByText('Feeder')).toBeInTheDocument();
    });

    it('should not render feeder legend when feederLocation is null', () => {
      render(<HistoryTab {...defaultProps} showTrackMap={true} feederLocation={null} />);

      expect(screen.queryByText('Feeder')).not.toBeInTheDocument();
    });
  });

  describe('replay controls interaction', () => {
    it('should call setIsPlaying when play button is clicked', () => {
      const mockSetIsPlaying = vi.fn();
      render(<HistoryTab {...defaultProps} showTrackMap={true} setIsPlaying={mockSetIsPlaying} />);

      const playBtn = screen.getByTestId('play-btn');
      fireEvent.click(playBtn);

      expect(mockSetIsPlaying).toHaveBeenCalled();
    });

    it('should reset position when skip to start is clicked', () => {
      const mockSetReplayPosition = vi.fn();
      const mockSetIsPlaying = vi.fn();
      render(
        <HistoryTab
          {...defaultProps}
          showTrackMap={true}
          setReplayPosition={mockSetReplayPosition}
          setIsPlaying={mockSetIsPlaying}
        />
      );

      const skipStartBtn = screen.getByTestId('skip-start-btn');
      fireEvent.click(skipStartBtn);

      expect(mockSetIsPlaying).toHaveBeenCalledWith(false);
      expect(mockSetReplayPosition).toHaveBeenCalledWith(0);
    });

    it('should set position to 100 when skip to end is clicked', () => {
      const mockSetReplayPosition = vi.fn();
      const mockSetIsPlaying = vi.fn();
      render(
        <HistoryTab
          {...defaultProps}
          showTrackMap={true}
          setReplayPosition={mockSetReplayPosition}
          setIsPlaying={mockSetIsPlaying}
        />
      );

      const skipEndBtn = screen.getByTestId('skip-end-btn');
      fireEvent.click(skipEndBtn);

      expect(mockSetIsPlaying).toHaveBeenCalledWith(false);
      expect(mockSetReplayPosition).toHaveBeenCalledWith(100);
    });

    it('should have position slider in replay controls', () => {
      render(<HistoryTab {...defaultProps} showTrackMap={true} />);

      const slider = screen.getByTestId('position-slider');
      expect(slider).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('should have correct tabpanel role', () => {
      render(<HistoryTab {...defaultProps} />);

      const tabPanel = screen.getByRole('tabpanel');
      expect(tabPanel).toBeInTheDocument();
      expect(tabPanel).toHaveAttribute('aria-labelledby', 'tab-history');
      expect(tabPanel).toHaveAttribute('id', 'panel-history');
    });

    it('should have aria-pressed on map toggle button', () => {
      render(<HistoryTab {...defaultProps} showTrackMap={true} />);

      const button = screen.getByRole('button', { name: /hide map/i });
      expect(button).toHaveAttribute('aria-pressed', 'true');
    });

    it('should have live region for sighting count', () => {
      render(<HistoryTab {...defaultProps} />);

      const liveRegion = screen.getByText(/3 position reports/).closest('p');
      expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    });

    it('should have table role on history table', () => {
      render(<HistoryTab {...defaultProps} />);

      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    it('should have application role on map', () => {
      render(<HistoryTab {...defaultProps} showTrackMap={true} />);

      expect(screen.getByRole('application', { name: /flight history map/i })).toBeInTheDocument();
    });
  });

  describe('edge cases', () => {
    it('should handle sightings without lat/lon', () => {
      const sightingsWithMissingCoords = [
        { altitude: 35000, gs: 450, timestamp: '2024-01-15T12:00:00Z' },
        ...mockSightings,
      ];

      render(<HistoryTab {...defaultProps} sightings={sightingsWithMissingCoords} />);

      // Should still render
      expect(screen.getByText(/4 position reports/)).toBeInTheDocument();
    });

    it('should handle missing altitude gracefully', () => {
      const sightingsWithNullAlt = [{ ...mockSightings[0], altitude: null }];

      render(<HistoryTab {...defaultProps} sightings={sightingsWithNullAlt} />);

      expect(screen.getByText('--')).toBeInTheDocument();
    });

    it('should handle missing distance gracefully', () => {
      const sightingsWithNullDist = [{ ...mockSightings[0], distance_nm: null }];

      render(<HistoryTab {...defaultProps} sightings={sightingsWithNullDist} />);

      expect(screen.getAllByText('--').length).toBeGreaterThan(0);
    });
  });
});
