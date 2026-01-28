import React, { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { Radio, Search, Play, Pause, Volume2, VolumeX, RefreshCw, ChevronDown, AlertCircle, CheckCircle, Clock, Loader2, FileAudio, Mic, PlayCircle, Radar, Plane, Filter, X } from 'lucide-react';
import { useSocketApi } from '../../hooks';
import { getWebSocketUrl, RECONNECT_CONFIG, getReconnectDelay } from '../../utils/websocket';

// Emergency keywords for filtering distress calls
const EMERGENCY_KEYWORDS = [
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
const hasEmergencyKeyword = (transcript) => {
  if (!transcript) return false;
  const lowerTranscript = transcript.toLowerCase();
  return EMERGENCY_KEYWORDS.some(keyword => lowerTranscript.includes(keyword));
};

// Maximum age (in ms) for a transmission to be eligible for autoplay
// Transmissions older than this are skipped to avoid playing stale audio
const AUTOPLAY_MAX_AGE_MS = 30000; // 30 seconds

// Global audio state to persist across page navigation
const globalAudioState = {
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
const subscribeToAudioState = (callback) => {
  globalAudioState.subscribers.push(callback);
  return () => {
    globalAudioState.subscribers = globalAudioState.subscribers.filter(cb => cb !== callback);
  };
};

// Notify all subscribers of state changes
const notifySubscribers = (updates) => {
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

// Process the global autoplay queue
const processGlobalAutoplayQueue = () => {
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
const playAudioFromGlobal = (transmission) => {
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

// Memoized Audio Item Component
const AudioItem = memo(function AudioItem({
  transmission,
  isPlaying,
  progress,
  duration,
  isExpanded,
  onPlay,
  onSeek,
  onToggleExpand,
  onSelectAircraft,
  formatDuration,
  formatFileSize,
  getStatusInfo
}) {
  const id = transmission.id;
  const statusInfo = getStatusInfo(transmission.transcription_status);
  const StatusIcon = statusInfo.icon;
  const isEmergency = hasEmergencyKeyword(transmission.transcript);

  return (
    <div className={`audio-item ${isPlaying ? 'playing' : ''} ${isEmergency ? 'emergency' : ''}`}>
      <div className="audio-item-main">
        {/* Play Button */}
        <button
          className={`audio-play-btn ${isPlaying ? 'playing' : ''}`}
          onClick={() => onPlay(transmission)}
          disabled={!transmission.s3_url}
          title={transmission.s3_url ? (isPlaying ? 'Pause' : 'Play') : 'No audio URL'}
        >
          {isPlaying ? <Pause size={20} /> : <Play size={20} />}
        </button>

        {/* Info */}
        <div className="audio-item-info">
          <div className="audio-item-header">
            <span className="audio-channel">{transmission.channel_name || 'Unknown Channel'}</span>
            {isEmergency && (
              <span className="emergency-badge">
                <AlertCircle size={10} />
                Emergency
              </span>
            )}
            {transmission.frequency_mhz && (
              <span className="audio-frequency">{transmission.frequency_mhz.toFixed(3)} MHz</span>
            )}
            <span className="audio-time">
              {new Date(transmission.created_at).toLocaleString()}
            </span>
          </div>

          {/* Progress Bar */}
          <div className="audio-progress-container" onClick={(e) => onSeek(id, e)}>
            <div className="audio-progress-bar">
              <div
                className="audio-progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="audio-duration">
              <span>{formatDuration((progress / 100) * duration)}</span>
              <span>{formatDuration(duration)}</span>
            </div>
          </div>

          {/* Transcript Preview */}
          {transmission.transcript && (
            <div className="audio-transcript-preview">
              <p className="transcript-preview-text">{transmission.transcript}</p>
              {transmission.transcript_confidence && (
                <span className="transcript-preview-confidence">
                  {(transmission.transcript_confidence * 100).toFixed(0)}% confidence
                </span>
              )}
            </div>
          )}

          {/* Identified Flights */}
          {transmission.identified_airframes && transmission.identified_airframes.length > 0 && (
            <div className="audio-identified-flights">
              {transmission.identified_airframes.map((airframe, idx) => (
                <button
                  key={`${airframe.callsign}-${idx}`}
                  className={`flight-tag ${airframe.type || 'unknown'}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onSelectAircraft) {
                      onSelectAircraft(null, airframe.callsign);
                    }
                  }}
                  title={`${airframe.raw_text || airframe.callsign}${airframe.airline_name ? ` (${airframe.airline_name})` : ''}${airframe.confidence ? ` - ${(airframe.confidence * 100).toFixed(0)}% confidence` : ''}`}
                >
                  <Plane size={12} />
                  <span className="flight-callsign">{airframe.callsign}</span>
                  {airframe.airline_name && (
                    <span className="flight-airline">{airframe.airline_name}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {transmission.transcription_error && (
            <div className="audio-transcript-error">
              <AlertCircle size={12} />
              <span>{transmission.transcription_error}</span>
            </div>
          )}
          {!transmission.transcript && !transmission.transcription_error && transmission.transcription_status !== 'processing' && transmission.transcription_status !== 'queued' && (
            <div className="audio-transcript-empty">
              <Mic size={12} />
              <span>No transcript available</span>
            </div>
          )}
        </div>

        {/* Status Badge */}
        <div className="audio-item-status" style={{ color: statusInfo.color }}>
          <StatusIcon
            size={16}
            className={transmission.transcription_status === 'processing' ? 'spinning' : ''}
          />
          <span>{statusInfo.label}</span>
        </div>

        {/* Metadata */}
        <div className="audio-item-meta">
          <span className="audio-format">{transmission.format?.toUpperCase() || 'MP3'}</span>
          <span className="audio-size">{formatFileSize(transmission.file_size_bytes)}</span>
        </div>

        {/* Expand Button */}
        {(transmission.transcript || transmission.transcription_error) && (
          <button
            className={`audio-expand-btn ${isExpanded ? 'expanded' : ''}`}
            onClick={() => onToggleExpand(id)}
          >
            <ChevronDown size={18} />
          </button>
        )}
      </div>

      {/* Expandable Transcript Section */}
      {(transmission.transcript || transmission.transcription_error) && (
        <div className={`audio-transcript-section ${isExpanded ? 'expanded' : ''}`}>
          {transmission.transcript && (
            <div className="audio-transcript">
              <div className="transcript-header">
                <span className="transcript-label">Full Transcript</span>
                {transmission.transcript_language && (
                  <span className="transcript-language">{transmission.transcript_language.toUpperCase()}</span>
                )}
              </div>
              <p className="transcript-text">{transmission.transcript}</p>
            </div>
          )}
          {transmission.transcription_error && (
            <div className="audio-error">
              <AlertCircle size={14} />
              <span>{transmission.transcription_error}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export function AudioView({ apiBase, onSelectAircraft }) {
  const [timeRange, setTimeRange] = useState('24h');
  const [statusFilter, setStatusFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [playingId, setPlayingId] = useState(globalAudioState.playingId);
  const [audioProgress, setAudioProgress] = useState(globalAudioState.audioProgress);
  const [audioDurations, setAudioDurations] = useState(globalAudioState.audioDurations);
  const [audioVolume, setAudioVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [expandedTranscript, setExpandedTranscript] = useState({});
  const [availableChannels, setAvailableChannels] = useState([]);
  const [autoplay, setAutoplay] = useState(globalAudioState.autoplay);
  const [socketConnected, setSocketConnected] = useState(false);
  const [realtimeTransmissions, setRealtimeTransmissions] = useState([]);

  // Flight-related filters
  const [flightMatchFilter, setFlightMatchFilter] = useState('all'); // 'all', 'matched', 'unmatched'
  const [callsignFilter, setCallsignFilter] = useState('');
  const [airlineFilter, setAirlineFilter] = useState('all');
  const [flightTypeFilter, setFlightTypeFilter] = useState('all'); // 'all', 'airline', 'general_aviation', 'military'
  const [emergencyFilter, setEmergencyFilter] = useState(false); // true to show only emergency transmissions

  const audioRefs = globalAudioState.audioRefs;
  const progressIntervalRef = globalAudioState.progressIntervalRef;
  const socketRef = useRef(null);
  const autoplayQueueRef = useRef([]);
  const processAutoplayQueueRef = useRef(null);
  const filteredTransmissionsRef = useRef([]);

  // Subscribe to global audio state changes
  useEffect(() => {
    const unsubscribe = subscribeToAudioState((updates) => {
      if ('playingId' in updates) setPlayingId(updates.playingId);
      if ('audioProgress' in updates) setAudioProgress(updates.audioProgress);
      if ('audioDurations' in updates) setAudioDurations(updates.audioDurations);
      if ('autoplay' in updates) {
        setAutoplay(updates.autoplay);
        // If autoplay was just enabled, process any queued items
        if (updates.autoplay && autoplayQueueRef.current.length > 0 && processAutoplayQueueRef.current) {
          // Schedule processing on next render
          setTimeout(() => processAutoplayQueueRef.current?.(), 0);
        }
      }
    });
    return unsubscribe;
  }, []);

  const hours = { '1h': 1, '6h': 6, '24h': 24, '48h': 48, '7d': 168 };

  // Build endpoint with filters - Django API uses /api/v1/audio
  const statusParam = statusFilter !== 'all' ? `&status=${statusFilter}` : '';
  const channelParam = channelFilter !== 'all' ? `&channel=${encodeURIComponent(channelFilter)}` : '';
  const endpoint = `/api/v1/audio?hours=${hours[timeRange]}&limit=100${statusParam}${channelParam}`;

  // Note: AudioView has its own WebSocket connection for real-time audio,
  // so we just use HTTP for initial data and let the socket handle updates
  const { data, loading, refetch } = useSocketApi(endpoint, null, apiBase, {});
  // Stats endpoint - may be combined in main audio endpoint response
  const { data: statsData } = useSocketApi('/api/v1/audio?stats=true', null, apiBase, {});
  // System status for radio state
  const { data: statusData } = useSocketApi('/api/v1/system/status', null, apiBase, {});

  // Extract unique channels from stats
  useEffect(() => {
    if (statsData?.by_channel) {
      setAvailableChannels(Object.keys(statsData.by_channel));
    }
  }, [statsData]);

  useEffect(() => { refetch(); }, [timeRange, statusFilter, channelFilter, refetch]);

  // Merge realtime transmissions with API data
  const mergedTransmissions = useMemo(() => {
    const apiTransmissions = data?.transmissions || [];
    const apiIds = new Set(apiTransmissions.map(t => t.id));

    // Add realtime transmissions that aren't in API response yet
    const newFromSocket = realtimeTransmissions.filter(t => !apiIds.has(t.id));

    return [...newFromSocket, ...apiTransmissions];
  }, [data?.transmissions, realtimeTransmissions]);

  // Extract unique airlines from all transmissions
  const availableAirlines = useMemo(() => {
    const airlines = new Map();
    mergedTransmissions.forEach(t => {
      if (t.identified_airframes) {
        t.identified_airframes.forEach(af => {
          if (af.airline_icao && af.airline_name) {
            airlines.set(af.airline_icao, af.airline_name);
          }
        });
      }
    });
    return Array.from(airlines.entries())
      .map(([icao, name]) => ({ icao, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [mergedTransmissions]);

  // Filter transmissions by search and flight filters
  const filteredTransmissions = useMemo(() => {
    if (!mergedTransmissions.length) return [];

    return mergedTransmissions.filter(t => {
      // Text search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          t.channel_name?.toLowerCase().includes(query) ||
          t.transcript?.toLowerCase().includes(query) ||
          t.filename?.toLowerCase().includes(query) ||
          t.frequency_mhz?.toString().includes(query) ||
          t.identified_airframes?.some(af =>
            af.callsign?.toLowerCase().includes(query) ||
            af.airline_name?.toLowerCase().includes(query)
          );
        if (!matchesSearch) return false;
      }

      // Flight match filter
      const hasMatches = t.identified_airframes && t.identified_airframes.length > 0;
      if (flightMatchFilter === 'matched' && !hasMatches) return false;
      if (flightMatchFilter === 'unmatched' && hasMatches) return false;

      // Callsign filter
      if (callsignFilter) {
        const callsignQuery = callsignFilter.toUpperCase();
        const matchesCallsign = t.identified_airframes?.some(af =>
          af.callsign?.toUpperCase().includes(callsignQuery)
        );
        if (!matchesCallsign) return false;
      }

      // Airline filter
      if (airlineFilter !== 'all') {
        const matchesAirline = t.identified_airframes?.some(af =>
          af.airline_icao === airlineFilter
        );
        if (!matchesAirline) return false;
      }

      // Flight type filter
      if (flightTypeFilter !== 'all') {
        const matchesType = t.identified_airframes?.some(af =>
          af.type === flightTypeFilter
        );
        if (!matchesType) return false;
      }

      // Emergency keyword filter
      if (emergencyFilter && !hasEmergencyKeyword(t.transcript)) {
        return false;
      }

      return true;
    });
  }, [mergedTransmissions, searchQuery, flightMatchFilter, callsignFilter, airlineFilter, flightTypeFilter, emergencyFilter]);

  // Keep ref updated for use in event listeners
  useEffect(() => {
    filteredTransmissionsRef.current = filteredTransmissions;
  }, [filteredTransmissions]);

  // Lazy loading: only render visible items
  const [visibleCount, setVisibleCount] = useState(20);
  const loadMoreRef = useRef(null);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount(prev => Math.min(prev + 20, filteredTransmissions.length));
        }
      },
      { rootMargin: '200px' }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [filteredTransmissions.length]);

  // Define processAutoplayQueue early so it can be used in effects
  const processAutoplayQueue = useCallback(() => {
    if (!autoplay || globalAudioState.playingId) return;

    const next = autoplayQueueRef.current.shift();
    if (next && next.s3_url) {
      // Create and play audio
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
        setAudioDurations(prev => ({ ...prev, [next.id]: audio.duration }));
      });

      audio.addEventListener('ended', () => {
        cleanup();
        // Clear progress interval
        if (globalAudioState.progressIntervalRef) {
          clearInterval(globalAudioState.progressIntervalRef);
          globalAudioState.progressIntervalRef = null;
        }
        globalAudioState.playingId = null;
        globalAudioState.currentTransmission = null;
        globalAudioState.audioProgress[next.id] = 0;
        notifySubscribers({ playingId: null, currentTransmission: null, audioProgress: { ...globalAudioState.audioProgress } });
        setPlayingId(null);
        setAudioProgress(prev => ({ ...prev, [next.id]: 0 }));
        // Play next in queue
        processAutoplayQueue();
      });

      audio.addEventListener('error', () => {
        cleanup();
        // Clear progress interval on error
        if (globalAudioState.progressIntervalRef) {
          clearInterval(globalAudioState.progressIntervalRef);
          globalAudioState.progressIntervalRef = null;
        }
        console.warn(`Failed to load audio ${next.id}, trying next file...`);
        // Clear state and try next file
        globalAudioState.playingId = null;
        globalAudioState.currentTransmission = null;
        notifySubscribers({ playingId: null, currentTransmission: null });
        setPlayingId(null);
        processAutoplayQueue();
      });

      // Set timeout to skip to next file if loading takes too long (10 seconds)
      loadTimeout = setTimeout(() => {
        console.warn(`Audio ${next.id} took too long to load, trying next file...`);
        audio.pause();
        audio.src = '';
        // Don't clear playingId here - let autoplay continue
        processAutoplayQueue();
      }, 10000);

      // Clear any existing progress interval before starting new playback
      if (globalAudioState.progressIntervalRef) {
        clearInterval(globalAudioState.progressIntervalRef);
        globalAudioState.progressIntervalRef = null;
      }

      audio.play().then(() => {
        globalAudioState.playingId = next.id;
        globalAudioState.currentTransmission = next;
        notifySubscribers({ playingId: next.id, currentTransmission: next });
        setPlayingId(next.id);
        globalAudioState.progressIntervalRef = setInterval(() => {
          if (audio && !audio.paused) {
            const progress = (audio.currentTime / audio.duration) * 100 || 0;
            globalAudioState.audioProgress[next.id] = progress;
            notifySubscribers({ audioProgress: { ...globalAudioState.audioProgress } });
            setAudioProgress(prev => ({
              ...prev,
              [next.id]: progress
            }));
          }
        }, 100);
      }).catch(err => {
        cleanup();
        console.warn(`Autoplay failed for ${next.id}: ${err.message}, trying next file...`);
        // Clear state on error
        globalAudioState.playingId = null;
        globalAudioState.currentTransmission = null;
        notifySubscribers({ playingId: null, currentTransmission: null });
        setPlayingId(null);
        // Try next file
        processAutoplayQueue();
      });
    }
  }, [autoplay, isMuted, audioVolume]);

  // Audio playback handlers
  const handlePlay = (transmission) => {
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

      // Event listeners
      audio.addEventListener('loadedmetadata', () => {
        globalAudioState.audioDurations[id] = audio.duration;
        notifySubscribers({ audioDurations: { ...globalAudioState.audioDurations } });
        setAudioDurations(prev => ({ ...prev, [id]: audio.duration }));
      });

      audio.addEventListener('ended', () => {
        globalAudioState.playingId = null;
        globalAudioState.currentTransmission = null;
        globalAudioState.audioProgress[id] = 0;
        notifySubscribers({ playingId: null, currentTransmission: null, audioProgress: { ...globalAudioState.audioProgress } });
        setPlayingId(null);
        setAudioProgress(prev => ({ ...prev, [id]: 0 }));

        // Autoplay next transmission in the list
        if (globalAudioState.autoplay) {
          const transmissions = filteredTransmissionsRef.current;
          const currentIndex = transmissions.findIndex(t => t.id === id);
          if (currentIndex !== -1 && currentIndex < transmissions.length - 1) {
            const nextTransmission = transmissions[currentIndex + 1];
            if (nextTransmission && nextTransmission.s3_url) {
              // Use setTimeout to avoid state update conflicts
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
        setPlayingId(null);
      });
    }

    if (globalAudioState.playingId === id) {
      // Pause
      audio.pause();
      globalAudioState.playingId = null;
      globalAudioState.currentTransmission = null;
      notifySubscribers({ playingId: null, currentTransmission: null });
      setPlayingId(null);
      if (globalAudioState.progressIntervalRef) {
        clearInterval(globalAudioState.progressIntervalRef);
      }
    } else {
      // Play - also enable autoplay so next transmission plays automatically
      if (!globalAudioState.autoplay) {
        globalAudioState.autoplay = true;
        notifySubscribers({ autoplay: true });
        setAutoplay(true);
      }

      // Clear any existing progress interval before starting new playback
      if (globalAudioState.progressIntervalRef) {
        clearInterval(globalAudioState.progressIntervalRef);
        globalAudioState.progressIntervalRef = null;
      }

      audio.play().then(() => {
        globalAudioState.playingId = id;
        globalAudioState.currentTransmission = transmission;
        notifySubscribers({ playingId: id, currentTransmission: transmission });
        setPlayingId(id);

        // Update progress
        globalAudioState.progressIntervalRef = setInterval(() => {
          if (audio && !audio.paused) {
            const progress = (audio.currentTime / audio.duration) * 100 || 0;
            globalAudioState.audioProgress[id] = progress;
            notifySubscribers({ audioProgress: { ...globalAudioState.audioProgress } });
            setAudioProgress(prev => ({
              ...prev,
              [id]: progress
            }));
          }
        }, 100);
      }).catch(err => {
        console.error('Failed to play audio:', err);
        // Clean up state on failure
        globalAudioState.playingId = null;
        globalAudioState.currentTransmission = null;
        notifySubscribers({ playingId: null, currentTransmission: null });
        setPlayingId(null);
      });
    }
  };

  const handleSeek = (id, e) => {
    const audio = audioRefs[id];
    if (!audio) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const duration = audio.duration;

    // Validate duration before seeking
    if (!isFinite(duration) || duration <= 0) return;

    audio.currentTime = percent * duration;
    globalAudioState.audioProgress[id] = percent * 100;
    notifySubscribers({ audioProgress: { ...globalAudioState.audioProgress } });
    setAudioProgress(prev => ({ ...prev, [id]: percent * 100 }));
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
    Object.values(audioRefs).forEach(audio => {
      if (audio) audio.volume = isMuted ? audioVolume : 0;
    });
  };

  const handleVolumeChange = (e) => {
    const vol = parseFloat(e.target.value);
    setAudioVolume(vol);
    if (!isMuted) {
      Object.values(audioRefs).forEach(audio => {
        if (audio) audio.volume = vol;
      });
    }
  };

  // Cleanup on unmount - preserve audio for navigation
  useEffect(() => {
    return () => {
      // Don't clean up audio - keep playing when navigating
      // Just clear the interval for this component instance
      if (globalAudioState.progressIntervalRef) {
        clearInterval(globalAudioState.progressIntervalRef);
      }
    };
  }, []);

  // Use the shared global socket for real-time audio updates
  useEffect(() => {
    // Initialize the shared socket (will be no-op if already connected)
    const socket = initAudioSocket(apiBase);
    socketRef.current = socket;

    // Subscribe to new transmissions from global state
    const unsubscribeTransmissions = subscribeToAudioState((updates) => {
      if ('socketConnected' in updates) {
        setSocketConnected(updates.socketConnected);
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
      unsubscribeTransmissions();
      // Don't disconnect the shared socket - it persists across components
    };
  }, [apiBase]);

  // Store processAutoplayQueue in ref for use in effects
  useEffect(() => {
    processAutoplayQueueRef.current = processAutoplayQueue;
  }, [processAutoplayQueue]);

  // Format duration
  const formatDuration = (seconds) => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Format file size
  const formatFileSize = (bytes) => {
    if (!bytes) return '--';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Get status icon and color
  const getStatusInfo = (status) => {
    switch (status) {
      case 'completed':
        return { icon: CheckCircle, color: 'var(--accent-green)', label: 'Transcribed' };
      case 'processing':
        return { icon: Loader2, color: 'var(--accent-cyan)', label: 'Processing' };
      case 'queued':
        return { icon: Clock, color: 'var(--accent-yellow)', label: 'Queued' };
      case 'failed':
        return { icon: AlertCircle, color: 'var(--accent-red)', label: 'Failed' };
      default:
        return { icon: Clock, color: 'var(--text-dim)', label: 'Pending' };
    }
  };

  return (
    <div className="audio-container">
      {/* Header Stats */}
      <div className="audio-stats-bar">
        <div className="audio-stat">
          <FileAudio size={16} />
          <span className="stat-value">{statsData?.total_transmissions || 0}</span>
          <span className="stat-label">Total</span>
        </div>
        <div className="audio-stat">
          <CheckCircle size={16} className="text-green" />
          <span className="stat-value">{statsData?.total_transcribed || 0}</span>
          <span className="stat-label">Transcribed</span>
        </div>
        <div className="audio-stat">
          <Clock size={16} className="text-yellow" />
          <span className="stat-value">{statsData?.pending_transcription || 0}</span>
          <span className="stat-label">Pending</span>
        </div>
        <div className="audio-stat">
          <Mic size={16} className="text-cyan" />
          <span className="stat-value">{statsData?.total_duration_hours?.toFixed(1) || 0}h</span>
          <span className="stat-label">Duration</span>
        </div>
        <div className="audio-stat">
          <Radio size={16} />
          <span className={`stat-value ${statusData?.radio_enabled ? 'text-green' : 'text-red'}`}>
            {statusData?.radio_enabled ? 'Active' : 'Disabled'}
          </span>
          <span className="stat-label">Radio</span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="audio-toolbar">
        <div className="audio-filters">
          <div className="search-box">
            <Search size={16} />
            <input
              type="text"
              placeholder="Search transcripts, channels, frequencies..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <select
            className="audio-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Status</option>
            <option value="completed">Transcribed</option>
            <option value="processing">Processing</option>
            <option value="queued">Queued</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
          </select>

          <select
            className="audio-select"
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
          >
            <option value="all">All Channels</option>
            {availableChannels.map(channel => (
              <option key={channel} value={channel}>{channel}</option>
            ))}
          </select>

          {/* Flight Match Filter */}
          <select
            className="audio-select"
            value={flightMatchFilter}
            onChange={(e) => setFlightMatchFilter(e.target.value)}
          >
            <option value="all">All Transmissions</option>
            <option value="matched">With Flights</option>
            <option value="unmatched">No Flights</option>
          </select>

          {/* Airline Filter */}
          <select
            className="audio-select"
            value={airlineFilter}
            onChange={(e) => setAirlineFilter(e.target.value)}
            disabled={availableAirlines.length === 0}
          >
            <option value="all">All Airlines</option>
            {availableAirlines.map(airline => (
              <option key={airline.icao} value={airline.icao}>
                {airline.name} ({airline.icao})
              </option>
            ))}
          </select>

          {/* Flight Type Filter */}
          <select
            className="audio-select"
            value={flightTypeFilter}
            onChange={(e) => setFlightTypeFilter(e.target.value)}
          >
            <option value="all">All Types</option>
            <option value="airline">Commercial</option>
            <option value="general_aviation">General Aviation</option>
            <option value="military">Military</option>
          </select>

          {/* Callsign Filter */}
          <div className="callsign-filter">
            <Plane size={14} />
            <input
              type="text"
              placeholder="Callsign..."
              value={callsignFilter}
              onChange={(e) => setCallsignFilter(e.target.value)}
            />
            {callsignFilter && (
              <button
                className="clear-callsign-btn"
                onClick={() => setCallsignFilter('')}
                title="Clear callsign filter"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Emergency Filter Toggle */}
          <button
            className={`emergency-filter-btn ${emergencyFilter ? 'active' : ''}`}
            onClick={() => setEmergencyFilter(!emergencyFilter)}
            title={emergencyFilter ? 'Show all transmissions' : 'Show only emergency transmissions (mayday, pan pan, etc.)'}
          >
            <AlertCircle size={14} />
            <span>Emergency</span>
          </button>

          {/* Active Filters Indicator */}
          {(flightMatchFilter !== 'all' || airlineFilter !== 'all' || flightTypeFilter !== 'all' || callsignFilter || emergencyFilter) && (
            <button
              className="clear-filters-btn"
              onClick={() => {
                setFlightMatchFilter('all');
                setAirlineFilter('all');
                setFlightTypeFilter('all');
                setCallsignFilter('');
                setEmergencyFilter(false);
              }}
              title="Clear all flight filters"
            >
              <Filter size={14} />
              <X size={10} className="clear-icon" />
            </button>
          )}
        </div>

        <div className="audio-controls-right">
          <div className="volume-control">
            <button className="volume-btn" onClick={toggleMute}>
              {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <input
              type="range"
              className="volume-slider"
              min="0"
              max="1"
              step="0.1"
              value={audioVolume}
              onChange={handleVolumeChange}
            />
          </div>

          <div className="time-range-selector">
            {['1h', '6h', '24h', '48h', '7d'].map(range => (
              <button
                key={range}
                className={`time-btn ${timeRange === range ? 'active' : ''}`}
                onClick={() => setTimeRange(range)}
              >
                {range}
              </button>
            ))}
          </div>

          <button
            className={`autoplay-btn ${autoplay ? 'active' : ''}`}
            onClick={() => {
              const newAutoplay = !autoplay;
              setAutoplay(newAutoplay);
              globalAudioState.autoplay = newAutoplay;
              notifySubscribers({ autoplay: newAutoplay });
              
              // If enabling autoplay, start with the first realtime transmission or filtered transmission
              if (newAutoplay && !globalAudioState.playingId) {
                const next = realtimeTransmissions[0] || filteredTransmissions[0];
                if (next && next.s3_url) {
                  autoplayQueueRef.current = [next];
                  handlePlay(next);
                }
              }
            }}
            title={autoplay ? 'Disable autoplay' : 'Enable autoplay for new transmissions'}
          >
            <PlayCircle size={16} />
            <span>Auto</span>
          </button>

          <button className="refresh-btn" onClick={refetch} title="Refresh">
            <RefreshCw size={16} className={loading ? 'spinning' : ''} />
          </button>

          <div className={`socket-status ${socketConnected ? 'connected' : 'disconnected'}`} title={socketConnected ? 'Live updates active' : 'Disconnected'}>
            <span className="socket-dot" />
          </div>
        </div>
      </div>

      {/* Transmissions List */}
      <div className="audio-list">
        {loading && !data?.transmissions?.length && (
          <div className="audio-loading">
            <div className="audio-loading-radar">
              <Radar size={32} className="audio-radar-icon" />
              <div className="audio-radar-sweep" />
            </div>
            <span>Loading transmissions...</span>
          </div>
        )}

        {!loading && filteredTransmissions.length === 0 && (
          <div className="audio-empty">
            <Radio size={48} />
            <p>No audio transmissions found</p>
            <span>Transmissions from rtl-airband will appear here</span>
          </div>
        )}

        {filteredTransmissions.slice(0, visibleCount).map((transmission) => {
          const id = transmission.id;
          return (
            <AudioItem
              key={id}
              transmission={transmission}
              isPlaying={playingId === id}
              progress={audioProgress[id] || 0}
              duration={audioDurations[id] || transmission.duration_seconds}
              isExpanded={expandedTranscript[id]}
              onPlay={handlePlay}
              onSeek={handleSeek}
              onToggleExpand={(id) => setExpandedTranscript(prev => ({ ...prev, [id]: !prev[id] }))}
              onSelectAircraft={onSelectAircraft}
              formatDuration={formatDuration}
              formatFileSize={formatFileSize}
              getStatusInfo={getStatusInfo}
            />
          );
        })}

        {/* Load more sentinel */}
        {visibleCount < filteredTransmissions.length && (
          <div ref={loadMoreRef} className="audio-load-more">
            <div className="audio-loading-radar small">
              <Radar size={20} className="audio-radar-icon" />
              <div className="audio-radar-sweep" />
            </div>
            <span>Loading more...</span>
          </div>
        )}
      </div>

      {/* Count */}
      <div className="audio-footer">
        <span>
          Showing {Math.min(visibleCount, filteredTransmissions.length)} of {filteredTransmissions.length} transmissions
        </span>
      </div>
    </div>
  );
}

export default AudioView;
