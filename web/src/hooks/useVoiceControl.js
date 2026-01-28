/**
 * useVoiceControl - Hook for voice command recognition
 *
 * Supports hands-free commands:
 * - "mute" / "unmute" / "voice off" / "voice on"
 * - "radar" / "radar view"
 * - "single" / "single view"
 * - "grid" / "grid view"
 * - "heads up" / "hud"
 * - "settings"
 * - "exit" / "close"
 * - "report" / "status" (announces current threat status)
 */
import { useState, useEffect, useCallback, useRef } from 'react';

// Speech recognition API (cross-browser)
const SpeechRecognition = typeof window !== 'undefined'
  ? window.SpeechRecognition || window.webkitSpeechRecognition
  : null;

// Command patterns and their actions
const COMMANDS = [
  { patterns: ['mute', 'voice off', 'quiet'], action: 'mute' },
  { patterns: ['unmute', 'voice on', 'speak'], action: 'unmute' },
  { patterns: ['radar', 'radar view', 'radar mode'], action: 'mode_radar' },
  { patterns: ['single', 'single view', 'single mode'], action: 'mode_single' },
  { patterns: ['grid', 'grid view', 'grid mode'], action: 'mode_grid' },
  { patterns: ['heads up', 'hud', 'hud view', 'heads-up'], action: 'mode_headsUp' },
  { patterns: ['settings', 'open settings'], action: 'settings' },
  { patterns: ['exit', 'close', 'quit', 'back'], action: 'exit' },
  { patterns: ['report', 'status', 'what\'s up', 'situation'], action: 'report' },
  { patterns: ['next', 'next threat'], action: 'next' },
  { patterns: ['previous', 'prev', 'previous threat'], action: 'previous' },
  { patterns: ['dismiss', 'clear', 'deselect'], action: 'dismiss' },
];

/**
 * Match transcript to command
 */
function matchCommand(transcript) {
  const text = transcript.toLowerCase().trim();

  for (const cmd of COMMANDS) {
    for (const pattern of cmd.patterns) {
      if (text.includes(pattern)) {
        return cmd.action;
      }
    }
  }

  return null;
}

/**
 * Voice control hook
 */
export function useVoiceControl({
  enabled = false,
  onCommand,
  continuous = true,
} = {}) {
  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState(null);
  const [lastCommand, setLastCommand] = useState(null);
  const [lastTranscript, setLastTranscript] = useState('');

  const recognitionRef = useRef(null);
  const restartTimeoutRef = useRef(null);

  // Check support
  useEffect(() => {
    setIsSupported(!!SpeechRecognition);
  }, []);

  // Initialize recognition
  useEffect(() => {
    if (!isSupported || !enabled) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = continuous;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
    };

    recognition.onend = () => {
      setIsListening(false);

      // Auto-restart if enabled and continuous
      if (enabled && continuous) {
        restartTimeoutRef.current = setTimeout(() => {
          try {
            recognition.start();
          } catch (err) {
            // Already started or other error
          }
        }, 100);
      }
    };

    recognition.onerror = (event) => {
      // Ignore no-speech and aborted errors
      if (event.error === 'no-speech' || event.error === 'aborted') {
        return;
      }
      setError(event.error);
      setIsListening(false);
    };

    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      if (last.isFinal) {
        const transcript = last[0].transcript;
        setLastTranscript(transcript);

        const command = matchCommand(transcript);
        if (command) {
          setLastCommand(command);
          onCommand?.(command, transcript);
        }
      }
    };

    recognitionRef.current = recognition;

    // Start listening
    try {
      recognition.start();
    } catch (err) {
      setError('Failed to start voice recognition');
    }

    return () => {
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current);
      }
      try {
        recognition.stop();
      } catch (err) {
        // Already stopped
      }
      recognitionRef.current = null;
    };
  }, [isSupported, enabled, continuous, onCommand]);

  // Start listening
  const startListening = useCallback(() => {
    if (!recognitionRef.current) return;

    try {
      recognitionRef.current.start();
    } catch (err) {
      // Already started
    }
  }, []);

  // Stop listening
  const stopListening = useCallback(() => {
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
    }
    if (!recognitionRef.current) return;

    try {
      recognitionRef.current.stop();
    } catch (err) {
      // Already stopped
    }
  }, []);

  return {
    isSupported,
    isListening,
    error,
    lastCommand,
    lastTranscript,
    startListening,
    stopListening,
  };
}

export default useVoiceControl;
