import React, { useState, useCallback, useRef, useEffect } from 'react';
import { X, Share2, Check, Plane, MapPin, Radio, AlertTriangle, Database, Radar, RefreshCw } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

import { useAircraftDetailV2 } from './hooks/useAircraftDetailV2';
import { StickyTelemetryBar } from './components/StickyTelemetryBar';
import { CompactPhotoStrip } from './components/CompactPhotoStrip';
import { PhotoLightbox } from './components/PhotoLightbox';
import { DetailSection } from './components/DetailSection';
import { ExternalLinks } from './components/ExternalLinks';
import {
  AircraftInfoSection,
  TrackSection,
  CommunicationsSection,
  SafetySection,
  DataSourcesSection,
} from './sections';
import { ErrorBoundary } from '../common/ErrorBoundary';

import '../../styles/aircraft-detail-v2.css';

/**
 * CompactHeader - Reduced height header (48px)
 */
function CompactHeader({ hex, aircraft, info, tailInfo, shareSuccess, onShare, onClose }) {
  return (
    <header className="detail-v2-header" role="banner">
      <div className="detail-v2-header-left">
        <span className="detail-v2-flag" aria-label={`Flag: ${tailInfo.country || 'Unknown'}`}>
          {tailInfo.flag}
        </span>
        <div className="detail-v2-titles">
          <h1 className="detail-v2-callsign">{aircraft?.flight?.trim() || hex?.toUpperCase()}</h1>
          <span className="detail-v2-hex">{hex?.toUpperCase()}</span>
        </div>
        <div className="detail-v2-badges">
          {(info?.type_name || info?.model) && (
            <span className={`detail-v2-badge type ${info?.is_military ? 'military' : ''}`}>
              {info.type_name || info.model}
            </span>
          )}
          {info?.is_military && <span className="detail-v2-badge military">MIL</span>}
          {!info?.is_military && info?.operator && (
            <span className="detail-v2-badge operator" title={info.operator}>
              {info.operator}
            </span>
          )}
        </div>
      </div>
      <div className="detail-v2-header-actions">
        <button
          className={`detail-v2-header-btn share ${shareSuccess ? 'success' : ''}`}
          onClick={onShare}
          title="Share link"
          aria-label={shareSuccess ? 'Link copied' : 'Share link'}
        >
          {shareSuccess ? <Check size={16} /> : <Share2 size={16} />}
        </button>
        <button
          className="detail-v2-header-btn close"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </div>
    </header>
  );
}

/**
 * AircraftDetailV2 - Single scrollable view with collapsible sections
 *
 * Layout:
 * - Compact Header (48px)
 * - Photo Strip (120px, 80px mobile)
 * - Sticky Telemetry Bar (56px)
 * - Scrollable Sections (Aircraft, Track, Communications, Safety, Sources)
 * - Footer (44px)
 */
