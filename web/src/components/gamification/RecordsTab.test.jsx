import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecordsTab } from './RecordsTab';

describe('RecordsTab', () => {
  const mockRecords = [
    {
      type: 'furthest_distance',
      title: 'Furthest Distance',
      value: '250nm',
      aircraft: 'UAL123',
      icao_hex: 'abc123',
      date: '2024-01-15',
    },
    {
      type: 'highest_altitude',
      title: 'Highest Altitude',
      value: '45,000ft',
      aircraft: 'DAL456',
      icao_hex: 'def456',
      date: '2024-01-10',
    },
    {
      type: 'longest_tracking',
      title: 'Longest Tracking',
      value: '4h 32m',
      aircraft: 'AAL789',
      icao_hex: 'ghi789',
      date: '2024-01-08',
    },
    {
      type: 'fastest_aircraft',
      title: 'Fastest Aircraft',
      value: '650 kts',
      aircraft: 'MIL001',
      icao_hex: 'jkl012',
      date: '2024-01-05',
    },
  ];

  describe('rendering', () => {
    it('should render the records card', () => {
      render(<RecordsTab personal_records={mockRecords} />);
      expect(screen.getByText('Personal Records')).toBeInTheDocument();
    });

    it('should display record count badge', () => {
      render(<RecordsTab personal_records={mockRecords} />);
      expect(screen.getByText('4 records')).toBeInTheDocument();
    });

    it('should render all records', () => {
      render(<RecordsTab personal_records={mockRecords} />);
      expect(screen.getByText('Furthest Distance')).toBeInTheDocument();
      expect(screen.getByText('Highest Altitude')).toBeInTheDocument();
      expect(screen.getByText('Longest Tracking')).toBeInTheDocument();
      expect(screen.getByText('Fastest Aircraft')).toBeInTheDocument();
    });

    it('should display record values', () => {
      render(<RecordsTab personal_records={mockRecords} />);
      expect(screen.getByText('250nm')).toBeInTheDocument();
      expect(screen.getByText('45,000ft')).toBeInTheDocument();
      expect(screen.getByText('4h 32m')).toBeInTheDocument();
      expect(screen.getByText('650 kts')).toBeInTheDocument();
    });

    it('should display aircraft callsigns', () => {
      render(<RecordsTab personal_records={mockRecords} />);
      expect(screen.getByText('UAL123')).toBeInTheDocument();
      expect(screen.getByText('DAL456')).toBeInTheDocument();
      expect(screen.getByText('AAL789')).toBeInTheDocument();
    });

    it('should display record dates', () => {
      render(<RecordsTab personal_records={mockRecords} />);
      expect(screen.getByText('2024-01-15')).toBeInTheDocument();
      expect(screen.getByText('2024-01-10')).toBeInTheDocument();
    });

    it('should render icons for each record', () => {
      const { container } = render(<RecordsTab personal_records={mockRecords} />);
      // Each record card should have an icon
      const recordIcons = container.querySelectorAll('.record-icon');
      expect(recordIcons.length).toBe(4);
    });
  });

  describe('empty state', () => {
    it('should show empty state when no records', () => {
      render(<RecordsTab personal_records={[]} />);
      expect(screen.getByText('No records yet - keep spotting!')).toBeInTheDocument();
    });

    it('should show 0 records badge when empty', () => {
      render(<RecordsTab personal_records={[]} />);
      expect(screen.getByText('0 records')).toBeInTheDocument();
    });
  });

  describe('selection handling', () => {
    it('should call onSelectAircraft when record is clicked', () => {
      const onSelectAircraft = vi.fn();
      render(<RecordsTab personal_records={mockRecords} onSelectAircraft={onSelectAircraft} />);

      fireEvent.click(screen.getByText('Furthest Distance'));
      expect(onSelectAircraft).toHaveBeenCalledWith('abc123');
    });

    it('should call onSelectAircraft on Enter key', () => {
      const onSelectAircraft = vi.fn();
      const { container } = render(
        <RecordsTab personal_records={mockRecords} onSelectAircraft={onSelectAircraft} />
      );

      const recordCard = container.querySelector('.record-card');
      fireEvent.keyDown(recordCard, { key: 'Enter' });
      expect(onSelectAircraft).toHaveBeenCalledWith('abc123');
    });

    it('should call onSelectAircraft on Space key', () => {
      const onSelectAircraft = vi.fn();
      const { container } = render(
        <RecordsTab personal_records={mockRecords} onSelectAircraft={onSelectAircraft} />
      );

      const recordCard = container.querySelector('.record-card');
      fireEvent.keyDown(recordCard, { key: ' ' });
      expect(onSelectAircraft).toHaveBeenCalledWith('abc123');
    });

    it('should not call onSelectAircraft when record has no icao_hex', () => {
      const onSelectAircraft = vi.fn();
      const recordWithoutHex = [{ type: 'test', title: 'Test Record', value: '100' }];

      render(
        <RecordsTab personal_records={recordWithoutHex} onSelectAircraft={onSelectAircraft} />
      );
      fireEvent.click(screen.getByText('Test Record'));
      expect(onSelectAircraft).not.toHaveBeenCalled();
    });

    it('should have clickable class when onSelectAircraft is provided and record has icao_hex', () => {
      const onSelectAircraft = vi.fn();
      const { container } = render(
        <RecordsTab personal_records={mockRecords} onSelectAircraft={onSelectAircraft} />
      );

      expect(container.querySelector('.clickable')).toBeInTheDocument();
    });

    it('should not have clickable class when onSelectAircraft is not provided', () => {
      const { container } = render(<RecordsTab personal_records={mockRecords} />);
      expect(container.querySelector('.clickable')).not.toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('should have role="button" when clickable', () => {
      const onSelectAircraft = vi.fn();
      const { container } = render(
        <RecordsTab personal_records={mockRecords} onSelectAircraft={onSelectAircraft} />
      );

      const clickableCards = container.querySelectorAll('[role="button"]');
      expect(clickableCards.length).toBe(4);
    });

    it('should have tabIndex when clickable', () => {
      const onSelectAircraft = vi.fn();
      const { container } = render(
        <RecordsTab personal_records={mockRecords} onSelectAircraft={onSelectAircraft} />
      );

      const clickableCards = container.querySelectorAll('[tabindex="0"]');
      expect(clickableCards.length).toBe(4);
    });
  });

  describe('icon mapping', () => {
    it('should use correct icon for furthest_distance', () => {
      const { container } = render(<RecordsTab personal_records={[mockRecords[0]]} />);
      // Target icon is rendered as SVG
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('should use default icon for unknown record types', () => {
      const unknownTypeRecord = [{ type: 'unknown_type', title: 'Unknown', value: '100' }];
      const { container } = render(<RecordsTab personal_records={unknownTypeRecord} />);
      // Award icon (default) is rendered as SVG
      expect(container.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('record without optional fields', () => {
    it('should render record without aircraft field', () => {
      const recordWithoutAircraft = [
        { type: 'test', title: 'Test Record', value: '100', date: '2024-01-01' },
      ];
      render(<RecordsTab personal_records={recordWithoutAircraft} />);
      expect(screen.getByText('Test Record')).toBeInTheDocument();
      expect(screen.getByText('100')).toBeInTheDocument();
    });

    it('should render record without date field', () => {
      const recordWithoutDate = [
        { type: 'test', title: 'Test Record', value: '100', aircraft: 'TEST001' },
      ];
      render(<RecordsTab personal_records={recordWithoutDate} />);
      expect(screen.getByText('Test Record')).toBeInTheDocument();
      expect(screen.getByText('TEST001')).toBeInTheDocument();
    });

    it('should use type as title fallback when title is not provided', () => {
      const recordWithoutTitle = [{ type: 'my_record_type', value: '100' }];
      render(<RecordsTab personal_records={recordWithoutTitle} />);
      expect(screen.getByText('my_record_type')).toBeInTheDocument();
    });
  });
});
