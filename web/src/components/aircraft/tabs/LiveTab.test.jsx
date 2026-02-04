import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveTab } from './LiveTab';

// Mock lucide-react
vi.mock('lucide-react', () => ({
  WifiOff: () => <span data-testid="wifi-off-icon">WifiOff</span>,
}));

// Mock utils
vi.mock('../../../utils', () => ({
  getCardinalDirection: vi.fn((track) => {
    if (track == null) return '';
    if (track >= 337.5 || track < 22.5) return 'N';
    if (track >= 22.5 && track < 67.5) return 'NE';
    if (track >= 67.5 && track < 112.5) return 'E';
    if (track >= 112.5 && track < 157.5) return 'SE';
    if (track >= 157.5 && track < 202.5) return 'S';
    if (track >= 202.5 && track < 247.5) return 'SW';
    if (track >= 247.5 && track < 292.5) return 'W';
    if (track >= 292.5 && track < 337.5) return 'NW';
    return '';
  }),
}));

describe('LiveTab', () => {
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
    squawk: '1200',
  };

  const mockTrackHistory = [
    { lat: 37.77, lon: -122.41, timestamp: '2024-01-01T12:00:00Z' },
    { lat: 37.78, lon: -122.42, timestamp: '2024-01-01T12:01:00Z' },
  ];

  const mockCalculateDistance = vi.fn().mockReturnValue(15.5);

  describe('empty state', () => {
    it('should render empty state when aircraft is null', () => {
      render(
        <LiveTab
          aircraft={null}
          trackHistory={mockTrackHistory}
          calculateDistance={mockCalculateDistance}
        />
      );

      expect(screen.getByText('Aircraft not currently tracked')).toBeInTheDocument();
      expect(screen.getByText('This aircraft is not in range of the receiver')).toBeInTheDocument();
      expect(screen.getByTestId('wifi-off-icon')).toBeInTheDocument();
    });

    it('should render empty state when aircraft is undefined', () => {
      render(
        <LiveTab
          aircraft={undefined}
          trackHistory={mockTrackHistory}
          calculateDistance={mockCalculateDistance}
        />
      );

      expect(screen.getByText('Aircraft not currently tracked')).toBeInTheDocument();
    });

    it('should have correct role for empty state', () => {
      render(
        <LiveTab
          aircraft={null}
          trackHistory={mockTrackHistory}
          calculateDistance={mockCalculateDistance}
        />
      );

      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  describe('with aircraft data', () => {
    it('should render telemetry data', () => {
      render(
        <LiveTab
          aircraft={mockAircraft}
          trackHistory={mockTrackHistory}
          calculateDistance={mockCalculateDistance}
        />
      );

      // Check altitude
      expect(screen.getByText('Altitude')).toBeInTheDocument();
      expect(screen.getByText('35,000')).toBeInTheDocument();
      expect(screen.getAllByText('ft')[0]).toBeInTheDocument();

      // Check speed
      expect(screen.getByText('Ground Speed')).toBeInTheDocument();
      expect(screen.getByText('450')).toBeInTheDocument();
      expect(screen.getByText('kts')).toBeInTheDocument();

      // Check vertical rate
      expect(screen.getByText('Vertical Rate')).toBeInTheDocument();
      expect(screen.getByText('+500')).toBeInTheDocument();
      expect(screen.getByText('ft/min')).toBeInTheDocument();

      // Check track
      expect(screen.getByText('Track')).toBeInTheDocument();
      expect(screen.getByText('S')).toBeInTheDocument(); // Cardinal direction

      // Check squawk
      expect(screen.getByText('Squawk')).toBeInTheDocument();
      expect(screen.getByText('1200')).toBeInTheDocument();
    });

    it('should display distance from calculateDistance', () => {
      render(
        <LiveTab
          aircraft={mockAircraft}
          trackHistory={mockTrackHistory}
          calculateDistance={mockCalculateDistance}
        />
      );

      expect(screen.getByText('Distance')).toBeInTheDocument();
      expect(screen.getByText('15.5')).toBeInTheDocument();
      expect(screen.getByText('nm')).toBeInTheDocument();
      expect(mockCalculateDistance).toHaveBeenCalledWith(mockAircraft);
    });

    it('should display track history count', () => {
      render(
        <LiveTab
          aircraft={mockAircraft}
          trackHistory={mockTrackHistory}
          calculateDistance={mockCalculateDistance}
        />
      );

      expect(screen.getByText('Track History')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('points')).toBeInTheDocument();
    });

    it('should display position coordinates', () => {
      render(
        <LiveTab
          aircraft={mockAircraft}
          trackHistory={mockTrackHistory}
          calculateDistance={mockCalculateDistance}
        />
      );

      expect(screen.getByText('Position')).toBeInTheDocument();
      expect(screen.getByText('Lat: 37.77490')).toBeInTheDocument();
      expect(screen.getByText('Lon: -122.41940')).toBeInTheDocument();
    });
  });

  describe('vertical rate display', () => {
    it('should add climbing class for positive vertical rate', () => {
      const climbingAircraft = { ...mockAircraft, baro_rate: 1500 };
      const { container } = render(
        <LiveTab
          aircraft={climbingAircraft}
          trackHistory={mockTrackHistory}
          calculateDistance={mockCalculateDistance}
        />
      );

      const vsValue = container.querySelector('.climbing');
      expect(vsValue).toBeInTheDocument();
    });

    it('should add descending class for negative vertical rate', () => {
      const descendingAircraft = { ...mockAircraft, baro_rate: -1500 };
      const { container } = render(
        <LiveTab
          aircraft={descendingAircraft}
          trackHistory={mockTrackHistory}
          calculateDistance={mockCalculateDistance}
        />
      );

      const vsValue = container.querySelector('.descending');
      expect(vsValue).toBeInTheDocument();
    });

    it('should add extreme-vs class for rates over 3000 fpm', () => {
      const extremeClimbAircraft = { ...mockAircraft, baro_rate: 4000 };
      const { container } = render(
        <LiveTab
          aircraft={extremeClimbAircraft}
          trackHistory={mockTrackHistory}
          calculateDistance={mockCalculateDistance}
        />
      );

      const vsValue = container.querySelector('.extreme-vs');
      expect(vsValue).toBeInTheDocument();
    });

    it('should prefer vr over baro_rate', () => {
      const aircraftWithVr = { ...mockAircraft, vr: 1000, baro_rate: 500 };
      render(
        <LiveTab
          aircraft={aircraftWithVr}
          trackHistory={mockTrackHistory}
          calculateDistance={mockCalculateDistance}
        />
      );

      expect(screen.getByText('+1000')).toBeInTheDocument();
    });

    it('should use geom_rate as fallback', () => {
      const aircraftWithGeomRate = {
        ...mockAircraft,
        vr: undefined,
        baro_rate: undefined,
        geom_rate: 800,
      };
      render(
        <LiveTab
          aircraft={aircraftWithGeomRate}
          trackHistory={mockTrackHistory}
          calculateDistance={mockCalculateDistance}
        />
      );

      expect(screen.getByText('+800')).toBeInTheDocument();
    });
  });

  describe('altitude display', () => {
    it('should use alt_baro when not on ground', () => {
      render(
        <LiveTab
          aircraft={mockAircraft}
          trackHistory={mockTrackHistory}
          calculateDistance={mockCalculateDistance}
        />
      );

      expect(screen.getByText('35,000')).toBeInTheDocument();
    });

    it('should use alt_geom when alt_baro is "ground"', () => {
      const groundAircraft = { ...mockAircraft, alt_baro: 'ground', alt_geom: 50 };
      render(
        <LiveTab
          aircraft={groundAircraft}
          trackHistory={mockTrackHistory}
          calculateDistance={mockCalculateDistance}
        />
      );

      expect(screen.getByText('50')).toBeInTheDocument();
    });

    it('should show "--" when altitude is not available', () => {
      const noAltAircraft = {
        ...mockAircraft,
        alt_baro: null,
        alt_geom: null,
        alt: null,
      };
      render(
        <LiveTab
          aircraft={noAltAircraft}
          trackHistory={mockTrackHistory}
          calculateDistance={mockCalculateDistance}
        />
      );

      // Multiple "--" values should be present
      const dashValues = screen.getAllByText('--');
      expect(dashValues.length).toBeGreaterThan(0);
    });
  });

  describe('speed display', () => {
    it('should use gs (ground speed) when available', () => {
      render(
        <LiveTab
          aircraft={mockAircraft}
          trackHistory={mockTrackHistory}
          calculateDistance={mockCalculateDistance}
        />
      );

      expect(screen.getByText('450')).toBeInTheDocument();
    });

    it('should use tas as fallback', () => {
      const aircraftWithTas = { ...mockAircraft, gs: undefined, tas: 420 };
      render(
        <LiveTab
          aircraft={aircraftWithTas}
          trackHistory={mockTrackHistory}
          calculateDistance={mockCalculateDistance}
        />
      );

      expect(screen.getByText('420')).toBeInTheDocument();
    });

    it('should use ias as last fallback', () => {
      const aircraftWithIas = { ...mockAircraft, gs: undefined, tas: undefined, ias: 380 };
      render(
        <LiveTab
          aircraft={aircraftWithIas}
          trackHistory={mockTrackHistory}
          calculateDistance={mockCalculateDistance}
        />
      );

      expect(screen.getByText('380')).toBeInTheDocument();
    });
  });

  describe('track display', () => {
    it('should use track when available', () => {
      render(
        <LiveTab
          aircraft={mockAircraft}
          trackHistory={mockTrackHistory}
          calculateDistance={mockCalculateDistance}
        />
      );

      expect(screen.getByText('S')).toBeInTheDocument(); // 180 degrees = S
    });

    it('should use true_heading as fallback', () => {
      const aircraftWithTrueHeading = { ...mockAircraft, track: undefined, true_heading: 90 };
      render(
        <LiveTab
          aircraft={aircraftWithTrueHeading}
          trackHistory={mockTrackHistory}
          calculateDistance={mockCalculateDistance}
        />
      );

      expect(screen.getByText('E')).toBeInTheDocument();
    });
  });

  describe('squawk display', () => {
    it('should display squawk code', () => {
      render(
        <LiveTab
          aircraft={mockAircraft}
          trackHistory={mockTrackHistory}
          calculateDistance={mockCalculateDistance}
        />
      );

      expect(screen.getByText('1200')).toBeInTheDocument();
    });

    it('should show "----" when squawk is not available', () => {
      const noSquawkAircraft = { ...mockAircraft, squawk: null };
      render(
        <LiveTab
          aircraft={noSquawkAircraft}
          trackHistory={mockTrackHistory}
          calculateDistance={mockCalculateDistance}
        />
      );

      expect(screen.getByText('----')).toBeInTheDocument();
    });

    it('should add emergency class for squawk 7500 (hijack)', () => {
      const hijackAircraft = { ...mockAircraft, squawk: '7500' };
      const { container } = render(
        <LiveTab
          aircraft={hijackAircraft}
          trackHistory={mockTrackHistory}
          calculateDistance={mockCalculateDistance}
        />
      );

      const squawkValue = container.querySelector('.squawk-emergency');
      expect(squawkValue).toBeInTheDocument();
    });

    it('should add emergency class for squawk 7600 (radio failure)', () => {
      const radioFailAircraft = { ...mockAircraft, squawk: '7600' };
      const { container } = render(
        <LiveTab
          aircraft={radioFailAircraft}
          trackHistory={mockTrackHistory}
          calculateDistance={mockCalculateDistance}
        />
      );

      const squawkValue = container.querySelector('.squawk-emergency');
      expect(squawkValue).toBeInTheDocument();
    });

    it('should add emergency class for squawk 7700 (emergency)', () => {
      const emergencyAircraft = { ...mockAircraft, squawk: '7700' };
      const { container } = render(
        <LiveTab
          aircraft={emergencyAircraft}
          trackHistory={mockTrackHistory}
          calculateDistance={mockCalculateDistance}
        />
      );

      const squawkValue = container.querySelector('.squawk-emergency');
      expect(squawkValue).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('should have correct tabpanel role', () => {
      render(
        <LiveTab
          aircraft={mockAircraft}
          trackHistory={mockTrackHistory}
          calculateDistance={mockCalculateDistance}
        />
      );

      const tabPanel = screen.getByRole('tabpanel');
      expect(tabPanel).toBeInTheDocument();
      expect(tabPanel).toHaveAttribute('aria-labelledby', 'tab-live');
      expect(tabPanel).toHaveAttribute('id', 'panel-live');
    });

    it('should have live region for telemetry', () => {
      render(
        <LiveTab
          aircraft={mockAircraft}
          trackHistory={mockTrackHistory}
          calculateDistance={mockCalculateDistance}
        />
      );

      const liveRegion = screen.getByRole('region', { name: /live telemetry/i });
      expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    });
  });

  describe('edge cases', () => {
    it('should handle empty track history', () => {
      render(
        <LiveTab
          aircraft={mockAircraft}
          trackHistory={[]}
          calculateDistance={mockCalculateDistance}
        />
      );

      expect(screen.getByText('0')).toBeInTheDocument();
    });

    it('should handle undefined track history', () => {
      render(
        <LiveTab
          aircraft={mockAircraft}
          trackHistory={undefined}
          calculateDistance={mockCalculateDistance}
        />
      );

      expect(screen.getByText('0')).toBeInTheDocument();
    });

    it('should handle null distance calculation', () => {
      const nullDistanceCalculator = vi.fn().mockReturnValue(null);
      render(
        <LiveTab
          aircraft={mockAircraft}
          trackHistory={mockTrackHistory}
          calculateDistance={nullDistanceCalculator}
        />
      );

      // Should show "--" for null distance
      const dashValues = screen.getAllByText('--');
      expect(dashValues.length).toBeGreaterThan(0);
    });
  });
});
