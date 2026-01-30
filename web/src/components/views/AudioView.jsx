/**
 * AudioView - Main view for audio transmissions.
 *
 * This is the refactored version that uses extracted components:
 * - AudioStatsBar: Header statistics
 * - AudioFilters: Filter toolbar
 * - AudioControls: Playback controls
 * - AudioList: Transmission list with virtualization
 *
 * And extracted hooks:
 * - useAudioState: Global audio state management
 * - useSocketIOAudio: Socket.IO connection for real-time updates
 * - useAudioPlayback: Audio playback functionality
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useSocketApi } from '../../hooks';
import { globalAudioState, hasEmergencyKeyword } from '../../hooks/useAudioState';
import { useSocketIOAudio, retrySocketIOAudio } from '../../hooks/socket';
import { useAudioPlayback } from '../../hooks/useAudioPlayback';
import { AudioStatsBar, AudioFilters, AudioControls, AudioList } from '../audio';

// Re-export audio state utilities for backward compatibility
export {
  setAutoplay,
  setAutoplayFilter,
  clearAutoplayFilter,
  getGlobalAudioState,
  subscribeToAudioStateChanges,
  removeFromQueue,
  clearQueue,
  reorderQueue,
} from '../../hooks/useAudioState';

// Re-export Socket.IO audio functions for backward compatibility
export { retrySocketIOAudio as retryAudioSocket } from '../../hooks/socket';
// Note: initAudioSocket and disconnectAudioSocket are no longer needed with Socket.IO
// The connection is handled automatically by useSocketIOAudio

export function AudioView({ apiBase, onSelectAircraft }) {
  // Filter state
  const [timeRange, setTimeRange] = useState('24h');
  const [statusFilter, setStatusFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [flightMatchFilter, setFlightMatchFilter] = useState('all');
  const [callsignFilter, setCallsignFilter] = useState('');
  const [airlineFilter, setAirlineFilter] = useState('all');
  const [flightTypeFilter, setFlightTypeFilter] = useState('all');
  const [emergencyFilter, setEmergencyFilter] = useState(false);
  const [availableChannels, setAvailableChannels] = useState([]);
  const [expandedTranscript, setExpandedTranscript] = useState({});

  // Refs
  const filteredTransmissionsRef = useRef([]);

  // Use Socket.IO audio hook for real-time updates
  const { socketConnected, realtimeTransmissions } = useSocketIOAudio(apiBase);

  // Use audio playback hook
  const {
    playingId,
    audioProgress,
    audioDurations,
    autoplay,
    audioVolume,
    isMuted,
    handlePlay,
    handleSeek,
    toggleMute,
    handleVolumeChange,
    handleToggleAutoplay,
  } = useAudioPlayback({
    audioRefs: globalAudioState.audioRefs,
    filteredTransmissionsRef,
  });

  // Time range hours mapping
  const hours = { '1h': 1, '6h': 6, '24h': 24, '48h': 48, '7d': 168 };

  // Build endpoint with filters
  const statusParam = statusFilter !== 'all' ? `&status=${statusFilter}` : '';
  const channelParam = channelFilter !== 'all' ? `&channel=${encodeURIComponent(channelFilter)}` : '';
  const endpoint = `/api/v1/audio?hours=${hours[timeRange]}&limit=100${statusParam}${channelParam}`;

  // Data fetching
  const { data, loading, refetch } = useSocketApi(endpoint, null, apiBase, {});
  const { data: statsData } = useSocketApi('/api/v1/audio?stats=true', null, apiBase, {});
  const { data: statusData } = useSocketApi('/api/v1/system/status', null, apiBase, {});

  // Extract unique channels from stats
  useEffect(() => {
    if (statsData?.by_channel) {
      setAvailableChannels(Object.keys(statsData.by_channel));
    }
  }, [statsData]);

  // Refetch on filter change
  useEffect(() => { refetch(); }, [timeRange, statusFilter, channelFilter, refetch]);

  // Merge realtime transmissions with API data
  const mergedTransmissions = useMemo(() => {
    const apiTransmissions = data?.transmissions || [];
    const apiIds = new Set(apiTransmissions.map(t => t.id));
    const newFromSocket = realtimeTransmissions.filter(t => !apiIds.has(t.id));
    return [...newFromSocket, ...apiTransmissions];
  }, [data?.transmissions, realtimeTransmissions]);

  // Extract unique airlines
  const availableAirlines = useMemo(() => {
    const airlines = new Map();
    mergedTransmissions.forEach(t => {
      if (t.identified_airframes) {
        t.identified_airframes.forEach(af => {
          if (af.airline_icao && af.airline_name) {
            airlines.set(af.airline_icao, af.airline_name);
          }
        });
      }
    });
    return Array.from(airlines.entries())
      .map(([icao, name]) => ({ icao, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [mergedTransmissions]);

  // Filter transmissions
  const filteredTransmissions = useMemo(() => {
    if (!mergedTransmissions.length) return [];

    return mergedTransmissions.filter(t => {
      // Text search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          t.channel_name?.toLowerCase().includes(query) ||
          t.transcript?.toLowerCase().includes(query) ||
          t.filename?.toLowerCase().includes(query) ||
          t.frequency_mhz?.toString().includes(query) ||
          t.identified_airframes?.some(af =>
            af.callsign?.toLowerCase().includes(query) ||
            af.airline_name?.toLowerCase().includes(query)
          );
        if (!matchesSearch) return false;
      }

      // Flight match filter
      const hasMatches = t.identified_airframes && t.identified_airframes.length > 0;
      if (flightMatchFilter === 'matched' && !hasMatches) return false;
      if (flightMatchFilter === 'unmatched' && hasMatches) return false;

      // Callsign filter
      if (callsignFilter) {
        const callsignQuery = callsignFilter.toUpperCase();
        const matchesCallsign = t.identified_airframes?.some(af =>
          af.callsign?.toUpperCase().includes(callsignQuery)
        );
        if (!matchesCallsign) return false;
      }

      // Airline filter
      if (airlineFilter !== 'all') {
        const matchesAirline = t.identified_airframes?.some(af =>
          af.airline_icao === airlineFilter
        );
        if (!matchesAirline) return false;
      }

      // Flight type filter
      if (flightTypeFilter !== 'all') {
        const matchesType = t.identified_airframes?.some(af =>
          af.type === flightTypeFilter
        );
        if (!matchesType) return false;
      }

      // Emergency keyword filter
      if (emergencyFilter && !hasEmergencyKeyword(t.transcript)) {
        return false;
      }

      return true;
    });
  }, [mergedTransmissions, searchQuery, flightMatchFilter, callsignFilter, airlineFilter, flightTypeFilter, emergencyFilter]);

  // Keep ref updated for use in event listeners
  useEffect(() => {
    filteredTransmissionsRef.current = filteredTransmissions;
  }, [filteredTransmissions]);

  // Autoplay toggle handler wrapper
  const onToggleAutoplay = useCallback(() => {
    handleToggleAutoplay(realtimeTransmissions, filteredTransmissions);
  }, [handleToggleAutoplay, realtimeTransmissions, filteredTransmissions]);

  // Clear all filters handler
  const handleClearFilters = useCallback(() => {
    setFlightMatchFilter('all');
    setAirlineFilter('all');
    setFlightTypeFilter('all');
    setCallsignFilter('');
    setEmergencyFilter(false);
  }, []);

  // Expand transcript handler
  const handleToggleExpand = useCallback((id) => {
    setExpandedTranscript(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  return (
    <div className="audio-container">
      {/* Header Stats */}
      <AudioStatsBar statsData={statsData} statusData={statusData} />

      {/* Toolbar */}
      <div className="audio-toolbar">
        <AudioFilters
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          channelFilter={channelFilter}
          onChannelFilterChange={setChannelFilter}
          availableChannels={availableChannels}
          flightMatchFilter={flightMatchFilter}
          onFlightMatchFilterChange={setFlightMatchFilter}
          airlineFilter={airlineFilter}
          onAirlineFilterChange={setAirlineFilter}
          availableAirlines={availableAirlines}
          flightTypeFilter={flightTypeFilter}
          onFlightTypeFilterChange={setFlightTypeFilter}
          callsignFilter={callsignFilter}
          onCallsignFilterChange={setCallsignFilter}
          emergencyFilter={emergencyFilter}
          onEmergencyFilterChange={setEmergencyFilter}
          onClearFilters={handleClearFilters}
        />

        <AudioControls
          audioVolume={audioVolume}
          isMuted={isMuted}
          onVolumeChange={handleVolumeChange}
          onToggleMute={toggleMute}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          autoplay={autoplay}
          onToggleAutoplay={onToggleAutoplay}
          loading={loading}
          onRefresh={refetch}
          socketConnected={socketConnected}
        />
      </div>

      {/* Transmissions List */}
      <AudioList
        transmissions={filteredTransmissions}
        loading={loading}
        playingId={playingId}
        audioProgress={audioProgress}
        audioDurations={audioDurations}
        expandedTranscript={expandedTranscript}
        onPlay={handlePlay}
        onSeek={handleSeek}
        onToggleExpand={handleToggleExpand}
        onSelectAircraft={onSelectAircraft}
      />
    </div>
  );
}

export default AudioView;
