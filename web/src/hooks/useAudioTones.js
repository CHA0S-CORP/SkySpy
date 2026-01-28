/**
 * useAudioTones - Alert sounds for threat detection
 *
 * Uses Web Audio API to generate tones:
 * - Critical: Urgent alarm sound
 * - Warning: Double beep
 * - Info: Soft ping
 * - New threat: Radar blip
 * - Clear: Pleasant chime
 */
import { useCallback, useRef, useEffect, useState } from 'react';

// Create audio context lazily (must be after user interaction)
let audioContextInstance = null;

const getAudioContext = () => {
  if (!audioContextInstance) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      audioContextInstance = new AudioContext();
    }
  }
  return audioContextInstance;
};

// Tone configurations
const TONES = {
  // Soft ping - info level
  info: {
    frequency: 880,
    type: 'sine',
    duration: 0.15,
    volume: 0.3,
    ramp: true,
  },

  // Double beep - warning level
  warning: {
    frequencies: [660, 880],
    type: 'square',
    duration: 0.12,
    gap: 0.1,
    volume: 0.4,
  },

  // Urgent alarm - critical level
  critical: {
    frequencies: [880, 660, 880],
    type: 'sawtooth',
    duration: 0.15,
    gap: 0.08,
    volume: 0.5,
    repeat: 2,
    repeatGap: 0.3,
  },

  // Radar blip - new threat
  newThreat: {
    frequency: 1200,
    type: 'sine',
    duration: 0.08,
    volume: 0.4,
    ramp: true,
    sweep: { from: 1200, to: 600 },
  },

  // Pleasant chime - all clear
  clear: {
    frequencies: [523, 659, 784],
    type: 'sine',
    duration: 0.2,
    gap: 0.15,
    volume: 0.3,
    ramp: true,
  },

  // Approaching tone - rising
  approaching: {
    frequency: 440,
    type: 'sine',
    duration: 0.3,
    volume: 0.35,
    sweep: { from: 440, to: 880 },
  },

  // Departing tone - falling
  departing: {
    frequency: 880,
    type: 'sine',
    duration: 0.3,
    volume: 0.3,
    sweep: { from: 880, to: 440 },
  },

  // Error beep
  error: {
    frequencies: [200, 200],
    type: 'square',
    duration: 0.25,
    gap: 0.15,
    volume: 0.4,
  },

  // Soft tick for UI
  tick: {
    frequency: 1000,
    type: 'sine',
    duration: 0.03,
    volume: 0.2,
  },

  // ETA warning - countdown feel
  etaWarning: {
    frequencies: [440, 440, 660],
    type: 'sine',
    duration: 0.1,
    gap: 0.1,
    volume: 0.35,
  },
};

export function useAudioTones({ enabled = true, volume: globalVolume = 0.7 }) {
  const [isReady, setIsReady] = useState(false);
  const activeOscillatorsRef = useRef([]);
  const lastPlayTimeRef = useRef(0);
  const minInterval = 200; // Minimum ms between sounds

  // Initialize audio context on first user interaction
  const initialize = useCallback(() => {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().then(() => setIsReady(true));
    } else if (ctx) {
      setIsReady(true);
    }
    return ctx;
  }, []);

  // Play a single tone
  const playTone = useCallback((config) => {
    const ctx = getAudioContext();
    if (!ctx || !enabled) return null;

    // Resume if suspended
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.type = config.type || 'sine';
    const volume = (config.volume || 0.5) * globalVolume;

    // Handle frequency sweep
    if (config.sweep) {
      oscillator.frequency.setValueAtTime(config.sweep.from, ctx.currentTime);
      oscillator.frequency.linearRampToValueAtTime(
        config.sweep.to,
        ctx.currentTime + config.duration
      );
    } else {
      oscillator.frequency.setValueAtTime(config.frequency, ctx.currentTime);
    }

    // Volume envelope
    if (config.ramp) {
      gainNode.gain.setValueAtTime(0, ctx.currentTime);
      gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.01);
      gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + config.duration);
    } else {
      gainNode.gain.setValueAtTime(volume, ctx.currentTime);
      gainNode.gain.setValueAtTime(0, ctx.currentTime + config.duration);
    }

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + config.duration + 0.01);

    activeOscillatorsRef.current.push(oscillator);
    oscillator.onended = () => {
      activeOscillatorsRef.current = activeOscillatorsRef.current.filter(o => o !== oscillator);
    };

    return oscillator;
  }, [enabled, globalVolume]);

  // Play a sequence of tones
  const playSequence = useCallback(async (config) => {
    const ctx = getAudioContext();
    if (!ctx || !enabled) return;

    const frequencies = config.frequencies || [config.frequency];
    const gap = config.gap || 0.1;
    const repeats = config.repeat || 1;
    const repeatGap = config.repeatGap || 0.3;

    for (let r = 0; r < repeats; r++) {
      for (let i = 0; i < frequencies.length; i++) {
        playTone({
          ...config,
          frequency: frequencies[i],
          sweep: undefined, // Sequences don't use sweep
        });

        if (i < frequencies.length - 1) {
          await new Promise(resolve => setTimeout(resolve, (config.duration + gap) * 1000));
        }
      }

      if (r < repeats - 1) {
        await new Promise(resolve => setTimeout(resolve, repeatGap * 1000));
      }
    }
  }, [enabled, playTone]);

  // Play a specific tone by name with throttling
  const play = useCallback((toneName) => {
    if (!enabled) return;

    const now = Date.now();
    if (now - lastPlayTimeRef.current < minInterval) {
      return;
    }
    lastPlayTimeRef.current = now;

    const config = TONES[toneName];
    if (!config) {
      console.warn(`Unknown tone: ${toneName}`);
      return;
    }

    if (config.frequencies) {
      playSequence(config);
    } else {
      playTone(config);
    }
  }, [enabled, playTone, playSequence]);

  // Stop all active sounds
  const stop = useCallback(() => {
    activeOscillatorsRef.current.forEach(osc => {
      try {
        osc.stop();
      } catch {
        // Already stopped
      }
    });
    activeOscillatorsRef.current = [];
  }, []);

  // Convenience methods
  const playInfo = useCallback(() => play('info'), [play]);
  const playWarning = useCallback(() => play('warning'), [play]);
  const playCritical = useCallback(() => play('critical'), [play]);
  const playNewThreat = useCallback(() => play('newThreat'), [play]);
  const playClear = useCallback(() => play('clear'), [play]);
  const playApproaching = useCallback(() => play('approaching'), [play]);
  const playDeparting = useCallback(() => play('departing'), [play]);
  const playError = useCallback(() => play('error'), [play]);
  const playTick = useCallback(() => play('tick'), [play]);
  const playEtaWarning = useCallback(() => play('etaWarning'), [play]);

  // Play appropriate tone for threat level
  const playForThreatLevel = useCallback((level) => {
    switch (level) {
      case 'critical':
        playCritical();
        break;
      case 'warning':
        playWarning();
        break;
      default:
        playInfo();
    }
  }, [playCritical, playWarning, playInfo]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stop();
  }, [stop]);

  return {
    // State
    isReady,
    initialize,

    // Core functions
    play,
    stop,

    // Convenience methods
    playInfo,
    playWarning,
    playCritical,
    playNewThreat,
    playClear,
    playApproaching,
    playDeparting,
    playError,
    playTick,
    playEtaWarning,

    // Threat-level helper
    playForThreatLevel,

    // Available tones
    tones: Object.keys(TONES),
  };
}

export default useAudioTones;
