import React, { Suspense, lazy } from 'react';
import { Radar, AlertTriangle, RefreshCw } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

import { useAircraftDetail } from './hooks/useAircraftDetail';
import { AircraftHeader, AircraftPhotoHero, TabNavigation, ExternalLinks } from './components';
import { InfoTabSkeleton, MapTabSkeleton } from './skeletons';
import { ErrorBoundary } from '../common/ErrorBoundary';

// Lazy load tab components for better performance
const OverviewTab = lazy(() =>
  import('./tabs/OverviewTab').then((m) => ({ default: m.OverviewTab }))
);
const CommunicationsTab = lazy(() =>
  import('./tabs/CommunicationsTab').then((m) => ({ default: m.CommunicationsTab }))
);
const SafetyTab = lazy(() => import('./tabs/SafetyTab').then((m) => ({ default: m.SafetyTab })));
const TrackTab = lazy(() => import('./tabs/TrackTab').then((m) => ({ default: m.TrackTab })));

// Loading fallback components
function TabLoadingFallback({ type = 'default' }) {
  if (type === 'overview') return <InfoTabSkeleton />;
  if (type === 'track') return <MapTabSkeleton />;

  return (
    <div className="detail-loading" role="status" aria-busy="true">
      <div className="detail-loading-radar">
        <Radar size={32} className="detail-radar-icon" aria-hidden="true" />
        <div className="detail-radar-sweep" />
      </div>
      <span>Loading...</span>
    </div>
  );
}

