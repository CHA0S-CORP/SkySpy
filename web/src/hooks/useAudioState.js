/**
 * Global audio state management hook for persistent audio playback across navigation.
 *
 * This module manages:
 * - Audio playback state that persists across page navigation
 * - Autoplay queue for continuous playback
 * - Audio element references and progress tracking
 * - Subscriber pattern for state change notifications
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// Emergency keywords for filtering distress calls
export const EMERGENCY_KEYWORDS = [
  'mayday',
  'pan pan',
  'pan-pan',
  'emergency',
  'declaring emergency',
  'fuel emergency',
  'medical emergency',
  'emergency descent',
  'squawk 7700',
  '7700',
  'souls on board',
  'distress',
  'urgent'
];

// Helper to check if transcript contains emergency keywords
export const hasEmergencyKeyword = (transcript) => {
  if (!transcript) return false;
  const lowerTranscript = transcript.toLowerCase();
  return EMERGENCY_KEYWORDS.some(keyword => lowerTranscript.includes(keyword));
};

// Maximum age (in ms) for a transmission to be eligible for autoplay
// Transmissions older than this are skipped to avoid playing stale audio
export const AUTOPLAY_MAX_AGE_MS = 30000; // 30 seconds

// Global audio state to persist across page navigation
export const globalAudioState = {
  audioRefs: {},
  playingId: null,
  currentTransmission: null, // { id, channel_name, frequency_mhz, ... }
  audioProgress: {},
  audioDurations: {},
  progressIntervalRef: null,
  autoplay: false,
  autoplayEnabledAt: null, // Timestamp when autoplay was enabled (only play transmissions after this)
  autoplayFilter: null, // { type: 'airframe', callsign: 'UAL123', hex: 'A12345' } or null for all
  subscribers: [],
  // WebSocket connection for real-time audio (shared across components)
  socket: null,
  socketConnected: false,
  socketReconnectFailed: false, // True when max reconnection attempts reached
  autoplayQueue: [],
  recentTransmissions: [], // Last 50 transmissions received via socket
};

// Subscribe to audio state changes
export const subscribeToAudioState = (callback) => {
  globalAudioState.subscribers.push(callback);
  return () => {
    globalAudioState.subscribers = globalAudioState.subscribers.filter(cb => cb !== callback);
  };
};

// Notify all subscribers of state changes
export const notifySubscribers = (updates) => {
  globalAudioState.subscribers.forEach(callback => callback(updates));
};

// Set autoplay state
export const setAutoplay = (enabled) => {
  globalAudioState.autoplay = enabled;

  if (enabled) {
    // Clear any stale queued transmissions and record when autoplay was enabled
    // This ensures we only play NEW transmissions going forward
    globalAudioState.autoplayQueue = [];
    globalAudioState.autoplayEnabledAt = Date.now();
  } else {
    // Clear queue and timestamp when disabled
    globalAudioState.autoplayQueue = [];
    globalAudioState.autoplayEnabledAt = null;
  }

  notifySubscribers({ autoplay: enabled });
};

// Set autoplay filter for airframe-specific playback
export const setAutoplayFilter = (filter) => {
  globalAudioState.autoplayFilter = filter;
  notifySubscribers({ autoplayFilter: filter });
};

// Clear autoplay filter (return to all transmissions)
export const clearAutoplayFilter = () => {
  globalAudioState.autoplayFilter = null;
  notifySubscribers({ autoplayFilter: null });
};

// Export for external access
export const getGlobalAudioState = () => globalAudioState;
export const subscribeToAudioStateChanges = subscribeToAudioState;

// Queue management functions for AudioQueue component
export const removeFromQueue = (index) => {
  if (index >= 0 && index < globalAudioState.autoplayQueue.length) {
    globalAudioState.autoplayQueue.splice(index, 1);
    globalAudioState.autoplayQueue = [...globalAudioState.autoplayQueue];
    notifySubscribers({ autoplayQueue: globalAudioState.autoplayQueue });
  }
};

export const clearQueue = () => {
  globalAudioState.autoplayQueue = [];
  notifySubscribers({ autoplayQueue: globalAudioState.autoplayQueue });
};

export const reorderQueue = (fromIndex, toIndex) => {
  if (
    fromIndex >= 0 && fromIndex < globalAudioState.autoplayQueue.length &&
    toIndex >= 0 && toIndex < globalAudioState.autoplayQueue.length &&
    fromIndex !== toIndex
  ) {
    const queue = [...globalAudioState.autoplayQueue];
    const [removed] = queue.splice(fromIndex, 1);
    queue.splice(toIndex, 0, removed);
    globalAudioState.autoplayQueue = queue;
    notifySubscribers({ autoplayQueue: globalAudioState.autoplayQueue });
  }
};

// Process the global autoplay queue
export const processGlobalAutoplayQueue = () => {
  if (!globalAudioState.autoplay || globalAudioState.autoplayQueue.length === 0) {
    return;
  }

  // If already playing, don't start another
  if (globalAudioState.playingId) {
    return;
  }

  const next = globalAudioState.autoplayQueue.shift();
  if (!next || !next.s3_url) {
    // Try next item
    if (globalAudioState.autoplayQueue.length > 0) {
      processGlobalAutoplayQueue();
    }
    return;
  }

  // Check if the queued transmission is still fresh enough to play
  // This handles cases where items sat in the queue while other audio was playing
  const now = Date.now();
  const transmissionTime = new Date(next.created_at).getTime();
  const transmissionAge = now - transmissionTime;

  if (transmissionAge > AUTOPLAY_MAX_AGE_MS * 2) {
    // Skip stale queued items (use 2x threshold since it already passed initial check)
    console.log('Skipping stale queued transmission:', next.id, `(${Math.round(transmissionAge / 1000)}s old)`);
    // Try next item
    if (globalAudioState.autoplayQueue.length > 0) {
      processGlobalAutoplayQueue();
    }
    return;
  }

  // Play the audio
  playAudioFromGlobal(next);
};

// Play audio from global state (used by autoplay)
export const playAudioFromGlobal = (transmission) => {
  const id = transmission.id;
  const audioUrl = transmission.s3_url || transmission.audio_url;

  if (!audioUrl) {
    console.warn('No audio URL for transmission:', id);
    processGlobalAutoplayQueue();
    return;
  }

  // Stop any currently playing audio
  if (globalAudioState.playingId && globalAudioState.playingId !== id) {
    const prevAudio = globalAudioState.audioRefs[globalAudioState.playingId];
    if (prevAudio) {
      prevAudio.pause();
      prevAudio.currentTime = 0;
    }
  }

  // Get or create audio element
  let audio = globalAudioState.audioRefs[id];
  if (!audio) {
    audio = new Audio(audioUrl);
    audio.volume = 1;
    globalAudioState.audioRefs[id] = audio;

    audio.addEventListener('loadedmetadata', () => {
      globalAudioState.audioDurations[id] = audio.duration;
      notifySubscribers({ audioDurations: { ...globalAudioState.audioDurations } });
    });

    audio.addEventListener('ended', () => {
      globalAudioState.playingId = null;
      globalAudioState.currentTransmission = null;
      globalAudioState.audioProgress[id] = 0;
      notifySubscribers({
        playingId: null,
        currentTransmission: null,
        audioProgress: { ...globalAudioState.audioProgress }
      });

      // Clear progress interval
      if (globalAudioState.progressIntervalRef) {
        clearInterval(globalAudioState.progressIntervalRef);
        globalAudioState.progressIntervalRef = null;
      }

      // Play next in queue
      setTimeout(() => processGlobalAutoplayQueue(), 100);
    });

    audio.addEventListener('error', (e) => {
      console.error('Global audio playback error:', e);
      globalAudioState.playingId = null;
      globalAudioState.currentTransmission = null;
      notifySubscribers({ playingId: null, currentTransmission: null });

      // Try next in queue
      setTimeout(() => processGlobalAutoplayQueue(), 100);
    });
  }

  // Play
  audio.play().then(() => {
    globalAudioState.playingId = id;
    globalAudioState.currentTransmission = transmission;
    notifySubscribers({ playingId: id, currentTransmission: transmission });

    // Update progress
    if (globalAudioState.progressIntervalRef) {
      clearInterval(globalAudioState.progressIntervalRef);
    }
    globalAudioState.progressIntervalRef = setInterval(() => {
      if (audio && !audio.paused) {
        const progress = (audio.currentTime / audio.duration) * 100 || 0;
        globalAudioState.audioProgress[id] = progress;
        notifySubscribers({ audioProgress: { ...globalAudioState.audioProgress } });
      }
    }, 100);
  }).catch(err => {
    console.error('Failed to play audio:', err);
    // Try next in queue
    setTimeout(() => processGlobalAutoplayQueue(), 100);
  });
};

/**
 * Hook for managing audio playback state.
 * Syncs with global state and provides reactive updates.
 */
