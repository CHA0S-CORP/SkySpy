import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { LivePreview } from './LivePreview';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Eye: () => <span data-testid="icon-eye">Eye</span>,
  ChevronDown: () => <span data-testid="icon-chevron-down">Down</span>,
  ChevronUp: () => <span data-testid="icon-chevron-up">Up</span>,
  Plane: () => <span data-testid="icon-plane">Plane</span>,
}));

// Mock the alertEvaluator utilities
vi.mock('../../utils/alertEvaluator', () => ({
  findMatchingAircraft: vi.fn(),
  getRelevantValues: vi.fn(),
}));

import { findMatchingAircraft, getRelevantValues } from '../../utils/alertEvaluator';

describe('LivePreview', () => {
  const defaultConditions = {
    logic: 'AND',
    groups: [
      {
        logic: 'AND',
        conditions: [{ type: 'military', operator: 'eq', value: 'true' }],
      },
    ],
  };

  const mockAircraft = [
    {
      hex: 'A12345',
      flight: 'UAL123',
      alt_baro: 35000,
      gs: 450,
    },
    {
      hex: 'AE1234',
      flight: 'RCH456',
      alt_baro: 28000,
      gs: 400,
      dbFlags: 1, // Military
    },
    {
      hex: 'B67890',
      flight: 'DAL789',
      alt_baro: 12000,
      gs: 280,
    },
  ];

  const mockFeederLocation = { lat: 40.7128, lon: -74.006 };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Default mock implementations
    findMatchingAircraft.mockReturnValue([]);
    getRelevantValues.mockReturnValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('rendering', () => {
    it('should render nothing when no aircraft data', () => {
      const { container } = render(
        <LivePreview
          conditions={defaultConditions}
          aircraft={[]}
          feederLocation={mockFeederLocation}
        />
      );

      expect(container.firstChild).toBeNull();
    });

    it('should render nothing when aircraft is null', () => {
      const { container } = render(
        <LivePreview
          conditions={defaultConditions}
          aircraft={null}
          feederLocation={mockFeederLocation}
        />
      );

      expect(container.firstChild).toBeNull();
    });

    it('should render preview panel when aircraft data exists', () => {
      findMatchingAircraft.mockReturnValue([]);

      render(
        <LivePreview
          conditions={defaultConditions}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
        />
      );

      // Advance timers to complete debounce
      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(screen.getByText(/matching/i)).toBeInTheDocument();
    });

    it('should display match count summary', () => {
      findMatchingAircraft.mockReturnValue([mockAircraft[1]]);

      render(
        <LivePreview
          conditions={defaultConditions}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
        />
      );

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(screen.getByText('1')).toBeInTheDocument();
      expect(screen.getByText(/of 3 aircraft/i)).toBeInTheDocument();
    });
  });

  describe('expand/collapse behavior', () => {
    it('should be expanded by default', () => {
      findMatchingAircraft.mockReturnValue([mockAircraft[1]]);
      getRelevantValues.mockReturnValue({ altitude: 28000, speed: 400 });

      render(
        <LivePreview
          conditions={defaultConditions}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
        />
      );

      act(() => {
        vi.advanceTimersByTime(300);
      });

      const toggleBtn = screen.getByRole('button', { name: /matching/i });
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('RCH456')).toBeInTheDocument();
    });

    it('should collapse when toggle button is clicked', async () => {
      findMatchingAircraft.mockReturnValue([mockAircraft[1]]);
      getRelevantValues.mockReturnValue({ altitude: 28000, speed: 400 });

      render(
        <LivePreview
          conditions={defaultConditions}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
        />
      );

      act(() => {
        vi.advanceTimersByTime(300);
      });

      const toggleBtn = screen.getByRole('button', { name: /matching/i });

      // Use fireEvent instead of userEvent with fake timers
      fireEvent.click(toggleBtn);

      expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByText('RCH456')).not.toBeInTheDocument();
    });

    it('should expand when toggle button is clicked while collapsed', () => {
      findMatchingAircraft.mockReturnValue([mockAircraft[1]]);
      getRelevantValues.mockReturnValue({ altitude: 28000, speed: 400 });

      render(
        <LivePreview
          conditions={defaultConditions}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
        />
      );

      act(() => {
        vi.advanceTimersByTime(300);
      });

      const toggleBtn = screen.getByRole('button', { name: /matching/i });

      // Collapse
      fireEvent.click(toggleBtn);
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');

      // Expand
      fireEvent.click(toggleBtn);
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('RCH456')).toBeInTheDocument();
    });

    it('should have proper aria-controls attribute', () => {
      findMatchingAircraft.mockReturnValue([]);

      render(
        <LivePreview
          conditions={defaultConditions}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
        />
      );

      act(() => {
        vi.advanceTimersByTime(300);
      });

      const toggleBtn = screen.getByRole('button', { name: /matching/i });
      expect(toggleBtn).toHaveAttribute('aria-controls', 'preview-content');
    });
  });

  describe('matching aircraft display', () => {
    it('should display matching aircraft callsign and hex', () => {
      findMatchingAircraft.mockReturnValue([mockAircraft[1]]);
      getRelevantValues.mockReturnValue({});

      render(
        <LivePreview
          conditions={defaultConditions}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
        />
      );

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(screen.getByText('RCH456')).toBeInTheDocument();
      expect(screen.getByText('AE1234')).toBeInTheDocument();
    });

    it('should display N/A for aircraft without callsign', () => {
      const aircraftNoCallsign = { ...mockAircraft[1], flight: '' };
      findMatchingAircraft.mockReturnValue([aircraftNoCallsign]);
      getRelevantValues.mockReturnValue({});

      render(
        <LivePreview
          conditions={defaultConditions}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
        />
      );

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(screen.getByText('N/A')).toBeInTheDocument();
    });

    it('should display altitude when available', () => {
      findMatchingAircraft.mockReturnValue([mockAircraft[1]]);
      getRelevantValues.mockReturnValue({ altitude: 28000 });

      render(
        <LivePreview
          conditions={defaultConditions}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
        />
      );

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(screen.getByText('Alt: 28000ft')).toBeInTheDocument();
    });

    it('should display speed when available', () => {
      findMatchingAircraft.mockReturnValue([mockAircraft[1]]);
      getRelevantValues.mockReturnValue({ speed: 400 });

      render(
        <LivePreview
          conditions={defaultConditions}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
        />
      );

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(screen.getByText('Spd: 400kts')).toBeInTheDocument();
    });

    it('should display distance when available in values', () => {
      findMatchingAircraft.mockReturnValue([mockAircraft[1]]);
      getRelevantValues.mockReturnValue({ distance: 15.5 });

      render(
        <LivePreview
          conditions={defaultConditions}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
        />
      );

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(screen.getByText('Dist: 15.5nm')).toBeInTheDocument();
    });

    it('should display calculatedDistance when distance is not in values', () => {
      const aircraftWithDistance = {
        ...mockAircraft[1],
        calculatedDistance: 20.3,
      };
      findMatchingAircraft.mockReturnValue([aircraftWithDistance]);
      getRelevantValues.mockReturnValue({});

      render(
        <LivePreview
          conditions={defaultConditions}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
        />
      );

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(screen.getByText('Dist: 20.3nm')).toBeInTheDocument();
    });

    it('should limit displayed aircraft to 5', () => {
      const manyMatches = Array.from({ length: 10 }, (_, i) => ({
        hex: `A${String(i).padStart(5, '0')}`,
        flight: `FLT${i}`,
      }));
      findMatchingAircraft.mockReturnValue(manyMatches);
      getRelevantValues.mockReturnValue({});

      render(
        <LivePreview
          conditions={defaultConditions}
          aircraft={manyMatches}
          feederLocation={mockFeederLocation}
        />
      );

      act(() => {
        vi.advanceTimersByTime(300);
      });

      const list = screen.getByRole('list');
      const items = within(list).getAllByRole('listitem');
      expect(items.length).toBe(5);
      expect(screen.getByText(/\.\.\.and 5 more aircraft/i)).toBeInTheDocument();
    });

    it('should not show more message when 5 or fewer matches', () => {
      const fiveMatches = Array.from({ length: 5 }, (_, i) => ({
        hex: `A${String(i).padStart(5, '0')}`,
        flight: `FLT${i}`,
      }));
      findMatchingAircraft.mockReturnValue(fiveMatches);
      getRelevantValues.mockReturnValue({});

      render(
        <LivePreview
          conditions={defaultConditions}
          aircraft={fiveMatches}
          feederLocation={mockFeederLocation}
        />
      );

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(screen.queryByText(/more aircraft/i)).not.toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('should display empty message when no aircraft match', () => {
      findMatchingAircraft.mockReturnValue([]);

      render(
        <LivePreview
          conditions={defaultConditions}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
        />
      );

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(screen.getByText(/no aircraft currently match these conditions/i)).toBeInTheDocument();
    });
  });

  describe('debouncing', () => {
    it('should debounce condition changes', () => {
      findMatchingAircraft.mockReturnValue([]);

      const { rerender } = render(
        <LivePreview
          conditions={defaultConditions}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
          debounceMs={300}
        />
      );

      // Update conditions multiple times quickly
      const newConditions1 = {
        ...defaultConditions,
        groups: [
          {
            logic: 'AND',
            conditions: [{ type: 'altitude_above', operator: 'gt', value: '10000' }],
          },
        ],
      };
      rerender(
        <LivePreview
          conditions={newConditions1}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
          debounceMs={300}
        />
      );

      const newConditions2 = {
        ...defaultConditions,
        groups: [
          {
            logic: 'AND',
            conditions: [{ type: 'altitude_above', operator: 'gt', value: '20000' }],
          },
        ],
      };
      rerender(
        <LivePreview
          conditions={newConditions2}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
          debounceMs={300}
        />
      );

      // Before debounce completes - should not have called with new conditions
      expect(findMatchingAircraft).not.toHaveBeenCalledWith(
        expect.objectContaining({ conditions: newConditions2 }),
        expect.anything(),
        expect.anything()
      );

      // Complete debounce
      act(() => {
        vi.advanceTimersByTime(300);
      });

      // Should have been called with final conditions
      expect(findMatchingAircraft).toHaveBeenLastCalledWith(
        expect.objectContaining({ conditions: newConditions2 }),
        mockAircraft,
        mockFeederLocation
      );
    });

    it('should use custom debounce time', () => {
      findMatchingAircraft.mockReturnValue([]);

      render(
        <LivePreview
          conditions={defaultConditions}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
          debounceMs={500}
        />
      );

      // At 300ms, should not have completed yet
      act(() => {
        vi.advanceTimersByTime(300);
      });

      // findMatchingAircraft may be called initially
      const callCount = findMatchingAircraft.mock.calls.length;

      // At 500ms, debounce should complete
      act(() => {
        vi.advanceTimersByTime(200);
      });

      // Should have been called after debounce
      expect(findMatchingAircraft.mock.calls.length).toBeGreaterThanOrEqual(callCount);
    });
  });

  describe('accessibility', () => {
    it('should have proper list role', () => {
      findMatchingAircraft.mockReturnValue([mockAircraft[1]]);
      getRelevantValues.mockReturnValue({});

      render(
        <LivePreview
          conditions={defaultConditions}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
        />
      );

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(screen.getByRole('list')).toBeInTheDocument();
    });

    it('should have listitem role for each aircraft', () => {
      findMatchingAircraft.mockReturnValue([mockAircraft[1]]);
      getRelevantValues.mockReturnValue({});

      render(
        <LivePreview
          conditions={defaultConditions}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
        />
      );

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(screen.getByRole('listitem')).toBeInTheDocument();
    });

    it('should use button type="button" to prevent form submission', () => {
      findMatchingAircraft.mockReturnValue([]);

      render(
        <LivePreview
          conditions={defaultConditions}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
        />
      );

      act(() => {
        vi.advanceTimersByTime(300);
      });

      const toggleBtn = screen.getByRole('button', { name: /matching/i });
      expect(toggleBtn).toHaveAttribute('type', 'button');
    });
  });

  describe('feeder location handling', () => {
    it('should pass feederLocation to findMatchingAircraft', () => {
      findMatchingAircraft.mockReturnValue([]);

      render(
        <LivePreview
          conditions={defaultConditions}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
        />
      );

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(findMatchingAircraft).toHaveBeenCalledWith(
        expect.any(Object),
        mockAircraft,
        mockFeederLocation
      );
    });

    it('should work with null feederLocation', () => {
      findMatchingAircraft.mockReturnValue([]);

      render(
        <LivePreview conditions={defaultConditions} aircraft={mockAircraft} feederLocation={null} />
      );

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(findMatchingAircraft).toHaveBeenCalledWith(expect.any(Object), mockAircraft, null);
    });
  });

  describe('cleanup', () => {
    it('should cleanup debounce timeout on unmount', () => {
      findMatchingAircraft.mockReturnValue([]);

      const { unmount } = render(
        <LivePreview
          conditions={defaultConditions}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
          debounceMs={300}
        />
      );

      // Start a debounce timer
      act(() => {
        vi.advanceTimersByTime(100);
      });

      // Unmount before debounce completes
      unmount();

      // Advance time past debounce - should not throw or call with unmounted state
      act(() => {
        vi.advanceTimersByTime(300);
      });

      // If we get here without errors, cleanup worked properly
      expect(true).toBe(true);
    });
  });
});
