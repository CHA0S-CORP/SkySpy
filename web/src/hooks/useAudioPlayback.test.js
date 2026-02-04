import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioPlayback } from './useAudioPlayback';
import { globalAudioState, notifySubscribers } from './useAudioState';

// Mock HTMLAudioElement
class MockAudio {
  constructor(src) {
    this.src = src || '';
    this.volume = 1;
    this.currentTime = 0;
    this.duration = 10;
    this.paused = true;
    this.muted = false;
    this._eventListeners = {};
  }

  play() {
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }

  addEventListener(event, handler) {
    if (!this._eventListeners[event]) {
      this._eventListeners[event] = [];
    }
    this._eventListeners[event].push(handler);
  }

  removeEventListener(event, handler) {
    if (this._eventListeners[event]) {
      this._eventListeners[event] = this._eventListeners[event].filter((h) => h !== handler);
    }
  }

  dispatchEvent(eventName, eventData = {}) {
    const handlers = this._eventListeners[eventName] || [];
    handlers.forEach((handler) => handler(eventData));
  }
}

describe('useAudioPlayback', () => {
  let originalAudio;
  let mockAudioInstances;

  beforeEach(() => {
    mockAudioInstances = [];

    // Save original Audio
    originalAudio = global.Audio;

    // Mock Audio constructor
    global.Audio = vi.fn((src) => {
      const audio = new MockAudio(src);
      mockAudioInstances.push(audio);
      return audio;
    });

    // Reset global audio state
    globalAudioState.playingId = null;
    globalAudioState.currentTransmission = null;
    globalAudioState.audioProgress = {};
    globalAudioState.audioDurations = {};
    globalAudioState.progressIntervalRef = null;
    globalAudioState.autoplay = false;
    globalAudioState.subscribers = [];
  });

  afterEach(() => {
    global.Audio = originalAudio;
    mockAudioInstances = [];

    // Clear any remaining intervals
    if (globalAudioState.progressIntervalRef) {
      clearInterval(globalAudioState.progressIntervalRef);
      globalAudioState.progressIntervalRef = null;
    }
  });

  describe('initial state', () => {
    it('should initialize with default values', () => {
      const audioRefs = {};
      const filteredTransmissionsRef = { current: [] };

      const { result } = renderHook(() =>
        useAudioPlayback({ audioRefs, filteredTransmissionsRef })
      );

      expect(result.current.playingId).toBeNull();
      expect(result.current.audioProgress).toEqual({});
      expect(result.current.audioDurations).toEqual({});
      expect(result.current.autoplay).toBe(false);
      expect(result.current.audioVolume).toBe(1);
      expect(result.current.isMuted).toBe(false);
    });

    it('should sync with global audio state', () => {
      globalAudioState.playingId = 'test-id';
      globalAudioState.autoplay = true;

      const audioRefs = {};
      const filteredTransmissionsRef = { current: [] };

      const { result } = renderHook(() =>
        useAudioPlayback({ audioRefs, filteredTransmissionsRef })
      );

      expect(result.current.playingId).toBe('test-id');
      expect(result.current.autoplay).toBe(true);
    });
  });

  describe('handlePlay', () => {
    it('should create audio element for playback', () => {
      const audioRefs = {};
      const filteredTransmissionsRef = { current: [] };

      const { result } = renderHook(() =>
        useAudioPlayback({ audioRefs, filteredTransmissionsRef })
      );

      const transmission = {
        id: 'trans-1',
        s3_url: 'https://example.com/audio.mp3',
      };

      act(() => {
        result.current.handlePlay(transmission);
      });

      expect(audioRefs['trans-1']).toBeDefined();
      expect(mockAudioInstances.length).toBe(1);
      expect(mockAudioInstances[0].src).toBe('https://example.com/audio.mp3');
    });

    it('should warn when no audio URL is available', () => {
      const audioRefs = {};
      const filteredTransmissionsRef = { current: [] };
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { result } = renderHook(() =>
        useAudioPlayback({ audioRefs, filteredTransmissionsRef })
      );

      const transmission = {
        id: 'trans-1',
        // No s3_url or audio_url
      };

      act(() => {
        result.current.handlePlay(transmission);
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith('No audio URL for transmission:', 'trans-1');
      consoleWarnSpy.mockRestore();
    });

    it('should pause if same audio is already playing', () => {
      const audioRefs = {};
      const filteredTransmissionsRef = { current: [] };

      const { result } = renderHook(() =>
        useAudioPlayback({ audioRefs, filteredTransmissionsRef })
      );

      const transmission = {
        id: 'trans-1',
        s3_url: 'https://example.com/audio.mp3',
      };

      // First play to create the audio element
      act(() => {
        result.current.handlePlay(transmission);
      });

      // Set up as playing
      globalAudioState.playingId = 'trans-1';
      mockAudioInstances[0].paused = false;

      // Play again (should toggle to pause)
      act(() => {
        result.current.handlePlay(transmission);
      });

      expect(mockAudioInstances[0].paused).toBe(true);
    });

    it('should stop previous audio when playing new one', () => {
      const audioRefs = {};
      const filteredTransmissionsRef = { current: [] };

      const { result } = renderHook(() =>
        useAudioPlayback({ audioRefs, filteredTransmissionsRef })
      );

      const transmission1 = {
        id: 'trans-1',
        s3_url: 'https://example.com/audio1.mp3',
      };
      const transmission2 = {
        id: 'trans-2',
        s3_url: 'https://example.com/audio2.mp3',
      };

      // Play first
      act(() => {
        result.current.handlePlay(transmission1);
      });

      globalAudioState.playingId = 'trans-1';
      mockAudioInstances[0].paused = false;

      // Play second
      act(() => {
        result.current.handlePlay(transmission2);
      });

      // First should be paused and reset
      expect(mockAudioInstances[0].paused).toBe(true);
      expect(mockAudioInstances[0].currentTime).toBe(0);
    });
  });

  describe('handleSeek', () => {
    it('should seek to correct position', () => {
      const audioRefs = {};
      const filteredTransmissionsRef = { current: [] };

      const { result } = renderHook(() =>
        useAudioPlayback({ audioRefs, filteredTransmissionsRef })
      );

      // Create audio element
      const transmission = {
        id: 'trans-1',
        s3_url: 'https://example.com/audio.mp3',
      };

      act(() => {
        result.current.handlePlay(transmission);
      });

      // Mock event with position at 50%
      const mockEvent = {
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, width: 100 }),
        },
        clientX: 50,
      };

      act(() => {
        result.current.handleSeek('trans-1', mockEvent);
      });

      expect(audioRefs['trans-1'].currentTime).toBe(5); // 50% of 10 second duration
    });

    it('should clamp seek position between 0 and 1', () => {
      const audioRefs = {};
      const filteredTransmissionsRef = { current: [] };

      const { result } = renderHook(() =>
        useAudioPlayback({ audioRefs, filteredTransmissionsRef })
      );

      const transmission = {
        id: 'trans-1',
        s3_url: 'https://example.com/audio.mp3',
      };

      act(() => {
        result.current.handlePlay(transmission);
      });

      // Seek beyond 100%
      const mockEvent = {
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, width: 100 }),
        },
        clientX: 150,
      };

      act(() => {
        result.current.handleSeek('trans-1', mockEvent);
      });

      expect(audioRefs['trans-1'].currentTime).toBe(10); // Clamped to 100%

      // Seek before 0%
      const mockEvent2 = {
        currentTarget: {
          getBoundingClientRect: () => ({ left: 50, width: 100 }),
        },
        clientX: 0,
      };

      act(() => {
        result.current.handleSeek('trans-1', mockEvent2);
      });

      expect(audioRefs['trans-1'].currentTime).toBe(0); // Clamped to 0%
    });
  });

  describe('volume control', () => {
    it('should toggle mute state', () => {
      const audioRefs = {};
      const filteredTransmissionsRef = { current: [] };

      const { result } = renderHook(() =>
        useAudioPlayback({ audioRefs, filteredTransmissionsRef })
      );

      const transmission = {
        id: 'trans-1',
        s3_url: 'https://example.com/audio.mp3',
      };

      act(() => {
        result.current.handlePlay(transmission);
      });

      expect(result.current.isMuted).toBe(false);

      act(() => {
        result.current.toggleMute();
      });

      expect(result.current.isMuted).toBe(true);
      expect(audioRefs['trans-1'].volume).toBe(0);

      act(() => {
        result.current.toggleMute();
      });

      expect(result.current.isMuted).toBe(false);
      expect(audioRefs['trans-1'].volume).toBe(1);
    });

    it('should change volume', () => {
      const audioRefs = {};
      const filteredTransmissionsRef = { current: [] };

      const { result } = renderHook(() =>
        useAudioPlayback({ audioRefs, filteredTransmissionsRef })
      );

      const transmission = {
        id: 'trans-1',
        s3_url: 'https://example.com/audio.mp3',
      };

      act(() => {
        result.current.handlePlay(transmission);
      });

      act(() => {
        result.current.handleVolumeChange(0.5);
      });

      expect(result.current.audioVolume).toBe(0.5);
      expect(audioRefs['trans-1'].volume).toBe(0.5);
    });

    it('should not change audio volume when muted', () => {
      const audioRefs = {};
      const filteredTransmissionsRef = { current: [] };

      const { result } = renderHook(() =>
        useAudioPlayback({ audioRefs, filteredTransmissionsRef })
      );

      const transmission = {
        id: 'trans-1',
        s3_url: 'https://example.com/audio.mp3',
      };

      act(() => {
        result.current.handlePlay(transmission);
      });

      // Mute first
      act(() => {
        result.current.toggleMute();
      });

      expect(audioRefs['trans-1'].volume).toBe(0);

      // Change volume while muted
      act(() => {
        result.current.handleVolumeChange(0.5);
      });

      // Audio should remain at 0 while muted
      expect(audioRefs['trans-1'].volume).toBe(0);
      // But audioVolume state should update
      expect(result.current.audioVolume).toBe(0.5);
    });
  });

  describe('autoplay toggle', () => {
    it('should toggle autoplay state', () => {
      const audioRefs = {};
      const filteredTransmissionsRef = { current: [] };

      const { result } = renderHook(() =>
        useAudioPlayback({ audioRefs, filteredTransmissionsRef })
      );

      expect(result.current.autoplay).toBe(false);

      act(() => {
        result.current.handleToggleAutoplay([], []);
      });

      expect(result.current.autoplay).toBe(true);

      act(() => {
        result.current.handleToggleAutoplay([], []);
      });

      expect(result.current.autoplay).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should clean up on unmount', () => {
      const audioRefs = {};
      const filteredTransmissionsRef = { current: [] };

      const { unmount } = renderHook(() =>
        useAudioPlayback({ audioRefs, filteredTransmissionsRef })
      );

      // Unmount should clean up
      unmount();

      // Progress interval should be cleared (or was never set)
      expect(globalAudioState.progressIntervalRef).toBeNull();
    });
  });

  describe('global state subscription', () => {
    it('should respond to global state changes', () => {
      const audioRefs = {};
      const filteredTransmissionsRef = { current: [] };

      const { result } = renderHook(() =>
        useAudioPlayback({ audioRefs, filteredTransmissionsRef })
      );

      expect(result.current.playingId).toBeNull();

      // Simulate global state update
      act(() => {
        notifySubscribers({ playingId: 'new-id' });
      });

      expect(result.current.playingId).toBe('new-id');
    });
  });
});
