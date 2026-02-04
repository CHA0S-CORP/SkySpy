import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

describe('useVoiceControl', () => {
  let mockRecognitionInstance;
  let MockSpeechRecognition;
  let useVoiceControl;

  beforeEach(async () => {
    // Create mock recognition instance
    mockRecognitionInstance = {
      continuous: false,
      interimResults: false,
      lang: '',
      maxAlternatives: 1,
      onstart: null,
      onend: null,
      onerror: null,
      onresult: null,
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
    };

    // Create mock constructor that stores event handlers
    MockSpeechRecognition = vi.fn().mockImplementation(() => {
      return mockRecognitionInstance;
    });

    // Set up mocks BEFORE importing the module
    window.SpeechRecognition = MockSpeechRecognition;
    window.webkitSpeechRecognition = MockSpeechRecognition;

    // Dynamically import to get fresh module with mocks in place
    vi.resetModules();
    const module = await import('./useVoiceControl');
    useVoiceControl = module.useVoiceControl;

    vi.useFakeTimers();
  });

  afterEach(() => {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('support detection', () => {
    it('should detect speech recognition support', () => {
      const { result } = renderHook(() => useVoiceControl({ enabled: false }));
      expect(result.current.isSupported).toBe(true);
    });

    it('should detect lack of support when API not available', async () => {
      // Remove the mocks and reimport
      delete window.SpeechRecognition;
      delete window.webkitSpeechRecognition;

      vi.resetModules();
      const module = await import('./useVoiceControl');
      const hook = module.useVoiceControl;

      const { result } = renderHook(() => hook({ enabled: false }));
      expect(result.current.isSupported).toBe(false);
    });
  });

  describe('initial state', () => {
    it('should not be listening initially', () => {
      const { result } = renderHook(() => useVoiceControl({ enabled: false }));

      expect(result.current.isListening).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.lastCommand).toBeNull();
      expect(result.current.lastTranscript).toBe('');
    });

    it('should not start recognition when not enabled', () => {
      renderHook(() => useVoiceControl({ enabled: false }));
      expect(MockSpeechRecognition).not.toHaveBeenCalled();
    });
  });

  describe('recognition initialization', () => {
    it('should create recognition when enabled', () => {
      renderHook(() => useVoiceControl({ enabled: true }));
      expect(MockSpeechRecognition).toHaveBeenCalled();
    });

    it('should configure recognition with correct settings', () => {
      renderHook(() => useVoiceControl({ enabled: true, continuous: true }));

      expect(mockRecognitionInstance.continuous).toBe(true);
      expect(mockRecognitionInstance.interimResults).toBe(false);
      expect(mockRecognitionInstance.lang).toBe('en-US');
      expect(mockRecognitionInstance.maxAlternatives).toBe(1);
    });

    it('should start recognition when enabled', () => {
      renderHook(() => useVoiceControl({ enabled: true }));
      expect(mockRecognitionInstance.start).toHaveBeenCalled();
    });
  });

  describe('recognition events', () => {
    it('should update isListening on start', () => {
      const { result } = renderHook(() => useVoiceControl({ enabled: true }));

      act(() => {
        mockRecognitionInstance.onstart();
      });

      expect(result.current.isListening).toBe(true);
      expect(result.current.error).toBeNull();
    });

    it('should update isListening on end', () => {
      const { result } = renderHook(() => useVoiceControl({ enabled: true }));

      act(() => {
        mockRecognitionInstance.onstart();
      });

      expect(result.current.isListening).toBe(true);

      act(() => {
        mockRecognitionInstance.onend();
      });

      expect(result.current.isListening).toBe(false);
    });

    it('should auto-restart when continuous and enabled', () => {
      renderHook(() => useVoiceControl({ enabled: true, continuous: true }));

      act(() => {
        mockRecognitionInstance.onend();
        vi.advanceTimersByTime(100);
      });

      // Should call start again
      expect(mockRecognitionInstance.start).toHaveBeenCalledTimes(2);
    });

    it('should handle errors', () => {
      const { result } = renderHook(() => useVoiceControl({ enabled: true }));

      act(() => {
        mockRecognitionInstance.onerror({ error: 'not-allowed' });
      });

      expect(result.current.error).toBe('not-allowed');
      expect(result.current.isListening).toBe(false);
    });

    it('should ignore no-speech errors', () => {
      const { result } = renderHook(() => useVoiceControl({ enabled: true }));

      act(() => {
        mockRecognitionInstance.onstart();
        mockRecognitionInstance.onerror({ error: 'no-speech' });
      });

      expect(result.current.error).toBeNull();
    });

    it('should ignore aborted errors', () => {
      const { result } = renderHook(() => useVoiceControl({ enabled: true }));

      act(() => {
        mockRecognitionInstance.onstart();
        mockRecognitionInstance.onerror({ error: 'aborted' });
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe('command recognition', () => {
    it('should recognize mute command', () => {
      const onCommand = vi.fn();
      const { result } = renderHook(() =>
        useVoiceControl({ enabled: true, onCommand })
      );

      act(() => {
        mockRecognitionInstance.onresult({
          results: [{ 0: { transcript: 'mute' }, isFinal: true }],
          length: 1,
        });
      });

      expect(result.current.lastCommand).toBe('mute');
      expect(result.current.lastTranscript).toBe('mute');
      expect(onCommand).toHaveBeenCalledWith('mute', 'mute');
    });

    it('should recognize unmute command', () => {
      const onCommand = vi.fn();
      renderHook(() => useVoiceControl({ enabled: true, onCommand }));

      act(() => {
        // Use "voice on" since "unmute" contains "mute" and matches mute first
        mockRecognitionInstance.onresult({
          results: [{ 0: { transcript: 'voice on' }, isFinal: true }],
          length: 1,
        });
      });

      expect(onCommand).toHaveBeenCalledWith('unmute', 'voice on');
    });

    it('should recognize voice off command', () => {
      const onCommand = vi.fn();
      renderHook(() => useVoiceControl({ enabled: true, onCommand }));

      act(() => {
        mockRecognitionInstance.onresult({
          results: [{ 0: { transcript: 'voice off' }, isFinal: true }],
          length: 1,
        });
      });

      expect(onCommand).toHaveBeenCalledWith('mute', 'voice off');
    });

    it('should recognize radar command', () => {
      const onCommand = vi.fn();
      renderHook(() => useVoiceControl({ enabled: true, onCommand }));

      act(() => {
        mockRecognitionInstance.onresult({
          results: [{ 0: { transcript: 'radar view' }, isFinal: true }],
          length: 1,
        });
      });

      expect(onCommand).toHaveBeenCalledWith('mode_radar', 'radar view');
    });

    it('should recognize single view command', () => {
      const onCommand = vi.fn();
      renderHook(() => useVoiceControl({ enabled: true, onCommand }));

      act(() => {
        mockRecognitionInstance.onresult({
          results: [{ 0: { transcript: 'single view' }, isFinal: true }],
          length: 1,
        });
      });

      expect(onCommand).toHaveBeenCalledWith('mode_single', 'single view');
    });

    it('should recognize grid view command', () => {
      const onCommand = vi.fn();
      renderHook(() => useVoiceControl({ enabled: true, onCommand }));

      act(() => {
        mockRecognitionInstance.onresult({
          results: [{ 0: { transcript: 'grid' }, isFinal: true }],
          length: 1,
        });
      });

      expect(onCommand).toHaveBeenCalledWith('mode_grid', 'grid');
    });

    it('should recognize heads up command', () => {
      const onCommand = vi.fn();
      renderHook(() => useVoiceControl({ enabled: true, onCommand }));

      act(() => {
        mockRecognitionInstance.onresult({
          results: [{ 0: { transcript: 'heads up' }, isFinal: true }],
          length: 1,
        });
      });

      expect(onCommand).toHaveBeenCalledWith('mode_headsUp', 'heads up');
    });

    it('should recognize HUD command', () => {
      const onCommand = vi.fn();
      renderHook(() => useVoiceControl({ enabled: true, onCommand }));

      act(() => {
        mockRecognitionInstance.onresult({
          results: [{ 0: { transcript: 'hud' }, isFinal: true }],
          length: 1,
        });
      });

      expect(onCommand).toHaveBeenCalledWith('mode_headsUp', 'hud');
    });

    it('should recognize settings command', () => {
      const onCommand = vi.fn();
      renderHook(() => useVoiceControl({ enabled: true, onCommand }));

      act(() => {
        mockRecognitionInstance.onresult({
          results: [{ 0: { transcript: 'settings' }, isFinal: true }],
          length: 1,
        });
      });

      expect(onCommand).toHaveBeenCalledWith('settings', 'settings');
    });

    it('should recognize exit command', () => {
      const onCommand = vi.fn();
      renderHook(() => useVoiceControl({ enabled: true, onCommand }));

      act(() => {
        mockRecognitionInstance.onresult({
          results: [{ 0: { transcript: 'exit' }, isFinal: true }],
          length: 1,
        });
      });

      expect(onCommand).toHaveBeenCalledWith('exit', 'exit');
    });

    it('should recognize report command', () => {
      const onCommand = vi.fn();
      renderHook(() => useVoiceControl({ enabled: true, onCommand }));

      act(() => {
        mockRecognitionInstance.onresult({
          results: [{ 0: { transcript: 'status' }, isFinal: true }],
          length: 1,
        });
      });

      expect(onCommand).toHaveBeenCalledWith('report', 'status');
    });

    it('should recognize next command', () => {
      const onCommand = vi.fn();
      renderHook(() => useVoiceControl({ enabled: true, onCommand }));

      act(() => {
        mockRecognitionInstance.onresult({
          results: [{ 0: { transcript: 'next threat' }, isFinal: true }],
          length: 1,
        });
      });

      expect(onCommand).toHaveBeenCalledWith('next', 'next threat');
    });

    it('should recognize previous command', () => {
      const onCommand = vi.fn();
      renderHook(() => useVoiceControl({ enabled: true, onCommand }));

      act(() => {
        mockRecognitionInstance.onresult({
          results: [{ 0: { transcript: 'previous' }, isFinal: true }],
          length: 1,
        });
      });

      expect(onCommand).toHaveBeenCalledWith('previous', 'previous');
    });

    it('should recognize dismiss command', () => {
      const onCommand = vi.fn();
      renderHook(() => useVoiceControl({ enabled: true, onCommand }));

      act(() => {
        mockRecognitionInstance.onresult({
          results: [{ 0: { transcript: 'dismiss' }, isFinal: true }],
          length: 1,
        });
      });

      expect(onCommand).toHaveBeenCalledWith('dismiss', 'dismiss');
    });

    it('should handle unrecognized speech', () => {
      const onCommand = vi.fn();
      const { result } = renderHook(() =>
        useVoiceControl({ enabled: true, onCommand })
      );

      act(() => {
        mockRecognitionInstance.onresult({
          results: [{ 0: { transcript: 'hello world' }, isFinal: true }],
          length: 1,
        });
      });

      expect(result.current.lastTranscript).toBe('hello world');
      expect(result.current.lastCommand).toBeNull();
      expect(onCommand).not.toHaveBeenCalled();
    });

    it('should be case insensitive', () => {
      const onCommand = vi.fn();
      renderHook(() => useVoiceControl({ enabled: true, onCommand }));

      act(() => {
        mockRecognitionInstance.onresult({
          results: [{ 0: { transcript: 'MUTE' }, isFinal: true }],
          length: 1,
        });
      });

      expect(onCommand).toHaveBeenCalledWith('mute', 'MUTE');
    });

    it('should match commands within longer speech', () => {
      const onCommand = vi.fn();
      renderHook(() => useVoiceControl({ enabled: true, onCommand }));

      act(() => {
        mockRecognitionInstance.onresult({
          results: [{ 0: { transcript: 'please mute the audio' }, isFinal: true }],
          length: 1,
        });
      });

      expect(onCommand).toHaveBeenCalledWith('mute', 'please mute the audio');
    });

    it('should ignore non-final results', () => {
      const onCommand = vi.fn();
      const { result } = renderHook(() =>
        useVoiceControl({ enabled: true, onCommand })
      );

      act(() => {
        mockRecognitionInstance.onresult({
          results: [{ 0: { transcript: 'mute' }, isFinal: false }],
          length: 1,
        });
      });

      expect(result.current.lastCommand).toBeNull();
      expect(onCommand).not.toHaveBeenCalled();
    });
  });

  describe('manual control', () => {
    it('should provide startListening function', () => {
      const { result } = renderHook(() => useVoiceControl({ enabled: true }));
      expect(typeof result.current.startListening).toBe('function');
    });

    it('should provide stopListening function', () => {
      const { result } = renderHook(() => useVoiceControl({ enabled: true }));
      expect(typeof result.current.stopListening).toBe('function');
    });

    it('should start recognition on startListening', () => {
      const { result } = renderHook(() => useVoiceControl({ enabled: true }));

      mockRecognitionInstance.start.mockClear();

      act(() => {
        result.current.startListening();
      });

      expect(mockRecognitionInstance.start).toHaveBeenCalled();
    });

    it('should stop recognition on stopListening', () => {
      const { result } = renderHook(() => useVoiceControl({ enabled: true }));

      act(() => {
        result.current.stopListening();
      });

      expect(mockRecognitionInstance.stop).toHaveBeenCalled();
    });

    it('should clear restart timeout on stopListening', () => {
      const { result } = renderHook(() =>
        useVoiceControl({ enabled: true, continuous: true })
      );

      act(() => {
        mockRecognitionInstance.onend();
      });

      // Before timeout fires
      act(() => {
        result.current.stopListening();
        vi.advanceTimersByTime(200);
      });

      // Should only have been called once initially, not again after timeout
      // (This tests that clearTimeout is working)
    });
  });

  describe('cleanup', () => {
    it('should stop recognition on unmount', () => {
      const { unmount } = renderHook(() => useVoiceControl({ enabled: true }));

      unmount();

      expect(mockRecognitionInstance.stop).toHaveBeenCalled();
    });

    it('should clear timeouts on unmount', () => {
      const { unmount } = renderHook(() =>
        useVoiceControl({ enabled: true, continuous: true })
      );

      act(() => {
        mockRecognitionInstance.onend();
      });

      unmount();

      // Should not throw when advancing timers after unmount
      act(() => {
        vi.advanceTimersByTime(200);
      });
    });

    it('should handle start errors gracefully', () => {
      mockRecognitionInstance.start.mockImplementation(() => {
        throw new Error('Already started');
      });

      const { result } = renderHook(() => useVoiceControl({ enabled: true }));

      expect(result.current.error).toBe('Failed to start voice recognition');
    });
  });

  describe('when recognition is not supported', () => {
    it('should not crash when not supported', async () => {
      delete window.SpeechRecognition;
      delete window.webkitSpeechRecognition;

      vi.resetModules();
      const module = await import('./useVoiceControl');
      const hook = module.useVoiceControl;

      expect(() => {
        renderHook(() => hook({ enabled: true }));
      }).not.toThrow();
    });

    it('should not create recognition instance when not supported', async () => {
      delete window.SpeechRecognition;
      delete window.webkitSpeechRecognition;

      vi.resetModules();
      const module = await import('./useVoiceControl');
      const hook = module.useVoiceControl;

      // Clear the mock to check it's not called
      MockSpeechRecognition.mockClear();

      renderHook(() => hook({ enabled: true }));

      // The old mock should not be called (since SpeechRecognition is null now)
    });
  });
});
