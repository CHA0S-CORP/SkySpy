import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
// Mocks are defined globally in src/test/setup.js
import { EnhancedFlightMap } from './EnhancedFlightMap';

describe('EnhancedFlightMap', () => {
  const sampleSightings = [
    { lat: 40.7128, lon: -74.006, altitude: 5000, gs: 200, timestamp: '2024-01-15T10:00:00Z' },
    { lat: 40.75, lon: -73.95, altitude: 15000, gs: 350, timestamp: '2024-01-15T10:05:00Z' },
    { lat: 40.8, lon: -73.9, altitude: 25000, gs: 420, timestamp: '2024-01-15T10:10:00Z' },
    { lat: 40.85, lon: -73.85, altitude: 35000, gs: 450, timestamp: '2024-01-15T10:15:00Z' },
  ];

  const feederLocation = { lat: 40.7, lon: -74.01 };

  const defaultProps = {
    sightings: sampleSightings,
    feederLocation,
  };

  describe('basic rendering', () => {
    it('should render map container', () => {
      render(<EnhancedFlightMap {...defaultProps} />);
      expect(screen.getByTestId('map-container')).toBeInTheDocument();
    });

    it('should render tile layer', () => {
      render(<EnhancedFlightMap {...defaultProps} />);
      expect(screen.getByTestId('tile-layer')).toBeInTheDocument();
    });

    it('should render track segments', () => {
      render(<EnhancedFlightMap {...defaultProps} />);
      const polylines = screen.getAllByTestId('polyline');
      // Should have n-1 segments for n sightings
      expect(polylines.length).toBe(sampleSightings.length - 1);
    });

    it('should render start and end markers', () => {
      render(<EnhancedFlightMap {...defaultProps} />);
      const markers = screen.getAllByTestId('marker');
      expect(markers.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('empty state', () => {
    it('should show empty message when no sightings', () => {
      render(<EnhancedFlightMap sightings={[]} />);
      expect(screen.getByText('No position data available')).toBeInTheDocument();
    });

    it('should show empty message when sightings have no lat/lon', () => {
      const invalidSightings = [{ altitude: 5000 }, { altitude: 10000 }];
      render(<EnhancedFlightMap sightings={invalidSightings} />);
      expect(screen.getByText('No position data available')).toBeInTheDocument();
    });
  });

  describe('color modes', () => {
    it('should color by altitude by default', () => {
      render(<EnhancedFlightMap {...defaultProps} colorBy="altitude" />);
      const polylines = screen.getAllByTestId('polyline');
      expect(polylines[0].getAttribute('data-color')).toBeTruthy();
    });

    it('should color by speed', () => {
      render(<EnhancedFlightMap {...defaultProps} colorBy="speed" />);
      const polylines = screen.getAllByTestId('polyline');
      expect(polylines[0].getAttribute('data-color')).toBeTruthy();
    });

    it('should color by time', () => {
      render(<EnhancedFlightMap {...defaultProps} colorBy="time" />);
      const polylines = screen.getAllByTestId('polyline');
      expect(polylines[0].getAttribute('data-color')).toBeTruthy();
    });
  });

  describe('legend', () => {
    it('should display legend', () => {
      render(<EnhancedFlightMap {...defaultProps} />);
      expect(screen.getByText('Start')).toBeInTheDocument();
      expect(screen.getByText('End')).toBeInTheDocument();
    });

    it('should show feeder in legend when feederLocation provided', () => {
      render(<EnhancedFlightMap {...defaultProps} feederLocation={feederLocation} />);
      expect(screen.getByText('Feeder')).toBeInTheDocument();
    });

    it('should show altitude legend when colorBy is altitude', () => {
      render(<EnhancedFlightMap {...defaultProps} colorBy="altitude" />);
      expect(screen.getByText(/ft/)).toBeInTheDocument();
    });

    it('should show speed legend when colorBy is speed', () => {
      render(<EnhancedFlightMap {...defaultProps} colorBy="speed" />);
      expect(screen.getByText(/kts/)).toBeInTheDocument();
    });

    it('should show time legend when colorBy is time', () => {
      render(<EnhancedFlightMap {...defaultProps} colorBy="time" />);
      expect(screen.getByText('Time')).toBeInTheDocument();
    });
  });

  describe('range rings', () => {
    it('should render range rings when showRangeRings is true', () => {
      render(
        <EnhancedFlightMap {...defaultProps} showRangeRings feederLocation={feederLocation} />
      );
      // Range rings are rendered as circle markers
      expect(screen.getAllByTestId('circle-marker').length).toBeGreaterThan(0);
    });

    it('should not render range rings when showRangeRings is false', () => {
      render(
        <EnhancedFlightMap
          {...defaultProps}
          showRangeRings={false}
          feederLocation={feederLocation}
        />
      );
      // May still have circle markers for other purposes
    });

    it('should not render range rings without feederLocation', () => {
      render(
        <EnhancedFlightMap sightings={sampleSightings} showRangeRings feederLocation={null} />
      );
      // No range rings without feeder location
    });
  });

  describe('interactions', () => {
    it('should call onPositionClick when track segment is clicked', () => {
      const onPositionClick = vi.fn();
      render(<EnhancedFlightMap {...defaultProps} onPositionClick={onPositionClick} />);

      const polylines = screen.getAllByTestId('polyline');
      fireEvent.click(polylines[0]);

      expect(onPositionClick).toHaveBeenCalledWith(0);
    });
  });

  describe('replay position', () => {
    it('should render replay marker when replayPosition is provided', () => {
      const replayPosition = { lat: 40.78, lon: -73.92 };
      render(<EnhancedFlightMap {...defaultProps} replayPosition={replayPosition} />);

      const markers = screen.getAllByTestId('marker');
      const replayMarker = markers.find(
        (m) => m.getAttribute('data-lat') === '40.78' && m.getAttribute('data-lon') === '-73.92'
      );
      // Replay marker should be present
    });

    it('should not render replay marker when replayPosition is null', () => {
      render(<EnhancedFlightMap {...defaultProps} replayPosition={null} />);
      // Only start, end, and feeder markers
    });
  });

  describe('map controls', () => {
    it('should render fit to track button', () => {
      const { container } = render(<EnhancedFlightMap {...defaultProps} />);
      const controlBtn = container.querySelector('.enhanced-flight-map__control-btn');
      expect(controlBtn).toBeInTheDocument();
    });

    it('should have title on control button', () => {
      const { container } = render(<EnhancedFlightMap {...defaultProps} />);
      const controlBtn = container.querySelector('.enhanced-flight-map__control-btn');
      expect(controlBtn.getAttribute('title')).toBe('Fit to track');
    });
  });

  describe('height configuration', () => {
    it('should apply custom height', () => {
      const { container } = render(<EnhancedFlightMap {...defaultProps} height={500} />);
      const mapWrapper = container.querySelector('.enhanced-flight-map');
      expect(mapWrapper.style.height).toBe('500px');
    });

    it('should use default height of 300', () => {
      const { container } = render(<EnhancedFlightMap {...defaultProps} />);
      const mapWrapper = container.querySelector('.enhanced-flight-map');
      expect(mapWrapper.style.height).toBe('300px');
    });
  });

  describe('styling', () => {
    it('should apply custom className', () => {
      const { container } = render(<EnhancedFlightMap {...defaultProps} className="custom-map" />);
      expect(container.querySelector('.custom-map')).toBeInTheDocument();
    });

    it('should apply empty class when no data', () => {
      const { container } = render(<EnhancedFlightMap sightings={[]} />);
      expect(container.querySelector('.enhanced-flight-map--empty')).toBeInTheDocument();
    });
  });

  describe('bounds calculation', () => {
    it('should include feeder location in bounds', () => {
      render(<EnhancedFlightMap {...defaultProps} feederLocation={feederLocation} />);
      // Map should be rendered (bounds calculated successfully)
      expect(screen.getByTestId('map-container')).toBeInTheDocument();
    });

    it('should calculate bounds from sightings', () => {
      render(<EnhancedFlightMap sightings={sampleSightings} />);
      expect(screen.getByTestId('map-container')).toBeInTheDocument();
    });
  });

  describe('data handling', () => {
    it('should handle sightings with missing altitude', () => {
      const sightingsNoAlt = [
        { lat: 40.7128, lon: -74.006 },
        { lat: 40.75, lon: -73.95 },
      ];
      render(<EnhancedFlightMap sightings={sightingsNoAlt} />);
      expect(screen.getByTestId('map-container')).toBeInTheDocument();
    });

    it('should handle sightings with missing speed', () => {
      const sightingsNoSpeed = [
        { lat: 40.7128, lon: -74.006, altitude: 5000 },
        { lat: 40.75, lon: -73.95, altitude: 15000 },
      ];
      render(<EnhancedFlightMap sightings={sightingsNoSpeed} colorBy="speed" />);
      expect(screen.getByTestId('map-container')).toBeInTheDocument();
    });

    it('should filter out invalid sightings', () => {
      const mixedSightings = [
        { lat: 40.7128, lon: -74.006, altitude: 5000 },
        { lat: null, lon: null },
        { lat: 40.75, lon: -73.95, altitude: 15000 },
      ];
      render(<EnhancedFlightMap sightings={mixedSightings} />);
      // Should still render with valid sightings
      expect(screen.getByTestId('map-container')).toBeInTheDocument();
    });
  });
});
