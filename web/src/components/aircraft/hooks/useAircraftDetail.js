import { useState, useEffect, useCallback } from 'react';
import { getTailInfo } from '../../../utils';
import { useAircraftPhoto } from './useAircraftPhoto';
import { useAircraftAcars } from './useAircraftAcars';
import { useAircraftSafety } from './useAircraftSafety';
import { useAircraftRadio } from './useAircraftRadio';
import { useAircraftTrack } from './useAircraftTrack';
import {
  VALID_DETAIL_TABS,
  quickFilterCategories,
  getAcarsLabelDescription,
  getLabelCategory,
} from './acarsConstants';

// Re-export constants and utilities for backwards compatibility
export { VALID_DETAIL_TABS, quickFilterCategories, getAcarsLabelDescription, getLabelCategory };

// Helper to safely parse JSON from fetch response
const safeJson = async (res) => {
  if (!res.ok) return null;
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) return null;
  try { return await res.json(); } catch { return null; }
};

/**
 * Main hook for aircraft detail view
 * Composes smaller specialized hooks for photos, ACARS, safety, radio, and track data
 */
export function useAircraftDetail({
  hex,
  apiUrl,
  aircraft,
  aircraftInfo,
  feederLocation,
  wsRequest,
  wsConnected,
  initialTab,
  onTabChange
}) {
  const baseUrl = (apiUrl || '').replace(/\/$/, ''); // Strip trailing slash

  // Core state
  const [info, setInfo] = useState(aircraftInfo || null);
  const [loading, setLoading] = useState(true);
  const [loadedTabs, setLoadedTabs] = useState({});
  const [shareSuccess, setShareSuccess] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTabState] = useState(() =>
    VALID_DETAIL_TABS.includes(initialTab) ? initialTab : 'info'
  );

  // Derived values
  const tailInfo = getTailInfo(hex, aircraft?.flight);
  const callsign = aircraft?.flight?.trim();

  // Callback for when tabs are loaded
  const handleTabLoaded = useCallback((tabName) => {
    setLoadedTabs(prev => ({ ...prev, [tabName]: true }));
  }, []);

  // Photo hook - destructure stable callbacks to avoid infinite loops in useEffect deps
  const photoHook = useAircraftPhoto({
    hex,
    baseUrl,
    initialPhotoData: null,
  });
  const { setPhotoInfo, setPhotoState, fetchPhoto } = photoHook;

  // ACARS hook
  const acarsHook = useAircraftAcars({
    hex,
    baseUrl,
    callsign,
    activeTab,
    wsRequest,
    wsConnected,
    onLoaded: handleTabLoaded,
  });

  // Safety hook
  const safetyHook = useAircraftSafety({
    hex,
    baseUrl,
    activeTab,
    wsRequest,
    wsConnected,
    onLoaded: handleTabLoaded,
  });

  // Radio hook
  const radioHook = useAircraftRadio({
    hex,
    baseUrl,
    callsign,
    activeTab,
    wsRequest,
    wsConnected,
    onLoaded: handleTabLoaded,
  });

  // Track hook
  const trackHook = useAircraftTrack({
    hex,
    baseUrl,
    activeTab,
    wsRequest,
    wsConnected,
    onLoaded: handleTabLoaded,
  });

  // Tab management
  const setActiveTab = useCallback((tab) => {
    setActiveTabState(tab);
    if (onTabChange) onTabChange(tab);
  }, [onTabChange]);

  // Sync with initialTab prop changes
  useEffect(() => {
    if (initialTab && VALID_DETAIL_TABS.includes(initialTab) && initialTab !== activeTab) {
      setActiveTabState(initialTab);
    }
  }, [initialTab, activeTab]);

  // Reset loaded tabs when aircraft changes
  useEffect(() => {
    setLoadedTabs({});
  }, [hex]);

  // Share URL functionality
  const handleShare = useCallback(async () => {
    const url = `${window.location.origin}${window.location.pathname}#airframe?icao=${hex}${activeTab !== 'info' ? `&tab=${activeTab}` : ''}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `Aircraft ${aircraft?.flight?.trim() || hex}`,
          text: `View aircraft ${aircraft?.flight?.trim() || hex} details`,
          url: url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        setShareSuccess(true);
        setTimeout(() => setShareSuccess(false), 2000);
      }
    } catch (err) {
      try {
        await navigator.clipboard.writeText(url);
        setShareSuccess(true);
        setTimeout(() => setShareSuccess(false), 2000);
      } catch (clipErr) {
        console.error('Failed to share:', clipErr);
      }
    }
  }, [hex, activeTab, aircraft?.flight]);

  // Calculate distance from feeder
  const calculateDistance = useCallback((ac) => {
    if (!ac?.lat || !ac?.lon) return null;
    if (ac.distance_nm !== undefined) return ac.distance_nm;
    if (ac.r_dst !== undefined) return ac.r_dst;
    const feederLat = feederLocation?.lat;
    const feederLon = feederLocation?.lon;
    if (!feederLat || !feederLon) return null;
    const dLat = (ac.lat - feederLat) * 60;
    const dLon = (ac.lon - feederLon) * 60 * Math.cos(feederLat * Math.PI / 180);
    return Math.sqrt(dLat * dLat + dLon * dLon);
  }, [feederLocation]);

  // Load info on mount
  useEffect(() => {
    const abortController = new AbortController();

    const fetchInfoAndPhoto = async () => {
      setLoading(true);
      setError(null);
      try {
        if (!info) {
          let infoData = null;
          // Try airframes endpoint first (includes photo data)
          let infoRes = await fetch(`${baseUrl}/api/v1/airframes/${hex}/`, {
            signal: abortController.signal
          });
          infoData = await safeJson(infoRes);

          // If airframes not found, try lookup endpoint
          if (!infoData || infoData.error || infoRes.status === 404) {
            infoRes = await fetch(`${baseUrl}/api/v1/lookup/aircraft/${hex}`, {
              signal: abortController.signal
            });
            infoData = await safeJson(infoRes);
          }

          // Also try OpenSky lookup for additional data
          if (!infoData || !infoData.registration) {
            try {
              const openskRes = await fetch(`${baseUrl}/api/v1/lookup/opensky/${hex}`, {
                signal: abortController.signal
              });
              const openskyData = await safeJson(openskRes);
              if (openskyData && !openskyData.error) {
                infoData = { ...openskyData, ...infoData };
              }
            } catch (e) {
              if (e.name === 'AbortError') return;
              // OpenSky lookup failed, continue with what we have
            }
          }

          // Check if aborted before setting state
          if (abortController.signal.aborted) return;

          if (infoData && !infoData.error) {
            setInfo(infoData);
            // Set photo info if available in the response
            if (infoData.photo_url || infoData.photo_thumbnail_url) {
              setPhotoInfo({
                photo_url: infoData.photo_url,
                thumbnail_url: infoData.photo_thumbnail_url,
                photographer: infoData.photo_photographer,
                source: infoData.photo_source,
              });
              setPhotoState('loaded');
            } else {
              // Trigger photo fetch
              fetchPhoto(abortController);
            }
          } else {
            setPhotoState('error');
          }
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('Aircraft detail fetch error:', err);
        setError({ message: 'Failed to load aircraft details. Please try again.', originalError: err });
      }
      if (!abortController.signal.aborted) {
        setLoading(false);
        setLoadedTabs(prev => ({ ...prev, info: true }));
      }
    };
    fetchInfoAndPhoto();

    return () => {
      abortController.abort();
    };
  }, [hex, baseUrl, info, wsRequest, wsConnected, setPhotoInfo, setPhotoState, fetchPhoto]);

  // Retry function to clear error and refetch data
  const retry = useCallback(() => {
    setError(null);
    setInfo(null);
    setLoadedTabs({});
  }, []);

  return {
    // Core
    hex,
    info,
    loading,
    error,
    retry,
    loadedTabs,
    activeTab,
    setActiveTab,
    tailInfo,
    baseUrl,
    shareSuccess,
    handleShare,
    calculateDistance,

    // Photo (from useAircraftPhoto)
    photoInfo: photoHook.photoInfo,
    photoUrl: photoHook.photoUrl,
    photoState: photoHook.photoState,
    photoRetryCount: photoHook.photoRetryCount,
    useThumbnail: photoHook.useThumbnail,
    photoStatus: photoHook.photoStatus,
    handlePhotoError: photoHook.handlePhotoError,
    handlePhotoLoad: photoHook.handlePhotoLoad,
    retryPhoto: photoHook.retryPhoto,

    // ACARS (from useAircraftAcars)
    acarsMessages: acarsHook.acarsMessages,
    acarsHours: acarsHook.acarsHours,
    setAcarsHours: acarsHook.setAcarsHours,
    acarsCompactMode: acarsHook.acarsCompactMode,
    setAcarsCompactMode: acarsHook.setAcarsCompactMode,
    acarsQuickFilters: acarsHook.acarsQuickFilters,
    setAcarsQuickFilters: acarsHook.setAcarsQuickFilters,
    expandedMessages: acarsHook.expandedMessages,
    setExpandedMessages: acarsHook.setExpandedMessages,
    allMessagesExpanded: acarsHook.allMessagesExpanded,
    setAllMessagesExpanded: acarsHook.setAllMessagesExpanded,

    // Safety (from useAircraftSafety)
    safetyEvents: safetyHook.safetyEvents,
    safetyHours: safetyHook.safetyHours,
    setSafetyHours: safetyHook.setSafetyHours,
    expandedSnapshots: safetyHook.expandedSnapshots,
    setExpandedSnapshots: safetyHook.setExpandedSnapshots,
    expandedSafetyMaps: safetyHook.expandedSafetyMaps,
    setExpandedSafetyMaps: safetyHook.setExpandedSafetyMaps,
    safetyTrackData: safetyHook.safetyTrackData,
    setSafetyTrackData: safetyHook.setSafetyTrackData,
    safetyReplayState: safetyHook.safetyReplayState,
    setSafetyReplayState: safetyHook.setSafetyReplayState,

    // Radio (from useAircraftRadio)
    radioTransmissions: radioHook.radioTransmissions,
    radioHours: radioHook.radioHours,
    setRadioHours: radioHook.setRadioHours,
    radioLoading: radioHook.radioLoading,
    radioSearchQuery: radioHook.radioSearchQuery,
    setRadioSearchQuery: radioHook.setRadioSearchQuery,
    radioStatusFilter: radioHook.radioStatusFilter,
    setRadioStatusFilter: radioHook.setRadioStatusFilter,
    radioPlayingId: radioHook.radioPlayingId,
    radioAudioProgress: radioHook.radioAudioProgress,
    radioAudioDurations: radioHook.radioAudioDurations,
    radioExpandedTranscript: radioHook.radioExpandedTranscript,
    setRadioExpandedTranscript: radioHook.setRadioExpandedTranscript,
    radioAutoplay: radioHook.radioAutoplay,
    filteredRadioTransmissions: radioHook.filteredRadioTransmissions,
    handleRadioPlay: radioHook.handleRadioPlay,
    handleRadioSeek: radioHook.handleRadioSeek,
    toggleRadioAutoplay: radioHook.toggleRadioAutoplay,

    // History/sightings (from useAircraftTrack)
    sightings: trackHook.sightings,
    setSightings: trackHook.setSightings,
    showTrackMap: trackHook.showTrackMap,
    setShowTrackMap: trackHook.setShowTrackMap,
    replayPosition: trackHook.replayPosition,
    setReplayPosition: trackHook.setReplayPosition,
    isPlaying: trackHook.isPlaying,
    setIsPlaying: trackHook.setIsPlaying,

    // Track tab (from useAircraftTrack)
    trackReplayPosition: trackHook.trackReplayPosition,
    setTrackReplayPosition: trackHook.setTrackReplayPosition,
    trackIsPlaying: trackHook.trackIsPlaying,
    setTrackIsPlaying: trackHook.setTrackIsPlaying,
    trackReplaySpeed: trackHook.trackReplaySpeed,
    setTrackReplaySpeed: trackHook.setTrackReplaySpeed,
    showTrackPoints: trackHook.showTrackPoints,
    setShowTrackPoints: trackHook.setShowTrackPoints,
    trackLiveMode: trackHook.trackLiveMode,
    setTrackLiveMode: trackHook.setTrackLiveMode,
    showTelemOverlay: trackHook.showTelemOverlay,
    setShowTelemOverlay: trackHook.setShowTelemOverlay,

    // Graphs (from useAircraftTrack)
    graphZoom: trackHook.graphZoom,
    setGraphZoom: trackHook.setGraphZoom,
    graphScrollOffset: trackHook.graphScrollOffset,
    setGraphScrollOffset: trackHook.setGraphScrollOffset,
  };
}
