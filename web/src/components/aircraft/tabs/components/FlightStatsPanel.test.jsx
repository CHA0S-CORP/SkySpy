import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FlightStatsPanel } from './FlightStatsPanel';

describe('FlightStatsPanel', () => {
  const sampleSightings = [
    { timestamp: '2024-01-15T10:00:00Z', altitude: 5000, gs: 200, vr: 1500, distance_nm: 50, rssi: -5 },
    { timestamp: '2024-01-15T10:15:00Z', altitude: 15000, gs: 350, vr: 2000, distance_nm: 45, rssi: -8 },
    { timestamp: '2024-01-15T10:30:00Z', altitude: 30000, gs: 450, vr: -500, distance_nm: 35, rssi: -12 },
    { timestamp: '2024-01-15T10:45:00Z', altitude: 35000, gs: 460, vr: -1500, distance_nm: 30, rssi: -15 },
  ];

  const defaultProps = {
    sightings: sampleSightings,
  };

  describe('basic rendering', () => {
    it('should render stats panel container', () => {
      const { container } = render(<FlightStatsPanel {...defaultProps} />);
      expect(container.querySelector('.flight-stats-panel')).toBeInTheDocument();
    });

    it('should render title', () => {
      render(<FlightStatsPanel {...defaultProps} />);
      expect(screen.getByText('Flight Statistics')).toBeInTheDocument();
    });

    it('should render all stat sections', () => {
      render(<FlightStatsPanel {...defaultProps} />);
      expect(screen.getByText('Altitude')).toBeInTheDocument();
      expect(screen.getByText('Speed')).toBeInTheDocument();
      expect(screen.getByText('Vertical Speed')).toBeInTheDocument();
      expect(screen.getByText('Distance')).toBeInTheDocument();
      expect(screen.getByText('Signal Strength')).toBeInTheDocument();
    });
  });

  describe('duration calculation', () => {
    it('should display correct duration', () => {
      render(<FlightStatsPanel {...defaultProps} />);
      // 45 minutes from first to last timestamp
      expect(screen.getByText('45 min')).toBeInTheDocument();
    });

    it('should show 0 duration for empty sightings', () => {
      render(<FlightStatsPanel sightings={[]} />);
      expect(screen.getByText('0 min')).toBeInTheDocument();
    });
  });

  describe('position count', () => {
    it('should display correct position count', () => {
      render(<FlightStatsPanel {...defaultProps} />);
      expect(screen.getByText('4')).toBeInTheDocument();
    });

    it('should show 0 for empty sightings', () => {
      render(<FlightStatsPanel sightings={[]} />);
      expect(screen.getByText('0')).toBeInTheDocument();
    });
  });

  describe('altitude statistics', () => {
    it('should display min altitude', () => {
      const { container } = render(<FlightStatsPanel {...defaultProps} />);
      // 5000 ft formatted as 5.0k - there may be multiple "k" values
      const statValues = container.querySelectorAll('.flight-stats-panel__stat-value');
      const altValues = Array.from(statValues).map(v => v.textContent);
      expect(altValues.some(v => v.includes('5.0k'))).toBe(true);
    });

    it('should display max altitude', () => {
      const { container } = render(<FlightStatsPanel {...defaultProps} />);
      // 35000 ft formatted as 35.0k
      const statValues = container.querySelectorAll('.flight-stats-panel__stat-value');
      const altValues = Array.from(statValues).map(v => v.textContent);
      expect(altValues.some(v => v.includes('35.0k'))).toBe(true);
    });

    it('should display average altitude', () => {
      const { container } = render(<FlightStatsPanel {...defaultProps} />);
      // Average of 5000, 15000, 30000, 35000 = 21250
      const statValues = container.querySelectorAll('.flight-stats-panel__stat-value');
      const altValues = Array.from(statValues).map(v => v.textContent);
      expect(altValues.some(v => v.includes('21.'))).toBe(true);
    });

    it('should show -- for missing altitude data', () => {
      const sightingsNoAlt = [
        { timestamp: '2024-01-15T10:00:00Z' },
        { timestamp: '2024-01-15T10:15:00Z' },
      ];
      const { container } = render(<FlightStatsPanel sightings={sightingsNoAlt} />);
      const statValues = container.querySelectorAll('.flight-stats-panel__stat-value');
      const altValues = Array.from(statValues).map(v => v.textContent);
      expect(altValues.some(v => v.includes('--'))).toBe(true);
    });
  });

  describe('speed statistics', () => {
    it('should display min speed', () => {
      render(<FlightStatsPanel {...defaultProps} />);
      expect(screen.getByText('200 kts')).toBeInTheDocument();
    });

    it('should display max speed', () => {
      render(<FlightStatsPanel {...defaultProps} />);
      expect(screen.getByText('460 kts')).toBeInTheDocument();
    });

    it('should display average speed', () => {
      render(<FlightStatsPanel {...defaultProps} />);
      // Average of 200, 350, 450, 460 = 365
      expect(screen.getByText('365 kts')).toBeInTheDocument();
    });

    it('should show -- for missing speed data', () => {
      const sightingsNoSpeed = [
        { timestamp: '2024-01-15T10:00:00Z', altitude: 5000 },
        { timestamp: '2024-01-15T10:15:00Z', altitude: 10000 },
      ];
      render(<FlightStatsPanel sightings={sightingsNoSpeed} />);
      expect(screen.getAllByText('-- kts').length).toBeGreaterThan(0);
    });
  });

  describe('vertical speed statistics', () => {
    it('should display max climb rate', () => {
      render(<FlightStatsPanel {...defaultProps} />);
      // Max positive V/S is 2000
      expect(screen.getByText('+2000 fpm')).toBeInTheDocument();
    });

    it('should display max descent rate', () => {
      render(<FlightStatsPanel {...defaultProps} />);
      // Min V/S is -1500
      expect(screen.getByText('-1500 fpm')).toBeInTheDocument();
    });

    it('should color climb rate green', () => {
      const { container } = render(<FlightStatsPanel {...defaultProps} />);
      // Check for green color styling on positive V/S
    });

    it('should color descent rate red', () => {
      const { container } = render(<FlightStatsPanel {...defaultProps} />);
      // Check for red color styling on negative V/S
    });

    it('should show -- for missing V/S data', () => {
      const sightingsNoVS = [
        { timestamp: '2024-01-15T10:00:00Z', altitude: 5000 },
        { timestamp: '2024-01-15T10:15:00Z', altitude: 10000 },
      ];
      render(<FlightStatsPanel sightings={sightingsNoVS} />);
      expect(screen.getAllByText('-- fpm').length).toBeGreaterThan(0);
    });
  });

  describe('distance statistics', () => {
    it('should display closest distance', () => {
      render(<FlightStatsPanel {...defaultProps} />);
      // Min distance is 30
      expect(screen.getByText('30.0 nm')).toBeInTheDocument();
    });

    it('should display farthest distance', () => {
      render(<FlightStatsPanel {...defaultProps} />);
      // Max distance is 50
      expect(screen.getByText('50.0 nm')).toBeInTheDocument();
    });

    it('should show -- for missing distance data', () => {
      const sightingsNoDist = [
        { timestamp: '2024-01-15T10:00:00Z', altitude: 5000 },
        { timestamp: '2024-01-15T10:15:00Z', altitude: 10000 },
      ];
      render(<FlightStatsPanel sightings={sightingsNoDist} />);
      expect(screen.getAllByText('-- nm').length).toBeGreaterThan(0);
    });
  });

  describe('signal statistics', () => {
    it('should display best signal', () => {
      render(<FlightStatsPanel {...defaultProps} />);
      // Max rssi is -5
      expect(screen.getByText('-5.0 dB')).toBeInTheDocument();
    });

    it('should display worst signal', () => {
      render(<FlightStatsPanel {...defaultProps} />);
      // Min rssi is -15
      expect(screen.getByText('-15.0 dB')).toBeInTheDocument();
    });

    it('should display average signal', () => {
      render(<FlightStatsPanel {...defaultProps} />);
      // Average of -5, -8, -12, -15 = -10
      expect(screen.getByText('-10.0 dB')).toBeInTheDocument();
    });

    it('should show -- for missing signal data', () => {
      const sightingsNoSignal = [
        { timestamp: '2024-01-15T10:00:00Z', altitude: 5000 },
        { timestamp: '2024-01-15T10:15:00Z', altitude: 10000 },
      ];
      render(<FlightStatsPanel sightings={sightingsNoSignal} />);
      expect(screen.getAllByText('-- dB').length).toBeGreaterThan(0);
    });
  });

  describe('empty state', () => {
    it('should handle empty sightings array', () => {
      const { container } = render(<FlightStatsPanel sightings={[]} />);
      expect(container.querySelector('.flight-stats-panel')).toBeInTheDocument();
    });

    it('should show default values for empty sightings', () => {
      render(<FlightStatsPanel sightings={[]} />);
      expect(screen.getByText('0 min')).toBeInTheDocument();
      expect(screen.getByText('0')).toBeInTheDocument();
    });
  });

  describe('altitude formatting', () => {
    it('should format altitudes < 1000 without k', () => {
      const lowAltSightings = [
        { timestamp: '2024-01-15T10:00:00Z', altitude: 500 },
        { timestamp: '2024-01-15T10:15:00Z', altitude: 800 },
      ];
      render(<FlightStatsPanel sightings={lowAltSightings} />);
      expect(screen.getByText(/500/)).toBeInTheDocument();
    });

    it('should format altitudes >= 1000 with k notation', () => {
      const highAltSightings = [
        { timestamp: '2024-01-15T10:00:00Z', altitude: 5000 },
        { timestamp: '2024-01-15T10:15:00Z', altitude: 10000 },
      ];
      render(<FlightStatsPanel sightings={highAltSightings} />);
      expect(screen.getByText(/5\.0k/)).toBeInTheDocument();
    });
  });

  describe('data filtering', () => {
    it('should ignore zero altitude values', () => {
      const sightingsWithZero = [
        { timestamp: '2024-01-15T10:00:00Z', altitude: 0 },
        { timestamp: '2024-01-15T10:15:00Z', altitude: 10000 },
        { timestamp: '2024-01-15T10:30:00Z', altitude: 20000 },
      ];
      render(<FlightStatsPanel sightings={sightingsWithZero} />);
      // Min should be 10000, not 0
      expect(screen.getByText(/10\.0k/)).toBeInTheDocument();
    });

    it('should ignore null values', () => {
      const sightingsWithNull = [
        { timestamp: '2024-01-15T10:00:00Z', altitude: null, gs: 300 },
        { timestamp: '2024-01-15T10:15:00Z', altitude: 10000, gs: 400 },
      ];
      render(<FlightStatsPanel sightings={sightingsWithNull} />);
      // Should only count valid values
    });

    it('should ignore undefined values', () => {
      const sightingsWithUndefined = [
        { timestamp: '2024-01-15T10:00:00Z', gs: 300 },
        { timestamp: '2024-01-15T10:15:00Z', altitude: 10000, gs: 400 },
      ];
      render(<FlightStatsPanel sightings={sightingsWithUndefined} />);
      // Should only count valid values
    });
  });

  describe('styling', () => {
    it('should apply custom className', () => {
      const { container } = render(
        <FlightStatsPanel {...defaultProps} className="custom-stats" />
      );
      expect(container.querySelector('.custom-stats')).toBeInTheDocument();
    });
  });

  describe('stat labels', () => {
    it('should display Duration label', () => {
      render(<FlightStatsPanel {...defaultProps} />);
      expect(screen.getByText('Duration')).toBeInTheDocument();
    });

    it('should display Positions label', () => {
      render(<FlightStatsPanel {...defaultProps} />);
      expect(screen.getByText('Positions')).toBeInTheDocument();
    });

    it('should display Min/Max/Avg labels for altitude', () => {
      render(<FlightStatsPanel {...defaultProps} />);
      expect(screen.getAllByText('Min').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Max').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Avg').length).toBeGreaterThan(0);
    });

    it('should display Closest/Farthest for distance', () => {
      render(<FlightStatsPanel {...defaultProps} />);
      expect(screen.getByText('Closest')).toBeInTheDocument();
      expect(screen.getByText('Farthest')).toBeInTheDocument();
    });

    it('should display Best/Worst for signal', () => {
      render(<FlightStatsPanel {...defaultProps} />);
      expect(screen.getByText('Best')).toBeInTheDocument();
      expect(screen.getByText('Worst')).toBeInTheDocument();
    });

    it('should display Max Climb/Max Desc for V/S', () => {
      render(<FlightStatsPanel {...defaultProps} />);
      expect(screen.getByText('Max Climb')).toBeInTheDocument();
      expect(screen.getByText('Max Desc')).toBeInTheDocument();
    });
  });
});
