import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SafetyEventsPanel } from './SafetyEventsPanel';

// Helper to create safety events
function makeEvent(overrides = {}) {
  return {
    id: 1,
    event_type: 'emergency_squawk',
    severity: 'critical',
    icao: 'A00001',
    callsign: 'UAL123',
    squawk: '7700',
    altitude: 35000,
    message: 'General emergency',
    timestamp: '2026-01-15T12:30:00Z',
    ...overrides,
  };
}

describe('SafetyEventsPanel', () => {
  const defaultProps = {
    events: [],
    acknowledgedEvents: new Set(),
    onAcknowledge: vi.fn(),
    onSelectAircraft: vi.fn(),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('should return null when events is empty', () => {
      const { container } = render(<SafetyEventsPanel {...defaultProps} />);
      expect(container.innerHTML).toBe('');
    });

    it('should return null when events is null', () => {
      const { container } = render(<SafetyEventsPanel {...defaultProps} events={null} />);
      expect(container.innerHTML).toBe('');
    });

    it('should render panel when events exist', () => {
      const events = [makeEvent()];
      render(<SafetyEventsPanel {...defaultProps} events={events} />);

      expect(screen.getByText('Safety Events')).toBeInTheDocument();
    });

    it('should display event count', () => {
      const events = [makeEvent({ id: 1 }), makeEvent({ id: 2 }), makeEvent({ id: 3 })];
      render(<SafetyEventsPanel {...defaultProps} events={events} />);

      expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('should display callsign', () => {
      const events = [makeEvent({ callsign: 'DAL456' })];
      render(<SafetyEventsPanel {...defaultProps} events={events} />);

      expect(screen.getByText('DAL456')).toBeInTheDocument();
    });

    it('should fall back to ICAO when callsign is missing', () => {
      const events = [makeEvent({ callsign: null, icao: 'ABCDEF' })];
      render(<SafetyEventsPanel {...defaultProps} events={events} />);

      expect(screen.getByText('ABCDEF')).toBeInTheDocument();
    });

    it('should display event type as uppercase badge', () => {
      const events = [makeEvent({ event_type: 'emergency_squawk' })];
      render(<SafetyEventsPanel {...defaultProps} events={events} />);

      expect(screen.getByText('EMERGENCY SQUAWK')).toBeInTheDocument();
    });

    it('should display squawk code', () => {
      const events = [makeEvent({ squawk: '7700' })];
      render(<SafetyEventsPanel {...defaultProps} events={events} />);

      expect(screen.getByText('Squawk: 7700')).toBeInTheDocument();
    });

    it('should display altitude with locale formatting', () => {
      const events = [makeEvent({ altitude: 35000 })];
      render(<SafetyEventsPanel {...defaultProps} events={events} />);

      expect(screen.getByText('35,000 ft')).toBeInTheDocument();
    });

    it('should display event message', () => {
      const events = [makeEvent({ message: 'General emergency' })];
      render(<SafetyEventsPanel {...defaultProps} events={events} />);

      expect(screen.getByText('General emergency')).toBeInTheDocument();
    });

    it('should display timestamp as localized time', () => {
      const events = [makeEvent({ timestamp: '2026-01-15T12:30:00Z' })];
      render(<SafetyEventsPanel {...defaultProps} events={events} />);

      // The exact format depends on locale, just check it rendered something
      const timeEl = document.querySelector('.event-time');
      expect(timeEl).toBeInTheDocument();
      expect(timeEl.textContent).not.toBe('--');
    });

    it('should show -- when timestamp is missing', () => {
      const events = [makeEvent({ timestamp: null })];
      render(<SafetyEventsPanel {...defaultProps} events={events} />);

      expect(screen.getByText('--')).toBeInTheDocument();
    });

    it('should not display squawk section when squawk is null', () => {
      const events = [makeEvent({ squawk: null })];
      render(<SafetyEventsPanel {...defaultProps} events={events} />);

      expect(screen.queryByText(/Squawk:/)).not.toBeInTheDocument();
    });

    it('should not display altitude when altitude is null', () => {
      const events = [makeEvent({ altitude: null })];
      render(<SafetyEventsPanel {...defaultProps} events={events} />);

      expect(screen.queryByText(/ft/)).not.toBeInTheDocument();
    });

    it('should not display message when message is null', () => {
      const events = [makeEvent({ message: null })];
      render(<SafetyEventsPanel {...defaultProps} events={events} />);

      // Should not have any .event-message elements
      expect(document.querySelector('.event-message')).not.toBeInTheDocument();
    });
  });

  describe('emergency squawk codes', () => {
    it('should display 7500 hijack squawk', () => {
      const events = [makeEvent({ squawk: '7500', message: 'Hijack' })];
      render(<SafetyEventsPanel {...defaultProps} events={events} />);

      expect(screen.getByText('Squawk: 7500')).toBeInTheDocument();
    });

    it('should display 7600 radio failure squawk', () => {
      const events = [makeEvent({ squawk: '7600', message: 'Radio failure' })];
      render(<SafetyEventsPanel {...defaultProps} events={events} />);

      expect(screen.getByText('Squawk: 7600')).toBeInTheDocument();
    });

    it('should display 7700 general emergency squawk', () => {
      const events = [makeEvent({ squawk: '7700', message: 'General emergency' })];
      render(<SafetyEventsPanel {...defaultProps} events={events} />);

      expect(screen.getByText('Squawk: 7700')).toBeInTheDocument();
    });
  });

  describe('sorting', () => {
    it('should sort critical events before warning events', () => {
      const events = [
        makeEvent({ id: 1, severity: 'warning', callsign: 'WARN1' }),
        makeEvent({ id: 2, severity: 'critical', callsign: 'CRIT1' }),
      ];
      const { container } = render(<SafetyEventsPanel {...defaultProps} events={events} />);

      const eventElements = container.querySelectorAll('.safety-event');
      expect(eventElements[0]).toHaveClass('severity-critical');
      expect(eventElements[1]).toHaveClass('severity-warning');
    });

    it('should sort warning events before info events', () => {
      const events = [
        makeEvent({ id: 1, severity: 'info', callsign: 'INFO1' }),
        makeEvent({ id: 2, severity: 'warning', callsign: 'WARN1' }),
      ];
      const { container } = render(<SafetyEventsPanel {...defaultProps} events={events} />);

      const eventElements = container.querySelectorAll('.safety-event');
      expect(eventElements[0]).toHaveClass('severity-warning');
      expect(eventElements[1]).toHaveClass('severity-info');
    });

    it('should sort same-severity events by timestamp (newest first)', () => {
      const events = [
        makeEvent({
          id: 1,
          severity: 'critical',
          timestamp: '2026-01-15T10:00:00Z',
          callsign: 'OLDER',
        }),
        makeEvent({
          id: 2,
          severity: 'critical',
          timestamp: '2026-01-15T12:00:00Z',
          callsign: 'NEWER',
        }),
      ];
      const { container } = render(<SafetyEventsPanel {...defaultProps} events={events} />);

      const callsigns = container.querySelectorAll('.event-callsign');
      expect(callsigns[0].textContent).toBe('NEWER');
      expect(callsigns[1].textContent).toBe('OLDER');
    });

    it('should handle unknown severity levels', () => {
      const events = [
        makeEvent({ id: 1, severity: 'unknown', callsign: 'UNK' }),
        makeEvent({ id: 2, severity: 'critical', callsign: 'CRIT' }),
      ];
      const { container } = render(<SafetyEventsPanel {...defaultProps} events={events} />);

      const callsigns = container.querySelectorAll('.event-callsign');
      expect(callsigns[0].textContent).toBe('CRIT');
      expect(callsigns[1].textContent).toBe('UNK');
    });
  });

  describe('acknowledged events', () => {
    it('should add acknowledged class to acknowledged events', () => {
      const events = [makeEvent({ id: 42 })];
      const { container } = render(
        <SafetyEventsPanel {...defaultProps} events={events} acknowledgedEvents={new Set([42])} />
      );

      expect(container.querySelector('.safety-event')).toHaveClass('acknowledged');
    });

    it('should not show acknowledge button for acknowledged events', () => {
      const events = [makeEvent({ id: 42 })];
      render(
        <SafetyEventsPanel {...defaultProps} events={events} acknowledgedEvents={new Set([42])} />
      );

      expect(screen.queryByTitle('Acknowledge')).not.toBeInTheDocument();
    });

    it('should show acknowledge button for unacknowledged events', () => {
      const events = [makeEvent({ id: 42 })];
      render(<SafetyEventsPanel {...defaultProps} events={events} />);

      expect(screen.getByTitle('Acknowledge')).toBeInTheDocument();
    });

    it('should not show acknowledge button when onAcknowledge is not provided', () => {
      const events = [makeEvent()];
      render(<SafetyEventsPanel {...defaultProps} events={events} onAcknowledge={undefined} />);

      expect(screen.queryByTitle('Acknowledge')).not.toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('should call onSelectAircraft with ICAO when callsign is clicked', async () => {
      const user = userEvent.setup();
      const events = [makeEvent({ icao: 'ABCDEF' })];
      render(<SafetyEventsPanel {...defaultProps} events={events} />);

      await user.click(screen.getByText('UAL123'));

      expect(defaultProps.onSelectAircraft).toHaveBeenCalledWith('ABCDEF');
    });

    it('should call onAcknowledge with event id when acknowledge button is clicked', async () => {
      const user = userEvent.setup();
      const events = [makeEvent({ id: 99 })];
      render(<SafetyEventsPanel {...defaultProps} events={events} />);

      await user.click(screen.getByTitle('Acknowledge'));

      expect(defaultProps.onAcknowledge).toHaveBeenCalledWith(99);
    });

    it('should call onClose when close button is clicked', async () => {
      const user = userEvent.setup();
      const events = [makeEvent()];
      render(<SafetyEventsPanel {...defaultProps} events={events} />);

      // Find the close button in the header
      const header = document.querySelector('.safety-events-header');
      const closeBtn = within(header).getByRole('button');
      await user.click(closeBtn);

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });

    it('should not render close button when onClose is not provided', () => {
      const events = [makeEvent()];
      render(<SafetyEventsPanel {...defaultProps} events={events} onClose={undefined} />);

      expect(document.querySelector('.safety-close')).not.toBeInTheDocument();
    });

    it('should handle keyboard Enter on callsign', async () => {
      const user = userEvent.setup();
      const events = [makeEvent({ icao: 'ABCDEF' })];
      render(<SafetyEventsPanel {...defaultProps} events={events} />);

      const callsign = screen.getByText('UAL123');
      callsign.focus();
      await user.keyboard('{Enter}');

      expect(defaultProps.onSelectAircraft).toHaveBeenCalledWith('ABCDEF');
    });

    it('should have correct ARIA label on callsign', () => {
      const events = [makeEvent({ callsign: 'UAL123', icao: 'A00001' })];
      render(<SafetyEventsPanel {...defaultProps} events={events} />);

      expect(screen.getByLabelText('Select aircraft UAL123')).toBeInTheDocument();
    });

    it('should not throw when onSelectAircraft is undefined', async () => {
      const user = userEvent.setup();
      const events = [makeEvent()];
      render(<SafetyEventsPanel {...defaultProps} events={events} onSelectAircraft={undefined} />);

      await user.click(screen.getByText('UAL123'));
    });
  });

  describe('edge cases', () => {
    it('should handle events with no id by using index as key', () => {
      const events = [
        makeEvent({ id: undefined, callsign: 'NOID1' }),
        makeEvent({ id: undefined, callsign: 'NOID2' }),
      ];
      const { container } = render(<SafetyEventsPanel {...defaultProps} events={events} />);

      const eventElements = container.querySelectorAll('.safety-event');
      expect(eventElements).toHaveLength(2);
    });

    it('should handle event_type with underscores correctly', () => {
      const events = [makeEvent({ event_type: 'tcas_resolution_advisory' })];
      render(<SafetyEventsPanel {...defaultProps} events={events} />);

      expect(screen.getByText('TCAS RESOLUTION ADVISORY')).toBeInTheDocument();
    });

    it('should handle acknowledgedEvents being undefined', () => {
      const events = [makeEvent()];
      const { container } = render(
        <SafetyEventsPanel {...defaultProps} events={events} acknowledgedEvents={undefined} />
      );

      // Should render without crashing
      expect(container.querySelector('.safety-event')).not.toHaveClass('acknowledged');
    });

    it('should render multiple events of different types', () => {
      const events = [
        makeEvent({ id: 1, event_type: 'emergency_squawk', squawk: '7700' }),
        makeEvent({ id: 2, event_type: 'tcas_ra', squawk: null, message: 'TCAS RA' }),
        makeEvent({ id: 3, event_type: 'proximity_conflict', squawk: null, severity: 'warning' }),
      ];
      const { container } = render(<SafetyEventsPanel {...defaultProps} events={events} />);

      expect(container.querySelectorAll('.safety-event')).toHaveLength(3);
      expect(screen.getByText('3')).toBeInTheDocument();
    });
  });
});
