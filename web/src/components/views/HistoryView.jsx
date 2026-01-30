import React, { useState, useEffect, useMemo, useRef } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Map as MapIcon, MessageCircle } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import { useSocketApi, useSortState, useAcarsData, useReplayState } from '../../hooks';
import { TabBar } from '../common/TabBar';
import { SafetyEventCard } from '../safety/SafetyEventCard';
import { SortControls } from '../common/SortControls';

// Import history components
import {
  VALID_DATA_TYPES,
  TIME_RANGES,
  TIME_RANGE_HOURS,
  SESSION_SORT_CONFIG,
  SESSION_SORT_FIELDS,
  SIGHTINGS_SORT_CONFIG,
  SAFETY_SORT_CONFIG,
  SAFETY_SORT_FIELDS,
  ACARS_SORT_CONFIG,
} from '../history/historyConstants';

import { SessionCard } from '../history/SessionCard';
import { SessionsFilters } from '../history/SessionsFilters';
import { SightingsTable } from '../history/SightingsTable';
import { SafetyEventMap } from '../history/SafetyEventMap';
import { SnapshotContainer } from '../history/SnapshotView';
import { AcarsFilters, AcarsQuickFilters } from '../history/AcarsFilters';
import { AcarsMessageItem } from '../history/AcarsMessageItem';

