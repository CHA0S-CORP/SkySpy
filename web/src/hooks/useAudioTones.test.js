import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// We need to mock the module before importing
let mockAudioContext;
let mockOscillator;
let mockGainNode;

// Reset mocks and re-import for each test
describe('useAudioTones', () => {
  beforeEach(async () => {
    vi.useFakeTimers();

    // Mock oscillator
    mockOscillator = {
      type: 'sine',
      frequency: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        value: 440,
      },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    };

    // Mock gain node
    mockGainNode = {
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        value: 1,
      },
      connect: vi.fn(),
    };

    // Mock audio context
    mockAudioContext = {
      state: 'running',
      currentTime: 0,
      destination: {},
      createOscillator: vi.fn(() => ({ ...mockOscillator })),
      createGain: vi.fn(() => ({ ...mockGainNode })),
      resume: vi.fn().mockResolvedValue(undefined),
    };

    // Mock AudioContext constructor
    window.AudioContext = vi.fn(() => mockAudioContext);
    window.webkitAudioContext = vi.fn(() => mockAudioContext);

    // Reset the module to clear the singleton
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should start with isReady false', async () => {
      const { useAudioTones } = await import('./useAudioTones');
      const { result } = renderHook(() => useAudioTones({ enabled: true }));

      expect(result.current.isReady).toBe(false);
    });

    it('should initialize audio context on initialize call', async () => {
      const { useAudioTones } = await import('./useAudioTones');
      const { result } = renderHook(() => useAudioTones({ enabled: true }));

      await act(async () => {
        result.current.initialize();
      });

      expect(result.current.isReady).toBe(true);
    });

    it('should resume suspended audio context', async () => {
      mockAudioContext.state = 'suspended';
      window.AudioContext = vi.fn(() => mockAudioContext);

      const { useAudioTones } = await import('./useAudioTones');
      const { result } = renderHook(() => useAudioTones({ enabled: true }));

      await act(async () => {
        result.current.initialize();
        await vi.runAllTimersAsync();
      });

      expect(mockAudioContext.resume).toHaveBeenCalled();
    });

    it('should list available tones', async () => {
      const { useAudioTones } = await import('./useAudioTones');
      const { result } = renderHook(() => useAudioTones({ enabled: true }));

      expect(result.current.tones).toContain('info');
      expect(result.current.tones).toContain('warning');
      expect(result.current.tones).toContain('critical');
      expect(result.current.tones).toContain('newThreat');
      expect(result.current.tones).toContain('clear');
      expect(result.current.tones).toContain('approaching');
      expect(result.current.tones).toContain('departing');
      expect(result.current.tones).toContain('error');
      expect(result.current.tones).toContain('tick');
      expect(result.current.tones).toContain('etaWarning');
    });
  });

  describe('play function', () => {
    it('should create oscillator and gain nodes when playing a tone', async () => {
      const { useAudioTones } = await import('./useAudioTones');
      const { result } = renderHook(() => useAudioTones({ enabled: true }));

      await act(async () => {
        result.current.initialize();
      });

      act(() => {
        result.current.play('info');
      });

      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
      expect(mockAudioContext.createGain).toHaveBeenCalled();
    });

    it('should not play when disabled', async () => {
      const { useAudioTones } = await import('./useAudioTones');
      const { result } = renderHook(() => useAudioTones({ enabled: false }));

      act(() => {
        result.current.play('info');
      });

      expect(mockAudioContext.createOscillator).not.toHaveBeenCalled();
    });

    it('should warn for unknown tone', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { useAudioTones } = await import('./useAudioTones');
      const { result } = renderHook(() => useAudioTones({ enabled: true }));

      await act(async () => {
        result.current.initialize();
      });

      act(() => {
        result.current.play('unknownTone');
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith('Unknown tone: unknownTone');

      consoleWarnSpy.mockRestore();
    });

    it('should throttle rapid plays', async () => {
      const { useAudioTones } = await import('./useAudioTones');
      const { result } = renderHook(() => useAudioTones({ enabled: true }));

      await act(async () => {
        result.current.initialize();
      });

      act(() => {
        result.current.play('info');
      });

      const firstCallCount = mockAudioContext.createOscillator.mock.calls.length;

      act(() => {
        result.current.play('info');
        result.current.play('info');
      });

      // Should only have the first call due to throttling
      expect(mockAudioContext.createOscillator).toHaveBeenCalledTimes(firstCallCount);
    });

    it('should allow play after throttle interval', async () => {
      const { useAudioTones } = await import('./useAudioTones');
      const { result } = renderHook(() => useAudioTones({ enabled: true }));

      await act(async () => {
        result.current.initialize();
      });

      act(() => {
        result.current.play('info');
      });

      const firstCallCount = mockAudioContext.createOscillator.mock.calls.length;

      // Advance past throttle interval (200ms)
      act(() => {
        vi.advanceTimersByTime(250);
      });

      act(() => {
        result.current.play('info');
      });

      expect(mockAudioContext.createOscillator.mock.calls.length).toBeGreaterThan(firstCallCount);
    });
  });

  describe('convenience methods', () => {
    it('should have playInfo method', async () => {
      const { useAudioTones } = await import('./useAudioTones');
      const { result } = renderHook(() => useAudioTones({ enabled: true }));

      await act(async () => {
        result.current.initialize();
      });

      act(() => {
        result.current.playInfo();
      });

      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    });

    it('should have playWarning method', async () => {
      const { useAudioTones } = await import('./useAudioTones');
      const { result } = renderHook(() => useAudioTones({ enabled: true }));

      await act(async () => {
        result.current.initialize();
      });

      await act(async () => {
        result.current.playWarning();
        await vi.runAllTimersAsync();
      });

      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    });

    it('should have playCritical method', async () => {
      const { useAudioTones } = await import('./useAudioTones');
      const { result } = renderHook(() => useAudioTones({ enabled: true }));

      await act(async () => {
        result.current.initialize();
      });

      await act(async () => {
        result.current.playCritical();
        await vi.runAllTimersAsync();
      });

      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    });

    it('should have playNewThreat method', async () => {
      const { useAudioTones } = await import('./useAudioTones');
      const { result } = renderHook(() => useAudioTones({ enabled: true }));

      await act(async () => {
        result.current.initialize();
      });

      act(() => {
        result.current.playNewThreat();
      });

      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    });

    it('should have playClear method', async () => {
      const { useAudioTones } = await import('./useAudioTones');
      const { result } = renderHook(() => useAudioTones({ enabled: true }));

      await act(async () => {
        result.current.initialize();
      });

      await act(async () => {
        result.current.playClear();
        await vi.runAllTimersAsync();
      });

      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    });

    it('should have playApproaching method', async () => {
      const { useAudioTones } = await import('./useAudioTones');
      const { result } = renderHook(() => useAudioTones({ enabled: true }));

      await act(async () => {
        result.current.initialize();
      });

      act(() => {
        result.current.playApproaching();
      });

      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    });

    it('should have playDeparting method', async () => {
      const { useAudioTones } = await import('./useAudioTones');
      const { result } = renderHook(() => useAudioTones({ enabled: true }));

      await act(async () => {
        result.current.initialize();
      });

      act(() => {
        result.current.playDeparting();
      });

      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    });

    it('should have playError method', async () => {
      const { useAudioTones } = await import('./useAudioTones');
      const { result } = renderHook(() => useAudioTones({ enabled: true }));

      await act(async () => {
        result.current.initialize();
      });

      await act(async () => {
        result.current.playError();
        await vi.runAllTimersAsync();
      });

      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    });

    it('should have playTick method', async () => {
      const { useAudioTones } = await import('./useAudioTones');
      const { result } = renderHook(() => useAudioTones({ enabled: true }));

      await act(async () => {
        result.current.initialize();
      });

      act(() => {
        result.current.playTick();
      });

      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    });

    it('should have playEtaWarning method', async () => {
      const { useAudioTones } = await import('./useAudioTones');
      const { result } = renderHook(() => useAudioTones({ enabled: true }));

      await act(async () => {
        result.current.initialize();
      });

      await act(async () => {
        result.current.playEtaWarning();
        await vi.runAllTimersAsync();
      });

      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    });
  });

  describe('playForThreatLevel', () => {
    it('should play critical tone for critical level', async () => {
      const { useAudioTones } = await import('./useAudioTones');
      const { result } = renderHook(() => useAudioTones({ enabled: true }));

      await act(async () => {
        result.current.initialize();
      });

      await act(async () => {
        result.current.playForThreatLevel('critical');
        await vi.runAllTimersAsync();
      });

      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    });

    it('should play warning tone for warning level', async () => {
      const { useAudioTones } = await import('./useAudioTones');
      const { result } = renderHook(() => useAudioTones({ enabled: true }));

      await act(async () => {
        result.current.initialize();
      });

      await act(async () => {
        result.current.playForThreatLevel('warning');
        await vi.runAllTimersAsync();
      });

      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    });

    it('should play info tone for other levels', async () => {
      const { useAudioTones } = await import('./useAudioTones');
      const { result } = renderHook(() => useAudioTones({ enabled: true }));

      await act(async () => {
        result.current.initialize();
      });

      act(() => {
        result.current.playForThreatLevel('info');
      });

      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
    });
  });

  describe('stop function', () => {
    it('should stop all active oscillators', async () => {
      const stoppedOscillators = [];
      mockAudioContext.createOscillator = vi.fn(() => {
        const osc = {
          ...mockOscillator,
          stop: vi.fn(() => stoppedOscillators.push(osc)),
        };
        return osc;
      });

      const { useAudioTones } = await import('./useAudioTones');
      const { result } = renderHook(() => useAudioTones({ enabled: true }));

      await act(async () => {
        result.current.initialize();
      });

      act(() => {
        result.current.play('info');
      });

      act(() => {
        result.current.stop();
      });

      // The stop function should be called
      expect(stoppedOscillators.length).toBeGreaterThan(0);
    });
  });

  describe('volume control', () => {
    it('should apply global volume multiplier', async () => {
      const { useAudioTones } = await import('./useAudioTones');
      const { result } = renderHook(() => useAudioTones({ enabled: true, volume: 0.5 }));

      await act(async () => {
        result.current.initialize();
      });

      act(() => {
        result.current.play('info');
      });

      // Verify gain node was created (volume control)
      expect(mockAudioContext.createGain).toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('should call stop on unmount', async () => {
      const stoppedOscillators = [];
      mockAudioContext.createOscillator = vi.fn(() => {
        const osc = {
          ...mockOscillator,
          stop: vi.fn(() => stoppedOscillators.push(osc)),
        };
        return osc;
      });

      const { useAudioTones } = await import('./useAudioTones');
      const { result, unmount } = renderHook(() => useAudioTones({ enabled: true }));

      await act(async () => {
        result.current.initialize();
      });

      act(() => {
        result.current.play('info');
      });

      unmount();

      // Stop should have been called during cleanup
      expect(stoppedOscillators.length).toBeGreaterThan(0);
    });
  });

  describe('audio context fallback', () => {
    it('should use webkitAudioContext as fallback', async () => {
      // Remove standard AudioContext
      const originalAudioContext = window.AudioContext;
      window.AudioContext = undefined;

      const { useAudioTones } = await import('./useAudioTones');
      const { result } = renderHook(() => useAudioTones({ enabled: true }));

      await act(async () => {
        result.current.initialize();
      });

      expect(window.webkitAudioContext).toHaveBeenCalled();

      // Restore
      window.AudioContext = originalAudioContext;
    });
  });
});
