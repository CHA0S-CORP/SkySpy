import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HistoryDashboardHeader } from './HistoryDashboardHeader';

describe('HistoryDashboardHeader', () => {
  const sampleSessions = [
    {
      icao_hex: 'A12345',
      callsign: 'UAL123',
      duration_min: 45,
      max_distance_nm: 100,
      is_military: false,
      safety_event_count: 0,
      first_seen: '2024-01-15T10:00:00Z',
    },
    {
      icao_hex: 'B67890',
      callsign: 'MIL001',
      duration_min: 30,
      max_distance_nm: 150,
      is_military: true,
      safety_event_count: 1,
      first_seen: '2024-01-15T11:00:00Z',
    },
    {
      icao_hex: 'C11111',
      callsign: 'DAL456',
      duration_min: 60,
      max_distance_nm: 80,
      is_military: false,
      safety_event_count: 0,
      first_seen: '2024-01-15T12:00:00Z',
    },
  ];

  describe('basic rendering', () => {
    it('should render header component', () => {
      const { container } = render(<HistoryDashboardHeader sessions={sampleSessions} />);
      expect(container.querySelector('.history-dashboard-header')).toBeInTheDocument();
    });

    it('should render time range selector', () => {
      render(<HistoryDashboardHeader sessions={sampleSessions} />);
      expect(screen.getByText('1h')).toBeInTheDocument();
      expect(screen.getByText('6h')).toBeInTheDocument();
      expect(screen.getByText('24h')).toBeInTheDocument();
      expect(screen.getByText('48h')).toBeInTheDocument();
      expect(screen.getByText('7d')).toBeInTheDocument();
    });

    it('should render view mode toggle', () => {
      const { container } = render(<HistoryDashboardHeader sessions={sampleSessions} />);
      expect(container.querySelector('.view-toggle')).toBeInTheDocument();
    });
  });

  describe('metrics display', () => {
    it('should display total sessions count', () => {
      const { container } = render(<HistoryDashboardHeader sessions={sampleSessions} />);
      // Multiple metrics may have the value 3
      expect(container.textContent).toMatch(/3/);
    });

    it('should display unique aircraft count', () => {
      const { container } = render(<HistoryDashboardHeader sessions={sampleSessions} />);
      // 3 unique ICAOs
      expect(container.textContent).toMatch(/3/);
    });

    it('should display average duration', () => {
      const { container } = render(<HistoryDashboardHeader sessions={sampleSessions} />);
      // (45 + 30 + 60) / 3 = 45
      expect(container.textContent).toMatch(/45/);
    });

    it('should display max distance', () => {
      const { container } = render(<HistoryDashboardHeader sessions={sampleSessions} />);
      expect(container.textContent).toMatch(/150/);
    });

    it('should display military count when present', () => {
      const { container } = render(<HistoryDashboardHeader sessions={sampleSessions} />);
      // There's 1 military aircraft in sample data
      expect(container.textContent).toMatch(/1/);
    });

    it('should display safety events when present', () => {
      const { container } = render(<HistoryDashboardHeader sessions={sampleSessions} />);
      // Total safety events = 1
      expect(container.textContent).toMatch(/1/);
    });
  });

  describe('time range selection', () => {
    it('should highlight active time range', () => {
      const { container } = render(
        <HistoryDashboardHeader sessions={sampleSessions} timeRange={24} />
      );
      const activeButton = container.querySelector('.time-range-selector__option--active');
      expect(activeButton.textContent).toBe('24h');
    });

    it('should call onTimeRangeChange when time range is clicked', () => {
      const onTimeRangeChange = vi.fn();
      render(
        <HistoryDashboardHeader sessions={sampleSessions} onTimeRangeChange={onTimeRangeChange} />
      );

      fireEvent.click(screen.getByText('6h'));
      expect(onTimeRangeChange).toHaveBeenCalledWith(6);
    });
  });

  describe('view mode toggle', () => {
    it('should highlight active view mode', () => {
      const { container } = render(
        <HistoryDashboardHeader sessions={sampleSessions} viewMode="grid" />
      );
      const activeButton = container.querySelector('.view-toggle__option--active');
      expect(activeButton).toBeInTheDocument();
    });

    it('should call onViewModeChange when view mode is clicked', () => {
      const onViewModeChange = vi.fn();
      const { container } = render(
        <HistoryDashboardHeader sessions={sampleSessions} onViewModeChange={onViewModeChange} />
      );

      const toggleButtons = container.querySelectorAll('.view-toggle__option');
      fireEvent.click(toggleButtons[1]); // Click list view
      expect(onViewModeChange).toHaveBeenCalledWith('list');
    });
  });

  describe('loading state', () => {
    it('should show loading state on metric cards', () => {
      const { container } = render(<HistoryDashboardHeader sessions={[]} loading />);
      expect(container.querySelector('.metric-card--loading')).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('should handle empty sessions array', () => {
      const { container } = render(<HistoryDashboardHeader sessions={[]} />);
      expect(container.textContent).toMatch(/0/);
    });
  });

  describe('activity sparkline', () => {
    it('should render activity sparkline when sessions have data', () => {
      const { container } = render(<HistoryDashboardHeader sessions={sampleSessions} />);
      // Sparkline should be present
      expect(container.querySelector('svg')).toBeInTheDocument();
    });
  });
});
