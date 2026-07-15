import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import 'leaflet/dist/leaflet.css';

// Import utilities
import {
  saveConfig,
  getOverlays,
  saveOverlays,
  getLayerOpacities,
  saveLayerOpacities,
  getTailInfo,
} from '../../utils';

// Import AircraftDetailPage and V2
import { AircraftDetailPage, AircraftDetailV2, AircraftSidebar } from '../aircraft';
import { useAircraftInfo } from '../../hooks/useAircraftInfo';
import { useToastContextSafe } from '../../hooks/useToast';
import { useAirspaceAdvisories, HAZARD_CONFIG } from '../../hooks/useAirspaceAdvisories';
import { AirspaceAdvisoryPanel } from './components/AirspaceAdvisoryPanel';
import { useNotams, NOTAM_TYPE_CONFIG } from '../../hooks/useNotams';
import { NotamPanel } from './components/NotamPanel';
import { KeyboardShortcutHelp } from './components/KeyboardShortcutHelp';
import {
  useDataBlockPositions,
  useDataBlockKeepAlive,
  DATA_BLOCK_DEFAULT_X,
  DATA_BLOCK_DEFAULT_Y,
  useMapAlarms,
  useSafetyEvents,
  useMapAcarsData,
  useLeafletMap,
  useTrackHistory,
  useProfileCanvases,
  useAviationDataFetch,
  usePopupDrag,
  useTerrainOverlays,
  useUrlHashSync,
  useContainerMouseHandlers,
  useCanvasDraw,
  useProPan,
  usePhotoFetch,
} from './hooks';
import { SafetyBanner, getSeverityClass, getEventTypeName } from './components/SafetyBanner';
import { handleCanvasClick, handleCanvasDoubleClick } from './utils/canvasClickHandlers';
import { useHeatMap } from '../../hooks/useHeatMap';
import { HeatMapLayer } from './components/HeatMapLayer';
import { useWindsAloft } from '../../hooks/useWindsAloft';
import { useWatchList } from '../../hooks/useWatchList';
import { WatchListPanel, WatchListShowButton } from './components/WatchListPanel';
import { useHighlightGroups } from '../../hooks/useHighlightGroups';
import { HighlightGroupsPanel, HighlightGroupsShowButton } from './components/HighlightGroupsPanel';
import { useConflictProbe } from '../../hooks/useConflictProbe';
import { ConflictProbePanel } from './components/ConflictProbePanel';
import { useDraggable } from '../../hooks/useDraggable';
import { useWeatherRadarOverlay } from './components/WeatherRadarOverlay';
import { useSigmetData } from '../../hooks/useSigmetData';
import { useTafData } from '../../hooks/useTafData';
import { useScopeLayout } from '../../hooks/useScopeLayout';
import MultiScopeContainer from './components/MultiScopeContainer';
import { ProRadarScope } from './components/ProRadarScope';
import { useMapAircraftNotes } from './hooks';
import {
  NoteInputModal,
  AircraftContextMenu,
  DataBlockConfigPanel,
  ProSearchBar,
  ProDetailsPanel,
} from './components';
import {
  MetarPopup,
  PirepPopup,
  NavaidPopup,
  AirportPopup,
  TafPopup,
  AirspacePopup,
  SigmetPopup,
} from './components/popups';
import OverlayMenuPanel from './components/OverlayMenuPanel';
import { FilterMenuPanel } from './components/FilterMenuPanel';
import InlineLegendPanel from './components/InlineLegendPanel';
import AircraftListInline from './components/AircraftListInline';
import { SelectedAircraftPanel } from './components/SelectedAircraftPanel';
import { AcarsInlinePanel } from './components/AcarsInlinePanel';
import { MobileMapHeader } from './components/MobileMapHeader';
import { MapControlsBar } from './components/MapControlsBar';
import { SimpleRadarView } from './components/SimpleRadarView';
import { useAltitudeFilter } from '../../hooks/useAltitudeFilter';
import { AltitudeFilterPanel } from './components/AltitudeFilterPanel';
import { useMSAW } from '../../hooks/useMSAW';
import { useQuickFilters } from '../../hooks/useQuickFilters';
import { QuickFilterBar } from './components/QuickFilterBar';
import { useSessionStats } from '../../hooks/useSessionStats';
import { SessionStatsPanel, SessionStatsButton } from './components/SessionStatsPanel';
import { usePlaybackMode } from './hooks/usePlaybackMode';
import { useProKeyboardShortcuts } from './hooks/useProKeyboardShortcuts';
import { PlaybackControls, PlaybackIndicator } from './components/PlaybackControls';

// Pro mode theme hook - provides theme colors and management
import { useProTheme } from '../../hooks/useProTheme';

