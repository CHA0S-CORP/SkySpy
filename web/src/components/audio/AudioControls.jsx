/**
 * AudioControls component for playback control toolbar.
 *
 * Features:
 * - Volume control with mute toggle
 * - Time range selector
 * - Autoplay toggle
 * - Refresh button
 * - Socket connection status
 */

import React from 'react';
import { Volume2, VolumeX, PlayCircle, RefreshCw } from 'lucide-react';

function AudioControls({
  // Volume
  audioVolume,
  isMuted,
  onVolumeChange,
  onToggleMute,
  // Time range
  timeRange,
  onTimeRangeChange,
  // Autoplay
  autoplay,
  onToggleAutoplay,
  // Refresh
  loading,
  onRefresh,
  // Socket status
  socketConnected
}) {
  const timeRanges = ['1h', '6h', '24h', '48h', '7d'];

  return (
    <div className="audio-controls-right">
      {/* Volume Control */}
      <div className="volume-control">
        <button className="volume-btn" onClick={onToggleMute}>
          {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
        <input
          type="range"
          className="volume-slider"
          min="0"
          max="1"
          step="0.1"
          value={audioVolume}
          onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
        />
      </div>

      {/* Time Range Selector */}
      <div className="time-range-selector">
        {timeRanges.map(range => (
          <button
            key={range}
            className={`time-btn ${timeRange === range ? 'active' : ''}`}
            onClick={() => onTimeRangeChange(range)}
          >
            {range}
          </button>
        ))}
      </div>

      {/* Autoplay Toggle */}
      <button
        className={`autoplay-btn ${autoplay ? 'active' : ''}`}
        onClick={onToggleAutoplay}
        title={autoplay ? 'Disable autoplay' : 'Enable autoplay for new transmissions'}
      >
        <PlayCircle size={16} />
        <span>Auto</span>
      </button>

      {/* Refresh Button */}
      <button className="refresh-btn" onClick={onRefresh} title="Refresh">
        <RefreshCw size={16} className={loading ? 'spinning' : ''} />
      </button>

      {/* Socket Connection Status */}
      <div
        className={`socket-status ${socketConnected ? 'connected' : 'disconnected'}`}
        title={socketConnected ? 'Live updates active' : 'Disconnected'}
      >
        <span className="socket-dot" />
      </div>
    </div>
  );
}

export default AudioControls;
