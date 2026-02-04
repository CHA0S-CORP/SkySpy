import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioKeyboard } from './useAudioKeyboard';

// Mock the AudioView imports
vi.mock('../components/views/AudioView', () => ({
  getGlobalAudioState: vi.fn(() => ({
    playingId: null,
    audioRefs: {},
    autoplay: false,
    recentTransmissions: [],
    subscribers: [],
    progressIntervalRef: null,
    currentTransmission: null,
    audioDurations: {},
    audioProgress: {},
  })),
  setAutoplay: vi.fn(),
}));

import { getGlobalAudioState, setAutoplay } from '../components/views/AudioView';

describe('useAudioKeyboard', () => {
  let mockAudio;
  let addEventListenerSpy;
  let removeEventListenerSpy;

  beforeEach(() => {
    // Mock audio element
    mockAudio = {
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      currentTime: 5,
      duration: 10,
      volume: 1,
      muted: false,
      paused: false,
    };

    // Reset mocks
    vi.clearAllMocks();

    // Set up window event listener spies
    addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
  });

  afterEach(() => {
    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
  });

  describe('keyboard event listener', () => {
    it('should add keydown listener on mount', () => {
      renderHook(() => useAudioKeyboard());

      expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    });

    it('should remove keydown listener on unmount', () => {
      const { unmount } = renderHook(() => useAudioKeyboard());

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    });

    it('should not add listener when disabled', () => {
      renderHook(() => useAudioKeyboard({ enabled: false }));

      expect(addEventListenerSpy).not.toHaveBeenCalled();
    });
  });

  describe('space bar - play/pause', () => {
    it('should toggle play/pause on space key', () => {
      getGlobalAudioState.mockReturnValue({
        playingId: 'test-id',
        audioRefs: { 'test-id': mockAudio },
        autoplay: false,
        recentTransmissions: [],
        subscribers: [],
      });

      const { result } = renderHook(() => useAudioKeyboard());

      // Get the keydown handler
      const keydownHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'keydown'
      )?.[1];

      expect(keydownHandler).toBeDefined();

      // Simulate space key press
      const event = {
        key: ' ',
        preventDefault: vi.fn(),
        target: document.body,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      };

      act(() => {
        keydownHandler(event);
      });

      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockAudio.pause).toHaveBeenCalled();
    });

    it('should not handle space when no active playback', () => {
      getGlobalAudioState.mockReturnValue({
        playingId: null,
        audioRefs: {},
        autoplay: false,
        recentTransmissions: [],
        subscribers: [],
      });

      renderHook(() => useAudioKeyboard());

      const keydownHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'keydown'
      )?.[1];

      const event = {
        key: ' ',
        preventDefault: vi.fn(),
        target: document.body,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      };

      act(() => {
        keydownHandler(event);
      });

      // Should not call preventDefault when no active playback
      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('m key - mute toggle', () => {
    it('should toggle mute on m key', () => {
      getGlobalAudioState.mockReturnValue({
        playingId: 'test-id',
        audioRefs: { 'test-id': mockAudio },
        autoplay: false,
        recentTransmissions: [],
        subscribers: [],
      });

      renderHook(() => useAudioKeyboard());

      const keydownHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'keydown'
      )?.[1];

      const event = {
        key: 'm',
        preventDefault: vi.fn(),
        target: document.body,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      };

      act(() => {
        keydownHandler(event);
      });

      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockAudio.muted).toBe(true);
    });
  });

  describe('a key - autoplay toggle', () => {
    it('should toggle autoplay on a key', () => {
      getGlobalAudioState.mockReturnValue({
        playingId: null,
        audioRefs: {},
        autoplay: false,
        recentTransmissions: [],
        subscribers: [],
      });

      renderHook(() => useAudioKeyboard());

      const keydownHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'keydown'
      )?.[1];

      const event = {
        key: 'a',
        preventDefault: vi.fn(),
        target: document.body,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      };

      act(() => {
        keydownHandler(event);
      });

      expect(event.preventDefault).toHaveBeenCalled();
      expect(setAutoplay).toHaveBeenCalledWith(true);
    });
  });

  describe('arrow keys - seek', () => {
    it('should seek forward on right arrow', () => {
      getGlobalAudioState.mockReturnValue({
        playingId: 'test-id',
        audioRefs: { 'test-id': mockAudio },
        autoplay: false,
        recentTransmissions: [],
        subscribers: [],
      });

      renderHook(() => useAudioKeyboard());

      const keydownHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'keydown'
      )?.[1];

      const event = {
        key: 'ArrowRight',
        preventDefault: vi.fn(),
        target: document.body,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      };

      act(() => {
        keydownHandler(event);
      });

      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockAudio.currentTime).toBe(10); // 5 + 5, clamped to duration
    });

    it('should seek backward on left arrow', () => {
      getGlobalAudioState.mockReturnValue({
        playingId: 'test-id',
        audioRefs: { 'test-id': mockAudio },
        autoplay: false,
        recentTransmissions: [],
        subscribers: [],
      });

      renderHook(() => useAudioKeyboard());

      const keydownHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'keydown'
      )?.[1];

      const event = {
        key: 'ArrowLeft',
        preventDefault: vi.fn(),
        target: document.body,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      };

      act(() => {
        keydownHandler(event);
      });

      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockAudio.currentTime).toBe(0); // 5 - 5
    });
  });

  describe('arrow keys - volume', () => {
    it('should increase volume on up arrow', () => {
      mockAudio.volume = 0.5;
      getGlobalAudioState.mockReturnValue({
        playingId: 'test-id',
        audioRefs: { 'test-id': mockAudio },
        autoplay: false,
        recentTransmissions: [],
        subscribers: [],
      });

      renderHook(() => useAudioKeyboard());

      const keydownHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'keydown'
      )?.[1];

      const event = {
        key: 'ArrowUp',
        preventDefault: vi.fn(),
        target: document.body,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      };

      act(() => {
        keydownHandler(event);
      });

      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockAudio.volume).toBeCloseTo(0.6);
    });

    it('should decrease volume on down arrow', () => {
      mockAudio.volume = 0.5;
      getGlobalAudioState.mockReturnValue({
        playingId: 'test-id',
        audioRefs: { 'test-id': mockAudio },
        autoplay: false,
        recentTransmissions: [],
        subscribers: [],
      });

      renderHook(() => useAudioKeyboard());

      const keydownHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'keydown'
      )?.[1];

      const event = {
        key: 'ArrowDown',
        preventDefault: vi.fn(),
        target: document.body,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      };

      act(() => {
        keydownHandler(event);
      });

      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockAudio.volume).toBeCloseTo(0.4);
    });

    it('should clamp volume between 0 and 1', () => {
      mockAudio.volume = 0.95;
      getGlobalAudioState.mockReturnValue({
        playingId: 'test-id',
        audioRefs: { 'test-id': mockAudio },
        autoplay: false,
        recentTransmissions: [],
        subscribers: [],
      });

      renderHook(() => useAudioKeyboard());

      const keydownHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'keydown'
      )?.[1];

      const event = {
        key: 'ArrowUp',
        preventDefault: vi.fn(),
        target: document.body,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      };

      act(() => {
        keydownHandler(event);
      });

      expect(mockAudio.volume).toBe(1); // Clamped to 1
    });
  });

  describe('escape key - stop', () => {
    it('should stop playback on escape', () => {
      const mockSubscribers = [vi.fn()];
      getGlobalAudioState.mockReturnValue({
        playingId: 'test-id',
        audioRefs: { 'test-id': mockAudio },
        autoplay: true,
        recentTransmissions: [],
        subscribers: mockSubscribers,
        currentTransmission: { id: 'test-id' },
      });

      renderHook(() => useAudioKeyboard());

      const keydownHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'keydown'
      )?.[1];

      const event = {
        key: 'Escape',
        preventDefault: vi.fn(),
        target: document.body,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      };

      act(() => {
        keydownHandler(event);
      });

      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockAudio.pause).toHaveBeenCalled();
      expect(mockAudio.currentTime).toBe(0);
      expect(setAutoplay).toHaveBeenCalledWith(false);
    });
  });

  describe('n key - next track', () => {
    it('should skip to next transmission on n key', async () => {
      const mockAudio2 = {
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
        currentTime: 0,
        duration: 10,
        volume: 1,
        muted: false,
        paused: true,
        addEventListener: vi.fn(),
      };

      const mockSubscribers = [vi.fn()];
      const audioRefs = {
        'current-id': mockAudio,
      };

      getGlobalAudioState.mockReturnValue({
        playingId: 'current-id',
        audioRefs,
        autoplay: true,
        recentTransmissions: [
          { id: 'current-id', s3_url: 'https://example.com/1.mp3' },
          { id: 'next-id', s3_url: 'https://example.com/2.mp3' },
        ],
        subscribers: mockSubscribers,
        currentTransmission: { id: 'current-id' },
        audioDurations: {},
        audioProgress: {},
        progressIntervalRef: null,
      });

      // Mock Audio constructor for new audio element
      global.Audio = vi.fn(() => mockAudio2);

      renderHook(() => useAudioKeyboard());

      const keydownHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'keydown'
      )?.[1];

      const event = {
        key: 'n',
        preventDefault: vi.fn(),
        target: document.body,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      };

      await act(async () => {
        keydownHandler(event);
      });

      expect(event.preventDefault).toHaveBeenCalled();
    });
  });

  describe('input element handling', () => {
    it('should not handle keys when typing in input', () => {
      getGlobalAudioState.mockReturnValue({
        playingId: 'test-id',
        audioRefs: { 'test-id': mockAudio },
        autoplay: false,
        recentTransmissions: [],
        subscribers: [],
      });

      renderHook(() => useAudioKeyboard());

      const keydownHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'keydown'
      )?.[1];

      const inputElement = document.createElement('input');
      const event = {
        key: ' ',
        preventDefault: vi.fn(),
        target: inputElement,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      };

      act(() => {
        keydownHandler(event);
      });

      // Should not call preventDefault when typing in input
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(mockAudio.pause).not.toHaveBeenCalled();
    });

    it('should not handle keys when typing in textarea', () => {
      getGlobalAudioState.mockReturnValue({
        playingId: 'test-id',
        audioRefs: { 'test-id': mockAudio },
        autoplay: false,
        recentTransmissions: [],
        subscribers: [],
      });

      renderHook(() => useAudioKeyboard());

      const keydownHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'keydown'
      )?.[1];

      const textareaElement = document.createElement('textarea');
      const event = {
        key: ' ',
        preventDefault: vi.fn(),
        target: textareaElement,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      };

      act(() => {
        keydownHandler(event);
      });

      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('should not handle keys when typing in contenteditable', () => {
      getGlobalAudioState.mockReturnValue({
        playingId: 'test-id',
        audioRefs: { 'test-id': mockAudio },
        autoplay: false,
        recentTransmissions: [],
        subscribers: [],
      });

      renderHook(() => useAudioKeyboard());

      const keydownHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'keydown'
      )?.[1];

      const divElement = document.createElement('div');
      divElement.setAttribute('contenteditable', 'true');
      const event = {
        key: ' ',
        preventDefault: vi.fn(),
        target: divElement,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      };

      act(() => {
        keydownHandler(event);
      });

      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('modifier keys', () => {
    it('should not handle keys with ctrl modifier', () => {
      getGlobalAudioState.mockReturnValue({
        playingId: 'test-id',
        audioRefs: { 'test-id': mockAudio },
        autoplay: false,
        recentTransmissions: [],
        subscribers: [],
      });

      renderHook(() => useAudioKeyboard());

      const keydownHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'keydown'
      )?.[1];

      const event = {
        key: ' ',
        preventDefault: vi.fn(),
        target: document.body,
        ctrlKey: true,
        metaKey: false,
        altKey: false,
      };

      act(() => {
        keydownHandler(event);
      });

      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('should not handle keys with meta modifier', () => {
      getGlobalAudioState.mockReturnValue({
        playingId: 'test-id',
        audioRefs: { 'test-id': mockAudio },
        autoplay: false,
        recentTransmissions: [],
        subscribers: [],
      });

      renderHook(() => useAudioKeyboard());

      const keydownHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'keydown'
      )?.[1];

      const event = {
        key: ' ',
        preventDefault: vi.fn(),
        target: document.body,
        ctrlKey: false,
        metaKey: true,
        altKey: false,
      };

      act(() => {
        keydownHandler(event);
      });

      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('custom callbacks', () => {
    it('should use custom onPlayPause callback', () => {
      const customPlayPause = vi.fn();

      getGlobalAudioState.mockReturnValue({
        playingId: 'test-id',
        audioRefs: { 'test-id': mockAudio },
        autoplay: false,
        recentTransmissions: [],
        subscribers: [],
      });

      renderHook(() => useAudioKeyboard({ onPlayPause: customPlayPause }));

      const keydownHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'keydown'
      )?.[1];

      const event = {
        key: ' ',
        preventDefault: vi.fn(),
        target: document.body,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      };

      act(() => {
        keydownHandler(event);
      });

      expect(customPlayPause).toHaveBeenCalled();
    });

    it('should use custom onToggleMute callback', () => {
      const customToggleMute = vi.fn();

      getGlobalAudioState.mockReturnValue({
        playingId: 'test-id',
        audioRefs: { 'test-id': mockAudio },
        autoplay: false,
        recentTransmissions: [],
        subscribers: [],
      });

      renderHook(() => useAudioKeyboard({ onToggleMute: customToggleMute }));

      const keydownHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'keydown'
      )?.[1];

      const event = {
        key: 'm',
        preventDefault: vi.fn(),
        target: document.body,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      };

      act(() => {
        keydownHandler(event);
      });

      expect(customToggleMute).toHaveBeenCalled();
    });
  });

  describe('returned functions', () => {
    it('should return control functions', () => {
      getGlobalAudioState.mockReturnValue({
        playingId: null,
        audioRefs: {},
        autoplay: false,
        recentTransmissions: [],
        subscribers: [],
      });

      const { result } = renderHook(() => useAudioKeyboard());

      expect(result.current.playPause).toBeDefined();
      expect(result.current.nextTrack).toBeDefined();
      expect(result.current.prevTrack).toBeDefined();
      expect(result.current.toggleMute).toBeDefined();
      expect(result.current.toggleAutoplay).toBeDefined();
      expect(result.current.seekForward).toBeDefined();
      expect(result.current.seekBackward).toBeDefined();
      expect(result.current.volumeUp).toBeDefined();
      expect(result.current.volumeDown).toBeDefined();
      expect(result.current.stop).toBeDefined();
      expect(result.current.playTransmission).toBeDefined();
    });
  });
});
