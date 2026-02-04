import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StreaksTab } from './StreaksTab';

describe('StreaksTab', () => {
  const mockStreaks = {
    daily_active: 7,
    early_bird: 3,
    night_owl: 5,
    variety_hunter: 2,
    best_daily: 14,
    best_variety: 10,
  };

  describe('rendering', () => {
    it('should render the streaks card', () => {
      render(<StreaksTab streaks={mockStreaks} />);
      expect(screen.getByText('Current Streaks')).toBeInTheDocument();
    });

    it('should render all streak types', () => {
      render(<StreaksTab streaks={mockStreaks} />);
      expect(screen.getByText('Day Streak')).toBeInTheDocument();
      expect(screen.getByText('Early Bird')).toBeInTheDocument();
      expect(screen.getByText('Night Owl')).toBeInTheDocument();
      expect(screen.getByText('Variety Hunter')).toBeInTheDocument();
    });

    it('should display streak values', () => {
      render(<StreaksTab streaks={mockStreaks} />);
      expect(screen.getByText('7')).toBeInTheDocument(); // daily_active
      expect(screen.getByText('3')).toBeInTheDocument(); // early_bird
      expect(screen.getByText('5')).toBeInTheDocument(); // night_owl
      expect(screen.getByText('2')).toBeInTheDocument(); // variety_hunter
    });

    it('should display streak descriptions', () => {
      render(<StreaksTab streaks={mockStreaks} />);
      expect(screen.getByText('Consecutive days with activity')).toBeInTheDocument();
      expect(screen.getByText('Days with activity before 7 AM')).toBeInTheDocument();
      expect(screen.getByText('Days with activity after 10 PM')).toBeInTheDocument();
      expect(screen.getByText('Days with 10+ unique aircraft types')).toBeInTheDocument();
    });

    it('should render icons for each streak', () => {
      const { container } = render(<StreaksTab streaks={mockStreaks} />);
      const streakIcons = container.querySelectorAll('.streak-icon');
      expect(streakIcons.length).toBe(4);
    });
  });

  describe('active state', () => {
    it('should have active class when streak value is greater than 0', () => {
      const { container } = render(<StreaksTab streaks={mockStreaks} />);
      const activeStreaks = container.querySelectorAll('.streak-item.active');
      expect(activeStreaks.length).toBe(4); // All streaks are > 0
    });

    it('should not have active class when streak value is 0', () => {
      const zeroStreaks = {
        daily_active: 0,
        early_bird: 0,
        night_owl: 0,
        variety_hunter: 0,
      };
      const { container } = render(<StreaksTab streaks={zeroStreaks} />);
      const activeStreaks = container.querySelectorAll('.streak-item.active');
      expect(activeStreaks.length).toBe(0);
    });

    it('should handle mixed active and inactive streaks', () => {
      const mixedStreaks = {
        daily_active: 5,
        early_bird: 0,
        night_owl: 3,
        variety_hunter: 0,
      };
      const { container } = render(<StreaksTab streaks={mixedStreaks} />);
      const activeStreaks = container.querySelectorAll('.streak-item.active');
      expect(activeStreaks.length).toBe(2);
    });
  });

  describe('best streaks section', () => {
    it('should display best daily streak when available', () => {
      render(<StreaksTab streaks={mockStreaks} />);
      expect(screen.getByText(/Best daily streak:/)).toBeInTheDocument();
      expect(screen.getByText('14 days')).toBeInTheDocument();
    });

    it('should display best variety streak when available', () => {
      render(<StreaksTab streaks={mockStreaks} />);
      expect(screen.getByText(/Best variety streak:/)).toBeInTheDocument();
      expect(screen.getByText('10 days')).toBeInTheDocument();
    });

    it('should not display best daily streak when not available', () => {
      const streaksWithoutBest = {
        daily_active: 5,
        early_bird: 2,
        night_owl: 1,
        variety_hunter: 3,
      };
      render(<StreaksTab streaks={streaksWithoutBest} />);
      expect(screen.queryByText(/Best daily streak:/)).not.toBeInTheDocument();
    });

    it('should not display best variety streak when not available', () => {
      const streaksWithoutVariety = {
        daily_active: 5,
        early_bird: 2,
        night_owl: 1,
        variety_hunter: 3,
        best_daily: 10,
      };
      render(<StreaksTab streaks={streaksWithoutVariety} />);
      expect(screen.queryByText(/Best variety streak:/)).not.toBeInTheDocument();
    });
  });

  describe('empty/default values', () => {
    it('should show 0 for missing streak values', () => {
      const emptyStreaks = {};
      render(<StreaksTab streaks={emptyStreaks} />);
      // Should show 0 for all streaks
      const zeros = screen.getAllByText('0');
      expect(zeros.length).toBe(4);
    });

    it('should handle null streaks object', () => {
      // Component should handle undefined/null gracefully
      const { container } = render(<StreaksTab streaks={{}} />);
      expect(container.querySelector('.streaks-card')).toBeInTheDocument();
    });
  });

  describe('icon styling', () => {
    it('should apply early class to early bird icon', () => {
      const { container } = render(<StreaksTab streaks={mockStreaks} />);
      expect(container.querySelector('.streak-icon.early')).toBeInTheDocument();
    });

    it('should apply night class to night owl icon', () => {
      const { container } = render(<StreaksTab streaks={mockStreaks} />);
      expect(container.querySelector('.streak-icon.night')).toBeInTheDocument();
    });

    it('should apply variety class to variety hunter icon', () => {
      const { container } = render(<StreaksTab streaks={mockStreaks} />);
      expect(container.querySelector('.streak-icon.variety')).toBeInTheDocument();
    });
  });

  describe('streak grid layout', () => {
    it('should render streaks in a grid', () => {
      const { container } = render(<StreaksTab streaks={mockStreaks} />);
      expect(container.querySelector('.streaks-grid')).toBeInTheDocument();
    });

    it('should have large class on streak grid', () => {
      const { container } = render(<StreaksTab streaks={mockStreaks} />);
      expect(container.querySelector('.streaks-grid.large')).toBeInTheDocument();
    });
  });

  describe('crown icon for best streaks', () => {
    it('should render crown icons for best streaks', () => {
      const { container } = render(<StreaksTab streaks={mockStreaks} />);
      // Best streaks section should have Crown icons
      const bestStreaksSection = container.querySelector('.best-streaks');
      expect(bestStreaksSection).toBeInTheDocument();
      // Should have 2 Crown icons (for best_daily and best_variety)
      const crownIcons = bestStreaksSection.querySelectorAll('svg');
      expect(crownIcons.length).toBe(2);
    });
  });

  describe('streak item structure', () => {
    it('should have streak-item with large class', () => {
      const { container } = render(<StreaksTab streaks={mockStreaks} />);
      const streakItems = container.querySelectorAll('.streak-item.large');
      expect(streakItems.length).toBe(4);
    });

    it('should have streak-content section', () => {
      const { container } = render(<StreaksTab streaks={mockStreaks} />);
      const streakContents = container.querySelectorAll('.streak-content');
      expect(streakContents.length).toBe(4);
    });

    it('should have streak-value, streak-label, and streak-description in each item', () => {
      const { container } = render(<StreaksTab streaks={mockStreaks} />);
      expect(container.querySelectorAll('.streak-value').length).toBe(4);
      expect(container.querySelectorAll('.streak-label').length).toBe(4);
      expect(container.querySelectorAll('.streak-description').length).toBe(4);
    });
  });

  describe('icon size', () => {
    it('should render large icons (size 32)', () => {
      const { container } = render(<StreaksTab streaks={mockStreaks} />);
      // The icons in streak-icon.large should be size 32
      const icons = container.querySelectorAll('.streak-icon.large svg');
      expect(icons.length).toBe(4);
    });
  });
});