export function AircraftDetailPage({
  hex,
  apiUrl,
  onClose,
  onSelectAircraft,
  onViewHistoryEvent,
  onViewEvent,
  aircraft,
  aircraftInfo,
  trackHistory,
  feederLocation,
  wsRequest,
  wsConnected,
  initialTab,
  onTabChange,
}) {
  // Use consolidated state management hook
  const state = useAircraftDetail({
    hex,
    apiUrl,
    aircraft,
    aircraftInfo,
    feederLocation,
    wsRequest,
    wsConnected,
    initialTab: initialTab || 'overview', // Default to new overview tab
    onTabChange,
  });

  const {
    // Core
    info,
    loading,
    error,
    retry,
    activeTab,
    setActiveTab,
    tailInfo,
    baseUrl,
    shareSuccess,
    handleShare,
    calculateDistance,

    // Photo
    photoInfo,
    photoUrl,
    photoState,
    photoRetryCount,
    useThumbnail,
    photoStatus,
    handlePhotoError,
    handlePhotoLoad,
    retryPhoto,

    // ACARS
    acarsMessages,
    acarsHours,
    setAcarsHours,
    acarsCompactMode,
    setAcarsCompactMode,
    acarsQuickFilters,
    setAcarsQuickFilters,
    expandedMessages,
    setExpandedMessages,
    allMessagesExpanded,
    setAllMessagesExpanded,

    // Safety
    safetyEvents,
    safetyHours,
    setSafetyHours,
    expandedSnapshots,
    setExpandedSnapshots,
    expandedSafetyMaps,
    setExpandedSafetyMaps,
    safetyTrackData,
    setSafetyTrackData,
    safetyReplayState,
    setSafetyReplayState,

    // Radio
    radioTransmissions,
    radioHours,
    setRadioHours,
    radioLoading,
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
    filteredRadioTransmissions,
    handleRadioPlay,
    handleRadioSeek,
    toggleRadioAutoplay,

    // History/sightings
    sightings,
    showTrackMap: _showTrackMap,
    setShowTrackMap,
    replayPosition: _replayPosition,
    setReplayPosition,
    isPlaying: _isPlaying,
    setIsPlaying,

    // Track tab
    trackReplayPosition,
    setTrackReplayPosition,
    trackIsPlaying,
    setTrackIsPlaying,
    trackReplaySpeed,
    setTrackReplaySpeed,
    showTrackPoints,
    setShowTrackPoints,
    trackLiveMode,
    setTrackLiveMode,
    showTelemOverlay,
    setShowTelemOverlay,

    // Graphs
    graphZoom,
    setGraphZoom,
    graphScrollOffset,
    setGraphScrollOffset,
  } = state;

  // Render loading state
  if (loading) {
    return (
      <div
        className="aircraft-detail-page"
        role="dialog"
        aria-label="Aircraft details"
        aria-busy="true"
      >
        <AircraftHeader
          hex={hex}
          aircraft={aircraft}
          info={info}
          tailInfo={tailInfo}
          shareSuccess={shareSuccess}
          onShare={handleShare}
          onClose={onClose}
        />
        <div className="detail-loading">
          <div className="detail-loading-radar">
            <Radar size={32} className="detail-radar-icon" aria-hidden="true" />
            <div className="detail-radar-sweep" />
          </div>
          <span>Loading aircraft data...</span>
        </div>
      </div>
    );
  }

  // Render tab content based on new 4-tab structure
  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <Suspense fallback={<TabLoadingFallback type="overview" />}>
            <OverviewTab
              info={info}
              hex={hex}
              photoInfo={photoInfo}
              aircraft={aircraft}
              trackHistory={trackHistory}
              calculateDistance={calculateDistance}
            />
          </Suspense>
        );

      case 'communications':
        return (
          <Suspense fallback={<TabLoadingFallback />}>
            <CommunicationsTab
              hex={hex}
              // Radio props
              radioLoading={radioLoading}
              radioTransmissions={radioTransmissions}
              filteredRadioTransmissions={filteredRadioTransmissions}
              radioHours={radioHours}
              setRadioHours={setRadioHours}
              radioSearchQuery={radioSearchQuery}
              setRadioSearchQuery={setRadioSearchQuery}
              radioStatusFilter={radioStatusFilter}
              setRadioStatusFilter={setRadioStatusFilter}
              radioPlayingId={radioPlayingId}
              radioAudioProgress={radioAudioProgress}
              radioAudioDurations={radioAudioDurations}
              radioExpandedTranscript={radioExpandedTranscript}
              setRadioExpandedTranscript={setRadioExpandedTranscript}
              radioAutoplay={radioAutoplay}
              handleRadioPlay={handleRadioPlay}
              handleRadioSeek={handleRadioSeek}
              toggleRadioAutoplay={toggleRadioAutoplay}
              // ACARS props
              acarsMessages={acarsMessages}
              acarsHours={acarsHours}
              setAcarsHours={setAcarsHours}
              acarsCompactMode={acarsCompactMode}
              setAcarsCompactMode={setAcarsCompactMode}
              acarsQuickFilters={acarsQuickFilters}
              setAcarsQuickFilters={setAcarsQuickFilters}
              expandedMessages={expandedMessages}
              setExpandedMessages={setExpandedMessages}
              allMessagesExpanded={allMessagesExpanded}
              setAllMessagesExpanded={setAllMessagesExpanded}
            />
          </Suspense>
        );

      case 'safety':
        return (
          <Suspense fallback={<TabLoadingFallback />}>
            <SafetyTab
              hex={hex}
              safetyEvents={safetyEvents}
              safetyHours={safetyHours}
              setSafetyHours={setSafetyHours}
              expandedSnapshots={expandedSnapshots}
              setExpandedSnapshots={setExpandedSnapshots}
              expandedSafetyMaps={expandedSafetyMaps}
              setExpandedSafetyMaps={setExpandedSafetyMaps}
              safetyTrackData={safetyTrackData}
              setSafetyTrackData={setSafetyTrackData}
              safetyReplayState={safetyReplayState}
              setSafetyReplayState={setSafetyReplayState}
              onSelectAircraft={onSelectAircraft}
              onViewHistoryEvent={onViewHistoryEvent}
              onViewEvent={onViewEvent}
              baseUrl={baseUrl}
              wsRequest={wsRequest}
              wsConnected={wsConnected}
            />
          </Suspense>
        );

      case 'track':
        return (
          <Suspense fallback={<MapTabSkeleton />}>
            <TrackTab
              aircraft={aircraft}
              sightings={sightings}
              feederLocation={feederLocation}
              trackReplayPosition={trackReplayPosition}
              setTrackReplayPosition={setTrackReplayPosition}
              trackIsPlaying={trackIsPlaying}
              setTrackIsPlaying={setTrackIsPlaying}
              trackReplaySpeed={trackReplaySpeed}
              setTrackReplaySpeed={setTrackReplaySpeed}
              showTrackPoints={showTrackPoints}
              setShowTrackPoints={setShowTrackPoints}
              trackLiveMode={trackLiveMode}
              setTrackLiveMode={setTrackLiveMode}
              showTelemOverlay={showTelemOverlay}
              setShowTelemOverlay={setShowTelemOverlay}
              graphZoom={graphZoom}
              setGraphZoom={setGraphZoom}
              graphScrollOffset={graphScrollOffset}
              setGraphScrollOffset={setGraphScrollOffset}
            />
          </Suspense>
        );

      default:
        // Fallback to overview for unknown tabs
        return (
          <Suspense fallback={<TabLoadingFallback type="overview" />}>
            <OverviewTab
              info={info}
              hex={hex}
              photoInfo={photoInfo}
              aircraft={aircraft}
              trackHistory={trackHistory}
              calculateDistance={calculateDistance}
            />
          </Suspense>
        );
    }
  };

  return (
    <div
      className="aircraft-detail-page"
      role="dialog"
      aria-label={`Aircraft details for ${aircraft?.flight?.trim() || hex}`}
    >
      {/* Header Section */}
      <AircraftHeader
        hex={hex}
        aircraft={aircraft}
        info={info}
        tailInfo={tailInfo}
        shareSuccess={shareSuccess}
        onShare={handleShare}
        onClose={onClose}
      />

      {/* Photo Hero Section */}
      <AircraftPhotoHero
        hex={hex}
        info={info}
        photoInfo={photoInfo}
        photoUrl={photoUrl}
        photoState={photoState}
        photoRetryCount={photoRetryCount}
        useThumbnail={useThumbnail}
        photoStatus={photoStatus}
        onPhotoLoad={handlePhotoLoad}
        onPhotoError={handlePhotoError}
        onRetry={retryPhoto}
      />

      {/* Tab Navigation - Updated for 4-tab structure */}
      <TabNavigation
        activeTab={activeTab}
        onTabChange={setActiveTab}
        radioCount={radioTransmissions.length}
        acarsCount={acarsMessages.length}
        safetyCount={safetyEvents.length}
      />

      {/* Tab Content */}
      <main className="detail-content detail-tab-content">
        {error ? (
          <div className="error-state-container" role="alert">
            <div className="error-state-content">
              <AlertTriangle size={48} className="error-state-icon" aria-hidden="true" />
              <h2 className="error-state-title">Failed to Load</h2>
              <p className="error-state-message">{error.message}</p>
              <button className="error-state-retry-btn" onClick={retry} type="button">
                <RefreshCw size={16} aria-hidden="true" />
                Retry
              </button>
            </div>
          </div>
        ) : (
          <ErrorBoundary onRetry={retry}>{renderTabContent()}</ErrorBoundary>
        )}
      </main>

      {/* External Links */}
      <ExternalLinks hex={hex} callsign={aircraft?.flight?.trim()} />
    </div>
  );
}
