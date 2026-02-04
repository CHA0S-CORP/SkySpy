import React, { useState, useMemo } from 'react';
import { Radio, MessageCircle, Search, ChevronDown, ChevronUp } from 'lucide-react';

/**
 * CommunicationsSection - Combined Radio + ACARS content for section layout
 *
 * Shows a unified list of communications with tabs for filtering.
 */
export function CommunicationsSection({
  hex: _hex,
  // Radio props
  radioTransmissions = [],
  filteredRadioTransmissions = [],
  radioPlayingId,
  radioAudioProgress,
  radioAudioDurations,
  radioExpandedTranscript,
  setRadioExpandedTranscript,
  handleRadioPlay,
  handleRadioSeek,
  // ACARS props
  acarsMessages = [],
  expandedMessages = {},
  setExpandedMessages,
}) {
  const [activeFilter, setActiveFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Combine and sort all communications
  const allCommunications = useMemo(() => {
    const radio = filteredRadioTransmissions.map((t) => ({
      ...t,
      type: 'radio',
      sortTime: new Date(t.timestamp || t.created_at).getTime(),
    }));

    const acars = acarsMessages.map((m) => ({
      ...m,
      type: 'acars',
      sortTime: new Date(m.timestamp || m.received_at).getTime(),
    }));

    return [...radio, ...acars].sort((a, b) => b.sortTime - a.sortTime);
  }, [filteredRadioTransmissions, acarsMessages]);

  // Filter communications
  const filteredCommunications = useMemo(() => {
    let items = allCommunications;

    if (activeFilter === 'radio') {
      items = items.filter((c) => c.type === 'radio');
    } else if (activeFilter === 'acars') {
      items = items.filter((c) => c.type === 'acars');
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      items = items.filter((c) => {
        if (c.type === 'radio') {
          return (
            c.transcript?.toLowerCase().includes(query) ||
            c.frequency?.toString().includes(query)
          );
        } else {
          return (
            c.message?.toLowerCase().includes(query) ||
            c.label?.toLowerCase().includes(query) ||
            c.sublabel?.toLowerCase().includes(query)
          );
        }
      });
    }

    return items;
  }, [allCommunications, activeFilter, searchQuery]);

  // Toggle ACARS message expansion
  const toggleAcarsExpand = (id) => {
    setExpandedMessages?.((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  // Render radio transmission item
  const renderRadioItem = (item) => {
    const isPlaying = radioPlayingId === item.id;
    const progress = radioAudioProgress?.[item.id] || 0;
    const duration = radioAudioDurations?.[item.id] || 0;
    const isTranscriptExpanded = radioExpandedTranscript === item.id;

    return (
      <div key={`radio-${item.id}`} className="comm-item comm-radio">
        <div className="comm-item-header">
          <div className="comm-item-icon radio">
            <Radio size={14} />
          </div>
          <div className="comm-item-meta">
            <span className="comm-item-freq">{item.frequency} MHz</span>
            <time className="comm-item-time">
              {new Date(item.timestamp || item.created_at).toLocaleTimeString()}
            </time>
          </div>
          {item.transcript && (
            <button
              className="comm-expand-btn"
              onClick={() =>
                setRadioExpandedTranscript?.(isTranscriptExpanded ? null : item.id)
              }
              aria-expanded={isTranscriptExpanded}
            >
              {isTranscriptExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
        </div>

        {/* Audio player */}
        {item.audio_url && (
          <div className="comm-audio-player">
            <button
              className={`comm-play-btn ${isPlaying ? 'playing' : ''}`}
              onClick={() => handleRadioPlay?.(item.id, item.audio_url)}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? '||' : '\u25B6'}
            </button>
            <div className="comm-progress-bar">
              <div
                className="comm-progress-fill"
                style={{ width: `${duration > 0 ? (progress / duration) * 100 : 0}%` }}
              />
              <input
                type="range"
                min={0}
                max={duration || 100}
                value={progress}
                onChange={(e) => handleRadioSeek?.(item.id, Number(e.target.value))}
                aria-label="Seek audio"
              />
            </div>
            <span className="comm-duration">
              {formatDuration(progress)} / {formatDuration(duration)}
            </span>
          </div>
        )}

        {/* Transcript */}
        {isTranscriptExpanded && item.transcript && (
          <div className="comm-transcript">
            <p>{item.transcript}</p>
          </div>
        )}
      </div>
    );
  };

  // Render ACARS message item
  const renderAcarsItem = (item) => {
    const isExpanded = expandedMessages[item.id];

    return (
      <div key={`acars-${item.id}`} className="comm-item comm-acars">
        <div className="comm-item-header">
          <div className="comm-item-icon acars">
            <MessageCircle size={14} />
          </div>
          <div className="comm-item-meta">
            <span className="comm-item-label">{item.label || 'MSG'}</span>
            {item.sublabel && <span className="comm-item-sublabel">{item.sublabel}</span>}
            <time className="comm-item-time">
              {new Date(item.timestamp || item.received_at).toLocaleTimeString()}
            </time>
          </div>
          <button
            className="comm-expand-btn"
            onClick={() => toggleAcarsExpand(item.id)}
            aria-expanded={isExpanded}
          >
            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>

        {/* Preview */}
        {!isExpanded && item.message && (
          <p className="comm-preview">{item.message.slice(0, 100)}{item.message.length > 100 ? '...' : ''}</p>
        )}

        {/* Full message */}
        {isExpanded && (
          <div className="comm-acars-full">
            {item.message && (
              <pre className="comm-acars-message">{item.message}</pre>
            )}
            {item.decoded && (
              <div className="comm-acars-decoded">
                <span className="comm-acars-decoded-label">Decoded:</span>
                <pre>{typeof item.decoded === 'string' ? item.decoded : JSON.stringify(item.decoded, null, 2)}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="communications-section">
      {/* Filter tabs and search */}
      <div className="comm-toolbar">
        <div className="comm-filters">
          <button
            className={`comm-filter-btn ${activeFilter === 'all' ? 'active' : ''}`}
            onClick={() => setActiveFilter('all')}
          >
            All ({allCommunications.length})
          </button>
          <button
            className={`comm-filter-btn ${activeFilter === 'radio' ? 'active' : ''}`}
            onClick={() => setActiveFilter('radio')}
          >
            <Radio size={12} /> Radio ({radioTransmissions.length})
          </button>
          <button
            className={`comm-filter-btn ${activeFilter === 'acars' ? 'active' : ''}`}
            onClick={() => setActiveFilter('acars')}
          >
            <MessageCircle size={12} /> ACARS ({acarsMessages.length})
          </button>
        </div>
        <div className="comm-search">
          <Search size={14} />
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search communications"
          />
        </div>
      </div>

      {/* Communications list */}
      <div className="communications-list">
        {filteredCommunications.length === 0 ? (
          <div className="comm-empty">
            <p>No communications found</p>
          </div>
        ) : (
          filteredCommunications.map((item) =>
            item.type === 'radio' ? renderRadioItem(item) : renderAcarsItem(item)
          )
        )}
      </div>
    </div>
  );
}

// Helper to format duration
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
