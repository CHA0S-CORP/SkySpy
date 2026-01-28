import React from 'react';
import { Radio, Search, Play, Pause, PlayCircle, ChevronDown, Mic, Radar } from 'lucide-react';
import { getGlobalAudioState } from '../../views/AudioView';

export function RadioTab({
  hex,
  radioLoading,
  radioTransmissions,
  filteredRadioTransmissions,
  radioHours,
  setRadioHours,
  radioSearchQuery,
  setRadioSearchQuery,
  radioStatusFilter,
  setRadioStatusFilter,
  radioPlayingId,
  radioAudioProgress,
  radioAudioDurations,
  radioExpandedTranscript,
  setRadioExpandedTranscript,
  radioAutoplay,
  handleRadioPlay,
  handleRadioSeek,
  toggleRadioAutoplay
}) {
  const formatDuration = (seconds) => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Loading state
  if (radioLoading) {
    return (
      <div className="detail-loading" role="status" aria-busy="true">
        <div className="detail-loading-radar">
          <Radar size={32} className="detail-radar-icon" aria-hidden="true" />
          <div className="detail-radar-sweep" />
        </div>
        <span>Loading radio transmissions...</span>
      </div>
    );
  }

  return (
    <div
      className="detail-radio"
      id="panel-radio"
      role="tabpanel"
      aria-labelledby="tab-radio"
    >
      {/* Radio Toolbar */}
      <div className="radio-toolbar">
        <div className="radio-filters">
          <div className="search-box">
            <Search size={14} aria-hidden="true" />
            <input
              type="text"
              placeholder="Search transcripts..."
              value={radioSearchQuery}
              onChange={(e) => setRadioSearchQuery(e.target.value)}
              aria-label="Search radio transcripts"
            />
          </div>

          <select
            className="radio-select"
            value={radioStatusFilter}
            onChange={(e) => setRadioStatusFilter(e.target.value)}
            aria-label="Filter by transcript status"
          >
            <option value="all">All</option>
            <option value="transcribed">With Transcript</option>
            <option value="no_transcript">No Transcript</option>
          </select>

          <select
            className="radio-select"
            value={radioHours}
            onChange={(e) => setRadioHours(Number(e.target.value))}
            aria-label="Select time range"
          >
            <option value={1}>Last 1h</option>
            <option value={6}>Last 6h</option>
            <option value={12}>Last 12h</option>
            <option value={24}>Last 24h</option>
            <option value={48}>Last 48h</option>
            <option value={168}>Last 7d</option>
          </select>
        </div>

        <div className="radio-controls-right">
          <button
            className={`radio-autoplay-btn ${radioAutoplay && getGlobalAudioState().autoplayFilter?.hex === hex ? 'active' : ''}`}
            onClick={toggleRadioAutoplay}
            title={radioAutoplay ? 'Disable autoplay for this aircraft' : 'Enable autoplay for this aircraft'}
            aria-pressed={radioAutoplay && getGlobalAudioState().autoplayFilter?.hex === hex}
          >
            <PlayCircle size={14} aria-hidden="true" />
            <span>Auto</span>
          </button>
          <span className="radio-count" aria-live="polite">
            {filteredRadioTransmissions.length} transmission{filteredRadioTransmissions.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Empty state */}
      {filteredRadioTransmissions.length === 0 ? (
        <div className="detail-empty" role="status">
          <Radio size={48} aria-hidden="true" />
          <p>No radio transmissions</p>
          <span>No transmissions mentioning this aircraft in the selected time range</span>
        </div>
      ) : (
        <ul className="radio-list" role="list" aria-label="Radio transmissions">
          {filteredRadioTransmissions.map((transmission) => {
            const id = transmission.id;
            const isPlaying = radioPlayingId === id;
            const progress = radioAudioProgress[id] || 0;
            const duration = radioAudioDurations[id] || transmission.duration_seconds || 0;
            const isExpanded = radioExpandedTranscript[id];

            return (
              <li key={id} className={`radio-item ${isPlaying ? 'playing' : ''}`}>
                <div className="radio-item-main">
                  {/* Play Button */}
                  <button
                    className={`radio-play-btn ${isPlaying ? 'playing' : ''}`}
                    onClick={() => handleRadioPlay(transmission)}
                    disabled={!transmission.audio_url}
                    title={transmission.audio_url ? (isPlaying ? 'Pause' : 'Play') : 'No audio URL'}
                    aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
                  >
                    {isPlaying ? (
                      <Pause size={18} aria-hidden="true" />
                    ) : (
                      <Play size={18} aria-hidden="true" />
                    )}
                  </button>

                  {/* Info */}
                  <div className="radio-item-info">
                    <div className="radio-item-header">
                      <span className="radio-callsign">{transmission.matched_callsign}</span>
                      {transmission.channel_name && (
                        <span className="radio-channel">{transmission.channel_name}</span>
                      )}
                      {transmission.frequency_mhz && (
                        <span className="radio-frequency">
                          {transmission.frequency_mhz.toFixed(3)} MHz
                        </span>
                      )}
                      <span className="radio-time">
                        {new Date(transmission.created_at).toLocaleString()}
                      </span>
                      <span className="radio-confidence" title="Match confidence">
                        {((transmission.confidence || 0) * 100).toFixed(0)}%
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div
                      className="radio-progress-container"
                      onClick={(e) => handleRadioSeek(id, e)}
                      role="slider"
                      aria-label="Audio progress"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={progress}
                      tabIndex={0}
                    >
                      <div className="radio-progress-bar">
                        <div
                          className="radio-progress-fill"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <div className="radio-duration">
                        <span>{formatDuration((progress / 100) * duration)}</span>
                        <span>{formatDuration(duration)}</span>
                      </div>
                    </div>

                    {/* Transcript Preview */}
                    {transmission.transcript ? (
                      <div className="radio-transcript-preview">
                        <p className="transcript-preview-text">
                          {transmission.raw_text && (
                            <span className="transcript-highlight">{transmission.raw_text}</span>
                          )}
                          {' '}{transmission.transcript}
                        </p>
                      </div>
                    ) : (
                      <div className="radio-transcript-empty">
                        <Mic size={12} aria-hidden="true" />
                        <span>No transcript available</span>
                      </div>
                    )}
                  </div>

                  {/* Expand Button */}
                  {transmission.transcript && transmission.transcript.length > 100 && (
                    <button
                      className={`radio-expand-btn ${isExpanded ? 'expanded' : ''}`}
                      onClick={() => setRadioExpandedTranscript(prev => ({
                        ...prev,
                        [id]: !prev[id]
                      }))}
                      aria-label={isExpanded ? 'Collapse transcript' : 'Expand transcript'}
                      aria-expanded={isExpanded}
                    >
                      <ChevronDown size={16} aria-hidden="true" />
                    </button>
                  )}
                </div>

                {/* Expandable Transcript Section */}
                {transmission.transcript && isExpanded && (
                  <div className="radio-transcript-section expanded">
                    <div className="radio-transcript">
                      <div className="transcript-header">
                        <span className="transcript-label">Full Transcript</span>
                      </div>
                      <p className="transcript-text">{transmission.transcript}</p>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
