import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Plane, Target } from 'lucide-react';
import { KPICard, LeaderboardCard, SquawkWatchlist } from './StatsCards';

describe('KPICard', () => {
  const defaultProps = {
    title: 'Traffic',
    icon: Plane,
    metrics: [
      { label: 'Current', value: 42 },
      { label: 'Msg/s', value: 150 },
    ],
  };

  describe('rendering', () => {
    it('should render the card with title', () => {
      render(<KPICard {...defaultProps} />);
      expect(screen.getByText('Traffic')).toBeInTheDocument();
    });

    it('should render the icon', () => {
      const { container } = render(<KPICard {...defaultProps} />);
      // Lucide icons render as SVG
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('should render all metrics', () => {
      render(<KPICard {...defaultProps} />);
      expect(screen.getByText('Current')).toBeInTheDocument();
      expect(screen.getByText('42')).toBeInTheDocument();
      expect(screen.getByText('Msg/s')).toBeInTheDocument();
      expect(screen.getByText('150')).toBeInTheDocument();
    });
  });

  describe('accent colors', () => {
    it('should apply cyan accent class by default', () => {
      const { container } = render(<KPICard {...defaultProps} />);
      expect(container.querySelector('.kpi-accent-cyan')).toBeInTheDocument();
    });

    it('should apply green accent class when specified', () => {
      const { container } = render(<KPICard {...defaultProps} accentColor="green" />);
      expect(container.querySelector('.kpi-accent-green')).toBeInTheDocument();
    });

    it('should apply purple accent class when specified', () => {
      const { container } = render(<KPICard {...defaultProps} accentColor="purple" />);
      expect(container.querySelector('.kpi-accent-purple')).toBeInTheDocument();
    });

    it('should apply orange accent class when specified', () => {
      const { container } = render(<KPICard {...defaultProps} accentColor="orange" />);
      expect(container.querySelector('.kpi-accent-orange')).toBeInTheDocument();
    });

    it('should apply red accent class when specified', () => {
      const { container } = render(<KPICard {...defaultProps} accentColor="red" />);
      expect(container.querySelector('.kpi-accent-red')).toBeInTheDocument();
    });
  });

  describe('metric variations', () => {
    it('should handle string metric values', () => {
      const props = {
        ...defaultProps,
        metrics: [{ label: 'Max Dist', value: '125nm' }],
      };
      render(<KPICard {...props} />);
      expect(screen.getByText('125nm')).toBeInTheDocument();
    });

    it('should handle single metric', () => {
      const props = {
        ...defaultProps,
        metrics: [{ label: 'Total', value: 100 }],
      };
      render(<KPICard {...props} />);
      expect(screen.getByText('Total')).toBeInTheDocument();
      expect(screen.getByText('100')).toBeInTheDocument();
    });

    it('should handle zero values', () => {
      const props = {
        ...defaultProps,
        metrics: [{ label: 'Count', value: 0 }],
      };
      render(<KPICard {...props} />);
      expect(screen.getByText('0')).toBeInTheDocument();
    });
  });
});

describe('LeaderboardCard', () => {
  const mockItems = [
    { hex: 'abc123', flight: 'UAL123', distance_nm: 5.5 },
    { hex: 'def456', flight: 'DAL456', distance_nm: 10.2 },
    { hex: 'ghi789', flight: 'AAL789', distance_nm: 15.8 },
    { hex: 'jkl012', flight: 'SWA012', distance_nm: 20.1 },
  ];

  const defaultProps = {
    title: 'Closest',
    icon: Target,
    items: mockItems,
    valueFormatter: (item) => `${item.distance_nm.toFixed(1)} nm`,
  };

  describe('rendering', () => {
    it('should render the card with title', () => {
      render(<LeaderboardCard {...defaultProps} />);
      expect(screen.getByText('Closest')).toBeInTheDocument();
    });

    it('should render the icon', () => {
      const { container } = render(<LeaderboardCard {...defaultProps} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('should render top 3 items only', () => {
      render(<LeaderboardCard {...defaultProps} />);
      expect(screen.getByText('UAL123')).toBeInTheDocument();
      expect(screen.getByText('DAL456')).toBeInTheDocument();
      expect(screen.getByText('AAL789')).toBeInTheDocument();
      expect(screen.queryByText('SWA012')).not.toBeInTheDocument();
    });

    it('should display rank numbers', () => {
      render(<LeaderboardCard {...defaultProps} />);
      expect(screen.getByText('1')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('should display formatted values', () => {
      render(<LeaderboardCard {...defaultProps} />);
      expect(screen.getByText('5.5 nm')).toBeInTheDocument();
      expect(screen.getByText('10.2 nm')).toBeInTheDocument();
      expect(screen.getByText('15.8 nm')).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('should show empty text when items is empty', () => {
      render(<LeaderboardCard {...defaultProps} items={[]} />);
      expect(screen.getByText('No data')).toBeInTheDocument();
    });

    it('should show empty text when items is null', () => {
      render(<LeaderboardCard {...defaultProps} items={null} />);
      expect(screen.getByText('No data')).toBeInTheDocument();
    });

    it('should show custom empty text', () => {
      render(<LeaderboardCard {...defaultProps} items={[]} emptyText="No aircraft in range" />);
      expect(screen.getByText('No aircraft in range')).toBeInTheDocument();
    });
  });

  describe('selection handling', () => {
    it('should call onSelect when item is clicked', () => {
      const onSelect = vi.fn();
      render(<LeaderboardCard {...defaultProps} onSelect={onSelect} />);

      fireEvent.click(screen.getByText('UAL123'));
      expect(onSelect).toHaveBeenCalledWith('abc123');
    });

    it('should call onSelect when Enter is pressed', () => {
      const onSelect = vi.fn();
      render(<LeaderboardCard {...defaultProps} onSelect={onSelect} />);

      const item = screen.getByText('UAL123').closest('.leaderboard-item');
      fireEvent.keyDown(item, { key: 'Enter' });
      expect(onSelect).toHaveBeenCalledWith('abc123');
    });

    it('should call onSelect when Space is pressed', () => {
      const onSelect = vi.fn();
      render(<LeaderboardCard {...defaultProps} onSelect={onSelect} />);

      const item = screen.getByText('UAL123').closest('.leaderboard-item');
      fireEvent.keyDown(item, { key: ' ' });
      expect(onSelect).toHaveBeenCalledWith('abc123');
    });

    it('should have clickable class when onSelect is provided', () => {
      const onSelect = vi.fn();
      const { container } = render(<LeaderboardCard {...defaultProps} onSelect={onSelect} />);
      expect(container.querySelector('.clickable')).toBeInTheDocument();
    });

    it('should not have clickable class when onSelect is not provided', () => {
      const { container } = render(<LeaderboardCard {...defaultProps} onSelect={undefined} />);
      expect(container.querySelector('.clickable')).not.toBeInTheDocument();
    });

    it('should set role="button" when onSelect is provided', () => {
      const onSelect = vi.fn();
      render(<LeaderboardCard {...defaultProps} onSelect={onSelect} />);
      const items = screen.getAllByRole('button');
      expect(items.length).toBe(3);
    });
  });

  describe('pulse animation', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should add pulse class when items change', async () => {
      const { container, rerender } = render(<LeaderboardCard {...defaultProps} />);

      // Wait for initial effect to settle
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });

      // Update with new items
      const newItems = [
        { hex: 'new123', flight: 'NEW123', distance_nm: 3.0 },
        ...mockItems.slice(0, 2),
      ];

      rerender(<LeaderboardCard {...defaultProps} items={newItems} />);

      expect(container.querySelector('.pulse')).toBeInTheDocument();
    });

    it('should remove pulse class after timeout', () => {
      const { container, rerender } = render(<LeaderboardCard {...defaultProps} />);

      const newItems = [
        { hex: 'new123', flight: 'NEW123', distance_nm: 3.0 },
        ...mockItems.slice(0, 2),
      ];

      rerender(<LeaderboardCard {...defaultProps} items={newItems} />);
      expect(container.querySelector('.pulse')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(container.querySelector('.pulse')).not.toBeInTheDocument();
    });
  });

  describe('hex fallback', () => {
    it('should use hex when flight is not available', () => {
      const itemsWithoutFlight = [{ hex: 'abc123', distance_nm: 5.5 }];
      render(<LeaderboardCard {...defaultProps} items={itemsWithoutFlight} />);
      expect(screen.getByText('abc123')).toBeInTheDocument();
    });
  });
});

describe('SquawkWatchlist', () => {
  describe('all clear state', () => {
    it('should show all clear when no aircraft data', () => {
      render(<SquawkWatchlist aircraftData={[]} />);
      expect(screen.getByText('All Clear')).toBeInTheDocument();
      expect(screen.getByText('No emergency squawks active')).toBeInTheDocument();
    });

    it('should show all clear when no special squawks', () => {
      const normalAircraft = [
        { hex: 'abc123', squawk: '1200' },
        { hex: 'def456', squawk: '7000' },
      ];
      render(<SquawkWatchlist aircraftData={normalAircraft} />);
      expect(screen.getByText('All Clear')).toBeInTheDocument();
    });

    it('should show all clear when aircraftData is null', () => {
      render(<SquawkWatchlist aircraftData={null} />);
      expect(screen.getByText('All Clear')).toBeInTheDocument();
    });
  });

  describe('emergency squawk detection', () => {
    it('should detect 7700 emergency squawk', () => {
      const emergencyAircraft = [{ hex: 'emer123', flight: 'EMR123', squawk: '7700' }];
      render(<SquawkWatchlist aircraftData={emergencyAircraft} />);
      expect(screen.getByText('7700')).toBeInTheDocument();
      expect(screen.getByText('EMERGENCY')).toBeInTheDocument();
    });

    it('should detect 7600 radio failure squawk', () => {
      const radioFailAircraft = [{ hex: 'radio123', flight: 'RAD123', squawk: '7600' }];
      render(<SquawkWatchlist aircraftData={radioFailAircraft} />);
      expect(screen.getByText('7600')).toBeInTheDocument();
      expect(screen.getByText('RADIO FAIL')).toBeInTheDocument();
    });

    it('should detect 7500 hijack squawk', () => {
      const hijackAircraft = [{ hex: 'hijack123', flight: 'HIJ123', squawk: '7500' }];
      render(<SquawkWatchlist aircraftData={hijackAircraft} />);
      expect(screen.getByText('7500')).toBeInTheDocument();
      expect(screen.getByText('HIJACK')).toBeInTheDocument();
    });

    it('should display callsign for emergency aircraft', () => {
      const emergencyAircraft = [{ hex: 'emer123', flight: 'UAL911', squawk: '7700' }];
      render(<SquawkWatchlist aircraftData={emergencyAircraft} />);
      expect(screen.getByText('UAL911')).toBeInTheDocument();
    });

    it('should display hex when flight is not available', () => {
      const emergencyAircraft = [{ hex: 'emer123', squawk: '7700' }];
      render(<SquawkWatchlist aircraftData={emergencyAircraft} />);
      expect(screen.getByText('emer123')).toBeInTheDocument();
    });
  });

  describe('multiple emergencies', () => {
    it('should display all emergency aircraft', () => {
      const multipleEmergencies = [
        { hex: 'emer1', flight: 'EMR001', squawk: '7700' },
        { hex: 'emer2', flight: 'EMR002', squawk: '7600' },
      ];
      render(<SquawkWatchlist aircraftData={multipleEmergencies} />);
      expect(screen.getByText('EMR001')).toBeInTheDocument();
      expect(screen.getByText('EMR002')).toBeInTheDocument();
    });
  });

  describe('severity styling', () => {
    it('should apply critical severity for 7700', () => {
      const { container } = render(
        <SquawkWatchlist aircraftData={[{ hex: 'a', squawk: '7700' }]} />
      );
      expect(container.querySelector('.critical')).toBeInTheDocument();
    });

    it('should apply critical severity for 7500', () => {
      const { container } = render(
        <SquawkWatchlist aircraftData={[{ hex: 'a', squawk: '7500' }]} />
      );
      expect(container.querySelector('.critical')).toBeInTheDocument();
    });

    it('should apply warning severity for 7600', () => {
      const { container } = render(
        <SquawkWatchlist aircraftData={[{ hex: 'a', squawk: '7600' }]} />
      );
      expect(container.querySelector('.warning')).toBeInTheDocument();
    });
  });

  describe('selection handling', () => {
    it('should call onSelect when emergency item is clicked', () => {
      const onSelect = vi.fn();
      const emergencyAircraft = [{ hex: 'emer123', flight: 'EMR123', squawk: '7700' }];
      render(<SquawkWatchlist aircraftData={emergencyAircraft} onSelect={onSelect} />);

      fireEvent.click(screen.getByText('EMR123'));
      expect(onSelect).toHaveBeenCalledWith('emer123');
    });

    it('should call onSelect on Enter key', () => {
      const onSelect = vi.fn();
      const emergencyAircraft = [{ hex: 'emer123', flight: 'EMR123', squawk: '7700' }];
      render(<SquawkWatchlist aircraftData={emergencyAircraft} onSelect={onSelect} />);

      const alert = screen.getByText('EMR123').closest('.watchlist-alert');
      fireEvent.keyDown(alert, { key: 'Enter' });
      expect(onSelect).toHaveBeenCalledWith('emer123');
    });
  });

  describe('data format handling', () => {
    it('should handle aircraftData as object with aircraft property', () => {
      const dataAsObject = {
        aircraft: [{ hex: 'emer123', flight: 'EMR123', squawk: '7700' }],
      };
      render(<SquawkWatchlist aircraftData={dataAsObject} />);
      expect(screen.getByText('EMR123')).toBeInTheDocument();
    });

    it('should handle aircraftData as direct array', () => {
      const dataAsArray = [{ hex: 'emer123', flight: 'EMR123', squawk: '7700' }];
      render(<SquawkWatchlist aircraftData={dataAsArray} />);
      expect(screen.getByText('EMR123')).toBeInTheDocument();
    });
  });
});