export function HistoryView({
  apiBase,
  onSelectAircraft,
  onSelectByTail,
  onViewEvent,
  targetEventId,
  onEventViewed,
  hashParams = {},
  setHashParams,
  wsRequest,
  wsConnected
}) {
  // Sync viewType with URL hash params
  const [viewType, setViewTypeState] = useState(() => {
    if (hashParams.data && VALID_DATA_TYPES.includes(hashParams.data)) {
      return hashParams.data;
    }
    return 'sessions';
  });

  // Wrapper to update both state and URL
  const setViewType = (type) => {
    setViewTypeState(type);
    if (setHashParams) {
      setHashParams({ data: type });
    }
  };

  // Sync with hash params changes (back/forward navigation)
  useEffect(() => {
    if (hashParams.data && VALID_DATA_TYPES.includes(hashParams.data) && hashParams.data !== viewType) {
      setViewTypeState(hashParams.data);
    }
  }, [hashParams.data, viewType]);

  const [timeRange, setTimeRange] = useState('24h');
  const [expandedSnapshots, setExpandedSnapshots] = useState({});
  const eventRefs = useRef({});

  // Session filters
  const [sessionSearch, setSessionSearch] = useState('');
  const [showMilitaryOnly, setShowMilitaryOnly] = useState(false);

  // Use replay state hook for safety event maps
  const replay = useReplayState({
    apiBase,
    wsRequest,
    wsConnected
  });

  // Use ACARS data hook
  const acars = useAcarsData({
    apiBase,
    timeRange,
    wsRequest,
    wsConnected,
    viewType
  });

  // Toggle snapshot expansion
  const toggleSnapshot = (eventId) => {
    setExpandedSnapshots(prev => ({
      ...prev,
      [eventId]: !prev[eventId]
    }));
  };

  // Build API endpoint based on view type
  const endpoint = viewType === 'sessions'
    ? `/api/v1/sessions?hours=${TIME_RANGE_HOURS[timeRange]}`
    : viewType === 'sightings'
    ? `/api/v1/sightings?hours=${TIME_RANGE_HOURS[timeRange]}&limit=100`
    : viewType === 'acars'
    ? `/api/v1/acars?hours=${TIME_RANGE_HOURS[timeRange]}&limit=200`
    : `/api/v1/safety/events?hours=${TIME_RANGE_HOURS[timeRange]}&limit=100`;

  const { data } = useSocketApi(endpoint, null, apiBase, { wsRequest, wsConnected });

  // Handle navigation to a specific safety event
  useEffect(() => {
    if (!targetEventId || !data?.events) return;

    setViewType('safety');

    const eventIndex = data.events.findIndex(e => e.id === targetEventId || e.id === String(targetEventId));
    if (eventIndex === -1) return;

    const event = data.events[eventIndex];
    const eventKey = event.id || eventIndex;

    if (!replay.expandedMaps[eventKey]) {
      replay.toggleMap(eventKey, event);
    }

    setTimeout(() => {
      const eventEl = eventRefs.current[eventKey];
      if (eventEl) {
        eventEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        eventEl.classList.add('highlight-event');
        setTimeout(() => eventEl.classList.remove('highlight-event'), 2000);
      }
    }, 100);

    onEventViewed?.();
  }, [targetEventId, data?.events, replay.expandedMaps, replay.toggleMap, onEventViewed]);

  // Filter sessions (before sorting)
  const filteredSessionsUnsorted = useMemo(() => {
    if (!data?.sessions) return [];

    let filtered = [...data.sessions];

    if (sessionSearch) {
      const search = sessionSearch.toLowerCase();
      filtered = filtered.filter(s =>
        s.icao_hex?.toLowerCase().includes(search) ||
        s.callsign?.toLowerCase().includes(search) ||
        s.type?.toLowerCase().includes(search)
      );
    }

    if (showMilitaryOnly) {
      filtered = filtered.filter(s => s.is_military);
    }

    return filtered;
  }, [data?.sessions, sessionSearch, showMilitaryOnly]);

  // Sort sessions
  const {
    sortField: sessionSortField,
    sortDirection: sessionSortDirection,
    handleSort: handleSessionSort,
    sortedData: filteredSessions
  } = useSortState({
    viewKey: 'history-sessions',
    defaultField: 'last_seen',
    defaultDirection: 'desc',
    data: filteredSessionsUnsorted,
    sortConfig: SESSION_SORT_CONFIG
  });

  // Sort sightings
  const {
    sortField: sightingsSortField,
    sortDirection: sightingsSortDirection,
    handleSort: handleSightingsSort,
    sortedData: sortedSightings
  } = useSortState({
    viewKey: 'history-sightings',
    defaultField: 'timestamp',
    defaultDirection: 'desc',
    data: data?.sightings || [],
    sortConfig: SIGHTINGS_SORT_CONFIG
  });

  // Sort safety events
  const {
    sortField: safetySortField,
    sortDirection: safetySortDirection,
    handleSort: handleSafetySort,
    sortedData: sortedSafetyEvents
  } = useSortState({
    viewKey: 'history-safety',
    defaultField: 'timestamp',
    defaultDirection: 'desc',
    data: data?.events || [],
    sortConfig: SAFETY_SORT_CONFIG
  });

  // Sort ACARS
  const {
    sortField: acarsSortField,
    sortDirection: acarsSortDirection,
    handleSort: handleAcarsSort,
    sortedData: sortedAcarsMessages
  } = useSortState({
    viewKey: 'history-acars',
    defaultField: 'timestamp',
    defaultDirection: 'desc',
    data: acars.filteredAcarsMessages,
    sortConfig: ACARS_SORT_CONFIG
  });

  // Calculate counts for tab badges
  const sessionCount = data?.sessions?.length || 0;
  const acarsCount = acars.acarsMessages?.length || 0;
  const safetyCount = data?.events?.length || 0;
  const hasCriticalSafety = data?.events?.some(e => e.severity === 'critical');

  // Tab configuration
  const tabs = [
    { id: 'sessions', label: 'Sessions', count: sessionCount > 0 ? sessionCount : null },
    { id: 'sightings', label: 'Sightings' },
    { id: 'acars', label: 'ACARS', icon: <MessageCircle size={14} />, count: acarsCount > 0 ? acarsCount : null, badgeVariant: 'info' },
    { id: 'safety', label: 'Safety', icon: <AlertTriangle size={14} />, count: safetyCount > 0 ? safetyCount : null, badgeVariant: safetyCount > 0 ? 'warning' : 'default', alertDot: hasCriticalSafety }
  ];

  return (
    <div className="history-container">
      <TabBar
        tabs={tabs}
        activeTab={viewType}
        onTabChange={setViewType}
        timeRanges={TIME_RANGES}
        activeTimeRange={timeRange}
        onTimeRangeChange={setTimeRange}
      />

      {viewType === 'sessions' && (
        <>
          <SessionsFilters
            sessionSearch={sessionSearch}
            setSessionSearch={setSessionSearch}
            showMilitaryOnly={showMilitaryOnly}
            setShowMilitaryOnly={setShowMilitaryOnly}
            sessionSortField={sessionSortField}
            sessionSortDirection={sessionSortDirection}
            handleSessionSort={handleSessionSort}
            filteredCount={filteredSessions.length}
            totalCount={data?.sessions?.length || 0}
          />
          <div className="sessions-grid">
            {filteredSessions.map((session, i) => (
              <SessionCard
                key={i}
                session={session}
                onSelectAircraft={onSelectAircraft}
              />
            ))}
          </div>
        </>
      )}

      {viewType === 'sightings' && (
        <SightingsTable
          sightings={sortedSightings}
          sortField={sightingsSortField}
          sortDirection={sightingsSortDirection}
          onSort={handleSightingsSort}
          onSelectAircraft={onSelectAircraft}
        />
      )}

      {viewType === 'safety' && (
        <>
          <div className="safety-events-header">
            <SortControls
              fields={SAFETY_SORT_FIELDS}
              activeField={safetySortField}
              direction={safetySortDirection}
              onSort={handleSafetySort}
            />
            <div className="safety-events-count">
              {sortedSafetyEvents.length} event{sortedSafetyEvents.length !== 1 ? 's' : ''}
            </div>
          </div>
          <div className="safety-events-grid">
            {sortedSafetyEvents.length === 0 && (
              <div className="no-events-message">
                <AlertTriangle size={32} />
                <p>No safety events in the selected time range</p>
              </div>
            )}
            {sortedSafetyEvents.map((event, i) => {
              const eventKey = event.id || i;
              const hasSnapshot = event.aircraft_snapshot || event.aircraft_snapshot_2;
              const isExpanded = expandedSnapshots[eventKey];
              const hasMap = event.aircraft_snapshot?.lat || event.aircraft_snapshot_2?.lat;

              return (
                <div
                  key={eventKey}
                  ref={el => eventRefs.current[eventKey] = el}
                  className="safety-event-wrapper"
                >
                  <SafetyEventCard
                    event={event}
                    onSelectAircraft={onSelectAircraft}
                    onViewEvent={onViewEvent}
                  />

                  <div className="safety-event-expand-actions">
                    {hasSnapshot && (
                      <button
                        className="snapshot-toggle"
                        onClick={() => toggleSnapshot(eventKey)}
                      >
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        {isExpanded ? 'Hide' : 'Show'} Telemetry
                      </button>
                    )}

                    {hasMap && (
                      <button
                        className="snapshot-toggle map-toggle"
                        onClick={() => replay.toggleMap(eventKey, event)}
                      >
                        <MapIcon size={14} />
                        {replay.expandedMaps[eventKey] ? 'Hide' : 'Show'} Map
                      </button>
                    )}
                  </div>

                  {isExpanded && (
                    <SnapshotContainer
                      event={event}
                      onSelectAircraft={onSelectAircraft}
                    />
                  )}

                  {replay.expandedMaps[eventKey] && (
                    <SafetyEventMap
                      eventKey={eventKey}
                      event={event}
                      trackData={replay.trackData}
                      replayState={replay.replayState}
                      graphZoomState={replay.graphZoomState}
                      onInitializeMap={replay.initializeMap}
                      onReplayChange={replay.handleReplayChange}
                      onTogglePlay={replay.togglePlay}
                      onSkipToStart={replay.skipToStart}
                      onSkipToEnd={replay.skipToEnd}
                      onSpeedChange={replay.handleSpeedChange}
                      onJumpToEvent={replay.jumpToEvent}
                      onGraphWheel={replay.handleGraphWheel}
                      onGraphDragStart={replay.handleGraphDragStart}
                      onGraphDragMove={replay.handleGraphDragMove}
                      onGraphDragEnd={replay.handleGraphDragEnd}
                      onResetGraphZoom={replay.resetGraphZoom}
                      getReplayTimestamp={replay.getReplayTimestamp}
                      onSelectAircraft={onSelectAircraft}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {viewType === 'acars' && (
        <>
          <AcarsFilters
            acarsSearch={acars.acarsSearch}
            setAcarsSearch={acars.setAcarsSearch}
            acarsAirlineFilter={acars.acarsAirlineFilter}
            setAcarsAirlineFilter={acars.setAcarsAirlineFilter}
            acarsSource={acars.acarsSource}
            setAcarsSource={acars.setAcarsSource}
            acarsSelectedLabels={acars.acarsSelectedLabels}
            setAcarsSelectedLabels={acars.setAcarsSelectedLabels}
            showLabelDropdown={acars.showLabelDropdown}
            setShowLabelDropdown={acars.setShowLabelDropdown}
            labelDropdownRef={acars.labelDropdownRef}
            availableLabels={acars.availableLabels}
            acarsHideEmpty={acars.acarsHideEmpty}
            setAcarsHideEmpty={acars.setAcarsHideEmpty}
            acarsCompactMode={acars.acarsCompactMode}
            setAcarsCompactMode={acars.setAcarsCompactMode}
            allMessagesExpanded={acars.allMessagesExpanded}
            toggleAllMessages={acars.toggleAllMessages}
            acarsSortField={acarsSortField}
            acarsSortDirection={acarsSortDirection}
            handleAcarsSort={handleAcarsSort}
            filteredCount={sortedAcarsMessages.length}
            totalCount={acars.acarsMessages.length}
          />
          <AcarsQuickFilters
            acarsQuickFilters={acars.acarsQuickFilters}
            toggleQuickFilter={acars.toggleQuickFilter}
            clearQuickFilters={acars.clearQuickFilters}
          />
          <div
            ref={acars.acarsListRef}
            className={`acars-history-list ${acars.acarsCompactMode ? 'compact' : ''}`}
            onScroll={acars.handleAcarsScroll}
          >
            {sortedAcarsMessages.length === 0 ? (
              <div className="no-events-message">
                <MessageCircle size={32} />
                <p>No ACARS messages in the selected time range</p>
              </div>
            ) : (
              sortedAcarsMessages.slice(0, acars.visibleAcarsCount).map((msg, i) => (
                <AcarsMessageItem
                  key={i}
                  msg={msg}
                  index={i}
                  callsignHexCache={acars.callsignHexCache}
                  regHexCache={acars.regHexCache}
                  labelReference={acars.labelReference}
                  allMessagesExpanded={acars.allMessagesExpanded}
                  expandedMessages={acars.expandedMessages}
                  toggleMessageExpansion={acars.toggleMessageExpansion}
                  onSelectAircraft={onSelectAircraft}
                  onSelectByTail={onSelectByTail}
                />
              ))
            )}
            {acars.visibleAcarsCount < sortedAcarsMessages.length && (
              <div className="acars-load-more">
                Showing {acars.visibleAcarsCount} of {sortedAcarsMessages.length} - scroll for more
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