function MapView({
  aircraft,
  config,
  setConfig,
  feederLocation,
  safetyEvents: wsSafetyEvents,
  acarsMessages: wsAcarsMessages,
  wsRequest,
  wsConnected,
  getAirframeError,
  clearAirframeError,
  onViewHistoryEvent,
  hashParams = {},
  setHashParams,
  positionsRef = null,
  _positionSocketConnected = false,
}) {
  // Use feeder location or default - defined early for use in hooks below
  // Bug fix #9: Explicit null checks for feeder coordinates to avoid NaN calculations
  const feederLat =
    feederLocation?.lat != null && !Number.isNaN(feederLocation.lat) ? feederLocation.lat : 47.9377;
  const feederLon =
    feederLocation?.lon != null && !Number.isNaN(feederLocation.lon)
      ? feederLocation.lon
      : -121.9687;

  // Memoized feeder location object to prevent infinite re-renders in hooks
  const feederLocationMemo = useMemo(
    () => ({ lat: feederLat, lon: feederLon }),
    [feederLat, feederLon]
  );

  const [selectedAircraft, setSelectedAircraft] = useState(null);
  const [selectedMetar, setSelectedMetar] = useState(null);
  const [selectedTaf, setSelectedTaf] = useState(null);
  const [selectedPirep, setSelectedPirep] = useState(null);
  const [selectedNavaid, setSelectedNavaid] = useState(null);
  const [selectedAirport, setSelectedAirport] = useState(null);
  const [selectedAirspace, setSelectedAirspace] = useState(null);
  const [selectedSigmet, setSelectedSigmet] = useState(null);
  // Aviation overlay states - load from localStorage (moved early for useHeatMap dependency)
  const [overlays, setOverlays] = useState(getOverlays);
  // Conflict Probe state (moved early for useConflictProbe dependency)
  const [showConflictProbe, setShowConflictProbe] = useState(
    () => localStorage.getItem('adsb-pro-conflict-probe') !== 'false'
  );
  const [showAirspaceLabels, setShowAirspaceLabels] = useState(() => {
    const saved = localStorage.getItem('adsb-show-airspace-labels');
    return saved === null ? true : saved === 'true';
  });
  const [airspaceTypeFilters, setAirspaceTypeFilters] = useState(() => {
    try {
      const saved = localStorage.getItem('adsb-airspace-type-filters');
      return saved
        ? JSON.parse(saved)
        : {
            B: true,
            C: true,
            D: true,
            E: false,
            MOA: true,
            RESTRICTED: true,
            WARNING: true,
            PROHIBITED: true,
            TFR: true,
            ALERT: true,
          };
    } catch {
      return {
        B: true,
        C: true,
        D: true,
        E: false,
        MOA: true,
        RESTRICTED: true,
        WARNING: true,
        PROHIBITED: true,
        TFR: true,
        ALERT: true,
      };
    }
  });
  const [weatherAdvisoryFilters, setWeatherAdvisoryFilters] = useState(() => {
    try {
      const saved = localStorage.getItem('adsb-weather-advisory-filters');
      return saved
        ? JSON.parse(saved)
        : {
            IFR: true,
            TURB: true,
            ICE: true,
            TS: true,
            MT_OBSC: true,
            VOLCANIC_ASH: true,
            LLWS: true,
            SFC_WND: true,
            FZLVL: true,
          };
    } catch {
      return {
        IFR: true,
        TURB: true,
        ICE: true,
        TS: true,
        MT_OBSC: true,
        VOLCANIC_ASH: true,
        LLWS: true,
        SFC_WND: true,
        FZLVL: true,
      };
    }
  });
  const [radarRange, setRadarRange] = useState(50); // nm

  // Canvas ref (declared early for useProPan)
  const canvasRef = useRef(null);

  // Pro mode pan state (middle mouse button, aircraft following)
  const {
    proPanOffset,
    setProPanOffset,
    isProPanning,
    followingAircraft,
    setFollowingAircraft,
    handleProPanStart: handleProPanStartBase,
    animatePanTo,
    proPanOffsetRef,
  } = useProPan({
    config,
    setHashParams,
    radarRange,
    feederLat,
    feederLon,
    aircraft,
    canvasRef,
  });
  const [showOverlayMenu, setShowOverlayMenu] = useState(false);
  // safetyEvents and acknowledgedEvents managed by useSafetyEvents hook below
  const [showAircraftList, setShowAircraftList] = useState(() => {
    try {
      const saved = localStorage.getItem('adsb-show-aircraft-list');
      return saved === null ? false : saved === 'true';
    } catch {
      return false;
    }
  });
  const [listExpanded, setListExpanded] = useState(() => {
    try {
      const saved = localStorage.getItem('adsb-list-expanded');
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });
  const [showLegend, setShowLegend] = useState(false); // Legend panel visibility
  const [legendCollapsed, setLegendCollapsed] = useState(false); // Legend content collapsed
  const [showSessionStats, setShowSessionStats] = useState(false); // Session stats panel visibility
  const [listDisplayCount, setListDisplayCount] = useState(20); // Lazy load count for aircraft list
  const [showRangeControl, setShowRangeControl] = useState(false); // Show range control when cursor near
  const [soundMuted, setSoundMuted] = useState(() => {
    try {
      return localStorage.getItem('adsb-sound-muted') === 'true';
    } catch {
      return false;
    }
  });
  const [searchQuery, setSearchQuery] = useState(''); // Search filter
  const [highlightedHexes, setHighlightedHexes] = useState([]); // Aircraft hexes highlighted from search
  const [trackHistory, setTrackHistory] = useState({}); // Per-aircraft position history for trails
  const [showSelectedTrack, setShowSelectedTrack] = useState(false); // Show track line for selected aircraft
  const [showShortTracks, setShowShortTracks] = useState(() => {
    try {
      return localStorage.getItem('adsb-show-short-tracks') === 'true';
    } catch {
      return false;
    }
  }); // Show short ~5nm trails for all aircraft (ATC style)
  const [shortTrackHistory, setShortTrackHistory] = useState({}); // Historical positions for short tracks (from API)

  // New feature states
  const [isFullscreen, setIsFullscreen] = useState(false); // Fullscreen mode
  const [panelPinned, setPanelPinned] = useState(false); // Pin pro details panel
  const [showAcarsPanel, setShowAcarsPanel] = useState(false); // ACARS messages panel
  const [showAdvisoryPanel, setShowAdvisoryPanel] = useState(false); // Airspace advisories panel
  const [selectedAdvisoryId, setSelectedAdvisoryId] = useState(null); // Highlighted advisory on map
  const [advisoryHazardFilter, setAdvisoryHazardFilter] = useState(null); // Advisory hazard filter
  const [showNotamPanel, setShowNotamPanel] = useState(false); // NOTAM panel
  const [selectedNotamId, setSelectedNotamId] = useState(null); // Highlighted NOTAM on map
  const [notamTypeFilter, setNotamTypeFilter] = useState(null); // NOTAM type filter
  // acarsMessages, acarsStatus, callsignHexCache managed by useMapAcarsData hook below
  const [acarsFilters, setAcarsFilters] = useState(() => {
    try {
      const saved = localStorage.getItem('adsb-acars-filters');
      return saved
        ? JSON.parse(saved)
        : {
            hideEmpty: true,
            sourceFilter: 'all', // 'all', 'acars', 'vdlm2'
            labelFilter: '',
            callsignFilter: '',
          };
    } catch {
      return {
        hideEmpty: true,
        sourceFilter: 'all',
        labelFilter: '',
        callsignFilter: '',
      };
    }
  });
  const [aircraftDetailHex, setAircraftDetailHex] = useState(null); // Aircraft for full detail modal
  const [sidebarAircraftHex, setSidebarAircraftHex] = useState(null); // Aircraft for sidebar quick view
  // callsignHexCache managed by useMapAcarsData hook
  const [etaTarget, setEtaTarget] = useState(null); // ETA target point {lat, lon} for Phase 11.2

  // Use robust aircraft info hook with bulk lookups and retry logic
  const {
    getInfo: getAircraftInfo,
    cache: aircraftInfo,
    prefetchForAircraft,
    getError: getAircraftError,
    clearError: clearAircraftError,
  } = useAircraftInfo({
    wsRequest,
    wsConnected,
    apiBaseUrl: config.apiBaseUrl,
    getAirframeError,
    clearAirframeError,
  });

  // Airspace advisories hook for pro mode
  const {
    advisories: airspaceAdvisories,
    loading: advisoriesLoading,
    error: advisoriesError,
    acknowledged: acknowledgedAdvisories,
    acknowledgeAdvisory,
    unacknowledgeAdvisory,
    unacknowledgedCount: advisoryUnacknowledgedCount,
    refresh: refreshAdvisories,
    isAcknowledged: _isAdvisoryAcknowledged,
  } = useAirspaceAdvisories(wsRequest, wsConnected, {
    hazardFilter: advisoryHazardFilter,
    refreshInterval: 60000,
  });

  // NOTAMs hook for pro mode
  const {
    notams: mapNotams,
    loading: notamsLoading,
    error: notamsError,
    acknowledged: acknowledgedNotams,
    acknowledgeNotam,
    unacknowledgeNotam,
    unacknowledgedCount: _notamUnacknowledgedCount,
    refresh: refreshNotams,
  } = useNotams(wsRequest, wsConnected, {
    typeFilter: notamTypeFilter,
    refreshInterval: 300000,
    lat: feederLat,
    lon: feederLon,
    radius: radarRange,
  });

  // Heat map hook for traffic density visualization (Pro mode)
  const {
    heatMapData,
    timePeriod: heatMapTimePeriod,
    setTimePeriod: setHeatMapTimePeriod,
    gridSize: heatMapGridSize,
    setGridSize: setHeatMapGridSize,
    opacity: heatMapOpacity,
    setOpacity: setHeatMapOpacity,
    hideAircraft: heatMapHideAircraft,
    setHideAircraft: setHeatMapHideAircraft,
    loading: heatMapLoading,
    error: heatMapError,
    stats: heatMapStats,
    bounds: heatMapBounds,
    addLivePosition: _addHeatMapPosition,
    clearHeatMap,
    refresh: refreshHeatMap,
  } = useHeatMap({
    enabled: overlays.heatMap && config.mapMode === 'pro',
    feederLocation: feederLocationMemo,
    radarRange,
    wsRequest,
    wsConnected,
    apiBaseUrl: config.apiBaseUrl,
  });

  // Winds aloft altitude level selection (persisted to localStorage)
  const [windsAloftLevel, setWindsAloftLevel] = useState(() => {
    try {
      const saved = localStorage.getItem('adsb-winds-aloft-level');
      return saved ? parseInt(saved, 10) : 6000;
    } catch {
      return 6000;
    }
  });

  // Winds Aloft Hook for wind barb overlay (Pro mode)
  const {
    windGrid,
    loading: windsLoading,
    error: windsError,
    timestampDisplay: windsTimestamp,
    refresh: refreshWinds,
  } = useWindsAloft({
    enabled: overlays.windsAloft && config.mapMode === 'pro',
    feederLocation: feederLocationMemo,
    radarRange,
    selectedLevel: windsAloftLevel,
  });

  // Memoized latLonToScreen for HeatMapLayer
  const latLonToScreenMemo = useCallback(
    (lat, lon) => {
      const container = containerRef.current;
      if (!container) return { x: 0, y: 0 };
      const width = container.clientWidth;
      const height = container.clientHeight;
      const centerX = width / 2;
      const centerY = height / 2;
      const dLat = lat - feederLat;
      const dLon = lon - feederLon;
      const nmY = dLat * 60;
      const nmX = dLon * 60 * Math.cos((feederLat * Math.PI) / 180);
      const pixelsPerNm = (Math.min(width, height) * 0.45) / radarRange;
      return {
        x: centerX + nmX * pixelsPerNm + proPanOffset.x,
        y: centerY - nmY * pixelsPerNm + proPanOffset.y,
      };
    },
    [feederLat, feederLon, radarRange, proPanOffset]
  );

  // Phase 12.3: Highlight Groups Hook for aircraft grouping/highlighting
  const {
    groups: highlightGroups,
    panelVisible: highlightPanelVisible,
    panelExpanded: highlightPanelExpanded,
    enabledCount: highlightEnabledCount,
    hasEnabledGroups: hasHighlightGroups,
    toggleGroup: toggleHighlightGroup,
    addGroup: addHighlightGroup,
    removeGroup: removeHighlightGroup,
    updateGroup: updateHighlightGroup,
    reorderGroups: reorderHighlightGroups,
    resetToDefaults: resetHighlightDefaults,
    disableAll: disableAllHighlights,
    getAircraftHighlight,
    getGroupCounts: getHighlightGroupCounts,
    togglePanel: toggleHighlightPanel,
    togglePanelExpanded: toggleHighlightPanelExpanded,
    setPanelVisible: setHighlightPanelVisible,
  } = useHighlightGroups(aircraftInfo);

  // Phase 6: Watch List Hook for tracking aircraft
  const {
    watchList,
    panelVisible: watchListPanelVisible,
    count: watchListCount,
    toggleWatchList,
    isWatched,
    togglePanel: toggleWatchListPanel,
    showPanel: showWatchListPanel,
    hidePanel: hideWatchListPanel,
    clearWatchList,
    removeFromWatchList,
    exportWatchList,
    importWatchList,
    initializeAudio: _initializeWatchListAudio,
  } = useWatchList({ enableAudio: true });

  // Watch list panel expanded state
  const [watchListExpanded, setWatchListExpanded] = useState(true);

  // Phase 6: Keyboard Shortcut Help state
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);

  // Phase 6: J-Rings toggle state (range rings around selected aircraft)
  const [showJRings, setShowJRings] = useState(
    () => localStorage.getItem('adsb-pro-j-rings') === 'true'
  );

  // Phase 8.4: Wake turbulence separation rings toggle
  const [showWakeRings, setShowWakeRings] = useState(
    () => localStorage.getItem('adsb-pro-wake-rings') === 'true'
  );

  // Phase 3.4: Conflict Probe (Look-Ahead)
  const {
    conflicts: _predictedConflicts,
    conflictCount: _predictedConflictCount,
    stats: _conflictProbeStats,
    getConflictForAircraft: _getConflictForAircraft,
    getConflictsForAircraft: _getConflictsForAircraft,
  } = useConflictProbe({
    aircraft,
    feederLocation: feederLocationMemo,
    enabled: showConflictProbe && config.mapMode === 'pro',
    maxDistance: radarRange * 2,
  });

  // Draggable position for highlight groups panel
  const {
    position: highlightPanelPosition,
    isDragging: isHighlightPanelDragging,
    onMouseDown: onHighlightPanelMouseDown,
  } = useDraggable('highlight-groups-panel');

  // Draggable position for watch list panel
  const {
    position: watchListPanelPosition,
    isDragging: isWatchListPanelDragging,
    onMouseDown: onWatchListPanelMouseDown,
  } = useDraggable('watch-list-panel');

  // Phase 10.1: Weather Radar Overlay Hook (NEXRAD via Iowa State Mesonet)
  const {
    radarImage: weatherRadarImage,
    radarBounds: weatherRadarBounds,
    loading: _weatherRadarLoading,
    timestampDisplay: _weatherRadarTimestamp,
    drawOnCanvas: drawWeatherRadar,
  } = useWeatherRadarOverlay({
    enabled: overlays.radar,
    feederLocation: feederLocationMemo,
    radarRange: radarRange,
  });

  // Convective SIGMET Overlay Hook
  const {
    sigmets: convectiveSigmets,
    loading: sigmetsLoading,
    error: sigmetsError,
    timestampDisplay: sigmetsTimestamp,
    countsBySeverity: sigmetCounts,
    drawOnCanvas: drawSigmets,
    getSigmetAtPoint,
    refresh: refreshSigmets,
  } = useSigmetData({
    enabled: overlays.convectiveSigmets && config.mapMode === 'pro',
    feederLocation: feederLocationMemo,
    radarRange: radarRange,
    refreshInterval: 5 * 60 * 1000,
  });

  // TAF (Terminal Aerodrome Forecast) data hook
  const {
    tafs,
    loading: tafsLoading,
    error: tafsError,
    getTafForAirport,
    hasTafAvailable,
    getForecastChanges,
    stationsWithTaf,
    fetchTafForStation,
  } = useTafData(
    wsRequest,
    wsConnected,
    feederLat,
    feederLon,
    radarRange,
    overlays.tafs && config.mapMode === 'pro'
  );

  // Phase 13.1: Track Playback Mode Hook
  const {
    isPlayback,
    isPlaying,
    playbackSpeed,
    playbackPercent,
    playbackTime,
    timeRange: playbackTimeRange,
    formattedTime: playbackFormattedTime,
    formattedDate: playbackFormattedDate,
    duration: playbackDuration,
    isLoading: playbackLoading,
    error: playbackError,
    historyStats: playbackStats,
    getPlaybackAircraft,
    enterPlayback,
    exitPlayback,
    togglePlayPause,
    setSpeed: setPlaybackSpeed,
    seekPercent: seekPlaybackPercent,
    skipToStart: skipPlaybackToStart,
    skipToEnd: skipPlaybackToEnd,
    skipForward: skipPlaybackForward,
    skipBackward: skipPlaybackBackward,
    cycleSpeedUp: cyclePlaybackSpeedUp,
    cycleSpeedDown: cyclePlaybackSpeedDown,
    setTimeRange: setPlaybackTimeRange,
    timeRangePresets: playbackTimeRangePresets,
    availableSpeeds: playbackAvailableSpeeds,
  } = usePlaybackMode({
    apiBaseUrl: config.apiBaseUrl,
    wsRequest,
    wsConnected,
    feederLat,
    feederLon,
    radarRange,
  });

  // Clear track history when entering/exiting playback mode to prevent showing future positions
  useEffect(() => {
    if (isPlayback) {
      trackHistoryRef.current = {};
      setShortTrackHistory({});
    }
  }, [isPlayback]);

  // Phase 14.3: Data Block Leader Lines - allows Shift+drag to reposition data blocks
  const {
    getOffset: getDataBlockOffset,
    setOffset: setDataBlockOffset,
    resetOffset: resetDataBlockOffset,
    resetAllOffsets: resetAllDataBlockOffsets,
    handleMouseDown: handleDataBlockDragStart,
    handleMouseMove: handleDataBlockDragMove,
    handleMouseUp: handleDataBlockDragEnd,
    isDragging: isDataBlockDragging,
    hasCustomOffset: hasCustomDataBlockOffset,
    hitTestDataBlock,
    pruneStaleAircraft: pruneStaleDataBlockPositions,
    customPositionCount: dataBlockCustomPositionCount,
    updateLastSeen: updateDataBlockLastSeen,
    maybeDeconflict,
    autoDeconflictEnabled,
  } = useDataBlockPositions();

  // Keep custom data block positions alive for tracked aircraft (prevents the
  // 30-min expiry from wiping Shift+drag positions on still-visible aircraft)
  useDataBlockKeepAlive(aircraft, updateDataBlockLastSeen, pruneStaleDataBlockPositions);

  // Toast context for notifications (gracefully handles if not in provider)
  const toastContext = useToastContextSafe();

  // Phase 9.3: Aircraft Notes/Scratchpad
  const {
    contextMenuState,
    noteModalState,
    handleAircraftContextMenu,
    closeContextMenu,
    openNoteModal,
    closeNoteModal,
    handleSaveNote,
    handleDeleteNote,
    hasNote: hasAircraftNote,
    getNote: getAircraftNote,
    getAbbreviatedNote: _getAbbreviatedAircraftNote,
  } = useMapAircraftNotes({ toastContext });

  // Phase 14.1: Multi-Scope Layout for Pro Mode
  const scopeLayout = useScopeLayout({
    initialLayout: 'single',
    persistToStorage: true,
  });

  // Phase 14.1: Sync active scope settings with MapView's radarRange and proPanOffset
  // When the active scope changes or its settings update, sync to the main state
  useEffect(() => {
    if (config.mapMode !== 'pro' || scopeLayout.layout === 'single') return;

    const activeScope = scopeLayout.scopes.find((s) => s.id === scopeLayout.activeScope);
    if (activeScope) {
      // Sync range if different
      if (activeScope.range !== radarRange) {
        setRadarRange(activeScope.range);
      }
      // Sync pan offset if different
      const scopePan = activeScope.panOffset || { x: 0, y: 0 };
      if (scopePan.x !== proPanOffset.x || scopePan.y !== proPanOffset.y) {
        setProPanOffset(scopePan);
      }
    }
  }, [config.mapMode, scopeLayout.layout, scopeLayout.activeScope, scopeLayout.scopes]);

  // Phase 14.1: Update active scope when radarRange or proPanOffset changes (bidirectional sync)
  useEffect(() => {
    if (config.mapMode !== 'pro' || scopeLayout.layout === 'single') return;

    const activeScope = scopeLayout.scopes.find((s) => s.id === scopeLayout.activeScope);
    if (activeScope) {
      // Only update if changed (to avoid infinite loops)
      if (activeScope.range !== radarRange) {
        scopeLayout.setScopeRange(scopeLayout.activeScope, radarRange);
      }
      const scopePan = activeScope.panOffset || { x: 0, y: 0 };
      if (scopePan.x !== proPanOffset.x || scopePan.y !== proPanOffset.y) {
        scopeLayout.setScopePanOffset(scopeLayout.activeScope, proPanOffset);
      }
    }
  }, [config.mapMode, scopeLayout.layout, radarRange, proPanOffset]);

  // Traffic filters state
  const [trafficFilters, setTrafficFilters] = useState(() => {
    try {
      const saved = localStorage.getItem('adsb-traffic-filters');
      return saved
        ? JSON.parse(saved)
        : {
            showMilitary: true,
            showCivil: true,
            showGround: false, // Hide ground aircraft by default
            showAirborne: true,
            minAltitude: 0,
            maxAltitude: 60000,
            showWithSquawk: true,
            showWithoutSquawk: true,
            safetyEventsOnly: false,
            showGA: true,
            showAirliners: true,
          };
    } catch {
      return {
        showMilitary: true,
        showCivil: true,
        showGround: false,
        showAirborne: true,
        minAltitude: 0,
        maxAltitude: 60000,
        showWithSquawk: true,
        showWithoutSquawk: true,
        safetyEventsOnly: false,
        showGA: true,
        showAirliners: true,
      };
    }
  });
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showMobileControls, setShowMobileControls] = useState(false); // Mobile controls dropdown
  const [showAltitudeFilterPanel, setShowAltitudeFilterPanel] = useState(false); // Phase 8.3: Altitude filter

  // Phase 8.3: Altitude filter for Pro Mode
  const {
    altitudeFilter,
    setAltitudePreset,
    setCustomRange,
    toggleHideFiltered,
    resetFilter: resetAltitudeFilter,
    isAircraftVisible: _isAltitudeVisible,
    getAircraftOpacity: _getAircraftOpacity,
    filterLabel: _altitudeFilterLabel,
  } = useAltitudeFilter();

  // Phase 12.1: Quick Filters for Pro Mode
  const {
    activeFilters: quickActiveFilters,
    showFilterBar: showQuickFilterBar,
    toggleFilter: toggleQuickFilter,
    clearFilters: clearQuickFilters,
    toggleFilterBar: toggleQuickFilterBar,
    filterAircraft: filterAircraftByQuickFilters,
    computeFilterCounts: computeQuickFilterCounts,
  } = useQuickFilters();

  const sessionStats = useSessionStats(aircraft, {
    enabled: config.mapMode === 'pro' || config.mapMode === 'crt',
  });
  // Aircraft photo fetching
  const {
    proPhotoUrl,
    setProPhotoUrl,
    proPhotoLoading,
    setProPhotoLoading,
    proPhotoError,
    setProPhotoError,
    proPhotoRetry,
    setProPhotoRetry,
    proPhotoStatus,
    setProPhotoStatus,
    proPhotoRetryRef,
  } = usePhotoFetch({
    selectedAircraftHex: selectedAircraft?.hex,
    apiBaseUrl: config.apiBaseUrl,
    wsRequest,
    wsConnected,
  });

  // Phase 4.4: Individual layer opacity controls (0.0 - 1.0)
  const [layerOpacities, setLayerOpacities] = useState(getLayerOpacities);

  // Popup drag state
  const [popupPosition, setPopupPosition] = useState({ x: 16, y: 16 });
  const [isDragging, setIsDragging] = useState(false);
  // Legend drag state (refs + state passed to usePopupDrag hook)
  const [legendPosition, setLegendPosition] = useState({ x: null, y: null });
  const [isLegendDragging, setIsLegendDragging] = useState(false);
  const legendDragStartRef = useRef({ x: 0, y: 0, startX: 0, startY: 0 });

  // Aircraft list drag state
  const [aircraftListPosition, setAircraftListPosition] = useState({ x: null, y: null });
  const [isListDragging, setIsListDragging] = useState(false);
  const listDragStartRef = useRef({ x: 0, y: 0, startX: 0, startY: 0 });

  // ========== PRO RADAR UX IMPROVEMENTS STATE ==========

  // Phase 1: Cursor & Interaction
  const [cursorInfo, setCursorInfo] = useState(null); // { x, y, lat, lon, distance, bearing }
  const [measurementPoints, setMeasurementPoints] = useState([]); // [{lat, lon, x, y}] - max 2 points

  // Phase 2: Aircraft Visualization
  const [showSpeedColors, setShowSpeedColors] = useState(
    () => localStorage.getItem('adsb-pro-speed-colors') === 'true'
  );
  const [showPredictionVectors, setShowPredictionVectors] = useState(
    () => localStorage.getItem('adsb-pro-prediction-vectors') !== 'false'
  ); // default on
  const [showAltitudeTrails, setShowAltitudeTrails] = useState(
    () => localStorage.getItem('adsb-pro-altitude-trails') === 'true'
  );
  const [predictionSeconds, setPredictionSeconds] = useState(() =>
    parseInt(localStorage.getItem('adsb-pro-prediction-seconds') || '60', 10)
  );

  // Phase 3: Conflict Visualization
  const [showConflictVisualization, setShowConflictVisualization] = useState(
    () => localStorage.getItem('adsb-pro-conflict-viz') !== 'false'
  ); // default on

  // VS trend triangles (climb/descend indicators)
  const [showVsTrend, setShowVsTrend] = useState(
    () => localStorage.getItem('adsb-pro-vs-trend') !== 'false'
  ); // default on

  // Phase 4: Grid & Overlays
  const [gridOpacity, setGridOpacity] = useState(() =>
    parseFloat(localStorage.getItem('adsb-pro-grid-opacity') || '0.3')
  );
  const [showCompassRose, setShowCompassRose] = useState(
    () => localStorage.getItem('adsb-pro-compass-rose') === 'true'
  );

  // Phase 5: Theme & Customization - using useProTheme hook
  const {
    theme: proTheme,
    setTheme: setProTheme,
    cycleTheme: cycleProTheme,
    themeColors: proThemeColors,
    themeInfo: proThemeInfo,
  } = useProTheme();
  // Theme colors for Pro mode - computed from proTheme for use in render
  const themeColors = useMemo(() => {
    return config.mapMode === 'pro' ? proThemeColors : null;
  }, [config.mapMode, proThemeColors]);
  const [dataBlockConfig, setDataBlockConfig] = useState(() => {
    const defaults = {
      showCallsign: true,
      showAltitude: true,
      showSpeed: true,
      showHeading: false,
      showVerticalSpeed: false,
      showAircraftType: false,
      showWakeCategory: false, // Phase 8.4: Wake Turbulence Category
      compact: false,
    };
    try {
      const saved = localStorage.getItem('adsb-pro-datablock-config');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Merge with defaults to ensure all fields exist
        return { ...defaults, ...parsed };
      }
      return defaults;
    } catch {
      return defaults;
    }
  });

  // Phase 5: Performance
  const [showFpsCounter, setShowFpsCounter] = useState(false);

  // Phase 6: Labels toggle
  const [showDataBlocks, setShowDataBlocks] = useState(() => {
    const stored = localStorage.getItem('adsb-pro-show-datablocks');
    // Default to true unless explicitly set to 'false'
    return stored !== 'false';
  });

  // Phase 5.2: Data Block Configuration Panel visibility
  const [showDataBlockConfigPanel, setShowDataBlockConfigPanel] = useState(false);

  // Phase 6: Hover tooltip
  const [hoverInfo, setHoverInfo] = useState(null); // { aircraft, x, y }
  const hoverTimeoutRef = useRef(null);

  // Phase 5.1: Theme CSS variables are now handled by useProTheme hook

  // Bug fix #7: Clean up hover timeout on component unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
    };
  }, []);

  // Phase 7: Accessibility
  const [highContrastMode, setHighContrastMode] = useState(
    () => localStorage.getItem('adsb-pro-high-contrast') === 'true'
  );
  const [reducedMotion, setReducedMotion] = useState(() => {
    // Check localStorage first (user preference), then system preference
    const stored = localStorage.getItem('adsb-pro-reduced-motion');
    if (stored !== null) return stored === 'true';
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || false;
  });

  // cursorPosRef and lastHoverCheckRef are managed by useContainerMouseHandlers

  // Aviation data from REST endpoints
  const [aviationData, setAviationData] = useState({
    navaids: [],
    airports: [],
    airspaces: [], // G-AIRMET advisories from /api/v1/aviation/airspaces
    boundaries: [], // Static airspace boundaries from /api/v1/aviation/airspace-boundaries
    metars: [],
    pireps: [],
  });

  // MSAW (Minimum Safe Altitude Warning) hook
  const msaw = useMSAW(aircraft, aviationData.airports);

  // Terrain overlay data (pro mode only) - cached GeoJSON boundaries
  const [terrainData, setTerrainData] = useState({
    water: null,
    counties: null,
    states: null,
    countries: null,
  });

  // Aviation overlay data (pro mode only) - tar1090 GeoJSON from API
  const [aviationOverlayData, setAviationOverlayData] = useState({
    usArtcc: null,
    usRefueling: null,
    ukMilZones: null, // Combined: uk_mil_awacs, uk_mil_aar, uk_mil_rc
    euMilAwacs: null, // Combined: de_mil_awacs, nl_mil_awacs, pl_mil_awacs
    trainingAreas: null, // Combined: ift_nav_routes, ift_training_areas, usafa_training_areas
  });

  // Map viewport center for dynamic data loading (updated on pan/zoom)
  const [viewportCenter, setViewportCenter] = useState({ lat: null, lon: null });
  const viewportUpdateTimeoutRef = useRef(null);

  // Store initial center from URL to apply when map initializes
  const initialCenterRef = useRef(null);
  const initialZoomRef = useRef(null);
  // Ref to always have access to latest setHashParams in event handlers
  const setHashParamsRef = useRef(setHashParams);
  useEffect(() => {
    setHashParamsRef.current = setHashParams;
  }, [setHashParams]);

  const mapRef = useRef(null);
  const containerRef = useRef(null);
  // trackHistoryRef provided by useCanvasDraw hook below
  const shortTrackFetchedRef = useRef(new Map()); // Track which aircraft have had history fetched (hex -> timestamp)
  const prevAircraftIcaosRef = useRef(new Set()); // Track previous aircraft ICAOs for auto-lookup on sighting

  // Pro panel canvas refs
  const trackCanvasRef = useRef(null);
  const altProfileCanvasRef = useRef(null);
  const speedProfileCanvasRef = useRef(null);
  const vsProfileCanvasRef = useRef(null);
  const distProfileCanvasRef = useRef(null);

  // Alarm audio, notifications, and acknowledgment management
  const alarmHook = useMapAlarms({ config, soundMuted });
  const {
    acknowledgedEvents,
    setAcknowledgedEvents,
    initAudioContext,
    playConflictAlarm,
    getHighestSeverity,
    startAlarmLoop,
    stopAlarmLoop,
    sendNotification,
    acknowledgeEvent,
  } = alarmHook;

  // Safety events: fetching, merging, active conflicts, alarm monitoring
  const { safetyEvents, activeConflicts } = useSafetyEvents({
    wsSafetyEvents,
    wsRequest,
    wsConnected,
    config,
    aircraft,
    alarmHook,
  });

  // ACARS data: status, messages, callsign-hex lookups
  const { acarsMessages, acarsStatus, callsignHexCache } = useMapAcarsData({
    wsAcarsMessages,
    wsConnected,
    wsRequest,
    showAcarsPanel,
    config,
    aircraft,
  });

  // Refs to access latest feeder location in event handlers
  const feederLatRef = useRef(feederLat);
  const feederLonRef = useRef(feederLon);
  useEffect(() => {
    feederLatRef.current = feederLat;
    feederLonRef.current = feederLon;
  }, [feederLat, feederLon]);

  // Sync map settings from URL hash params on mount
  useUrlHashSync({
    hashParams,
    setHashParams,
    config,
    setConfig,
    saveConfig,
    radarRange,
    setRadarRange,
    overlays,
    setOverlays,
    saveOverlays,
    trafficFilters,
    setTrafficFilters,
    setSelectedAircraft,
    setAircraftDetailHex,
    setSidebarAircraftHex,
    setProPanOffset,
    initialCenterRef,
    initialZoomRef,
  });

  // Track if user intentionally deselected (to prevent URL sync from re-selecting)
  const userDeselectedRef = useRef(false);

  // Sync selected aircraft from URL (needs to watch aircraft data since it may load after mount)
  useEffect(() => {
    // Don't re-select if user just deselected
    if (userDeselectedRef.current) {
      userDeselectedRef.current = false;
      return;
    }
    if (hashParams.selected && aircraft.length > 0 && !selectedAircraft) {
      const ac = aircraft.find((a) => a.hex?.toLowerCase() === hashParams.selected.toLowerCase());
      if (ac) {
        // Clear other selections and set popup position
        setSelectedMetar(null);
        setSelectedPirep(null);
        setSelectedNavaid(null);
        setSelectedAirport(null);
        setPopupPosition({ x: 16, y: 16 });
        setSelectedAircraft(ac);
      }
    }
  }, [hashParams.selected, aircraft, selectedAircraft]);

  // sendNotification, initAudioContext, playConflictAlarm, etc. provided by useMapAlarms hook

  // Alarm audio functions (initAudioContext, playConflictAlarm, etc.) provided by useMapAlarms hook above

  // acknowledgeEvent provided by useMapAlarms hook

  // soundMuted preference persistence and alarm stop handled by useMapAlarms hook

  // Save short tracks preference
  useEffect(() => {
    localStorage.setItem('adsb-show-short-tracks', showShortTracks.toString());
  }, [showShortTracks]);

  // Screen Wake Lock - prevent screen from sleeping while on map
  useEffect(() => {
    let wakeLock = null;

    const requestWakeLock = async () => {
      if ('wakeLock' in navigator) {
        try {
          wakeLock = await navigator.wakeLock.request('screen');
          // Wake lock acquired
        } catch (err) {
          console.warn('Wake lock request failed:', err.message);
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };

    requestWakeLock();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLock) {
        wakeLock.release().then(() => {
          // Wake lock released
        });
      }
    };
  }, []);

  // Save aircraft list visibility preference
  useEffect(() => {
    localStorage.setItem('adsb-show-aircraft-list', showAircraftList.toString());
  }, [showAircraftList]);

  // Save aircraft list expanded preference
  useEffect(() => {
    localStorage.setItem('adsb-list-expanded', listExpanded.toString());
  }, [listExpanded]);

  // Invalidate map size when panel is pinned/unpinned or ACARS panel toggled
  useEffect(() => {
    if (config.mapMode === 'map' && leafletMapRef.current) {
      setTimeout(() => {
        leafletMapRef.current?.invalidateSize();
      }, 350); // Wait for CSS transition
    }
  }, [panelPinned, showAcarsPanel, config.mapMode]);

  // Safety events merge, fetch, activeConflicts, alarm monitoring, and emergency squawk
  // monitoring are all handled by useSafetyEvents hook above

  // Save overlays to localStorage when changed
  useEffect(() => {
    saveOverlays(overlays);
  }, [overlays]);

  // Save layer opacities to localStorage when changed
  useEffect(() => {
    saveLayerOpacities(layerOpacities);
  }, [layerOpacities]);

  // Save traffic filters to localStorage when changed
  useEffect(() => {
    localStorage.setItem('adsb-traffic-filters', JSON.stringify(trafficFilters));
  }, [trafficFilters]);

  // Save ACARS filters to localStorage when changed
  useEffect(() => {
    localStorage.setItem('adsb-acars-filters', JSON.stringify(acarsFilters));
  }, [acarsFilters]);

  // Fullscreen toggle handler
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  }, []);

  // Listen for fullscreen change
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // ACARS status, messages, and callsign-hex lookups handled by useMapAcarsData hook above

  // Fetch aircraft info when selecting aircraft (using robust hook)
  useEffect(() => {
    if (selectedAircraft?.hex) {
      getAircraftInfo(selectedAircraft.hex);
    }
  }, [selectedAircraft?.hex, getAircraftInfo]);

  // Lazy prefetch aircraft info - only for aircraft visible in the current map viewport
  // This reduces API calls by not fetching info for aircraft outside the view
  useEffect(() => {
    if (!aircraft || aircraft.length === 0) return;

    // Debounce to avoid excessive prefetches during rapid updates
    const timeoutId = setTimeout(() => {
      // Use the Leaflet instance (mapRef is only the container div)
      const map = leafletMapRef.current;
      if (!map) return;

      try {
        const bounds = map.getBounds();
        // Filter to only aircraft within the current map bounds
        const visibleAircraft = aircraft.filter((ac) => {
          if (!ac.lat || !ac.lon) return false;
          return bounds.contains([ac.lat, ac.lon]);
        });

        // Only prefetch if we have visible aircraft and limit batch size
        if (visibleAircraft.length > 0) {
          // Prioritize: selected aircraft, then military, then by distance from center
          const center = map.getCenter();
          const sorted = visibleAircraft.sort((a, b) => {
            // Selected aircraft first
            if (selectedAircraft?.hex === a.hex) return -1;
            if (selectedAircraft?.hex === b.hex) return 1;
            // Military aircraft second
            if (a.military && !b.military) return -1;
            if (!a.military && b.military) return 1;
            // Then by distance from center
            const distA = Math.hypot(a.lat - center.lat, a.lon - center.lng);
            const distB = Math.hypot(b.lat - center.lat, b.lon - center.lng);
            return distA - distB;
          });

          // Limit to reasonable batch size to avoid API spam
          const toFetch = sorted.slice(0, 50);
          prefetchForAircraft(toFetch);
        }
      } catch (e) {
        // Map might not be ready yet
      }
    }, 1000); // 1 second debounce

    return () => clearTimeout(timeoutId);
  }, [aircraft, prefetchForAircraft, selectedAircraft?.hex]);

  // Auto-lookup aircraft info when new aircraft are sighted
  // This ensures we have aircraft info ready before the user interacts with them
  useEffect(() => {
    if (!aircraft || aircraft.length === 0) return;

    const currentIcaos = new Set(aircraft.map((ac) => ac.hex).filter(Boolean));
    const prevIcaos = prevAircraftIcaosRef.current;

    // Find newly sighted aircraft (in current but not in previous)
    const newAircraft = aircraft.filter((ac) => ac.hex && !prevIcaos.has(ac.hex));

    if (newAircraft.length > 0) {
      // Prefetch info for all newly sighted aircraft
      prefetchForAircraft(newAircraft);
    }

    // Update ref for next comparison
    prevAircraftIcaosRef.current = currentIcaos;
  }, [aircraft, prefetchForAircraft]);

  // Popup, legend, and list drag handlers
  const { handlePopupMouseDown, handleLegendMouseDown, handleListMouseDown } = usePopupDrag({
    popupPosition,
    setPopupPosition,
    isDragging,
    setIsDragging,
    legendPosition,
    setLegendPosition,
    isLegendDragging,
    setIsLegendDragging,
    legendDragStartRef,
    listPosition: aircraftListPosition,
    setListPosition: setAircraftListPosition,
    isListDragging,
    setIsListDragging,
    listDragStartRef,
  });

  // Pro mode canvas mouse down: data block drag (Shift+click) + pan (middle button)
  const handleProPanStart = useCallback(
    (e) => {
      // Phase 14.3: Handle Shift+left-click for data block dragging
      if (e.button === 0 && e.shiftKey && config.mapMode === 'pro' && canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const maxRadius = Math.min(rect.width, rect.height) * 0.45;
        const pixelsPerNm = maxRadius / radarRange;
        const aircraftPositions = aircraft
          .filter((ac) => ac.lat && ac.lon)
          .map((ac) => {
            const acNmX = (ac.lon - feederLon) * 60 * Math.cos((feederLat * Math.PI) / 180);
            const acNmY = (ac.lat - feederLat) * 60;
            return {
              hex: ac.hex,
              screenX: centerX + acNmX * pixelsPerNm + proPanOffset.x,
              screenY: centerY - acNmY * pixelsPerNm + proPanOffset.y,
              blockWidth: 100,
              blockHeight: 40,
            };
          });
        const hitHex = hitTestDataBlock(mouseX, mouseY, aircraftPositions);
        if (hitHex && handleDataBlockDragStart(e, hitHex)) {
          e.preventDefault();
          return;
        }
      }
      // Delegate to hook for middle-button pan
      handleProPanStartBase(e);
    },
    [
      config.mapMode,
      radarRange,
      aircraft,
      feederLat,
      feederLon,
      proPanOffset,
      hitTestDataBlock,
      handleDataBlockDragStart,
      handleProPanStartBase,
    ]
  );

  // Phase 7.3: Listen for prefers-reduced-motion system preference changes
  useEffect(() => {
    const mediaQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mediaQuery) return;

    const handleChange = (e) => {
      // Only update if user hasn't set a manual preference
      if (localStorage.getItem('adsb-pro-reduced-motion') === null) {
        setReducedMotion(e.matches);
      }
    };

    mediaQuery.addEventListener?.('change', handleChange);
    return () => mediaQuery.removeEventListener?.('change', handleChange);
  }, []);

  // ========== KEYBOARD SHORTCUTS (Phase 6) ==========
  useProKeyboardShortcuts({
    mapMode: config.mapMode,
    state: {
      overlays,
      panelPinned,
      selectedAircraft,
      dataBlockCustomPositionCount,
      toastContext,
      isPlayback,
    },
    actions: {
      animatePanTo,
      setFollowingAircraft,
      setShowPredictionVectors,
      setShowVsTrend,
      setShowShortTracks,
      setGridOpacity,
      setShowConflictVisualization,
      setShowSpeedColors,
      setShowDataBlocks,
      setShowCompassRose,
      updateOverlays,
      setRadarRange,
      setMeasurementPoints,
      setSelectedAircraft,
      setHoverInfo,
      setShowFpsCounter,
      toggleQuickFilterBar,
      setHighContrastMode,
      setShowAltitudeFilterPanel,
      setShowAltitudeTrails,
      msawToggle: msaw.toggle,
      setReducedMotion,
      setOverlays,
      toggleWatchListPanel,
      toggleWatchList,
      setShowJRings,
      setShowWakeRings,
      setShowSessionStats,
      setShowKeyboardHelp,
      cycleProTheme,
      resetAllDataBlockOffsets,
      togglePlayPause,
      skipPlaybackBackward,
      skipPlaybackForward,
      cyclePlaybackSpeedUp,
      cyclePlaybackSpeedDown,
    },
  });

  // Handle mouse move on radar container to show/hide range control and track cursor
  // Container mouse handlers (cursor tracking, hover, range control)
  const { handleContainerMouseMove, handleContainerMouseLeave, cursorPosRef } =
    useContainerMouseHandlers({
      config,
      radarRange,
      proPanOffset,
      feederLat,
      feederLon,
      aircraft,
      canvasRef,
      containerRef,
      isDataBlockDragging,
      handleDataBlockDragMove,
      handleDataBlockDragEnd,
      hoverInfo,
      setHoverInfo,
      hoverTimeoutRef,
      setCursorInfo,
      setShowRangeControl,
    });

  // Phase 14.3: Global mouse up handler for data block dragging
  useEffect(() => {
    if (isDataBlockDragging) {
      const handleGlobalMouseUp = () => handleDataBlockDragEnd();
      window.addEventListener('mouseup', handleGlobalMouseUp);
      return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
    }
  }, [isDataBlockDragging, handleDataBlockDragEnd]);

  // Track history accumulation + short track fetching
  useTrackHistory({
    sortedAircraft: aircraft,
    trackHistory,
    setTrackHistory,
    shortTrackHistory,
    setShortTrackHistory,
    showShortTracks,
    config,
    feederLat,
    feederLon,
    radarRange,
    shortTrackFetchedRef,
    positionsRef,
    mapRef,
    selectedAircraft,
    wsRequest,
    wsConnected,
  });

  // Draw track history canvas when selected aircraft or history changes
  useEffect(() => {
    if (!trackCanvasRef.current || !selectedAircraft || !trackHistory[selectedAircraft.hex]) return;

    const canvas = trackCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const history = trackHistory[selectedAircraft.hex];

    ctx.clearRect(0, 0, 280, 80);

    if (history.length < 2) return;

    // Find bounds
    let minLat = Infinity,
      maxLat = -Infinity;
    let minLon = Infinity,
      maxLon = -Infinity;
    history.forEach((p) => {
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLon = Math.min(minLon, p.lon);
      maxLon = Math.max(maxLon, p.lon);
    });

    const padding = 10;
    const width = 280 - padding * 2;
    const height = 80 - padding * 2;
    const latRange = maxLat - minLat || 0.01;
    const lonRange = maxLon - minLon || 0.01;

    // Draw track
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();

    history.forEach((p, i) => {
      const x = padding + ((p.lon - minLon) / lonRange) * width;
      const y = padding + height - ((p.lat - minLat) / latRange) * height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Draw current position marker (airplane shape)
    const last = history[history.length - 1];
    const lastX = padding + ((last.lon - minLon) / lonRange) * width;
    const lastY = padding + height - ((last.lat - minLat) / latRange) * height;

    ctx.fillStyle = 'rgba(0, 212, 255, 1)';
    ctx.beginPath();
    ctx.moveTo(lastX, lastY - 6);
    ctx.lineTo(lastX - 4, lastY + 4);
    ctx.lineTo(lastX + 4, lastY + 4);
    ctx.closePath();
    ctx.fill();
  }, [selectedAircraft, trackHistory]);

  // Aviation data fetching (navaids, airports, airspaces, overlays)
  useAviationDataFetch({
    config,
    overlays,
    feederLat,
    feederLon,
    radarRange,
    viewportCenter,
    isProPanning,
    wsRequest,
    wsConnected,
    aviationOverlayData,
    setAviationOverlayData,
    aviationData,
    setAviationData,
  });

  // Terrain overlays (countries, states, counties, water)
  useTerrainOverlays({
    config,
    overlays,
    feederLat,
    feederLon,
    radarRange,
    terrainData,
    setTerrainData,
  });

  // NOTE: Interpolated positions are now read directly from positionsRef in the
  // Leaflet marker update loop, NOT merged into React state. This prevents
  // 60Hz re-renders that were causing performance issues.

  // Memoize safety hexes separately to avoid recalculating sortedAircraft on every safetyEvents change
  const safetyHexes = useMemo(() => {
    const hexes = new Set();
    safetyEvents.forEach((event) => {
      if (event.icao) hexes.add(event.icao.toUpperCase());
      if (event.icao_2) hexes.add(event.icao_2.toUpperCase());
    });
    return hexes;
  }, [safetyEvents]);

  const sortedAircraft = useMemo(() => {
    // Use playback aircraft when in playback mode, otherwise use live aircraft
    const sourceAircraft = isPlayback ? getPlaybackAircraft() : aircraft;

    let filtered = [...sourceAircraft].filter((a) => a.lat && a.lon);

    // Apply traffic filters
    filtered = filtered.filter((ac) => {
      // Safety events only filter
      if (trafficFilters.safetyEventsOnly) {
        if (!safetyHexes.has(ac.hex?.toUpperCase())) return false;
      }

      // Military/Civil filter
      if (ac.military && !trafficFilters.showMilitary) return false;
      if (!ac.military && !trafficFilters.showCivil) return false;

      // Ground/Airborne filter
      const isGround =
        ac.alt_baro === 'ground' || ac.on_ground || (typeof ac.alt === 'number' && ac.alt < 100);
      if (isGround && !trafficFilters.showGround) return false;
      if (!isGround && !trafficFilters.showAirborne) return false;

      // Altitude filter (only for airborne)
      if (!isGround && ac.alt) {
        if (ac.alt < trafficFilters.minAltitude) return false;
        if (ac.alt > trafficFilters.maxAltitude) return false;
      }

      // Squawk filter
      const hasSquawk = ac.squawk && ac.squawk !== '0000';
      if (hasSquawk && !trafficFilters.showWithSquawk) return false;
      if (!hasSquawk && !trafficFilters.showWithoutSquawk) return false;

      // GA/Airliner category filter
      // GA: A1 (Light), A2 (Small), A7 (Rotorcraft), B1 (Glider), B4 (Ultralight)
      // Airliners: A3 (Large), A4 (High Vortex/757), A5 (Heavy)
      const gaCategories = ['A1', 'A2', 'A7', 'B1', 'B4'];
      const airlinerCategories = ['A3', 'A4', 'A5'];
      const category = ac.category?.toUpperCase();
      const isGA = gaCategories.includes(category);
      const isAirliner = airlinerCategories.includes(category);

      if (isGA && !trafficFilters.showGA) return false;
      if (isAirliner && !trafficFilters.showAirliners) return false;

      return true;
    });

    // Apply search filter if in Pro mode and search query exists
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter((ac) => {
        const callsign = (ac.flight || '').toLowerCase().trim();
        const hex = (ac.hex || '').toLowerCase();
        const squawk = (ac.squawk || '').toLowerCase();
        const tail = getTailInfo(ac.hex, ac.flight).tailNumber?.toLowerCase() || '';
        return (
          callsign.includes(query) ||
          hex.includes(query) ||
          squawk.includes(query) ||
          tail.includes(query)
        );
      });
    }

    // Phase 12.1: Apply quick filters for Pro mode
    filtered = filterAircraftByQuickFilters(filtered);

    return filtered.sort((a, b) => (a.distance_nm || 999) - (b.distance_nm || 999));
  }, [
    aircraft,
    searchQuery,
    trafficFilters,
    safetyHexes,
    isPlayback,
    playbackPercent,
    getPlaybackAircraft,
    filterAircraftByQuickFilters,
  ]);

  // Profile canvases (altitude, speed, VS, distance).
  // Must stay below the sortedAircraft memo - hook arguments are evaluated
  // at render time, so referencing it earlier is a TDZ ReferenceError.
  useProfileCanvases({
    selectedAircraft,
    sidebarAircraftHex,
    aircraftInfo,
    config,
    trackHistory,
    sortedAircraft,
    feederLat,
    feederLon,
    getDistanceNm,
    altProfileCanvasRef,
    speedProfileCanvasRef,
    vsProfileCanvasRef,
    distProfileCanvasRef,
  });

  // Live aircraft data for selected aircraft (updates in real-time)
  const liveAircraft = useMemo(() => {
    if (!selectedAircraft) return null;
    return sortedAircraft.find((a) => a.hex === selectedAircraft.hex) || selectedAircraft;
  }, [selectedAircraft, sortedAircraft]);

  // Phase 12.1: Compute quick filter counts (based on pre-filtered aircraft before quick filters)
  // We use the aircraft array before quick filters are applied to show accurate counts
  const quickFilterCounts = useMemo(() => {
    // Use playback aircraft when in playback mode, otherwise use live aircraft
    const sourceAircraft = isPlayback ? getPlaybackAircraft() : aircraft;
    return computeQuickFilterCounts(sourceAircraft.filter((a) => a.lat && a.lon));
  }, [aircraft, isPlayback, getPlaybackAircraft, computeQuickFilterCounts]);

  // Count of watched aircraft that are currently live/visible
  const watchListLiveCount = useMemo(() => {
    return watchList.filter((entry) =>
      sortedAircraft.some((ac) => ac.hex?.toUpperCase() === entry.hex?.toUpperCase())
    ).length;
  }, [watchList, sortedAircraft]);

  // Calculate bounds for simple radar mode (include feeder location)
  const bounds = useMemo(() => {
    const allLats = [...sortedAircraft.map((a) => a.lat), feederLat];
    const allLons = [...sortedAircraft.map((a) => a.lon), feederLon];

    if (sortedAircraft.length === 0) {
      return {
        minLat: feederLat - 1,
        maxLat: feederLat + 1,
        minLon: feederLon - 1.5,
        maxLon: feederLon + 1.5,
      };
    }

    const latPad = Math.max(0.3, (Math.max(...allLats) - Math.min(...allLats)) * 0.15);
    const lonPad = Math.max(0.4, (Math.max(...allLons) - Math.min(...allLons)) * 0.15);

    return {
      minLat: Math.min(...allLats) - latPad,
      maxLat: Math.max(...allLats) + latPad,
      minLon: Math.min(...allLons) - lonPad,
      maxLon: Math.max(...allLons) + lonPad,
    };
  }, [sortedAircraft, feederLat, feederLon]);

  // Get screen position for lat/lon (simple radar mode)
  const getPosition = (lat, lon) => {
    const x = ((lon - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * 90 + 5;
    const y = (1 - (lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * 90 + 5;
    return { x: Math.max(2, Math.min(98, x)), y: Math.max(2, Math.min(98, y)) };
  };

  // Calculate distance from feeder in nm.
  // Function declaration (not const) so it hoists - hooks above reference it.
  function getDistanceNm(lat, lon) {
    const dLat = lat - feederLat;
    const dLon = lon - feederLon;
    const latNm = dLat * 60;
    const lonNm = dLon * 60 * Math.cos((feederLat * Math.PI) / 180);
    return Math.sqrt(latNm * latNm + lonNm * lonNm);
  }

  // Calculate bearing from feeder
  const getBearing = (lat, lon) => {
    const dLat = lat - feederLat;
    const dLon = lon - feederLon;
    const latNm = dLat * 60;
    const lonNm = dLon * 60 * Math.cos((feederLat * Math.PI) / 180);
    return ((Math.atan2(lonNm, latNm) * 180) / Math.PI + 360) % 360;
  };

  // Filter NOTAMs to only those visible on the map (within radar range)
  const visibleNotams = useMemo(() => {
    if (!mapNotams || mapNotams.length === 0) return [];

    // Use radar range with a buffer for panning
    const visibleRange = radarRange * 1.5;

    return mapNotams.filter((notam) => {
      // Check point location
      if (notam.latitude && notam.longitude) {
        const dist = getDistanceNm(notam.latitude, notam.longitude);
        if (dist <= visibleRange) return true;
      }

      // Check geometry (for TFRs with polygon bounds)
      if (notam.geometry?.coordinates) {
        const coords =
          notam.geometry.type === 'Polygon'
            ? notam.geometry.coordinates[0]
            : notam.geometry.type === 'MultiPolygon'
              ? notam.geometry.coordinates[0][0]
              : null;

        if (coords && coords.length > 0) {
          // Check if any vertex is within visible range
          for (const coord of coords) {
            const lon = Array.isArray(coord) ? coord[0] : coord.lon;
            const lat = Array.isArray(coord) ? coord[1] : coord.lat;
            if (lat && lon) {
              const dist = getDistanceNm(lat, lon);
              if (dist <= visibleRange) return true;
            }
          }

          // Also check the center of the polygon
          const lats = coords.map((c) => (Array.isArray(c) ? c[1] : c.lat)).filter(Boolean);
          const lons = coords.map((c) => (Array.isArray(c) ? c[0] : c.lon)).filter(Boolean);
          if (lats.length > 0 && lons.length > 0) {
            const centerLat = lats.reduce((a, b) => a + b, 0) / lats.length;
            const centerLon = lons.reduce((a, b) => a + b, 0) / lons.length;
            const centerDist = getDistanceNm(centerLat, centerLon);
            if (centerDist <= visibleRange) return true;
          }
        }
      }

      return false;
    });
  }, [mapNotams, radarRange, feederLat, feederLon]);

  // Count unacknowledged NOTAMs that are visible on the map
  const visibleUnacknowledgedCount = useMemo(() => {
    if (!visibleNotams || !acknowledgedNotams) return 0;
    return visibleNotams.filter((notam) => !acknowledgedNotams.has(notam.notam_id || notam.id))
      .length;
  }, [visibleNotams, acknowledgedNotams]);

  // CRT/Pro canvas drawing (history effects + animation loop)
  const { trackHistoryRef } = useCanvasDraw({
    config,
    canvasRef,
    containerRef,
    feederLat,
    feederLon,
    radarRange,
    proPanOffset,
    setProPanOffset,
    setRadarRange,
    setHashParams,
    sortedAircraft,
    selectedAircraft,
    aircraftInfo,
    activeConflicts,
    acarsMessages,
    highlightedHexes,
    highContrastMode,
    aviationData,
    aviationOverlayData,
    terrainData,
    overlays,
    layerOpacities,
    airspaceTypeFilters,
    weatherAdvisoryFilters,
    showAirspaceLabels,
    safetyEvents,
    showConflictVisualization,
    showJRings,
    showWakeRings,
    trackHistory,
    shortTrackHistory,
    showSelectedTrack,
    showShortTracks,
    followingAircraft,
    showAltitudeTrails,
    gridOpacity,
    showCompassRose,
    showSpeedColors,
    showPredictionVectors,
    predictionSeconds,
    showDataBlocks,
    dataBlockConfig,
    showVsTrend,
    measurementPoints,
    cursorInfo,
    showFpsCounter,
    reducedMotion,
    msaw,
    proThemeColors,
    selectedMetar,
    selectedPirep,
    selectedNavaid,
    selectedAirport,
    selectedSigmet,
    selectedAdvisoryId,
    selectedNotamId,
    stationsWithTaf,
    getTafForAirport,
    convectiveSigmets,
    airspaceAdvisories,
    acknowledgedAdvisories,
    mapNotams,
    acknowledgedNotams,
    windGrid,
    windsAloftLevel,
    weatherRadarImage,
    weatherRadarBounds,
    drawWeatherRadar,
    drawSigmets,
    HAZARD_CONFIG,
    NOTAM_TYPE_CONFIG,
    getAircraftHighlight,
    hasCustomDataBlockOffset,
    getDataBlockOffset,
    autoDeconflictEnabled,
    maybeDeconflict,
    hasHighlightGroups,
  });

  // Leaflet map (setup, markers, position updates, polylines)
  const { leafletMapRef } = useLeafletMap({
    config,
    mapRef,
    feederLat,
    feederLon,
    sortedAircraft,
    safetyEvents,
    positionsRef,
    showShortTracks,
    shortTrackHistory,
    trackHistory,
    selectAircraft,
    openAircraftSidebar,
    setViewportCenter,
    initialCenterRef,
    initialZoomRef,
    feederLatRef,
    feederLonRef,
    setHashParamsRef,
    viewportUpdateTimeoutRef,
  });

  const toggleDarkMode = () => {
    const newDarkMode = !config.mapDarkMode;
    const newConfig = { ...config, mapDarkMode: newDarkMode };
    setConfig(newConfig);
    saveConfig(newConfig);
    // Update URL hash with dark mode
    if (setHashParams) {
      setHashParams({ dark: newDarkMode ? '1' : '0' });
    }
  };

  // Update URL when range changes
  const updateRadarRange = (newRange) => {
    setRadarRange(newRange);
    if (setHashParams) {
      setHashParams({ range: String(newRange) });
    }
  };

  // Update URL when overlays change.
  // Function declaration (not const) so it hoists - the keyboard-shortcuts
  // hook's actions object references it earlier in the component body.
  function updateOverlays(newOverlays) {
    setOverlays(newOverlays);
    saveOverlays(newOverlays);
    if (setHashParams) {
      const enabledOverlays = Object.entries(newOverlays)
        .filter(([, enabled]) => enabled)
        .map(([key]) => key)
        .join(',');
      setHashParams({ overlays: enabledOverlays || undefined });
    }
  }

  // Update URL when traffic filters change
  const updateTrafficFilters = (newFiltersOrUpdater) => {
    setTrafficFilters((prev) => {
      const newFilters =
        typeof newFiltersOrUpdater === 'function' ? newFiltersOrUpdater(prev) : newFiltersOrUpdater;

      // Update URL with enabled boolean filters and altitude range
      if (setHashParams) {
        const boolKeys = [
          'showMilitary',
          'showCivil',
          'showGround',
          'showAirborne',
          'showWithSquawk',
          'showWithoutSquawk',
          'safetyEventsOnly',
          'showGA',
          'showAirliners',
        ];
        const enabledFilters = boolKeys.filter((key) => newFilters[key]).join(',');
        setHashParams({
          filters: enabledFilters || undefined,
          minAlt: newFilters.minAltitude !== 0 ? String(newFilters.minAltitude) : undefined,
          maxAlt: newFilters.maxAltitude !== 60000 ? String(newFilters.maxAltitude) : undefined,
        });
      }

      return newFilters;
    });
  };

  // Open sidebar quick view for aircraft.
  // Function declaration (not const) so it hoists - useLeafletMap's argument
  // object above references it at render time.
  function openAircraftSidebar(hex) {
    setSidebarAircraftHex(hex);
    // Close full modal if open
    if (hex && aircraftDetailHex) {
      setAircraftDetailHex(null);
    }
    if (setHashParams && hex) {
      setHashParams({ aircraft: hex });
    } else if (setHashParams) {
      setHashParams({ aircraft: undefined });
    }
  }

  // Update URL when opening aircraft detail (full modal - and clear when closing)
  const openAircraftDetail = (hex) => {
    setAircraftDetailHex(hex);
    // Close sidebar when opening full modal
    if (hex && sidebarAircraftHex) {
      setSidebarAircraftHex(null);
    }
    if (setHashParams && hex) {
      setHashParams({ aircraft: hex });
    } else if (setHashParams) {
      setHashParams({ aircraft: undefined });
    }
  };

  // Update URL when selecting aircraft (popup, not full detail).
  // Function declaration (not const) so it hoists - useLeafletMap's argument
  // object above references it at render time.
  function selectAircraft(ac) {
    // Mark intentional deselection to prevent URL sync from re-selecting
    if (!ac) {
      userDeselectedRef.current = true;
    }
    setSelectedAircraft(ac);
    if (setHashParams && ac?.hex) {
      setHashParams({ selected: ac.hex });
    } else if (setHashParams) {
      setHashParams({ selected: undefined });
    }
  }

  // Center map on a watched aircraft
  const centerOnWatchedAircraft = useCallback(
    (entry) => {
      // Find live aircraft data for this watched entry
      const ac = sortedAircraft.find((a) => a.hex?.toUpperCase() === entry.hex?.toUpperCase());
      if (ac?.lat && ac?.lon && config.mapMode === 'map' && leafletMapRef.current) {
        leafletMapRef.current.flyTo([ac.lat, ac.lon], 12, {
          duration: 1.5,
          easeLinearity: 0.25,
        });
      }
    },
    [sortedAircraft, config.mapMode]
  );

  // Get feeder position for simple radar
  const feederPos = getPosition(feederLat, feederLon);

  // Count aircraft in range for CRT mode
  const inRangeCount = sortedAircraft.filter((ac) => {
    const dist = ac.distance_nm || getDistanceNm(ac.lat, ac.lon);
    return dist <= radarRange;
  }).length;

  // Get severity color class

  // Close mobile menus on map click
  const handleMapClick = useCallback(() => {
    initAudioContext();
    setShowMobileControls(false);
    setShowFilterMenu(false);
    setShowOverlayMenu(false);
  }, [initAudioContext]);

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className="map-container" onClick={handleMapClick}>
      {/* Mobile Map Header + Controls Dropdown */}
      <MobileMapHeader
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        showMobileControls={showMobileControls}
        setShowMobileControls={setShowMobileControls}
        showAircraftList={showAircraftList}
        setShowAircraftList={setShowAircraftList}
        showFilterMenu={showFilterMenu}
        setShowFilterMenu={setShowFilterMenu}
        showOverlayMenu={showOverlayMenu}
        setShowOverlayMenu={setShowOverlayMenu}
        showShortTracks={showShortTracks}
        setShowShortTracks={setShowShortTracks}
        soundMuted={soundMuted}
        setSoundMuted={setSoundMuted}
        config={config}
        leafletMapRef={leafletMapRef}
        feederLat={feederLat}
        feederLon={feederLon}
        setProPanOffset={setProPanOffset}
        aircraftCount={aircraft.length}
      />
      {/* Safety Event Banner */}
      <SafetyBanner
        activeConflicts={activeConflicts}
        acknowledgedEvents={acknowledgedEvents}
        acknowledgeEvent={acknowledgeEvent}
        aircraft={aircraft}
        config={config}
        selectAircraft={selectAircraft}
        setSelectedMetar={setSelectedMetar}
        setSelectedPirep={setSelectedPirep}
        setSelectedNavaid={setSelectedNavaid}
        setSelectedAirport={setSelectedAirport}
        setPopupPosition={setPopupPosition}
        soundMuted={soundMuted}
        setSoundMuted={setSoundMuted}
      />

      {/* Simple Radar Mode */}
      {config.mapMode === 'radar' && (
        <SimpleRadarView
          sortedAircraft={sortedAircraft}
          feederPos={feederPos}
          selectAircraft={selectAircraft}
          handleAircraftContextMenu={handleAircraftContextMenu}
          hasAircraftNote={hasAircraftNote}
          getPosition={getPosition}
        />
      )}

      {/* CRT ATC Radar Mode & Pro Mode - Canvas Based */}
      {(config.mapMode === 'crt' || config.mapMode === 'pro') && (
        <MultiScopeContainer
          layout={config.mapMode === 'pro' ? scopeLayout.layout : 'single'}
          scopes={scopeLayout.scopes}
          activeScope={scopeLayout.activeScope}
          syncSelection={scopeLayout.syncSelection}
          onLayoutChange={scopeLayout.setLayoutMode}
          onSyncToggle={() => scopeLayout.setSyncSelection(!scopeLayout.syncSelection)}
          onScopeRangeChange={(id, range) => {
            scopeLayout.setScopeRange(id, range);
            // If this is the active scope, also update the main radarRange
            if (id === scopeLayout.activeScope) {
              setRadarRange(range);
            }
          }}
          onScopeReset={(id) => {
            scopeLayout.resetScope(id);
            if (id === scopeLayout.activeScope) {
              setProPanOffset({ x: 0, y: 0 });
            }
          }}
          onScopeActivate={(id) => {
            scopeLayout.setActiveScope(id);
            // When switching scopes, load that scope's range and pan offset
            const scope = scopeLayout.scopes.find((s) => s.id === id);
            if (scope) {
              setRadarRange(scope.range);
              setProPanOffset(scope.panOffset || { x: 0, y: 0 });
            }
          }}
          isPro={config.mapMode === 'pro'}
          className={`crt-radar-container ${config.mapMode === 'pro' ? 'pro-mode' : ''}`}
        >
          {({ scope, isActive }) =>
            // Only render the full canvas for the active scope
            // Inactive scopes show a simplified preview
            isActive ? (
              <div
                className="scope-content-wrapper"
                ref={containerRef}
                onMouseMove={handleContainerMouseMove}
                onMouseLeave={handleContainerMouseLeave}
              >
                {/* Phase 12.1: Quick Filter Bar for Pro Mode */}
                {config.mapMode === 'pro' && showQuickFilterBar && (
                  <QuickFilterBar
                    activeFilters={quickActiveFilters}
                    filterCounts={quickFilterCounts}
                    onToggleFilter={toggleQuickFilter}
                    onClear={clearQuickFilters}
                    onClose={toggleQuickFilterBar}
                  />
                )}
                <canvas
                  ref={canvasRef}
                  className="crt-radar-canvas"
                  onMouseDown={handleProPanStart}
                  onContextMenu={(e) => e.preventDefault()}
                  style={{
                    cursor: isProPanning
                      ? 'grabbing'
                      : config.mapMode === 'pro'
                        ? 'grab'
                        : 'default',
                  }}
                  onClick={(e) =>
                    handleCanvasClick(e, {
                      canvasRef,
                      config,
                      radarRange,
                      feederLat,
                      feederLon,
                      proPanOffset,
                      measurementPoints,
                      setMeasurementPoints,
                      overlays,
                      sortedAircraft,
                      aviationData,
                      airspaceTypeFilters,
                      weatherAdvisoryFilters,
                      getDistanceNm,
                      getBearing,
                      getTafForAirport,
                      panelPinned,
                      selectAircraft,
                      setSelectedMetar,
                      setSelectedPirep,
                      setSelectedNavaid,
                      setSelectedAirport,
                      setSelectedAirspace,
                      setSelectedTaf,
                      setSelectedSigmet,
                      setPopupPosition,
                    })
                  }
                  onDoubleClick={(e) =>
                    handleCanvasDoubleClick(e, {
                      canvasRef,
                      config,
                      radarRange,
                      feederLat,
                      feederLon,
                      proPanOffset,
                      overlays,
                      sortedAircraft,
                      getDistanceNm,
                      getBearing,
                      openAircraftSidebar,
                      setFollowingAircraft,
                      animatePanTo,
                    })
                  }
                />

                {/* CRT overlay effects (CRT mode only) */}
                {config.mapMode === 'crt' && (
                  <div className="crt-effects">
                    <div className="crt-scanlines" />
                  </div>
                )}

                {/* Phase 8.2: MSAW status badge */}
                {msaw.enabled && msaw.counts.total > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 8,
                      left: 8,
                      background:
                        msaw.counts.alerts > 0 ? 'rgba(255,50,50,0.8)' : 'rgba(255,200,0,0.8)',
                      color: '#000',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontFamily: 'monospace',
                      fontSize: 11,
                      fontWeight: 'bold',
                      zIndex: 50,
                    }}
                  >
                    MSAW: {msaw.counts.alerts}A / {msaw.counts.warnings}W
                  </div>
                )}

                {/* Phase 6.2: Hover info tooltip */}
                {hoverInfo && config.mapMode === 'pro' && (
                  <div
                    className="pro-hover-tooltip"
                    style={{
                      position: 'absolute',
                      left: Math.min(
                        hoverInfo.x + 20,
                        containerRef.current?.clientWidth - 200 || hoverInfo.x
                      ),
                      top: Math.min(
                        hoverInfo.y - 10,
                        containerRef.current?.clientHeight - 120 || hoverInfo.y
                      ),
                      background: 'rgba(15, 25, 35, 0.95)',
                      border: '1px solid rgba(80, 140, 200, 0.6)',
                      borderRadius: '6px',
                      padding: '10px 12px',
                      zIndex: 1000,
                      pointerEvents: 'none',
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: '11px',
                      color: 'rgba(150, 210, 255, 0.9)',
                      minWidth: '160px',
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 'bold',
                        fontSize: '13px',
                        color: 'rgba(100, 200, 255, 1)',
                        marginBottom: '6px',
                      }}
                    >
                      {hoverInfo.aircraft.flight?.trim() || hoverInfo.aircraft.hex}
                    </div>
                    <div
                      style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: '3px 8px' }}
                    >
                      <span style={{ color: 'rgba(100, 160, 200, 0.7)' }}>Type:</span>
                      <span>
                        {hoverInfo.aircraft.t ||
                          hoverInfo.aircraft.type ||
                          hoverInfo.aircraft.desc ||
                          '---'}
                      </span>
                      <span style={{ color: 'rgba(100, 160, 200, 0.7)' }}>Alt:</span>
                      <span>
                        {hoverInfo.aircraft.alt
                          ? `${hoverInfo.aircraft.alt.toLocaleString()} ft`
                          : '---'}
                      </span>
                      <span style={{ color: 'rgba(100, 160, 200, 0.7)' }}>Speed:</span>
                      <span>
                        {hoverInfo.aircraft.gs ? `${Math.round(hoverInfo.aircraft.gs)} kts` : '---'}
                      </span>
                      <span style={{ color: 'rgba(100, 160, 200, 0.7)' }}>Squawk:</span>
                      <span>{hoverInfo.aircraft.squawk || '---'}</span>
                    </div>
                  </div>
                )}

                {/* Range control */}
                <div
                  className={`crt-range-control ${config.mapMode === 'pro' ? 'pro-style' : ''} ${showRangeControl ? 'visible' : ''}`}
                >
                  <span className="crt-range-label">RNG</span>
                  {[10, 25, 50, 100, 200].map((r) => (
                    <button
                      key={r}
                      className={`crt-range-btn ${radarRange === r ? 'active' : ''}`}
                      onClick={() => updateRadarRange(r)}
                    >
                      {r}
                    </button>
                  ))}
                </div>

                {/* Heat Map Layer (Pro mode) */}
                {config.mapMode === 'pro' && overlays.heatMap && (
                  <HeatMapLayer
                    enabled={overlays.heatMap}
                    heatMapData={heatMapData}
                    bounds={heatMapBounds}
                    width={containerRef.current?.clientWidth || 800}
                    height={containerRef.current?.clientHeight || 600}
                    latLonToScreen={latLonToScreenMemo}
                    stats={heatMapStats}
                    loading={heatMapLoading}
                    error={heatMapError}
                    timePeriod={heatMapTimePeriod}
                    setTimePeriod={setHeatMapTimePeriod}
                    gridSize={heatMapGridSize}
                    setGridSize={setHeatMapGridSize}
                    opacity={heatMapOpacity}
                    setOpacity={setHeatMapOpacity}
                    hideAircraft={heatMapHideAircraft}
                    setHideAircraft={setHeatMapHideAircraft}
                    onRefresh={refreshHeatMap}
                    onClear={clearHeatMap}
                    themeColors={themeColors}
                  />
                )}
              </div>
            ) : (
              // Inactive scope - render simplified radar view using ProRadarScope
              <ProRadarScope
                scopeId={scope.id}
                isActive={false}
                range={scope.range}
                panOffset={scope.panOffset || { x: 0, y: 0 }}
                center={scope.center}
                aircraft={sortedAircraft}
                feederLocation={feederLocationMemo}
                selectedAircraft={scopeLayout.syncSelection ? selectedAircraft : null}
                themeColors={themeColors}
                showGrid={overlays.grid !== false}
                showCompassRose={overlays.compassRose !== false}
                showRangeRings={overlays.rangeRings !== false}
                showDataBlocks={overlays.dataBlocks !== false}
                showPredictionVectors={overlays.predictionVectors !== false}
                showShortTracks={showShortTracks}
                showSpeedColoring={overlays.speedColoring !== false}
                showVerticalSpeedTrend={overlays.verticalSpeedTrend !== false}
                predictionMinutes={config.predictionMinutes || 2}
                shortTrackLength={config.shortTrackLength || 15}
                gridOpacity={gridOpacity}
                onAircraftClick={(ac) => {
                  if (ac && scopeLayout.syncSelection) {
                    selectAircraft(ac);
                  }
                }}
                onPanChange={(id, offset) => {
                  scopeLayout.setScopePanOffset(id, offset);
                }}
                onRangeChange={(id, newRange) => {
                  scopeLayout.setScopeRange(id, newRange);
                }}
                onActivate={(id) => {
                  scopeLayout.setActiveScope(id);
                  const targetScope = scopeLayout.scopes.find((s) => s.id === id);
                  if (targetScope) {
                    setRadarRange(targetScope.range);
                    setProPanOffset(targetScope.panOffset || { x: 0, y: 0 });
                  }
                }}
              />
            )
          }
        </MultiScopeContainer>
      )}

      {/* Leaflet Map Mode */}
      {config.mapMode === 'map' && <div ref={mapRef} className="leaflet-map" />}

      {/* Map Controls */}
      <MapControlsBar
        config={config}
        setConfig={setConfig}
        saveConfig={saveConfig}
        showFilterMenu={showFilterMenu}
        setShowFilterMenu={setShowFilterMenu}
        showOverlayMenu={showOverlayMenu}
        setShowOverlayMenu={setShowOverlayMenu}
        showShortTracks={showShortTracks}
        setShowShortTracks={setShowShortTracks}
        soundMuted={soundMuted}
        setSoundMuted={setSoundMuted}
        isFullscreen={isFullscreen}
        toggleDarkMode={toggleDarkMode}
        toggleFullscreen={toggleFullscreen}
      />

      {/* Overlay Menu - available on all map modes */}
      {showOverlayMenu && (
        <OverlayMenuPanel
          overlays={overlays}
          updateOverlays={updateOverlays}
          showAirspaceLabels={showAirspaceLabels}
          setShowAirspaceLabels={setShowAirspaceLabels}
          airspaceTypeFilters={airspaceTypeFilters}
          setAirspaceTypeFilters={setAirspaceTypeFilters}
          weatherAdvisoryFilters={weatherAdvisoryFilters}
          setWeatherAdvisoryFilters={setWeatherAdvisoryFilters}
          windsAloftLevel={windsAloftLevel}
          setWindsAloftLevel={setWindsAloftLevel}
          showCompassRose={showCompassRose}
          setShowCompassRose={setShowCompassRose}
          gridOpacity={gridOpacity}
          setGridOpacity={setGridOpacity}
          showDataBlocks={showDataBlocks}
          setShowDataBlocks={setShowDataBlocks}
          showPredictionVectors={showPredictionVectors}
          setShowPredictionVectors={setShowPredictionVectors}
          showVsTrend={showVsTrend}
          setShowVsTrend={setShowVsTrend}
          showSpeedColors={showSpeedColors}
          setShowSpeedColors={setShowSpeedColors}
          showAltitudeTrails={showAltitudeTrails}
          setShowAltitudeTrails={setShowAltitudeTrails}
          showConflictVisualization={showConflictVisualization}
          setShowConflictVisualization={setShowConflictVisualization}
          dataBlockConfig={dataBlockConfig}
          setDataBlockConfig={setDataBlockConfig}
          layerOpacities={layerOpacities}
          setLayerOpacities={setLayerOpacities}
          proTheme={proTheme}
          setProTheme={setProTheme}
          showLegend={showLegend}
          setShowLegend={setShowLegend}
          config={config}
          onClose={() => setShowOverlayMenu(false)}
          setShowDataBlockConfigPanel={setShowDataBlockConfigPanel}
        />
      )}

      {/* Phase 8.3: Altitude Filter Panel - Pro Mode */}
      <AltitudeFilterPanel
        show={showAltitudeFilterPanel && (config.mapMode === 'pro' || config.mapMode === 'crt')}
        onClose={() => setShowAltitudeFilterPanel(false)}
        altitudeFilter={altitudeFilter}
        setAltitudePreset={setAltitudePreset}
        setCustomRange={setCustomRange}
        toggleHideFiltered={toggleHideFiltered}
        resetFilter={resetAltitudeFilter}
      />

      {/* Watch List Panel - Pro/CRT Mode */}
      <WatchListPanel
        watchList={watchList}
        panelVisible={
          watchListPanelVisible && (config.mapMode === 'pro' || config.mapMode === 'crt')
        }
        onRemove={removeFromWatchList}
        onClear={clearWatchList}
        onTogglePanel={toggleWatchListPanel}
        onHidePanel={hideWatchListPanel}
        onCenterAircraft={centerOnWatchedAircraft}
        onSelectAircraft={selectAircraft}
        onExport={exportWatchList}
        onImport={importWatchList}
        aircraft={sortedAircraft}
        isProMode={config.mapMode === 'pro'}
        expanded={watchListExpanded}
        onToggleExpanded={() => setWatchListExpanded((prev) => !prev)}
        position={watchListPanelPosition}
        isDragging={isWatchListPanelDragging}
        onMouseDown={onWatchListPanelMouseDown}
      />

      {/* Watch List Show Button - when panel is hidden */}
      {!watchListPanelVisible && (config.mapMode === 'pro' || config.mapMode === 'crt') && (
        <WatchListShowButton
          count={watchListCount}
          liveCount={watchListLiveCount}
          onClick={showWatchListPanel}
          isProMode={config.mapMode === 'pro'}
        />
      )}

      {/* Highlight Groups Show Button - when panel is hidden (Pro mode only) */}
      {!highlightPanelVisible && config.mapMode === 'pro' && (
        <HighlightGroupsShowButton
          enabledCount={highlightEnabledCount}
          onClick={toggleHighlightPanel}
          isProMode={true}
        />
      )}

      {/* Traffic Filter Menu - available on all map modes */}
      {showFilterMenu && (
        <FilterMenuPanel
          trafficFilters={trafficFilters}
          updateTrafficFilters={updateTrafficFilters}
          onClose={() => setShowFilterMenu(false)}
        />
      )}

      {/* Symbol Legend Panel */}
      {showLegend && (config.mapMode === 'crt' || config.mapMode === 'pro') && (
        <InlineLegendPanel
          config={config}
          legendCollapsed={legendCollapsed}
          setLegendCollapsed={setLegendCollapsed}
          setShowLegend={setShowLegend}
          legendPosition={legendPosition}
          isLegendDragging={isLegendDragging}
          handleLegendMouseDown={handleLegendMouseDown}
          legendDragStartRef={legendDragStartRef}
          setIsLegendDragging={setIsLegendDragging}
        />
      )}

      {/* Session Stats Panel (Phase 13.3) */}
      <SessionStatsPanel
        show={showSessionStats}
        onClose={() => setShowSessionStats(false)}
        sessionStats={sessionStats}
        config={config}
      />

      {/* Session Stats Button */}
      <SessionStatsButton
        onClick={() => setShowSessionStats(!showSessionStats)}
        isActive={showSessionStats}
        config={config}
      />

      {/* Aircraft List (show button + panel) */}
      {(config.mapMode === 'crt' || config.mapMode === 'pro') && (
        <AircraftListInline
          config={config}
          showAircraftList={showAircraftList}
          setShowAircraftList={setShowAircraftList}
          listExpanded={listExpanded}
          setListExpanded={setListExpanded}
          sortedAircraft={sortedAircraft}
          selectedAircraft={selectedAircraft}
          selectAircraft={selectAircraft}
          activeConflicts={activeConflicts}
          inRangeCount={inRangeCount}
          radarRange={radarRange}
          listDisplayCount={listDisplayCount}
          setListDisplayCount={setListDisplayCount}
          aircraftListPosition={aircraftListPosition}
          isListDragging={isListDragging}
          handleListMouseDown={handleListMouseDown}
          isDragging={isDragging}
          getSeverityClass={getSeverityClass}
          getEventTypeName={getEventTypeName}
          openAircraftDetail={openAircraftDetail}
        />
      )}

      {/* Legend (hidden in CRT/Pro mode) */}
      {config.mapMode !== 'crt' && config.mapMode !== 'pro' && (
        <div className="map-legend">
          <div className="legend-item">
            <span className="dot civilian" /> Civilian (
            {sortedAircraft.filter((a) => !a.military && !a.emergency).length})
          </div>
          <div className="legend-item">
            <span className="dot military" /> Military (
            {sortedAircraft.filter((a) => a.military).length})
          </div>
          <div className="legend-item">
            <span className="dot emergency" /> Emergency (
            {sortedAircraft.filter((a) => a.emergency).length})
          </div>
          <div
            className="legend-item"
            style={{ borderTop: '1px solid var(--border)', paddingTop: '8px', marginTop: '4px' }}
          >
            <span style={{ color: 'var(--text-dim)', fontSize: '11px' }}>
              {sortedAircraft.length} with position / {aircraft.length} total
            </span>
          </div>
        </div>
      )}

      {/* Selected Aircraft Popup */}
      <SelectedAircraftPanel
        liveAircraft={liveAircraft}
        config={config}
        popupPosition={popupPosition}
        isDragging={isDragging}
        handlePopupMouseDown={handlePopupMouseDown}
        selectAircraft={selectAircraft}
        activeConflicts={activeConflicts}
        aircraft={aircraft}
        getSeverityClass={getSeverityClass}
        getEventTypeName={getEventTypeName}
        followingAircraft={followingAircraft}
        setFollowingAircraft={setFollowingAircraft}
        leafletMapRef={leafletMapRef}
        openAircraftSidebar={openAircraftSidebar}
        onViewHistoryEvent={onViewHistoryEvent}
      />

      {/* METAR Popup */}
      {selectedMetar && (
        <MetarPopup
          metar={selectedMetar}
          config={config}
          popupPosition={popupPosition}
          isDragging={isDragging}
          onClose={() => setSelectedMetar(null)}
          onMouseDown={handlePopupMouseDown}
        />
      )}

      {/* TAF Popup */}
      {selectedTaf && (
        <TafPopup
          taf={selectedTaf}
          onClose={() => setSelectedTaf(null)}
          mapMode={config.mapMode}
          getDistanceNm={getDistanceNm}
        />
      )}

      {/* PIREP Popup */}
      {selectedPirep && (
        <PirepPopup
          pirep={selectedPirep}
          config={config}
          popupPosition={popupPosition}
          isDragging={isDragging}
          onClose={() => setSelectedPirep(null)}
          onMouseDown={handlePopupMouseDown}
        />
      )}

      {/* Navaid Popup */}
      {selectedNavaid && (
        <NavaidPopup
          navaid={selectedNavaid}
          config={config}
          popupPosition={popupPosition}
          isDragging={isDragging}
          onClose={() => setSelectedNavaid(null)}
          onMouseDown={handlePopupMouseDown}
          getDistanceNm={getDistanceNm}
          getBearing={getBearing}
        />
      )}

      {/* Airport Popup */}
      {selectedAirport && (
        <AirportPopup
          airport={selectedAirport}
          config={config}
          popupPosition={popupPosition}
          isDragging={isDragging}
          onClose={() => setSelectedAirport(null)}
          onMouseDown={handlePopupMouseDown}
          getDistanceNm={getDistanceNm}
          getBearing={getBearing}
        />
      )}

      {/* Airspace Popup */}
      {selectedAirspace && (
        <AirspacePopup
          airspace={selectedAirspace}
          config={config}
          popupPosition={popupPosition}
          isDragging={isDragging}
          onClose={() => setSelectedAirspace(null)}
          onMouseDown={handlePopupMouseDown}
        />
      )}

      {/* Convective SIGMET Popup */}
      {selectedSigmet && (
        <SigmetPopup
          sigmet={selectedSigmet}
          config={config}
          popupPosition={popupPosition}
          isDragging={isDragging}
          onClose={() => setSelectedSigmet(null)}
          onMouseDown={handlePopupMouseDown}
        />
      )}

      {/* Pro Mode Search Bar */}
      <ProSearchBar
        config={config}
        setConfig={setConfig}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        soundMuted={soundMuted}
        setSoundMuted={setSoundMuted}
        showAcarsPanel={showAcarsPanel}
        setShowAcarsPanel={setShowAcarsPanel}
        showAdvisoryPanel={showAdvisoryPanel}
        setShowAdvisoryPanel={setShowAdvisoryPanel}
        advisoryCount={advisoryUnacknowledgedCount}
        showNotamPanel={showNotamPanel}
        setShowNotamPanel={setShowNotamPanel}
        notamCount={visibleUnacknowledgedCount}
        showFilterMenu={showFilterMenu}
        setShowFilterMenu={setShowFilterMenu}
        showOverlayMenu={showOverlayMenu}
        setShowOverlayMenu={setShowOverlayMenu}
        showShortTracks={showShortTracks}
        setShowShortTracks={setShowShortTracks}
        showSelectedTrack={showSelectedTrack}
        setShowSelectedTrack={setShowSelectedTrack}
        selectedAircraft={selectedAircraft}
        proPanOffset={proPanOffset}
        setProPanOffset={setProPanOffset}
        followingAircraft={followingAircraft}
        setFollowingAircraft={setFollowingAircraft}
        setHashParams={setHashParams}
        isFullscreen={isFullscreen}
        toggleFullscreen={toggleFullscreen}
        acarsStatus={acarsStatus}
        aircraft={aircraft}
        aircraftInfo={aircraftInfo}
        onSelectAircraft={selectAircraft}
        highlightedHexes={highlightedHexes}
        setHighlightedHexes={setHighlightedHexes}
      />

      {/* Pro Mode Details Panel */}
      <ProDetailsPanel
        config={config}
        liveAircraft={liveAircraft}
        selectAircraft={selectAircraft}
        activeConflicts={activeConflicts}
        aircraftInfo={aircraftInfo}
        followingAircraft={followingAircraft}
        setFollowingAircraft={setFollowingAircraft}
        panelPinned={panelPinned}
        setPanelPinned={setPanelPinned}
        openAircraftDetail={openAircraftSidebar}
        onViewHistoryEvent={onViewHistoryEvent}
        getDistanceNm={getDistanceNm}
        proPhotoUrl={proPhotoUrl}
        setProPhotoUrl={setProPhotoUrl}
        proPhotoLoading={proPhotoLoading}
        setProPhotoLoading={setProPhotoLoading}
        proPhotoError={proPhotoError}
        setProPhotoError={setProPhotoError}
        proPhotoRetry={proPhotoRetry}
        setProPhotoRetry={setProPhotoRetry}
        proPhotoStatus={proPhotoStatus}
        setProPhotoStatus={setProPhotoStatus}
        proPhotoRetryRef={proPhotoRetryRef}
        getAircraftError={getAircraftError}
        clearAircraftError={clearAircraftError}
        wsRequest={wsRequest}
        wsConnected={wsConnected}
        onToast={toastContext?.addToast}
        altProfileCanvasRef={altProfileCanvasRef}
        speedProfileCanvasRef={speedProfileCanvasRef}
        vsProfileCanvasRef={vsProfileCanvasRef}
        distProfileCanvasRef={distProfileCanvasRef}
        trackCanvasRef={trackCanvasRef}
        etaTarget={etaTarget}
        setEtaTarget={setEtaTarget}
        airports={aviationData.airports}
        setSelectedAirport={setSelectedAirport}
      />

      {/* ACARS Messages Panel */}
      {showAcarsPanel && (
        <AcarsInlinePanel
          acarsMessages={acarsMessages}
          acarsStatus={acarsStatus}
          acarsFilters={acarsFilters}
          setAcarsFilters={setAcarsFilters}
          aircraft={aircraft}
          callsignHexCache={callsignHexCache}
          setAircraftDetailHex={setAircraftDetailHex}
          onClose={() => setShowAcarsPanel(false)}
        />
      )}

      {/* Airspace Advisory Panel */}
      {config.mapMode === 'pro' && (
        <AirspaceAdvisoryPanel
          show={showAdvisoryPanel}
          onClose={() => setShowAdvisoryPanel(false)}
          advisories={airspaceAdvisories}
          loading={advisoriesLoading}
          error={advisoriesError}
          acknowledged={acknowledgedAdvisories}
          onAcknowledge={acknowledgeAdvisory}
          onUnacknowledge={unacknowledgeAdvisory}
          onShowOnMap={(adv) => {
            setSelectedAdvisoryId(adv.id);
            // Center map on advisory polygon centroid if available
            if (adv.polygon && adv.polygon.length > 0) {
              const lats = adv.polygon.map((p) => p[1]);
              const lons = adv.polygon.map((p) => p[0]);
              const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
              const centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;
              // Pan pro mode to show the advisory
              if (setProPanOffset) {
                const dx = (centerLon - feederLon) * 60; // rough nm conversion
                const dy = (feederLat - centerLat) * 60;
                setProPanOffset({ x: dx * 2, y: dy * 2 });
              }
            }
          }}
          onRefresh={refreshAdvisories}
          hazardFilter={advisoryHazardFilter}
          setHazardFilter={setAdvisoryHazardFilter}
          selectedAdvisoryId={selectedAdvisoryId}
          unacknowledgedCount={advisoryUnacknowledgedCount}
        />
      )}

      {/* NOTAM Panel */}
      {config.mapMode === 'pro' && (
        <NotamPanel
          show={showNotamPanel}
          onClose={() => setShowNotamPanel(false)}
          notams={visibleNotams}
          loading={notamsLoading}
          error={notamsError}
          acknowledged={acknowledgedNotams}
          onAcknowledge={acknowledgeNotam}
          onUnacknowledge={unacknowledgeNotam}
          onShowOnMap={(notam) => {
            setSelectedNotamId(notam.notam_id || notam.id);
            // Center map on NOTAM location if available
            if (notam.latitude && notam.longitude) {
              // Pan pro mode to show the NOTAM
              if (setProPanOffset) {
                const dx = (notam.longitude - feederLon) * 60; // rough nm conversion
                const dy = (feederLat - notam.latitude) * 60;
                setProPanOffset({ x: dx * 2, y: dy * 2 });
              }
            }
          }}
          onRefresh={refreshNotams}
          typeFilter={notamTypeFilter}
          setTypeFilter={setNotamTypeFilter}
          selectedNotamId={selectedNotamId}
          unacknowledgedCount={visibleUnacknowledgedCount}
        />
      )}

      {/* Highlight Groups Panel (Pro mode) */}
      {config.mapMode === 'pro' && highlightPanelVisible && (
        <HighlightGroupsPanel
          groups={highlightGroups}
          onToggle={toggleHighlightGroup}
          onAdd={addHighlightGroup}
          onRemove={removeHighlightGroup}
          onUpdate={updateHighlightGroup}
          onReorder={reorderHighlightGroups}
          onDisableAll={disableAllHighlights}
          onResetDefaults={resetHighlightDefaults}
          expanded={highlightPanelExpanded}
          onToggleExpanded={toggleHighlightPanelExpanded}
          onClose={() => setHighlightPanelVisible(false)}
          isProMode={true}
          aircraft={aircraft}
          groupCounts={getHighlightGroupCounts(aircraft)}
          position={highlightPanelPosition}
          isDragging={isHighlightPanelDragging}
          onMouseDown={onHighlightPanelMouseDown}
        />
      )}

      {/* Aircraft Sidebar (quick view) */}
      {sidebarAircraftHex && (
        <AircraftSidebar
          hex={sidebarAircraftHex}
          apiUrl={config.apiBaseUrl}
          onClose={() => openAircraftSidebar(null)}
          onOpenDetail={(hex) => openAircraftDetail(hex)}
          aircraft={aircraft.find((a) => a.hex === sidebarAircraftHex)}
          aircraftInfo={aircraftInfo[sidebarAircraftHex]}
          feederLocation={{ lat: feederLat, lon: feederLon }}
          wsRequest={wsRequest}
          wsConnected={wsConnected}
        />
      )}

      {/* Aircraft Detail Modal (full view with tabs) - V1/V2 based on config flag */}
      {aircraftDetailHex && (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div className="aircraft-detail-overlay" onClick={() => openAircraftDetail(null)}>
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div className="aircraft-detail-modal" onClick={(e) => e.stopPropagation()}>
            {config.useAircraftDetailV2 ? (
              <AircraftDetailV2
                hex={aircraftDetailHex}
                apiUrl={config.apiBaseUrl}
                onClose={() => openAircraftDetail(null)}
                onSelectAircraft={(newHex) => openAircraftDetail(newHex)}
                aircraft={aircraft.find((a) => a.hex === aircraftDetailHex)}
                aircraftInfo={aircraftInfo[aircraftDetailHex]}
                feederLocation={{ lat: feederLat, lon: feederLon }}
                wsRequest={wsRequest}
                wsConnected={wsConnected}
              />
            ) : (
              <AircraftDetailPage
                hex={aircraftDetailHex}
                apiUrl={config.apiBaseUrl}
                onClose={() => openAircraftDetail(null)}
                onSelectAircraft={(newHex) => openAircraftDetail(newHex)}
                aircraft={aircraft.find((a) => a.hex === aircraftDetailHex)}
                aircraftInfo={aircraftInfo[aircraftDetailHex]}
                feederLocation={{ lat: feederLat, lon: feederLon }}
                wsRequest={wsRequest}
                wsConnected={wsConnected}
              />
            )}
          </div>
        </div>
      )}

      {/* Phase 7.2: ARIA live region for screen reader announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        style={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          padding: 0,
          margin: '-1px',
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {/* Announce aircraft count */}
        {`${sortedAircraft.length} aircraft in view.`}
        {/* Announce selected aircraft */}
        {selectedAircraft &&
          ` Selected: ${selectedAircraft.flight?.trim() || selectedAircraft.hex}, altitude ${selectedAircraft.alt || 'unknown'} feet, speed ${selectedAircraft.gs || 'unknown'} knots.`}
        {/* Announce active safety alerts */}
        {safetyEvents.length > 0 &&
          ` ${safetyEvents.length} active safety alert${safetyEvents.length > 1 ? 's' : ''}.`}
      </div>

      {/* Phase 5.2: Data Block Configuration Panel */}
      {showDataBlockConfigPanel && (
        <DataBlockConfigPanel
          config={{
            mode: dataBlockConfig.compact ? 'compact' : 'full',
            fields: {
              altitude: dataBlockConfig.showAltitude,
              speed: dataBlockConfig.showSpeed,
              verticalSpeed: dataBlockConfig.showVerticalSpeed,
              heading: dataBlockConfig.showHeading,
              type: dataBlockConfig.showAircraftType,
              squawk: false,
              distance: false,
              wakeCategory: dataBlockConfig.showWakeCategory || false,
            },
          }}
          onUpdateField={(field, value) => {
            const fieldMap = {
              altitude: 'showAltitude',
              speed: 'showSpeed',
              verticalSpeed: 'showVerticalSpeed',
              heading: 'showHeading',
              type: 'showAircraftType',
              wakeCategory: 'showWakeCategory',
            };
            const configKey = fieldMap[field];
            if (configKey) {
              const newConfig = { ...dataBlockConfig, [configKey]: value };
              setDataBlockConfig(newConfig);
              localStorage.setItem('adsb-pro-datablock-config', JSON.stringify(newConfig));
            }
          }}
          onSetMode={(mode) => {
            const newConfig = {
              ...dataBlockConfig,
              compact: mode === 'compact',
            };
            setDataBlockConfig(newConfig);
            localStorage.setItem('adsb-pro-datablock-config', JSON.stringify(newConfig));
          }}
          onReset={() => {
            const defaults = {
              showCallsign: true,
              showAltitude: true,
              showSpeed: true,
              showHeading: false,
              showVerticalSpeed: false,
              showAircraftType: false,
              showWakeCategory: false,
              compact: false,
            };
            setDataBlockConfig(defaults);
            localStorage.setItem('adsb-pro-datablock-config', JSON.stringify(defaults));
          }}
          onClose={() => setShowDataBlockConfigPanel(false)}
          isPro={config.mapMode === 'pro'}
        />
      )}

      {/* Phase 9.3: Aircraft Context Menu */}
      <AircraftContextMenu
        isOpen={contextMenuState.isOpen}
        position={contextMenuState.position}
        aircraft={contextMenuState.aircraft}
        onClose={closeContextMenu}
        onAddNote={() => openNoteModal(contextMenuState.aircraft)}
        onTrack={() => {
          selectAircraft(contextMenuState.aircraft);
          closeContextMenu();
        }}
        hasNote={hasAircraftNote(contextMenuState.aircraft?.hex)}
        isTracking={selectedAircraft?.hex === contextMenuState.aircraft?.hex}
        isFavorite={isWatched(contextMenuState.aircraft?.hex)}
        onToggleFavorite={() => toggleWatchList(contextMenuState.aircraft)}
        hasCustomDataBlockPosition={hasCustomDataBlockOffset(contextMenuState.aircraft?.hex)}
        onResetDataBlockPosition={() => {
          resetDataBlockOffset(contextMenuState.aircraft?.hex);
          closeContextMenu();
        }}
      />

      {/* Phase 9.3: Note Input Modal */}
      <NoteInputModal
        isOpen={noteModalState.isOpen}
        onClose={closeNoteModal}
        onSave={handleSaveNote}
        onDelete={handleDeleteNote}
        aircraftId={noteModalState.aircraft?.flight?.trim() || noteModalState.aircraft?.hex}
        existingNote={
          noteModalState.aircraft?.hex ? getAircraftNote(noteModalState.aircraft.hex) : ''
        }
      />

      {/* Phase 13.1: Track Playback Controls for Pro Mode */}
      {config.mapMode === 'pro' && (
        <>
          <PlaybackIndicator
            isPlayback={isPlayback}
            formattedTime={playbackFormattedTime}
            isPlaying={isPlaying}
          />
          <PlaybackControls
            isPlayback={isPlayback}
            isPlaying={isPlaying}
            playbackTime={playbackTime}
            playbackSpeed={playbackSpeed}
            timeRange={playbackTimeRange}
            playbackPercent={playbackPercent}
            formattedTime={playbackFormattedTime}
            formattedDate={playbackFormattedDate}
            duration={playbackDuration}
            isLoading={playbackLoading}
            error={playbackError}
            historyStats={playbackStats}
            onEnterPlayback={enterPlayback}
            onExitPlayback={exitPlayback}
            onTogglePlayPause={togglePlayPause}
            onSpeedChange={setPlaybackSpeed}
            onSeekPercent={seekPlaybackPercent}
            onSkipToStart={skipPlaybackToStart}
            onSkipToEnd={skipPlaybackToEnd}
            onSkipForward={skipPlaybackForward}
            onSkipBackward={skipPlaybackBackward}
            onSetTimeRange={setPlaybackTimeRange}
            timeRangePresets={playbackTimeRangePresets}
            availableSpeeds={playbackAvailableSpeeds}
            proStyle={true}
          />
        </>
      )}

      {/* Phase 6: Keyboard Shortcut Help Overlay */}
      <KeyboardShortcutHelp isOpen={showKeyboardHelp} onClose={() => setShowKeyboardHelp(false)} />
    </div>
  );
}

export { MapView };
