import React, { useRef, useEffect, useCallback } from 'react';
import { Play, Pause, SkipBack, SkipForward, AlertTriangle } from 'lucide-react';

/**
 * Simplified Replay Controls Component
 *
 * Features:
 * - Larger timeline with 32px touch target
 * - Prominent event marker at 50%
 * - Segmented speed control (no dropdown)
 * - Larger play button (56px)
 * - "Jump to Event" button always visible
 * - Scroll-to-scrub on timeline
 */
export function ReplayControls({
  position = 0,
  isPlaying = false,
  speed = 1,
  currentTime,
  onPositionChange,
  onPlayPause,
  onSkipToStart,
  onSkipToEnd,
  onJumpToEvent,
  onSpeedChange,
  className = ''
}) {
  const controlsRef = useRef(null);
  const speeds = [0.5, 1, 2, 4];

  // Handle wheel event for scrubbing
  useEffect(() => {
    const handleWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const step = e.shiftKey ? 10 : 2;
      const delta = e.deltaY > 0 ? step : -step;
      const newPosition = Math.max(0, Math.min(100, position + delta));
      onPositionChange?.(newPosition);
    };

    const controls = controlsRef.current;
    if (controls) {
      controls.addEventListener('wheel', handleWheel, { passive: false });
    }

    return () => {
      if (controls) {
        controls.removeEventListener('wheel', handleWheel);
      }
    };
  }, [position, onPositionChange]);

  return (
    <div className={`replay-controls-v2 ${className}`} ref={controlsRef}>
      {/* Timeline header */}
      <div className="rc-header">
        <span className="rc-label">Timeline</span>
        <span className="rc-time">{currentTime || '--:--:--'}</span>
      </div>

      {/* Timeline track */}
      <div className="rc-timeline-container">
        <div className="rc-timeline-track">
          {/* Progress fill */}
          <div
            className="rc-timeline-progress"
            style={{ width: `${position}%` }}
          />

          {/* Timeline ticks */}
          <div className="rc-timeline-ticks">
            {[0, 25, 50, 75, 100].map((tick) => (
              <div
                key={tick}
                className={`rc-tick ${tick === 50 ? 'major' : ''}`}
                style={{ left: `${tick}%` }}
              >
                <div className="rc-tick-line" />
              </div>
            ))}
          </div>

          {/* Event marker at 50% */}
          <div className="rc-event-marker" style={{ left: '50%' }} title="Event occurred here">
            <AlertTriangle size={12} />
          </div>

          {/* Slider input */}
          <input
            type="range"
            className="rc-slider"
            min="0"
            max="100"
            step="0.1"
            value={position}
            onChange={(e) => onPositionChange?.(parseFloat(e.target.value))}
            aria-label="Timeline position"
          />
        </div>
      </div>

      {/* Control buttons */}
      <div className="rc-buttons">
        {/* Transport controls */}
        <div className="rc-transport">
          <button
            className="rc-btn rc-btn-skip"
            onClick={onSkipToStart}
            title="Skip to start"
            aria-label="Skip to start"
          >
            <SkipBack size={18} />
          </button>

          <button
            className={`rc-btn rc-btn-play ${isPlaying ? 'playing' : ''}`}
            onClick={onPlayPause}
            title={isPlaying ? 'Pause' : 'Play'}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={24} /> : <Play size={24} />}
          </button>

          <button
            className="rc-btn rc-btn-skip"
            onClick={onSkipToEnd}
            title="Skip to end"
            aria-label="Skip to end"
          >
            <SkipForward size={18} />
          </button>
        </div>

        {/* Speed control - segmented */}
        <div className="rc-speed-control">
          {speeds.map((s) => (
            <button
              key={s}
              className={`rc-speed-btn ${speed === s ? 'active' : ''}`}
              onClick={() => onSpeedChange?.(s)}
              aria-label={`${s}x speed`}
            >
              {s}x
            </button>
          ))}
        </div>

        {/* Jump to event button */}
        <button
          className="rc-btn rc-btn-event"
          onClick={onJumpToEvent}
          title="Jump to event"
        >
          <AlertTriangle size={14} />
          <span>Event</span>
        </button>
      </div>
    </div>
  );
}

export default ReplayControls;
