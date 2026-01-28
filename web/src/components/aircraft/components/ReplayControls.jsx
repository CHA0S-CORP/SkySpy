import React from 'react';
import { Play, Pause, SkipBack, SkipForward, CircleDot, Radio as RadioIcon } from 'lucide-react';

export function ReplayControls({
  isPlaying,
  position,
  timestamp,
  onPlayToggle,
  onSkipToStart,
  onSkipToEnd,
  onPositionChange,
  speed,
  onSpeedChange,
  showTrackPoints,
  onToggleTrackPoints,
  liveMode,
  onToggleLiveMode,
  showSpeedControl = true,
  showTrackPointsControl = false,
  showLiveModeControl = false,
  className = ''
}) {
  return (
    <div className={`replay-controls ${className}`}>
      <div className="replay-buttons">
        <button
          className="replay-btn"
          onClick={onSkipToStart}
          title="Skip to start"
          aria-label="Skip to start of track"
        >
          <SkipBack size={16} aria-hidden="true" />
        </button>
        <button
          className="replay-btn play-btn"
          onClick={onPlayToggle}
          title={isPlaying ? 'Pause' : 'Play'}
          aria-label={isPlaying ? 'Pause replay' : 'Play replay'}
          aria-pressed={isPlaying}
        >
          {isPlaying ? (
            <Pause size={18} aria-hidden="true" />
          ) : (
            <Play size={18} aria-hidden="true" />
          )}
        </button>
        <button
          className="replay-btn"
          onClick={onSkipToEnd}
          title="Skip to end"
          aria-label="Skip to end of track"
        >
          <SkipForward size={16} aria-hidden="true" />
        </button>

        {showSpeedControl && (
          <select
            className="speed-select"
            value={speed}
            onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
            title="Playback speed"
            aria-label="Select playback speed"
          >
            <option value={0.25}>0.25x</option>
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={4}>4x</option>
          </select>
        )}

        {showTrackPointsControl && (
          <button
            className={`replay-btn ${showTrackPoints ? 'active' : ''}`}
            onClick={onToggleTrackPoints}
            title={showTrackPoints ? 'Hide track points' : 'Show track points'}
            aria-label={showTrackPoints ? 'Hide track points' : 'Show track points'}
            aria-pressed={showTrackPoints}
          >
            <CircleDot size={16} aria-hidden="true" />
          </button>
        )}

        {showLiveModeControl && (
          <button
            className={`replay-btn live-btn ${liveMode ? 'active' : ''}`}
            onClick={onToggleLiveMode}
            title={liveMode ? 'Live tracking ON' : 'Enable live tracking'}
            aria-label={liveMode ? 'Disable live tracking' : 'Enable live tracking'}
            aria-pressed={liveMode}
          >
            <RadioIcon size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="replay-slider-container">
        <input
          type="range"
          className="replay-slider"
          min="0"
          max="100"
          value={position}
          onChange={(e) => onPositionChange(parseFloat(e.target.value))}
          aria-label="Track replay position"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={position}
        />
        {timestamp && (
          <div className="replay-time" aria-live="polite">
            {timestamp}
          </div>
        )}
      </div>
    </div>
  );
}

// Compact version for safety event maps
export function ReplayControlsCompact({
  isPlaying,
  position,
  timestamp,
  onPlayToggle,
  onSkipToStart,
  onSkipToEnd,
  onJumpToEvent,
  onPositionChange,
  speed,
  onSpeedChange,
  eventLabel = 'Event'
}) {
  return (
    <div className="safety-replay-controls">
      <div className="replay-buttons">
        <button
          className="replay-btn"
          onClick={onSkipToStart}
          title="Skip to start"
          aria-label="Skip to start"
        >
          <SkipBack size={14} aria-hidden="true" />
        </button>
        <button
          className="replay-btn play-btn"
          onClick={onPlayToggle}
          title={isPlaying ? 'Pause' : 'Play'}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <Pause size={16} aria-hidden="true" />
          ) : (
            <Play size={16} aria-hidden="true" />
          )}
        </button>
        <button
          className="replay-btn"
          onClick={onSkipToEnd}
          title="Skip to end"
          aria-label="Skip to end"
        >
          <SkipForward size={14} aria-hidden="true" />
        </button>
        {onJumpToEvent && (
          <button
            className="replay-btn event-btn"
            onClick={onJumpToEvent}
            title={`Jump to ${eventLabel}`}
            aria-label={`Jump to ${eventLabel}`}
          >
            <span className="event-icon">!</span>
          </button>
        )}
        <select
          className="speed-select small"
          value={speed}
          onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
          title="Playback speed"
          aria-label="Playback speed"
        >
          <option value={0.25}>0.25x</option>
          <option value={0.5}>0.5x</option>
          <option value={1}>1x</option>
          <option value={2}>2x</option>
          <option value={4}>4x</option>
        </select>
      </div>
      <div className="replay-slider-container">
        <input
          type="range"
          className="replay-slider"
          min="0"
          max="100"
          value={position}
          onChange={(e) => onPositionChange(parseFloat(e.target.value))}
          aria-label="Replay position"
        />
        <div className="replay-time">{timestamp || '--:--'}</div>
      </div>
    </div>
  );
}
