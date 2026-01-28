import { useEffect, useCallback } from 'react';
import { getGlobalAudioState, subscribeToAudioStateChanges, setAutoplay as setGlobalAutoplay } from '../components/views/AudioView';

/**
 * Hook for global keyboard shortcuts for audio playback control.
 *
 * Keyboard shortcuts:
 * - Space: Play/pause current audio
 * - N: Skip to next transmission
 * - P: Skip to previous transmission (go back in history)
 * - M: Toggle mute
 * - A: Toggle autoplay
 * - ArrowLeft: Seek backward 5 seconds
 * - ArrowRight: Seek forward 5 seconds
 * - ArrowUp: Volume up 10%
 * - ArrowDown: Volume down 10%
 * - Escape: Stop playback
 *
 * @param {Object} options - Configuration options
 * @param {Function} options.onPlayPause - Callback for play/pause action
 * @param {Function} options.onNextTrack - Callback for skipping to next track
 * @param {Function} options.onPrevTrack - Callback for going to previous track
 * @param {Function} options.onToggleMute - Callback for toggling mute
 * @param {Function} options.onToggleAutoplay - Callback for toggling autoplay
 * @param {Function} options.onSeekForward - Callback for seeking forward
 * @param {Function} options.onSeekBackward - Callback for seeking backward
 * @param {Function} options.onVolumeUp - Callback for volume up
 * @param {Function} options.onVolumeDown - Callback for volume down
 * @param {Function} options.onStop - Callback for stopping playback
 * @param {boolean} options.enabled - Whether keyboard shortcuts are enabled (default: true)
 */
