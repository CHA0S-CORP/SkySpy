import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SightingsTab } from './SightingsTab';

describe('SightingsTab', () => {
  const mockSightings = [
    {
      icao_hex: 'abc123',
      aircraft_type: 'A380',
      callsign: 'UAE123',
      rarity: 'epic',
      reason: 'Rarely seen aircraft type',
      date: '2024-01-15',
    },
    {
      icao_hex: 'def456',
      aircraft_type: 'AN225',
      callsign: 'ADB3456',
      rarity: 'legendary',
      reason: 'Only one in existence',
      date: '2024-01-10',
    },
    {
      icao_hex: 'ghi789',
      aircraft_type: 'B748F',
      callsign: null,
      rarity: 'rare',
      reason: 'Freighter variant',
      date: '2024-01-05',
    },
    {
      icao_hex: 'jkl012',
      aircraft_type: 'E195E2',
      callsign: 'JBU200',
      rarity: 'uncommon',
      date: '2024-01-02',
    },
    {
      icao_hex: 'mno345',
      aircraft_type: 'CRJ700',
      callsign: 'SKW5000',
      rarity: 'common',
      date: '2024-01-01',
    },
  ];

  describe('rendering', () => {
    it('should render the sightings card', () => {
      render(<SightingsTab rare_sightings={mockSightings} />);
      expect(screen.getByText('Rare Sightings')).toBeInTheDocument();
    });

    it('should display sighting count badge', () => {
      render(<SightingsTab rare_sightings={mockSightings} />);
      expect(screen.getByText('5 sightings')).toBeInTheDocument();
    });

    it('should render all sightings', () => {
      render(<SightingsTab rare_sightings={mockSightings} />);
      expect(screen.getByText('A380')).toBeInTheDocument();
      expect(screen.getByText('AN225')).toBeInTheDocument();
      expect(screen.getByText('B748F')).toBeInTheDocument();
      expect(screen.getByText('E195E2')).toBeInTheDocument();
      expect(screen.getByText('CRJ700')).toBeInTheDocument();
    });

    it('should display callsigns', () => {
      render(<SightingsTab rare_sightings={mockSightings} />);
      expect(screen.getByText('UAE123')).toBeInTheDocument();
      expect(screen.getByText('ADB3456')).toBeInTheDocument();
      expect(screen.getByText('JBU200')).toBeInTheDocument();
    });

    it('should display icao_hex when callsign is not available', () => {
      render(<SightingsTab rare_sightings={mockSightings} />);
      // ghi789 has no callsign
      expect(screen.getByText('ghi789')).toBeInTheDocument();
    });

    it('should display rarity labels', () => {
      render(<SightingsTab rare_sightings={mockSightings} />);
      expect(screen.getByText('Epic')).toBeInTheDocument();
      expect(screen.getByText('Legendary')).toBeInTheDocument();
      expect(screen.getByText('Rare')).toBeInTheDocument();
      expect(screen.getByText('Uncommon')).toBeInTheDocument();
      expect(screen.getByText('Common')).toBeInTheDocument();
    });

    it('should display sighting reasons', () => {
      render(<SightingsTab rare_sightings={mockSightings} />);
      expect(screen.getByText('Rarely seen aircraft type')).toBeInTheDocument();
      expect(screen.getByText('Only one in existence')).toBeInTheDocument();
      expect(screen.getByText('Freighter variant')).toBeInTheDocument();
    });

    it('should display sighting dates', () => {
      render(<SightingsTab rare_sightings={mockSightings} />);
      expect(screen.getByText('2024-01-15')).toBeInTheDocument();
      expect(screen.getByText('2024-01-10')).toBeInTheDocument();
      expect(screen.getByText('2024-01-05')).toBeInTheDocument();
    });

    it('should render sparkle icons', () => {
      const { container } = render(<SightingsTab rare_sightings={mockSightings} />);
      // Each sighting has a Sparkles icon
      const sparkleIcons = container.querySelectorAll('.sighting-rarity svg');
      expect(sparkleIcons.length).toBe(5);
    });
  });

  describe('empty state', () => {
    it('should show empty state when no sightings', () => {
      render(<SightingsTab rare_sightings={[]} />);
      expect(screen.getByText('No rare sightings recorded')).toBeInTheDocument();
    });

    it('should show 0 sightings badge when empty', () => {
      render(<SightingsTab rare_sightings={[]} />);
      expect(screen.getByText('0 sightings')).toBeInTheDocument();
    });
  });

  describe('rarity colors', () => {
    it('should apply legendary color (gold)', () => {
      const { container } = render(<SightingsTab rare_sightings={mockSightings} />);
      const legendaryRarity = container.querySelectorAll('.sighting-rarity')[1]; // AN225 is legendary
      expect(legendaryRarity.style.backgroundColor).toBe('rgb(255, 215, 0)'); // #ffd700
    });

    it('should apply epic color (purple)', () => {
      const { container } = render(<SightingsTab rare_sightings={mockSightings} />);
      const epicRarity = container.querySelectorAll('.sighting-rarity')[0]; // A380 is epic
      expect(epicRarity.style.backgroundColor).toBe('rgb(163, 113, 247)'); // #a371f7
    });

    it('should apply rare color (cyan)', () => {
      const { container } = render(<SightingsTab rare_sightings={mockSightings} />);
      const rareRarity = container.querySelectorAll('.sighting-rarity')[2]; // B748F is rare
      expect(rareRarity.style.backgroundColor).toBe('rgb(0, 200, 255)'); // #00c8ff
    });

    it('should apply uncommon color (green)', () => {
      const { container } = render(<SightingsTab rare_sightings={mockSightings} />);
      const uncommonRarity = container.querySelectorAll('.sighting-rarity')[3]; // E195E2 is uncommon
      expect(uncommonRarity.style.backgroundColor).toBe('rgb(0, 255, 136)'); // #00ff88
    });

    it('should apply common color (gray)', () => {
      const { container } = render(<SightingsTab rare_sightings={mockSightings} />);
      const commonRarity = container.querySelectorAll('.sighting-rarity')[4]; // CRJ700 is common
      expect(commonRarity.style.backgroundColor).toBe('rgb(107, 114, 128)'); // #6b7280
    });

    it('should use common color for unknown rarity', () => {
      const unknownRarity = [{ icao_hex: 'test', aircraft_type: 'Test', rarity: 'unknown' }];
      const { container } = render(<SightingsTab rare_sightings={unknownRarity} />);
      const rarityElement = container.querySelector('.sighting-rarity');
      expect(rarityElement.style.backgroundColor).toBe('rgb(107, 114, 128)');
    });
  });

  describe('selection handling', () => {
    it('should call onSelectAircraft when sighting is clicked', () => {
      const onSelectAircraft = vi.fn();
      render(<SightingsTab rare_sightings={mockSightings} onSelectAircraft={onSelectAircraft} />);

      fireEvent.click(screen.getByText('A380'));
      expect(onSelectAircraft).toHaveBeenCalledWith('abc123');
    });

    it('should call onSelectAircraft on Enter key', () => {
      const onSelectAircraft = vi.fn();
      const { container } = render(
        <SightingsTab rare_sightings={mockSightings} onSelectAircraft={onSelectAircraft} />
      );

      const sightingItem = container.querySelector('.sighting-item');
      fireEvent.keyDown(sightingItem, { key: 'Enter' });
      expect(onSelectAircraft).toHaveBeenCalledWith('abc123');
    });

    it('should call onSelectAircraft on Space key', () => {
      const onSelectAircraft = vi.fn();
      const { container } = render(
        <SightingsTab rare_sightings={mockSightings} onSelectAircraft={onSelectAircraft} />
      );

      const sightingItem = container.querySelector('.sighting-item');
      fireEvent.keyDown(sightingItem, { key: ' ' });
      expect(onSelectAircraft).toHaveBeenCalledWith('abc123');
    });

    it('should have clickable class when onSelectAircraft is provided', () => {
      const onSelectAircraft = vi.fn();
      const { container } = render(
        <SightingsTab rare_sightings={mockSightings} onSelectAircraft={onSelectAircraft} />
      );

      expect(container.querySelector('.clickable')).toBeInTheDocument();
    });

    it('should not have clickable class when onSelectAircraft is not provided', () => {
      const { container } = render(<SightingsTab rare_sightings={mockSightings} />);
      expect(container.querySelector('.clickable')).not.toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('should have role="button" when clickable', () => {
      const onSelectAircraft = vi.fn();
      const { container } = render(
        <SightingsTab rare_sightings={mockSightings} onSelectAircraft={onSelectAircraft} />
      );

      const clickableItems = container.querySelectorAll('[role="button"]');
      expect(clickableItems.length).toBe(5);
    });

    it('should have tabIndex when clickable', () => {
      const onSelectAircraft = vi.fn();
      const { container } = render(
        <SightingsTab rare_sightings={mockSightings} onSelectAircraft={onSelectAircraft} />
      );

      const tabbableItems = container.querySelectorAll('[tabindex="0"]');
      expect(tabbableItems.length).toBe(5);
    });

    it('should have title attribute on rarity indicator', () => {
      const { container } = render(<SightingsTab rare_sightings={mockSightings} />);
      const rarityIndicators = container.querySelectorAll('.sighting-rarity');

      expect(rarityIndicators[0]).toHaveAttribute('title', 'epic');
      expect(rarityIndicators[1]).toHaveAttribute('title', 'legendary');
    });
  });

  describe('sighting without optional fields', () => {
    it('should render sighting without reason', () => {
      const sightingWithoutReason = [
        {
          icao_hex: 'test',
          aircraft_type: 'Test',
          callsign: 'TST123',
          rarity: 'rare',
          date: '2024-01-01',
        },
      ];
      render(<SightingsTab rare_sightings={sightingWithoutReason} />);
      expect(screen.getByText('Test')).toBeInTheDocument();
      expect(screen.getByText('TST123')).toBeInTheDocument();
      // Reason should not be displayed
      expect(screen.queryByText('reason')).not.toBeInTheDocument();
    });

    it('should render sighting without aircraft_type', () => {
      const sightingWithoutType = [
        { icao_hex: 'test', callsign: 'TST123', rarity: 'rare', date: '2024-01-01' },
      ];
      render(<SightingsTab rare_sightings={sightingWithoutType} />);
      expect(screen.getByText('Unknown')).toBeInTheDocument();
    });

    it('should use index as key when icao_hex is not provided', () => {
      const sightingsWithoutHex = [
        { aircraft_type: 'Type1', callsign: 'CALL1', rarity: 'rare' },
        { aircraft_type: 'Type2', callsign: 'CALL2', rarity: 'epic' },
      ];
      render(<SightingsTab rare_sightings={sightingsWithoutHex} />);
      expect(screen.getByText('Type1')).toBeInTheDocument();
      expect(screen.getByText('Type2')).toBeInTheDocument();
    });
  });

  describe('rarity label mapping', () => {
    it('should display "Legendary" for legendary rarity', () => {
      const legendary = [{ icao_hex: 't', aircraft_type: 'T', rarity: 'legendary' }];
      render(<SightingsTab rare_sightings={legendary} />);
      expect(screen.getByText('Legendary')).toBeInTheDocument();
    });

    it('should display "Epic" for epic rarity', () => {
      const epic = [{ icao_hex: 't', aircraft_type: 'T', rarity: 'epic' }];
      render(<SightingsTab rare_sightings={epic} />);
      expect(screen.getByText('Epic')).toBeInTheDocument();
    });

    it('should display "Rare" for rare rarity', () => {
      const rare = [{ icao_hex: 't', aircraft_type: 'T', rarity: 'rare' }];
      render(<SightingsTab rare_sightings={rare} />);
      expect(screen.getByText('Rare')).toBeInTheDocument();
    });

    it('should display "Uncommon" for uncommon rarity', () => {
      const uncommon = [{ icao_hex: 't', aircraft_type: 'T', rarity: 'uncommon' }];
      render(<SightingsTab rare_sightings={uncommon} />);
      expect(screen.getByText('Uncommon')).toBeInTheDocument();
    });

    it('should display "Common" for common rarity', () => {
      const common = [{ icao_hex: 't', aircraft_type: 'T', rarity: 'common' }];
      render(<SightingsTab rare_sightings={common} />);
      expect(screen.getByText('Common')).toBeInTheDocument();
    });

    it('should display "Unknown" for undefined rarity', () => {
      const unknown = [{ icao_hex: 't', aircraft_type: 'T', rarity: 'something_else' }];
      render(<SightingsTab rare_sightings={unknown} />);
      expect(screen.getByText('Unknown')).toBeInTheDocument();
    });
  });

  describe('sighting item structure', () => {
    it('should have sighting-item with large class', () => {
      const { container } = render(<SightingsTab rare_sightings={mockSightings} />);
      const sightingItems = container.querySelectorAll('.sighting-item.large');
      expect(sightingItems.length).toBe(5);
    });

    it('should have sighting-info section', () => {
      const { container } = render(<SightingsTab rare_sightings={mockSightings} />);
      const sightingInfos = container.querySelectorAll('.sighting-info');
      expect(sightingInfos.length).toBe(5);
    });

    it('should have sighting-details section', () => {
      const { container } = render(<SightingsTab rare_sightings={mockSightings} />);
      const sightingDetails = container.querySelectorAll('.sighting-details');
      expect(sightingDetails.length).toBe(5);
    });
  });
});