export function AircraftDetailV2({
  hex,
  apiUrl,
  onClose,
  onSelectAircraft,
  onViewHistoryEvent,
  onViewEvent,
  aircraft,
  aircraftInfo: _aircraftInfo,
  trackHistory: _trackHistory,
  feederLocation,
  wsRequest,
  wsConnected,
}) {
  // Content scroll ref for sticky telemetry shadow
  const contentRef = useRef(null);
  const [isScrolled, setIsScrolled] = useState(false);
  const [showPhotoLightbox, setShowPhotoLightbox] = useState(false);

  // Use V2 hook for section-based state management
  const state = useAircraftDetailV2({
    hex,
    apiUrl,
    aircraft,
    aircraftInfo: _aircraftInfo,
    feederLocation,
    wsRequest,
    wsConnected,
  });

  const {
    // Core
    info,
    loading,
    error,
    retry,
    tailInfo,
    shareSuccess,
    handleShare,
    calculateDistance,

    // Photo
    photoInfo,
    photoUrl,
    photoState,
    photoRetryCount,
    useThumbnail,
    handlePhotoError,
    handlePhotoLoad,
    retryPhoto: _retryPhoto,

    // Section expansion
    expandedSections,
    toggleSection,
    sectionLoadState,

    // ACARS
    acarsMessages,
    expandedMessages,
    setExpandedMessages,

    // Safety
    safetyEvents,

    // Radio
    radioTransmissions,
    filteredRadioTransmissions,
    radioPlayingId,
    radioAudioProgress,
    radioAudioDurations,
    radioExpandedTranscript,
    setRadioExpandedTranscript,
    handleRadioPlay,
    handleRadioSeek,

    // Track
    sightings,
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
    graphZoom,
    setGraphZoom,
    graphScrollOffset,
    setGraphScrollOffset,
  } = state;

  // Handle scroll for sticky telemetry shadow
  const handleScroll = useCallback(() => {
    if (contentRef.current) {
      setIsScrolled(contentRef.current.scrollTop > 0);
    }
  }, []);

  // Attach scroll listener
  useEffect(() => {
    const content = contentRef.current;
    if (content) {
      content.addEventListener('scroll', handleScroll, { passive: true });
      return () => content.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll]);

  // Photo expand handler - opens lightbox modal
  const handlePhotoExpand = useCallback(() => {
    if (photoUrl) {
      setShowPhotoLightbox(true);
    }
  }, [photoUrl]);

  const handleCloseLightbox = useCallback(() => {
    setShowPhotoLightbox(false);
  }, []);

  // Loading state
  if (loading) {
    return (
      <div
        className="aircraft-detail-v2"
        role="dialog"
        aria-label="Aircraft details"
        aria-busy="true"
      >
        <CompactHeader
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
            <Radar size={32} className="detail-radar-icon" />
            <div className="detail-radar-sweep" />
          </div>
          <span>Loading aircraft data...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div
        className="aircraft-detail-v2"
        role="dialog"
        aria-label="Aircraft details"
      >
        <CompactHeader
          hex={hex}
          aircraft={aircraft}
          info={info}
          tailInfo={tailInfo}
          shareSuccess={shareSuccess}
          onShare={handleShare}
          onClose={onClose}
        />
        <div className="error-state-container" role="alert">
          <div className="error-state-content">
            <AlertTriangle size={48} className="error-state-icon" />
            <h2 className="error-state-title">Failed to Load</h2>
            <p className="error-state-message">{error.message}</p>
            <button className="error-state-retry-btn" onClick={retry} type="button">
              <RefreshCw size={16} /> Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Data for sections
  const sourceData = info?.source_data || [];
  const hasTrackData = sightings && sightings.length > 0 && sightings.some((s) => s.lat && s.lon);
  const commCount = (radioTransmissions?.length || 0) + (acarsMessages?.length || 0);
  const safetyCount = safetyEvents?.length || 0;

  return (
    <div
      className="aircraft-detail-v2"
      role="dialog"
      aria-label={`Aircraft details for ${aircraft?.flight?.trim() || hex}`}
    >
      {/* Compact Header */}
      <CompactHeader
        hex={hex}
        aircraft={aircraft}
        info={info}
        tailInfo={tailInfo}
        shareSuccess={shareSuccess}
        onShare={handleShare}
        onClose={onClose}
      />

      {/* Sticky Telemetry Bar */}
      <StickyTelemetryBar
        aircraft={aircraft}
        calculateDistance={calculateDistance}
        isScrolled={isScrolled}
      />

      {/* Scrollable Content */}
      <main className="detail-v2-content" ref={contentRef}>
        <ErrorBoundary onRetry={retry}>
          <div className="detail-v2-sections">
            {/* Photo Thumbnail - Click to expand */}
            <CompactPhotoStrip
              hex={hex}
              info={info}
              photoInfo={photoInfo}
              photoUrl={photoUrl}
              photoState={photoState}
              photoRetryCount={photoRetryCount}
              useThumbnail={useThumbnail}
              onPhotoLoad={handlePhotoLoad}
              onPhotoError={handlePhotoError}
              onExpand={handlePhotoExpand}
            />

            {/* Aircraft Info Section - Default expanded */}
            <DetailSection
              id="aircraft"
              title="Aircraft Info"
              icon={Plane}
              isExpanded={expandedSections.aircraft}
              onToggle={() => toggleSection('aircraft')}
              isEmpty={!info}
              emptyIcon={Plane}
              emptyText="No aircraft information available"
            >
              <AircraftInfoSection info={info} hex={hex} />
            </DetailSection>

            {/* Track & Position Section - Default expanded */}
            <DetailSection
              id="track"
              title="Track & Position"
              icon={MapPin}
              isExpanded={expandedSections.track}
              onToggle={() => toggleSection('track')}
              isLoading={sectionLoadState.track === 'loading'}
              isEmpty={!hasTrackData}
              emptyIcon={MapPin}
              emptyText="No track data available"
            >
              {hasTrackData && (
                <TrackSection
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
                  graphZoom={graphZoom}
                  setGraphZoom={setGraphZoom}
                  graphScrollOffset={graphScrollOffset}
                  setGraphScrollOffset={setGraphScrollOffset}
                />
              )}
            </DetailSection>

            {/* Communications Section - Default collapsed */}
            <DetailSection
              id="communications"
              title="Communications"
              icon={Radio}
              badge={commCount}
              isExpanded={expandedSections.communications}
              onToggle={() => toggleSection('communications')}
              isLoading={sectionLoadState.communications === 'loading'}
              isEmpty={commCount === 0}
              emptyIcon={Radio}
              emptyText="No communications recorded"
            >
              <CommunicationsSection
                hex={hex}
                radioTransmissions={radioTransmissions}
                filteredRadioTransmissions={filteredRadioTransmissions}
                radioPlayingId={radioPlayingId}
                radioAudioProgress={radioAudioProgress}
                radioAudioDurations={radioAudioDurations}
                radioExpandedTranscript={radioExpandedTranscript}
                setRadioExpandedTranscript={setRadioExpandedTranscript}
                handleRadioPlay={handleRadioPlay}
                handleRadioSeek={handleRadioSeek}
                acarsMessages={acarsMessages}
                expandedMessages={expandedMessages}
                setExpandedMessages={setExpandedMessages}
              />
            </DetailSection>

            {/* Safety Events Section - Default collapsed */}
            <DetailSection
              id="safety"
              title="Safety Events"
              icon={AlertTriangle}
              badge={safetyCount}
              hasAlert={safetyCount > 0}
              isExpanded={expandedSections.safety}
              onToggle={() => toggleSection('safety')}
              isLoading={sectionLoadState.safety === 'loading'}
              isEmpty={safetyCount === 0}
              emptyIcon={AlertTriangle}
              emptyText="No safety events recorded"
            >
              <SafetySection
                hex={hex}
                safetyEvents={safetyEvents}
                onSelectAircraft={onSelectAircraft}
                onViewHistoryEvent={onViewHistoryEvent}
                onViewEvent={onViewEvent}
              />
            </DetailSection>

            {/* Data Sources Section - Default collapsed */}
            <DetailSection
              id="sources"
              title="Data Sources"
              icon={Database}
              badge={sourceData.length}
              isExpanded={expandedSections.sources}
              onToggle={() => toggleSection('sources')}
              isEmpty={sourceData.length === 0}
              emptyIcon={Database}
              emptyText="No data source information available"
            >
              <DataSourcesSection sourceData={sourceData} />
            </DetailSection>
          </div>
        </ErrorBoundary>
      </main>

      {/* Footer with External Links */}
      <footer className="detail-v2-footer">
        <ExternalLinks hex={hex} callsign={aircraft?.flight?.trim()} />
      </footer>

      {/* Photo Lightbox Modal */}
      <PhotoLightbox
        isOpen={showPhotoLightbox}
        photoUrl={photoUrl}
        photoInfo={photoInfo}
        info={info}
        hex={hex}
        onClose={handleCloseLightbox}
      />
    </div>
  );
}
