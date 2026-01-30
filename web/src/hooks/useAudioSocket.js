/**
 * WebSocket hook for real-time audio transmission updates.
 *
 * Manages:
 * - WebSocket connection to Django Channels audio endpoint
 * - Automatic reconnection with exponential backoff
 * - New transmission handling and autoplay queue integration
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { getWebSocketUrl, RECONNECT_CONFIG, getReconnectDelay } from '../utils/websocket';
import {
  globalAudioState,
  notifySubscribers,
  processGlobalAutoplayQueue,
  AUTOPLAY_MAX_AGE_MS
} from './useAudioState';

// Reconnection state for audio socket
let audioReconnectAttempt = 0;
let audioReconnectTimeout = null;
let lastApiBase = '';

// Reset reconnection and try again (for manual retry after failure)
export const retryAudioSocket = () => {
  audioReconnectAttempt = 0;
  globalAudioState.socketReconnectFailed = false;
  notifySubscribers({ socketReconnectFailed: false });

  // Close existing socket if any
  if (globalAudioState.socket) {
    globalAudioState.socket.close(1000, 'Manual retry');
    globalAudioState.socket = null;
  }

  // Reinitialize
  initAudioSocket(lastApiBase);
};

// Handle new transmission from socket
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
    ...transmission
  };

  // Add to recent transmissions or update existing one
  const existingIndex = globalAudioState.recentTransmissions.findIndex(t => t.id === transmission.id);
  if (existingIndex !== -1) {
    // Update existing transmission (e.g., when transcript completes)
    globalAudioState.recentTransmissions[existingIndex] = enrichedTransmission;
    globalAudioState.recentTransmissions = [...globalAudioState.recentTransmissions];
    notifySubscribers({ updatedTransmission: enrichedTransmission });
  } else {
    // Add new transmission
    globalAudioState.recentTransmissions = [enrichedTransmission, ...globalAudioState.recentTransmissions].slice(0, 50);
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
        console.log('Skipping stale transmission for autoplay:', enrichedTransmission.id, `(${Math.round(transmissionAge / 1000)}s old)`);
        return;
      }

      // Skip if transmission was created before autoplay was enabled
      if (transmissionTime < globalAudioState.autoplayEnabledAt) {
        console.log('Skipping pre-autoplay transmission:', enrichedTransmission.id);
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

// Initialize native WebSocket connection for real-time audio
// Django Channels uses /ws/audio/ endpoint
export const initAudioSocket = (apiBase = '') => {
  // Store for retry
  lastApiBase = apiBase;

  // Don't create duplicate connections
  if (globalAudioState.socket && globalAudioState.socket.readyState === WebSocket.OPEN) {
    return globalAudioState.socket;
  }

  // Don't create if connecting
  if (globalAudioState.socket && globalAudioState.socket.readyState === WebSocket.CONNECTING) {
    return globalAudioState.socket;
  }

  // Django Channels uses /ws/audio/ endpoint (no topic query param needed)
  const wsUrl = getWebSocketUrl(apiBase, 'audio');
  console.log('Initializing global audio WebSocket:', wsUrl);

  const socket = new WebSocket(wsUrl);
  globalAudioState.socket = socket;

  socket.onopen = () => {
    console.log('Global audio WebSocket connected');
    globalAudioState.socketConnected = true;
    globalAudioState.socketReconnectFailed = false;
    audioReconnectAttempt = 0;
    notifySubscribers({ socketConnected: true, socketReconnectFailed: false });

    // Django Channels AudioConsumer auto-subscribes, no need to send subscribe message
  };

  socket.onclose = (event) => {
    console.log('Global audio WebSocket disconnected:', event.code, event.reason);
    globalAudioState.socketConnected = false;
    notifySubscribers({ socketConnected: false });

    // Reconnect if not a clean close (code 1000 or 1001)
    if (event.code !== 1000 && event.code !== 1001) {
      const maxAttempts = 10;
      const delay = getReconnectDelay(audioReconnectAttempt, {
        ...RECONNECT_CONFIG,
        maxAttempts,
      });

      if (audioReconnectAttempt < maxAttempts) {
        console.log(`Audio WebSocket reconnecting in ${delay}ms (attempt ${audioReconnectAttempt + 1})`);
        audioReconnectAttempt++;

        audioReconnectTimeout = setTimeout(() => {
          initAudioSocket(apiBase);
        }, delay);
      } else {
        // Max attempts reached - notify user
        console.error('Audio WebSocket: Max reconnection attempts reached');
        globalAudioState.socketReconnectFailed = true;
        notifySubscribers({ socketReconnectFailed: true });
      }
    }
  };

  socket.onerror = (event) => {
    console.error('Global audio WebSocket error:', event);
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      // Handle pong response (for heartbeat if needed)
      if (data.type === 'pong') {
        return;
      }

      // Handle audio transmission events from Django Channels
      // Django sends: { type: 'audio.transmission' or 'transmission', ... }
      if (data.type === 'audio.transmission' || data.type === 'transmission' || data.type === 'audio:transmission') {
        console.log('New audio transmission via WebSocket:', data.data || data);
        handleNewTransmission(data.data || data);
      }

      // Handle transcript updates
      if (data.type === 'audio.transcript_update' || data.type === 'transcript_update') {
        console.log('Transcript update via WebSocket:', data.data || data);
        handleNewTransmission(data.data || data);
      }
    } catch (err) {
      console.error('Audio WebSocket message parse error:', err);
    }
  };

  return socket;
};

// Disconnect the global audio socket
export const disconnectAudioSocket = () => {
  // Clear any pending reconnection
  if (audioReconnectTimeout) {
    clearTimeout(audioReconnectTimeout);
    audioReconnectTimeout = null;
  }
  audioReconnectAttempt = 0;

  if (globalAudioState.socket) {
    globalAudioState.socket.close(1000, 'Client closing');
    globalAudioState.socket = null;
    globalAudioState.socketConnected = false;
  }
};

/**
 * Hook for managing audio WebSocket connection.
 * Returns connection state and real-time transmissions.
 */
export function useAudioSocket(apiBase) {
  const [socketConnected, setSocketConnected] = useState(globalAudioState.socketConnected);
  const [socketReconnectFailed, setSocketReconnectFailed] = useState(globalAudioState.socketReconnectFailed);
  const [realtimeTransmissions, setRealtimeTransmissions] = useState([]);
  const socketRef = useRef(null);

  // Initialize and manage socket connection
  useEffect(() => {
    // Initialize the shared socket (will be no-op if already connected)
    const socket = initAudioSocket(apiBase);
    socketRef.current = socket;

    // Subscribe to new transmissions from global state
    const unsubscribe = (callback => {
      globalAudioState.subscribers.push(callback);
      return () => {
        globalAudioState.subscribers = globalAudioState.subscribers.filter(cb => cb !== callback);
      };
    })((updates) => {
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
        // Update existing transmission in local realtime list (e.g., transcript completed)
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
    });

    // Initialize socket connected state
    setSocketConnected(globalAudioState.socketConnected);

    return () => {
      unsubscribe();
      // Don't disconnect the shared socket - it persists across components
    };
  }, [apiBase]);

  // Retry connection
  const retry = useCallback(() => {
    retryAudioSocket();
  }, []);

  return {
    socketConnected,
    socketReconnectFailed,
    realtimeTransmissions,
    retry,
  };
}

export default useAudioSocket;
