import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Volume2, VolumeX, X, PlayCircle, Plane, Clock, Radio, Wifi, WifiOff, RefreshCw } from 'lucide-react';

// Import the global audio state from AudioView
import { getGlobalAudioState, subscribeToAudioStateChanges, clearAutoplayFilter, setAutoplay as setGlobalAutoplay, initAudioSocket, retryAudioSocket } from '../views/AudioView';

export function AudioPlaybackControl() {
  const [playingId, setPlayingId] = useState(null);
  const [currentTransmission, setCurrentTransmission] = useState(null);
  const [audioProgress, setAudioProgress] = useState({});
  const [audioDurations, setAudioDurations] = useState({});
  const [audioVolume, setAudioVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const [autoplayFilter, setAutoplayFilter] = useState(null);
  const [autoplayStartTime, setAutoplayStartTime] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [socketConnected, setSocketConnected] = useState(false);
  const [socketReconnectFailed, setSocketReconnectFailed] = useState(false);
  const timerRef = useRef(null);

  // Initialize socket when autoplay is enabled
  useEffect(() => {
    if (autoplay) {
      initAudioSocket();
    }
  }, [autoplay]);

  // Subscribe to global audio state changes
  useEffect(() => {
    const unsubscribe = subscribeToAudioStateChanges((updates) => {
      if ('playingId' in updates) {
        setPlayingId(updates.playingId);
        // Check if audio is actually playing
        if (updates.playingId) {
          const audioState = getGlobalAudioState();
          const audio = audioState.audioRefs[updates.playingId];
          if (audio) {
            setIsAudioPlaying(!audio.paused);
          }
        } else {
          setIsAudioPlaying(false);
        }
      }
      if ('currentTransmission' in updates) setCurrentTransmission(updates.currentTransmission);
      if ('audioProgress' in updates) setAudioProgress(updates.audioProgress);
      if ('audioDurations' in updates) setAudioDurations(updates.audioDurations);
      if ('autoplay' in updates) {
        setAutoplay(updates.autoplay);
        if (updates.autoplay && !autoplayStartTime) {
          setAutoplayStartTime(Date.now());
        } else if (!updates.autoplay) {
          setAutoplayStartTime(null);
          setElapsedTime(0);
        }
      }
      if ('autoplayFilter' in updates) setAutoplayFilter(updates.autoplayFilter);
      if ('socketConnected' in updates) setSocketConnected(updates.socketConnected);
      if ('socketReconnectFailed' in updates) setSocketReconnectFailed(updates.socketReconnectFailed);
    });

    // Initialize with current state
    const audioState = getGlobalAudioState();
    setAutoplayFilter(audioState.autoplayFilter);
    setAutoplay(audioState.autoplay);
    setCurrentTransmission(audioState.currentTransmission);
    setSocketConnected(audioState.socketConnected);
    setSocketReconnectFailed(audioState.socketReconnectFailed || false);
    if (audioState.autoplay) {
      setAutoplayStartTime(Date.now());
    }

    return unsubscribe;
  }, []);

  // Timer for elapsed autoplay time
  useEffect(() => {
    if (autoplay && autoplayStartTime) {
      timerRef.current = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - autoplayStartTime) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [autoplay, autoplayStartTime]);

  // Show the control if autoplay is enabled OR if audio is playing
  if (!autoplay && !playingId) return null;

  const progress = playingId ? (audioProgress[playingId] || 0) : 0;
  const duration = playingId ? (audioDurations[playingId] || 0) : 0;
  const hasActivePlayback = !!playingId;

  const formatDuration = (seconds) => {
    if (!seconds && seconds !== 0) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handlePlayPause = () => {
    const audioState = getGlobalAudioState();
    const audio = audioState.audioRefs[playingId];
    if (audio) {
      if (audio.paused) {
        audio.play();
        setIsAudioPlaying(true);
      } else {
        audio.pause();
        setIsAudioPlaying(false);
      }
    }
  };

  const handleVolumeChange = (e) => {
    const vol = parseFloat(e.target.value);
    setAudioVolume(vol);
    const audioState = getGlobalAudioState();
    const audio = audioState.audioRefs[playingId];
    if (audio && !isMuted) {
      audio.volume = vol;
    }
  };

  const toggleMute = () => {
    const audioState = getGlobalAudioState();
    const audio = audioState.audioRefs[playingId];
    if (audio) {
      audio.volume = isMuted ? audioVolume : 0;
    }
    setIsMuted(!isMuted);
  };

  const handleClose = () => {
    const audioState = getGlobalAudioState();
    if (playingId) {
      const audio = audioState.audioRefs[playingId];
      if (audio) {
        audio.pause();
        audioState.playingId = null;
      }
    }
    // Also disable autoplay when closing
    setGlobalAutoplay(false);
    clearAutoplayFilter();
  };

  const toggleAutoplay = () => {
    const newAutoplay = !autoplay;
    setGlobalAutoplay(newAutoplay);
    if (newAutoplay) {
      setAutoplayStartTime(Date.now());
    } else {
      setAutoplayStartTime(null);
      setElapsedTime(0);
    }
  };

  const handleClearFilter = () => {
    clearAutoplayFilter();
  };

  // Get display label for current state
  const getDisplayLabel = () => {
    if (hasActivePlayback && currentTransmission) {
      return currentTransmission.channel_name || 'Unknown Channel';
    }
    if (autoplayFilter) {
      return autoplayFilter.callsign || autoplayFilter.hex;
    }
    return null;
  };

  const displayLabel = getDisplayLabel();

  return (
    <div className={`audio-playback-control ${!hasActivePlayback ? 'idle' : ''}`}>
      <div className="playback-info">
        <span className="playback-label">
          {autoplayFilter && (
            <Plane size={12} />
          )}
          {hasActivePlayback ? (
            <>
              <Radio size={12} />
              <span>{displayLabel}</span>
            </>
          ) : (
            <>
              <PlayCircle size={12} className="scanning-icon" />
              <span>{displayLabel || 'Scanning...'}</span>
            </>
          )}
        </span>
        <span className="playback-time">
          {hasActivePlayback ? (
            `${formatDuration((progress / 100) * duration)} / ${formatDuration(duration)}`
          ) : autoplay ? (
            <>
              {socketReconnectFailed ? (
                <button
                  className="socket-retry-btn"
                  onClick={retryAudioSocket}
                  title="Connection lost. Click to retry."
                >
                  <WifiOff size={10} className="socket-failed" />
                  <RefreshCw size={10} />
                </button>
              ) : socketConnected ? (
                <Wifi size={10} className="socket-connected" />
              ) : (
                <WifiOff size={10} className="socket-disconnected" />
              )}
              <Clock size={10} />
              {formatDuration(elapsedTime)}
            </>
          ) : null}
        </span>
      </div>

      {hasActivePlayback && (
        <div className="playback-progress">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="playback-controls">
        {hasActivePlayback && (
          <>
            <button
              className="playback-btn"
              onClick={handlePlayPause}
              title={isAudioPlaying ? 'Pause' : 'Play'}
            >
              {isAudioPlaying ? <Pause size={16} /> : <Play size={16} />}
            </button>

            <div className="playback-volume-control">
              <button
                className="playback-btn volume-btn"
                onClick={toggleMute}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>
              <input
                type="range"
                className="playback-volume-slider"
                min="0"
                max="1"
                step="0.1"
                value={audioVolume}
                onChange={handleVolumeChange}
              />
            </div>
          </>
        )}

        <button
          className={`playback-btn autoplay-btn ${autoplay ? 'active' : ''}`}
          onClick={toggleAutoplay}
          title={autoplay ? 'Disable autoplay - stop auto-playing new transmissions' : 'Enable autoplay - automatically play new transmissions'}
        >
          <PlayCircle size={14} />
        </button>

        {autoplayFilter && (
          <button
            className="playback-btn filter-clear-btn"
            onClick={handleClearFilter}
            title={`Stop filtering to ${autoplayFilter.callsign || autoplayFilter.hex} - listen to all aircraft`}
          >
            <Plane size={12} />
            <X size={10} className="filter-clear-x" />
          </button>
        )}

        <button
          className="playback-btn close-btn"
          onClick={handleClose}
          title="Close audio player and disable autoplay"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

export default AudioPlaybackControl;
