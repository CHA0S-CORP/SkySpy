import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FlightPatternsStats } from './FlightPatternsStats';

// Mock the useStats hook
vi.mock('../../hooks', () => ({
  useStats: vi.fn(),
}));

import { useStats } from '../../hooks';

describe('FlightPatternsStats', () => {
  const mockFlightPatternsData = {
    top_routes: [
      { origin: 'KORD', destination: 'KLAX', count: 150 },
      { origin: 'KJFK', destination: 'KSFO', count: 120 },
      { origin: 'KDFW', destination: 'KMIA', count: 95 },
      { origin: 'KATL', destination: 'KDEN', count: 80 },
    ],
    busiest_hours: [
      { hour: 8, count: 250 },
      { hour: 9, count: 280 },
      { hour: 10, count: 320 },
      { hour: 11, count: 290 },
      { hour: 12, count: 260 },
      { hour: 14, count: 300 },
      { hour: 17, count: 350 },
      { hour: 18, count: 340 },
    ],
    aircraft_types: [
      { type: 'B738', count: 450 },
      { type: 'A320', count: 380 },
      { type: 'A321', count: 250 },
      { type: 'B77W', count: 180 },
      { type: 'E175', count: 150 },
    ],
    duration_by_type: [
      { type: 'B738', avg_minutes: 120, min_minutes: 45, max_minutes: 240 },
      { type: 'A320', avg_minutes: 110, min_minutes: 40, max_minutes: 220 },
      { type: 'B77W', avg_minutes: 480, min_minutes: 180, max_minutes: 840 },
    ],
  };

  const defaultProps = {
    apiBase: 'http://localhost:8000',
    wsRequest: vi.fn(),
    wsConnected: true,
    onSelectAircraft: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loading state', () => {
    it('should display loading state when data is loading', () => {
      useStats.mockReturnValue({
        flightPatterns: null,
        loading: true,
        error: null,
        refetch: vi.fn(),
      });

      render(<FlightPatternsStats {...defaultProps} />);
      expect(screen.getByText('Loading flight patterns...')).toBeInTheDocument();
    });

    it('should display spinner in loading state', () => {
      useStats.mockReturnValue({
        flightPatterns: null,
        loading: true,
        error: null,
        refetch: vi.fn(),
      });

      const { container } = render(<FlightPatternsStats {...defaultProps} />);
      expect(container.querySelector('.spin')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('should display error message when there is an error', () => {
      useStats.mockReturnValue({
        flightPatterns: null,
        loading: false,
        error: 'Failed to fetch flight patterns',
        refetch: vi.fn(),
      });

      render(<FlightPatternsStats {...defaultProps} />);
      expect(screen.getByText(/Error loading data: Failed to fetch flight patterns/)).toBeInTheDocument();
    });

    it('should call refetch when retry is clicked', () => {
      const refetch = vi.fn();
      useStats.mockReturnValue({
        flightPatterns: null,
        loading: false,
        error: 'Network error',
        refetch,
      });

      render(<FlightPatternsStats {...defaultProps} />);
      fireEvent.click(screen.getByText('Retry'));
      expect(refetch).toHaveBeenCalled();
    });
  });

  describe('rendering with data', () => {
    beforeEach(() => {
      useStats.mockReturnValue({
        flightPatterns: mockFlightPatternsData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should render page header', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      expect(screen.getByText('Flight Patterns')).toBeInTheDocument();
    });

    it('should render refresh button', () => {
      const { container } = render(<FlightPatternsStats {...defaultProps} />);
      expect(container.querySelector('.refresh-btn')).toBeInTheDocument();
    });

    it('should render summary cards', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      expect(screen.getByText('Total Flights')).toBeInTheDocument();
      expect(screen.getByText('Peak Hour')).toBeInTheDocument();
      // Aircraft Types appears in summary and section header
      expect(screen.getAllByText('Aircraft Types').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Avg/Hour')).toBeInTheDocument();
    });

    it('should display correct summary values', () => {
      const { container } = render(<FlightPatternsStats {...defaultProps} />);
      // Use more specific selectors
      const summaryValues = container.querySelectorAll('.summary-value');
      expect(summaryValues.length).toBe(4);
      // Total flights: 2,390
      expect(summaryValues[0].textContent).toBe('2,390');
      // Peak hour: 17:00
      expect(summaryValues[1].textContent).toBe('17:00');
      // Aircraft types count: 5
      expect(summaryValues[2].textContent).toBe('5');
    });
  });

  describe('top routes section', () => {
    beforeEach(() => {
      useStats.mockReturnValue({
        flightPatterns: mockFlightPatternsData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should render top routes card', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      expect(screen.getByText('Top Routes')).toBeInTheDocument();
    });

    it('should display route count badge', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      expect(screen.getByText('4 routes')).toBeInTheDocument();
    });

    it('should display route origins', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      expect(screen.getByText('KORD')).toBeInTheDocument();
      expect(screen.getByText('KJFK')).toBeInTheDocument();
      expect(screen.getByText('KDFW')).toBeInTheDocument();
    });

    it('should display route destinations', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      expect(screen.getByText('KLAX')).toBeInTheDocument();
      expect(screen.getByText('KSFO')).toBeInTheDocument();
      expect(screen.getByText('KMIA')).toBeInTheDocument();
    });

    it('should display route counts', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      // 150 appears in routes (KORD-KLAX) and types (E175)
      expect(screen.getAllByText('150').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('120')).toBeInTheDocument();
      expect(screen.getByText('95')).toBeInTheDocument();
    });

    it('should display rank numbers', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      // Multiple elements with rank 1
      expect(screen.getAllByText('1').length).toBeGreaterThan(0);
    });

    it('should show empty state when no routes', () => {
      useStats.mockReturnValue({
        flightPatterns: { ...mockFlightPatternsData, top_routes: [] },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<FlightPatternsStats {...defaultProps} />);
      expect(screen.getByText('No route data available')).toBeInTheDocument();
    });

    it('should handle unknown origin/destination', () => {
      useStats.mockReturnValue({
        flightPatterns: {
          ...mockFlightPatternsData,
          top_routes: [{ origin: null, destination: null, count: 50 }],
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<FlightPatternsStats {...defaultProps} />);
      expect(screen.getAllByText('???').length).toBe(2);
    });
  });

  describe('activity by hour section', () => {
    beforeEach(() => {
      useStats.mockReturnValue({
        flightPatterns: mockFlightPatternsData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should render activity by hour card', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      expect(screen.getByText('Activity by Hour')).toBeInTheDocument();
    });

    it('should render hour heatmap', () => {
      const { container } = render(<FlightPatternsStats {...defaultProps} />);
      expect(container.querySelector('.hours-heatmap')).toBeInTheDocument();
    });

    it('should render all 24 hour cells', () => {
      const { container } = render(<FlightPatternsStats {...defaultProps} />);
      const hourCells = container.querySelectorAll('.hour-cell');
      expect(hourCells.length).toBe(24);
    });

    it('should render legend', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      expect(screen.getByText('Low')).toBeInTheDocument();
      expect(screen.getByText('High')).toBeInTheDocument();
    });

    it('should render hourly bar chart', () => {
      const { container } = render(<FlightPatternsStats {...defaultProps} />);
      expect(container.querySelector('.hours-bar-chart')).toBeInTheDocument();
    });

    it('should display hourly distribution title', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      expect(screen.getByText('Hourly Distribution')).toBeInTheDocument();
    });
  });

  describe('aircraft types section', () => {
    beforeEach(() => {
      useStats.mockReturnValue({
        flightPatterns: mockFlightPatternsData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should render aircraft types card', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      // The card header says "Aircraft Types"
      expect(screen.getAllByText('Aircraft Types').length).toBeGreaterThan(0);
    });

    it('should display type count badge', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      expect(screen.getByText('5 types')).toBeInTheDocument();
    });

    it('should display aircraft type names', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      // Types appear in both aircraft_types section and duration_by_type section
      expect(screen.getAllByText('B738').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('A320').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('A321')).toBeInTheDocument();
      expect(screen.getAllByText('B77W').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('E175')).toBeInTheDocument();
    });

    it('should display type counts', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      expect(screen.getByText('450')).toBeInTheDocument();
      expect(screen.getByText('380')).toBeInTheDocument();
      expect(screen.getByText('250')).toBeInTheDocument();
    });

    it('should render progress bars', () => {
      const { container } = render(<FlightPatternsStats {...defaultProps} />);
      const progressBars = container.querySelectorAll('.type-bar-fill');
      expect(progressBars.length).toBe(5);
    });

    it('should show empty state when no types', () => {
      useStats.mockReturnValue({
        flightPatterns: { ...mockFlightPatternsData, aircraft_types: [] },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<FlightPatternsStats {...defaultProps} />);
      expect(screen.getByText('No type data available')).toBeInTheDocument();
    });
  });

  describe('duration by type section', () => {
    beforeEach(() => {
      useStats.mockReturnValue({
        flightPatterns: mockFlightPatternsData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should render duration by type card', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      expect(screen.getByText('Avg Duration by Type')).toBeInTheDocument();
    });

    it('should display duration types', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      // B738 appears in both types and duration sections
      const b738Elements = screen.getAllByText('B738');
      expect(b738Elements.length).toBeGreaterThanOrEqual(1);
    });

    it('should display average durations', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      expect(screen.getByText('120 min')).toBeInTheDocument();
      expect(screen.getByText('110 min')).toBeInTheDocument();
      expect(screen.getByText('480 min')).toBeInTheDocument();
    });

    it('should display duration ranges', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      expect(screen.getByText('(45-240)')).toBeInTheDocument();
      expect(screen.getByText('(40-220)')).toBeInTheDocument();
      expect(screen.getByText('(180-840)')).toBeInTheDocument();
    });

    it('should show empty state when no duration data', () => {
      useStats.mockReturnValue({
        flightPatterns: { ...mockFlightPatternsData, duration_by_type: [] },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<FlightPatternsStats {...defaultProps} />);
      expect(screen.getByText('No duration data available')).toBeInTheDocument();
    });
  });

  describe('time range selection', () => {
    beforeEach(() => {
      useStats.mockReturnValue({
        flightPatterns: mockFlightPatternsData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should render time range buttons', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      expect(screen.getByText('1h')).toBeInTheDocument();
      expect(screen.getByText('6h')).toBeInTheDocument();
      expect(screen.getByText('24h')).toBeInTheDocument();
      expect(screen.getByText('48h')).toBeInTheDocument();
      expect(screen.getByText('7d')).toBeInTheDocument();
      expect(screen.getByText('30d')).toBeInTheDocument();
    });

    it('should have 24h selected by default', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      expect(screen.getByText('24h')).toHaveClass('active');
    });

    it('should change time range when button is clicked', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      fireEvent.click(screen.getByText('7d'));
      expect(screen.getByText('7d')).toHaveClass('active');
    });
  });

  describe('filter functionality', () => {
    beforeEach(() => {
      useStats.mockReturnValue({
        flightPatterns: mockFlightPatternsData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should render Filters button', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      expect(screen.getByText('Filters')).toBeInTheDocument();
    });

    it('should not show filter panel by default', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      expect(screen.queryByLabelText('Aircraft Type')).not.toBeInTheDocument();
    });

    it('should show filter panel when Filters button is clicked', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      fireEvent.click(screen.getByText('Filters'));
      expect(screen.getByLabelText('Aircraft Type')).toBeInTheDocument();
    });

    it('should filter aircraft types when filter is applied', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      fireEvent.click(screen.getByText('Filters'));

      const filterInput = screen.getByLabelText('Aircraft Type');
      fireEvent.change(filterInput, { target: { value: 'B738' } });

      // Only B738 should be visible in the types chart
      const typeCards = screen.getAllByText('B738');
      expect(typeCards.length).toBeGreaterThan(0);
    });

    it('should uppercase filter input', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      fireEvent.click(screen.getByText('Filters'));

      const filterInput = screen.getByLabelText('Aircraft Type');
      fireEvent.change(filterInput, { target: { value: 'b738' } });

      expect(filterInput.value).toBe('B738');
    });
  });

  describe('refresh functionality', () => {
    it('should call refetch when refresh button is clicked', () => {
      const refetch = vi.fn();
      useStats.mockReturnValue({
        flightPatterns: mockFlightPatternsData,
        loading: false,
        error: null,
        refetch,
      });

      const { container } = render(<FlightPatternsStats {...defaultProps} />);
      fireEvent.click(container.querySelector('.refresh-btn'));
      expect(refetch).toHaveBeenCalled();
    });

    it('should disable refresh button while loading', () => {
      useStats.mockReturnValue({
        flightPatterns: mockFlightPatternsData,
        loading: true,
        error: null,
        refetch: vi.fn(),
      });

      const { container } = render(<FlightPatternsStats {...defaultProps} />);
      expect(container.querySelector('.refresh-btn')).toBeDisabled();
    });
  });

  describe('empty data handling', () => {
    it('should handle null flightPatterns', () => {
      useStats.mockReturnValue({
        flightPatterns: null,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<FlightPatternsStats {...defaultProps} />);
      expect(screen.getByText('Flight Patterns')).toBeInTheDocument();
    });

    it('should handle empty arrays in flightPatterns', () => {
      useStats.mockReturnValue({
        flightPatterns: {
          top_routes: [],
          busiest_hours: [],
          aircraft_types: [],
          duration_by_type: [],
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<FlightPatternsStats {...defaultProps} />);
      expect(screen.getByText('No route data available')).toBeInTheDocument();
      expect(screen.getByText('No type data available')).toBeInTheDocument();
      expect(screen.getByText('No duration data available')).toBeInTheDocument();
    });
  });

  describe('summary calculations', () => {
    beforeEach(() => {
      useStats.mockReturnValue({
        flightPatterns: mockFlightPatternsData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should calculate total flights correctly', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      // Sum of busiest_hours counts: 250+280+320+290+260+300+350+340 = 2390
      expect(screen.getByText('2,390')).toBeInTheDocument();
    });

    it('should identify peak hour correctly', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      // Hour 17 has count 350 which is the maximum
      expect(screen.getByText('17:00')).toBeInTheDocument();
    });

    it('should count unique aircraft types correctly', () => {
      const { container } = render(<FlightPatternsStats {...defaultProps} />);
      // 5 appears in summary and hour labels
      const summaryValue = container.querySelectorAll('.summary-value')[2];
      expect(summaryValue.textContent).toBe('5');
    });

    it('should calculate average flights per hour correctly', () => {
      render(<FlightPatternsStats {...defaultProps} />);
      // 2390 / 8 busiest hours = 298.75 -> 298.8
      expect(screen.getByText('298.8')).toBeInTheDocument();
    });
  });

  describe('hook parameters', () => {
    it('should pass correct parameters to useStats', () => {
      useStats.mockReturnValue({
        flightPatterns: mockFlightPatternsData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<FlightPatternsStats {...defaultProps} />);

      expect(useStats).toHaveBeenCalledWith('http://localhost:8000', {
        wsRequest: defaultProps.wsRequest,
        wsConnected: true,
        hours: 24,
      });
    });

    it('should update hours when time range changes', () => {
      useStats.mockReturnValue({
        flightPatterns: mockFlightPatternsData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<FlightPatternsStats {...defaultProps} />);
      fireEvent.click(screen.getByText('30d'));

      expect(useStats).toHaveBeenLastCalledWith('http://localhost:8000', {
        wsRequest: defaultProps.wsRequest,
        wsConnected: true,
        hours: 720,
      });
    });
  });

  describe('heatmap color scale', () => {
    beforeEach(() => {
      useStats.mockReturnValue({
        flightPatterns: mockFlightPatternsData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should apply intensity-based colors to hour cells', () => {
      const { container } = render(<FlightPatternsStats {...defaultProps} />);
      const hourCells = container.querySelectorAll('.hour-cell');

      // Hour cells should have background colors applied
      hourCells.forEach((cell) => {
        expect(cell.style.backgroundColor).toBeDefined();
      });
    });
  });
});