export function useAudioKeyboard(options = {}) {
  const {
    onPlayPause,
    onNextTrack,
    onPrevTrack,
    onToggleMute,
    onToggleAutoplay,
    onSeekForward,
    onSeekBackward,
    onVolumeUp,
    onVolumeDown,
    onStop,
    enabled = true,
  } = options;

  // Default implementations using global audio state
  const defaultPlayPause = useCallback(() => {
    const audioState = getGlobalAudioState();
    const playingId = audioState.playingId;
    if (playingId) {
      const audio = audioState.audioRefs?.[playingId];
      if (audio) {
        if (audio.paused) {
          audio.play().catch(err => console.warn('Audio play failed:', err));
        } else {
          audio.pause();
        }
      }
    }
  }, []);

  const defaultToggleMute = useCallback(() => {
    const audioState = getGlobalAudioState();
    const playingId = audioState.playingId;
    if (playingId) {
      const audio = audioState.audioRefs?.[playingId];
      if (audio) {
        audio.muted = !audio.muted;
      }
    }
  }, []);

  const defaultToggleAutoplay = useCallback(() => {
    const audioState = getGlobalAudioState();
    setGlobalAutoplay(!audioState.autoplay);
  }, []);

  const defaultSeekForward = useCallback((seconds = 5) => {
    const audioState = getGlobalAudioState();
    const playingId = audioState.playingId;
    if (playingId) {
      const audio = audioState.audioRefs?.[playingId];
      if (audio && isFinite(audio.duration)) {
        audio.currentTime = Math.min(audio.duration, audio.currentTime + seconds);
      }
    }
  }, []);

  const defaultSeekBackward = useCallback((seconds = 5) => {
    const audioState = getGlobalAudioState();
    const playingId = audioState.playingId;
    if (playingId) {
      const audio = audioState.audioRefs?.[playingId];
      if (audio) {
        audio.currentTime = Math.max(0, audio.currentTime - seconds);
      }
    }
  }, []);

  const defaultVolumeUp = useCallback((amount = 0.1) => {
    const audioState = getGlobalAudioState();
    const playingId = audioState.playingId;
    if (playingId) {
      const audio = audioState.audioRefs?.[playingId];
      if (audio) {
        audio.volume = Math.min(1, audio.volume + amount);
        // Unmute if muted and increasing volume
        if (audio.muted) {
          audio.muted = false;
        }
      }
    }
  }, []);

  const defaultVolumeDown = useCallback((amount = 0.1) => {
    const audioState = getGlobalAudioState();
    const playingId = audioState.playingId;
    if (playingId) {
      const audio = audioState.audioRefs?.[playingId];
      if (audio) {
        audio.volume = Math.max(0, audio.volume - amount);
      }
    }
  }, []);

  const defaultStop = useCallback(() => {
    const audioState = getGlobalAudioState();
    const playingId = audioState.playingId;
    if (playingId) {
      const audio = audioState.audioRefs?.[playingId];
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
      // Clear global state
      audioState.playingId = null;
      audioState.currentTransmission = null;
      // Notify subscribers
      audioState.subscribers.forEach(callback => callback({
        playingId: null,
        currentTransmission: null,
      }));
    }
    // Also disable autoplay
    setGlobalAutoplay(false);
  }, []);

  const defaultNextTrack = useCallback(() => {
    const audioState = getGlobalAudioState();
    const playingId = audioState.playingId;
    const recentTransmissions = audioState.recentTransmissions || [];

    if (recentTransmissions.length === 0) return;

    // Find current index
    const currentIndex = playingId
      ? recentTransmissions.findIndex(t => t.id === playingId)
      : -1;

    // Get next transmission (older, since list is newest first)
    const nextIndex = currentIndex + 1;
    if (nextIndex < recentTransmissions.length) {
      const nextTransmission = recentTransmissions[nextIndex];
      if (nextTransmission?.s3_url) {
        playTransmission(nextTransmission);
      }
    }
  }, []);

  const defaultPrevTrack = useCallback(() => {
    const audioState = getGlobalAudioState();
    const playingId = audioState.playingId;
    const recentTransmissions = audioState.recentTransmissions || [];

    if (recentTransmissions.length === 0) return;

    // Find current index
    const currentIndex = playingId
      ? recentTransmissions.findIndex(t => t.id === playingId)
      : recentTransmissions.length;

    // Get previous transmission (newer, since list is newest first)
    const prevIndex = currentIndex - 1;
    if (prevIndex >= 0) {
      const prevTransmission = recentTransmissions[prevIndex];
      if (prevTransmission?.s3_url) {
        playTransmission(prevTransmission);
      }
    }
  }, []);

  // Helper function to play a transmission
  const playTransmission = useCallback((transmission) => {
    const audioState = getGlobalAudioState();
    const id = transmission.id;
    const audioUrl = transmission.s3_url || transmission.audio_url;

    if (!audioUrl) return;

    // Stop current playback
    if (audioState.playingId && audioState.playingId !== id) {
      const prevAudio = audioState.audioRefs[audioState.playingId];
      if (prevAudio) {
        prevAudio.pause();
        prevAudio.currentTime = 0;
      }
    }

    // Clear existing progress interval
    if (audioState.progressIntervalRef) {
      clearInterval(audioState.progressIntervalRef);
      audioState.progressIntervalRef = null;
    }

    // Get or create audio element
    let audio = audioState.audioRefs[id];
    if (!audio) {
      audio = new Audio(audioUrl);
      audioState.audioRefs[id] = audio;

      audio.addEventListener('loadedmetadata', () => {
        audioState.audioDurations[id] = audio.duration;
        audioState.subscribers.forEach(callback => callback({
          audioDurations: { ...audioState.audioDurations }
        }));
      });

      audio.addEventListener('ended', () => {
        audioState.playingId = null;
        audioState.currentTransmission = null;
        audioState.audioProgress[id] = 0;
        if (audioState.progressIntervalRef) {
          clearInterval(audioState.progressIntervalRef);
          audioState.progressIntervalRef = null;
        }
        audioState.subscribers.forEach(callback => callback({
          playingId: null,
          currentTransmission: null,
          audioProgress: { ...audioState.audioProgress }
        }));
      });

      audio.addEventListener('error', (e) => {
        console.error('Audio playback error:', e);
        audioState.playingId = null;
        audioState.currentTransmission = null;
        audioState.subscribers.forEach(callback => callback({
          playingId: null,
          currentTransmission: null
        }));
      });
    }

    // Play
    audio.play().then(() => {
      audioState.playingId = id;
      audioState.currentTransmission = transmission;
      audioState.subscribers.forEach(callback => callback({
        playingId: id,
        currentTransmission: transmission
      }));

      // Update progress
      audioState.progressIntervalRef = setInterval(() => {
        if (audio && !audio.paused && isFinite(audio.duration) && audio.duration > 0) {
          const progress = (audio.currentTime / audio.duration) * 100 || 0;
          audioState.audioProgress[id] = progress;
          audioState.subscribers.forEach(callback => callback({
            audioProgress: { ...audioState.audioProgress }
          }));
        }
      }, 100);
    }).catch(err => {
      console.error('Failed to play audio:', err);
    });
  }, []);

  // Check if the target is an input element
  const isInputElement = useCallback((element) => {
    if (!element) return false;
    const tagName = element.tagName?.toLowerCase();
    return (
      tagName === 'input' ||
      tagName === 'textarea' ||
      tagName === 'select' ||
      element.isContentEditable ||
      element.getAttribute('contenteditable') === 'true'
    );
  }, []);

  // Keyboard event handler
  const handleKeyDown = useCallback((event) => {
    // Don't handle if shortcuts are disabled
    if (!enabled) return;

    // Don't handle if typing in an input field
    if (isInputElement(event.target)) return;

    // Don't handle if modifier keys are pressed (except for some shortcuts)
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const audioState = getGlobalAudioState();
    const hasActivePlayback = !!audioState.playingId;
    const hasAudioCapability = hasActivePlayback || audioState.autoplay || audioState.recentTransmissions?.length > 0;

    // Handle keyboard shortcuts
    switch (event.key) {
      case ' ': // Space - Play/Pause
        if (hasActivePlayback) {
          event.preventDefault();
          (onPlayPause || defaultPlayPause)();
        }
        break;

      case 'n': // N - Next track
      case 'N':
        if (hasAudioCapability) {
          event.preventDefault();
          (onNextTrack || defaultNextTrack)();
        }
        break;

      case 'p': // P - Previous track
      case 'P':
        if (hasAudioCapability) {
          event.preventDefault();
          (onPrevTrack || defaultPrevTrack)();
        }
        break;

      case 'm': // M - Toggle mute
      case 'M':
        if (hasActivePlayback) {
          event.preventDefault();
          (onToggleMute || defaultToggleMute)();
        }
        break;

      case 'a': // A - Toggle autoplay
      case 'A':
        event.preventDefault();
        (onToggleAutoplay || defaultToggleAutoplay)();
        break;

      case 'ArrowLeft': // Left arrow - Seek backward 5 seconds
        if (hasActivePlayback) {
          event.preventDefault();
          (onSeekBackward || defaultSeekBackward)(5);
        }
        break;

      case 'ArrowRight': // Right arrow - Seek forward 5 seconds
        if (hasActivePlayback) {
          event.preventDefault();
          (onSeekForward || defaultSeekForward)(5);
        }
        break;

      case 'ArrowUp': // Up arrow - Volume up 10%
        if (hasActivePlayback) {
          event.preventDefault();
          (onVolumeUp || defaultVolumeUp)(0.1);
        }
        break;

      case 'ArrowDown': // Down arrow - Volume down 10%
        if (hasActivePlayback) {
          event.preventDefault();
          (onVolumeDown || defaultVolumeDown)(0.1);
        }
        break;

      case 'Escape': // Escape - Stop playback
        if (hasActivePlayback) {
          event.preventDefault();
          (onStop || defaultStop)();
        }
        break;

      default:
        // Don't handle other keys
        break;
    }
  }, [
    enabled,
    isInputElement,
    onPlayPause,
    onNextTrack,
    onPrevTrack,
    onToggleMute,
    onToggleAutoplay,
    onSeekForward,
    onSeekBackward,
    onVolumeUp,
    onVolumeDown,
    onStop,
    defaultPlayPause,
    defaultNextTrack,
    defaultPrevTrack,
    defaultToggleMute,
    defaultToggleAutoplay,
    defaultSeekForward,
    defaultSeekBackward,
    defaultVolumeUp,
    defaultVolumeDown,
    defaultStop,
  ]);

  // Set up global keydown listener
  useEffect(() => {
    if (!enabled) return;

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, handleKeyDown]);

  // Return control functions for manual use if needed
  return {
    playPause: onPlayPause || defaultPlayPause,
    nextTrack: onNextTrack || defaultNextTrack,
    prevTrack: onPrevTrack || defaultPrevTrack,
    toggleMute: onToggleMute || defaultToggleMute,
    toggleAutoplay: onToggleAutoplay || defaultToggleAutoplay,
    seekForward: onSeekForward || defaultSeekForward,
    seekBackward: onSeekBackward || defaultSeekBackward,
    volumeUp: onVolumeUp || defaultVolumeUp,
    volumeDown: onVolumeDown || defaultVolumeDown,
    stop: onStop || defaultStop,
    playTransmission,
  };
}

export default useAudioKeyboard;
