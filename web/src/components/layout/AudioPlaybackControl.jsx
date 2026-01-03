import React, { useState, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, X, PlayCircle } from 'lucide-react';

// Import the global audio state from AudioView
import { getGlobalAudioState, subscribeToAudioStateChanges } from '../views/AudioView';

export function AudioPlaybackControl() {
  const [isVisible, setIsVisible] = useState(false);
  const [playingId, setPlayingId] = useState(null);
  const [audioProgress, setAudioProgress] = useState({});
  const [audioDurations, setAudioDurations] = useState({});
  const [audioVolume, setAudioVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [autoplay, setAutoplay] = useState(false);

  // Subscribe to global audio state changes
  useEffect(() => {
    const unsubscribe = subscribeToAudioStateChanges((updates) => {
      if ('playingId' in updates) {
        setPlayingId(updates.playingId);
        setIsVisible(!!updates.playingId);
        // Check if audio is actually playing
        if (updates.playingId) {
          const audioState = getGlobalAudioState();
          const audio = audioState.audioRefs[updates.playingId];
          if (audio) {
            setIsAudioPlaying(!audio.paused);
          }
        }
      }
      if ('audioProgress' in updates) setAudioProgress(updates.audioProgress);
      if ('audioDurations' in updates) setAudioDurations(updates.audioDurations);
      if ('autoplay' in updates) setAutoplay(updates.autoplay);
    });
    return unsubscribe;
  }, []);

  if (!isVisible || !playingId) return null;

  const progress = audioProgress[playingId] || 0;
  const duration = audioDurations[playingId] || 0;

  const formatDuration = (seconds) => {
    if (!seconds) return '--:--';
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
    const audio = audioState.audioRefs[playingId];
    if (audio) {
      audio.pause();
      audioState.playingId = null;
    }
    setIsVisible(false);
  };

  const toggleAutoplay = () => {
    const audioState = getGlobalAudioState();
    const newAutoplay = !autoplay;
    audioState.autoplay = newAutoplay;
    
    // Notify all subscribers
    const subscribers = audioState.subscribers || [];
    subscribers.forEach(callback => callback({ autoplay: newAutoplay }));
    
    setAutoplay(newAutoplay);
  };

  return (
    <div className="audio-playback-control">
      <div className="playback-info">
        <span className="playback-label">Playing Audio</span>
        <span className="playback-time">
          {formatDuration((progress / 100) * duration)} / {formatDuration(duration)}
        </span>
      </div>

      <div className="playback-progress">
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="playback-controls">
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

        <button
          className={`playback-btn autoplay-btn ${autoplay ? 'active' : ''}`}
          onClick={toggleAutoplay}
          title={autoplay ? 'Disable autoplay' : 'Enable autoplay'}
        >
          <PlayCircle size={14} />
        </button>

        <button
          className="playback-btn close-btn"
          onClick={handleClose}
          title="Close"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

export default AudioPlaybackControl;
