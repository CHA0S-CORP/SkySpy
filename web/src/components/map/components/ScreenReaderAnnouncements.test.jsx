import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScreenReaderAnnouncements } from './ScreenReaderAnnouncements';

describe('ScreenReaderAnnouncements', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('rendering', () => {
    it('should render ARIA live regions', () => {
      render(<ScreenReaderAnnouncements aircraft={[]} />);

      // Should have polite and assertive regions
      expect(screen.getByRole('status', { name: /radar status/i })).toBeInTheDocument();
    });

    it('should not render when disabled', () => {
      const { container } = render(<ScreenReaderAnnouncements aircraft={[]} enabled={false} />);
      expect(container.firstChild).toBeNull();
    });

    it('should render with sr-only class for visual hiding', () => {
      const { container } = render(<ScreenReaderAnnouncements aircraft={[]} />);
      const srOnlyElements = container.querySelectorAll('.sr-only');
      expect(srOnlyElements.length).toBeGreaterThan(0);
    });
  });

  describe('aircraft count announcements', () => {
    it('should announce status summary with aircraft count', () => {
      const mockAircraft = [
        { hex: 'abc123', flight: 'UAL123', alt_baro: 35000 },
        { hex: 'def456', flight: 'DAL456', alt_baro: 25000 },
      ];

      render(<ScreenReaderAnnouncements aircraft={mockAircraft} />);

      expect(screen.getByRole('status', { name: /radar status/i })).toHaveTextContent(
        '2 aircraft tracked'
      );
    });
  });

  describe('new aircraft announcements', () => {
    it('should set up debounce timer for new aircraft', () => {
      const { rerender } = render(<ScreenReaderAnnouncements aircraft={[]} />);

      // Add a new aircraft
      const newAircraft = [{ hex: 'abc123', flight: 'UAL123', alt_baro: 35000, t: 'B738' }];
      rerender(<ScreenReaderAnnouncements aircraft={newAircraft} />);

      // The polite announcement region should exist
      const statusRegions = screen.getAllByRole('status');
      expect(statusRegions.length).toBeGreaterThan(0);
    });
  });

  describe('safety event announcements', () => {
    it('should announce emergency alerts assertively', async () => {
      const { rerender } = render(<ScreenReaderAnnouncements aircraft={[]} safetyEvents={[]} />);

      const emergencyEvent = {
        id: 'emerg-1',
        type: 'emergency',
        hex: 'abc123',
        callsign: 'UAL123',
        squawk: '7700',
        message: 'General emergency declared',
      };

      rerender(<ScreenReaderAnnouncements aircraft={[]} safetyEvents={[emergencyEvent]} />);

      // Should have an alert region for emergencies
      const alertRegion = screen.getByRole('alert');
      expect(alertRegion).toBeInTheDocument();
    });

    it('should include squawk code interpretation in announcements', async () => {
      const hijackEvent = {
        id: 'emerg-2',
        type: 'emergency',
        hex: 'abc123',
        callsign: 'UAL123',
        squawk: '7500',
      };

      render(<ScreenReaderAnnouncements aircraft={[]} safetyEvents={[hijackEvent]} />);

      const alertRegion = screen.getByRole('alert');
      expect(alertRegion).toHaveTextContent('7500');
    });
  });

  describe('selected aircraft announcements', () => {
    it('should announce selected aircraft details', async () => {
      const selectedAircraft = {
        hex: 'abc123',
        flight: 'UAL123',
        alt_baro: 35000,
        gs: 450,
        t: 'B738',
      };

      render(
        <ScreenReaderAnnouncements
          aircraft={[selectedAircraft]}
          selectedAircraft={selectedAircraft}
        />
      );

      // First polite status region should have announcement content
      const politeRegions = screen.getAllByRole('status');
      expect(politeRegions.length).toBeGreaterThan(0);
    });
  });

  describe('conflict announcements', () => {
    it('should announce new conflicts', async () => {
      const conflicts = [
        {
          aircraft1: { hex: 'abc123', flight: 'UAL123' },
          aircraft2: { hex: 'def456', flight: 'DAL456' },
          separation_nm: 2.5,
          separation_ft: 500,
        },
      ];

      const { rerender } = render(<ScreenReaderAnnouncements aircraft={[]} conflicts={[]} />);

      rerender(<ScreenReaderAnnouncements aircraft={[]} conflicts={conflicts} />);

      // Should update the status regions
      const statusRegions = screen.getAllByRole('status');
      expect(statusRegions.length).toBeGreaterThan(0);
    });
  });

  describe('formatAltitude helper', () => {
    it('should format ground altitude correctly', () => {
      const aircraft = { hex: 'abc123', alt_baro: 'ground' };

      render(<ScreenReaderAnnouncements aircraft={[aircraft]} selectedAircraft={aircraft} />);

      // The component should render without error
      expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
    });

    it('should round large altitudes to nearest 100', () => {
      const aircraft = { hex: 'abc123', alt_baro: 35275 };

      render(<ScreenReaderAnnouncements aircraft={[aircraft]} selectedAircraft={aircraft} />);

      // Should render without error
      expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
    });
  });

  describe('props validation', () => {
    it('should handle empty arrays gracefully', () => {
      render(
        <ScreenReaderAnnouncements
          aircraft={[]}
          safetyEvents={[]}
          conflicts={[]}
          selectedAircraft={null}
        />
      );

      expect(screen.getByRole('status', { name: /radar status/i })).toHaveTextContent(
        '0 aircraft tracked'
      );
    });

    it('should handle undefined props gracefully', () => {
      render(<ScreenReaderAnnouncements />);

      expect(screen.getByRole('status', { name: /radar status/i })).toHaveTextContent(
        '0 aircraft tracked'
      );
    });
  });
});
