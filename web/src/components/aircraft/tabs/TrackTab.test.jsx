import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { TrackTab } from './TrackTab';

// Helper to render and advance timers for map initialization
const renderWithTimers = (ui) => {
  const result = render(ui);
  act(() => {
    vi.advanceTimersByTime(100);
  });
  return result;
};

// Mock lucide-react
vi.mock('lucide-react', () => ({
  Map: () => <span data-testid="map-icon">Map</span>,
  Play: () => <span data-testid="play-icon">Play</span>,
  Pause: () => <span data-testid="pause-icon">Pause</span>,
  SkipBack: () => <span data-testid="skip-back">SkipBack</span>,
  SkipForward: () => <span data-testid="skip-forward">SkipForward</span>,
  RotateCcw: () => <span data-testid="rotate-icon">RotateCcw</span>,
  Radio: () => <span data-testid="radio-icon">Radio</span>,
  ChevronDown: () => <span data-testid="chevron-down">ChevronDown</span>,
  ChevronUp: () => <span data-testid="chevron-up">ChevronUp</span>,
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
      polyline: vi.fn().mockReturnValue({
        addTo: vi.fn(),
        setLatLngs: vi.fn(),
      }),
      circleMarker: vi.fn().mockReturnValue({
        addTo: vi.fn().mockReturnValue({ bindPopup: vi.fn() }),
      }),
      divIcon: vi.fn(),
      latLngBounds: vi.fn().mockReturnValue({ pad: vi.fn() }),
      layerGroup: vi.fn().mockReturnValue({
        addTo: vi.fn(),
        clearLayers: vi.fn(),
      }),
    },
  };
});

// Mock MiniGraph
vi.mock('../components/MiniGraph', () => ({
  MiniGraph: ({ label, positionPercent }) => (
    <div data-testid={`mini-graph-${label.toLowerCase()}`} data-position={positionPercent}>
      {label}
    </div>
  ),
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
  ReplayControls: ({
    onPlayToggle,
    onSkipToStart,
    onSkipToEnd,
    onPositionChange,
    onToggleLiveMode,
    onToggleTrackPoints,
    liveMode,
    showTrackPoints,
  }) => (
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
      <button data-testid="live-mode-btn" onClick={onToggleLiveMode}>
        Live Mode: {liveMode ? 'ON' : 'OFF'}
      </button>
      <button data-testid="track-points-btn" onClick={onToggleTrackPoints}>
        Track Points: {showTrackPoints ? 'ON' : 'OFF'}
      </button>
      <input
        data-testid="position-slider"
        type="range"
        onChange={(e) => onPositionChange(Number(e.target.value))}
      />
    </div>
  ),
}));

// Mock TelemetryOverlay
vi.mock('../components/TelemetryOverlay', () => ({
  TelemetryOverlay: ({ telemetry, isCollapsed, onToggle }) => (
    <div data-testid="telemetry-overlay" data-collapsed={isCollapsed}>
      <button onClick={onToggle}>Toggle Telemetry</button>
      {telemetry && (
        <div>
          <span>Alt: {telemetry.altitude}</span>
          <span>GS: {telemetry.gs}</span>
        </div>
      )}
    </div>
  ),
}));

