import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GamificationStats } from './GamificationStats';

// Mock the useStats hook
vi.mock('../../hooks', () => ({
  useStats: vi.fn(),
}));

// Mock the child tab components
vi.mock('../gamification/RecordsTab', () => ({
  RecordsTab: ({ personal_records, onSelectAircraft }) => (
    <div data-testid="records-tab">
      Records: {personal_records.length}
      {personal_records.map((r, i) => (
        <button key={i} onClick={() => onSelectAircraft?.(r.icao_hex)}>
          {r.title}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('../gamification/SightingsTab', () => ({
  SightingsTab: ({ rare_sightings }) => (
    <div data-testid="sightings-tab">Sightings: {rare_sightings.length}</div>
  ),
}));

vi.mock('../gamification/StreaksTab', () => ({
  StreaksTab: ({ streaks }) => (
    <div data-testid="streaks-tab">Streak: {streaks.daily_active || 0}</div>
  ),
}));

vi.mock('../gamification/BadgesTab', () => ({
  BadgesTab: ({ badges }) => (
    <div data-testid="badges-tab">Badges: {badges.length}</div>
  ),
}));

import { useStats } from '../../hooks';

describe('GamificationStats', () => {
  const mockAchievements = {
    personal_records: [
      { type: 'furthest_distance', title: 'Furthest Distance', value: '250nm', icao_hex: 'abc123' },
      { type: 'highest_altitude', title: 'Highest Altitude', value: '45,000ft', icao_hex: 'def456' },
    ],
    rare_sightings: [
      { icao_hex: 'rare1', aircraft_type: 'A380', rarity: 'epic' },
      { icao_hex: 'rare2', aircraft_type: 'AN225', rarity: 'legendary' },
    ],
    collection_progress: {
      airlines_collected: 45,
      airlines_target: 100,
      types_collected: 80,
      types_target: 100,
      countries_collected: 25,
      countries_target: 50,
      recent_unlocks: ['Delta', 'United', 'A350'],
    },
    streaks: {
      daily_active: 7,
      early_bird: 3,
      night_owl: 2,
      variety_hunter: 5,
      best_daily: 14,
    },
    milestones: [
      { id: 1, title: '100 Aircraft', description: 'Track 100 unique aircraft', achieved: true, date: '2024-01-15' },
      { id: 2, title: '1000 Aircraft', description: 'Track 1000 unique aircraft', achieved: false, progress: 45 },
    ],
    badges: [
      { id: 1, name: 'First Flight', unlocked: true, icon: 'plane', color: '#00c8ff' },
      { id: 2, name: 'Military Spotter', unlocked: false, icon: 'star', color: '#a371f7' },
      { id: 3, name: 'Night Owl', unlocked: true, icon: 'star', color: '#ffd700' },
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
        achievements: null,
        loading: true,
        error: null,
        refetch: vi.fn(),
      });

      render(<GamificationStats {...defaultProps} />);
      expect(screen.getByText('Loading achievements...')).toBeInTheDocument();
    });

    it('should display spinner icon in loading state', () => {
      useStats.mockReturnValue({
        achievements: null,
        loading: true,
        error: null,
        refetch: vi.fn(),
      });

      const { container } = render(<GamificationStats {...defaultProps} />);
      expect(container.querySelector('.spin')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('should display error message when there is an error', () => {
      useStats.mockReturnValue({
        achievements: null,
        loading: false,
        error: 'Failed to fetch data',
        refetch: vi.fn(),
      });

      render(<GamificationStats {...defaultProps} />);
      expect(screen.getByText(/Error loading data: Failed to fetch data/)).toBeInTheDocument();
    });

    it('should display retry button on error', () => {
      const refetch = vi.fn();
      useStats.mockReturnValue({
        achievements: null,
        loading: false,
        error: 'Network error',
        refetch,
      });

      render(<GamificationStats {...defaultProps} />);
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });

    it('should call refetch when retry button is clicked', () => {
      const refetch = vi.fn();
      useStats.mockReturnValue({
        achievements: null,
        loading: false,
        error: 'Network error',
        refetch,
      });

      render(<GamificationStats {...defaultProps} />);
      fireEvent.click(screen.getByText('Retry'));
      expect(refetch).toHaveBeenCalled();
    });
  });

  describe('rendering with data', () => {
    beforeEach(() => {
      useStats.mockReturnValue({
        achievements: mockAchievements,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should render page header', () => {
      render(<GamificationStats {...defaultProps} />);
      expect(screen.getByText('Achievements & Records')).toBeInTheDocument();
    });

    it('should render refresh button', () => {
      const { container } = render(<GamificationStats {...defaultProps} />);
      expect(container.querySelector('.refresh-btn')).toBeInTheDocument();
    });

    it('should render summary cards', () => {
      render(<GamificationStats {...defaultProps} />);
      expect(screen.getByText('Personal Records')).toBeInTheDocument();
      // 'Rare Sightings' appears both in summary card and tab, so use getAllByText
      expect(screen.getAllByText('Rare Sightings').length).toBeGreaterThan(0);
      expect(screen.getByText('Day Streak')).toBeInTheDocument();
      // 'Badges' appears in multiple places
      expect(screen.getAllByText('Badges').length).toBeGreaterThan(0);
    });

    it('should display correct summary values', () => {
      render(<GamificationStats {...defaultProps} />);
      // Multiple '2' values appear (personal records count and rare sightings count)
      expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(2);
      // Day streak
      expect(screen.getByText('7')).toBeInTheDocument(); // 7 day streak
      // Badges: 2/3 unlocked
      expect(screen.getByText('2/3')).toBeInTheDocument();
    });
  });

  describe('time range selection', () => {
    beforeEach(() => {
      useStats.mockReturnValue({
        achievements: mockAchievements,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should render time range buttons', () => {
      render(<GamificationStats {...defaultProps} />);
      expect(screen.getByText('24h')).toBeInTheDocument();
      expect(screen.getByText('7d')).toBeInTheDocument();
      expect(screen.getByText('30d')).toBeInTheDocument();
      expect(screen.getByText('90d')).toBeInTheDocument();
      expect(screen.getByText('All Time')).toBeInTheDocument();
    });

    it('should have 24h selected by default', () => {
      render(<GamificationStats {...defaultProps} />);
      expect(screen.getByText('24h')).toHaveClass('active');
    });

    it('should change time range when button is clicked', () => {
      render(<GamificationStats {...defaultProps} />);
      fireEvent.click(screen.getByText('7d'));
      expect(screen.getByText('7d')).toHaveClass('active');
    });
  });

  describe('tab navigation', () => {
    beforeEach(() => {
      useStats.mockReturnValue({
        achievements: mockAchievements,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should render all tab buttons', () => {
      render(<GamificationStats {...defaultProps} />);
      expect(screen.getByText('Records')).toBeInTheDocument();
      // 'Rare Sightings' appears in both summary card and tab
      expect(screen.getAllByText('Rare Sightings').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Progress')).toBeInTheDocument();
      expect(screen.getByText('Streaks')).toBeInTheDocument();
      // Note: There are multiple "Badges" texts - one in summary card, one in tab
      expect(screen.getAllByText('Badges').length).toBeGreaterThan(0);
    });

    it('should show Records tab by default', () => {
      render(<GamificationStats {...defaultProps} />);
      expect(screen.getByTestId('records-tab')).toBeInTheDocument();
    });

    it('should switch to Sightings tab when clicked', () => {
      render(<GamificationStats {...defaultProps} />);
      // Click the tab button specifically (has view-tab class)
      const sightingsTab = screen.getAllByText('Rare Sightings').find(
        el => el.closest('.view-tab')
      );
      fireEvent.click(sightingsTab);
      expect(screen.getByTestId('sightings-tab')).toBeInTheDocument();
    });

    it('should switch to Streaks tab when clicked', () => {
      render(<GamificationStats {...defaultProps} />);
      fireEvent.click(screen.getByText('Streaks'));
      expect(screen.getByTestId('streaks-tab')).toBeInTheDocument();
    });

    it('should switch to Badges tab when clicked', () => {
      render(<GamificationStats {...defaultProps} />);
      // Click the Badges tab button (find the one inside view-tab)
      const badgesTab = screen.getAllByText('Badges').find(
        el => el.closest('.view-tab')
      );
      fireEvent.click(badgesTab);
      expect(screen.getByTestId('badges-tab')).toBeInTheDocument();
    });
  });

  describe('progress tab', () => {
    beforeEach(() => {
      useStats.mockReturnValue({
        achievements: mockAchievements,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });
    });

    it('should show collection progress when Progress tab is selected', () => {
      render(<GamificationStats {...defaultProps} />);
      fireEvent.click(screen.getByText('Progress'));
      expect(screen.getByText('Spotting Progress')).toBeInTheDocument();
    });

    it('should display aircraft types progress', () => {
      render(<GamificationStats {...defaultProps} />);
      fireEvent.click(screen.getByText('Progress'));
      expect(screen.getByText('Aircraft Types')).toBeInTheDocument();
      expect(screen.getByText('80/100')).toBeInTheDocument();
    });

    it('should display airlines progress', () => {
      render(<GamificationStats {...defaultProps} />);
      fireEvent.click(screen.getByText('Progress'));
      expect(screen.getByText('Airlines')).toBeInTheDocument();
      expect(screen.getByText('45/100')).toBeInTheDocument();
    });

    it('should display countries progress', () => {
      render(<GamificationStats {...defaultProps} />);
      fireEvent.click(screen.getByText('Progress'));
      expect(screen.getByText('Countries')).toBeInTheDocument();
      expect(screen.getByText('25/50')).toBeInTheDocument();
    });

    it('should display recent unlocks', () => {
      render(<GamificationStats {...defaultProps} />);
      fireEvent.click(screen.getByText('Progress'));
      expect(screen.getByText('Recent Unlocks')).toBeInTheDocument();
      expect(screen.getByText('Delta')).toBeInTheDocument();
      expect(screen.getByText('United')).toBeInTheDocument();
    });

    it('should display milestones', () => {
      render(<GamificationStats {...defaultProps} />);
      fireEvent.click(screen.getByText('Progress'));
      expect(screen.getByText('Milestones')).toBeInTheDocument();
      expect(screen.getByText('100 Aircraft')).toBeInTheDocument();
      expect(screen.getByText('1000 Aircraft')).toBeInTheDocument();
    });

    it('should show achieved milestones with date', () => {
      render(<GamificationStats {...defaultProps} />);
      fireEvent.click(screen.getByText('Progress'));
      expect(screen.getByText('2024-01-15')).toBeInTheDocument();
    });

    it('should show milestone progress for unachieved milestones', () => {
      render(<GamificationStats {...defaultProps} />);
      fireEvent.click(screen.getByText('Progress'));
      expect(screen.getByText('45%')).toBeInTheDocument();
    });
  });

  describe('refresh functionality', () => {
    it('should call refetch when refresh button is clicked', () => {
      const refetch = vi.fn();
      useStats.mockReturnValue({
        achievements: mockAchievements,
        loading: false,
        error: null,
        refetch,
      });

      const { container } = render(<GamificationStats {...defaultProps} />);
      fireEvent.click(container.querySelector('.refresh-btn'));
      expect(refetch).toHaveBeenCalled();
    });

    it('should disable refresh button while loading', () => {
      useStats.mockReturnValue({
        achievements: mockAchievements,
        loading: true,
        error: null,
        refetch: vi.fn(),
      });

      const { container } = render(<GamificationStats {...defaultProps} />);
      const refreshBtn = container.querySelector('.refresh-btn');
      expect(refreshBtn).toBeDisabled();
    });
  });

  describe('onSelectAircraft callback', () => {
    it('should pass onSelectAircraft to RecordsTab', () => {
      const onSelectAircraft = vi.fn();
      useStats.mockReturnValue({
        achievements: mockAchievements,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<GamificationStats {...defaultProps} onSelectAircraft={onSelectAircraft} />);

      // Click a record to trigger onSelectAircraft
      fireEvent.click(screen.getByText('Furthest Distance'));
      expect(onSelectAircraft).toHaveBeenCalledWith('abc123');
    });
  });

  describe('empty states', () => {
    it('should handle empty achievements data', () => {
      useStats.mockReturnValue({
        achievements: {
          personal_records: [],
          rare_sightings: [],
          collection_progress: {},
          streaks: {},
          milestones: [],
          badges: [],
        },
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<GamificationStats {...defaultProps} />);
      // Should render without crashing
      expect(screen.getByText('Achievements & Records')).toBeInTheDocument();
      // Summary values should be 0
      expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    });

    it('should handle null achievements gracefully', () => {
      useStats.mockReturnValue({
        achievements: null,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<GamificationStats {...defaultProps} />);
      // Should render without crashing
      expect(screen.getByText('Achievements & Records')).toBeInTheDocument();
    });
  });

  describe('hook parameters', () => {
    it('should pass correct parameters to useStats', () => {
      useStats.mockReturnValue({
        achievements: mockAchievements,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<GamificationStats {...defaultProps} />);

      expect(useStats).toHaveBeenCalledWith('http://localhost:8000', {
        wsRequest: defaultProps.wsRequest,
        wsConnected: true,
        hours: 24, // Default time range
      });
    });

    it('should update hours when time range changes', () => {
      useStats.mockReturnValue({
        achievements: mockAchievements,
        loading: false,
        error: null,
        refetch: vi.fn(),
      });

      render(<GamificationStats {...defaultProps} />);

      // Change to 7d
      fireEvent.click(screen.getByText('7d'));

      expect(useStats).toHaveBeenLastCalledWith('http://localhost:8000', {
        wsRequest: defaultProps.wsRequest,
        wsConnected: true,
        hours: 168, // 7 days in hours
      });
    });
  });
});
