/**
 * useAudioPlayback hook for managing audio playback functionality.
 *
 * Handles:
 * - Play/pause audio
 * - Seek within audio
 * - Volume control
 * - Autoplay queue processing
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { globalAudioState, notifySubscribers } from './useAudioState';

/**
 * Hook for managing audio playback.
 */
export function useAudioPlayback({ audioRefs, filteredTransmissionsRef }) {
  const [localPlayingId, setLocalPlayingId] = useState(globalAudioState.playingId);
  const [localAudioProgress, setLocalAudioProgress] = useState(globalAudioState.audioProgress);
  const [localAudioDurations, setLocalAudioDurations] = useState(globalAudioState.audioDurations);
  const [localAutoplay, setLocalAutoplay] = useState(globalAudioState.autoplay);
  const [audioVolume, setAudioVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  const autoplayQueueRef = useRef([]);
  const processAutoplayQueueRef = useRef(null);
  // Lock to prevent concurrent processing of autoplay queue
  const isProcessingQueueRef = useRef(false);

  // Refs to capture latest state values for use in async callbacks (avoid stale closures)
  const localAutoplayRef = useRef(localAutoplay);
  const isMutedRef = useRef(isMuted);
  const audioVolumeRef = useRef(audioVolume);

  // Keep refs in sync with state
  useEffect(() => {
    localAutoplayRef.current = localAutoplay;
  }, [localAutoplay]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    audioVolumeRef.current = audioVolume;
  }, [audioVolume]);

  // Track audio event listeners for cleanup (Map of audioId -> { loadedmetadata, ended, error })
  const audioListenersRef = useRef(new Map());

  // Track mounted state to prevent state updates after unmount
  const isMountedRef = useRef(true);

  // Subscribe to global audio state changes
  useEffect(() => {
    const unsubscribe = ((callback) => {
      globalAudioState.subscribers.push(callback);
      return () => {
        globalAudioState.subscribers = globalAudioState.subscribers.filter((cb) => cb !== callback);
      };
    })((updates) => {
      if ('playingId' in updates) setLocalPlayingId(updates.playingId);
      if ('audioProgress' in updates) setLocalAudioProgress(updates.audioProgress);
      if ('audioDurations' in updates) setLocalAudioDurations(updates.audioDurations);
      if ('autoplay' in updates) {
        setLocalAutoplay(updates.autoplay);
        if (
          updates.autoplay &&
          autoplayQueueRef.current.length > 0 &&
          processAutoplayQueueRef.current
        ) {
          setTimeout(() => processAutoplayQueueRef.current?.(), 0);
        }
      }
    });
    return unsubscribe;
  }, []);

  /**
   * Helper to remove and clean up audio event listeners for a given audio ID.
   */
  const removeAudioListeners = useCallback((audioId, audio) => {
    const listeners = audioListenersRef.current.get(audioId);
    if (listeners && audio) {
      if (listeners.loadedmetadata) {
        audio.removeEventListener('loadedmetadata', listeners.loadedmetadata);
      }
      if (listeners.ended) {
        audio.removeEventListener('ended', listeners.ended);
      }
      if (listeners.error) {
        audio.removeEventListener('error', listeners.error);
      }
    }
    audioListenersRef.current.delete(audioId);
  }, []);

  // Autoplay queue processor
  const processAutoplayQueue = useCallback(() => {
    // Use refs to get latest state values (avoid stale closures)
    if (!localAutoplayRef.current || globalAudioState.playingId) return;

    // Prevent concurrent processing - check and set lock atomically
    if (isProcessingQueueRef.current) return;
    isProcessingQueueRef.current = true;

    const next = autoplayQueueRef.current.shift();
    if (!next || !next.s3_url) {
      // No item to process, release lock
      isProcessingQueueRef.current = false;
      return;
    }

    const audio = new Audio(next.s3_url);
    audio.volume = isMutedRef.current ? 0 : audioVolumeRef.current;
    audioRefs[next.id] = audio;

    let loadTimeout = null;
    const cleanup = () => {
      if (loadTimeout) clearTimeout(loadTimeout);
    };

    // Helper to release lock and continue processing
    const releaseAndContinue = () => {
      isProcessingQueueRef.current = false;
      processAutoplayQueue();
    };

    // Create named handler functions so they can be removed later
    const handleLoadedMetadata = function () {
      cleanup();
      globalAudioState.audioDurations[next.id] = audio.duration;
      notifySubscribers({ audioDurations: { ...globalAudioState.audioDurations } });
      if (isMountedRef.current) {
        setLocalAudioDurations((prev) => ({ ...prev, [next.id]: audio.duration }));
      }
    };

    const handleEnded = function () {
      cleanup();
      if (globalAudioState.progressIntervalRef) {
        clearInterval(globalAudioState.progressIntervalRef);
        globalAudioState.progressIntervalRef = null;
      }
      globalAudioState.playingId = null;
      globalAudioState.currentTransmission = null;
      globalAudioState.audioProgress[next.id] = 0;
      notifySubscribers({
        playingId: null,
        currentTransmission: null,
        audioProgress: { ...globalAudioState.audioProgress },
      });
      if (isMountedRef.current) {
        setLocalPlayingId(null);
        setLocalAudioProgress((prev) => ({ ...prev, [next.id]: 0 }));
      }
      releaseAndContinue();
    };

    const handleError = function () {
      cleanup();
      if (globalAudioState.progressIntervalRef) {
        clearInterval(globalAudioState.progressIntervalRef);
        globalAudioState.progressIntervalRef = null;
      }
      console.warn(`Failed to load audio ${next.id}, trying next file...`);
      globalAudioState.playingId = null;
      globalAudioState.currentTransmission = null;
      notifySubscribers({ playingId: null, currentTransmission: null });
      if (isMountedRef.current) {
        setLocalPlayingId(null);
      }
      releaseAndContinue();
    };

    // Store listeners for later cleanup
    audioListenersRef.current.set(next.id, {
      loadedmetadata: handleLoadedMetadata,
      ended: handleEnded,
      error: handleError,
    });

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    loadTimeout = setTimeout(() => {
      console.warn(`Audio ${next.id} took too long to load, trying next file...`);
      audio.pause();
      audio.src = '';
      releaseAndContinue();
    }, 10000);

    if (globalAudioState.progressIntervalRef) {
      clearInterval(globalAudioState.progressIntervalRef);
      globalAudioState.progressIntervalRef = null;
    }

    audio
      .play()
      .then(() => {
        // Update state FIRST before releasing lock to prevent race condition
        // where next processAutoplayQueue sees empty playingId
        globalAudioState.playingId = next.id;
        globalAudioState.currentTransmission = next;
        notifySubscribers({ playingId: next.id, currentTransmission: next });
        if (isMountedRef.current) {
          setLocalPlayingId(next.id);
        }
        globalAudioState.progressIntervalRef = setInterval(() => {
          if (audio && !audio.paused) {
            const progress = (audio.currentTime / audio.duration) * 100 || 0;
            globalAudioState.audioProgress[next.id] = progress;
            notifySubscribers({ audioProgress: { ...globalAudioState.audioProgress } });
            if (isMountedRef.current) {
              setLocalAudioProgress((prev) => ({ ...prev, [next.id]: progress }));
            }
          }
        }, 100);

        // Release lock AFTER state is updated
        // (next processAutoplayQueue will see playingId is set and exit early)
        isProcessingQueueRef.current = false;
      })
      .catch((err) => {
        cleanup();
        console.warn(`Autoplay failed for ${next.id}: ${err.message}, trying next file...`);
        globalAudioState.playingId = null;
        globalAudioState.currentTransmission = null;
        notifySubscribers({ playingId: null, currentTransmission: null });
        if (isMountedRef.current) {
          setLocalPlayingId(null);
        }
        releaseAndContinue();
      });
  }, [audioRefs, removeAudioListeners]);

  // Store processAutoplayQueue in ref
  useEffect(() => {
    processAutoplayQueueRef.current = processAutoplayQueue;
  }, [processAutoplayQueue]);

  // Ref to store handlePlay for use in event handlers to avoid stale closures
  const handlePlayRef = useRef(null);

  // Audio playback handler
  const handlePlay = useCallback(
    (transmission) => {
      const id = transmission.id;

      // Stop any currently playing audio and clean up its listeners
      if (globalAudioState.playingId && globalAudioState.playingId !== id) {
        const prevId = globalAudioState.playingId;
        const prevAudio = audioRefs[prevId];
        if (prevAudio) {
          prevAudio.pause();
          prevAudio.currentTime = 0;
          // Clean up old listeners to prevent memory leak
          removeAudioListeners(prevId, prevAudio);
        }
      }

      // Get or create audio element
      let audio = audioRefs[id];
      if (!audio) {
        const audioUrl = transmission.s3_url || transmission.audio_url;
        if (!audioUrl) {
          console.warn('No audio URL for transmission:', id);
          return;
        }
        audio = new Audio(audioUrl);
        audio.volume = isMuted ? 0 : audioVolume;
        audioRefs[id] = audio;

        // Create named handler functions so they can be removed later
        const handleLoadedMetadata = function () {
          globalAudioState.audioDurations[id] = audio.duration;
          notifySubscribers({ audioDurations: { ...globalAudioState.audioDurations } });
          setLocalAudioDurations((prev) => ({ ...prev, [id]: audio.duration }));
        };

        const handleEnded = function () {
          globalAudioState.playingId = null;
          globalAudioState.currentTransmission = null;
          globalAudioState.audioProgress[id] = 0;
          notifySubscribers({
            playingId: null,
            currentTransmission: null,
            audioProgress: { ...globalAudioState.audioProgress },
          });
          setLocalPlayingId(null);
          setLocalAudioProgress((prev) => ({ ...prev, [id]: 0 }));

          // Autoplay next transmission - use handlePlayRef to get current function (avoid stale closure)
          if (globalAudioState.autoplay && filteredTransmissionsRef?.current) {
            const transmissions = filteredTransmissionsRef.current;
            const currentIndex = transmissions.findIndex((t) => t.id === id);
            if (currentIndex !== -1 && currentIndex < transmissions.length - 1) {
              const nextTransmission = transmissions[currentIndex + 1];
              if (nextTransmission && nextTransmission.s3_url) {
                setTimeout(() => handlePlayRef.current?.(nextTransmission), 100);
              }
            }
          }
        };

        const handleError = function (e) {
          console.error('Audio playback error:', e);
          globalAudioState.playingId = null;
          globalAudioState.currentTransmission = null;
          notifySubscribers({ playingId: null, currentTransmission: null });
          setLocalPlayingId(null);
        };

        // Store listeners for later cleanup
        audioListenersRef.current.set(id, {
          loadedmetadata: handleLoadedMetadata,
          ended: handleEnded,
          error: handleError,
        });

        audio.addEventListener('loadedmetadata', handleLoadedMetadata);
        audio.addEventListener('ended', handleEnded);
        audio.addEventListener('error', handleError);
      }

      if (globalAudioState.playingId === id) {
        // Pause
        audio.pause();
        globalAudioState.playingId = null;
        globalAudioState.currentTransmission = null;
        notifySubscribers({ playingId: null, currentTransmission: null });
        setLocalPlayingId(null);
        if (globalAudioState.progressIntervalRef) {
          clearInterval(globalAudioState.progressIntervalRef);
          globalAudioState.progressIntervalRef = null;
        }
      } else {
        // Play - enable autoplay
        if (!globalAudioState.autoplay) {
          globalAudioState.autoplay = true;
          notifySubscribers({ autoplay: true });
          setLocalAutoplay(true);
        }

        if (globalAudioState.progressIntervalRef) {
          clearInterval(globalAudioState.progressIntervalRef);
          globalAudioState.progressIntervalRef = null;
        }

        audio
          .play()
          .then(() => {
            globalAudioState.playingId = id;
            globalAudioState.currentTransmission = transmission;
            notifySubscribers({ playingId: id, currentTransmission: transmission });
            setLocalPlayingId(id);

            globalAudioState.progressIntervalRef = setInterval(() => {
              if (audio && !audio.paused) {
                const progress = (audio.currentTime / audio.duration) * 100 || 0;
                globalAudioState.audioProgress[id] = progress;
                notifySubscribers({ audioProgress: { ...globalAudioState.audioProgress } });
                setLocalAudioProgress((prev) => ({ ...prev, [id]: progress }));
              }
            }, 100);
          })
          .catch((err) => {
            console.error('Failed to play audio:', err);
            globalAudioState.playingId = null;
            globalAudioState.currentTransmission = null;
            notifySubscribers({ playingId: null, currentTransmission: null });
            setLocalPlayingId(null);
          });
      }
    },
    [audioRefs, isMuted, audioVolume, filteredTransmissionsRef, removeAudioListeners]
  );

  // Keep handlePlayRef in sync to avoid stale closures in event handlers
  useEffect(() => {
    handlePlayRef.current = handlePlay;
  }, [handlePlay]);

  // Seek handler
  const handleSeek = useCallback(
    (id, e) => {
      const audio = audioRefs[id];
      if (!audio) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const duration = audio.duration;

      if (!isFinite(duration) || duration <= 0) return;

      audio.currentTime = percent * duration;
      globalAudioState.audioProgress[id] = percent * 100;
      notifySubscribers({ audioProgress: { ...globalAudioState.audioProgress } });
      setLocalAudioProgress((prev) => ({ ...prev, [id]: percent * 100 }));
    },
    [audioRefs]
  );

  // Volume handlers
  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const newMuted = !prev;
      Object.values(audioRefs).forEach((audio) => {
        if (audio) audio.volume = newMuted ? 0 : audioVolume;
      });
      return newMuted;
    });
  }, [audioRefs, audioVolume]);

  const handleVolumeChange = useCallback(
    (vol) => {
      setAudioVolume(vol);
      if (!isMuted) {
        Object.values(audioRefs).forEach((audio) => {
          if (audio) audio.volume = vol;
        });
      }
    },
    [audioRefs, isMuted]
  );

  // Autoplay toggle handler
  const handleToggleAutoplay = useCallback(
    (realtimeTransmissions, filteredTransmissions) => {
      const newAutoplay = !localAutoplay;
      setLocalAutoplay(newAutoplay);
      globalAudioState.autoplay = newAutoplay;
      notifySubscribers({ autoplay: newAutoplay });

      if (newAutoplay && !globalAudioState.playingId) {
        const next = realtimeTransmissions[0] || filteredTransmissions[0];
        if (next && next.s3_url) {
          autoplayQueueRef.current = [next];
          handlePlay(next);
        }
      }
    },
    [localAutoplay, handlePlay]
  );

  // Cleanup on unmount - clear intervals AND remove all audio event listeners
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;

      // Clear progress interval
      if (globalAudioState.progressIntervalRef) {
        clearInterval(globalAudioState.progressIntervalRef);
        globalAudioState.progressIntervalRef = null;
      }

      // Remove all audio event listeners
      for (const [audioId, listeners] of audioListenersRef.current.entries()) {
        const audio = audioRefs[audioId];
        if (audio && listeners) {
          if (listeners.loadedmetadata) {
            audio.removeEventListener('loadedmetadata', listeners.loadedmetadata);
          }
          if (listeners.ended) {
            audio.removeEventListener('ended', listeners.ended);
          }
          if (listeners.error) {
            audio.removeEventListener('error', listeners.error);
          }
        }
      }
      audioListenersRef.current.clear();
    };
  }, [audioRefs]);

  return {
    playingId: localPlayingId,
    audioProgress: localAudioProgress,
    audioDurations: localAudioDurations,
    autoplay: localAutoplay,
    audioVolume,
    isMuted,
    handlePlay,
    handleSeek,
    toggleMute,
    handleVolumeChange,
    handleToggleAutoplay,
  };
}

export default useAudioPlayback;
