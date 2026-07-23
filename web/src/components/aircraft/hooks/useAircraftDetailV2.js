import { useState, useEffect, useCallback, useRef } from 'react';
import { getTailInfo } from '../../../utils';
import { withAuth } from '../../../lib/authHeader';
import { useAircraftPhoto } from './useAircraftPhoto';
import { useAircraftAcars } from './useAircraftAcars';
import { useAircraftSafety } from './useAircraftSafety';
import { useAircraftRadio } from './useAircraftRadio';
import { useAircraftTrack } from './useAircraftTrack';

// Local storage key for section preferences
const SECTION_PREFS_KEY = 'skyspy:aircraft-detail-sections';

// Default section expansion state
const DEFAULT_SECTIONS = {
  aircraft: true,
  track: true,
  communications: false,
  safety: false,
  sources: false,
};

// Helper to safely parse JSON from fetch response
const safeJson = async (res) => {
  if (!res.ok) return null;
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
};

// Load saved section preferences from localStorage
function loadSectionPrefs() {
  try {
    const saved = localStorage.getItem(SECTION_PREFS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...DEFAULT_SECTIONS, ...parsed };
    }
  } catch {
    // Ignore errors
  }
  return DEFAULT_SECTIONS;
}

// Save section preferences to localStorage
function saveSectionPrefs(sections) {
  try {
    localStorage.setItem(SECTION_PREFS_KEY, JSON.stringify(sections));
  } catch {
    // Ignore errors
  }
}

/**
 * useAircraftDetailV2 - Section-based state management for aircraft detail V2
 *
 * Key differences from useAircraftDetail:
 * - Replaces activeTab with expandedSections object
 * - Adds sectionLoadState for lazy loading
 * - Adds localStorage persistence for section preferences
 * - Implements prefetch after 2s delay for collapsed sections
 */
