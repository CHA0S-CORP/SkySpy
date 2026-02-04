import React, { useState, useCallback, memo } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  X,
  History,
  ChevronDown,
  Loader2,
  AlertTriangle,
  Clock,
  Plane,
} from 'lucide-react';

/**
 * Playback Controls Component
 *
 * Provides UI for historical track playback mode including:
 * - Time range selection (1hr, 2hr, 4hr, 8hr, custom)
 * - Play/Pause controls
 * - Playback speed (1x, 2x, 4x, 8x)
 * - Timeline scrubber
 * - Current playback time display
 * - Exit button to return to live mode
 */
export const PlaybackControls = memo(function PlaybackControls({
  // State
  isPlayback,
  isPlaying,
  playbackTime,
  playbackSpeed,
  timeRange,
  playbackPercent,
  formattedTime,
  formattedDate,
  duration,
  isLoading,
  error,
  historyStats,

  // Actions
  onEnterPlayback,
  onExitPlayback,
  onTogglePlayPause,
  onSpeedChange,
  onSeekPercent,
  onSkipToStart,
  onSkipToEnd,

  // Options
  timeRangePresets,
  className = '',
  proStyle = false,
}) {
  const [showTimeRangeMenu, setShowTimeRangeMenu] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState(1); // Default to 1 hour

  /**
   * Handle time range selection
   */
  const handleTimeRangeSelect = useCallback(
    (hours) => {
      setSelectedPreset(hours);
      setShowTimeRangeMenu(false);
      onEnterPlayback?.(hours);
    },
    [onEnterPlayback]
  );

  /**
   * Handle timeline scrubbing
   */
  const handleSeek = useCallback(
    (e) => {
      const percent = parseFloat(e.target.value);
      onSeekPercent?.(percent);
    },
    [onSeekPercent]
  );

  /**
   * Get style class based on mode
   */
  const styleClass = proStyle ? 'pro-style' : '';

  // If not in playback mode, show the "Enter Playback" button
  if (!isPlayback) {
    return (
      <div className={`playback-enter-btn ${styleClass} ${className}`}>
        <div className="playback-dropdown-container">
          <button
            className="playback-trigger-btn"
            onClick={() => setShowTimeRangeMenu((prev) => !prev)}
            title="Enter track playback mode"
          >
            <History size={16} />
            <span>Track Playback</span>
            <ChevronDown size={14} />
          </button>

          {showTimeRangeMenu && (
            <div className="playback-time-menu">
              <div className="playback-menu-header">Select Time Range</div>
              {timeRangePresets?.map((preset) => (
                <button
                  key={preset.hours}
                  className="playback-time-option"
                  onClick={() => handleTimeRangeSelect(preset.hours)}
                >
                  <Clock size={14} />
                  <span>{preset.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Playback mode active - show full controls
  return (
    <div className={`playback-controls-panel ${styleClass} ${className}`}>
      {/* Loading overlay */}
      {isLoading && (
        <div className="playback-loading-overlay">
          <Loader2 size={24} className="animate-spin" />
          <span>Loading history...</span>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="playback-error">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Header with PLAYBACK indicator and exit button */}
      <div className="playback-header">
        <div className="playback-indicator">
          <History size={14} />
          <span className="playback-badge">PLAYBACK</span>
        </div>

        {/* Stats summary */}
        <div className="playback-stats">
          <span className="playback-stat">
            <Plane size={12} />
            {historyStats?.uniqueAircraft || 0} aircraft
          </span>
          <span className="playback-stat">{historyStats?.totalSightings || 0} positions</span>
        </div>

        <button className="playback-exit-btn" onClick={onExitPlayback} title="Exit playback mode">
          <X size={16} />
          <span>Exit</span>
        </button>
      </div>

      {/* Current time display */}
      <div className="playback-time-display">
        <div className="playback-current-time">{formattedTime}</div>
        <div className="playback-current-date">{formattedDate}</div>
      </div>

      {/* Timeline scrubber */}
      <div className="playback-timeline">
        <div className="playback-timeline-labels">
          <span className="timeline-start">
            {timeRange?.start?.toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }) || '--:--'}
          </span>
          <span className="timeline-duration">{duration}</span>
          <span className="timeline-end">
            {timeRange?.end?.toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }) || '--:--'}
          </span>
        </div>

        <div className="playback-timeline-track">
          {/* Progress fill */}
          <div className="playback-timeline-progress" style={{ width: `${playbackPercent}%` }} />

          {/* Timeline ticks */}
          <div className="playback-timeline-ticks">
            {[0, 25, 50, 75, 100].map((tick) => (
              <div key={tick} className="playback-tick" style={{ left: `${tick}%` }} />
            ))}
          </div>

          {/* Slider input */}
          <input
            type="range"
            className="playback-slider"
            min="0"
            max="100"
            step="0.1"
            value={playbackPercent}
            onChange={handleSeek}
            disabled={isLoading}
            aria-label="Playback position"
          />
        </div>
      </div>

      {/* Control buttons */}
      <div className="playback-buttons">
        {/* Transport controls */}
        <div className="playback-transport">
          <button
            className="playback-btn playback-skip-btn"
            onClick={onSkipToStart}
            disabled={isLoading}
            title="Skip to start"
            aria-label="Skip to start"
          >
            <SkipBack size={16} />
          </button>

          <button
            className={`playback-btn playback-play-btn ${isPlaying ? 'playing' : ''}`}
            onClick={onTogglePlayPause}
            disabled={isLoading}
            title={isPlaying ? 'Pause' : 'Play'}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
          </button>

          <button
            className="playback-btn playback-skip-btn"
            onClick={onSkipToEnd}
            disabled={isLoading}
            title="Skip to end"
            aria-label="Skip to end"
          >
            <SkipForward size={16} />
          </button>
        </div>

        {/* Speed control */}
        <div className="playback-speed-control">
          <span className="playback-speed-label">Speed:</span>
          {[1, 2, 4, 8].map((speed) => (
            <button
              key={speed}
              className={`playback-speed-btn ${playbackSpeed === speed ? 'active' : ''}`}
              onClick={() => onSpeedChange?.(speed)}
              disabled={isLoading}
              aria-label={`${speed}x speed`}
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});

/**
 * Compact playback indicator for map overlay
 */
export const PlaybackIndicator = memo(function PlaybackIndicator({
  isPlayback,
  formattedTime,
  isPlaying,
  className = '',
}) {
  if (!isPlayback) return null;

  return (
    <div className={`playback-map-indicator ${className}`}>
      <History size={14} />
      <span className="indicator-label">PLAYBACK</span>
      <span className="indicator-time">{formattedTime}</span>
      {isPlaying && <span className="indicator-playing-dot" />}
    </div>
  );
});

export default PlaybackControls;