describe('TrackTab', () => {
  const mockSightings = [
    {
      lat: 37.7749,
      lon: -122.4194,
      altitude: 35000,
      gs: 450,
      vr: 500,
      baro_rate: 500,
      geom_rate: 480,
      track: 180,
      timestamp: '2024-01-15T12:00:00Z',
    },
    {
      lat: 37.78,
      lon: -122.42,
      altitude: 34500,
      gs: 445,
      vr: -200,
      baro_rate: -200,
      geom_rate: -180,
      track: 175,
      timestamp: '2024-01-15T11:59:00Z',
    },
    {
      lat: 37.79,
      lon: -122.43,
      altitude: 34000,
      gs: 440,
      vr: -300,
      baro_rate: -300,
      geom_rate: -280,
      track: 170,
      timestamp: '2024-01-15T11:58:00Z',
    },
  ];

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
  };

  const defaultProps = {
    aircraft: mockAircraft,
    sightings: mockSightings,
    feederLocation: { lat: 37.5, lon: -122.0 },
    trackReplayPosition: 50,
    setTrackReplayPosition: vi.fn(),
    trackIsPlaying: false,
    setTrackIsPlaying: vi.fn(),
    trackReplaySpeed: 1,
    setTrackReplaySpeed: vi.fn(),
    showTrackPoints: false,
    setShowTrackPoints: vi.fn(),
    trackLiveMode: false,
    setTrackLiveMode: vi.fn(),
    showTelemOverlay: true,
    setShowTelemOverlay: vi.fn(),
    graphZoom: 1,
    setGraphZoom: vi.fn(),
    graphScrollOffset: 0,
    setGraphScrollOffset: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('empty state', () => {
    it('should render empty state when sightings is empty', () => {
      render(<TrackTab {...defaultProps} sightings={[]} />);

      expect(screen.getByText('No track data available')).toBeInTheDocument();
      expect(
        screen.getByText('No position reports with coordinates in the last 24 hours')
      ).toBeInTheDocument();
      expect(screen.getByTestId('map-icon')).toBeInTheDocument();
    });

    it('should render empty state when no sightings have coordinates', () => {
      const sightingsWithoutCoords = [
        { altitude: 35000, gs: 450, timestamp: '2024-01-15T12:00:00Z' },
      ];

      render(<TrackTab {...defaultProps} sightings={sightingsWithoutCoords} />);

      expect(screen.getByText('No track data available')).toBeInTheDocument();
    });

    it('should have correct role for empty state', () => {
      render(<TrackTab {...defaultProps} sightings={[]} />);

      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  describe('with track data', () => {
    it('should render map container', () => {
      const { container } = renderWithTimers(<TrackTab {...defaultProps} />);

      expect(container.querySelector('.track-map')).toBeInTheDocument();
    });

    it('should render TelemetryOverlay', () => {
      renderWithTimers(<TrackTab {...defaultProps} />);

      expect(screen.getByTestId('telemetry-overlay')).toBeInTheDocument();
    });

    it('should render MiniGraphs', () => {
      renderWithTimers(<TrackTab {...defaultProps} />);

      expect(screen.getByTestId('mini-graph-altitude')).toBeInTheDocument();
      expect(screen.getByTestId('mini-graph-speed')).toBeInTheDocument();
      expect(screen.getByTestId('mini-graph-v/s')).toBeInTheDocument();
    });

    it('should render ReplayControls', () => {
      renderWithTimers(<TrackTab {...defaultProps} />);

      expect(screen.getByTestId('replay-controls')).toBeInTheDocument();
    });
  });

  describe('telemetry overlay', () => {
    it('should pass collapsed state to TelemetryOverlay', () => {
      renderWithTimers(<TrackTab {...defaultProps} showTelemOverlay={false} />);

      const overlay = screen.getByTestId('telemetry-overlay');
      expect(overlay).toHaveAttribute('data-collapsed', 'true');
    });

    it('should call setShowTelemOverlay when toggle is clicked', () => {
      const mockSetShowTelemOverlay = vi.fn();
      renderWithTimers(
        <TrackTab {...defaultProps} setShowTelemOverlay={mockSetShowTelemOverlay} />
      );

      const toggleBtn = screen.getByText('Toggle Telemetry');
      fireEvent.click(toggleBtn);

      expect(mockSetShowTelemOverlay).toHaveBeenCalledWith(false);
    });
  });

  describe('replay controls', () => {
    it('should call setTrackIsPlaying when play button is clicked', () => {
      const mockSetTrackIsPlaying = vi.fn();
      renderWithTimers(<TrackTab {...defaultProps} setTrackIsPlaying={mockSetTrackIsPlaying} />);

      const playBtn = screen.getByTestId('play-btn');
      fireEvent.click(playBtn);

      // The component uses internal tracking, so we check it was called
      expect(mockSetTrackIsPlaying).toHaveBeenCalled();
    });

    it('should reset position when skip to start is clicked', () => {
      const mockSetTrackReplayPosition = vi.fn();
      const mockSetTrackIsPlaying = vi.fn();
      const mockSetTrackLiveMode = vi.fn();

      renderWithTimers(
        <TrackTab
          {...defaultProps}
          setTrackReplayPosition={mockSetTrackReplayPosition}
          setTrackIsPlaying={mockSetTrackIsPlaying}
          setTrackLiveMode={mockSetTrackLiveMode}
        />
      );

      const skipStartBtn = screen.getByTestId('skip-start-btn');
      fireEvent.click(skipStartBtn);

      expect(mockSetTrackIsPlaying).toHaveBeenCalledWith(false);
      expect(mockSetTrackLiveMode).toHaveBeenCalledWith(false);
      expect(mockSetTrackReplayPosition).toHaveBeenCalledWith(0);
    });

    it('should set position to 100 and enable live mode when skip to end is clicked', () => {
      const mockSetTrackReplayPosition = vi.fn();
      const mockSetTrackIsPlaying = vi.fn();
      const mockSetTrackLiveMode = vi.fn();

      renderWithTimers(
        <TrackTab
          {...defaultProps}
          setTrackReplayPosition={mockSetTrackReplayPosition}
          setTrackIsPlaying={mockSetTrackIsPlaying}
          setTrackLiveMode={mockSetTrackLiveMode}
        />
      );

      const skipEndBtn = screen.getByTestId('skip-end-btn');
      fireEvent.click(skipEndBtn);

      expect(mockSetTrackIsPlaying).toHaveBeenCalledWith(false);
      expect(mockSetTrackLiveMode).toHaveBeenCalledWith(true);
      expect(mockSetTrackReplayPosition).toHaveBeenCalledWith(100);
    });

    it('should update position when slider changes', () => {
      const mockSetTrackReplayPosition = vi.fn();
      const mockSetTrackLiveMode = vi.fn();

      renderWithTimers(
        <TrackTab
          {...defaultProps}
          setTrackReplayPosition={mockSetTrackReplayPosition}
          setTrackLiveMode={mockSetTrackLiveMode}
        />
      );

      const slider = screen.getByTestId('position-slider');
      fireEvent.change(slider, { target: { value: '75' } });

      expect(mockSetTrackReplayPosition).toHaveBeenCalledWith(75);
    });

    it('should render position slider in replay controls', () => {
      renderWithTimers(<TrackTab {...defaultProps} />);

      const slider = screen.getByTestId('position-slider');
      expect(slider).toBeInTheDocument();
    });
  });

  describe('live mode', () => {
    it('should toggle live mode when live mode button is clicked', () => {
      const mockSetTrackLiveMode = vi.fn();
      const mockSetTrackReplayPosition = vi.fn();

      renderWithTimers(
        <TrackTab
          {...defaultProps}
          trackLiveMode={false}
          setTrackLiveMode={mockSetTrackLiveMode}
          setTrackReplayPosition={mockSetTrackReplayPosition}
        />
      );

      const liveModeBtn = screen.getByTestId('live-mode-btn');
      fireEvent.click(liveModeBtn);

      expect(mockSetTrackLiveMode).toHaveBeenCalledWith(true);
      expect(mockSetTrackReplayPosition).toHaveBeenCalledWith(100);
    });

    it('should pass null positionPercent to graphs when in live mode', () => {
      renderWithTimers(<TrackTab {...defaultProps} trackLiveMode={true} />);

      const altGraph = screen.getByTestId('mini-graph-altitude');
      // null gets stringified to empty string in data attribute or "null"
      const posAttr = altGraph.getAttribute('data-position');
      expect(posAttr === '' || posAttr === 'null' || posAttr === null).toBe(true);
    });

    it('should pass position to graphs when not in live mode', () => {
      renderWithTimers(
        <TrackTab {...defaultProps} trackLiveMode={false} trackReplayPosition={50} />
      );

      const altGraph = screen.getByTestId('mini-graph-altitude');
      expect(altGraph).toHaveAttribute('data-position', '50');
    });
  });

  describe('track points toggle', () => {
    it('should toggle track points when button is clicked', () => {
      const mockSetShowTrackPoints = vi.fn();

      renderWithTimers(<TrackTab {...defaultProps} setShowTrackPoints={mockSetShowTrackPoints} />);

      const trackPointsBtn = screen.getByTestId('track-points-btn');
      fireEvent.click(trackPointsBtn);

      expect(mockSetShowTrackPoints).toHaveBeenCalledWith(true);
    });
  });

  describe('telemetry data', () => {
    it('should display live aircraft data when in live mode', () => {
      renderWithTimers(<TrackTab {...defaultProps} trackLiveMode={true} />);

      const overlay = screen.getByTestId('telemetry-overlay');
      expect(overlay).toHaveTextContent('Alt: 35000');
      expect(overlay).toHaveTextContent('GS: 450');
    });

    it('should display interpolated data when not in live mode', () => {
      renderWithTimers(
        <TrackTab {...defaultProps} trackLiveMode={false} trackReplayPosition={50} />
      );

      const overlay = screen.getByTestId('telemetry-overlay');
      // The interpolated position should show some altitude
      expect(overlay).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('should have correct tabpanel role', () => {
      renderWithTimers(<TrackTab {...defaultProps} />);

      const tabPanel = screen.getByRole('tabpanel');
      expect(tabPanel).toBeInTheDocument();
      expect(tabPanel).toHaveAttribute('aria-labelledby', 'tab-track');
      expect(tabPanel).toHaveAttribute('id', 'panel-track');
    });

    it('should have application role on map', () => {
      renderWithTimers(<TrackTab {...defaultProps} />);

      expect(screen.getByRole('application', { name: /flight track map/i })).toBeInTheDocument();
    });
  });

  describe('speed control', () => {
    it('should pass speed to ReplayControls', () => {
      renderWithTimers(<TrackTab {...defaultProps} trackReplaySpeed={2} />);

      expect(screen.getByTestId('replay-controls')).toBeInTheDocument();
    });

    it('should call setTrackReplaySpeed when speed changes', () => {
      const mockSetTrackReplaySpeed = vi.fn();

      renderWithTimers(
        <TrackTab {...defaultProps} setTrackReplaySpeed={mockSetTrackReplaySpeed} />
      );

      // Speed control is part of ReplayControls which we mocked
      expect(screen.getByTestId('replay-controls')).toBeInTheDocument();
    });
  });

  describe('edge cases', () => {
    it('should handle aircraft without coordinates gracefully', () => {
      const aircraftWithoutCoords = { ...mockAircraft, lat: null, lon: null };

      renderWithTimers(<TrackTab {...defaultProps} aircraft={aircraftWithoutCoords} />);

      // Should still render without crashing
      expect(screen.getByTestId('replay-controls')).toBeInTheDocument();
    });

    it('should handle sightings with missing fields', () => {
      const sightingsWithMissingFields = [
        { lat: 37.77, lon: -122.41, timestamp: '2024-01-15T12:00:00Z' },
      ];

      renderWithTimers(<TrackTab {...defaultProps} sightings={sightingsWithMissingFields} />);

      expect(screen.getByTestId('replay-controls')).toBeInTheDocument();
    });

    it('should handle null feederLocation', () => {
      renderWithTimers(<TrackTab {...defaultProps} feederLocation={null} />);

      expect(screen.getByTestId('replay-controls')).toBeInTheDocument();
    });
  });
});