export function useAircraftDetailV2({
  hex,
  apiUrl,
  aircraft,
  aircraftInfo,
  feederLocation,
  wsRequest,
  wsConnected,
}) {
  const baseUrl = (apiUrl || '').replace(/\/$/, '');

  // Core state
  const [info, setInfo] = useState(aircraftInfo || null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [shareSuccess, setShareSuccess] = useState(false);

  // Section expansion state (with localStorage persistence)
  const [expandedSections, setExpandedSections] = useState(loadSectionPrefs);

  // Section load state for lazy loading
  const [sectionLoadState, setSectionLoadState] = useState({
    aircraft: 'loaded',
    track: 'idle',
    communications: 'idle',
    safety: 'idle',
    sources: 'loaded',
  });

  // Refs for prefetch timer
  const prefetchTimerRef = useRef(null);

  // Derived values
  const tailInfo = getTailInfo(hex, aircraft?.flight);
  const callsign = aircraft?.flight?.trim();

  // Photo hook
  const photoHook = useAircraftPhoto({
    hex,
    baseUrl,
    initialPhotoData: null,
  });
  const { setPhotoInfo, setPhotoState, fetchPhoto } = photoHook;

  // ACARS hook - load when communications section expanded or prefetch
  const acarsHook = useAircraftAcars({
    hex,
    baseUrl,
    callsign,
    activeTab: expandedSections.communications ? 'communications' : 'overview',
    wsRequest,
    wsConnected,
    onLoaded: () => {
      setSectionLoadState((prev) => ({ ...prev, communications: 'loaded' }));
    },
  });

  // Safety hook - load when safety section expanded or prefetch
  const safetyHook = useAircraftSafety({
    hex,
    baseUrl,
    activeTab: expandedSections.safety ? 'safety' : 'overview',
    wsRequest,
    wsConnected,
    onLoaded: () => {
      setSectionLoadState((prev) => ({ ...prev, safety: 'loaded' }));
    },
  });

  // Radio hook - load when communications section expanded or prefetch
  const radioHook = useAircraftRadio({
    hex,
    baseUrl,
    callsign,
    activeTab: expandedSections.communications ? 'communications' : 'overview',
    wsRequest,
    wsConnected,
    onLoaded: () => {},
  });

  // Track hook - load when track section expanded
  const trackHook = useAircraftTrack({
    hex,
    baseUrl,
    activeTab: expandedSections.track ? 'track' : 'overview',
    wsRequest,
    wsConnected,
    onLoaded: () => {
      setSectionLoadState((prev) => ({ ...prev, track: 'loaded' }));
    },
  });

  // Toggle section expansion
  const toggleSection = useCallback((sectionName) => {
    setExpandedSections((prev) => {
      const newSections = {
        ...prev,
        [sectionName]: !prev[sectionName],
      };
      saveSectionPrefs(newSections);
      return newSections;
    });
  }, []);

  // Share URL functionality
  const handleShare = useCallback(async () => {
    const url = `${window.location.origin}${window.location.pathname}#airframe?icao=${hex}`;
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
  }, [hex, aircraft?.flight]);

  // Calculate distance from feeder
  const calculateDistance = useCallback(
    (ac) => {
      if (!ac?.lat || !ac?.lon) return null;
      if (ac.distance_nm !== undefined) return ac.distance_nm;
      if (ac.r_dst !== undefined) return ac.r_dst;
      const feederLat = feederLocation?.lat;
      const feederLon = feederLocation?.lon;
      if (!feederLat || !feederLon) return null;
      const dLat = (ac.lat - feederLat) * 60;
      const dLon = (ac.lon - feederLon) * 60 * Math.cos((feederLat * Math.PI) / 180);
      return Math.sqrt(dLat * dLat + dLon * dLon);
    },
    [feederLocation]
  );

  // Load info on mount
  useEffect(() => {
    const abortController = new AbortController();

    const fetchInfoAndPhoto = async () => {
      setLoading(true);
      setError(null);
      try {
        if (!info) {
          let infoData = null;
          // Try airframes endpoint first
          // withAuth() attaches the JWT — /lookup/* require auth (RequireAuthenticated,
          // no public bypass) so a bare fetch 401s a signed-in user in hybrid mode.
          let infoRes = await fetch(`${baseUrl}/api/v1/airframes/${hex}/`, {
            signal: abortController.signal,
            headers: withAuth(),
          });
          infoData = await safeJson(infoRes);

          // If airframes not found, try lookup endpoint
          if (!infoData || infoData.error || infoRes.status === 404) {
            infoRes = await fetch(`${baseUrl}/api/v1/lookup/aircraft/${hex}`, {
              signal: abortController.signal,
              headers: withAuth(),
            });
            infoData = await safeJson(infoRes);
          }

          // Also try OpenSky lookup for additional data
          if (!infoData || !infoData.registration) {
            try {
              const openskRes = await fetch(`${baseUrl}/api/v1/lookup/opensky/${hex}`, {
                signal: abortController.signal,
                headers: withAuth(),
              });
              const openskyData = await safeJson(openskRes);
              if (openskyData && !openskyData.error) {
                infoData = { ...openskyData, ...infoData };
              }
            } catch (e) {
              if (e.name === 'AbortError') return;
            }
          }

          if (abortController.signal.aborted) return;

          if (infoData && !infoData.error) {
            setInfo(infoData);
            // Set photo info if available
            if (infoData.photo_url || infoData.photo_thumbnail_url) {
              setPhotoInfo({
                photo_url: infoData.photo_url,
                thumbnail_url: infoData.photo_thumbnail_url,
                photographer: infoData.photo_photographer,
                source: infoData.photo_source,
              });
              setPhotoState('loaded');
            } else {
              fetchPhoto(abortController);
            }
          } else {
            setPhotoState('error');
          }
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('Aircraft detail fetch error:', err);
        setError({
          message: 'Failed to load aircraft details. Please try again.',
          originalError: err,
        });
      }
      if (!abortController.signal.aborted) {
        setLoading(false);
      }
    };
    fetchInfoAndPhoto();

    return () => {
      abortController.abort();
    };
  }, [hex, baseUrl, info, setPhotoInfo, setPhotoState, fetchPhoto]);

  // Prefetch collapsed sections after 2s delay
  useEffect(() => {
    if (loading) return;

    // Clear any existing timer
    if (prefetchTimerRef.current) {
      clearTimeout(prefetchTimerRef.current);
    }

    // Start prefetch timer
    prefetchTimerRef.current = setTimeout(() => {
      // Mark sections as needing prefetch (hooks will handle actual loading)
      setSectionLoadState((prev) => {
        const newState = { ...prev };
        if (!expandedSections.communications && prev.communications === 'idle') {
          newState.communications = 'loading';
        }
        if (!expandedSections.safety && prev.safety === 'idle') {
          newState.safety = 'loading';
        }
        return newState;
      });
    }, 2000);

    return () => {
      if (prefetchTimerRef.current) {
        clearTimeout(prefetchTimerRef.current);
      }
    };
  }, [loading, expandedSections.communications, expandedSections.safety]);

  // Update section load state when sections are expanded
  useEffect(() => {
    if (expandedSections.track && sectionLoadState.track === 'idle') {
      setSectionLoadState((prev) => ({ ...prev, track: 'loading' }));
    }
    if (expandedSections.communications && sectionLoadState.communications === 'idle') {
      setSectionLoadState((prev) => ({ ...prev, communications: 'loading' }));
    }
    if (expandedSections.safety && sectionLoadState.safety === 'idle') {
      setSectionLoadState((prev) => ({ ...prev, safety: 'loading' }));
    }
  }, [
    expandedSections.track,
    expandedSections.communications,
    expandedSections.safety,
    sectionLoadState.track,
    sectionLoadState.communications,
    sectionLoadState.safety,
  ]);

  // Retry function
  const retry = useCallback(() => {
    setError(null);
    setInfo(null);
  }, []);

  return {
    // Core
    hex,
    info,
    loading,
    error,
    retry,
    tailInfo,
    baseUrl,
    shareSuccess,
    handleShare,
    calculateDistance,

    // Section expansion
    expandedSections,
    toggleSection,
    sectionLoadState,

    // Photo
    photoInfo: photoHook.photoInfo,
    photoUrl: photoHook.photoUrl,
    photoState: photoHook.photoState,
    photoRetryCount: photoHook.photoRetryCount,
    useThumbnail: photoHook.useThumbnail,
    photoStatus: photoHook.photoStatus,
    handlePhotoError: photoHook.handlePhotoError,
    handlePhotoLoad: photoHook.handlePhotoLoad,
    retryPhoto: photoHook.retryPhoto,

    // ACARS
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

    // Safety
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

    // Radio
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

    // Track
    sightings: trackHook.sightings,
    setSightings: trackHook.setSightings,
    showTrackMap: trackHook.showTrackMap,
    setShowTrackMap: trackHook.setShowTrackMap,
    replayPosition: trackHook.replayPosition,
    setReplayPosition: trackHook.setReplayPosition,
    isPlaying: trackHook.isPlaying,
    setIsPlaying: trackHook.setIsPlaying,

    // Track (new)
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

    // Graphs
    graphZoom: trackHook.graphZoom,
    setGraphZoom: trackHook.setGraphZoom,
    graphScrollOffset: trackHook.graphScrollOffset,
    setGraphScrollOffset: trackHook.setGraphScrollOffset,
  };
}
