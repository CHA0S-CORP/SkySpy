import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMapAlarms } from './useMapAlarms';

describe('useMapAlarms', () => {
  let mockAudioContext;
  let mockOscillator;
  let mockGain;
  let mockLocalStorage;

  beforeEach(() => {
    // Mock AudioContext
    mockOscillator = {
      connect: vi.fn(),
      frequency: { value: 0 },
      type: 'sine',
      start: vi.fn(),
      stop: vi.fn(),
    };

    mockGain = {
      connect: vi.fn(),
      gain: {
        value: 0,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
    };

    mockAudioContext = {
      currentTime: 0,
      state: 'running',
      resume: vi.fn().mockResolvedValue(undefined),
      destination: {},
      createOscillator: vi.fn(() => mockOscillator),
      createGain: vi.fn(() => mockGain),
    };

    window.AudioContext = vi.fn(() => mockAudioContext);
    window.webkitAudioContext = vi.fn(() => mockAudioContext);

    // Reset localStorage mock from setup.js
    vi.clearAllMocks();

    // Configure the global localStorage mock (from setup.js) to store values
    mockLocalStorage = {};
    localStorage.getItem.mockImplementation((key) => mockLocalStorage[key] || null);
    localStorage.setItem.mockImplementation((key, value) => {
      mockLocalStorage[key] = value;
    });

    // Mock Notification
    global.Notification = vi.fn();
    global.Notification.permission = 'granted';

    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('should initialize with soundMuted from localStorage', () => {
      mockLocalStorage['adsb-sound-muted'] = 'true';

      const { result } = renderHook(() => useMapAlarms());

      expect(result.current.soundMuted).toBe(true);
    });

    it('should default to not muted', () => {
      const { result } = renderHook(() => useMapAlarms());

      expect(result.current.soundMuted).toBe(false);
    });
  });

  describe('setSoundMuted', () => {
    it('should update sound muted state', () => {
      const { result } = renderHook(() => useMapAlarms());

      act(() => {
        result.current.setSoundMuted(true);
      });

      expect(result.current.soundMuted).toBe(true);
    });

    it('should persist to localStorage', () => {
      const { result } = renderHook(() => useMapAlarms());

      act(() => {
        result.current.setSoundMuted(true);
      });

      expect(mockLocalStorage['adsb-sound-muted']).toBe('true');
    });
  });

  describe('initAudioContext', () => {
    it('should create AudioContext on first call', () => {
      const { result } = renderHook(() => useMapAlarms());

      act(() => {
        result.current.initAudioContext();
      });

      expect(window.AudioContext).toHaveBeenCalled();
    });

    it('should resume suspended context', () => {
      mockAudioContext.state = 'suspended';

      const { result } = renderHook(() => useMapAlarms());

      act(() => {
        result.current.initAudioContext();
      });

      expect(mockAudioContext.resume).toHaveBeenCalled();
    });

    it('should return existing context on subsequent calls', () => {
      const { result } = renderHook(() => useMapAlarms());

      act(() => {
        result.current.initAudioContext();
        result.current.initAudioContext();
      });

      expect(window.AudioContext).toHaveBeenCalledTimes(1);
    });
  });

  describe('playConflictAlarm', () => {
    it('should not play when muted', () => {
      const { result } = renderHook(() => useMapAlarms());

      act(() => {
        result.current.setSoundMuted(true);
      });

      act(() => {
        result.current.playConflictAlarm('low');
      });

      expect(mockAudioContext.createOscillator).not.toHaveBeenCalled();
    });

    it('should play Stage 1 alarm for low severity', () => {
      const { result } = renderHook(() => useMapAlarms());

      act(() => {
        result.current.playConflictAlarm('low');
      });

      expect(mockOscillator.start).toHaveBeenCalled();
    });

    it('should play Stage 2 alarm for warning severity', () => {
      const { result } = renderHook(() => useMapAlarms());

      act(() => {
        result.current.playConflictAlarm('warning');
      });

      expect(mockOscillator.start).toHaveBeenCalled();
    });

    it('should play Stage 3 alarm for critical severity', () => {
      const { result } = renderHook(() => useMapAlarms());

      act(() => {
        result.current.playConflictAlarm('critical');
      });

      expect(mockOscillator.start).toHaveBeenCalled();
    });

    it('should prevent overlapping alarms', () => {
      const { result } = renderHook(() => useMapAlarms());

      act(() => {
        result.current.playConflictAlarm('low');
      });

      const initialCallCount = mockOscillator.start.mock.calls.length;

      act(() => {
        result.current.playConflictAlarm('low');
      });

      // Should not have played again (still playing)
      expect(mockOscillator.start.mock.calls.length).toBe(initialCallCount);
    });
  });

  describe('getHighestSeverity', () => {
    it('should return critical if any event is critical', () => {
      const { result } = renderHook(() => useMapAlarms());

      const events = [{ severity: 'low' }, { severity: 'critical' }, { severity: 'warning' }];

      expect(result.current.getHighestSeverity(events)).toBe('critical');
    });

    it('should return warning if highest is warning', () => {
      const { result } = renderHook(() => useMapAlarms());

      const events = [{ severity: 'low' }, { severity: 'warning' }];

      expect(result.current.getHighestSeverity(events)).toBe('warning');
    });

    it('should return low for low severity only', () => {
      const { result } = renderHook(() => useMapAlarms());

      const events = [{ severity: 'low' }];

      expect(result.current.getHighestSeverity(events)).toBe('low');
    });
  });

  describe('startAlarmLoop', () => {
    it('should start looping alarm', () => {
      const { result } = renderHook(() => useMapAlarms());

      act(() => {
        result.current.startAlarmLoop('low');
      });

      expect(mockOscillator.start).toHaveBeenCalled();
    });

    it('should not start multiple loops', () => {
      const { result } = renderHook(() => useMapAlarms());

      act(() => {
        result.current.startAlarmLoop('low');
        result.current.startAlarmLoop('low');
      });

      // Only one set of oscillators should be created per play
    });

    it('should repeat alarm at interval for critical severity', () => {
      const { result } = renderHook(() => useMapAlarms());

      act(() => {
        result.current.startAlarmLoop('critical');
      });

      const initialCalls = mockOscillator.start.mock.calls.length;

      act(() => {
        vi.advanceTimersByTime(1500);
      });

      expect(mockOscillator.start.mock.calls.length).toBeGreaterThan(initialCalls);
    });

    it('should not start when muted', () => {
      const { result } = renderHook(() => useMapAlarms());

      act(() => {
        result.current.setSoundMuted(true);
      });

      act(() => {
        result.current.startAlarmLoop('low');
      });

      expect(mockOscillator.start).not.toHaveBeenCalled();
    });
  });

  describe('stopAlarmLoop', () => {
    it('should stop looping alarm', () => {
      const { result } = renderHook(() => useMapAlarms());

      act(() => {
        result.current.startAlarmLoop('low');
      });

      act(() => {
        result.current.stopAlarmLoop();
      });

      const callCountAfterStop = mockOscillator.start.mock.calls.length;

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      // Should not have increased after stop
      expect(mockOscillator.start.mock.calls.length).toBe(callCountAfterStop);
    });

    it('should handle stop when not playing', () => {
      const { result } = renderHook(() => useMapAlarms());

      expect(() => {
        act(() => {
          result.current.stopAlarmLoop();
        });
      }).not.toThrow();
    });
  });

  describe('sendNotification', () => {
    it('should send browser notification', () => {
      const { result } = renderHook(() => useMapAlarms());

      act(() => {
        result.current.sendNotification('Test Title', 'Test Body', 'test-tag');
      });

      expect(global.Notification).toHaveBeenCalledWith('Test Title', {
        body: 'Test Body',
        icon: '/static/favicon.svg',
        tag: 'test-tag',
        requireInteraction: false,
        silent: false,
      });
    });

    it('should set requireInteraction for urgent notifications', () => {
      const { result } = renderHook(() => useMapAlarms());

      act(() => {
        result.current.sendNotification('Urgent', 'Body', 'tag', true);
      });

      expect(global.Notification).toHaveBeenCalledWith(
        'Urgent',
        expect.objectContaining({ requireInteraction: true })
      );
    });

    it('should not send when permission not granted', () => {
      global.Notification.permission = 'denied';
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { result } = renderHook(() => useMapAlarms());

      act(() => {
        result.current.sendNotification('Test', 'Body', 'tag');
      });

      expect(global.Notification).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle notification errors gracefully', () => {
      global.Notification.mockImplementation(() => {
        throw new Error('Notification error');
      });

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { result } = renderHook(() => useMapAlarms());

      expect(() => {
        act(() => {
          result.current.sendNotification('Test', 'Body', 'tag');
        });
      }).not.toThrow();

      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should auto-close non-urgent notifications', () => {
      let notificationInstance;
      global.Notification.mockImplementation(function (title, options) {
        this.close = vi.fn();
        notificationInstance = this;
        return this;
      });

      const { result } = renderHook(() => useMapAlarms());

      act(() => {
        result.current.sendNotification('Test', 'Body', 'tag', false);
      });

      act(() => {
        vi.advanceTimersByTime(10000);
      });

      expect(notificationInstance.close).toHaveBeenCalled();
    });
  });

  describe('event notification tracking', () => {
    it('should track notified events', () => {
      const { result } = renderHook(() => useMapAlarms());

      expect(result.current.wasEventNotified('event-1')).toBe(false);

      act(() => {
        result.current.markEventNotified('event-1');
      });

      expect(result.current.wasEventNotified('event-1')).toBe(true);
    });

    it('should track notified emergencies', () => {
      const { result } = renderHook(() => useMapAlarms());

      expect(result.current.wasEmergencyNotified('em-1')).toBe(false);

      act(() => {
        result.current.markEmergencyNotified('em-1');
      });

      expect(result.current.wasEmergencyNotified('em-1')).toBe(true);
    });

    it('should clear old notifications after timeout', () => {
      const { result } = renderHook(() => useMapAlarms());

      act(() => {
        result.current.markEventNotified('event-1');
        result.current.markEventNotified('event-2');
      });

      expect(result.current.wasEventNotified('event-1')).toBe(true);

      // Clear old notifications - event-1 not in current set
      act(() => {
        result.current.clearOldNotifications(new Set(['event-2']));
      });

      // Advance past cleanup timeout (5 minutes)
      act(() => {
        vi.advanceTimersByTime(300001);
      });

      expect(result.current.wasEventNotified('event-1')).toBe(false);
      expect(result.current.wasEventNotified('event-2')).toBe(true);
    });

    it('should clear emergency notification after timeout', () => {
      const { result } = renderHook(() => useMapAlarms());

      act(() => {
        result.current.markEmergencyNotified('em-1');
      });

      expect(result.current.wasEmergencyNotified('em-1')).toBe(true);

      act(() => {
        result.current.clearEmergencyNotification('em-1');
      });

      // Advance past cleanup timeout (10 minutes)
      act(() => {
        vi.advanceTimersByTime(600001);
      });

      expect(result.current.wasEmergencyNotified('em-1')).toBe(false);
    });
  });

  describe('muting behavior', () => {
    it('should stop alarm loop when muted', () => {
      const { result } = renderHook(() => useMapAlarms());

      act(() => {
        result.current.startAlarmLoop('warning');
      });

      const callCountBefore = mockOscillator.start.mock.calls.length;

      act(() => {
        result.current.setSoundMuted(true);
      });

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      // Should not have continued playing
      expect(mockOscillator.start.mock.calls.length).toBe(callCountBefore);
    });
  });

  describe('cleanup on unmount', () => {
    it('should stop alarm loop on unmount', () => {
      const { result, unmount } = renderHook(() => useMapAlarms());

      act(() => {
        result.current.startAlarmLoop('low');
      });

      unmount();

      const callCountAfterUnmount = mockOscillator.start.mock.calls.length;

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      // Should not have continued after unmount
      expect(mockOscillator.start.mock.calls.length).toBe(callCountAfterUnmount);
    });
  });

  describe('AudioContext error handling', () => {
    it('should handle AudioContext creation errors gracefully', () => {
      window.AudioContext = vi.fn(() => {
        throw new Error('AudioContext not allowed');
      });
      window.webkitAudioContext = window.AudioContext;

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { result } = renderHook(() => useMapAlarms());

      expect(() => {
        act(() => {
          result.current.playConflictAlarm('low');
        });
      }).not.toThrow();

      consoleSpy.mockRestore();
    });
  });
});
