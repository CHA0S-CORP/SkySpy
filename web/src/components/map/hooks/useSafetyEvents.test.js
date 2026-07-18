import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSafetyEvents } from './useSafetyEvents';

describe('useSafetyEvents', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const makeAlarmHook = () => ({
    playConflictAlarm: vi.fn(),
    getHighestSeverity: vi.fn(() => 'low'),
    startAlarmLoop: vi.fn(),
    stopAlarmLoop: vi.fn(),
    sendNotification: vi.fn(),
    acknowledgeEvent: vi.fn(),
    acknowledgedEvents: new Set(),
  });

  const makeLowEvent = () => ({
    id: 'evt-1',
    severity: 'low',
    event_type: 'proximity_conflict',
    timestamp: new Date().toISOString(),
    icao: 'ABC123',
  });

  it('plays the low-severity double-ding once per event, not on every aircraft update', () => {
    const alarmHook = makeAlarmHook();
    const initialProps = {
      wsSafetyEvents: [makeLowEvent()],
      wsRequest: null,
      wsConnected: false,
      config: {},
      aircraft: [],
      alarmHook,
    };

    const { rerender } = renderHook((props) => useSafetyEvents(props), { initialProps });

    // First ding immediately, echo after 1500ms
    expect(alarmHook.playConflictAlarm).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(alarmHook.playConflictAlarm).toHaveBeenCalledTimes(2);

    // Simulate position-stream updates: new aircraft array references re-run the
    // alarm effect (activeConflicts is recomputed). The same event must NOT replay.
    for (let i = 0; i < 3; i++) {
      rerender({ ...initialProps, aircraft: [] });
      act(() => {
        vi.advanceTimersByTime(1500);
      });
    }

    expect(alarmHook.playConflictAlarm).toHaveBeenCalledTimes(2);
  });

  it('plays the double-ding again for a new low-severity event', () => {
    const alarmHook = makeAlarmHook();
    const initialProps = {
      wsSafetyEvents: [makeLowEvent()],
      wsRequest: null,
      wsConnected: false,
      config: {},
      aircraft: [],
      alarmHook,
    };

    const { rerender } = renderHook((props) => useSafetyEvents(props), { initialProps });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(alarmHook.playConflictAlarm).toHaveBeenCalledTimes(2);

    // A second, previously-unseen low event arrives
    const secondEvent = { ...makeLowEvent(), id: 'evt-2' };
    rerender({ ...initialProps, wsSafetyEvents: [secondEvent] });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(alarmHook.playConflictAlarm).toHaveBeenCalledTimes(4);
  });

  it('schedules auto-acknowledge for low-severity events', () => {
    const alarmHook = makeAlarmHook();
    renderHook((props) => useSafetyEvents(props), {
      initialProps: {
        wsSafetyEvents: [makeLowEvent()],
        wsRequest: null,
        wsConnected: false,
        config: {},
        aircraft: [],
        alarmHook,
      },
    });

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(alarmHook.acknowledgeEvent).toHaveBeenCalledWith('evt-1');
  });
});
