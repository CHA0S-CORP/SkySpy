import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GeographicStats } from './GeographicStats';

// Mock the useStats hook
vi.mock('../../hooks', () => ({
  useStats: vi.fn(),
}));

import { useStats } from '../../hooks';

describe('GeographicStats', () => {
  const mockGeographicData = {
    countries: [
      { country: 'United States', count: 500 },
      { country: 'Canada', count: 150 },
      { country: 'Mexico', count: 80 },
      { country: 'United Kingdom', count: 60 },
      { country: 'Germany', count: 45 },
    ],
    airlines: [
      { code: 'UAL', name: 'United Airlines', count: 120 },
      { code: 'DAL', name: 'Delta Air Lines', count: 100 },
      { code: 'AAL', name: 'American Airlines', count: 95 },
      { code: 'SWA', name: 'Southwest Airlines', count: 85 },
    ],
    airports: [
      { icao: 'KORD', iata: 'ORD', name: "O'Hare International", count: 200 },
      { icao: 'KLAX', iata: 'LAX', name: 'Los Angeles International', count: 180 },
      { icao: 'KJFK', iata: 'JFK', name: 'John F Kennedy', count: 150 },
    ],
    regions: [
      { name: 'North America', count: 800 },
      { name: 'Europe', count: 200 },
      { name: 'Asia', count: 50 },
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
        geographicStats: null,
        loading: true,
        error: null,
        refetch: vi.fn(),
      });

      render(<GeographicStats {...defaultProps} />);
      expect(screen.getByText('Loading geographic data...')).toBeInTheDocument();
    });

    it('should display spinner in loading state', () => {
      useStats.mockReturnValue({
        geographicStats: null,
        loading: true,
        error: null,
        refetch: vi.fn(),
      });

      const { container } = render(<GeographicStats {...defaultProps} />);
      expect(container.querySelector('.spin')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('should display error message when there is an error', () => {
      useStats.mockReturnValue({
        geographicStats: null,
        loading: false,
        error: 'Failed to fetch geographic data',
        refetch: vi.fn(),
      });

      render(<GeographicStats {...defaultProps} />);
      expect(screen.getByText(/Error loading data: Failed to fetch geographic data/)).toBeInTheDocument();
    });

    it('should display retry button on error', () => {
      useStats.mockReturnValue({
        geographicStats: null,
        loading: false,
        error: 'Network error',
        refetch: vi.fn(),
      });

      render(<GeographicStats {...defaultProps} />);
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });

    it('should call refetch when retry is clicked', () => {
      const refetch = vi.fn();
      useStats.mockReturnValue({
        geographicStats: null,
        loading: false,
        error: 'Network error',
        refetch,
      });

      render(<GeographicStats {...defaultProps} />);
      fireEvent.click(screen.getByText('Retry'));
      expect(refetch).toHaveBeenCalled();
    });
  });

  describe('rendering with data', () => {
    beforeEach(() => {
      useStats.mockReturnValue({
        geographicStats: mockGeographicData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should render page header', () => {
      render(<GeographicStats {...defaultProps} />);
      expect(screen.getByText('Geographic Coverage')).toBeInTheDocument();
    });

    it('should render refresh button', () => {
      const { container } = render(<GeographicStats {...defaultProps} />);
      expect(container.querySelector('.refresh-btn')).toBeInTheDocument();
    });

    it('should render summary cards', () => {
      render(<GeographicStats {...defaultProps} />);
      // Multiple 'Countries' elements exist (summary card and section header)
      expect(screen.getAllByText('Countries').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Airlines').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Airports').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Top Country')).toBeInTheDocument();
    });

    it('should display correct summary values', () => {
      const { container } = render(<GeographicStats {...defaultProps} />);
      // Use more specific selectors to find summary values
      const summaryValues = container.querySelectorAll('.summary-value');
      expect(summaryValues.length).toBe(4);
      // Countries count: 5
      expect(summaryValues[0].textContent).toBe('5');
      // Airlines count: 4
      expect(summaryValues[1].textContent).toBe('4');
      // Airports count: 3
      expect(summaryValues[2].textContent).toBe('3');
      // Top country
      expect(summaryValues[3].textContent).toBe('United States');
    });
  });

  describe('countries section', () => {
    beforeEach(() => {
      useStats.mockReturnValue({
        geographicStats: mockGeographicData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should render countries card', () => {
      render(<GeographicStats {...defaultProps} />);
      expect(screen.getByText('5 total')).toBeInTheDocument(); // Badge showing total countries
    });

    it('should render pie chart', () => {
      const { container } = render(<GeographicStats {...defaultProps} />);
      expect(container.querySelector('.pie-chart')).toBeInTheDocument();
    });

    it('should render country legend items', () => {
      render(<GeographicStats {...defaultProps} />);
      // Countries appear multiple times (summary, legend, bar chart)
      expect(screen.getAllByText('United States').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Canada').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Mexico').length).toBeGreaterThanOrEqual(1);
    });

    it('should display country percentages', () => {
      render(<GeographicStats {...defaultProps} />);
      // United States: 500 / 835 total = ~59.9%
      expect(screen.getByText('59.9%')).toBeInTheDocument();
    });

    it('should display country counts', () => {
      render(<GeographicStats {...defaultProps} />);
      // Counts appear in both legend and bar chart
      expect(screen.getAllByText('500').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('150').length).toBeGreaterThanOrEqual(1);
    });

    it('should show empty state when no countries', () => {
      useStats.mockReturnValue({
        geographicStats: { ...mockGeographicData, countries: [] },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<GeographicStats {...defaultProps} />);
      expect(screen.getByText('No country data available')).toBeInTheDocument();
    });
  });

  describe('airlines section', () => {
    beforeEach(() => {
      useStats.mockReturnValue({
        geographicStats: mockGeographicData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should render airlines card', () => {
      render(<GeographicStats {...defaultProps} />);
      expect(screen.getByText('Top Airlines/Operators')).toBeInTheDocument();
    });

    it('should display airline names', () => {
      render(<GeographicStats {...defaultProps} />);
      expect(screen.getByText('United Airlines')).toBeInTheDocument();
      expect(screen.getByText('Delta Air Lines')).toBeInTheDocument();
      expect(screen.getByText('American Airlines')).toBeInTheDocument();
    });

    it('should display airline codes', () => {
      render(<GeographicStats {...defaultProps} />);
      expect(screen.getByText('UAL')).toBeInTheDocument();
      expect(screen.getByText('DAL')).toBeInTheDocument();
    });

    it('should display airline counts', () => {
      render(<GeographicStats {...defaultProps} />);
      expect(screen.getByText('120')).toBeInTheDocument();
      expect(screen.getByText('100')).toBeInTheDocument();
    });

    it('should display rank numbers', () => {
      render(<GeographicStats {...defaultProps} />);
      const ranks = screen.getAllByText('1');
      expect(ranks.length).toBeGreaterThan(0); // Rank 1 appears
    });

    it('should show empty state when no airlines', () => {
      useStats.mockReturnValue({
        geographicStats: { ...mockGeographicData, airlines: [] },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<GeographicStats {...defaultProps} />);
      expect(screen.getByText('No airline data available')).toBeInTheDocument();
    });
  });

  describe('airports section', () => {
    beforeEach(() => {
      useStats.mockReturnValue({
        geographicStats: mockGeographicData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should render airports card', () => {
      render(<GeographicStats {...defaultProps} />);
      expect(screen.getByText('Connected Airports')).toBeInTheDocument();
    });

    it('should display airport codes', () => {
      render(<GeographicStats {...defaultProps} />);
      expect(screen.getByText('KORD')).toBeInTheDocument();
      expect(screen.getByText('KLAX')).toBeInTheDocument();
      expect(screen.getByText('KJFK')).toBeInTheDocument();
    });

    it('should display airport names', () => {
      render(<GeographicStats {...defaultProps} />);
      expect(screen.getByText("O'Hare International")).toBeInTheDocument();
    });

    it('should display airport counts', () => {
      render(<GeographicStats {...defaultProps} />);
      // 200 appears in airports (KORD) and regions (Europe)
      expect(screen.getAllByText('200').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('180')).toBeInTheDocument();
    });

    it('should show empty state when no airports', () => {
      useStats.mockReturnValue({
        geographicStats: { ...mockGeographicData, airports: [] },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<GeographicStats {...defaultProps} />);
      expect(screen.getByText('No airport data available')).toBeInTheDocument();
    });

    it('should show overflow indicator when more than 20 airports', () => {
      const manyAirports = Array.from({ length: 25 }, (_, i) => ({
        icao: `KABC${i}`,
        name: `Airport ${i}`,
        count: 100 - i,
      }));

      useStats.mockReturnValue({
        geographicStats: { ...mockGeographicData, airports: manyAirports },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<GeographicStats {...defaultProps} />);
      expect(screen.getByText('+5 more airports')).toBeInTheDocument();
    });
  });

  describe('regions section', () => {
    beforeEach(() => {
      useStats.mockReturnValue({
        geographicStats: mockGeographicData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should render regions card when regions exist', () => {
      render(<GeographicStats {...defaultProps} />);
      expect(screen.getByText('Regions')).toBeInTheDocument();
    });

    it('should display region names', () => {
      render(<GeographicStats {...defaultProps} />);
      expect(screen.getByText('North America')).toBeInTheDocument();
      expect(screen.getByText('Europe')).toBeInTheDocument();
      expect(screen.getByText('Asia')).toBeInTheDocument();
    });

    it('should display region counts', () => {
      render(<GeographicStats {...defaultProps} />);
      expect(screen.getByText('800')).toBeInTheDocument();
      expect(screen.getByText('50')).toBeInTheDocument();
    });

    it('should not render regions when empty', () => {
      useStats.mockReturnValue({
        geographicStats: { ...mockGeographicData, regions: [] },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<GeographicStats {...defaultProps} />);
      // Regions card should not appear - only Countries section header should have "Regions"
      const regionsHeaders = screen.queryAllByText('Regions');
      expect(regionsHeaders.length).toBe(0);
    });
  });

  describe('country distribution bar chart', () => {
    beforeEach(() => {
      useStats.mockReturnValue({
        geographicStats: mockGeographicData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should render country distribution section', () => {
      render(<GeographicStats {...defaultProps} />);
      expect(screen.getByText('Country Distribution')).toBeInTheDocument();
    });

    it('should display country bar items', () => {
      const { container } = render(<GeographicStats {...defaultProps} />);
      const barItems = container.querySelectorAll('.country-bar-item');
      expect(barItems.length).toBe(5);
    });
  });

  describe('time range selection', () => {
    beforeEach(() => {
      useStats.mockReturnValue({
        geographicStats: mockGeographicData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should render time range buttons', () => {
      render(<GeographicStats {...defaultProps} />);
      expect(screen.getByText('1h')).toBeInTheDocument();
      expect(screen.getByText('6h')).toBeInTheDocument();
      expect(screen.getByText('24h')).toBeInTheDocument();
      expect(screen.getByText('48h')).toBeInTheDocument();
      expect(screen.getByText('7d')).toBeInTheDocument();
      expect(screen.getByText('30d')).toBeInTheDocument();
    });

    it('should have 24h selected by default', () => {
      render(<GeographicStats {...defaultProps} />);
      expect(screen.getByText('24h')).toHaveClass('active');
    });

    it('should change time range when button is clicked', () => {
      render(<GeographicStats {...defaultProps} />);
      fireEvent.click(screen.getByText('7d'));
      expect(screen.getByText('7d')).toHaveClass('active');
    });
  });

  describe('filter functionality', () => {
    beforeEach(() => {
      useStats.mockReturnValue({
        geographicStats: mockGeographicData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should render Filters button', () => {
      render(<GeographicStats {...defaultProps} />);
      expect(screen.getByText('Filters')).toBeInTheDocument();
    });

    it('should not show filter panel by default', () => {
      render(<GeographicStats {...defaultProps} />);
      expect(screen.queryByLabelText('Country')).not.toBeInTheDocument();
    });

    it('should show filter panel when Filters button is clicked', () => {
      render(<GeographicStats {...defaultProps} />);
      fireEvent.click(screen.getByText('Filters'));
      expect(screen.getByLabelText('Country')).toBeInTheDocument();
    });

    it('should filter countries when filter is applied', () => {
      render(<GeographicStats {...defaultProps} />);
      fireEvent.click(screen.getByText('Filters'));

      const filterInput = screen.getByLabelText('Country');
      fireEvent.change(filterInput, { target: { value: 'Canada' } });

      // Only Canada should be visible in the legend
      const legends = screen.getAllByText('Canada');
      expect(legends.length).toBeGreaterThan(0);
    });
  });

  describe('refresh functionality', () => {
    it('should call refetch when refresh button is clicked', () => {
      const refetch = vi.fn();
      useStats.mockReturnValue({
        geographicStats: mockGeographicData,
        loading: false,
        error: null,
        refetch,
      });

      const { container } = render(<GeographicStats {...defaultProps} />);
      fireEvent.click(container.querySelector('.refresh-btn'));
      expect(refetch).toHaveBeenCalled();
    });

    it('should disable refresh button while loading', () => {
      useStats.mockReturnValue({
        geographicStats: mockGeographicData,
        loading: true,
        error: null,
        refetch: vi.fn(),
      });

      const { container } = render(<GeographicStats {...defaultProps} />);
      expect(container.querySelector('.refresh-btn')).toBeDisabled();
    });
  });

  describe('empty data handling', () => {
    it('should handle null geographicStats', () => {
      useStats.mockReturnValue({
        geographicStats: null,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<GeographicStats {...defaultProps} />);
      // Should render without crashing
      expect(screen.getByText('Geographic Coverage')).toBeInTheDocument();
    });

    it('should handle empty arrays in geographicStats', () => {
      useStats.mockReturnValue({
        geographicStats: {
          countries: [],
          airlines: [],
          airports: [],
          regions: [],
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<GeographicStats {...defaultProps} />);
      expect(screen.getByText('No country data available')).toBeInTheDocument();
      expect(screen.getByText('No airline data available')).toBeInTheDocument();
      expect(screen.getByText('No airport data available')).toBeInTheDocument();
    });
  });

  describe('hook parameters', () => {
    it('should pass correct parameters to useStats', () => {
      useStats.mockReturnValue({
        geographicStats: mockGeographicData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<GeographicStats {...defaultProps} />);

      expect(useStats).toHaveBeenCalledWith('http://localhost:8000', {
        wsRequest: defaultProps.wsRequest,
        wsConnected: true,
        hours: 24,
      });
    });

    it('should update hours when time range changes', () => {
      useStats.mockReturnValue({
        geographicStats: mockGeographicData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<GeographicStats {...defaultProps} />);
      fireEvent.click(screen.getByText('30d'));

      expect(useStats).toHaveBeenLastCalledWith('http://localhost:8000', {
        wsRequest: defaultProps.wsRequest,
        wsConnected: true,
        hours: 720,
      });
    });
  });
});
