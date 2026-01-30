/**
 * Socket.IO hook for real-time audio transmission updates (replaces useAudioSocket).
 *
 * Features:
 * - Connects to /audio namespace for dedicated audio stream
 * - Handles transmission events
 * - Integrates with global autoplay queue
 * - Automatic reconnection with retry capability
 *
 * @module useSocketIOAudio
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSocketIO } from './useSocketIO';
import {
  globalAudioState,
  notifySubscribers,
  processGlobalAutoplayQueue,
  AUTOPLAY_MAX_AGE_MS,
} from '../useAudioState';

/**
 * Audio socket manager for shared state across hook instances.
 * Uses a singleton pattern with proper encapsulation.
 */
const audioSocketManager = {
  reconnectFailed: false,
  apiBase: '',
  socketRef: null,
  reconnectCallback: null,

  setSocketRef(ref) {
    this.socketRef = ref;
  },

  setApiBase(base) {
    this.apiBase = base;
  },

  setReconnectCallback(callback) {
    this.reconnectCallback = callback;
  },

  reset() {
    this.reconnectFailed = false;
    globalAudioState.socketReconnectFailed = false;
    notifySubscribers({ socketReconnectFailed: false });
  },

  disconnect() {
    if (this.socketRef?.current?.connected) {
      this.socketRef.current.disconnect();
    }
  },
};

/**
 * Reset reconnection and try again (for manual retry after failure)
 */
export const retrySocketIOAudio = () => {
  audioSocketManager.reset();
  audioSocketManager.disconnect();
  // The reconnect will be triggered by the hook's reconnect function
  if (audioSocketManager.reconnectCallback) {
    audioSocketManager.reconnectCallback();
  }
};

/**
 * Handle new transmission from socket
 *
 * @param {Object} transmission - Transmission data
 */
const handleNewTransmission = (transmission) => {
  // Enrich transmission with defaults
  const enrichedTransmission = {
    channel_name: transmission.channel_name || 'Unknown Channel',
    frequency_mhz: transmission.frequency_mhz || 0,
    format: transmission.format || 'mp3',
    file_size_bytes: transmission.file_size_bytes || 0,
    transcription_status: transmission.transcription_status || 'pending',
    transcript: transmission.transcript || null,
    transcript_confidence: transmission.transcript_confidence || null,
    transcript_language: transmission.transcript_language || null,
    transcription_error: transmission.transcription_error || null,
    created_at: transmission.created_at || new Date().toISOString(),
    filename: transmission.filename || '',
    s3_url: transmission.s3_url || transmission.audio_url || '',
    ...transmission,
  };

  // Add to recent transmissions or update existing one
  const existingIndex = globalAudioState.recentTransmissions.findIndex(
    t => t.id === transmission.id
  );

  if (existingIndex !== -1) {
    // Update existing transmission (e.g., when transcript completes)
    globalAudioState.recentTransmissions[existingIndex] = enrichedTransmission;
    globalAudioState.recentTransmissions = [...globalAudioState.recentTransmissions];
    notifySubscribers({ updatedTransmission: enrichedTransmission });
  } else {
    // Add new transmission
    globalAudioState.recentTransmissions = [
      enrichedTransmission,
      ...globalAudioState.recentTransmissions,
    ].slice(0, 50);
    notifySubscribers({ newTransmission: enrichedTransmission });
  }

  // Queue for autoplay if enabled and matches filter
  if (globalAudioState.autoplay && enrichedTransmission.s3_url) {
    const now = Date.now();

    // Only queue transmissions that arrived AFTER autoplay was enabled
    // This prevents playing old/stale transmissions when autoplay is toggled on
    if (globalAudioState.autoplayEnabledAt) {
      const transmissionTime = new Date(enrichedTransmission.created_at).getTime();
      const transmissionAge = now - transmissionTime;

      // Skip if transmission is older than max age threshold
      if (transmissionAge > AUTOPLAY_MAX_AGE_MS) {
        console.log(
          '[useSocketIOAudio] Skipping stale transmission for autoplay:',
          enrichedTransmission.id,
          `(${Math.round(transmissionAge / 1000)}s old)`
        );
        return;
      }

      // Skip if transmission was created before autoplay was enabled
      if (transmissionTime < globalAudioState.autoplayEnabledAt) {
        console.log(
          '[useSocketIOAudio] Skipping pre-autoplay transmission:',
          enrichedTransmission.id
        );
        return;
      }
    }

    const filter = globalAudioState.autoplayFilter;

    // Check if transmission matches filter (if set)
    let matchesFilter = true;
    if (filter) {
      // Check if any identified airframe matches the filter
      const airframes = enrichedTransmission.identified_airframes || [];
      matchesFilter = airframes.some(af => {
        if (filter.hex && af.icao_hex?.toUpperCase() === filter.hex.toUpperCase()) return true;
        if (filter.callsign && af.callsign?.toUpperCase() === filter.callsign.toUpperCase()) return true;
        return false;
      });
    }

    if (matchesFilter) {
      // Add to end of queue (oldest first, play in chronological order)
      globalAudioState.autoplayQueue.push(enrichedTransmission);
      globalAudioState.autoplayQueue = globalAudioState.autoplayQueue.slice(-10);

      // Process queue if nothing is currently playing
      if (!globalAudioState.playingId) {
        processGlobalAutoplayQueue();
      }
    }
  }
};

