import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Radio, Search, Play, Pause, Volume2, VolumeX, RefreshCw, ChevronDown, AlertCircle, CheckCircle, Clock, Loader2, FileAudio, Mic, PlayCircle } from 'lucide-react';
import { useApi } from '../../hooks';
import { io } from 'socket.io-client';

export function AudioView({ apiBase }) {
  const [timeRange, setTimeRange] = useState('24h');
  const [statusFilter, setStatusFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [playingId, setPlayingId] = useState(null);
  const [audioProgress, setAudioProgress] = useState({});
  const [audioDurations, setAudioDurations] = useState({});
  const [audioVolume, setAudioVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [expandedTranscript, setExpandedTranscript] = useState({});
  const [availableChannels, setAvailableChannels] = useState([]);
  const [autoplay, setAutoplay] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [realtimeTransmissions, setRealtimeTransmissions] = useState([]);

  const audioRefs = useRef({});
  const progressIntervalRef = useRef(null);
  const socketRef = useRef(null);
  const autoplayQueueRef = useRef([]);

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

  // Audio playback handlers
  const handlePlay = (transmission) => {
    const id = transmission.id;

    // Stop any currently playing audio
    if (playingId && playingId !== id) {
      const prevAudio = audioRefs.current[playingId];
      if (prevAudio) {
        prevAudio.pause();
        prevAudio.currentTime = 0;
      }
    }

    // Get or create audio element
    let audio = audioRefs.current[id];
    if (!audio) {
      audio = new Audio(transmission.s3_url);
      audio.volume = isMuted ? 0 : audioVolume;
      audioRefs.current[id] = audio;

      // Event listeners
      audio.addEventListener('loadedmetadata', () => {
        setAudioDurations(prev => ({ ...prev, [id]: audio.duration }));
      });

      audio.addEventListener('ended', () => {
        setPlayingId(null);
        setAudioProgress(prev => ({ ...prev, [id]: 0 }));
      });

      audio.addEventListener('error', (e) => {
        console.error('Audio playback error:', e);
        setPlayingId(null);
      });
    }

    if (playingId === id) {
      // Pause
      audio.pause();
      setPlayingId(null);
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    } else {
      // Play
      audio.play().catch(err => {
        console.error('Failed to play audio:', err);
      });
      setPlayingId(id);

      // Update progress
      progressIntervalRef.current = setInterval(() => {
        if (audio && !audio.paused) {
          setAudioProgress(prev => ({
            ...prev,
            [id]: (audio.currentTime / audio.duration) * 100 || 0
          }));
        }
      }, 100);
    }
  };

  const handleSeek = (id, e) => {
    const audio = audioRefs.current[id];
    if (!audio) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    audio.currentTime = percent * audio.duration;
    setAudioProgress(prev => ({ ...prev, [id]: percent * 100 }));
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
    Object.values(audioRefs.current).forEach(audio => {
      if (audio) audio.volume = isMuted ? audioVolume : 0;
    });
  };

  const handleVolumeChange = (e) => {
    const vol = parseFloat(e.target.value);
    setAudioVolume(vol);
    if (!isMuted) {
      Object.values(audioRefs.current).forEach(audio => {
        if (audio) audio.volume = vol;
      });
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      Object.values(audioRefs.current).forEach(audio => {
        if (audio) {
          audio.pause();
          audio.src = '';
        }
      });
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
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

      // Add to realtime list (prepend)
      setRealtimeTransmissions(prev => {
        const exists = prev.some(t => t.id === transmission.id);
        if (exists) return prev;
        return [transmission, ...prev].slice(0, 50);
      });

      // Queue for autoplay if enabled
      if (autoplay && transmission.s3_url) {
        autoplayQueueRef.current.push(transmission);
        processAutoplayQueue();
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [apiBase]);

  // Process autoplay queue
  const processAutoplayQueue = useCallback(() => {
    if (!autoplay || playingId) return;

    const next = autoplayQueueRef.current.shift();
    if (next && next.s3_url) {
      // Create and play audio
      const audio = new Audio(next.s3_url);
      audio.volume = isMuted ? 0 : audioVolume;
      audioRefs.current[next.id] = audio;

      audio.addEventListener('loadedmetadata', () => {
        setAudioDurations(prev => ({ ...prev, [next.id]: audio.duration }));
      });

      audio.addEventListener('ended', () => {
        setPlayingId(null);
        setAudioProgress(prev => ({ ...prev, [next.id]: 0 }));
        // Play next in queue
        processAutoplayQueue();
      });

      audio.addEventListener('error', () => {
        setPlayingId(null);
        processAutoplayQueue();
      });

      audio.play().then(() => {
        setPlayingId(next.id);
        progressIntervalRef.current = setInterval(() => {
          if (audio && !audio.paused) {
            setAudioProgress(prev => ({
              ...prev,
              [next.id]: (audio.currentTime / audio.duration) * 100 || 0
            }));
          }
        }, 100);
      }).catch(err => {
        console.error('Autoplay failed:', err);
        processAutoplayQueue();
      });
    }
  }, [autoplay, playingId, isMuted, audioVolume]);

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
            onClick={() => setAutoplay(!autoplay)}
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
            <Loader2 size={24} className="spinning" />
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

        {filteredTransmissions.map((transmission) => {
          const id = transmission.id;
          const isPlaying = playingId === id;
          const progress = audioProgress[id] || 0;
          const duration = audioDurations[id] || transmission.duration_seconds;
          const statusInfo = getStatusInfo(transmission.transcription_status);
          const StatusIcon = statusInfo.icon;
          const isExpanded = expandedTranscript[id];

          return (
            <div key={id} className={`audio-item ${isPlaying ? 'playing' : ''}`}>
              <div className="audio-item-main">
                {/* Play Button */}
                <button
                  className={`audio-play-btn ${isPlaying ? 'playing' : ''}`}
                  onClick={() => handlePlay(transmission)}
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
                  <div className="audio-progress-container" onClick={(e) => handleSeek(id, e)}>
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
                {transmission.transcript && (
                  <button
                    className={`audio-expand-btn ${isExpanded ? 'expanded' : ''}`}
                    onClick={() => setExpandedTranscript(prev => ({ ...prev, [id]: !prev[id] }))}
                  >
                    <ChevronDown size={18} />
                  </button>
                )}
              </div>

              {/* Transcript Section */}
              {(transmission.transcript || transmission.transcription_error) && (
                <div className={`audio-transcript-section ${isExpanded ? 'expanded' : ''}`}>
                  {transmission.transcript && (
                    <div className="audio-transcript">
                      <div className="transcript-header">
                        <span className="transcript-label">Transcript</span>
                        {transmission.transcript_confidence && (
                          <span className="transcript-confidence">
                            {(transmission.transcript_confidence * 100).toFixed(0)}% confidence
                          </span>
                        )}
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
        })}
      </div>

      {/* Count */}
      <div className="audio-footer">
        <span>
          Showing {filteredTransmissions.length} of {data?.total || 0} transmissions
        </span>
      </div>
    </div>
  );
}

export default AudioView;
