import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useAudioState,
  globalAudioState,
  notifySubscribers,
  subscribeToAudioState,
  setAutoplay,
  setAutoplayFilter,
  clearAutoplayFilter,
  removeFromQueue,
  clearQueue,
  reorderQueue,
  hasEmergencyKeyword,
  EMERGENCY_KEYWORDS,
  AUTOPLAY_MAX_AGE_MS,
} from './useAudioState';

describe('useAudioState', () => {
  beforeEach(() => {
    // Reset global audio state
    globalAudioState.audioRefs = {};
    globalAudioState.playingId = null;
    globalAudioState.currentTransmission = null;
    globalAudioState.audioProgress = {};
    globalAudioState.audioDurations = {};
    globalAudioState.progressIntervalRef = null;
    globalAudioState.autoplay = false;
    globalAudioState.autoplayEnabledAt = null;
    globalAudioState.autoplayFilter = null;
    globalAudioState.subscribers = [];
    globalAudioState.autoplayQueue = [];
    globalAudioState.recentTransmissions = [];
  });

  afterEach(() => {
    // Clean up subscribers
    globalAudioState.subscribers = [];
  });

  describe('initial state', () => {
    it('should sync with global audio state', () => {
      globalAudioState.playingId = 'test-123';
      globalAudioState.autoplay = true;

      const { result } = renderHook(() => useAudioState());

      expect(result.current.playingId).toBe('test-123');
      expect(result.current.autoplay).toBe(true);
    });

    it('should provide audioRefs from global state', () => {
      globalAudioState.audioRefs = { 'test-id': {} };

      const { result } = renderHook(() => useAudioState());

      expect(result.current.audioRefs).toBe(globalAudioState.audioRefs);
    });
  });

  describe('subscribeToAudioState', () => {
    it('should add subscriber and return unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = subscribeToAudioState(callback);

      expect(globalAudioState.subscribers).toContain(callback);

      unsubscribe();

      expect(globalAudioState.subscribers).not.toContain(callback);
    });

    it('should call subscribers when notifySubscribers is called', () => {
      const callback = vi.fn();
      subscribeToAudioState(callback);

      notifySubscribers({ playingId: 'new-id' });

      expect(callback).toHaveBeenCalledWith({ playingId: 'new-id' });
    });

    it('should handle errors in subscriber callbacks gracefully', () => {
      const errorCallback = vi.fn(() => {
        throw new Error('Test error');
      });
      const normalCallback = vi.fn();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      subscribeToAudioState(errorCallback);
      subscribeToAudioState(normalCallback);

      notifySubscribers({ playingId: 'test' });

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(normalCallback).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('setAutoplay', () => {
    it('should enable autoplay and record timestamp', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      setAutoplay(true);

      expect(globalAudioState.autoplay).toBe(true);
      expect(globalAudioState.autoplayEnabledAt).toBe(now);
      expect(globalAudioState.autoplayQueue).toEqual([]);

      vi.useRealTimers();
    });

    it('should disable autoplay and clear timestamp', () => {
      globalAudioState.autoplay = true;
      globalAudioState.autoplayEnabledAt = Date.now();
      globalAudioState.autoplayQueue = [{ id: 'test' }];

      setAutoplay(false);

      expect(globalAudioState.autoplay).toBe(false);
      expect(globalAudioState.autoplayEnabledAt).toBeNull();
      expect(globalAudioState.autoplayQueue).toEqual([]);
    });

    it('should notify subscribers of autoplay change', () => {
      const callback = vi.fn();
      subscribeToAudioState(callback);

      setAutoplay(true);

      expect(callback).toHaveBeenCalledWith({ autoplay: true });
    });
  });

  describe('setAutoplayFilter', () => {
    it('should set autoplay filter', () => {
      const filter = { type: 'airframe', callsign: 'UAL123' };
      setAutoplayFilter(filter);

      expect(globalAudioState.autoplayFilter).toEqual(filter);
    });

    it('should notify subscribers of filter change', () => {
      const callback = vi.fn();
      subscribeToAudioState(callback);
      const filter = { type: 'airframe', callsign: 'UAL123' };

      setAutoplayFilter(filter);

      expect(callback).toHaveBeenCalledWith({ autoplayFilter: filter });
    });
  });

  describe('clearAutoplayFilter', () => {
    it('should clear autoplay filter', () => {
      globalAudioState.autoplayFilter = { type: 'airframe' };

      clearAutoplayFilter();

      expect(globalAudioState.autoplayFilter).toBeNull();
    });

    it('should notify subscribers when filter is cleared', () => {
      const callback = vi.fn();
      subscribeToAudioState(callback);
      globalAudioState.autoplayFilter = { type: 'airframe' };

      clearAutoplayFilter();

      expect(callback).toHaveBeenCalledWith({ autoplayFilter: null });
    });
  });

  describe('queue management', () => {
    describe('removeFromQueue', () => {
      it('should remove item at specified index', () => {
        globalAudioState.autoplayQueue = [{ id: '1' }, { id: '2' }, { id: '3' }];
        const callback = vi.fn();
        subscribeToAudioState(callback);

        removeFromQueue(1);

        expect(globalAudioState.autoplayQueue).toHaveLength(2);
        expect(globalAudioState.autoplayQueue[1].id).toBe('3');
        expect(callback).toHaveBeenCalledWith({ autoplayQueue: globalAudioState.autoplayQueue });
      });

      it('should not remove if index is out of bounds', () => {
        globalAudioState.autoplayQueue = [{ id: '1' }];

        removeFromQueue(5);

        expect(globalAudioState.autoplayQueue).toHaveLength(1);
      });

      it('should not remove if index is negative', () => {
        globalAudioState.autoplayQueue = [{ id: '1' }];

        removeFromQueue(-1);

        expect(globalAudioState.autoplayQueue).toHaveLength(1);
      });
    });

    describe('clearQueue', () => {
      it('should clear entire queue', () => {
        globalAudioState.autoplayQueue = [{ id: '1' }, { id: '2' }];
        const callback = vi.fn();
        subscribeToAudioState(callback);

        clearQueue();

        expect(globalAudioState.autoplayQueue).toEqual([]);
        expect(callback).toHaveBeenCalledWith({ autoplayQueue: [] });
      });
    });

    describe('reorderQueue', () => {
      it('should reorder items in queue', () => {
        globalAudioState.autoplayQueue = [{ id: '1' }, { id: '2' }, { id: '3' }];
        const callback = vi.fn();
        subscribeToAudioState(callback);

        reorderQueue(0, 2);

        expect(globalAudioState.autoplayQueue[0].id).toBe('2');
        expect(globalAudioState.autoplayQueue[1].id).toBe('3');
        expect(globalAudioState.autoplayQueue[2].id).toBe('1');
        expect(callback).toHaveBeenCalled();
      });

      it('should not reorder if indices are the same', () => {
        globalAudioState.autoplayQueue = [{ id: '1' }, { id: '2' }];

        reorderQueue(1, 1);

        expect(globalAudioState.autoplayQueue[0].id).toBe('1');
        expect(globalAudioState.autoplayQueue[1].id).toBe('2');
      });

      it('should not reorder if indices are out of bounds', () => {
        globalAudioState.autoplayQueue = [{ id: '1' }, { id: '2' }];

        reorderQueue(0, 5);

        expect(globalAudioState.autoplayQueue[0].id).toBe('1');
        expect(globalAudioState.autoplayQueue[1].id).toBe('2');
      });
    });
  });

  describe('hasEmergencyKeyword', () => {
    it('should return true for transcripts containing emergency keywords', () => {
      expect(hasEmergencyKeyword('mayday mayday mayday')).toBe(true);
      expect(hasEmergencyKeyword('declaring emergency')).toBe(true);
      expect(hasEmergencyKeyword('pan pan pan')).toBe(true);
      expect(hasEmergencyKeyword('squawk 7700')).toBe(true);
      expect(hasEmergencyKeyword('fuel emergency low fuel')).toBe(true);
    });

    it('should return false for normal transcripts', () => {
      expect(hasEmergencyKeyword('cleared for takeoff runway 27')).toBe(false);
      expect(hasEmergencyKeyword('contact approach on 119.1')).toBe(false);
      expect(hasEmergencyKeyword('descend and maintain flight level 350')).toBe(false);
    });

    it('should return false for null or empty transcripts', () => {
      expect(hasEmergencyKeyword(null)).toBe(false);
      expect(hasEmergencyKeyword(undefined)).toBe(false);
      expect(hasEmergencyKeyword('')).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(hasEmergencyKeyword('MAYDAY')).toBe(true);
      expect(hasEmergencyKeyword('MaYdAy')).toBe(true);
      expect(hasEmergencyKeyword('DECLARING EMERGENCY')).toBe(true);
    });
  });

  describe('EMERGENCY_KEYWORDS', () => {
    it('should contain expected emergency phrases', () => {
      expect(EMERGENCY_KEYWORDS).toContain('mayday');
      expect(EMERGENCY_KEYWORDS).toContain('pan pan');
      expect(EMERGENCY_KEYWORDS).toContain('emergency');
      expect(EMERGENCY_KEYWORDS).toContain('7700');
      expect(EMERGENCY_KEYWORDS).toContain('souls on board');
    });
  });

  describe('AUTOPLAY_MAX_AGE_MS', () => {
    it('should be 30 seconds', () => {
      expect(AUTOPLAY_MAX_AGE_MS).toBe(30000);
    });
  });

  describe('useAudioState hook', () => {
    it('should update local state when global state changes', () => {
      const { result } = renderHook(() => useAudioState());

      expect(result.current.playingId).toBeNull();

      act(() => {
        notifySubscribers({ playingId: 'updated-id' });
      });

      expect(result.current.playingId).toBe('updated-id');
    });

    it('should update audioProgress when notified', () => {
      const { result } = renderHook(() => useAudioState());

      act(() => {
        notifySubscribers({ audioProgress: { 'test-id': 50 } });
      });

      expect(result.current.audioProgress).toEqual({ 'test-id': 50 });
    });

    it('should update currentTransmission when notified', () => {
      const { result } = renderHook(() => useAudioState());

      const transmission = { id: 'trans-1', channel_name: 'Test Channel' };
      act(() => {
        notifySubscribers({ currentTransmission: transmission });
      });

      expect(result.current.currentTransmission).toEqual(transmission);
    });

    it('should update autoplayQueue when notified', () => {
      const { result } = renderHook(() => useAudioState());

      const queue = [{ id: '1' }, { id: '2' }];
      act(() => {
        notifySubscribers({ autoplayQueue: queue });
      });

      expect(result.current.autoplayQueue).toEqual(queue);
    });

    it('should provide toggleAutoplay function', () => {
      const { result } = renderHook(() => useAudioState());

      expect(result.current.toggleAutoplay).toBeDefined();
      expect(typeof result.current.toggleAutoplay).toBe('function');

      act(() => {
        result.current.toggleAutoplay(true);
      });

      expect(globalAudioState.autoplay).toBe(true);
    });

    it('should provide queue management functions', () => {
      const { result } = renderHook(() => useAudioState());

      expect(result.current.setAutoplay).toBeDefined();
      expect(result.current.setAutoplayFilter).toBeDefined();
      expect(result.current.clearAutoplayFilter).toBeDefined();
      expect(result.current.removeFromQueue).toBeDefined();
      expect(result.current.clearQueue).toBeDefined();
      expect(result.current.reorderQueue).toBeDefined();
    });

    it('should unsubscribe on unmount', () => {
      const { unmount } = renderHook(() => useAudioState());

      const initialSubscriberCount = globalAudioState.subscribers.length;

      unmount();

      expect(globalAudioState.subscribers.length).toBe(initialSubscriberCount - 1);
    });
  });
});
