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
import {
  globalAudioState,
  notifySubscribers,
} from './useAudioState';

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

  // Subscribe to global audio state changes
  useEffect(() => {
    const unsubscribe = (callback => {
      globalAudioState.subscribers.push(callback);
      return () => {
        globalAudioState.subscribers = globalAudioState.subscribers.filter(cb => cb !== callback);
      };
    })((updates) => {
      if ('playingId' in updates) setLocalPlayingId(updates.playingId);
      if ('audioProgress' in updates) setLocalAudioProgress(updates.audioProgress);
      if ('audioDurations' in updates) setLocalAudioDurations(updates.audioDurations);
      if ('autoplay' in updates) {
        setLocalAutoplay(updates.autoplay);
        if (updates.autoplay && autoplayQueueRef.current.length > 0 && processAutoplayQueueRef.current) {
          setTimeout(() => processAutoplayQueueRef.current?.(), 0);
        }
      }
    });
    return unsubscribe;
  }, []);

  // Autoplay queue processor
  const processAutoplayQueue = useCallback(() => {
    if (!localAutoplay || globalAudioState.playingId) return;

    const next = autoplayQueueRef.current.shift();
    if (next && next.s3_url) {
      const audio = new Audio(next.s3_url);
      audio.volume = isMuted ? 0 : audioVolume;
      audioRefs[next.id] = audio;

      let loadTimeout;
      const cleanup = () => {
        if (loadTimeout) clearTimeout(loadTimeout);
      };

      audio.addEventListener('loadedmetadata', () => {
        cleanup();
        globalAudioState.audioDurations[next.id] = audio.duration;
        notifySubscribers({ audioDurations: { ...globalAudioState.audioDurations } });
        setLocalAudioDurations(prev => ({ ...prev, [next.id]: audio.duration }));
      });

      audio.addEventListener('ended', () => {
        cleanup();
        if (globalAudioState.progressIntervalRef) {
          clearInterval(globalAudioState.progressIntervalRef);
          globalAudioState.progressIntervalRef = null;
        }
        globalAudioState.playingId = null;
        globalAudioState.currentTransmission = null;
        globalAudioState.audioProgress[next.id] = 0;
        notifySubscribers({ playingId: null, currentTransmission: null, audioProgress: { ...globalAudioState.audioProgress } });
        setLocalPlayingId(null);
        setLocalAudioProgress(prev => ({ ...prev, [next.id]: 0 }));
        processAutoplayQueue();
      });

      audio.addEventListener('error', () => {
        cleanup();
        if (globalAudioState.progressIntervalRef) {
          clearInterval(globalAudioState.progressIntervalRef);
          globalAudioState.progressIntervalRef = null;
        }
        console.warn(`Failed to load audio ${next.id}, trying next file...`);
        globalAudioState.playingId = null;
        globalAudioState.currentTransmission = null;
        notifySubscribers({ playingId: null, currentTransmission: null });
        setLocalPlayingId(null);
        processAutoplayQueue();
      });

      loadTimeout = setTimeout(() => {
        console.warn(`Audio ${next.id} took too long to load, trying next file...`);
        audio.pause();
        audio.src = '';
        processAutoplayQueue();
      }, 10000);

      if (globalAudioState.progressIntervalRef) {
        clearInterval(globalAudioState.progressIntervalRef);
        globalAudioState.progressIntervalRef = null;
      }

      audio.play().then(() => {
        globalAudioState.playingId = next.id;
        globalAudioState.currentTransmission = next;
        notifySubscribers({ playingId: next.id, currentTransmission: next });
        setLocalPlayingId(next.id);
        globalAudioState.progressIntervalRef = setInterval(() => {
          if (audio && !audio.paused) {
            const progress = (audio.currentTime / audio.duration) * 100 || 0;
            globalAudioState.audioProgress[next.id] = progress;
            notifySubscribers({ audioProgress: { ...globalAudioState.audioProgress } });
            setLocalAudioProgress(prev => ({ ...prev, [next.id]: progress }));
          }
        }, 100);
      }).catch(err => {
        cleanup();
        console.warn(`Autoplay failed for ${next.id}: ${err.message}, trying next file...`);
        globalAudioState.playingId = null;
        globalAudioState.currentTransmission = null;
        notifySubscribers({ playingId: null, currentTransmission: null });
        setLocalPlayingId(null);
        processAutoplayQueue();
      });
    }
  }, [localAutoplay, isMuted, audioVolume, audioRefs]);

  // Store processAutoplayQueue in ref
  useEffect(() => {
    processAutoplayQueueRef.current = processAutoplayQueue;
  }, [processAutoplayQueue]);

  // Audio playback handler
  const handlePlay = useCallback((transmission) => {
    const id = transmission.id;

    // Stop any currently playing audio
    if (globalAudioState.playingId && globalAudioState.playingId !== id) {
      const prevAudio = audioRefs[globalAudioState.playingId];
      if (prevAudio) {
        prevAudio.pause();
        prevAudio.currentTime = 0;
      }
    }

    // Get or create audio element
    let audio = audioRefs[id];
    if (!audio) {
      audio = new Audio(transmission.s3_url);
      audio.volume = isMuted ? 0 : audioVolume;
      audioRefs[id] = audio;

      audio.addEventListener('loadedmetadata', () => {
        globalAudioState.audioDurations[id] = audio.duration;
        notifySubscribers({ audioDurations: { ...globalAudioState.audioDurations } });
        setLocalAudioDurations(prev => ({ ...prev, [id]: audio.duration }));
      });

      audio.addEventListener('ended', () => {
        globalAudioState.playingId = null;
        globalAudioState.currentTransmission = null;
        globalAudioState.audioProgress[id] = 0;
        notifySubscribers({ playingId: null, currentTransmission: null, audioProgress: { ...globalAudioState.audioProgress } });
        setLocalPlayingId(null);
        setLocalAudioProgress(prev => ({ ...prev, [id]: 0 }));

        // Autoplay next transmission
        if (globalAudioState.autoplay && filteredTransmissionsRef?.current) {
          const transmissions = filteredTransmissionsRef.current;
          const currentIndex = transmissions.findIndex(t => t.id === id);
          if (currentIndex !== -1 && currentIndex < transmissions.length - 1) {
            const nextTransmission = transmissions[currentIndex + 1];
            if (nextTransmission && nextTransmission.s3_url) {
              setTimeout(() => handlePlay(nextTransmission), 100);
            }
          }
        }
      });

      audio.addEventListener('error', (e) => {
        console.error('Audio playback error:', e);
        globalAudioState.playingId = null;
        globalAudioState.currentTransmission = null;
        notifySubscribers({ playingId: null, currentTransmission: null });
        setLocalPlayingId(null);
      });
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

      audio.play().then(() => {
        globalAudioState.playingId = id;
        globalAudioState.currentTransmission = transmission;
        notifySubscribers({ playingId: id, currentTransmission: transmission });
        setLocalPlayingId(id);

        globalAudioState.progressIntervalRef = setInterval(() => {
          if (audio && !audio.paused) {
            const progress = (audio.currentTime / audio.duration) * 100 || 0;
            globalAudioState.audioProgress[id] = progress;
            notifySubscribers({ audioProgress: { ...globalAudioState.audioProgress } });
            setLocalAudioProgress(prev => ({ ...prev, [id]: progress }));
          }
        }, 100);
      }).catch(err => {
        console.error('Failed to play audio:', err);
        globalAudioState.playingId = null;
        globalAudioState.currentTransmission = null;
        notifySubscribers({ playingId: null, currentTransmission: null });
        setLocalPlayingId(null);
      });
    }
  }, [audioRefs, isMuted, audioVolume, filteredTransmissionsRef]);

  // Seek handler
  const handleSeek = useCallback((id, e) => {
    const audio = audioRefs[id];
    if (!audio) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const duration = audio.duration;

    if (!isFinite(duration) || duration <= 0) return;

    audio.currentTime = percent * duration;
    globalAudioState.audioProgress[id] = percent * 100;
    notifySubscribers({ audioProgress: { ...globalAudioState.audioProgress } });
    setLocalAudioProgress(prev => ({ ...prev, [id]: percent * 100 }));
  }, [audioRefs]);

  // Volume handlers
  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      const newMuted = !prev;
      Object.values(audioRefs).forEach(audio => {
        if (audio) audio.volume = newMuted ? 0 : audioVolume;
      });
      return newMuted;
    });
  }, [audioRefs, audioVolume]);

  const handleVolumeChange = useCallback((vol) => {
    setAudioVolume(vol);
    if (!isMuted) {
      Object.values(audioRefs).forEach(audio => {
        if (audio) audio.volume = vol;
      });
    }
  }, [audioRefs, isMuted]);

  // Autoplay toggle handler
  const handleToggleAutoplay = useCallback((realtimeTransmissions, filteredTransmissions) => {
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
  }, [localAutoplay, handlePlay]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (globalAudioState.progressIntervalRef) {
        clearInterval(globalAudioState.progressIntervalRef);
      }
    };
  }, []);

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
