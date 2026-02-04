import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BadgesTab } from './BadgesTab';

describe('BadgesTab', () => {
  const mockBadges = [
    {
      id: 1,
      name: 'First Flight',
      description: 'Track your first aircraft',
      unlocked: true,
      icon: 'plane',
      color: '#00c8ff',
      date: '2024-01-01',
    },
    {
      id: 2,
      name: 'Night Owl',
      description: 'Track 10 aircraft after midnight',
      unlocked: true,
      icon: 'star',
      color: '#ffd700',
      date: '2024-01-15',
    },
    {
      id: 3,
      name: 'Military Spotter',
      description: 'Track 50 military aircraft',
      unlocked: false,
      icon: 'medal',
      color: '#a371f7',
    },
    {
      id: 4,
      name: 'Globe Trotter',
      description: 'Track aircraft from 50 countries',
      unlocked: false,
      icon: 'globe',
      color: '#00ff88',
    },
    {
      id: 5,
      name: 'Champion',
      description: 'Reach level 100',
      unlocked: false,
      icon: 'trophy',
      color: '#ff9f43',
    },
  ];

  describe('rendering', () => {
    it('should render the badges card', () => {
      render(<BadgesTab badges={mockBadges} />);
      // There's a header with "Badges"
      expect(screen.getAllByText('Badges').length).toBeGreaterThan(0);
    });

    it('should display unlocked count badge', () => {
      render(<BadgesTab badges={mockBadges} />);
      expect(screen.getByText('2/5 unlocked')).toBeInTheDocument();
    });

    it('should render all badges', () => {
      render(<BadgesTab badges={mockBadges} />);
      expect(screen.getByText('First Flight')).toBeInTheDocument();
      expect(screen.getByText('Night Owl')).toBeInTheDocument();
      expect(screen.getByText('Military Spotter')).toBeInTheDocument();
      expect(screen.getByText('Globe Trotter')).toBeInTheDocument();
      expect(screen.getByText('Champion')).toBeInTheDocument();
    });

    it('should display badge descriptions', () => {
      render(<BadgesTab badges={mockBadges} />);
      expect(screen.getByText('Track your first aircraft')).toBeInTheDocument();
      expect(screen.getByText('Track 10 aircraft after midnight')).toBeInTheDocument();
    });

    it('should render icons for each badge', () => {
      const { container } = render(<BadgesTab badges={mockBadges} />);
      const badgeIcons = container.querySelectorAll('.badge-icon');
      expect(badgeIcons.length).toBe(5);
    });
  });

  describe('empty state', () => {
    it('should show empty state when no badges', () => {
      render(<BadgesTab badges={[]} />);
      expect(screen.getByText('No badges available yet')).toBeInTheDocument();
    });

    it('should show 0/0 unlocked badge when empty', () => {
      render(<BadgesTab badges={[]} />);
      expect(screen.getByText('0/0 unlocked')).toBeInTheDocument();
    });
  });

  describe('unlocked vs locked badges', () => {
    it('should have unlocked class for unlocked badges', () => {
      const { container } = render(<BadgesTab badges={mockBadges} />);
      const unlockedBadges = container.querySelectorAll('.badge-item.unlocked');
      expect(unlockedBadges.length).toBe(2);
    });

    it('should have locked class for locked badges', () => {
      const { container } = render(<BadgesTab badges={mockBadges} />);
      const lockedBadges = container.querySelectorAll('.badge-item.locked');
      expect(lockedBadges.length).toBe(3);
    });

    it('should display earned date for unlocked badges', () => {
      render(<BadgesTab badges={mockBadges} />);
      expect(screen.getByText('Earned 2024-01-01')).toBeInTheDocument();
      expect(screen.getByText('Earned 2024-01-15')).toBeInTheDocument();
    });

    it('should not display earned date for locked badges', () => {
      const lockedBadge = [
        { id: 1, name: 'Test', description: 'Test badge', unlocked: false, icon: 'star' },
      ];
      render(<BadgesTab badges={lockedBadge} />);
      expect(screen.queryByText(/Earned/)).not.toBeInTheDocument();
    });
  });

  describe('badge colors', () => {
    it('should apply custom color to badge icons', () => {
      const { container } = render(<BadgesTab badges={mockBadges} />);
      const badgeIcons = container.querySelectorAll('.badge-icon');

      // First badge has color #00c8ff
      expect(badgeIcons[0].style.backgroundColor).toBe('rgb(0, 200, 255)');
      // Second badge has color #ffd700
      expect(badgeIcons[1].style.backgroundColor).toBe('rgb(255, 215, 0)');
    });
  });

  describe('badge icons', () => {
    it('should render plane icon for plane type', () => {
      const planeBadge = [{ id: 1, name: 'Test', unlocked: true, icon: 'plane' }];
      const { container } = render(<BadgesTab badges={planeBadge} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('should render star icon for star type', () => {
      const starBadge = [{ id: 1, name: 'Test', unlocked: true, icon: 'star' }];
      const { container } = render(<BadgesTab badges={starBadge} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('should render trophy icon for trophy type', () => {
      const trophyBadge = [{ id: 1, name: 'Test', unlocked: true, icon: 'trophy' }];
      const { container } = render(<BadgesTab badges={trophyBadge} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('should render medal icon for medal type', () => {
      const medalBadge = [{ id: 1, name: 'Test', unlocked: true, icon: 'medal' }];
      const { container } = render(<BadgesTab badges={medalBadge} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('should render crown icon for crown type', () => {
      const crownBadge = [{ id: 1, name: 'Test', unlocked: true, icon: 'crown' }];
      const { container } = render(<BadgesTab badges={crownBadge} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('should render flame icon for flame type', () => {
      const flameBadge = [{ id: 1, name: 'Test', unlocked: true, icon: 'flame' }];
      const { container } = render(<BadgesTab badges={flameBadge} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('should render globe icon for globe type', () => {
      const globeBadge = [{ id: 1, name: 'Test', unlocked: true, icon: 'globe' }];
      const { container } = render(<BadgesTab badges={globeBadge} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('should render default Award icon for unknown icon type', () => {
      const unknownBadge = [{ id: 1, name: 'Test', unlocked: true, icon: 'unknown' }];
      const { container } = render(<BadgesTab badges={unknownBadge} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('should have title attribute with description', () => {
      const { container } = render(<BadgesTab badges={mockBadges} />);
      const badgeItems = container.querySelectorAll('.badge-item');

      expect(badgeItems[0]).toHaveAttribute('title', 'Track your first aircraft');
    });
  });

  describe('badge without optional fields', () => {
    it('should render badge without description', () => {
      const badgeWithoutDesc = [{ id: 1, name: 'Simple Badge', unlocked: true, icon: 'star' }];
      render(<BadgesTab badges={badgeWithoutDesc} />);
      expect(screen.getByText('Simple Badge')).toBeInTheDocument();
    });

    it('should render badge without color', () => {
      const badgeWithoutColor = [
        { id: 1, name: 'Colorless', unlocked: true, icon: 'star', description: 'No color' },
      ];
      const { container } = render(<BadgesTab badges={badgeWithoutColor} />);
      // Should still render the badge icon
      expect(container.querySelector('.badge-icon')).toBeInTheDocument();
    });

    it('should use index as key when id is not provided', () => {
      const badgesWithoutId = [
        { name: 'Badge 1', unlocked: true, icon: 'star' },
        { name: 'Badge 2', unlocked: false, icon: 'medal' },
      ];
      render(<BadgesTab badges={badgesWithoutId} />);
      expect(screen.getByText('Badge 1')).toBeInTheDocument();
      expect(screen.getByText('Badge 2')).toBeInTheDocument();
    });
  });

  describe('unlocked count calculation', () => {
    it('should correctly count all unlocked badges', () => {
      const allUnlocked = [
        { id: 1, name: 'Badge 1', unlocked: true },
        { id: 2, name: 'Badge 2', unlocked: true },
        { id: 3, name: 'Badge 3', unlocked: true },
      ];
      render(<BadgesTab badges={allUnlocked} />);
      expect(screen.getByText('3/3 unlocked')).toBeInTheDocument();
    });

    it('should correctly count no unlocked badges', () => {
      const noneUnlocked = [
        { id: 1, name: 'Badge 1', unlocked: false },
        { id: 2, name: 'Badge 2', unlocked: false },
      ];
      render(<BadgesTab badges={noneUnlocked} />);
      expect(screen.getByText('0/2 unlocked')).toBeInTheDocument();
    });
  });
});
