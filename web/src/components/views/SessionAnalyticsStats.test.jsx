import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionAnalyticsStats } from './SessionAnalyticsStats';

// Mock the useStats hook
vi.mock('../../hooks', () => ({
  useStats: vi.fn(),
}));

import { useStats } from '../../hooks';

describe('SessionAnalyticsStats', () => {
  const mockSessionData = {
    tracking_quality: {
      overall_score: 85,
      update_rate_hz: 2.5,
      avg_rssi: -28.5,
      coverage_pct: 92,
      drop_rate_pct: 0.05,
    },
    engagement: {
      peak_concurrent: 145,
      peak_trend: 12,
      return_aircraft: 78,
      return_percentage: 35.5,
    },
    session_stats: {
      avg_duration_min: 18.5,
      total_sessions: 2450,
      session_distribution: {
        '0-5min': 450,
        '5-15min': 800,
        '15-30min': 650,
        '30-60min': 350,
        '60+min': 200,
      },
    },
    data_completeness: {
      position_pct: 98,
      altitude_pct: 95,
      speed_pct: 92,
      callsign_pct: 88,
      squawk_pct: 75,
      aircraft_type_pct: 82,
    },
    most_watched: [
      {
        icao_hex: 'abc123',
        callsign: 'UAL123',
        aircraft_type: 'B738',
        total_duration_min: 120,
        session_count: 8,
      },
      {
        icao_hex: 'def456',
        callsign: 'DAL456',
        aircraft_type: 'A320',
        total_duration_min: 95,
        session_count: 6,
      },
      {
        icao_hex: 'ghi789',
        callsign: 'AAL789',
        aircraft_type: 'B77W',
        total_duration_min: 85,
        session_count: 5,
      },
    ],
    return_visitors: {
      total_return: 156,
      return_rate: 42.5,
      avg_visits: 3.2,
      frequent_visitors: [
        { icao_hex: 'freq1', callsign: 'FREQ001', visit_count: 15 },
        { icao_hex: 'freq2', callsign: 'FREQ002', visit_count: 12 },
      ],
    },
  };

  const defaultProps = {
    apiBase: 'http://localhost:8000',
    wsRequest: vi.fn(),
    wsConnected: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loading state', () => {
    it('should display loading state when data is loading', () => {
      useStats.mockReturnValue({
        sessionAnalytics: null,
        loading: true,
        error: null,
        refetch: vi.fn(),
      });

      render(<SessionAnalyticsStats {...defaultProps} />);
      expect(screen.getByText('Loading session analytics...')).toBeInTheDocument();
    });

    it('should display spinner in loading state', () => {
      useStats.mockReturnValue({
        sessionAnalytics: null,
        loading: true,
        error: null,
        refetch: vi.fn(),
      });

      const { container } = render(<SessionAnalyticsStats {...defaultProps} />);
      expect(container.querySelector('.spin')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('should display error message when there is an error', () => {
      useStats.mockReturnValue({
        sessionAnalytics: null,
        loading: false,
        error: 'Failed to fetch session data',
        refetch: vi.fn(),
      });

      render(<SessionAnalyticsStats {...defaultProps} />);
      expect(
        screen.getByText(/Error loading data: Failed to fetch session data/)
      ).toBeInTheDocument();
    });

    it('should call refetch when retry is clicked', () => {
      const refetch = vi.fn();
      useStats.mockReturnValue({
        sessionAnalytics: null,
        loading: false,
        error: 'Network error',
        refetch,
      });

      render(<SessionAnalyticsStats {...defaultProps} />);
      fireEvent.click(screen.getByText('Retry'));
      expect(refetch).toHaveBeenCalled();
    });
  });

  describe('rendering with data', () => {
    beforeEach(() => {
      useStats.mockReturnValue({
        sessionAnalytics: mockSessionData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should render page header', () => {
      render(<SessionAnalyticsStats {...defaultProps} />);
      expect(screen.getByText('Session Analytics')).toBeInTheDocument();
    });

    it('should render refresh button', () => {
      const { container } = render(<SessionAnalyticsStats {...defaultProps} />);
      expect(container.querySelector('.refresh-btn')).toBeInTheDocument();
    });

    it('should render summary cards', () => {
      render(<SessionAnalyticsStats {...defaultProps} />);
      // Quality Score appears in summary card and gauge
      expect(screen.getAllByText('Quality Score').length).toBeGreaterThanOrEqual(1);
      // These appear in multiple places
      expect(screen.getAllByText('Peak Concurrent').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Total Sessions').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Avg Duration')).toBeInTheDocument();
    });

    it('should display correct summary values', () => {
      const { container } = render(<SessionAnalyticsStats {...defaultProps} />);
      // Use more specific selectors to find summary values
      const summaryValues = container.querySelectorAll('.summary-value');
      expect(summaryValues.length).toBe(4);
      // Quality score: 85%
      expect(summaryValues[0].textContent).toContain('85%');
      // Peak concurrent: 145
      expect(summaryValues[1].textContent).toBe('145');
      // Total sessions: 2,450
      expect(summaryValues[2].textContent).toBe('2,450');
      // Avg duration: 19m (rounded from 18.5)
      expect(summaryValues[3].textContent).toBe('19m');
    });
  });

  describe('tracking quality section', () => {
    beforeEach(() => {
      useStats.mockReturnValue({
        sessionAnalytics: mockSessionData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should render tracking quality card', () => {
      render(<SessionAnalyticsStats {...defaultProps} />);
      expect(screen.getByText('Tracking Quality')).toBeInTheDocument();
    });

    it('should render quality gauge', () => {
      const { container } = render(<SessionAnalyticsStats {...defaultProps} />);
      expect(container.querySelector('.quality-gauge')).toBeInTheDocument();
    });

    it('should display quality score in gauge', () => {
      const { container } = render(<SessionAnalyticsStats {...defaultProps} />);
      const gaugeValue = container.querySelector('.gauge-value');
      expect(gaugeValue.textContent).toBe('85');
    });

    it('should display quality details', () => {
      render(<SessionAnalyticsStats {...defaultProps} />);
      expect(screen.getByText('Update Rate')).toBeInTheDocument();
      expect(screen.getByText('2.5 Hz')).toBeInTheDocument();
      expect(screen.getByText('Avg Signal')).toBeInTheDocument();
      expect(screen.getByText('-28.5 dB')).toBeInTheDocument();
      expect(screen.getByText('Coverage')).toBeInTheDocument();
      // 92% appears multiple times (coverage and speed completeness)
      expect(screen.getAllByText('92%').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Msg Drop Rate')).toBeInTheDocument();
      expect(screen.getByText('0.05%')).toBeInTheDocument();
    });
  });

  describe('engagement metrics section', () => {
    beforeEach(() => {
      useStats.mockReturnValue({
        sessionAnalytics: mockSessionData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should render engagement metrics card', () => {
      render(<SessionAnalyticsStats {...defaultProps} />);
      expect(screen.getByText('Engagement Metrics')).toBeInTheDocument();
    });

    it('should display peak concurrent metric', () => {
      render(<SessionAnalyticsStats {...defaultProps} />);
      // The value should appear in both summary and detailed view
      expect(screen.getAllByText('145').length).toBeGreaterThan(0);
      expect(screen.getByText('Maximum aircraft tracked simultaneously')).toBeInTheDocument();
    });

    it('should display return aircraft metric', () => {
      render(<SessionAnalyticsStats {...defaultProps} />);
      expect(screen.getByText('Return Aircraft')).toBeInTheDocument();
      expect(screen.getByText('78')).toBeInTheDocument();
      expect(screen.getByText('35.5%')).toBeInTheDocument();
    });

    it('should display avg track duration metric', () => {
      render(<SessionAnalyticsStats {...defaultProps} />);
      expect(screen.getByText('Avg Track Duration')).toBeInTheDocument();
      // 19m appears in summary and detailed view
      expect(screen.getAllByText('19m').length).toBeGreaterThanOrEqual(1);
    });

    it('should display total sessions metric', () => {
      render(<SessionAnalyticsStats {...defaultProps} />);
      // Total Sessions appears in summary card and engagement metrics
      expect(screen.getAllByText('Total Sessions').length).toBeGreaterThanOrEqual(1);
      // Multiple instances of 2,450 may appear
      expect(screen.getAllByText('2,450').length).toBeGreaterThan(0);
    });

    it('should display trend indicator when trend is provided', () => {
      render(<SessionAnalyticsStats {...defaultProps} />);
      expect(screen.getByText('+12%')).toBeInTheDocument();
    });
  });

  describe('data completeness section', () => {
    beforeEach(() => {
      useStats.mockReturnValue({
        sessionAnalytics: mockSessionData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should render data completeness card', () => {
      render(<SessionAnalyticsStats {...defaultProps} />);
      expect(screen.getByText('Data Completeness')).toBeInTheDocument();
    });

    it('should display completeness metrics', () => {
      render(<SessionAnalyticsStats {...defaultProps} />);
      expect(screen.getByText('Position')).toBeInTheDocument();
      expect(screen.getByText('98%')).toBeInTheDocument();
      expect(screen.getByText('Altitude')).toBeInTheDocument();
      expect(screen.getByText('95%')).toBeInTheDocument();
      expect(screen.getByText('Speed')).toBeInTheDocument();
      expect(screen.getByText('Callsign')).toBeInTheDocument();
      expect(screen.getByText('88%')).toBeInTheDocument();
      expect(screen.getByText('Squawk')).toBeInTheDocument();
      expect(screen.getByText('75%')).toBeInTheDocument();
      expect(screen.getByText('Type')).toBeInTheDocument();
      expect(screen.getByText('82%')).toBeInTheDocument();
    });

    it('should render progress bars for completeness', () => {
      const { container } = render(<SessionAnalyticsStats {...defaultProps} />);
      const progressBars = container.querySelectorAll('.completeness-bar-fill');
      expect(progressBars.length).toBe(6); // 6 completeness metrics
    });
  });

  describe('most watched aircraft section', () => {
    beforeEach(() => {
      useStats.mockReturnValue({
        sessionAnalytics: mockSessionData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should render most watched card', () => {
      render(<SessionAnalyticsStats {...defaultProps} />);
      expect(screen.getByText('Most Watched Aircraft')).toBeInTheDocument();
    });

    it('should display watched aircraft', () => {
      render(<SessionAnalyticsStats {...defaultProps} />);
      expect(screen.getByText('UAL123')).toBeInTheDocument();
      expect(screen.getByText('DAL456')).toBeInTheDocument();
      expect(screen.getByText('AAL789')).toBeInTheDocument();
    });

    it('should display aircraft types', () => {
      render(<SessionAnalyticsStats {...defaultProps} />);
      expect(screen.getByText('B738')).toBeInTheDocument();
      expect(screen.getByText('A320')).toBeInTheDocument();
      expect(screen.getByText('B77W')).toBeInTheDocument();
    });

    it('should display duration and session count', () => {
      render(<SessionAnalyticsStats {...defaultProps} />);
      expect(screen.getByText('120m')).toBeInTheDocument();
      expect(screen.getByText('8 sessions')).toBeInTheDocument();
    });

    it('should display rank numbers', () => {
      render(<SessionAnalyticsStats {...defaultProps} />);
      const ranks = screen.getAllByText('1');
      expect(ranks.length).toBeGreaterThan(0);
    });

    it('should not render section when no watched aircraft', () => {
      useStats.mockReturnValue({
        sessionAnalytics: { ...mockSessionData, most_watched: [] },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<SessionAnalyticsStats {...defaultProps} />);
      expect(screen.queryByText('Most Watched Aircraft')).not.toBeInTheDocument();
    });
  });

  describe('return visitors section', () => {
    beforeEach(() => {
      useStats.mockReturnValue({
        sessionAnalytics: mockSessionData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should render return visitors card', () => {
      render(<SessionAnalyticsStats {...defaultProps} />);
      expect(screen.getByText('Return Visitors Analysis')).toBeInTheDocument();
    });

    it('should display return statistics', () => {
      render(<SessionAnalyticsStats {...defaultProps} />);
      expect(screen.getByText('Returning Aircraft')).toBeInTheDocument();
      expect(screen.getByText('156')).toBeInTheDocument();
      expect(screen.getByText('Return Rate')).toBeInTheDocument();
      expect(screen.getByText('42.5%')).toBeInTheDocument();
      expect(screen.getByText('Avg Visits')).toBeInTheDocument();
      expect(screen.getByText('3.2')).toBeInTheDocument();
    });

    it('should display frequent visitors', () => {
      render(<SessionAnalyticsStats {...defaultProps} />);
      expect(screen.getByText('Frequent Visitors')).toBeInTheDocument();
      expect(screen.getByText('FREQ001')).toBeInTheDocument();
      expect(screen.getByText('15 visits')).toBeInTheDocument();
      expect(screen.getByText('FREQ002')).toBeInTheDocument();
      expect(screen.getByText('12 visits')).toBeInTheDocument();
    });

    it('should not render section when no return visitors data', () => {
      useStats.mockReturnValue({
        sessionAnalytics: { ...mockSessionData, return_visitors: {} },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<SessionAnalyticsStats {...defaultProps} />);
      expect(screen.queryByText('Return Visitors Analysis')).not.toBeInTheDocument();
    });
  });

  describe('session distribution section', () => {
    beforeEach(() => {
      useStats.mockReturnValue({
        sessionAnalytics: mockSessionData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should render session distribution card', () => {
      render(<SessionAnalyticsStats {...defaultProps} />);
      expect(screen.getByText('Session Duration Distribution')).toBeInTheDocument();
    });

    it('should display distribution bars', () => {
      render(<SessionAnalyticsStats {...defaultProps} />);
      expect(screen.getByText('0-5min')).toBeInTheDocument();
      expect(screen.getByText('5-15min')).toBeInTheDocument();
      expect(screen.getByText('15-30min')).toBeInTheDocument();
      expect(screen.getByText('30-60min')).toBeInTheDocument();
      expect(screen.getByText('60+min')).toBeInTheDocument();
    });

    it('should display distribution counts', () => {
      render(<SessionAnalyticsStats {...defaultProps} />);
      expect(screen.getByText('450')).toBeInTheDocument();
      expect(screen.getByText('800')).toBeInTheDocument();
      expect(screen.getByText('650')).toBeInTheDocument();
      expect(screen.getByText('350')).toBeInTheDocument();
      expect(screen.getByText('200')).toBeInTheDocument();
    });

    it('should not render section when no distribution data', () => {
      useStats.mockReturnValue({
        sessionAnalytics: {
          ...mockSessionData,
          session_stats: { ...mockSessionData.session_stats, session_distribution: null },
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<SessionAnalyticsStats {...defaultProps} />);
      expect(screen.queryByText('Session Duration Distribution')).not.toBeInTheDocument();
    });
  });

  describe('time range selection', () => {
    beforeEach(() => {
      useStats.mockReturnValue({
        sessionAnalytics: mockSessionData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should render time range buttons', () => {
      render(<SessionAnalyticsStats {...defaultProps} />);
      expect(screen.getByText('1h')).toBeInTheDocument();
      expect(screen.getByText('6h')).toBeInTheDocument();
      expect(screen.getByText('24h')).toBeInTheDocument();
      expect(screen.getByText('48h')).toBeInTheDocument();
      expect(screen.getByText('7d')).toBeInTheDocument();
      expect(screen.getByText('30d')).toBeInTheDocument();
    });

    it('should have 24h selected by default', () => {
      render(<SessionAnalyticsStats {...defaultProps} />);
      expect(screen.getByText('24h')).toHaveClass('active');
    });

    it('should change time range when button is clicked', () => {
      render(<SessionAnalyticsStats {...defaultProps} />);
      fireEvent.click(screen.getByText('7d'));
      expect(screen.getByText('7d')).toHaveClass('active');
    });
  });

  describe('quality score colors', () => {
    it('should apply green color for high quality score (>=90)', () => {
      useStats.mockReturnValue({
        sessionAnalytics: {
          ...mockSessionData,
          tracking_quality: { ...mockSessionData.tracking_quality, overall_score: 95 },
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<SessionAnalyticsStats {...defaultProps} />);
      const qualityValue = screen.getAllByText('95%')[0];
      expect(qualityValue).toHaveStyle({ color: '#00ff88' });
    });

    it('should apply cyan color for good quality score (>=70)', () => {
      useStats.mockReturnValue({
        sessionAnalytics: mockSessionData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<SessionAnalyticsStats {...defaultProps} />);
      // 85% quality score should be cyan
      const qualityValue = screen.getAllByText('85%')[0];
      expect(qualityValue).toHaveStyle({ color: '#00c8ff' });
    });

    it('should apply yellow color for moderate quality score (>=50)', () => {
      useStats.mockReturnValue({
        sessionAnalytics: {
          ...mockSessionData,
          tracking_quality: { ...mockSessionData.tracking_quality, overall_score: 60 },
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<SessionAnalyticsStats {...defaultProps} />);
      const qualityValue = screen.getAllByText('60%')[0];
      expect(qualityValue).toHaveStyle({ color: '#f7d794' });
    });

    it('should apply red color for low quality score (<50)', () => {
      useStats.mockReturnValue({
        sessionAnalytics: {
          ...mockSessionData,
          tracking_quality: { ...mockSessionData.tracking_quality, overall_score: 35 },
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<SessionAnalyticsStats {...defaultProps} />);
      const qualityValue = screen.getAllByText('35%')[0];
      expect(qualityValue).toHaveStyle({ color: '#ff4757' });
    });
  });

  describe('refresh functionality', () => {
    it('should call refetch when refresh button is clicked', () => {
      const refetch = vi.fn();
      useStats.mockReturnValue({
        sessionAnalytics: mockSessionData,
        loading: false,
        error: null,
        refetch,
      });

      const { container } = render(<SessionAnalyticsStats {...defaultProps} />);
      fireEvent.click(container.querySelector('.refresh-btn'));
      expect(refetch).toHaveBeenCalled();
    });

    it('should disable refresh button while loading', () => {
      useStats.mockReturnValue({
        sessionAnalytics: mockSessionData,
        loading: true,
        error: null,
        refetch: vi.fn(),
      });

      const { container } = render(<SessionAnalyticsStats {...defaultProps} />);
      expect(container.querySelector('.refresh-btn')).toBeDisabled();
    });
  });

  describe('empty data handling', () => {
    it('should handle null sessionAnalytics', () => {
      useStats.mockReturnValue({
        sessionAnalytics: null,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<SessionAnalyticsStats {...defaultProps} />);
      expect(screen.getByText('Session Analytics')).toBeInTheDocument();
    });

    it('should handle missing nested properties', () => {
      useStats.mockReturnValue({
        sessionAnalytics: {
          tracking_quality: {},
          engagement: {},
          session_stats: {},
          data_completeness: {},
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<SessionAnalyticsStats {...defaultProps} />);
      expect(screen.getByText('Session Analytics')).toBeInTheDocument();
      // Default values should be shown
      expect(screen.getAllByText('--').length).toBeGreaterThan(0);
    });
  });

  describe('hook parameters', () => {
    it('should pass correct parameters to useStats', () => {
      useStats.mockReturnValue({
        sessionAnalytics: mockSessionData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<SessionAnalyticsStats {...defaultProps} />);

      expect(useStats).toHaveBeenCalledWith('http://localhost:8000', {
        wsRequest: defaultProps.wsRequest,
        wsConnected: true,
        hours: 24,
      });
    });

    it('should update hours when time range changes', () => {
      useStats.mockReturnValue({
        sessionAnalytics: mockSessionData,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<SessionAnalyticsStats {...defaultProps} />);
      fireEvent.click(screen.getByText('48h'));

      expect(useStats).toHaveBeenLastCalledWith('http://localhost:8000', {
        wsRequest: defaultProps.wsRequest,
        wsConnected: true,
        hours: 48,
      });
    });
  });
});