export function useAudioState() {
  const [playingId, setPlayingId] = useState(globalAudioState.playingId);
  const [audioProgress, setAudioProgress] = useState(globalAudioState.audioProgress);
  const [audioDurations, setAudioDurations] = useState(globalAudioState.audioDurations);
  const [autoplay, setAutoplayState] = useState(globalAudioState.autoplay);
  const [currentTransmission, setCurrentTransmission] = useState(globalAudioState.currentTransmission);
  const [autoplayQueue, setAutoplayQueue] = useState(globalAudioState.autoplayQueue);

  const audioRefs = globalAudioState.audioRefs;

  // Subscribe to global audio state changes
  useEffect(() => {
    const unsubscribe = subscribeToAudioState((updates) => {
      if ('playingId' in updates) setPlayingId(updates.playingId);
      if ('audioProgress' in updates) setAudioProgress(updates.audioProgress);
      if ('audioDurations' in updates) setAudioDurations(updates.audioDurations);
      if ('autoplay' in updates) setAutoplayState(updates.autoplay);
      if ('currentTransmission' in updates) setCurrentTransmission(updates.currentTransmission);
      if ('autoplayQueue' in updates) setAutoplayQueue(updates.autoplayQueue);
    });
    return unsubscribe;
  }, []);

  // Toggle autoplay
  const toggleAutoplay = useCallback((enabled) => {
    setAutoplay(enabled);
  }, []);

  return {
    playingId,
    audioProgress,
    audioDurations,
    autoplay,
    currentTransmission,
    autoplayQueue,
    audioRefs,
    toggleAutoplay,
    setAutoplay,
    setAutoplayFilter,
    clearAutoplayFilter,
    removeFromQueue,
    clearQueue,
    reorderQueue,
  };
}

export default useAudioState;
