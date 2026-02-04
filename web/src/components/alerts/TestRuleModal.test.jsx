import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TestRuleModal } from './TestRuleModal';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  X: () => <span data-testid="icon-x">X</span>,
  TestTube2: () => <span data-testid="icon-test">Test</span>,
  Plane: () => <span data-testid="icon-plane">Plane</span>,
}));

// Mock the alertEvaluator utilities
vi.mock('../../utils/alertEvaluator', () => ({
  findMatchingAircraft: vi.fn(),
  getRelevantValues: vi.fn(),
}));

import { findMatchingAircraft, getRelevantValues } from '../../utils/alertEvaluator';

describe('TestRuleModal', () => {
  const mockRule = {
    id: 1,
    name: 'Military Aircraft Alert',
    conditions: {
      logic: 'AND',
      groups: [
        {
          logic: 'AND',
          conditions: [{ type: 'military', operator: 'eq', value: 'true' }],
        },
      ],
    },
  };

  const mockAircraft = [
    {
      hex: 'A12345',
      flight: 'UAL123',
      alt_baro: 35000,
      gs: 450,
      squawk: '1200',
    },
    {
      hex: 'AE1234',
      flight: 'RCH123',
      alt_baro: 28000,
      gs: 400,
      squawk: '4567',
      dbFlags: 1, // Military
    },
    {
      hex: 'B67890',
      flight: 'DAL456',
      alt_baro: 12000,
      gs: 280,
      squawk: '3456',
    },
  ];

  const mockFeederLocation = { lat: 40.7128, lon: -74.006 };

  let mockOnClose;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnClose = vi.fn();

    // Default mock implementation
    findMatchingAircraft.mockReturnValue([]);
    getRelevantValues.mockReturnValue({});
  });

  describe('rendering', () => {
    it('should render modal with rule name in title', () => {
      render(
        <TestRuleModal
          rule={mockRule}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText(/test rule: military aircraft alert/i)).toBeInTheDocument();
    });

    it('should render close button', () => {
      render(
        <TestRuleModal
          rule={mockRule}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByRole('button', { name: /close test results/i })).toBeInTheDocument();
    });

    it('should have proper dialog role and aria attributes', () => {
      render(
        <TestRuleModal
          rule={mockRule}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
          onClose={mockOnClose}
        />
      );

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAttribute('aria-labelledby', 'test-modal-title');
    });
  });

  describe('matching aircraft display', () => {
    it('should display match count summary', () => {
      findMatchingAircraft.mockReturnValue([mockAircraft[1]]);

      render(
        <TestRuleModal
          rule={mockRule}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText(/1 of 3 aircraft match/i)).toBeInTheDocument();
    });

    it('should display no matches message when no aircraft match', () => {
      findMatchingAircraft.mockReturnValue([]);

      render(
        <TestRuleModal
          rule={mockRule}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText(/0 of 3 aircraft match/i)).toBeInTheDocument();
      expect(screen.getByText(/no aircraft currently match this rule/i)).toBeInTheDocument();
      expect(screen.getByText(/try adjusting the conditions/i)).toBeInTheDocument();
    });

    it('should display matching aircraft list', () => {
      const matchingAircraft = [
        {
          hex: 'AE1234',
          flight: 'RCH123',
          alt_baro: 28000,
          gs: 400,
          matchReasons: ['Military aircraft'],
        },
      ];
      findMatchingAircraft.mockReturnValue(matchingAircraft);
      getRelevantValues.mockReturnValue({
        altitude: 28000,
        speed: 400,
      });

      render(
        <TestRuleModal
          rule={mockRule}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('RCH123')).toBeInTheDocument();
      expect(screen.getByText('AE1234')).toBeInTheDocument();
    });

    it('should display aircraft values when available', () => {
      const matchingAircraft = [
        {
          hex: 'AE1234',
          flight: 'RCH123',
          alt_baro: 28000,
          gs: 400,
          squawk: '4567',
          calculatedDistance: 5.5,
        },
      ];
      findMatchingAircraft.mockReturnValue(matchingAircraft);
      getRelevantValues.mockReturnValue({
        altitude: 28000,
        speed: 400,
        squawk: '4567',
        distance: 5.5,
      });

      render(
        <TestRuleModal
          rule={mockRule}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('Alt: 28000ft')).toBeInTheDocument();
      expect(screen.getByText('Spd: 400kts')).toBeInTheDocument();
      expect(screen.getByText('Sqwk: 4567')).toBeInTheDocument();
      expect(screen.getByText('Dist: 5.5nm')).toBeInTheDocument();
    });

    it('should display match reasons', () => {
      const matchingAircraft = [
        {
          hex: 'AE1234',
          flight: 'RCH123',
          matchReasons: ['Military aircraft', 'Altitude above 10000ft'],
        },
      ];
      findMatchingAircraft.mockReturnValue(matchingAircraft);
      getRelevantValues.mockReturnValue({});

      render(
        <TestRuleModal
          rule={mockRule}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('Military aircraft')).toBeInTheDocument();
      expect(screen.getByText('Altitude above 10000ft')).toBeInTheDocument();
    });

    it('should display military badge for military aircraft', () => {
      const matchingAircraft = [
        {
          hex: 'AE1234',
          flight: 'RCH123',
        },
      ];
      findMatchingAircraft.mockReturnValue(matchingAircraft);
      getRelevantValues.mockReturnValue({
        military: true,
      });

      render(
        <TestRuleModal
          rule={mockRule}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('Military')).toBeInTheDocument();
    });

    it('should display emergency badge for emergency aircraft', () => {
      const matchingAircraft = [
        {
          hex: 'A12345',
          flight: 'UAL123',
          squawk: '7700',
        },
      ];
      findMatchingAircraft.mockReturnValue(matchingAircraft);
      getRelevantValues.mockReturnValue({
        emergency: true,
      });

      render(
        <TestRuleModal
          rule={mockRule}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('Emergency')).toBeInTheDocument();
    });

    it('should limit displayed aircraft to 20', () => {
      const manyAircraft = Array.from({ length: 25 }, (_, i) => ({
        hex: `A${String(i).padStart(5, '0')}`,
        flight: `FLT${i}`,
      }));
      findMatchingAircraft.mockReturnValue(manyAircraft);
      getRelevantValues.mockReturnValue({});

      render(
        <TestRuleModal
          rule={mockRule}
          aircraft={manyAircraft}
          feederLocation={mockFeederLocation}
          onClose={mockOnClose}
        />
      );

      // Should show 20 items plus "more" message
      const list = screen.getByRole('list', { name: /matching aircraft/i });
      const items = within(list).getAllByRole('listitem');
      expect(items.length).toBe(20);
      expect(screen.getByText(/\.\.\.and 5 more aircraft/i)).toBeInTheDocument();
    });

    it('should display calculated distance when no distance in values', () => {
      const matchingAircraft = [
        {
          hex: 'AE1234',
          flight: 'RCH123',
          calculatedDistance: 10.5,
        },
      ];
      findMatchingAircraft.mockReturnValue(matchingAircraft);
      getRelevantValues.mockReturnValue({});

      render(
        <TestRuleModal
          rule={mockRule}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('Dist: 10.5nm')).toBeInTheDocument();
    });

    it('should display N/A for aircraft without callsign', () => {
      const matchingAircraft = [
        {
          hex: 'AE1234',
          flight: '',
        },
      ];
      findMatchingAircraft.mockReturnValue(matchingAircraft);
      getRelevantValues.mockReturnValue({});

      render(
        <TestRuleModal
          rule={mockRule}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('N/A')).toBeInTheDocument();
    });

    it('should display aircraft type when available', () => {
      const matchingAircraft = [
        {
          hex: 'AE1234',
          flight: 'RCH123',
          t: 'C17',
        },
      ];
      findMatchingAircraft.mockReturnValue(matchingAircraft);
      getRelevantValues.mockReturnValue({
        type: 'C17',
      });

      render(
        <TestRuleModal
          rule={mockRule}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('Type: C17')).toBeInTheDocument();
    });
  });

  describe('close behavior', () => {
    it('should call onClose when close button is clicked', async () => {
      const user = userEvent.setup();
      findMatchingAircraft.mockReturnValue([]);

      render(
        <TestRuleModal
          rule={mockRule}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
          onClose={mockOnClose}
        />
      );

      const closeBtn = screen.getByRole('button', { name: /close test results/i });
      await user.click(closeBtn);

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('should call onClose when footer close button is clicked', async () => {
      const user = userEvent.setup();
      findMatchingAircraft.mockReturnValue([]);

      render(
        <TestRuleModal
          rule={mockRule}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
          onClose={mockOnClose}
        />
      );

      // Get the footer close button (btn-secondary class)
      const closeButtons = screen.getAllByRole('button', { name: /close/i });
      const footerCloseBtn = closeButtons.find((btn) => btn.classList.contains('btn-secondary'));
      await user.click(footerCloseBtn);

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('should call onClose when clicking overlay', async () => {
      const user = userEvent.setup();
      findMatchingAircraft.mockReturnValue([]);

      render(
        <TestRuleModal
          rule={mockRule}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
          onClose={mockOnClose}
        />
      );

      const overlay = screen.getByRole('presentation');
      await user.click(overlay);

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('should call onClose when pressing Escape via overlay keyDown', async () => {
      findMatchingAircraft.mockReturnValue([]);

      render(
        <TestRuleModal
          rule={mockRule}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
          onClose={mockOnClose}
        />
      );

      // The component uses onKeyDown on the overlay
      const overlay = screen.getByRole('presentation');
      fireEvent.keyDown(overlay, { key: 'Escape' });

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle null rule gracefully', () => {
      findMatchingAircraft.mockReturnValue([]);

      render(
        <TestRuleModal
          rule={null}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText(/0 of 3 aircraft match/i)).toBeInTheDocument();
    });

    it('should handle empty aircraft array', () => {
      findMatchingAircraft.mockReturnValue([]);

      render(
        <TestRuleModal
          rule={mockRule}
          aircraft={[]}
          feederLocation={mockFeederLocation}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText(/0 of 0 aircraft match/i)).toBeInTheDocument();
    });

    it('should handle null aircraft', () => {
      findMatchingAircraft.mockReturnValue([]);

      render(
        <TestRuleModal
          rule={mockRule}
          aircraft={null}
          feederLocation={mockFeederLocation}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText(/0 of 0 aircraft match/i)).toBeInTheDocument();
    });

    it('should handle null feederLocation', () => {
      findMatchingAircraft.mockReturnValue([]);

      render(
        <TestRuleModal
          rule={mockRule}
          aircraft={mockAircraft}
          feederLocation={null}
          onClose={mockOnClose}
        />
      );

      expect(findMatchingAircraft).toHaveBeenCalledWith(mockRule, mockAircraft, null);
    });

    it('should handle aircraft with whitespace-only flight', () => {
      const matchingAircraft = [
        {
          hex: 'AE1234',
          flight: '   ',
        },
      ];
      findMatchingAircraft.mockReturnValue(matchingAircraft);
      getRelevantValues.mockReturnValue({});

      render(
        <TestRuleModal
          rule={mockRule}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('N/A')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('should have proper list roles', () => {
      const matchingAircraft = [
        {
          hex: 'AE1234',
          flight: 'RCH123',
        },
      ];
      findMatchingAircraft.mockReturnValue(matchingAircraft);
      getRelevantValues.mockReturnValue({});

      render(
        <TestRuleModal
          rule={mockRule}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByRole('list', { name: /matching aircraft/i })).toBeInTheDocument();
      expect(screen.getByRole('listitem')).toBeInTheDocument();
    });

    it('should have live region for match count', () => {
      findMatchingAircraft.mockReturnValue([]);

      render(
        <TestRuleModal
          rule={mockRule}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
          onClose={mockOnClose}
        />
      );

      const statusRegions = screen.getAllByRole('status');
      // At least one should have aria-live="polite" for the summary
      const summaryStatus = statusRegions.find((el) =>
        el.classList.contains('test-results-summary')
      );
      expect(summaryStatus).toHaveAttribute('aria-live', 'polite');
    });

    it('should have live region for empty results', () => {
      findMatchingAircraft.mockReturnValue([]);

      render(
        <TestRuleModal
          rule={mockRule}
          aircraft={mockAircraft}
          feederLocation={mockFeederLocation}
          onClose={mockOnClose}
        />
      );

      const emptyMessage = screen
        .getByText(/no aircraft currently match this rule/i)
        .closest('[role="status"]');
      expect(emptyMessage).toBeInTheDocument();
    });
  });
});
