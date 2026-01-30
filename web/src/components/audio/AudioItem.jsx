/**
 * AudioItem component for displaying individual audio transmissions.
 *
 * Features:
 * - Play/pause control
 * - Progress bar with seek
 * - Transcript display
 * - Identified aircraft tags
 * - Emergency keyword highlighting
 */

import React, { memo } from 'react';
import {
  Play,
  Pause,
  ChevronDown,
  AlertCircle,
  CheckCircle,
  Clock,
  Loader2,
  Mic,
  Plane
} from 'lucide-react';
import { hasEmergencyKeyword } from '../../hooks/useAudioState';

/**
 * Format duration in seconds to MM:SS format
 */
export const formatDuration = (seconds) => {
  if (!seconds) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Format file size in bytes to human readable format
 */
export const formatFileSize = (bytes) => {
  if (!bytes) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

/**
 * Get status icon and color based on transcription status
 */
export const getStatusInfo = (status) => {
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

/**
 * Memoized Audio Item Component
 */
const AudioItem = memo(function AudioItem({
  transmission,
  isPlaying,
  progress,
  duration,
  isExpanded,
  onPlay,
  onSeek,
  onToggleExpand,
  onSelectAircraft
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

export default AudioItem;
