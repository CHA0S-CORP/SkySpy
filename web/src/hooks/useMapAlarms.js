import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Hook for managing map alarms and notifications
 * Handles audio alerts for safety events and browser notifications
 */
export function useMapAlarms() {
  const [soundMuted, setSoundMuted] = useState(() =>
    localStorage.getItem('adsb-sound-muted') === 'true'
  );

  const audioContextRef = useRef(null);
  const alarmPlayingRef = useRef(false);
  const alarmIntervalRef = useRef(null);
  const notifiedEventsRef = useRef(new Set());
  const notifiedEmergenciesRef = useRef(new Set());

  // Save sound muted preference
  useEffect(() => {
    localStorage.setItem('adsb-sound-muted', soundMuted.toString());
  }, [soundMuted]);

  // Initialize audio context on user interaction
  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume if suspended (browser autoplay policy)
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  // Send browser notification
  const sendNotification = useCallback((title, body, tag, urgent = false) => {
    console.log(`[SkySpy Notification] ${title}: ${body}`);

    if (typeof Notification === 'undefined') {
      console.warn('Notifications not supported in this browser');
      return;
    }

    if (Notification.permission !== 'granted') {
      console.warn('Notification permission not granted');
      return;
    }

    try {
      const notif = new Notification(title, {
        body,
        icon: '/static/favicon.svg',
        tag,
        requireInteraction: urgent,
        silent: false
      });

      if (!urgent) {
        setTimeout(() => notif.close(), 10000);
      }
    } catch (e) {
      console.warn('Notification failed:', e);
    }
  }, []);

  // Play Stage 1 alarm - double ding (low severity) - yellow
  const playAlarmStage1 = useCallback(() => {
    if (soundMuted || alarmPlayingRef.current) return;

    try {
      const audioCtx = initAudioContext();
      if (!audioCtx) return;

      const now = audioCtx.currentTime;

      const playDing = (startTime) => {
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.connect(gain1);
        gain1.connect(audioCtx.destination);
        osc1.frequency.value = 2200;
        osc1.type = 'sine';

        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);
        osc2.frequency.value = 3300;
        osc2.type = 'sine';

        const osc3 = audioCtx.createOscillator();
        const gain3 = audioCtx.createGain();
        osc3.connect(gain3);
        gain3.connect(audioCtx.destination);
        osc3.frequency.value = 1100;
        osc3.type = 'sine';

        const peakTime = startTime + 0.01;
        const endTime = startTime + 0.4;

        gain1.gain.setValueAtTime(0, startTime);
        gain1.gain.linearRampToValueAtTime(0.25, peakTime);
        gain1.gain.exponentialRampToValueAtTime(0.001, endTime);

        gain2.gain.setValueAtTime(0, startTime);
        gain2.gain.linearRampToValueAtTime(0.1, peakTime);
        gain2.gain.exponentialRampToValueAtTime(0.001, startTime + 0.2);

        gain3.gain.setValueAtTime(0, startTime);
        gain3.gain.linearRampToValueAtTime(0.08, peakTime);
        gain3.gain.exponentialRampToValueAtTime(0.001, endTime);

        osc1.start(startTime);
        osc1.stop(endTime);
        osc2.start(startTime);
        osc2.stop(startTime + 0.2);
        osc3.start(startTime);
        osc3.stop(endTime);
      };

      playDing(now);
      playDing(now + 0.5);

      alarmPlayingRef.current = true;
      setTimeout(() => {
        alarmPlayingRef.current = false;
      }, 1200);
    } catch (e) {
      console.warn('Could not play alarm sound:', e);
    }
  }, [soundMuted, initAudioContext]);

  // Play Stage 2 alarm - rapid triple ding (warning severity) - orange
  const playAlarmStage2 = useCallback(() => {
    if (soundMuted || alarmPlayingRef.current) return;

    try {
      const audioCtx = initAudioContext();
      if (!audioCtx) return;

      const now = audioCtx.currentTime;

      const playDing = (startTime) => {
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.connect(gain1);
        gain1.connect(audioCtx.destination);
        osc1.frequency.value = 2200;
        osc1.type = 'sine';

        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);
        osc2.frequency.value = 3300;
        osc2.type = 'sine';

        const osc3 = audioCtx.createOscillator();
        const gain3 = audioCtx.createGain();
        osc3.connect(gain3);
        gain3.connect(audioCtx.destination);
        osc3.frequency.value = 1100;
        osc3.type = 'sine';

        const peakTime = startTime + 0.008;
        const endTime = startTime + 0.25;

        gain1.gain.setValueAtTime(0, startTime);
        gain1.gain.linearRampToValueAtTime(0.3, peakTime);
        gain1.gain.exponentialRampToValueAtTime(0.001, endTime);

        gain2.gain.setValueAtTime(0, startTime);
        gain2.gain.linearRampToValueAtTime(0.12, peakTime);
        gain2.gain.exponentialRampToValueAtTime(0.001, startTime + 0.12);

        gain3.gain.setValueAtTime(0, startTime);
        gain3.gain.linearRampToValueAtTime(0.1, peakTime);
        gain3.gain.exponentialRampToValueAtTime(0.001, endTime);

        osc1.start(startTime);
        osc1.stop(endTime);
        osc2.start(startTime);
        osc2.stop(startTime + 0.12);
        osc3.start(startTime);
        osc3.stop(endTime);
      };

      playDing(now);
      playDing(now + 0.2);
      playDing(now + 0.4);

      alarmPlayingRef.current = true;
      setTimeout(() => {
        alarmPlayingRef.current = false;
      }, 800);
    } catch (e) {
      console.warn('Could not play alarm sound:', e);
    }
  }, [soundMuted, initAudioContext]);

  // Play Stage 3 alarm - high-low siren (critical severity) - pink
  const playAlarmStage3 = useCallback(() => {
    if (soundMuted || alarmPlayingRef.current) return;

    try {
      const audioCtx = initAudioContext();
      if (!audioCtx) return;

      const now = audioCtx.currentTime;

      const playTone = (startTime, freq, duration) => {
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.connect(gain1);
        gain1.connect(audioCtx.destination);
        osc1.frequency.value = freq;
        osc1.type = 'sine';

        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);
        osc2.frequency.value = freq * 1.5;
        osc2.type = 'sine';

        const peakTime = startTime + 0.02;
        const endTime = startTime + duration;

        gain1.gain.setValueAtTime(0, startTime);
        gain1.gain.linearRampToValueAtTime(0.35, peakTime);
        gain1.gain.setValueAtTime(0.35, endTime - 0.05);
        gain1.gain.linearRampToValueAtTime(0, endTime);

        gain2.gain.setValueAtTime(0, startTime);
        gain2.gain.linearRampToValueAtTime(0.15, peakTime);
        gain2.gain.setValueAtTime(0.15, endTime - 0.05);
        gain2.gain.linearRampToValueAtTime(0, endTime);

        osc1.start(startTime);
        osc1.stop(endTime);
        osc2.start(startTime);
        osc2.stop(endTime);
      };

      // High-low-high-low pattern
      playTone(now, 1800, 0.25);
      playTone(now + 0.25, 1200, 0.25);
      playTone(now + 0.5, 1800, 0.25);
      playTone(now + 0.75, 1200, 0.25);

      alarmPlayingRef.current = true;
      setTimeout(() => {
        alarmPlayingRef.current = false;
      }, 1200);
    } catch (e) {
      console.warn('Could not play alarm sound:', e);
    }
  }, [soundMuted, initAudioContext]);

  // Play alarm based on severity
  const playConflictAlarm = useCallback((severity = 'low') => {
    switch (severity) {
      case 'critical':
        playAlarmStage3();
        break;
      case 'warning':
        playAlarmStage2();
        break;
      default:
        playAlarmStage1();
    }
  }, [playAlarmStage1, playAlarmStage2, playAlarmStage3]);

  // Get highest severity from events
  const getHighestSeverity = useCallback((events) => {
    if (events.some(e => e.severity === 'critical')) return 'critical';
    if (events.some(e => e.severity === 'warning')) return 'warning';
    return 'low';
  }, []);

  // Start looping alarm
  const startAlarmLoop = useCallback((severity = 'low') => {
    if (alarmIntervalRef.current || soundMuted) return;

    playConflictAlarm(severity);

    const interval = severity === 'critical' ? 1500 : severity === 'warning' ? 2500 : 3000;

    alarmIntervalRef.current = setInterval(() => {
      playConflictAlarm(severity);
    }, interval);
  }, [playConflictAlarm, soundMuted]);

  // Stop the alarm loop
  const stopAlarmLoop = useCallback(() => {
    if (alarmIntervalRef.current) {
      clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    }
  }, []);

  // Stop alarm when muted
  useEffect(() => {
    if (soundMuted) {
      stopAlarmLoop();
    }
  }, [soundMuted, stopAlarmLoop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAlarmLoop();
    };
  }, [stopAlarmLoop]);

  // Check if event was already notified
  const wasEventNotified = useCallback((eventKey) => {
    return notifiedEventsRef.current.has(eventKey);
  }, []);

  // Mark event as notified
  const markEventNotified = useCallback((eventKey) => {
    notifiedEventsRef.current.add(eventKey);
  }, []);

  // Check if emergency was already notified
  const wasEmergencyNotified = useCallback((emergencyKey) => {
    return notifiedEmergenciesRef.current.has(emergencyKey);
  }, []);

  // Mark emergency as notified
  const markEmergencyNotified = useCallback((emergencyKey) => {
    notifiedEmergenciesRef.current.add(emergencyKey);
  }, []);

  // Clear old notified events
  const clearOldNotifications = useCallback((currentEventKeys) => {
    notifiedEventsRef.current.forEach(key => {
      if (!currentEventKeys.has(key)) {
        setTimeout(() => notifiedEventsRef.current.delete(key), 300000); // 5 min
      }
    });
  }, []);

  // Clear emergency notification
  const clearEmergencyNotification = useCallback((emergencyKey) => {
    setTimeout(() => notifiedEmergenciesRef.current.delete(emergencyKey), 600000); // 10 min
  }, []);

  return {
    soundMuted,
    setSoundMuted,
    sendNotification,
    playConflictAlarm,
    getHighestSeverity,
    startAlarmLoop,
    stopAlarmLoop,
    wasEventNotified,
    markEventNotified,
    wasEmergencyNotified,
    markEmergencyNotified,
    clearOldNotifications,
    clearEmergencyNotification,
    initAudioContext,
  };
}

export default useMapAlarms;
