import React, { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { Radio, Search, Play, Pause, Volume2, VolumeX, RefreshCw, ChevronDown, AlertCircle, CheckCircle, Clock, Loader2, FileAudio, Mic, PlayCircle, Radar } from 'lucide-react';
import { useApi } from '../../hooks';
import { io } from 'socket.io-client';

// Global audio state to persist across page navigation
const globalAudioState = {
  audioRefs: {},
  playingId: null,
  audioProgress: {},
  audioDurations: {},
  progressIntervalRef: null,
  autoplay: false,
  subscribers: []
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

// Export for external access
export const getGlobalAudioState = () => globalAudioState;
export const subscribeToAudioStateChanges = subscribeToAudioState;

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
  formatDuration,
  formatFileSize,
  getStatusInfo
}) {
  const id = transmission.id;
  const statusInfo = getStatusInfo(transmission.transcription_status);
  const StatusIcon = statusInfo.icon;

  return (
    <div className={`audio-item ${isPlaying ? 'playing' : ''}`}>
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

export function AudioView({ apiBase }) {
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

  // Build endpoint with filters
  const statusParam = statusFilter !== 'all' ? `&status=${statusFilter}` : '';
  const channelParam = channelFilter !== 'all' ? `&channel=${encodeURIComponent(channelFilter)}` : '';
  const endpoint = `/api/v1/audio/transmissions?hours=${hours[timeRange]}&limit=100${statusParam}${channelParam}`;

  const { data, loading, refetch } = useApi(endpoint, null, apiBase);
  const { data: statsData } = useApi('/api/v1/audio/stats', null, apiBase);
  const { data: statusData } = useApi('/api/v1/audio/status', null, apiBase);

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

  // Filter transmissions by search (uses mergedTransmissions for realtime updates)
  const filteredTransmissions = useMemo(() => {
    if (!mergedTransmissions.length) return [];

    if (!searchQuery) return mergedTransmissions;

    const query = searchQuery.toLowerCase();
    return mergedTransmissions.filter(t =>
      t.channel_name?.toLowerCase().includes(query) ||
      t.transcript?.toLowerCase().includes(query) ||
      t.filename?.toLowerCase().includes(query) ||
      t.frequency_mhz?.toString().includes(query)
    );
  }, [mergedTransmissions, searchQuery]);

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
        globalAudioState.playingId = null;
        globalAudioState.audioProgress[next.id] = 0;
        notifySubscribers({ playingId: null, audioProgress: { ...globalAudioState.audioProgress } });
        setPlayingId(null);
        setAudioProgress(prev => ({ ...prev, [next.id]: 0 }));
        // Play next in queue
        processAutoplayQueue();
      });

      audio.addEventListener('error', () => {
        cleanup();
        console.warn(`Failed to load audio ${next.id}, trying next file...`);
        // Don't clear playingId here - let autoplay continue
        // Try next file immediately
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

      audio.play().then(() => {
        globalAudioState.playingId = next.id;
        notifySubscribers({ playingId: next.id });
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
        // Don't clear playingId here - let autoplay continue
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
        globalAudioState.audioProgress[id] = 0;
        notifySubscribers({ playingId: null, audioProgress: { ...globalAudioState.audioProgress } });
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
        notifySubscribers({ playingId: null });
        setPlayingId(null);
      });
    }

    if (globalAudioState.playingId === id) {
      // Pause
      audio.pause();
      globalAudioState.playingId = null;
      notifySubscribers({ playingId: null });
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

      audio.play().catch(err => {
        console.error('Failed to play audio:', err);
      });
      globalAudioState.playingId = id;
      notifySubscribers({ playingId: id });
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
    }
  };

  const handleSeek = (id, e) => {
    const audio = audioRefs[id];
    if (!audio) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    audio.currentTime = percent * audio.duration;
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

  // Socket.IO connection for real-time audio updates
  useEffect(() => {
    let socketUrl;
    if (apiBase) {
      try {
        const url = new URL(apiBase, window.location.origin);
        socketUrl = `${url.protocol}//${url.host}`;
      } catch (e) {
        socketUrl = window.location.origin;
      }
    } else {
      socketUrl = window.location.origin;
    }

    const socket = io(socketUrl, {
      path: '/socket.io/socket.io',
      query: { topics: 'audio' },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Audio socket connected');
      setSocketConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('Audio socket disconnected');
      setSocketConnected(false);
    });

    socket.on('audio:transmission', (transmission) => {
      console.log('New audio transmission:', transmission);

      // Enrich transmission with defaults for missing metadata
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
        s3_url: transmission.s3_url || '',
        ...transmission // Spread to preserve all original fields
      };

      // Add to realtime list (prepend)
      setRealtimeTransmissions(prev => {
        const exists = prev.some(t => t.id === transmission.id);
        if (exists) return prev;
        return [enrichedTransmission, ...prev].slice(0, 50);
      });

      // Queue for autoplay if enabled
      if (autoplay && enrichedTransmission.s3_url) {
        // Always add to front of queue (latest first)
        autoplayQueueRef.current.unshift(enrichedTransmission);
        // Keep queue size manageable
        autoplayQueueRef.current = autoplayQueueRef.current.slice(0, 10);
        processAutoplayQueue();
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [apiBase, autoplay, processAutoplayQueue]);

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
