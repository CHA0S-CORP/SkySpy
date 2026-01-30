/**
 * AudioList component for rendering the list of audio transmissions.
 *
 * Features:
 * - Virtualized rendering with intersection observer for infinite scroll
 * - Loading and empty states
 * - Footer with count
 */

import React, { useState, useEffect, useRef } from 'react';
import { Radio, Radar } from 'lucide-react';
import AudioItem from './AudioItem';

function AudioList({
  transmissions,
  loading,
  playingId,
  audioProgress,
  audioDurations,
  expandedTranscript,
  onPlay,
  onSeek,
  onToggleExpand,
  onSelectAircraft
}) {
  // Lazy loading: only render visible items
  const [visibleCount, setVisibleCount] = useState(20);
  const loadMoreRef = useRef(null);

  // Reset visible count when transmissions change significantly
  useEffect(() => {
    setVisibleCount(20);
  }, [transmissions.length > 0 ? transmissions[0]?.id : null]);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount(prev => Math.min(prev + 20, transmissions.length));
        }
      },
      { rootMargin: '200px' }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [transmissions.length]);

  return (
    <>
      {/* Transmissions List */}
      <div className="audio-list">
        {/* Loading State */}
        {loading && transmissions.length === 0 && (
          <div className="audio-loading">
            <div className="audio-loading-radar">
              <Radar size={32} className="audio-radar-icon" />
              <div className="audio-radar-sweep" />
            </div>
            <span>Loading transmissions...</span>
          </div>
        )}

        {/* Empty State */}
        {!loading && transmissions.length === 0 && (
          <div className="audio-empty">
            <Radio size={48} />
            <p>No audio transmissions found</p>
            <span>Transmissions from rtl-airband will appear here</span>
          </div>
        )}

        {/* Transmission Items */}
        {transmissions.slice(0, visibleCount).map((transmission) => {
          const id = transmission.id;
          return (
            <AudioItem
              key={id}
              transmission={transmission}
              isPlaying={playingId === id}
              progress={audioProgress[id] || 0}
              duration={audioDurations[id] || transmission.duration_seconds}
              isExpanded={expandedTranscript[id]}
              onPlay={onPlay}
              onSeek={onSeek}
              onToggleExpand={onToggleExpand}
              onSelectAircraft={onSelectAircraft}
            />
          );
        })}

        {/* Load more sentinel */}
        {visibleCount < transmissions.length && (
          <div ref={loadMoreRef} className="audio-load-more">
            <div className="audio-loading-radar small">
              <Radar size={20} className="audio-radar-icon" />
              <div className="audio-radar-sweep" />
            </div>
            <span>Loading more...</span>
          </div>
        )}
      </div>

      {/* Footer Count */}
      <div className="audio-footer">
        <span>
          Showing {Math.min(visibleCount, transmissions.length)} of {transmissions.length} transmissions
        </span>
      </div>
    </>
  );
}

export default AudioList;
