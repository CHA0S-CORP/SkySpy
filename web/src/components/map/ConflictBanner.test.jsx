import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConflictBanner } from './ConflictBanner';

// Helper to create a proximity conflict event
function makeConflict(overrides = {}) {
  return {
    id: 1,
    event_type: 'proximity_conflict',
    severity: 'warning',
    icao: 'A00001',
    callsign: 'UAL123',
    icao_2: 'A00002',
    callsign_2: 'DAL456',
    details: {
      distance_nm: 0.8,
      altitude_diff_ft: 500,
      aircraft_1: { alt: 35000 },
      aircraft_2: { alt: 34500 },
    },
    ...overrides,
  };
}

describe('ConflictBanner', () => {
  const defaultProps = {
    safetyEvents: [],
    acknowledgedEvents: new Set(),
    onAcknowledge: vi.fn(),
    onSelectAircraft: vi.fn(),
    soundMuted: false,
    onToggleMute: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('should return null when there are no proximity conflicts', () => {
      const { container } = render(<ConflictBanner {...defaultProps} />);
      expect(container.innerHTML).toBe('');
    });

    it('should return null when all events are non-proximity types', () => {
      const events = [
        { id: 1, event_type: 'emergency_squawk', severity: 'critical' },
        { id: 2, event_type: 'tcas_ra', severity: 'warning' },
      ];
      const { container } = render(<ConflictBanner {...defaultProps} safetyEvents={events} />);
      expect(container.innerHTML).toBe('');
    });

    it('should return null when all proximity conflicts are acknowledged', () => {
      const events = [makeConflict({ id: 1 }), makeConflict({ id: 2 })];
      const { container } = render(
        <ConflictBanner
          {...defaultProps}
          safetyEvents={events}
          acknowledgedEvents={new Set([1, 2])}
        />
      );
      expect(container.innerHTML).toBe('');
    });

    it('should render banner when there are unacknowledged proximity conflicts', () => {
      const events = [makeConflict()];
      render(<ConflictBanner {...defaultProps} safetyEvents={events} />);

      expect(screen.getByText('TRAFFIC CONFLICT')).toBeInTheDocument();
    });

    it('should show plural title for multiple conflicts', () => {
      const events = [
        makeConflict({ id: 1 }),
        makeConflict({ id: 2, icao: 'B00001', icao_2: 'B00002' }),
      ];
      render(<ConflictBanner {...defaultProps} safetyEvents={events} />);

      expect(screen.getByText('TRAFFIC CONFLICTS')).toBeInTheDocument();
    });

    it('should display callsigns for both aircraft', () => {
      const events = [makeConflict()];
      render(<ConflictBanner {...defaultProps} safetyEvents={events} />);

      expect(screen.getByText('UAL123')).toBeInTheDocument();
      expect(screen.getByText('DAL456')).toBeInTheDocument();
    });

    it('should fall back to ICAO hex when callsign is missing', () => {
      const events = [makeConflict({ callsign: null, callsign_2: null })];
      render(<ConflictBanner {...defaultProps} safetyEvents={events} />);

      expect(screen.getByText('A00001')).toBeInTheDocument();
      expect(screen.getByText('A00002')).toBeInTheDocument();
    });

    it('should display horizontal distance and altitude difference', () => {
      const events = [makeConflict()];
      render(<ConflictBanner {...defaultProps} safetyEvents={events} />);

      expect(screen.getByText('0.8 nm')).toBeInTheDocument();
      expect(screen.getByText('500 ft')).toBeInTheDocument();
    });

    it('should display both aircraft altitudes', () => {
      const events = [makeConflict()];
      render(<ConflictBanner {...defaultProps} safetyEvents={events} />);

      expect(screen.getByText('35,000')).toBeInTheDocument();
      expect(screen.getByText('34,500')).toBeInTheDocument();
    });

    it('should show ? when altitude is missing', () => {
      const events = [
        makeConflict({
          details: {
            distance_nm: 1.0,
            altitude_diff_ft: 0,
            aircraft_1: {},
            aircraft_2: {},
          },
        }),
      ];
      render(<ConflictBanner {...defaultProps} safetyEvents={events} />);

      const questionMarks = screen.getAllByText('?');
      expect(questionMarks).toHaveLength(2);
    });

    it('should handle missing details gracefully', () => {
      const events = [makeConflict({ details: undefined })];
      render(<ConflictBanner {...defaultProps} safetyEvents={events} />);

      expect(screen.getByText('0.0 nm')).toBeInTheDocument();
      expect(screen.getByText('0 ft')).toBeInTheDocument();
    });
  });

  describe('severity', () => {
    it('should apply critical severity class when any conflict is critical', () => {
      const events = [
        makeConflict({ id: 1, severity: 'info' }),
        makeConflict({ id: 2, severity: 'critical' }),
      ];
      const { container } = render(<ConflictBanner {...defaultProps} safetyEvents={events} />);

      expect(container.querySelector('.conflict-banner')).toHaveClass('severity-critical');
    });

    it('should apply warning severity when highest is warning', () => {
      const events = [
        makeConflict({ id: 1, severity: 'info' }),
        makeConflict({ id: 2, severity: 'warning' }),
      ];
      const { container } = render(<ConflictBanner {...defaultProps} safetyEvents={events} />);

      expect(container.querySelector('.conflict-banner')).toHaveClass('severity-warning');
    });

    it('should apply info severity when all conflicts are info', () => {
      const events = [makeConflict({ severity: 'info' })];
      const { container } = render(<ConflictBanner {...defaultProps} safetyEvents={events} />);

      expect(container.querySelector('.conflict-banner')).toHaveClass('severity-info');
    });

    it('should apply per-item severity class to each conflict', () => {
      const events = [
        makeConflict({ id: 1, severity: 'critical' }),
        makeConflict({ id: 2, severity: 'warning' }),
      ];
      const { container } = render(<ConflictBanner {...defaultProps} safetyEvents={events} />);

      const items = container.querySelectorAll('.conflict-item');
      expect(items[0]).toHaveClass('severity-critical');
      expect(items[1]).toHaveClass('severity-warning');
    });
  });

  describe('mute button', () => {
    it('should show Mute alarms title when sound is not muted', () => {
      const events = [makeConflict()];
      render(<ConflictBanner {...defaultProps} safetyEvents={events} soundMuted={false} />);

      expect(screen.getByTitle('Mute alarms')).toBeInTheDocument();
    });

    it('should show Unmute alarms title when sound is muted', () => {
      const events = [makeConflict()];
      render(<ConflictBanner {...defaultProps} safetyEvents={events} soundMuted={true} />);

      expect(screen.getByTitle('Unmute alarms')).toBeInTheDocument();
    });

    it('should call onToggleMute when mute button is clicked', async () => {
      const user = userEvent.setup();
      const events = [makeConflict()];
      render(<ConflictBanner {...defaultProps} safetyEvents={events} />);

      await user.click(screen.getByTitle('Mute alarms'));

      expect(defaultProps.onToggleMute).toHaveBeenCalledTimes(1);
    });
  });

  describe('interactions', () => {
    it('should call onSelectAircraft with first aircraft ICAO when callsign is clicked', async () => {
      const user = userEvent.setup();
      const events = [makeConflict()];
      render(<ConflictBanner {...defaultProps} safetyEvents={events} />);

      await user.click(screen.getByText('UAL123'));

      expect(defaultProps.onSelectAircraft).toHaveBeenCalledWith('A00001');
    });

    it('should call onSelectAircraft with second aircraft ICAO when clicked', async () => {
      const user = userEvent.setup();
      const events = [makeConflict()];
      render(<ConflictBanner {...defaultProps} safetyEvents={events} />);

      await user.click(screen.getByText('DAL456'));

      expect(defaultProps.onSelectAircraft).toHaveBeenCalledWith('A00002');
    });

    it('should call onAcknowledge with event id when dismiss button is clicked', async () => {
      const user = userEvent.setup();
      const events = [makeConflict({ id: 42 })];
      render(<ConflictBanner {...defaultProps} safetyEvents={events} />);

      await user.click(screen.getByTitle('Acknowledge'));

      expect(defaultProps.onAcknowledge).toHaveBeenCalledWith(42);
    });

    it('should handle keyboard Enter on callsign', async () => {
      const user = userEvent.setup();
      const events = [makeConflict()];
      render(<ConflictBanner {...defaultProps} safetyEvents={events} />);

      const callsign = screen.getByText('UAL123');
      callsign.focus();
      await user.keyboard('{Enter}');

      expect(defaultProps.onSelectAircraft).toHaveBeenCalledWith('A00001');
    });

    it('should have correct ARIA labels on callsigns', () => {
      const events = [makeConflict()];
      render(<ConflictBanner {...defaultProps} safetyEvents={events} />);

      expect(screen.getByLabelText('Select aircraft UAL123')).toBeInTheDocument();
      expect(screen.getByLabelText('Select aircraft DAL456')).toBeInTheDocument();
    });

    it('should not throw when onSelectAircraft is undefined', async () => {
      const user = userEvent.setup();
      const events = [makeConflict()];
      render(
        <ConflictBanner {...defaultProps} safetyEvents={events} onSelectAircraft={undefined} />
      );

      // Should not throw
      await user.click(screen.getByText('UAL123'));
    });

    it('should not throw when onAcknowledge is undefined', async () => {
      const user = userEvent.setup();
      const events = [makeConflict()];
      render(<ConflictBanner {...defaultProps} safetyEvents={events} onAcknowledge={undefined} />);

      await user.click(screen.getByTitle('Acknowledge'));
    });
  });

  describe('filtering', () => {
    it('should only show unacknowledged proximity conflicts', () => {
      const events = [
        makeConflict({ id: 1, callsign: 'VISIBLE' }),
        makeConflict({ id: 2, callsign: 'HIDDEN' }),
        { id: 3, event_type: 'emergency_squawk', severity: 'critical' },
      ];
      render(
        <ConflictBanner {...defaultProps} safetyEvents={events} acknowledgedEvents={new Set([2])} />
      );

      expect(screen.getByText('VISIBLE')).toBeInTheDocument();
      expect(screen.queryByText('HIDDEN')).not.toBeInTheDocument();
    });
  });
});