/**
 * Hook for managing audio Socket.IO connection.
 * Returns connection state and real-time transmissions.
 *
 * @param {string} apiBase - API base URL
 * @returns {Object} Audio socket state and methods
 */
export function useSocketIOAudio(apiBase) {
  const [socketConnected, setSocketConnected] = useState(globalAudioState.socketConnected);
  const [socketReconnectFailed, setSocketReconnectFailed] = useState(
    globalAudioState.socketReconnectFailed
  );
  const [realtimeTransmissions, setRealtimeTransmissions] = useState([]);
  const mountedRef = useRef(true);

  // Store apiBase for retry functionality using the manager
  useEffect(() => {
    audioSocketManager.setApiBase(apiBase);
  }, [apiBase]);

  /**
   * Handle Socket.IO connection
   */
  const handleConnect = useCallback(() => {
    console.log('[useSocketIOAudio] Socket.IO connected to /audio namespace');
    globalAudioState.socketConnected = true;
    globalAudioState.socketReconnectFailed = false;
    audioSocketManager.reconnectFailed = false;
    notifySubscribers({ socketConnected: true, socketReconnectFailed: false });
  }, []);

  /**
   * Handle Socket.IO disconnection
   */
  const handleDisconnect = useCallback((reason) => {
    console.log('[useSocketIOAudio] Socket.IO disconnected:', reason);
    globalAudioState.socketConnected = false;
    notifySubscribers({ socketConnected: false });
  }, []);

  /**
   * Handle Socket.IO error
   */
  const handleError = useCallback((err) => {
    console.error('[useSocketIOAudio] Socket.IO error:', err.message);
  }, []);

  // Setup Socket.IO connection to /audio namespace
  const {
    connected,
    socketRef,
    on,
    reconnect: socketReconnect,
  } = useSocketIO({
    enabled: true,
    apiBase,
    namespace: '/audio',
    path: '/socket.io',
    onConnect: handleConnect,
    onDisconnect: handleDisconnect,
    onError: handleError,
    reconnectConfig: {
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
    },
  });

  // Store socket ref for module-level access (via manager)
  useEffect(() => {
    audioSocketManager.setSocketRef(socketRef);
  }, [socketRef]);

  // Setup event listeners for audio events
  useEffect(() => {
    // Listen for audio transmission events
    // Django sends: { type: 'audio.transmission' or 'transmission', ... }
    const audioEvents = [
      'audio.transmission',
      'transmission',
      'audio:transmission',
    ];

    const unsubscribers = audioEvents.map(eventType => {
      return on(eventType, (data) => {
        console.log('[useSocketIOAudio] New audio transmission via Socket.IO:', data);
        handleNewTransmission(data);
      });
    });

    // Handle transcript updates (legacy events)
    const transcriptEvents = [
      'audio.transcript_update',
      'transcript_update',
    ];

    const transcriptUnsubscribers = transcriptEvents.map(eventType => {
      return on(eventType, (data) => {
        console.log('[useSocketIOAudio] Transcript update via Socket.IO:', data);
        handleNewTransmission(data);
      });
    });

    // Handle transcription state events from backend
    // These provide real-time status updates for transcription progress
    const transcriptionStartedUnsub = on('audio:transcription_started', (data) => {
      console.log('[useSocketIOAudio] Transcription started:', data);
      if (data?.id) {
        // Update existing transmission with 'transcribing' status
        const existingIndex = globalAudioState.recentTransmissions.findIndex(
          t => t.id === data.id
        );
        if (existingIndex !== -1) {
          globalAudioState.recentTransmissions[existingIndex] = {
            ...globalAudioState.recentTransmissions[existingIndex],
            transcription_status: 'transcribing',
          };
          globalAudioState.recentTransmissions = [...globalAudioState.recentTransmissions];
          notifySubscribers({ updatedTransmission: globalAudioState.recentTransmissions[existingIndex] });
        }
      }
    });

    const transcriptionCompletedUnsub = on('audio:transcription_completed', (data) => {
      console.log('[useSocketIOAudio] Transcription completed:', data);
      if (data?.id) {
        // Update existing transmission with completed transcription
        const existingIndex = globalAudioState.recentTransmissions.findIndex(
          t => t.id === data.id
        );
        if (existingIndex !== -1) {
          globalAudioState.recentTransmissions[existingIndex] = {
            ...globalAudioState.recentTransmissions[existingIndex],
            transcription_status: 'completed',
            transcript: data.transcript || data.text || globalAudioState.recentTransmissions[existingIndex].transcript,
            transcript_confidence: data.confidence ?? data.transcript_confidence ?? globalAudioState.recentTransmissions[existingIndex].transcript_confidence,
            transcript_language: data.language ?? data.transcript_language ?? globalAudioState.recentTransmissions[existingIndex].transcript_language,
            identified_airframes: data.identified_airframes ?? globalAudioState.recentTransmissions[existingIndex].identified_airframes,
          };
          globalAudioState.recentTransmissions = [...globalAudioState.recentTransmissions];
          notifySubscribers({ updatedTransmission: globalAudioState.recentTransmissions[existingIndex] });
        } else {
          // Transmission not in list yet, add it
          handleNewTransmission(data);
        }
      }
    });

    const transcriptionFailedUnsub = on('audio:transcription_failed', (data) => {
      console.log('[useSocketIOAudio] Transcription failed:', data);
      if (data?.id) {
        // Update existing transmission with failed status
        const existingIndex = globalAudioState.recentTransmissions.findIndex(
          t => t.id === data.id
        );
        if (existingIndex !== -1) {
          globalAudioState.recentTransmissions[existingIndex] = {
            ...globalAudioState.recentTransmissions[existingIndex],
            transcription_status: 'failed',
            transcription_error: data.error || data.message || 'Transcription failed',
          };
          globalAudioState.recentTransmissions = [...globalAudioState.recentTransmissions];
          notifySubscribers({ updatedTransmission: globalAudioState.recentTransmissions[existingIndex] });
        }
      }
    });

    return () => {
      unsubscribers.forEach(unsub => unsub && unsub());
      transcriptUnsubscribers.forEach(unsub => unsub && unsub());
      transcriptionStartedUnsub && transcriptionStartedUnsub();
      transcriptionCompletedUnsub && transcriptionCompletedUnsub();
      transcriptionFailedUnsub && transcriptionFailedUnsub();
    };
  }, [on]);

  // Subscribe to global audio state changes
  useEffect(() => {
    mountedRef.current = true;

    const unsubscribe = (() => {
      const callback = (updates) => {
        if (!mountedRef.current) return;

        if ('socketConnected' in updates) {
          setSocketConnected(updates.socketConnected);
        }
        if ('socketReconnectFailed' in updates) {
          setSocketReconnectFailed(updates.socketReconnectFailed);
        }
        if ('newTransmission' in updates && updates.newTransmission) {
          // Add to local realtime list for this view
          setRealtimeTransmissions(prev => {
            const exists = prev.some(t => t.id === updates.newTransmission.id);
            if (exists) return prev;
            return [updates.newTransmission, ...prev].slice(0, 50);
          });
        }
        if ('updatedTransmission' in updates && updates.updatedTransmission) {
          // Update existing transmission in local realtime list
          setRealtimeTransmissions(prev => {
            const index = prev.findIndex(t => t.id === updates.updatedTransmission.id);
            if (index !== -1) {
              const updated = [...prev];
              updated[index] = updates.updatedTransmission;
              return updated;
            }
            return prev;
          });
        }
      };

      // Use Set for O(1) add/remove and to prevent duplicates
      // Note: globalAudioState.subscribers should be a Set, but for backwards
      // compatibility we handle both array and Set patterns safely
      if (Array.isArray(globalAudioState.subscribers)) {
        globalAudioState.subscribers = [...globalAudioState.subscribers, callback];
      } else {
        globalAudioState.subscribers.add(callback);
      }

      return () => {
        if (Array.isArray(globalAudioState.subscribers)) {
          // Create new array to avoid mutation during iteration
          globalAudioState.subscribers = globalAudioState.subscribers.filter(
            cb => cb !== callback
          );
        } else {
          globalAudioState.subscribers.delete(callback);
        }
      };
    })();

    // Initialize socket connected state
    setSocketConnected(globalAudioState.socketConnected);

    return () => {
      mountedRef.current = false;
      unsubscribe();
      // Don't disconnect the shared socket - it persists across components
    };
  }, []);

  // Sync connected state
  useEffect(() => {
    if (mountedRef.current) {
      setSocketConnected(connected);
      globalAudioState.socketConnected = connected;
    }
  }, [connected]);

  /**
   * Retry connection
   */
  const retry = useCallback(() => {
    audioSocketManager.reset();
    socketReconnect();
  }, [socketReconnect]);

  // Register reconnect callback with manager for external retry calls
  useEffect(() => {
    audioSocketManager.setReconnectCallback(socketReconnect);
    return () => {
      audioSocketManager.setReconnectCallback(null);
    };
  }, [socketReconnect]);

  return {
    socketConnected,
    socketReconnectFailed,
    realtimeTransmissions,
    retry,
  };
}

export default useSocketIOAudio;
