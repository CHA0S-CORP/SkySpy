import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SafetyEventPage } from './SafetyEventPage';

// Mock heavy children — this test targets the replay animation loop only
vi.mock('../../hooks/useSafetyEventData', () => ({
  useSafetyEventData: () => ({
    event: {
      id: 'evt-1',
      icao: 'ABC123',
      severity: 'warning',
      event_type: 'proximity_conflict',
      message: 'Test event',
      timestamp: '2024-01-15T12:00:00Z',
    },
    loading: false,
    error: null,
    trackData: {},
    acknowledged: false,
    acknowledging: false,
    acknowledgeEvent: vi.fn(),
  }),
}));
vi.mock('../safety/EventHeader', () => ({ EventHeader: () => null }));
vi.mock('../safety/AircraftCards', () => ({ AircraftCards: () => null }));
vi.mock('../safety/EventMapVisualization', () => ({ EventMapVisualization: () => null }));
vi.mock('../safety/TelemetrySnapshot', () => ({ TelemetrySnapshotsContent: () => null }));
vi.mock('../safety/FlightDataGraphs', () => ({ FlightDataGraphs: () => null }));

describe('SafetyEventPage replay animation', () => {
  let rafCallbacks;

  beforeEach(() => {
    rafCallbacks = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((cb) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      })
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(performance, 'now').mockReturnValue(1000);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const runNextFrame = (timestamp) => {
    const cb = rafCallbacks.shift();
    if (cb) {
      act(() => {
        cb(timestamp);
      });
    }
  };

  const renderPage = () =>
    render(<SafetyEventPage eventId="evt-1" apiBase="" wsRequest={null} wsConnected={false} />);

  it('applies speed changes while the replay is playing', () => {
    renderPage();
    const slider = screen.getByLabelText('Timeline position');

    // Rewind to start, then play at 1x
    fireEvent.click(screen.getByLabelText('Skip to start'));
    expect(slider.value).toBe('0');
    fireEvent.click(screen.getByLabelText('Play'));

    // One 200ms frame at 1x -> position advances by 1
    runNextFrame(1200);
    expect(parseFloat(slider.value)).toBeCloseTo(1, 5);

    // Change speed to 4x WHILE playing
    fireEvent.click(screen.getByLabelText('4x speed'));

    // Next 200ms frame must advance by 4, not the stale 1x captured at play time
    runNextFrame(1400);
    expect(parseFloat(slider.value)).toBeCloseTo(5, 5);
  });

  it('keeps advancing at the original speed when speed is unchanged', () => {
    renderPage();
    const slider = screen.getByLabelText('Timeline position');

    fireEvent.click(screen.getByLabelText('Skip to start'));
    fireEvent.click(screen.getByLabelText('Play'));

    runNextFrame(1200);
    runNextFrame(1400);
    expect(parseFloat(slider.value)).toBeCloseTo(2, 5);
  });

  it('stops at 100 and resets isPlaying', () => {
    renderPage();
    const slider = screen.getByLabelText('Timeline position');

    fireEvent.click(screen.getByLabelText('Skip to start'));
    fireEvent.click(screen.getByLabelText('Play'));

    // Huge frame delta overshoots the end
    runNextFrame(1000 + 200 * 200);
    expect(slider.value).toBe('100');
    // Play button label back to Play (not Pause)
    expect(screen.getByLabelText('Play')).toBeInTheDocument();
  });
});
