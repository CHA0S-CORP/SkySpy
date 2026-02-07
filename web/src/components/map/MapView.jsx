import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Plane,
  Radio,
  MapPin,
  Filter,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  X,
  Shield,
  Bell,
  Zap,
  RefreshCw,
  AlertTriangle,
  Moon,
  Sun,
  Layers,
  ExternalLink,
  Wind,
  Snowflake,
  Thermometer,
  Navigation,
  HelpCircle,
  Compass,
  Volume2,
  VolumeX,
  Check,
  Menu,
  Crosshair,
  LocateFixed,
  Maximize2,
  Minimize2,
  MessageCircle,
  Settings2,
} from 'lucide-react';

// Import utilities
import {
  saveConfig,
  getOverlays,
  saveOverlays,
  getLayerOpacities,
  saveLayerOpacities,
  getTailInfo,
  decodeMetar,
  decodePirep,
  getPirepType,
  getPirepMaxSeverity,
  getPirepAgeMinutes,
  getAgeOpacity,
  formatPirepAltitude,
  windDirToCardinal,
  callsignsMatch,
  determineWakeCategory,
  getWakeCategoryColor,
  findMetarForAirport,
  getFlightCategoryColor,
  calculateCPA,
  formatTimeToCPA,
} from '../../utils';

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

// Import AircraftDetailPage and V2
import { AircraftDetailPage, AircraftDetailV2, AircraftSidebar } from '../aircraft';
import { useAircraftInfo } from '../../hooks/useAircraftInfo';
import { useToastContextSafe } from '../../hooks/useToast';
import { useAirspaceAdvisories, HAZARD_CONFIG } from '../../hooks/useAirspaceAdvisories';
import { AirspaceAdvisoryPanel } from './components/AirspaceAdvisoryPanel';
import { useNotams, NOTAM_TYPE_CONFIG } from '../../hooks/useNotams';
import { NotamPanel } from './components/NotamPanel';
import { KeyboardShortcutHelp } from './components/KeyboardShortcutHelp';
import { useDataBlockPositions, DATA_BLOCK_DEFAULT_X, DATA_BLOCK_DEFAULT_Y } from './hooks';
import { useHeatMap } from '../../hooks/useHeatMap';
import { HeatMapLayer } from './components/HeatMapLayer';
import { useWindsAloft, WINDS_ALOFT_LEVELS } from '../../hooks/useWindsAloft';
import { drawWindBarb, drawWindBarbs, drawWindsLevelIndicator } from './utils/windBarbs';
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
import { TafPopup } from './components/popups';
import { useAltitudeFilter } from '../../hooks/useAltitudeFilter';
import { AltitudeFilterPanel } from './components/AltitudeFilterPanel';
import { useMSAW } from '../../hooks/useMSAW';
import { useQuickFilters } from '../../hooks/useQuickFilters';
import { QuickFilterBar } from './components/QuickFilterBar';
import { useSessionStats } from '../../hooks/useSessionStats';
import { SessionStatsPanel, SessionStatsButton } from './components/SessionStatsPanel';
import { usePlaybackMode } from './hooks/usePlaybackMode';
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
  // Pro mode pan state (moved early for latLonToScreenMemo dependency)
  const [proPanOffset, setProPanOffset] = useState({ x: 0, y: 0 });
  const [isProPanning, setIsProPanning] = useState(false);
  const proPanStartRef = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });
  const proPanOffsetRef = useRef(proPanOffset);
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
  const [showOverlayMenu, setShowOverlayMenu] = useState(false);
  const [safetyEvents, setSafetyEvents] = useState([]); // Safety events from API/WebSocket
  const [acknowledgedEvents, setAcknowledgedEvents] = useState(new Set()); // Acknowledged event IDs
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
  const [acarsMessages, setAcarsMessages] = useState([]); // Live ACARS messages
  const [acarsStatus, setAcarsStatus] = useState(null); // ACARS service status
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
  const [callsignHexCache, setCallsignHexCache] = useState({}); // Callsign → ICAO hex cache for ACARS linking
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
    pruneStaleAircraft: _pruneStaleDataBlockPositions,
    customPositionCount: dataBlockCustomPositionCount,
    updateLastSeen: _updateDataBlockLastSeen,
    maybeDeconflict,
    autoDeconflictEnabled,
  } = useDataBlockPositions();

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

  // Quick alert creation state for pro panel
  const [_quickAlertLoading, setQuickAlertLoading] = useState(null); // 'callsign' | 'registration' | null
  const [quickAlertsCreated, setQuickAlertsCreated] = useState({}); // Track created alerts

  // Create quick alert rule helper
  const _createQuickAlert = useCallback(
    async (type, value, displayName) => {
      if (!wsRequest || !wsConnected) {
        console.warn('[Quick Alert] Not connected to server');
        toastContext?.error?.('Not connected to server');
        return;
      }

      const key = `${type}:${value}`;
      if (quickAlertsCreated[key]) {
        console.info(`[Quick Alert] Alert for ${displayName} already exists`);
        toastContext?.info?.(`Alert for ${displayName} already exists`);
        return;
      }

      setQuickAlertLoading(type);
      try {
        const payload = {
          name: `Alert for ${displayName}`,
          description: `Quick alert created for ${type === 'callsign' ? 'callsign' : 'registration'} ${value}`,
          priority: 'info',
          enabled: true,
          conditions: {
            logic: 'AND',
            groups: [
              {
                logic: 'AND',
                conditions: [
                  {
                    type,
                    operator: 'eq',
                    value,
                  },
                ],
              },
            ],
          },
          cooldown_minutes: 5,
        };

        const result = await wsRequest('alert-rule-create', payload);
        if (result?.error) {
          throw new Error(result.error);
        }

        setQuickAlertsCreated((prev) => ({ ...prev, [key]: true }));
        console.info(`[Quick Alert] Alert created for ${displayName}`);
        toastContext?.success?.(`Alert created for ${displayName}`);
      } catch (err) {
        console.error('[Quick Alert] Failed to create alert:', err);
        toastContext?.error?.(err.message || 'Failed to create alert');
      } finally {
        setQuickAlertLoading(null);
      }
    },
    [wsRequest, wsConnected, toastContext, quickAlertsCreated]
  );

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
  const [proPhotoError, setProPhotoError] = useState(false); // Track photo loading errors for Pro panel
  const [proPhotoRetry, setProPhotoRetry] = useState(0); // Retry counter for pro panel photo
  const [proPhotoUrl, setProPhotoUrl] = useState(null); // S3 URL for pro panel photo
  const [proPhotoLoading, setProPhotoLoading] = useState(true); // Track photo loading state for Pro panel
  const [proPhotoStatus, setProPhotoStatus] = useState(null); // Status message for photo retry
  const proPhotoRetryRef = useRef(null); // Ref for retry interval

  // Helper to resolve photo URLs (handles relative API paths for cross-origin dev setups)
  const resolvePhotoUrl = useCallback(
    (url) => {
      if (!url) return null;
      // If URL starts with /api/, prefix with apiBaseUrl
      if (url.startsWith('/api/')) {
        return `${config.apiBaseUrl || ''}${url}`;
      }
      return url;
    },
    [config.apiBaseUrl]
  );

  // Phase 4.4: Individual layer opacity controls (0.0 - 1.0)
  const [layerOpacities, setLayerOpacities] = useState(getLayerOpacities);

  // Popup drag state
  const [popupPosition, setPopupPosition] = useState({ x: 16, y: 16 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, startX: 0, startY: 0 });

  // Legend drag state
  const [legendPosition, setLegendPosition] = useState({ x: null, y: null }); // null means use default CSS position
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

  // Phase 3.4: Conflict Probe (Look-Ahead) - collapsed state only (main state moved earlier)
  const [_conflictProbeCollapsed, setConflictProbeCollapsed] = useState(
    () => localStorage.getItem('adsb-pro-conflict-probe-collapsed') === 'true'
  ); // default expanded

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
  const fpsRef = useRef({ frames: 0, lastTime: Date.now(), fps: 0 });

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

  // Refs for cursor tracking
  const cursorPosRef = useRef({ x: 0, y: 0 });
  const lastHoverCheckRef = useRef(0);

  const [followingAircraft, setFollowingAircraft] = useState(null); // ICAO hex of aircraft to follow

  // Keep pan offset ref in sync
  useEffect(() => {
    proPanOffsetRef.current = proPanOffset;
  }, [proPanOffset]);

  // Animated pan-to function (easeOutCubic over ~250ms)
  const animRef = useRef(null);
  const animatePanTo = useCallback((targetX, targetY) => {
    // Cancel any existing animation
    if (animRef.current) {
      cancelAnimationFrame(animRef.current.rafId);
      animRef.current = null;
    }

    const startX = proPanOffsetRef.current.x;
    const startY = proPanOffsetRef.current.y;
    const startTime = performance.now();
    const duration = 250; // ms

    const step = (now) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      // easeOutCubic: 1 - (1 - t)^3
      const eased = 1 - Math.pow(1 - t, 3);

      const x = startX + (targetX - startX) * eased;
      const y = startY + (targetY - startY) * eased;
      setProPanOffset({ x, y });

      if (t >= 1) {
        setProPanOffset({ x: targetX, y: targetY });
        animRef.current = null;
      } else {
        animRef.current.rafId = requestAnimationFrame(step);
      }
    };

    animRef.current = { rafId: requestAnimationFrame(step) };
  }, []);

  // Cleanup animation on unmount
  useEffect(() => {
    return () => {
      if (animRef.current) {
        cancelAnimationFrame(animRef.current.rafId);
        animRef.current = null;
      }
    };
  }, []);

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
  const _centerUpdateTimeoutRef = useRef(null);

  // Ref to always have access to latest setHashParams in event handlers
  const setHashParamsRef = useRef(setHashParams);
  useEffect(() => {
    setHashParamsRef.current = setHashParams;
  }, [setHashParams]);

  const mapRef = useRef(null);
  const leafletMapRef = useRef(null);
  const markersRef = useRef({});
  const shortTrackPolylinesRef = useRef({}); // Leaflet polylines for short tracks in map mode
  const feederMarkerRef = useRef(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const animationRef = useRef(null);
  const sweepAngleRef = useRef(0);
  const historyRef = useRef({}); // Store position history for trails
  const trackHistoryRef = useRef({}); // Store track/heading history for turn rate calculation
  const pinchStateRef = useRef({
    lastDistance: 0,
    startRange: 0,
    lastCenterX: 0,
    lastCenterY: 0,
    startPanX: 0,
    startPanY: 0,
  }); // For smooth pinch-to-zoom and two-finger pan
  const _conflictsRef = useRef([]); // Track conflicts for banner
  const shortTrackFetchedRef = useRef(new Map()); // Track which aircraft have had history fetched (hex -> timestamp)
  const prevAircraftIcaosRef = useRef(new Set()); // Track previous aircraft ICAOs for auto-lookup on sighting

  // Pro panel canvas refs
  const trackCanvasRef = useRef(null);
  const altProfileCanvasRef = useRef(null);
  const speedProfileCanvasRef = useRef(null);
  const vsProfileCanvasRef = useRef(null);
  const distProfileCanvasRef = useRef(null);

  // Pro panel distance trend tracking
  const _proPrevDistanceRef = useRef(null);
  const _proDistanceTrendRef = useRef(null); // 'approaching', 'receding', or 'stable'
  const _proTrackedAircraftRef = useRef(null); // Track which aircraft we're monitoring

  // Notification tracking refs
  const notifiedConflictsRef = useRef(new Set()); // Track notified conflict pairs
  const notifiedEmergenciesRef = useRef(new Set()); // Track notified emergency aircraft
  const autoAckScheduledRef = useRef(new Set()); // Track events with scheduled auto-acknowledge
  const _alarmAudioRef = useRef(null); // Audio element for conflict alarm
  const alarmPlayingRef = useRef(false); // Track if alarm is currently playing
  const alarmIntervalRef = useRef(null); // Interval for looping alarm

  // Refs to access latest feeder location in event handlers
  const feederLatRef = useRef(feederLat);
  const feederLonRef = useRef(feederLon);
  useEffect(() => {
    feederLatRef.current = feederLat;
    feederLonRef.current = feederLon;
  }, [feederLat, feederLon]);

  // Sync map settings from URL hash params on mount
  const VALID_MODES = ['radar', 'crt', 'pro', 'map'];
  useEffect(() => {
    const newConfig = { ...config };
    let configChanged = false;

    // Sync mode from URL
    if (
      hashParams.mode &&
      VALID_MODES.includes(hashParams.mode) &&
      hashParams.mode !== config.mapMode
    ) {
      newConfig.mapMode = hashParams.mode;
      configChanged = true;
    }

    // Sync dark mode from URL
    if (hashParams.dark !== undefined) {
      const darkMode = hashParams.dark === '1' || hashParams.dark === 'true';
      if (darkMode !== config.mapDarkMode) {
        newConfig.mapDarkMode = darkMode;
        configChanged = true;
      }
    }

    if (configChanged) {
      setConfig(newConfig);
      saveConfig(newConfig);
    }

    // Sync range from URL
    if (hashParams.range) {
      const range = parseInt(hashParams.range, 10);
      if (!isNaN(range) && range >= 5 && range <= 250 && range !== radarRange) {
        setRadarRange(range);
      }
    }

    // Sync overlays from URL (comma-separated list of enabled overlays)
    if (hashParams.overlays) {
      const enabledOverlays = hashParams.overlays.split(',').map((s) => s.trim());
      const newOverlays = { ...overlays };
      Object.keys(newOverlays).forEach((key) => {
        newOverlays[key] = enabledOverlays.includes(key);
      });
      setOverlays(newOverlays);
      saveOverlays(newOverlays);
    }

    // Sync traffic filters from URL (comma-separated list of enabled filters + altitude range)
    if (hashParams.filters || hashParams.minAlt !== undefined || hashParams.maxAlt !== undefined) {
      const newFilters = { ...trafficFilters };

      if (hashParams.filters) {
        const enabledFilters = hashParams.filters.split(',').map((s) => s.trim());
        // Boolean filter keys
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
        boolKeys.forEach((key) => {
          newFilters[key] = enabledFilters.includes(key);
        });
      }

      if (hashParams.minAlt !== undefined) {
        const minAlt = parseInt(hashParams.minAlt, 10);
        if (!isNaN(minAlt) && minAlt >= 0) {
          newFilters.minAltitude = minAlt;
        }
      }

      if (hashParams.maxAlt !== undefined) {
        const maxAlt = parseInt(hashParams.maxAlt, 10);
        if (!isNaN(maxAlt) && maxAlt >= 0) {
          newFilters.maxAltitude = maxAlt;
        }
      }

      setTrafficFilters(newFilters);
    }

    // If no mode in URL, set current mode to URL
    if (!hashParams.mode && setHashParams && config.mapMode) {
      setHashParams({ mode: config.mapMode });
    }

    // If no overlays in URL, set current overlays to URL
    if (!hashParams.overlays && setHashParams) {
      const enabledOverlays = Object.entries(overlays)
        .filter(([, enabled]) => enabled)
        .map(([key]) => key)
        .join(',');
      if (enabledOverlays) {
        setHashParams({ overlays: enabledOverlays });
      }
    }

    // If no filters in URL, set current filters to URL
    if (!hashParams.filters && setHashParams) {
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
      const enabledFilters = boolKeys.filter((key) => trafficFilters[key]).join(',');
      setHashParams({
        filters: enabledFilters || undefined,
        minAlt: trafficFilters.minAltitude !== 0 ? String(trafficFilters.minAltitude) : undefined,
        maxAlt:
          trafficFilters.maxAltitude !== 60000 ? String(trafficFilters.maxAltitude) : undefined,
      });
    }

    // Open aircraft detail from URL if specified
    if (hashParams.aircraft) {
      setAircraftDetailHex(hashParams.aircraft);
    }

    // Store initial center/zoom from URL to apply when map initializes
    if (hashParams.lat && hashParams.lon) {
      const lat = parseFloat(hashParams.lat);
      const lon = parseFloat(hashParams.lon);
      if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        initialCenterRef.current = { lat, lon };
      }
    }
    if (hashParams.zoom) {
      const zoom = parseInt(hashParams.zoom, 10);
      if (!isNaN(zoom) && zoom >= 1 && zoom <= 20) {
        initialZoomRef.current = zoom;
      }
    }

    // Restore pro/crt mode pan offset from URL
    if (hashParams.panX && hashParams.panY) {
      const panX = parseInt(hashParams.panX, 10);
      const panY = parseInt(hashParams.panY, 10);
      if (!isNaN(panX) && !isNaN(panY)) {
        setProPanOffset({ x: panX, y: panY });
      }
    }
  }, []); // Only run on mount

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

  // Send browser notification helper
  const sendNotification = useCallback(
    (title, body, tag, urgent = false) => {
      // Always log to console for debugging/testing
      console.log(`[SkySpy Notification] ${title}: ${body}`);

      if (typeof Notification === 'undefined') {
        console.warn('Notifications not supported in this browser');
        return;
      }

      if (Notification.permission !== 'granted') {
        console.warn('Notification permission not granted');
        return;
      }

      if (!config.browserNotifications) {
        console.log('Browser notifications disabled in settings');
        return;
      }

      try {
        const notif = new Notification(title, {
          body,
          icon: '/static/favicon.svg',
          tag,
          requireInteraction: urgent,
          silent: false,
        });

        // Auto-close non-urgent notifications after 10 seconds
        if (!urgent) {
          setTimeout(() => notif.close(), 10000);
        }
      } catch (e) {
        console.warn('Notification failed:', e);
      }
    },
    [config.browserNotifications]
  );

  // Audio context ref - created on first user interaction
  const audioContextRef = useRef(null);

  // Initialize audio context on user interaction
  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume if suspended (browser autoplay policy)
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  // Play Stage 1 alarm - double ding (low severity) - yellow
  const playAlarmStage1 = useCallback(() => {
    if (soundMuted || alarmPlayingRef.current) return;

    try {
      const audioCtx = initAudioContext();
      if (!audioCtx) return;

      const now = audioCtx.currentTime;

      const playDing = (startTime) => {
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.connect(gain1);
        gain1.connect(audioCtx.destination);
        osc1.frequency.value = 2200;
        osc1.type = 'sine';

        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);
        osc2.frequency.value = 3300;
        osc2.type = 'sine';

        const osc3 = audioCtx.createOscillator();
        const gain3 = audioCtx.createGain();
        osc3.connect(gain3);
        gain3.connect(audioCtx.destination);
        osc3.frequency.value = 1100;
        osc3.type = 'sine';

        const peakTime = startTime + 0.01;
        const endTime = startTime + 0.4;

        gain1.gain.setValueAtTime(0, startTime);
        gain1.gain.linearRampToValueAtTime(0.25, peakTime);
        gain1.gain.exponentialRampToValueAtTime(0.001, endTime);

        gain2.gain.setValueAtTime(0, startTime);
        gain2.gain.linearRampToValueAtTime(0.1, peakTime);
        gain2.gain.exponentialRampToValueAtTime(0.001, startTime + 0.2);

        gain3.gain.setValueAtTime(0, startTime);
        gain3.gain.linearRampToValueAtTime(0.08, peakTime);
        gain3.gain.exponentialRampToValueAtTime(0.001, endTime);

        osc1.start(startTime);
        osc1.stop(endTime);
        osc2.start(startTime);
        osc2.stop(startTime + 0.2);
        osc3.start(startTime);
        osc3.stop(endTime);
      };

      // Play two dings
      playDing(now);
      playDing(now + 0.5);

      alarmPlayingRef.current = true;
      setTimeout(() => {
        alarmPlayingRef.current = false;
      }, 1200);
    } catch (e) {
      console.warn('Could not play alarm sound:', e);
    }
  }, [soundMuted, initAudioContext]);

  // Play Stage 2 alarm - rapid triple ding (warning severity) - orange
  const playAlarmStage2 = useCallback(() => {
    if (soundMuted || alarmPlayingRef.current) return;

    try {
      const audioCtx = initAudioContext();
      if (!audioCtx) return;

      const now = audioCtx.currentTime;

      const playDing = (startTime) => {
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.connect(gain1);
        gain1.connect(audioCtx.destination);
        osc1.frequency.value = 2200;
        osc1.type = 'sine';

        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);
        osc2.frequency.value = 3300;
        osc2.type = 'sine';

        const osc3 = audioCtx.createOscillator();
        const gain3 = audioCtx.createGain();
        osc3.connect(gain3);
        gain3.connect(audioCtx.destination);
        osc3.frequency.value = 1100;
        osc3.type = 'sine';

        const peakTime = startTime + 0.008;
        const endTime = startTime + 0.25;

        gain1.gain.setValueAtTime(0, startTime);
        gain1.gain.linearRampToValueAtTime(0.3, peakTime);
        gain1.gain.exponentialRampToValueAtTime(0.001, endTime);

        gain2.gain.setValueAtTime(0, startTime);
        gain2.gain.linearRampToValueAtTime(0.12, peakTime);
        gain2.gain.exponentialRampToValueAtTime(0.001, startTime + 0.12);

        gain3.gain.setValueAtTime(0, startTime);
        gain3.gain.linearRampToValueAtTime(0.1, peakTime);
        gain3.gain.exponentialRampToValueAtTime(0.001, endTime);

        osc1.start(startTime);
        osc1.stop(endTime);
        osc2.start(startTime);
        osc2.stop(startTime + 0.12);
        osc3.start(startTime);
        osc3.stop(endTime);
      };

      // Play three rapid dings
      playDing(now);
      playDing(now + 0.2);
      playDing(now + 0.4);

      alarmPlayingRef.current = true;
      setTimeout(() => {
        alarmPlayingRef.current = false;
      }, 800);
    } catch (e) {
      console.warn('Could not play alarm sound:', e);
    }
  }, [soundMuted, initAudioContext]);

  // Play Stage 3 alarm - high-low siren (critical severity) - pink
  const playAlarmStage3 = useCallback(() => {
    if (soundMuted || alarmPlayingRef.current) return;

    try {
      const audioCtx = initAudioContext();
      if (!audioCtx) return;

      const now = audioCtx.currentTime;

      const playTone = (startTime, freq, duration) => {
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.connect(gain1);
        gain1.connect(audioCtx.destination);
        osc1.frequency.value = freq;
        osc1.type = 'sine';

        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);
        osc2.frequency.value = freq * 1.5;
        osc2.type = 'sine';

        const peakTime = startTime + 0.02;
        const endTime = startTime + duration;

        gain1.gain.setValueAtTime(0, startTime);
        gain1.gain.linearRampToValueAtTime(0.35, peakTime);
        gain1.gain.setValueAtTime(0.35, endTime - 0.05);
        gain1.gain.linearRampToValueAtTime(0, endTime);

        gain2.gain.setValueAtTime(0, startTime);
        gain2.gain.linearRampToValueAtTime(0.15, peakTime);
        gain2.gain.setValueAtTime(0.15, endTime - 0.05);
        gain2.gain.linearRampToValueAtTime(0, endTime);

        osc1.start(startTime);
        osc1.stop(endTime);
        osc2.start(startTime);
        osc2.stop(endTime);
      };

      // High-low-high-low pattern
      playTone(now, 1800, 0.25); // High
      playTone(now + 0.25, 1200, 0.25); // Low
      playTone(now + 0.5, 1800, 0.25); // High
      playTone(now + 0.75, 1200, 0.25); // Low

      alarmPlayingRef.current = true;
      setTimeout(() => {
        alarmPlayingRef.current = false;
      }, 1200);
    } catch (e) {
      console.warn('Could not play alarm sound:', e);
    }
  }, [soundMuted, initAudioContext]);

  // Play alarm based on severity
  const playConflictAlarm = useCallback(
    (severity = 'low') => {
      switch (severity) {
        case 'critical':
          playAlarmStage3();
          break;
        case 'warning':
          playAlarmStage2();
          break;
        default:
          playAlarmStage1();
      }
    },
    [playAlarmStage1, playAlarmStage2, playAlarmStage3]
  );

  // Get highest severity from active events
  const getHighestSeverity = useCallback((events) => {
    if (events.some((e) => e.severity === 'critical')) return 'critical';
    if (events.some((e) => e.severity === 'warning')) return 'warning';
    return 'low';
  }, []);

  // Start looping alarm for unacknowledged events
  const startAlarmLoop = useCallback(
    (severity = 'low') => {
      if (alarmIntervalRef.current || soundMuted) return;

      playConflictAlarm(severity);

      // Determine loop interval based on severity
      const interval = severity === 'critical' ? 1500 : severity === 'warning' ? 2500 : 3000;

      alarmIntervalRef.current = setInterval(() => {
        playConflictAlarm(severity);
      }, interval);
    },
    [playConflictAlarm, soundMuted]
  );

  // Stop the alarm loop
  const stopAlarmLoop = useCallback(() => {
    if (alarmIntervalRef.current) {
      clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    }
  }, []);

  // Acknowledge a safety event via API and update local state
  const acknowledgeEvent = useCallback(
    async (eventId) => {
      const baseUrl = config.apiBaseUrl || '';

      // Stop audio immediately regardless of API result
      stopAlarmLoop();

      // Update local state immediately for UI feedback
      setAcknowledgedEvents((prev) => new Set([...prev, eventId]));

      // Try to persist to API (fire-and-forget, don't block on failure)
      try {
        await fetch(`${baseUrl}/api/v1/safety/active/${encodeURIComponent(eventId)}/acknowledge`, {
          method: 'POST',
        });
      } catch (err) {
        console.error('Failed to acknowledge event via API:', err);
        // Audio is already stopped and UI is updated, so this is just a log
      }
    },
    [config.apiBaseUrl, stopAlarmLoop]
  );

  // Save sound muted preference and stop alarm if muted
  useEffect(() => {
    localStorage.setItem('adsb-sound-muted', soundMuted.toString());
    if (soundMuted) {
      stopAlarmLoop();
    }
  }, [soundMuted, stopAlarmLoop]);

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
          console.log('Wake lock acquired');
        } catch (err) {
          console.log('Wake lock request failed:', err.message);
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
          console.log('Wake lock released');
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

  // Reset photo state and fetch/cache S3 URL when selected aircraft changes
  useEffect(() => {
    // Clear any existing retry loop when aircraft changes
    if (proPhotoRetryRef.current) {
      clearInterval(proPhotoRetryRef.current);
      proPhotoRetryRef.current = null;
    }

    setProPhotoError(false);
    setProPhotoRetry(0);
    setProPhotoUrl(null);
    setProPhotoLoading(true);
    setProPhotoStatus(null);

    if (selectedAircraft?.hex) {
      const fetchPhoto = async () => {
        try {
          // Use WebSocket if available, otherwise fall back to HTTP
          if (wsRequest && wsConnected) {
            const data = await wsRequest('photo-cache', { icao: selectedAircraft.hex });
            if (data?.photo_url) {
              setProPhotoUrl(resolvePhotoUrl(data.photo_url));
            } else if (data?.photo_thumbnail_url || data?.thumbnail_url) {
              setProPhotoUrl(resolvePhotoUrl(data.photo_thumbnail_url || data.thumbnail_url));
            } else if (data?.error) {
              console.debug('Photo cache WS error:', data.error);
              setProPhotoError(true);
              setProPhotoLoading(false);
            } else {
              // No photo URL returned
              console.debug('Photo cache WS: no URL in response', data);
              setProPhotoError(true);
              setProPhotoLoading(false);
            }
          } else {
            // Fallback to HTTP GET from airframes endpoint
            const res = await fetch(
              `${config.apiBaseUrl || ''}/api/v1/airframes/${selectedAircraft.hex}/photos`
            );
            const data = await safeJson(res);
            if (data) {
              if (data?.photo_url) {
                setProPhotoUrl(resolvePhotoUrl(data.photo_url));
              } else if (data?.photo_thumbnail_url || data?.thumbnail_url) {
                setProPhotoUrl(resolvePhotoUrl(data.photo_thumbnail_url || data.thumbnail_url));
              } else {
                setProPhotoError(true);
                setProPhotoLoading(false);
              }
            } else {
              setProPhotoError(true);
              setProPhotoLoading(false);
            }
          }
        } catch (err) {
          console.debug('Photo cache error:', err);
          setProPhotoError(true);
          setProPhotoLoading(false);
        }
      };
      fetchPhoto();
    }
  }, [selectedAircraft?.hex, config.apiBaseUrl, wsRequest, wsConnected, resolvePhotoUrl]);

  // Merge WebSocket safety events with local state
  useEffect(() => {
    if (wsSafetyEvents && wsSafetyEvents.length > 0) {
      setSafetyEvents((prev) => {
        const existingIds = new Set(prev.map((e) => e.id));
        const newEvents = wsSafetyEvents.filter((e) => !existingIds.has(e.id));
        if (newEvents.length === 0) return prev;
        return [...newEvents, ...prev].slice(0, 50);
      });
    }
  }, [wsSafetyEvents]);

  // Fetch safety events via WebSocket with HTTP fallback
  useEffect(() => {
    const baseUrl = config.apiBaseUrl || '';

    const fetchSafetyEvents = async () => {
      try {
        let data;
        if (wsRequest && wsConnected) {
          data = await wsRequest('safety-events', { limit: 20 });
        } else {
          // HTTP fallback
          const res = await fetch(`${baseUrl}/api/v1/safety/events?limit=20`);
          data = await safeJson(res);
        }
        const events = Array.isArray(data) ? data : data?.data || data?.events || [];
        if (events.length > 0) {
          setSafetyEvents((prev) => {
            const existingIds = new Set(prev.map((e) => e.id));
            const newEvents = events.filter((e) => !existingIds.has(e.id));
            if (newEvents.length === 0) return prev;
            return [...newEvents, ...prev].slice(0, 50);
          });
        }
      } catch (err) {
        // Silent fail - real-time push is primary
        console.warn('Safety events fetch failed:', err.message);
      }
    };

    // Fetch on mount and periodically
    fetchSafetyEvents();
    // Refresh every 60 seconds when WebSocket connected, 30 seconds for HTTP
    const pollInterval = wsConnected ? 60000 : 30000;
    const interval = setInterval(fetchSafetyEvents, pollInterval);
    return () => clearInterval(interval);
  }, [wsRequest, wsConnected, config.apiBaseUrl]);

  // Convert safety events to conflict format for display with LIVE separation data
  const activeConflicts = useMemo(() => {
    // Get unacknowledged safety events (last 60 seconds)
    const cutoff = Date.now() - 60000;
    return safetyEvents
      .filter((event) => {
        if (acknowledgedEvents.has(event.id)) return false;
        const eventTime = new Date(event.timestamp).getTime();
        return eventTime > cutoff;
      })
      .map((event) => {
        // Try to calculate live separation if both aircraft are available
        let horizontalNm = event.details?.horizontal_nm?.toFixed(1) || '--';
        let verticalFt = event.details?.vertical_ft || event.details?.altitude || '--';

        // For two-aircraft events (like proximity_conflict, tcas_ra), calculate live values
        if (event.icao && event.icao_2) {
          const ac1 = aircraft.find((a) => a.hex?.toLowerCase() === event.icao?.toLowerCase());
          const ac2 = aircraft.find((a) => a.hex?.toLowerCase() === event.icao_2?.toLowerCase());

          if (ac1?.lat && ac1?.lon && ac2?.lat && ac2?.lon) {
            // Calculate horizontal distance between aircraft
            const dLat = (ac2.lat - ac1.lat) * 60; // nm
            const dLon = (ac2.lon - ac1.lon) * 60 * Math.cos((ac1.lat * Math.PI) / 180); // nm
            horizontalNm = Math.sqrt(dLat * dLat + dLon * dLon).toFixed(1);
          }

          if (ac1?.alt && ac2?.alt) {
            verticalFt = Math.round(Math.abs(ac2.alt - ac1.alt));
          }
        }
        // For single-aircraft events (extreme_vs, rapid_descent, etc.), show current altitude/vs
        else if (event.icao) {
          const ac = aircraft.find((a) => a.hex?.toLowerCase() === event.icao?.toLowerCase());
          if (ac?.alt) {
            verticalFt = Math.round(ac.alt);
          }
          // For V/S events, show current vertical rate
          if (
            event.event_type?.includes('vs') ||
            event.event_type?.includes('descent') ||
            event.event_type?.includes('climb')
          ) {
            const vs = ac?.baro_rate || ac?.geom_rate;
            if (vs !== undefined) {
              verticalFt = `${vs > 0 ? '+' : ''}${Math.round(vs)} fpm`;
            }
          }
        }

        return {
          ...event,
          ac1: event.callsign || event.icao,
          ac2: event.callsign_2 || event.icao_2 || null,
          hex1: event.icao,
          hex2: event.icao_2,
          horizontalNm,
          verticalFt,
        };
      });
  }, [safetyEvents, acknowledgedEvents, aircraft]);

  // Monitor for new safety events and trigger alarms/notifications
  useEffect(() => {
    // Get unacknowledged events
    const unacknowledged = activeConflicts.filter((event) => !acknowledgedEvents.has(event.id));

    if (unacknowledged.length > 0) {
      const severity = getHighestSeverity(unacknowledged);

      // For low severity, play alarm twice then auto-acknowledge
      if (severity === 'low') {
        // Play alarm, then auto-acknowledge after 4 seconds
        stopAlarmLoop();
        playConflictAlarm('low');
        setTimeout(() => {
          playConflictAlarm('low');
        }, 1500);

        // Auto-acknowledge low severity events after 5 seconds (only if not already scheduled)
        unacknowledged.forEach((e) => {
          if (e.severity === 'low' && !autoAckScheduledRef.current.has(e.id)) {
            autoAckScheduledRef.current.add(e.id);
            setTimeout(() => {
              acknowledgeEvent(e.id);
            }, 5000);
          }
        });
      } else {
        // For warning/critical, loop until acknowledged
        startAlarmLoop(severity);
      }
    } else {
      stopAlarmLoop();
    }

    // Send browser notifications for NEW events and auto-focus on critical/warning
    activeConflicts.forEach((event) => {
      const eventKey = `safety-${event.id}`;

      if (!notifiedConflictsRef.current.has(eventKey)) {
        notifiedConflictsRef.current.add(eventKey);

        const severityEmoji =
          event.severity === 'critical' ? '🚨' : event.severity === 'warning' ? '⚠️' : '🔔';
        const title = `${severityEmoji} ${event.event_type.replace(/_/g, ' ').toUpperCase()}`;

        sendNotification(
          title,
          event.message || `${event.callsign} - ${event.event_type}`,
          eventKey,
          event.severity === 'critical'
        );
      }
    });

    // Cleanup on unmount
    return () => {
      stopAlarmLoop();
    };
  }, [
    activeConflicts,
    acknowledgedEvents,
    acknowledgeEvent,
    getHighestSeverity,
    playConflictAlarm,
    sendNotification,
    startAlarmLoop,
    stopAlarmLoop,
    aircraft,
  ]);

  // Monitor for emergency squawks and send notifications
  useEffect(() => {
    const emergencySquawks = { 7500: 'HIJACK', 7600: 'RADIO FAILURE', 7700: 'EMERGENCY' };

    aircraft.forEach((ac) => {
      const isEmergency = ac.emergency || emergencySquawks[ac.squawk];
      if (!isEmergency) return;

      const emergencyKey = `${ac.hex}-${ac.squawk}`;
      if (!notifiedEmergenciesRef.current.has(emergencyKey)) {
        notifiedEmergenciesRef.current.add(emergencyKey);

        const callsign = ac.flight?.trim() || ac.hex;
        const meaning = emergencySquawks[ac.squawk] || 'EMERGENCY';

        sendNotification(
          `🚨 ${meaning}`,
          `${callsign} squawking ${ac.squawk || 'emergency'}\nAlt: ${ac.alt?.toLocaleString() || '?'}ft`,
          `emergency-${emergencyKey}`,
          true
        );
      }
    });

    // Clean up old emergencies after aircraft no longer in emergency state
    const currentEmergencyHexes = new Set(
      aircraft.filter((ac) => ac.emergency || emergencySquawks[ac.squawk]).map((ac) => ac.hex)
    );
    notifiedEmergenciesRef.current.forEach((key) => {
      const hex = key.split('-')[0];
      if (!currentEmergencyHexes.has(hex)) {
        // Allow re-notification after 10 min
        setTimeout(() => notifiedEmergenciesRef.current.delete(key), 600000);
      }
    });
  }, [aircraft, sendNotification]);

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

  // Fetch ACARS status via WebSocket (with HTTP fallback)
  // Reduced polling when socket is connected since we get real-time updates
  useEffect(() => {
    const fetchAcarsStatus = async () => {
      // Use WebSocket exclusively when connected to reduce HTTP calls
      if (wsRequest && wsConnected) {
        try {
          const data = await wsRequest('acars-status', {});
          if (data && !data.error) {
            setAcarsStatus(data);
            return;
          }
        } catch (err) {
          // Socket failed, don't fall back - will retry on next interval
          console.debug('ACARS status WS request failed:', err.message);
          return;
        }
      }

      // HTTP fallback only when socket is not connected
      if (!wsConnected) {
        const baseUrl = config.apiBaseUrl || '';
        try {
          const statusRes = await fetch(`${baseUrl}/api/v1/acars/status`);
          const statusData = await safeJson(statusRes);
          if (statusData) setAcarsStatus(statusData);
        } catch (err) {
          // Silently fail - ACARS may not be available
        }
      }
    };

    fetchAcarsStatus();
    // Much longer interval when socket connected (30s vs 10s)
    const pollInterval = wsConnected ? 30000 : 10000;
    const interval = setInterval(fetchAcarsStatus, pollInterval);
    return () => clearInterval(interval);
  }, [config.apiBaseUrl, wsRequest, wsConnected]);

  // Use real-time ACARS messages from socket when connected
  useEffect(() => {
    if (wsConnected && wsAcarsMessages && wsAcarsMessages.length > 0) {
      setAcarsMessages(wsAcarsMessages);
    }
  }, [wsConnected, wsAcarsMessages]);

  // Fetch initial ACARS history once when panel opens (socket doesn't provide history)
  const acarsInitialFetchRef = useRef(false);
  useEffect(() => {
    if (!showAcarsPanel) {
      acarsInitialFetchRef.current = false;
      return;
    }
    if (acarsInitialFetchRef.current) return;

    const fetchInitialAcars = async () => {
      const baseUrl = config.apiBaseUrl || '';
      try {
        // Django API uses /api/v1/acars (was /api/v1/acars/messages/recent)
        const msgRes = await fetch(`${baseUrl}/api/v1/acars?limit=50`);
        const msgData = await safeJson(msgRes);
        if (msgData) {
          setAcarsMessages(
            msgData.messages || msgData.results || (Array.isArray(msgData) ? msgData : [])
          );
          acarsInitialFetchRef.current = true;
        }
      } catch (err) {
        console.log('ACARS messages fetch error:', err.message);
      }
    };

    fetchInitialAcars();
  }, [showAcarsPanel, config.apiBaseUrl]);

  // HTTP fallback polling only when socket is not connected
  useEffect(() => {
    if (!showAcarsPanel || wsConnected) return;

    const fetchAcarsMessages = async () => {
      const baseUrl = config.apiBaseUrl || '';
      try {
        // Django API uses /api/v1/acars (was /api/v1/acars/messages/recent)
        const msgRes = await fetch(`${baseUrl}/api/v1/acars?limit=50`);
        const data = await safeJson(msgRes);
        if (data) {
          setAcarsMessages(data.messages || data.results || (Array.isArray(data) ? data : []));
        }
      } catch (err) {
        console.log('ACARS messages fetch error:', err.message);
      }
    };

    const interval = setInterval(fetchAcarsMessages, 10000);
    return () => clearInterval(interval);
  }, [showAcarsPanel, config.apiBaseUrl, wsConnected]);

  // Lookup hex values from history API for ACARS messages with callsign but no icao_hex
  useEffect(() => {
    if (!showAcarsPanel || acarsMessages.length === 0) return;

    // Find callsigns that need lookup (have callsign, no icao_hex, not in cache, no in-range match)
    const callsignsToLookup = new Set();
    for (const msg of acarsMessages) {
      if (msg.callsign && !msg.icao_hex) {
        const cs = msg.callsign.trim().toUpperCase();
        // Skip if already cached
        if (callsignHexCache[cs]) continue;
        // Skip if we have a matching aircraft in range
        const hasMatch = aircraft.some((ac) => callsignsMatch(cs, ac.flight));
        if (!hasMatch) {
          callsignsToLookup.add(cs);
        }
      }
    }

    if (callsignsToLookup.size === 0) return;

    // Lookup each callsign from history API (prefer WebSocket, limit concurrent requests)
    const lookupCallsigns = async () => {
      const baseUrl = config.apiBaseUrl || '';
      const lookups = Array.from(callsignsToLookup).slice(0, 10); // Limit to 10 at a time

      for (const callsign of lookups) {
        try {
          let data;
          if (wsRequest && wsConnected) {
            const result = await wsRequest('sightings', {
              callsign: callsign,
              hours: 24,
              limit: 1,
            });
            if (result && (result.sightings || result.results)) {
              data = result;
            } else {
              throw new Error('Invalid sightings response');
            }
          } else {
            // Django API uses /api/v1/sightings (was /api/v1/history/sightings)
            const res = await fetch(
              `${baseUrl}/api/v1/sightings?callsign=${encodeURIComponent(callsign)}&hours=24&limit=1`
            );
            data = await safeJson(res);
            if (!data) throw new Error('HTTP request failed');
          }
          const sightings = data?.sightings || data?.results || [];
          if (sightings.length > 0 && sightings[0].icao_hex) {
            setCallsignHexCache((prev) => ({
              ...prev,
              [callsign]: sightings[0].icao_hex,
            }));
          } else {
            // Mark as not found to avoid re-querying
            setCallsignHexCache((prev) => ({ ...prev, [callsign]: null }));
          }
        } catch (err) {
          // Silently fail - link just won't work for this callsign
        }
      }
    };

    lookupCallsigns();
  }, [showAcarsPanel, acarsMessages, aircraft, config.apiBaseUrl, wsRequest, wsConnected]);

  // Fetch aircraft info when selecting aircraft (using robust hook)
  useEffect(() => {
    if (selectedAircraft?.hex) {
      getAircraftInfo(selectedAircraft.hex);
    }
  }, [selectedAircraft?.hex, getAircraftInfo]);

  // Lazy prefetch aircraft info - only for aircraft visible in the current map viewport
  // This reduces API calls by not fetching info for aircraft outside the view
  useEffect(() => {
    if (!aircraft || aircraft.length === 0 || !mapRef.current) return;

    // Debounce to avoid excessive prefetches during rapid updates
    const timeoutId = setTimeout(() => {
      const map = mapRef.current;
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

  // Popup drag handlers
  const handlePopupMouseDown = (e) => {
    if (e.target.closest('.popup-close') || e.target.closest('a') || e.target.closest('button'))
      return;
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startX: popupPosition.x,
      startY: popupPosition.y,
    };
    e.preventDefault();
  };

  const handlePopupMouseMove = useCallback(
    (e) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      setPopupPosition({
        x: Math.max(0, dragStartRef.current.startX + dx),
        y: Math.max(0, dragStartRef.current.startY + dy),
      });
    },
    [isDragging]
  );

  const handlePopupMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Add global mouse handlers for dragging
  // Use refs to avoid stale closure issues with event handlers
  const handlePopupMouseMoveRef = useRef(handlePopupMouseMove);
  const handlePopupMouseUpRef = useRef(handlePopupMouseUp);
  handlePopupMouseMoveRef.current = handlePopupMouseMove;
  handlePopupMouseUpRef.current = handlePopupMouseUp;

  useEffect(() => {
    if (isDragging) {
      const moveHandler = (e) => handlePopupMouseMoveRef.current(e);
      const upHandler = (e) => handlePopupMouseUpRef.current(e);
      window.addEventListener('mousemove', moveHandler);
      window.addEventListener('mouseup', upHandler);
      return () => {
        window.removeEventListener('mousemove', moveHandler);
        window.removeEventListener('mouseup', upHandler);
      };
    }
  }, [isDragging]);

  // Legend drag handlers
  const handleLegendMouseDown = (e) => {
    if (e.target.closest('button')) return;
    setIsLegendDragging(true);
    const rect = e.currentTarget.getBoundingClientRect();
    legendDragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startX: legendPosition.x ?? rect.left,
      startY: legendPosition.y ?? rect.top,
    };
    e.preventDefault();
  };

  const handleLegendMouseMove = useCallback(
    (e) => {
      if (!isLegendDragging) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const dx = clientX - legendDragStartRef.current.x;
      const dy = clientY - legendDragStartRef.current.y;
      setLegendPosition({
        x: Math.max(0, legendDragStartRef.current.startX + dx),
        y: Math.max(0, legendDragStartRef.current.startY + dy),
      });
    },
    [isLegendDragging]
  );

  const handleLegendMouseUp = useCallback(() => {
    setIsLegendDragging(false);
  }, []);

  // Add global mouse/touch handlers for legend dragging
  useEffect(() => {
    if (isLegendDragging) {
      window.addEventListener('mousemove', handleLegendMouseMove);
      window.addEventListener('mouseup', handleLegendMouseUp);
      window.addEventListener('touchmove', handleLegendMouseMove);
      window.addEventListener('touchend', handleLegendMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleLegendMouseMove);
        window.removeEventListener('mouseup', handleLegendMouseUp);
        window.removeEventListener('touchmove', handleLegendMouseMove);
        window.removeEventListener('touchend', handleLegendMouseUp);
      };
    }
  }, [isLegendDragging, handleLegendMouseMove, handleLegendMouseUp]);

  // Aircraft list drag handlers
  const handleListMouseDown = (e) => {
    if (e.target.closest('button') || e.target.closest('.aircraft-list-item')) return;
    setIsListDragging(true);
    const rect = e.currentTarget.getBoundingClientRect();
    listDragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startX: aircraftListPosition.x ?? rect.left,
      startY: aircraftListPosition.y ?? rect.top,
    };
    e.preventDefault();
  };

  const handleListMouseMove = useCallback(
    (e) => {
      if (!isListDragging) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const dx = clientX - listDragStartRef.current.x;
      const dy = clientY - listDragStartRef.current.y;
      setAircraftListPosition({
        x: Math.max(0, listDragStartRef.current.startX + dx),
        y: Math.max(0, listDragStartRef.current.startY + dy),
      });
    },
    [isListDragging]
  );

  const handleListMouseUp = useCallback(() => {
    setIsListDragging(false);
  }, []);

  // Add global mouse/touch handlers for list dragging
  useEffect(() => {
    if (isListDragging) {
      window.addEventListener('mousemove', handleListMouseMove);
      window.addEventListener('mouseup', handleListMouseUp);
      window.addEventListener('touchmove', handleListMouseMove);
      window.addEventListener('touchend', handleListMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleListMouseMove);
        window.removeEventListener('mouseup', handleListMouseUp);
        window.removeEventListener('touchmove', handleListMouseMove);
        window.removeEventListener('touchend', handleListMouseUp);
      };
    }
  }, [isListDragging, handleListMouseMove, handleListMouseUp]);

  // Pro mode pan handlers (middle mouse button)
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
      // Middle mouse button (button 1) or auxiliary button
      if (e.button !== 1 || config.mapMode !== 'pro') return;
      e.preventDefault();
      setIsProPanning(true);
      proPanStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        offsetX: proPanOffset.x,
        offsetY: proPanOffset.y,
      };
    },
    [config.mapMode, proPanOffset]
  );

  const handleProPanMove = useCallback(
    (e) => {
      if (!isProPanning) return;
      // Stop following when manually panning
      setFollowingAircraft(null);
      const dx = e.clientX - proPanStartRef.current.x;
      const dy = e.clientY - proPanStartRef.current.y;
      setProPanOffset({
        x: proPanStartRef.current.offsetX + dx,
        y: proPanStartRef.current.offsetY + dy,
      });
    },
    [isProPanning]
  );

  const handleProPanEnd = useCallback(() => {
    setIsProPanning(false);
    // Update URL with pan offset for pro/crt mode (store as pixels since lat/lon conversion is complex)
    const updateHash = setHashParamsRef.current;
    const offset = proPanOffsetRef.current;
    if (updateHash && (offset.x !== 0 || offset.y !== 0)) {
      updateHash({
        panX: String(Math.round(offset.x)),
        panY: String(Math.round(offset.y)),
      });
    } else if (updateHash) {
      updateHash({ panX: undefined, panY: undefined });
    }
  }, []);

  // Reset pan offset and stop following when switching away from pro mode
  useEffect(() => {
    if (config.mapMode !== 'pro') {
      setProPanOffset({ x: 0, y: 0 });
      setFollowingAircraft(null);
      if (setHashParams) {
        setHashParams({ panX: undefined, panY: undefined });
      }
    }
  }, [config.mapMode, setHashParams]);

  // Follow aircraft - update pan offset as aircraft moves
  useEffect(() => {
    if (!followingAircraft || config.mapMode !== 'pro' || !canvasRef.current) return;

    const followedAc = aircraft.find((ac) => ac.hex === followingAircraft);
    if (!followedAc || !followedAc.lat || !followedAc.lon) {
      // Aircraft no longer available, stop following
      setFollowingAircraft(null);
      return;
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const pixelsPerNm = (Math.min(rect.width, rect.height) * 0.45) / radarRange;

    const dLat = followedAc.lat - feederLat;
    const dLon = followedAc.lon - feederLon;
    const nmY = dLat * 60;
    const nmX = dLon * 60 * Math.cos((feederLat * Math.PI) / 180);

    setProPanOffset({ x: -(nmX * pixelsPerNm), y: nmY * pixelsPerNm });
  }, [followingAircraft, aircraft, config.mapMode, radarRange, feederLat, feederLon]);

  // Add window event listeners for pro pan
  useEffect(() => {
    if (isProPanning) {
      window.addEventListener('mousemove', handleProPanMove);
      window.addEventListener('mouseup', handleProPanEnd);
      return () => {
        window.removeEventListener('mousemove', handleProPanMove);
        window.removeEventListener('mouseup', handleProPanEnd);
      };
    }
  }, [isProPanning, handleProPanMove, handleProPanEnd]);

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
  useEffect(() => {
    if (config.mapMode !== 'pro' && config.mapMode !== 'crt') {
      // Return empty cleanup function when not in pro/crt mode
      return () => {};
    }

    const handleKeyDown = (e) => {
      // Don't trigger shortcuts when typing in inputs
      if (
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.isContentEditable
      )
        return;

      const key = e.key.toLowerCase();

      switch (key) {
        case 'r': // Reset view
          animatePanTo(0, 0);
          setFollowingAircraft(null);
          break;
        case 'v': // Toggle velocity/prediction vectors
          setShowPredictionVectors((prev) => {
            const newVal = !prev;
            localStorage.setItem('adsb-pro-prediction-vectors', String(newVal));
            return newVal;
          });
          break;
        case 'y': // Toggle VS trend triangles (climb/descend)
          setShowVsTrend((prev) => {
            const newVal = !prev;
            localStorage.setItem('adsb-pro-vs-trend', String(newVal));
            return newVal;
          });
          break;
        case 't': // Toggle trails
          setShowShortTracks((prev) => {
            const newVal = !prev;
            localStorage.setItem('adsb-show-short-tracks', String(newVal));
            return newVal;
          });
          break;
        case 'g': // Cycle grid opacity (0.3 -> 0.15 -> 0 -> 0.3)
          setGridOpacity((prev) => {
            const newVal = prev > 0.2 ? 0.15 : prev > 0.1 ? 0 : 0.3;
            localStorage.setItem('adsb-pro-grid-opacity', String(newVal));
            return newVal;
          });
          break;
        case 'c': // Toggle conflict visualization
          setShowConflictVisualization((prev) => {
            const newVal = !prev;
            localStorage.setItem('adsb-pro-conflict-viz', String(newVal));
            return newVal;
          });
          break;
        case 's': // Toggle speed coloring
          setShowSpeedColors((prev) => {
            const newVal = !prev;
            localStorage.setItem('adsb-pro-speed-colors', String(newVal));
            return newVal;
          });
          break;
        case 'l': // Toggle labels/data blocks
          setShowDataBlocks((prev) => {
            const newVal = !prev;
            localStorage.setItem('adsb-pro-show-datablocks', String(newVal));
            return newVal;
          });
          break;
        case 'p': // Toggle compass rose
          setShowCompassRose((prev) => {
            const newVal = !prev;
            localStorage.setItem('adsb-pro-compass-rose', String(newVal));
            return newVal;
          });
          break;
        case 'H': // Toggle heat map (Shift+H)
          updateOverlays({ ...overlays, heatMap: !overlays.heatMap });
          break;
        case '+':
        case '=': // Zoom in (decrease range)
          e.preventDefault();
          setRadarRange((prev) => Math.max(10, prev - 10));
          break;
        case '-': // Zoom out (increase range)
          e.preventDefault();
          setRadarRange((prev) => Math.min(250, prev + 10));
          break;
        case '1': // Quick range preset 10nm
          setRadarRange(10);
          break;
        case '2': // Quick range preset 25nm
          setRadarRange(25);
          break;
        case '3': // Quick range preset 50nm
          setRadarRange(50);
          break;
        case '4': // Quick range preset 100nm
          setRadarRange(100);
          break;
        case '5': // Quick range preset 250nm
          setRadarRange(250);
          break;
        case 'escape': // Clear measurement/selection
          setMeasurementPoints([]);
          if (!panelPinned) {
            setSelectedAircraft(null);
          }
          setHoverInfo(null);
          break;
        case 'f': // Toggle quick filter bar OR FPS counter (Shift+F)
          if (e.shiftKey) {
            // Shift+F: Toggle FPS counter (debug)
            setShowFpsCounter((prev) => !prev);
          } else {
            // F: Toggle quick filter bar
            toggleQuickFilterBar();
          }
          break;
        case 'h': // Toggle high contrast
          setHighContrastMode((prev) => {
            const newVal = !prev;
            localStorage.setItem('adsb-pro-high-contrast', String(newVal));
            return newVal;
          });
          break;
        case 'a': // Toggle altitude-colored trails OR altitude filter panel (Shift+A)
          if (e.shiftKey) {
            // Shift+A: Toggle altitude filter panel
            setShowAltitudeFilterPanel((prev) => !prev);
          } else {
            // A: Toggle altitude-colored trails
            setShowAltitudeTrails((prev) => {
              const newVal = !prev;
              localStorage.setItem('adsb-pro-altitude-trails', String(newVal));
              return newVal;
            });
          }
          break;
        case 'm': // Toggle reduced motion OR MSAW (Shift+M)
          if (e.shiftKey) {
            // Shift+M: Toggle MSAW (Minimum Safe Altitude Warning)
            msaw.toggle();
          } else {
            // M: Toggle reduced motion
            setReducedMotion((prev) => {
              const newVal = !prev;
              localStorage.setItem('adsb-pro-reduced-motion', String(newVal));
              return newVal;
            });
          }
          break;
        case 'x': // Toggle weather radar overlay
          setOverlays((prev) => {
            const next = { ...prev, radar: !prev.radar };
            saveOverlays(next);
            return next;
          });
          break;
        case 'w': // Toggle watch list panel
          toggleWatchListPanel();
          break;
        case 'W': // Toggle winds aloft overlay (Shift+W)
          if (e.shiftKey) {
            setOverlays((prev) => {
              const next = { ...prev, windsAloft: !prev.windsAloft };
              saveOverlays(next);
              return next;
            });
          }
          break;
        case 'n': // Add selected aircraft to watch list
          if (selectedAircraft) {
            toggleWatchList(selectedAircraft);
          }
          break;
        case 'j': // Toggle J-rings
          setShowJRings((prev) => {
            const newVal = !prev;
            localStorage.setItem('adsb-pro-j-rings', String(newVal));
            return newVal;
          });
          break;
        case 'k': // Toggle wake turbulence separation rings
          setShowWakeRings((prev) => {
            const newVal = !prev;
            localStorage.setItem('adsb-pro-wake-rings', String(newVal));
            return newVal;
          });
          break;
        case 'i': // Toggle session stats panel
          setShowSessionStats((prev) => !prev);
          break;
        case '?': // Show keyboard shortcuts help
          e.preventDefault();
          setShowKeyboardHelp((prev) => !prev);
          break;
        case 'T': // Cycle color theme (Shift+T)
          if (e.shiftKey) {
            cycleProTheme();
          }
          break;
        case 'd': // Reset all data block positions to default
          if (dataBlockCustomPositionCount > 0) {
            resetAllDataBlockOffsets();
            toastContext?.success?.(`Reset ${dataBlockCustomPositionCount} data block position(s)`);
          }
          break;
        case ' ': // Space: Toggle play/pause in playback mode
          if (isPlayback) {
            e.preventDefault();
            togglePlayPause();
          }
          break;
        case 'arrowleft': // Left arrow: Seek backward in playback mode
          if (isPlayback) {
            e.preventDefault();
            skipPlaybackBackward(60); // Skip 1 minute
          }
          break;
        case 'arrowright': // Right arrow: Seek forward in playback mode
          if (isPlayback) {
            e.preventDefault();
            skipPlaybackForward(60); // Skip 1 minute
          }
          break;
        case 'arrowup': // Up arrow: Increase playback speed
          if (isPlayback) {
            e.preventDefault();
            cyclePlaybackSpeedUp();
          }
          break;
        case 'arrowdown': // Down arrow: Decrease playback speed
          if (isPlayback) {
            e.preventDefault();
            cyclePlaybackSpeedDown();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    config.mapMode,
    panelPinned,
    selectedAircraft,
    toggleWatchList,
    toggleWatchListPanel,
    toggleQuickFilterBar,
    msaw,
    cycleProTheme,
    dataBlockCustomPositionCount,
    resetAllDataBlockOffsets,
    toastContext,
    isPlayback,
    togglePlayPause,
    skipPlaybackBackward,
    skipPlaybackForward,
    cyclePlaybackSpeedUp,
    cyclePlaybackSpeedDown,
  ]);

  // Handle mouse move on radar container to show/hide range control and track cursor
  const handleContainerMouseMove = useCallback(
    (e) => {
      // Phase 14.3: Handle data block dragging
      if (isDataBlockDragging) {
        handleDataBlockDragMove(e);
        return; // Don't process other move logic while dragging
      }

      const container = e.currentTarget;
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const containerHeight = rect.height;
      const containerWidth = rect.width;

      // Show range control when mouse is in bottom 15% of container
      const showThreshold = containerHeight * 0.85;
      setShowRangeControl(mouseY > showThreshold);

      // Store cursor position for draw loop
      cursorPosRef.current = { x: mouseX, y: mouseY };

      // Calculate cursor lat/lon/distance/bearing for Pro mode
      if (config.mapMode === 'pro' && canvasRef.current) {
        const centerX = containerWidth / 2;
        const centerY = containerHeight / 2;
        const maxRadius = Math.min(containerWidth, containerHeight) * 0.45;
        const pixelsPerNm = maxRadius / radarRange;

        // Convert screen position to nm offset (accounting for pan)
        const nmX = (mouseX - centerX - proPanOffset.x) / pixelsPerNm;
        const nmY = -(mouseY - centerY - proPanOffset.y) / pixelsPerNm; // Flip Y

        // Convert nm offset to lat/lon
        const cursorLat = feederLat + nmY / 60;
        const cursorLon = feederLon + nmX / (60 * Math.cos((feederLat * Math.PI) / 180));

        // Calculate distance and bearing from feeder
        const distance = Math.sqrt(nmX * nmX + nmY * nmY);
        const bearing = ((Math.atan2(nmX, nmY) * 180) / Math.PI + 360) % 360;

        setCursorInfo({
          x: mouseX,
          y: mouseY,
          lat: cursorLat,
          lon: cursorLon,
          distance: distance,
          bearing: bearing,
        });

        // Check for aircraft hover (with debounce)
        const now = Date.now();
        if (now - lastHoverCheckRef.current > 100) {
          // 100ms debounce
          lastHoverCheckRef.current = now;

          // Clear any pending hover timeout
          if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
          }

          // Find aircraft under cursor
          let foundHover = null;
          const hoverThreshold = 25; // pixels

          aircraft.forEach((ac) => {
            if (!ac.lat || !ac.lon) return;
            const acNmX = (ac.lon - feederLon) * 60 * Math.cos((feederLat * Math.PI) / 180);
            const acNmY = (ac.lat - feederLat) * 60;
            const acX = centerX + acNmX * pixelsPerNm + proPanOffset.x;
            const acY = centerY - acNmY * pixelsPerNm + proPanOffset.y;

            const dist = Math.sqrt((mouseX - acX) ** 2 + (mouseY - acY) ** 2);
            if (dist < hoverThreshold && (!foundHover || dist < foundHover.dist)) {
              foundHover = { aircraft: ac, x: acX, y: acY, dist };
            }
          });

          if (foundHover) {
            // Set hover info after 500ms delay
            hoverTimeoutRef.current = setTimeout(() => {
              setHoverInfo({ aircraft: foundHover.aircraft, x: foundHover.x, y: foundHover.y });
            }, 500);
          } else {
            setHoverInfo(null);
          }
        }
      }
    },
    [
      config.mapMode,
      radarRange,
      proPanOffset,
      feederLat,
      feederLon,
      aircraft,
      isDataBlockDragging,
      handleDataBlockDragMove,
    ]
  );

  const handleContainerMouseLeave = useCallback(() => {
    setShowRangeControl(false);
    setCursorInfo(null);
    setHoverInfo(null);
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    // Phase 14.3: End data block drag on mouse leave
    if (isDataBlockDragging) {
      handleDataBlockDragEnd();
    }
  }, [isDataBlockDragging, handleDataBlockDragEnd]);

  // Phase 14.3: Global mouse up handler for data block dragging
  useEffect(() => {
    if (isDataBlockDragging) {
      const handleGlobalMouseUp = () => handleDataBlockDragEnd();
      window.addEventListener('mouseup', handleGlobalMouseUp);
      return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
    }
  }, [isDataBlockDragging, handleDataBlockDragEnd]);

  // Track aircraft position history for trails and profile charts
  // Faster updates for smoother trails
  useEffect(() => {
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes of history

    setTrackHistory((prev) => {
      const updated = { ...prev };

      // Add new positions for each aircraft
      aircraft.forEach((ac) => {
        if (ac.lat && ac.lon && ac.hex) {
          if (!updated[ac.hex]) {
            updated[ac.hex] = [];
          }

          // Calculate distance from feeder
          const dLat = ac.lat - feederLat;
          const dLon = ac.lon - feederLon;
          const latNm = dLat * 60;
          const lonNm = dLon * 60 * Math.cos((feederLat * Math.PI) / 180);
          const dist = Math.sqrt(latNm * latNm + lonNm * lonNm);

          // Only add if position has changed significantly or enough time has passed
          // Reduced from 3s to 1s for faster updates, and tighter position threshold
          const lastPos = updated[ac.hex][updated[ac.hex].length - 1];
          const positionChanged =
            !lastPos ||
            Math.abs(lastPos.lat - ac.lat) > 0.0005 || // ~50m
            Math.abs(lastPos.lon - ac.lon) > 0.0005;
          const timeElapsed = !lastPos || now - lastPos.time > 1000; // 1 second minimum

          if (positionChanged && timeElapsed) {
            updated[ac.hex].push({
              lat: ac.lat,
              lon: ac.lon,
              alt: ac.alt_baro || ac.alt_geom || ac.alt,
              spd: ac.gs || ac.tas || ac.ias,
              vs: ac.vr ?? ac.baro_rate ?? ac.geom_rate ?? 0,
              trk: ac.track || ac.true_heading || ac.mag_heading,
              dist: dist,
              time: now,
            });
          }

          // Remove old positions
          updated[ac.hex] = updated[ac.hex].filter((p) => now - p.time < maxAge);
        }
      });

      // Bug fix #2: Improved cleanup logic for position history
      // Clean up aircraft that are no longer present more promptly
      const activeHexes = new Set(aircraft.map((ac) => ac.hex));
      Object.keys(updated).forEach((hex) => {
        if (!activeHexes.has(hex)) {
          // Remove entries for aircraft gone for more than 30 seconds (reduced from 60s)
          // Also remove if the entry has no positions or all positions are stale
          if (
            updated[hex].length === 0 ||
            now - updated[hex][updated[hex].length - 1].time > 30000
          ) {
            delete updated[hex];
          }
        }
      });

      return updated;
    });

    // Also update short track history with real-time positions (when enabled)
    // This ensures smooth continuous trails between API refreshes
    if (showShortTracks) {
      setShortTrackHistory((prev) => {
        let hasChanges = false;
        const updated = { ...prev };

        aircraft.forEach((ac) => {
          if (ac.lat && ac.lon && ac.hex) {
            // Bug fix #4: Initialize short track history for new aircraft
            // Previously only updated if entry already existed, new aircraft never got initialized
            if (!updated[ac.hex]) {
              updated[ac.hex] = [{ lat: ac.lat, lon: ac.lon, time: now }];
              hasChanges = true;
              return; // Skip to next aircraft after initialization
            }

            const existing = updated[ac.hex];
            const lastPos = existing[existing.length - 1];

            // Only add if position changed and time elapsed
            const positionChanged =
              !lastPos ||
              Math.abs(lastPos.lat - ac.lat) > 0.0003 ||
              Math.abs(lastPos.lon - ac.lon) > 0.0003;
            const timeElapsed = !lastPos || now - lastPos.time > 1500; // 1.5 second minimum

            if (positionChanged && timeElapsed) {
              updated[ac.hex] = [...existing, { lat: ac.lat, lon: ac.lon, time: now }].slice(-100);
              hasChanges = true;
            }
          }
        });

        return hasChanges ? updated : prev;
      });
    }
  }, [aircraft, feederLat, feederLon, showShortTracks]);

  // Ref for aircraft list to avoid stale closures in interval
  const aircraftForShortTracksRef = useRef(aircraft);
  useEffect(() => {
    aircraftForShortTracksRef.current = aircraft;
  }, [aircraft]);

  // Fetch historical positions for short tracks when enabled
  // Merges historical API data with real-time positions for complete trails
  // Uses an interval instead of re-running on aircraft changes to prevent API spam
  useEffect(() => {
    if (!showShortTracks) return;

    const baseUrl = config.apiBaseUrl || '';
    const REFRESH_INTERVAL = 60000; // Refresh historical data every 60 seconds to fill gaps
    const FETCH_INTERVAL = 2000; // Check for new aircraft to fetch every 2 seconds (reduced for lower latency)

    const fetchShortTracks = () => {
      const now = Date.now();
      const visibleAircraft = aircraftForShortTracksRef.current.filter(
        (ac) => ac.hex && ac.lat && ac.lon
      );

      // Prioritize aircraft: selected first, then near map center, then military
      let prioritized = visibleAircraft;
      if (mapRef.current) {
        try {
          const bounds = mapRef.current.getBounds();
          const center = mapRef.current.getCenter();

          // Only consider aircraft within the visible bounds
          prioritized = visibleAircraft
            .filter((ac) => bounds.contains([ac.lat, ac.lon]))
            .sort((a, b) => {
              // Selected aircraft first
              if (selectedAircraft?.hex === a.hex) return -1;
              if (selectedAircraft?.hex === b.hex) return 1;
              // Military second
              if (a.military && !b.military) return -1;
              if (!a.military && b.military) return 1;
              // Then by distance from center
              const distA = Math.hypot(a.lat - center.lat, a.lon - center.lng);
              const distB = Math.hypot(b.lat - center.lat, b.lon - center.lng);
              return distA - distB;
            });
        } catch (e) {
          // Map not ready
        }
      }

      // Fetch history for aircraft that need it:
      // - Never fetched before
      // - Last fetch was more than REFRESH_INTERVAL ago (to fill gaps)
      const toFetch = prioritized
        .filter((ac) => {
          const lastFetch = shortTrackFetchedRef.current.get(ac.hex);
          if (!lastFetch) return true; // Never fetched
          return now - lastFetch > REFRESH_INTERVAL; // Needs refresh
        })
        .slice(0, 6); // Fetch up to 6 at a time for faster initial loading

      if (toFetch.length > 0) {
        toFetch.forEach(async (ac) => {
          // Mark as "in progress" to prevent duplicate requests
          // Use a temporary marker that will be replaced on success or cleared on failure
          const inProgressMarker = now - REFRESH_INTERVAL + 5000; // Will retry in 5s on failure
          shortTrackFetchedRef.current.set(ac.hex, inProgressMarker);
          try {
            let data;
            // Use WebSocket when connected
            if (wsRequest && wsConnected) {
              const result = await wsRequest('sightings', {
                icao_hex: ac.hex,
                hours: 1,
                limit: 100,
              });
              if (result && (result.sightings || result.results)) {
                data = result;
              } else {
                // No data returned - mark for quick retry
                shortTrackFetchedRef.current.delete(ac.hex);
                return;
              }
            } else {
              // Django API uses /api/v1/sightings with query params (was /api/v1/history/sightings/{hex})
              const res = await fetch(
                `${baseUrl}/api/v1/sightings?icao_hex=${ac.hex}&hours=1&limit=100`
              );
              data = await safeJson(res);
              if (!data) {
                // Failed to parse - mark for quick retry
                shortTrackFetchedRef.current.delete(ac.hex);
                return;
              }
            }

            const sightings = data?.sightings || data?.results || [];
            if (sightings.length > 0) {
              // Success - mark as fully fetched
              shortTrackFetchedRef.current.set(ac.hex, Date.now());

              // Convert API data to our format
              const historicalPositions = sightings
                .map((s) => ({
                  lat: s.lat,
                  lon: s.lon,
                  time: new Date(s.timestamp).getTime(),
                }))
                .sort((a, b) => a.time - b.time); // Sort oldest to newest

              // Merge with existing positions
              setShortTrackHistory((prev) => {
                const existing = prev[ac.hex] || [];

                // Combine all positions
                const allPositions = [...historicalPositions];

                // Also preserve any existing positions not in the new data
                // (in case real-time captured something the API missed)
                existing.forEach((p) => {
                  const isDuplicate = allPositions.some(
                    (ap) =>
                      Math.abs(ap.time - p.time) < 2000 && // Within 2 seconds
                      Math.abs(ap.lat - p.lat) < 0.0001 &&
                      Math.abs(ap.lon - p.lon) < 0.0001
                  );
                  if (!isDuplicate) {
                    allPositions.push(p);
                  }
                });

                // Sort by time and keep last 100 positions for smooth trails
                const sorted = allPositions.sort((a, b) => a.time - b.time).slice(-100);

                return {
                  ...prev,
                  [ac.hex]: sorted,
                };
              });
            } else {
              // No sightings but successful response - still mark as fetched
              // (aircraft may not have history yet)
              shortTrackFetchedRef.current.set(ac.hex, Date.now());
            }
          } catch (e) {
            // Failed - allow retry sooner (clear the marker so it can be retried in 5s)
            shortTrackFetchedRef.current.delete(ac.hex);
            console.debug('Short track fetch failed:', ac.hex, e.message);
          }
        });
      }

      // Cleanup old entries when aircraft disappear
      const activeHexes = new Set(aircraftForShortTracksRef.current.map((a) => a.hex));
      setShortTrackHistory((prev) => {
        const hexesToRemove = Object.keys(prev).filter((hex) => !activeHexes.has(hex));
        if (hexesToRemove.length === 0) return prev;
        const updated = { ...prev };
        hexesToRemove.forEach((hex) => {
          delete updated[hex];
          shortTrackFetchedRef.current.delete(hex);
        });
        return updated;
      });
    };

    // Run once immediately, then on interval
    fetchShortTracks();
    const intervalId = setInterval(fetchShortTracks, FETCH_INTERVAL);

    return () => clearInterval(intervalId);
  }, [showShortTracks, config.apiBaseUrl, wsRequest, wsConnected, selectedAircraft?.hex]);

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

  // Animation frame counter for loading spinners
  const [_canvasAnimFrame, setCanvasAnimFrame] = useState(0);

  // Auto-refresh canvas animation when waiting for data
  useEffect(() => {
    if (!selectedAircraft) return;

    const history = trackHistory[selectedAircraft.hex];
    const needsAnimation = !history || history.length < 2;

    if (needsAnimation) {
      const interval = setInterval(() => {
        setCanvasAnimFrame((f) => (f + 1) % 12);
      }, 150);
      return () => clearInterval(interval);
    }
  }, [selectedAircraft, trackHistory]);

  // Helper to draw animated "waiting for data" spinner on canvas
  const drawWaitingSpinner = (
    ctx,
    width,
    height,
    color = 'rgba(138, 148, 158, 0.4)',
    frame = 0
  ) => {
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = 12;
    const dotCount = 8;

    // Draw spinning dots
    for (let i = 0; i < dotCount; i++) {
      const angle = (i / dotCount) * Math.PI * 2 - Math.PI / 2;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      const opacity = ((i + frame) % dotCount) / dotCount;

      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fillStyle = color.replace('0.4', opacity.toFixed(2));
      ctx.fill();
    }

    // Draw text below spinner
    ctx.fillStyle = color;
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Loading...', centerX, centerY + 24);
  };

  // Draw altitude profile canvas
  useEffect(() => {
    if (!altProfileCanvasRef.current || !selectedAircraft) return;

    const canvas = altProfileCanvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 280, 60);

    const history = trackHistory[selectedAircraft.hex];
    if (!history || history.length === 0) {
      drawWaitingSpinner(ctx, 280, 60, 'rgba(0, 212, 255, 0.4)');
      return;
    }

    const alts = history.map((p) => p.alt || 0);
    const validAlts = alts.filter((a) => a > 0);

    // If only one point or no valid alts, draw a horizontal line at center
    if (validAlts.length === 0) {
      drawWaitingSpinner(ctx, 280, 60, 'rgba(0, 212, 255, 0.4)');
      return;
    }

    const minAlt = Math.min(...validAlts);
    const maxAlt = Math.max(...validAlts);
    const range = Math.max(maxAlt - minAlt, 100);
    const pad = 5;

    const getY = (alt) => {
      const normalized = Math.max(0, Math.min(1, (alt - minAlt) / range));
      return 60 - pad - normalized * (60 - pad * 2);
    };

    // Draw gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, 60);
    gradient.addColorStop(0, 'rgba(0, 212, 255, 0.3)');
    gradient.addColorStop(1, 'rgba(0, 212, 255, 0.05)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, 60 - pad);

    const xStep = history.length > 1 ? 280 / (history.length - 1) : 280;
    history.forEach((p, i) => {
      const x = history.length > 1 ? i * xStep : 140;
      ctx.lineTo(x, getY(p.alt || minAlt));
    });

    // If single point, extend to full width
    if (history.length === 1) {
      ctx.lineTo(280, getY(history[0].alt || minAlt));
    }

    ctx.lineTo(280, 60 - pad);
    ctx.closePath();
    ctx.fill();

    // Draw line
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();

    history.forEach((p, i) => {
      const x = history.length > 1 ? i * xStep : 0;
      const y = getY(p.alt || minAlt);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    // If single point, draw horizontal line
    if (history.length === 1) {
      ctx.lineTo(280, getY(history[0].alt || minAlt));
    }

    ctx.stroke();
  }, [selectedAircraft, trackHistory]);

  // Draw speed profile canvas
  useEffect(() => {
    if (!speedProfileCanvasRef.current || !selectedAircraft) return;

    const canvas = speedProfileCanvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 280, 60);

    const history = trackHistory[selectedAircraft.hex];
    if (!history || history.length === 0) {
      drawWaitingSpinner(ctx, 280, 60, 'rgba(74, 222, 128, 0.4)');
      return;
    }

    const speeds = history.map((p) => p.spd || 0);
    const validSpeeds = speeds.filter((s) => s > 0);

    if (validSpeeds.length === 0) {
      drawWaitingSpinner(ctx, 280, 60, 'rgba(74, 222, 128, 0.4)');
      return;
    }

    const minSpd = Math.min(...validSpeeds);
    const maxSpd = Math.max(...validSpeeds);
    const range = Math.max(maxSpd - minSpd, 20);
    const pad = 5;

    const getY = (spd) => {
      const normalized = Math.max(0, Math.min(1, (spd - minSpd) / range));
      return 60 - pad - normalized * (60 - pad * 2);
    };

    // Draw gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, 60);
    gradient.addColorStop(0, 'rgba(74, 222, 128, 0.3)');
    gradient.addColorStop(1, 'rgba(74, 222, 128, 0.05)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, 60 - pad);

    const xStep = history.length > 1 ? 280 / (history.length - 1) : 280;
    history.forEach((p, i) => {
      const x = history.length > 1 ? i * xStep : 140;
      ctx.lineTo(x, getY(p.spd || minSpd));
    });

    if (history.length === 1) {
      ctx.lineTo(280, getY(history[0].spd || minSpd));
    }

    ctx.lineTo(280, 60 - pad);
    ctx.closePath();
    ctx.fill();

    // Draw line
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();

    history.forEach((p, i) => {
      const x = history.length > 1 ? i * xStep : 0;
      const y = getY(p.spd || minSpd);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    if (history.length === 1) {
      ctx.lineTo(280, getY(history[0].spd || minSpd));
    }

    ctx.stroke();
  }, [selectedAircraft, trackHistory]);

  // Draw vertical speed profile canvas
  useEffect(() => {
    if (!vsProfileCanvasRef.current || !selectedAircraft) return;

    const canvas = vsProfileCanvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 280, 60);

    const history = trackHistory[selectedAircraft.hex];
    const pad = 5;
    const centerY = 30;
    const halfHeight = centerY - pad;

    // Always draw zero line
    ctx.strokeStyle = 'rgba(138, 148, 158, 0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(280, centerY);
    ctx.stroke();
    ctx.setLineDash([]);

    if (!history || history.length === 0) {
      drawWaitingSpinner(ctx, 280, 60, 'rgba(138, 148, 158, 0.4)');
      return;
    }

    const vsValues = history.map((p) => p.vs || 0);
    const maxAbsVs = Math.max(
      Math.abs(Math.min(...vsValues)),
      Math.abs(Math.max(...vsValues)),
      500
    );

    const getY = (vs) => {
      const normalized = Math.max(-1, Math.min(1, vs / maxAbsVs));
      return centerY - normalized * halfHeight;
    };

    // Draw gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, 60);
    gradient.addColorStop(0, 'rgba(34, 197, 94, 0.2)');
    gradient.addColorStop(0.5, 'rgba(138, 148, 158, 0.05)');
    gradient.addColorStop(1, 'rgba(249, 115, 22, 0.2)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, centerY);

    const xStep = history.length > 1 ? 280 / (history.length - 1) : 280;
    history.forEach((p, i) => {
      const x = history.length > 1 ? i * xStep : 140;
      ctx.lineTo(x, getY(p.vs || 0));
    });

    if (history.length === 1) {
      ctx.lineTo(280, getY(history[0].vs || 0));
    }

    ctx.lineTo(280, centerY);
    ctx.closePath();
    ctx.fill();

    // Draw line - use green for climbing, orange for descending
    const latestVs = history.length > 0 ? history[history.length - 1].vs || 0 : 0;
    ctx.strokeStyle =
      latestVs > 0
        ? 'rgba(34, 197, 94, 0.9)'
        : latestVs < 0
          ? 'rgba(249, 115, 22, 0.9)'
          : 'rgba(138, 148, 158, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();

    history.forEach((p, i) => {
      const x = history.length > 1 ? i * xStep : 0;
      const y = getY(p.vs || 0);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    if (history.length === 1) {
      ctx.lineTo(280, getY(history[0].vs || 0));
    }

    ctx.stroke();
  }, [selectedAircraft, trackHistory]);

  // Draw distance profile canvas
  useEffect(() => {
    if (!distProfileCanvasRef.current || !selectedAircraft) return;

    const canvas = distProfileCanvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 280, 60);

    const history = trackHistory[selectedAircraft.hex];
    if (!history || history.length === 0) {
      drawWaitingSpinner(ctx, 280, 60, 'rgba(163, 113, 247, 0.4)');
      return;
    }

    const dists = history.map((p) => p.dist || 0).filter((d) => d > 0);

    if (dists.length === 0) {
      drawWaitingSpinner(ctx, 280, 60, 'rgba(163, 113, 247, 0.4)');
      return;
    }

    const minDist = Math.min(...dists);
    const maxDist = Math.max(...dists);
    const range = maxDist - minDist || 10;
    const pad = 5;

    // Helper to clamp Y values within canvas bounds
    const getY = (dist) => {
      const normalized = Math.max(0, Math.min(1, (dist - minDist) / range));
      return 60 - pad - normalized * (60 - pad * 2);
    };

    // Draw gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, 60);
    gradient.addColorStop(0, 'rgba(163, 113, 247, 0.3)');
    gradient.addColorStop(1, 'rgba(163, 113, 247, 0.05)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, 60 - pad);

    const xStep = history.length > 1 ? 280 / (history.length - 1) : 280;
    history.forEach((p, i) => {
      const x = history.length > 1 ? i * xStep : 140;
      ctx.lineTo(x, getY(p.dist || minDist));
    });

    if (history.length === 1) {
      ctx.lineTo(280, getY(history[0].dist || minDist));
    }

    ctx.lineTo(280, 60 - pad);
    ctx.closePath();
    ctx.fill();

    // Draw line
    ctx.strokeStyle = 'rgba(163, 113, 247, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();

    history.forEach((p, i) => {
      const x = history.length > 1 ? i * xStep : 0;
      const y = getY(p.dist || minDist);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    if (history.length === 1) {
      ctx.lineTo(280, getY(history[0].dist || minDist));
    }

    ctx.stroke();
  }, [selectedAircraft, trackHistory]);

  // Fetch aviation data via WebSocket with HTTP fallback - uses viewport center for dynamic loading
  // Debounced to avoid timeouts during panning/zooming
  useEffect(() => {
    // Don't fetch while actively panning
    if (isProPanning) return;

    // Use viewport center if available, otherwise fall back to feeder location
    const centerLat = viewportCenter.lat ?? feederLat;
    const centerLon = viewportCenter.lon ?? feederLon;
    const baseUrl = config.apiBaseUrl || '';

    const extractData = (response) => {
      if (!response) return [];
      if (Array.isArray(response)) return response;
      if (response.data && Array.isArray(response.data)) return response.data;
      if (response.features) {
        return response.features.map((f) => ({
          ...f.properties,
          lat: f.geometry?.coordinates?.[1],
          lon: f.geometry?.coordinates?.[0],
        }));
      }
      return [];
    };

    const normalizeAirport = (apt) => ({
      ...apt,
      icao: apt.icao || apt.icaoId || apt.faaId || apt.id || 'UNK',
      id: apt.id || apt.icaoId || apt.faaId || 'UNK',
      name: apt.name || apt.site || null,
      city: apt.city || apt.assocCity || null,
      state: apt.state || apt.stateProv || null,
      elev: apt.elev ?? apt.elev_ft ?? apt.elevation ?? null,
      class: apt.class || apt.airspaceClass || null,
    });

    // HTTP fallback helper for aviation data endpoints
    const fetchHttp = async (endpoint, params = {}) => {
      const queryParams = new URLSearchParams(params);
      const url = `${baseUrl}/api/v1/aviation/${endpoint}?${queryParams}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    };

    const fetchAviationData = async () => {
      const baseParams = { lat: centerLat, lon: centerLon };

      try {
        // Fetch all data in parallel - use WebSocket if connected, otherwise HTTP
        const promises = [];

        // NAVAIDs
        promises.push(
          (wsRequest && wsConnected
            ? wsRequest('navaids', { ...baseParams, radius: Math.round(radarRange * 1.5) })
            : fetchHttp('navaids', { ...baseParams, radius: Math.round(radarRange * 1.5) })
          )
            .then((data) => ({ type: 'navaids', data: extractData(data) }))
            .catch((err) => ({ type: 'navaids', error: err.message }))
        );

        // Airports
        promises.push(
          (wsRequest && wsConnected
            ? wsRequest('airports', {
                ...baseParams,
                radius: Math.round(radarRange * 1.2),
                limit: 50,
              })
            : fetchHttp('airports', {
                ...baseParams,
                radius: Math.round(radarRange * 1.2),
                limit: 50,
              })
          )
            .then((data) => ({ type: 'airports', data: extractData(data).map(normalizeAirport) }))
            .catch((err) => ({ type: 'airports', error: err.message }))
        );

        // Airspace (if enabled)
        if (overlays.airspace) {
          // G-AIRMET advisories
          promises.push(
            (wsRequest && wsConnected
              ? wsRequest('airspaces', baseParams)
              : fetchHttp('airspace/advisories', baseParams)
            )
              .then((data) => {
                const advisories = (data?.advisories || extractData(data)).map((adv) => ({
                  ...adv,
                  isAdvisory: true,
                  type: adv.type || 'GAIRMET',
                }));
                return { type: 'airspaces', data: advisories };
              })
              .catch((err) => ({ type: 'airspaces', error: err.message }))
          );

          // Static boundaries
          promises.push(
            (wsRequest && wsConnected
              ? wsRequest('airspace-boundaries', {
                  ...baseParams,
                  radius: Math.round(radarRange * 1.5),
                })
              : fetchHttp('airspace/boundaries', {
                  ...baseParams,
                  radius: Math.round(radarRange * 1.5),
                })
            )
              .then((data) => {
                // Response has { boundaries: [...], count, source, ... }
                const rawBoundaries = data?.boundaries || extractData(data);
                const boundaries = rawBoundaries.map((b) => ({
                  ...b,
                  isBoundary: true,
                  // Map airspace_class to class for frontend compatibility
                  class: b.airspace_class || b.class,
                  type: b.airspace_class ? `CLASS_${b.airspace_class}` : b.type,
                }));
                return { type: 'boundaries', data: boundaries };
              })
              .catch((err) => ({ type: 'boundaries', error: err.message }))
          );
        }

        // METARs (if enabled)
        if (overlays.metars) {
          promises.push(
            (wsRequest && wsConnected
              ? wsRequest('metars', { ...baseParams, radius: Math.round(radarRange) })
              : fetchHttp('metars', { ...baseParams, radius: Math.round(radarRange) })
            )
              .then((data) => ({ type: 'metars', data: extractData(data) }))
              .catch((err) => ({ type: 'metars', error: err.message }))
          );
        }

        // PIREPs (if enabled)
        if (overlays.pireps) {
          promises.push(
            (wsRequest && wsConnected
              ? wsRequest('pireps', {
                  ...baseParams,
                  radius: Math.round(radarRange * 1.5),
                  hours: 3,
                })
              : fetchHttp('pireps', {
                  ...baseParams,
                  radius: Math.round(radarRange * 1.5),
                  hours: 3,
                })
            )
              .then((data) => ({ type: 'pireps', data: extractData(data) }))
              .catch((err) => ({ type: 'pireps', error: err.message }))
          );
        }

        const results = await Promise.all(promises);

        // Update state with results
        setAviationData((prev) => {
          const updated = { ...prev };
          results.forEach((result) => {
            if (!result.error && result.data) {
              updated[result.type] = result.data;
            }
          });
          return updated;
        });

        const errors = results.filter((r) => r.error);
        if (errors.length > 0) {
          console.warn('Some aviation data requests failed:', errors);
        }
      } catch (err) {
        console.log('Aviation data fetch error:', err.message);
      }
    };

    // Debounce the fetch to wait for pan/zoom to settle
    const debounceTimeout = setTimeout(() => {
      fetchAviationData();
    }, 500);

    // Refresh every 5 minutes
    const interval = setInterval(fetchAviationData, 300000);

    return () => {
      clearTimeout(debounceTimeout);
      clearInterval(interval);
    };
  }, [
    wsRequest,
    wsConnected,
    config.apiBaseUrl,
    viewportCenter.lat,
    viewportCenter.lon,
    feederLat,
    feederLon,
    radarRange,
    overlays.metars,
    overlays.pireps,
    overlays.airspace,
    isProPanning,
  ]);

  // Fetch terrain overlay data (pro mode only) - simplified GeoJSON boundaries
  useEffect(() => {
    if (config.mapMode !== 'pro') return;

    const needsAny = overlays.water || overlays.counties || overlays.states || overlays.countries;
    if (!needsAny) return;

    // Helper to convert GeoJSON to our simplified format with viewport filtering
    const processGeoJSON = (geojson, filterBounds) => {
      const features = [];
      const { minLat, maxLat, minLon, maxLon } = filterBounds;

      const processCoords = (coords, type) => {
        const isNearViewport = coords.some(
          ([lon, lat]) =>
            lat >= minLat - 2 && lat <= maxLat + 2 && lon >= minLon - 2 && lon <= maxLon + 2
        );
        if (isNearViewport) {
          features.push({ type, coords });
        }
      };

      geojson.features?.forEach((feature) => {
        const geomType = feature.geometry?.type;
        const coords = feature.geometry?.coordinates;
        if (!coords) return;

        if (geomType === 'Polygon') {
          coords.forEach((ring) => processCoords(ring, 'polygon'));
        } else if (geomType === 'MultiPolygon') {
          coords.forEach((poly) => poly.forEach((ring) => processCoords(ring, 'polygon')));
        } else if (geomType === 'LineString') {
          processCoords(coords, 'line');
        } else if (geomType === 'MultiLineString') {
          coords.forEach((line) => processCoords(line, 'line'));
        }
      });
      return features;
    };

    const degPerNm = 1 / 60;
    const lonScale = Math.cos((feederLat * Math.PI) / 180);
    const filterBounds = {
      minLat: feederLat - radarRange * degPerNm * 2,
      maxLat: feederLat + radarRange * degPerNm * 2,
      minLon: feederLon - (radarRange * degPerNm * 2) / lonScale,
      maxLon: feederLon + (radarRange * degPerNm * 2) / lonScale,
    };

    const dataUrls = {
      countries:
        'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson',
      states:
        'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json',
      counties:
        'https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json',
      // Water - 50m resolution lakes and rivers
      lakes:
        'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/50m/physical/ne_50m_lakes.json',
      rivers:
        'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/50m/physical/ne_50m_rivers_lake_centerlines.json',
    };

    const fetchTerrain = async (type, url) => {
      try {
        console.log(`Fetching ${type} terrain data from:`, url);
        const resp = await fetch(url);
        if (!resp.ok) {
          console.warn(`Failed to fetch ${type}: HTTP ${resp.status}`);
          return [];
        }
        // External GeoJSON files may not have application/json content-type
        // so we try to parse JSON regardless of content-type
        let geojson;
        try {
          geojson = await resp.json();
        } catch (e) {
          console.warn(`Failed to fetch ${type}: invalid JSON`);
          return [];
        }
        const processed = processGeoJSON(geojson, filterBounds);
        console.log(`Processed ${type}: ${processed.length} features`);
        return processed;
      } catch (err) {
        console.warn(`Failed to fetch ${type} terrain data:`, err.message);
        return [];
      }
    };

    const loadTerrainData = async () => {
      const updates = {};
      if (overlays.countries && !terrainData.countries) {
        updates.countries = await fetchTerrain('countries', dataUrls.countries);
      }
      if (overlays.states && !terrainData.states) {
        updates.states = await fetchTerrain('states', dataUrls.states);
      }
      if (overlays.water && !terrainData.water) {
        // Fetch both lakes and rivers, combine them
        const [lakes, rivers] = await Promise.all([
          fetchTerrain('lakes', dataUrls.lakes),
          fetchTerrain('rivers', dataUrls.rivers),
        ]);
        updates.water = [...lakes, ...rivers];
        console.log(`Combined water features: ${updates.water.length}`);
      }
      if (overlays.counties && !terrainData.counties) {
        updates.counties = await fetchTerrain('counties', dataUrls.counties);
      }
      if (Object.keys(updates).length > 0) {
        console.log('Updating terrain data:', Object.keys(updates));
        setTerrainData((prev) => ({ ...prev, ...updates }));
      }
    };

    loadTerrainData();
  }, [
    config.mapMode,
    overlays.water,
    overlays.counties,
    overlays.states,
    overlays.countries,
    feederLat,
    feederLon,
    radarRange,
    terrainData.countries,
    terrainData.states,
    terrainData.water,
    terrainData.counties,
  ]);

  // Fetch aviation overlay data (pro mode only) - tar1090 GeoJSON from API with browser caching
  useEffect(() => {
    if (config.mapMode !== 'pro') return;

    const needsAny =
      overlays.usArtcc ||
      overlays.usRefueling ||
      overlays.ukMilZones ||
      overlays.euMilAwacs ||
      overlays.trainingAreas;
    if (!needsAny) return;

    const apiBase = config.apiBaseUrl || '';

    // Helper to fetch GeoJSON from API (browser will cache via Cache-Control header)
    const fetchAviationGeoJSON = async (dataTypes) => {
      const allFeatures = [];
      for (const dataType of dataTypes) {
        try {
          const resp = await fetch(`${apiBase}/api/v1/aviation/geojson/${dataType}`);
          const data = await safeJson(resp);
          if (!data) {
            console.warn(`Failed to fetch ${dataType}: invalid response`);
            continue;
          }
          if (data.features) {
            // Tag features with their source type for styling
            data.features.forEach((f) => {
              f.properties = f.properties || {};
              f.properties._sourceType = dataType;
            });
            allFeatures.push(...data.features);
          }
        } catch (err) {
          console.warn(`Failed to fetch ${dataType}:`, err.message);
        }
      }
      return allFeatures;
    };

    // Helper to convert GeoJSON features to simplified format for canvas rendering
    const processFeatures = (features, filterBounds) => {
      const result = [];
      const { minLat, maxLat, minLon, maxLon } = filterBounds;

      features.forEach((feature) => {
        const geomType = feature.geometry?.type;
        const coords = feature.geometry?.coordinates;
        if (!coords) return;

        const processCoords = (coordArray, type) => {
          // Check if any point is near viewport
          const isNearViewport = coordArray.some(
            ([lon, lat]) =>
              lat >= minLat - 5 && lat <= maxLat + 5 && lon >= minLon - 5 && lon <= maxLon + 5
          );
          if (isNearViewport) {
            result.push({
              type,
              coords: coordArray,
              name: feature.properties?.name || feature.properties?.NAME || feature.id,
              sourceType: feature.properties?._sourceType,
            });
          }
        };

        if (geomType === 'Polygon') {
          coords.forEach((ring) => processCoords(ring, 'polygon'));
        } else if (geomType === 'MultiPolygon') {
          coords.forEach((poly) => poly.forEach((ring) => processCoords(ring, 'polygon')));
        } else if (geomType === 'LineString') {
          processCoords(coords, 'line');
        } else if (geomType === 'MultiLineString') {
          coords.forEach((line) => processCoords(line, 'line'));
        } else if (geomType === 'Point') {
          result.push({
            type: 'point',
            coords: coords,
            name: feature.properties?.name || feature.properties?.NAME || feature.id,
            sourceType: feature.properties?._sourceType,
          });
        }
      });
      return result;
    };

    const degPerNm = 1 / 60;
    const lonScale = Math.cos((feederLat * Math.PI) / 180);
    const filterBounds = {
      minLat: feederLat - radarRange * degPerNm * 2,
      maxLat: feederLat + radarRange * degPerNm * 2,
      minLon: feederLon - (radarRange * degPerNm * 2) / lonScale,
      maxLon: feederLon + (radarRange * degPerNm * 2) / lonScale,
    };

    const loadAviationData = async () => {
      const updates = {};

      if (overlays.usArtcc && !aviationOverlayData.usArtcc) {
        const features = await fetchAviationGeoJSON(['us_artcc']);
        updates.usArtcc = processFeatures(features, filterBounds);
        console.log(`Loaded US ARTCC: ${updates.usArtcc.length} features`);
      }

      if (overlays.usRefueling && !aviationOverlayData.usRefueling) {
        const features = await fetchAviationGeoJSON(['us_a2a_refueling']);
        updates.usRefueling = processFeatures(features, filterBounds);
        console.log(`Loaded US Refueling: ${updates.usRefueling.length} features`);
      }

      if (overlays.ukMilZones && !aviationOverlayData.ukMilZones) {
        const features = await fetchAviationGeoJSON(['uk_mil_awacs', 'uk_mil_aar', 'uk_mil_rc']);
        updates.ukMilZones = processFeatures(features, filterBounds);
        console.log(`Loaded UK Mil Zones: ${updates.ukMilZones.length} features`);
      }

      if (overlays.euMilAwacs && !aviationOverlayData.euMilAwacs) {
        const features = await fetchAviationGeoJSON([
          'de_mil_awacs',
          'nl_mil_awacs',
          'pl_mil_awacs',
        ]);
        updates.euMilAwacs = processFeatures(features, filterBounds);
        console.log(`Loaded EU AWACS: ${updates.euMilAwacs.length} features`);
      }

      if (overlays.trainingAreas && !aviationOverlayData.trainingAreas) {
        const features = await fetchAviationGeoJSON([
          'ift_nav_routes',
          'ift_training_areas',
          'usafa_training_areas',
        ]);
        updates.trainingAreas = processFeatures(features, filterBounds);
        console.log(`Loaded Training Areas: ${updates.trainingAreas.length} features`);
      }

      if (Object.keys(updates).length > 0) {
        console.log('Updating aviation overlay data:', Object.keys(updates));
        setAviationOverlayData((prev) => ({ ...prev, ...updates }));
      }
    };

    loadAviationData();
  }, [
    config.mapMode,
    config.apiBaseUrl,
    overlays.usArtcc,
    overlays.usRefueling,
    overlays.ukMilZones,
    overlays.euMilAwacs,
    overlays.trainingAreas,
    feederLat,
    feederLon,
    radarRange,
    aviationOverlayData.usArtcc,
    aviationOverlayData.usRefueling,
    aviationOverlayData.ukMilZones,
    aviationOverlayData.euMilAwacs,
    aviationOverlayData.trainingAreas,
  ]);

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

    // Debug: Log aircraft data received by MapView
    console.log(
      '[MapView] sortedAircraft memo running, received',
      sourceAircraft?.length ?? 0,
      isPlayback ? 'playback aircraft' : 'live aircraft'
    );
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

  // Calculate distance from feeder in nm
  const getDistanceNm = (lat, lon) => {
    const dLat = lat - feederLat;
    const dLon = lon - feederLon;
    const latNm = dLat * 60;
    const lonNm = dLon * 60 * Math.cos((feederLat * Math.PI) / 180);
    return Math.sqrt(latNm * latNm + lonNm * lonNm);
  };

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

  // Get color class for speed based on value and altitude (for pro panel)
  const _getSpeedColorClass = (speed, altitude) => {
    if (!speed) return '';
    const isBelowTransition = altitude && altitude < 10000;
    const isOverLimit = isBelowTransition && speed > 250;
    if (isOverLimit) return 'speed-violation';
    if (speed > 500) return 'speed-high';
    if (speed > 300) return 'speed-medium';
    return 'speed-normal';
  };

  // Get color class for altitude (for pro panel)
  const _getAltitudeColorClass = (altitude) => {
    if (!altitude) return '';
    if (altitude >= 40000) return 'alt-fl400';
    if (altitude >= 30000) return 'alt-fl300';
    if (altitude >= 20000) return 'alt-fl200';
    if (altitude >= 10000) return 'alt-fl100';
    if (altitude >= 5000) return 'alt-5k';
    return 'alt-low';
  };

  // Get signal strength class based on RSSI
  // RSSI typically ranges from about -20 (excellent) to -50 (poor) dBFS
  const _getSignalStrengthClass = (rssi) => {
    if (rssi > -20) return 'excellent';
    if (rssi > -30) return 'good';
    if (rssi > -40) return 'fair';
    return 'weak';
  };

  // Update aircraft history for trails
  useEffect(() => {
    if (config.mapMode !== 'crt') return;

    const now = Date.now();
    sortedAircraft.forEach((ac) => {
      if (!ac.hex) return;
      if (!historyRef.current[ac.hex]) {
        historyRef.current[ac.hex] = [];
      }
      const history = historyRef.current[ac.hex];
      // Add position if moved significantly or first position
      if (
        history.length === 0 ||
        Math.abs(history[history.length - 1].lat - ac.lat) > 0.001 ||
        Math.abs(history[history.length - 1].lon - ac.lon) > 0.001
      ) {
        history.push({ lat: ac.lat, lon: ac.lon, time: now });
      }
      // Keep only last 60 seconds of history (about 6 positions at 10s intervals)
      while (history.length > 0 && now - history[0].time > 60000) {
        history.shift();
      }
    });

    // Clean up old aircraft
    const activeHexes = new Set(sortedAircraft.map((a) => a.hex));
    Object.keys(historyRef.current).forEach((hex) => {
      if (!activeHexes.has(hex)) {
        delete historyRef.current[hex];
      }
    });
  }, [sortedAircraft, config.mapMode]);

  // Update track history for turn rate calculation (pro mode velocity vectors)
  useEffect(() => {
    if (config.mapMode !== 'crt' && config.mapMode !== 'pro') return;

    const now = Date.now();
    sortedAircraft.forEach((ac) => {
      if (!ac.hex || ac.track == null) return;

      if (!trackHistoryRef.current[ac.hex]) {
        trackHistoryRef.current[ac.hex] = [];
      }
      const history = trackHistoryRef.current[ac.hex];

      // Add track sample if different from last or first sample
      const lastTrack = history.length > 0 ? history[history.length - 1].track : null;
      if (lastTrack === null || Math.abs(ac.track - lastTrack) > 0.5) {
        history.push({ track: ac.track, time: now });
      }

      // Keep only last 10 seconds of track history for turn rate calculation
      while (history.length > 0 && now - history[0].time > 10000) {
        history.shift();
      }
    });

    // Clean up old aircraft
    const activeHexes = new Set(sortedAircraft.map((a) => a.hex));
    Object.keys(trackHistoryRef.current).forEach((hex) => {
      if (!activeHexes.has(hex)) {
        delete trackHistoryRef.current[hex];
      }
    });
  }, [sortedAircraft, config.mapMode]);

  // CRT Radar Canvas Drawing (also handles Pro mode)
  useEffect(() => {
    if (config.mapMode !== 'crt' && config.mapMode !== 'pro') return;
    if (!canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    const ctx = canvas.getContext('2d');

    // Bug fix #5: Track all event listeners for guaranteed cleanup
    // Store references to handlers to ensure we remove the exact same functions we added
    const eventListeners = [];
    const addTrackedListener = (target, event, handler, options) => {
      target.addEventListener(event, handler, options);
      eventListeners.push({ target, event, handler, options });
    };

    // Set canvas size to match container
    const resize = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    addTrackedListener(window, 'resize', resize);

    // Scroll to zoom - smooth increments
    // When zooming, scale the pan offset so the view stays centered on the same geographic point
    const handleWheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 1.1 : 0.9; // 10% zoom per scroll
      const newRange = Math.round(radarRange * delta);
      const clampedRange = Math.max(5, Math.min(500, newRange));
      if (clampedRange !== radarRange) {
        // Scale factor: when range increases, pixelsPerNm decreases, so offset should scale inversely
        const scaleFactor = radarRange / clampedRange;
        setProPanOffset((prev) => ({
          x: prev.x * scaleFactor,
          y: prev.y * scaleFactor,
        }));
        updateRadarRange(clampedRange);
      }
    };
    addTrackedListener(canvas, 'wheel', handleWheel, { passive: false });

    // Pinch-to-zoom and two-finger pan for touch devices
    const getTouchDistance = (touches) => {
      if (touches.length < 2) return 0;
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const getTouchCenter = (touches) => {
      if (touches.length < 2) return { x: 0, y: 0 };
      return {
        x: (touches[0].clientX + touches[1].clientX) / 2,
        y: (touches[0].clientY + touches[1].clientY) / 2,
      };
    };

    const handleTouchStart = (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const center = getTouchCenter(e.touches);
        pinchStateRef.current = {
          lastDistance: getTouchDistance(e.touches),
          startRange: radarRange,
          lastCenterX: center.x,
          lastCenterY: center.y,
          startPanX: proPanOffset.x,
          startPanY: proPanOffset.y,
        };
      }
    };

    const handleTouchMove = (e) => {
      const { lastDistance, startRange, lastCenterX, lastCenterY, startPanX, startPanY } =
        pinchStateRef.current;
      if (e.touches.length === 2 && lastDistance > 0) {
        e.preventDefault();
        const currentDistance = getTouchDistance(e.touches);
        const currentCenter = getTouchCenter(e.touches);

        // Calculate pinch-to-zoom
        // Pinch out (fingers apart) = zoom in (smaller range)
        // Pinch in (fingers together) = zoom out (larger range)
        const scale = lastDistance / currentDistance;
        const newRange = Math.round(startRange * scale);
        const clampedRange = Math.max(5, Math.min(500, newRange));

        // Calculate two-finger pan (delta from start position)
        const panDeltaX = currentCenter.x - lastCenterX;
        const panDeltaY = currentCenter.y - lastCenterY;

        // Apply zoom if changed
        if (clampedRange !== radarRange) {
          const scaleFactor = radarRange / clampedRange;
          setProPanOffset((prev) => ({
            x: prev.x * scaleFactor,
            y: prev.y * scaleFactor,
          }));
          updateRadarRange(clampedRange);
        }

        // Apply pan offset (add delta to starting position)
        setProPanOffset({
          x: startPanX + panDeltaX,
          y: startPanY + panDeltaY,
        });
      }
    };

    const handleTouchEnd = (e) => {
      if (e.touches.length < 2) {
        pinchStateRef.current = {
          lastDistance: 0,
          startRange: radarRange,
          lastCenterX: 0,
          lastCenterY: 0,
          startPanX: 0,
          startPanY: 0,
        };
      }
    };

    addTrackedListener(canvas, 'touchstart', handleTouchStart, { passive: false });
    addTrackedListener(canvas, 'touchmove', handleTouchMove, { passive: false });
    addTrackedListener(canvas, 'touchend', handleTouchEnd);

    // Use fetched aviation data or fallback to static
    const navAids =
      aviationData.navaids.length > 0
        ? aviationData.navaids
        : [
            { id: 'SEA', name: 'Seattle VORTAC', lat: 47.435, lon: -122.309, type: 'VORTAC' },
            { id: 'PAE', name: 'Paine Field', lat: 47.906, lon: -122.283, type: 'VOR/DME' },
            { id: 'BFI', name: 'Boeing Field', lat: 47.529, lon: -122.302, type: 'VOR/DME' },
            { id: 'TCM', name: 'McChord', lat: 47.136, lon: -122.476, type: 'TACAN' },
            { id: 'OLM', name: 'Olympia', lat: 46.969, lon: -122.902, type: 'VOR/DME' },
            { id: 'EPH', name: 'Ephrata', lat: 47.385, lon: -119.515, type: 'VOR/DME' },
            { id: 'ELN', name: 'Ellensburg', lat: 47.033, lon: -120.53, type: 'VOR/DME' },
            { id: 'YYJ', name: 'Victoria', lat: 48.647, lon: -123.426, type: 'VOR/DME' },
            { id: 'CV', name: 'Coupeville', lat: 48.188, lon: -122.688, type: 'NDB' },
            { id: 'BTG', name: 'Battleground', lat: 45.816, lon: -122.531, type: 'VOR/DME' },
            { id: 'UBG', name: 'Bellingham', lat: 48.795, lon: -122.538, type: 'VOR/DME' },
            { id: 'GEG', name: 'Spokane', lat: 47.625, lon: -117.539, type: 'VORTAC' },
          ];

    const airports =
      aviationData.airports.length > 0
        ? aviationData.airports
        : [
            { icao: 'KSEA', name: 'Seattle-Tacoma', lat: 47.449, lon: -122.309, class: 'B' },
            { icao: 'KBFI', name: 'Boeing Field', lat: 47.529, lon: -122.302, class: 'D' },
            { icao: 'KPAE', name: 'Paine Field', lat: 47.906, lon: -122.283, class: 'D' },
            { icao: 'KPDX', name: 'Portland Intl', lat: 45.589, lon: -122.597, class: 'C' },
            { icao: 'KGEG', name: 'Spokane', lat: 47.62, lon: -117.534, class: 'C' },
          ];

    // Combine airspace advisories and boundaries from API, or use static fallback
    const rawAirspaceData =
      aviationData.airspaces.length > 0 || aviationData.boundaries.length > 0
        ? [...aviationData.airspaces, ...aviationData.boundaries]
        : [
            {
              name: 'Seattle Class B',
              type: 'CLASS_B',
              class: 'B',
              isBoundary: true,
              center: { lat: 47.449, lon: -122.309 },
              rings: [
                { radius_nm: 10, floor_ft: 0, ceiling_ft: 10000 },
                { radius_nm: 20, floor_ft: 3000, ceiling_ft: 10000 },
                { radius_nm: 30, floor_ft: 6000, ceiling_ft: 10000 },
              ],
            },
          ];

    // Filter airspace by type based on user preferences
    const airspaceData = rawAirspaceData.filter((as) => {
      const asClass = as.class || as.airspace_class || as.type?.replace('CLASS_', '') || '';
      // Check if this airspace type is enabled
      if (airspaceTypeFilters[asClass] !== undefined) {
        return airspaceTypeFilters[asClass];
      }
      // For G-AIRMETs and other advisories, filter by hazard type
      if (as.isAdvisory && as.hazard) {
        if (weatherAdvisoryFilters[as.hazard] !== undefined) {
          return weatherAdvisoryFilters[as.hazard];
        }
      }
      // Default to showing unknown types
      return true;
    });

    // Animation loop
    const isPro = config.mapMode === 'pro';
    // Phase 5.1: Get theme colors for Pro mode (using hook)
    const themeColors = isPro ? proThemeColors : null;
    let frameCount = 0;
    const draw = () => {
      frameCount++;
      const width = canvas.width / window.devicePixelRatio;
      const height = canvas.height / window.devicePixelRatio;
      const centerX = width / 2;
      const centerY = height / 2;
      // For Pro mode: use full rectangular area
      // For CRT mode: use circular area that fills more of the canvas
      const maxRadius = isPro
        ? Math.max(width, height) * 0.5 // Pro: allow overflow for rectangular
        : Math.min(width, height) * 0.48; // CRT: fill more of the circle

      // Clear with dark background (theme-aware for Pro mode)
      ctx.fillStyle = isPro ? themeColors.bg() : '#0a0f0a';
      ctx.fillRect(0, 0, width, height);

      // For Pro mode, calculate scale to show full area (no circular limit)
      // _nmPerPixel tells us how many nm one pixel represents (kept for future use)
      const _nmPerPixel = isPro
        ? radarRange / (Math.min(width, height) * 0.45)
        : radarRange / maxRadius;

      // Helper to convert lat/lon to screen coordinates
      const latLonToScreen = (lat, lon) => {
        const dLat = lat - feederLat;
        const dLon = lon - feederLon;
        const nmY = dLat * 60; // North is up
        const nmX = dLon * 60 * Math.cos((feederLat * Math.PI) / 180);

        if (isPro) {
          // Pro mode: linear mapping, no circular constraint, with pan offset
          const pixelsPerNm = (Math.min(width, height) * 0.45) / radarRange;
          return {
            x: centerX + nmX * pixelsPerNm + proPanOffset.x,
            y: centerY - nmY * pixelsPerNm + proPanOffset.y, // Flip Y for screen coords
          };
        } else {
          // CRT mode: polar mapping with circular constraint
          const dist = Math.sqrt(nmX * nmX + nmY * nmY);
          const bearing = (Math.atan2(nmX, nmY) * 180) / Math.PI;
          const radius = (dist / radarRange) * maxRadius;
          const rad = ((bearing - 90) * Math.PI) / 180;
          return {
            x: centerX + Math.cos(rad) * radius,
            y: centerY + Math.sin(rad) * radius,
          };
        }
      };

      if (!isPro) {
        // Add subtle noise/texture (CRT only)
        ctx.fillStyle = 'rgba(0, 40, 0, 0.03)';
        for (let i = 0; i < 50; i++) {
          const x = Math.random() * width;
          const y = Math.random() * height;
          ctx.fillRect(x, y, 2, 2);
        }
      }

      if (isPro) {
        // PRO MODE: Draw lat/lon grid (with adjustable opacity) - theme-aware
        const gridAlpha = gridOpacity;
        const gridColor = themeColors.rgba('grid', gridAlpha);
        const gridLabelColor = themeColors.rgba('gridLabel', Math.min(0.7, gridAlpha * 2.3));
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.font = '12px "JetBrains Mono", monospace';
        ctx.fillStyle = gridLabelColor;

        // Calculate grid spacing based on range
        const degPerNm = 1 / 60;
        const gridSpacingDeg =
          radarRange <= 30 ? 0.25 : radarRange <= 75 ? 0.5 : radarRange <= 150 ? 1 : 2;

        // Latitude lines (horizontal)
        const minGridLat =
          Math.floor((feederLat - radarRange * degPerNm) / gridSpacingDeg) * gridSpacingDeg;
        const maxGridLat =
          Math.ceil((feederLat + radarRange * degPerNm) / gridSpacingDeg) * gridSpacingDeg;

        for (let lat = minGridLat; lat <= maxGridLat; lat += gridSpacingDeg) {
          const p1 = latLonToScreen(lat, feederLon - radarRange * degPerNm * 1.5);
          const _p2 = latLonToScreen(lat, feederLon + radarRange * degPerNm * 1.5);
          if (p1.y > 0 && p1.y < height) {
            ctx.beginPath();
            ctx.moveTo(0, p1.y);
            ctx.lineTo(width, p1.y);
            ctx.stroke();
            ctx.textAlign = 'left';
            ctx.fillText(`${lat.toFixed(2)}°`, 8, p1.y - 5);
          }
        }

        // Longitude lines (vertical)
        const lonScale = Math.cos((feederLat * Math.PI) / 180);
        const minGridLon =
          Math.floor((feederLon - (radarRange * degPerNm) / lonScale) / gridSpacingDeg) *
          gridSpacingDeg;
        const maxGridLon =
          Math.ceil((feederLon + (radarRange * degPerNm) / lonScale) / gridSpacingDeg) *
          gridSpacingDeg;

        for (let lon = minGridLon; lon <= maxGridLon; lon += gridSpacingDeg) {
          const p1 = latLonToScreen(feederLat, lon);
          if (p1.x > 0 && p1.x < width) {
            ctx.beginPath();
            ctx.moveTo(p1.x, 0);
            ctx.lineTo(p1.x, height);
            ctx.stroke();
            ctx.textAlign = 'center';
            ctx.fillText(`${Math.abs(lon).toFixed(2)}°${lon < 0 ? 'W' : 'E'}`, p1.x, height - 8);
          }
        }

        // Scale bar - theme-aware
        const scaleBarNm =
          radarRange <= 30 ? 10 : radarRange <= 75 ? 25 : radarRange <= 150 ? 50 : 100;
        const scaleBarPx = (scaleBarNm / radarRange) * (Math.min(width, height) * 0.45);
        const scaleBarY = height - 20;

        // Draw text clearly above the line
        ctx.fillStyle = themeColors.rgba('primary', 0.8);
        ctx.textAlign = 'center';
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.fillText(`${scaleBarNm} nm`, width - 20 - scaleBarPx / 2, scaleBarY - 10);

        // Draw the scale bar line below text
        ctx.strokeStyle = themeColors.rgba('primary', 0.6);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(width - 20 - scaleBarPx, scaleBarY);
        ctx.lineTo(width - 20, scaleBarY);
        // End caps (shorter)
        ctx.moveTo(width - 20 - scaleBarPx, scaleBarY - 3);
        ctx.lineTo(width - 20 - scaleBarPx, scaleBarY + 3);
        ctx.moveTo(width - 20, scaleBarY - 3);
        ctx.lineTo(width - 20, scaleBarY + 3);
        ctx.stroke();

        // PRO MODE: Add range rings (subtle, dashed)
        const proRingDistances =
          radarRange <= 30
            ? [10, 20, 30]
            : radarRange <= 75
              ? [25, 50, 75]
              : radarRange <= 150
                ? [50, 100, 150]
                : [100, 200, 300];

        const proPixelsPerNm = (Math.min(width, height) * 0.45) / radarRange;
        ctx.strokeStyle = themeColors.rgba('rangeRing', 0.4);
        ctx.lineWidth = 1;
        ctx.setLineDash([8, 8]);

        proRingDistances.forEach((dist) => {
          if (dist > radarRange * 1.2) return;
          const radius = dist * proPixelsPerNm;
          ctx.beginPath();
          ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
          ctx.stroke();

          // Range label (top of ring)
          ctx.fillStyle = themeColors.rgba('rangeLabel', 0.6);
          ctx.font = '11px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`${dist}nm`, centerX, centerY - radius - 4);
        });
        ctx.setLineDash([]);

        // PRO MODE: Compass rose (optional)
        if (showCompassRose) {
          const compassRadius = Math.min(width, height) * 0.43;
          const compassPoints = [
            { angle: 0, label: 'N', major: true },
            { angle: 45, label: 'NE', major: false },
            { angle: 90, label: 'E', major: true },
            { angle: 135, label: 'SE', major: false },
            { angle: 180, label: 'S', major: true },
            { angle: 225, label: 'SW', major: false },
            { angle: 270, label: 'W', major: true },
            { angle: 315, label: 'NW', major: false },
          ];

          // Draw 10-degree tick marks
          ctx.strokeStyle = themeColors.rgba('compass', 0.3);
          ctx.lineWidth = 1;
          for (let angle = 0; angle < 360; angle += 10) {
            const rad = ((angle - 90) * Math.PI) / 180;
            const isMajor = angle % 90 === 0;
            const isIntermediate = angle % 30 === 0;
            const tickLength = isMajor ? 15 : isIntermediate ? 10 : 5;
            ctx.beginPath();
            ctx.moveTo(
              centerX + Math.cos(rad) * (compassRadius - tickLength),
              centerY + Math.sin(rad) * (compassRadius - tickLength)
            );
            ctx.lineTo(
              centerX + Math.cos(rad) * compassRadius,
              centerY + Math.sin(rad) * compassRadius
            );
            ctx.stroke();
          }

          // Draw cardinal and intercardinal labels
          compassPoints.forEach(({ angle, label, major }) => {
            const rad = ((angle - 90) * Math.PI) / 180;
            ctx.fillStyle = major
              ? themeColors.rgba('compassMajor', 0.9)
              : themeColors.rgba('compass', 0.7);
            ctx.font = major
              ? 'bold 14px "JetBrains Mono", monospace'
              : '11px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const labelRadius = compassRadius + 15;
            ctx.fillText(
              label,
              centerX + Math.cos(rad) * labelRadius,
              centerY + Math.sin(rad) * labelRadius
            );
          });
        }
      } else {
        // CRT MODE: Draw range rings
        const ringDistances =
          radarRange <= 50
            ? [10, 20, 30, 40, 50]
            : radarRange <= 100
              ? [25, 50, 75, 100]
              : [50, 100, 150];

        ctx.strokeStyle = 'rgba(0, 180, 80, 0.4)';
        ctx.lineWidth = 1;

        ringDistances.forEach((dist) => {
          if (dist > radarRange) return;
          const radius = (dist / radarRange) * maxRadius;
          ctx.beginPath();
          ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
          ctx.stroke();

          // Range label
          ctx.fillStyle = 'rgba(0, 180, 80, 0.7)';
          ctx.font = '13px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`${dist}`, centerX, centerY - radius - 6);
        });

        // Draw compass lines and labels
        const compassPoints = [
          { angle: 0, label: 'N' },
          { angle: 90, label: 'E' },
          { angle: 180, label: 'S' },
          { angle: 270, label: 'W' },
        ];

        ctx.strokeStyle = 'rgba(0, 180, 80, 0.25)';
        ctx.lineWidth = 1;

        compassPoints.forEach(({ angle, label }) => {
          const rad = ((angle - 90) * Math.PI) / 180;
          ctx.beginPath();
          ctx.moveTo(centerX, centerY);
          ctx.lineTo(centerX + Math.cos(rad) * maxRadius, centerY + Math.sin(rad) * maxRadius);
          ctx.stroke();

          // Label
          ctx.fillStyle = 'rgba(0, 200, 100, 0.8)';
          ctx.font = 'bold 18px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const labelRadius = maxRadius + 22;
          ctx.fillText(
            label,
            centerX + Math.cos(rad) * labelRadius,
            centerY + Math.sin(rad) * labelRadius
          );
        });

        // Draw 30-degree lines
        ctx.strokeStyle = 'rgba(0, 180, 80, 0.15)';
        for (let angle = 30; angle < 360; angle += 30) {
          if (angle % 90 === 0) continue;
          const rad = ((angle - 90) * Math.PI) / 180;
          ctx.beginPath();
          ctx.moveTo(centerX + Math.cos(rad) * 20, centerY + Math.sin(rad) * 20);
          ctx.lineTo(centerX + Math.cos(rad) * maxRadius, centerY + Math.sin(rad) * maxRadius);
          ctx.stroke();
        }
      }

      // Draw center marker (feeder location)
      ctx.fillStyle = isPro ? 'rgba(100, 200, 255, 0.9)' : 'rgba(0, 255, 100, 0.8)';
      ctx.beginPath();
      ctx.arc(centerX, centerY, isPro ? 5 : 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = isPro ? 'rgba(100, 200, 255, 0.5)' : 'rgba(0, 255, 100, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(centerX - 10, centerY);
      ctx.lineTo(centerX + 10, centerY);
      ctx.moveTo(centerX, centerY - 10);
      ctx.lineTo(centerX, centerY + 10);
      ctx.stroke();

      // PRO MODE: Draw weather radar overlay (underneath other layers)
      if (isPro && overlays.radar && weatherRadarImage && weatherRadarBounds) {
        const radarOpacity = layerOpacities.radar ?? 0.5;
        drawWeatherRadar(ctx, latLonToScreen, radarOpacity);
      }

      // PRO MODE: Draw convective SIGMET polygons (above radar, below terrain)
      if (isPro && overlays.convectiveSigmets && convectiveSigmets.length > 0) {
        const sigmetOpacity = layerOpacities.convectiveSigmets ?? 0.8;
        drawSigmets(ctx, latLonToScreen, sigmetOpacity);
      }

      // PRO MODE: Draw terrain overlays (minimal context layers)
      if (isPro) {
        // Helper to draw GeoJSON-style polygon/line data
        const drawBoundaryPath = (coords, strokeColor, fillColor = null, lineWidth = 1) => {
          if (!coords || coords.length < 2) return;
          ctx.beginPath();
          coords.forEach((coord, i) => {
            const pos = latLonToScreen(coord[1], coord[0]); // GeoJSON is [lon, lat]
            if (i === 0) {
              ctx.moveTo(pos.x, pos.y);
            } else {
              ctx.lineTo(pos.x, pos.y);
            }
          });
          if (fillColor) {
            ctx.fillStyle = fillColor;
            ctx.fill();
          }
          if (strokeColor) {
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = lineWidth;
            ctx.stroke();
          }
        };

        // Water bodies (lakes, coastlines) - subtle blue
        if (overlays.water && terrainData.water?.length > 0) {
          terrainData.water.forEach((feature) => {
            if (feature.type === 'polygon') {
              drawBoundaryPath(
                feature.coords,
                'rgba(40, 120, 180, 0.5)',
                'rgba(20, 60, 100, 0.25)',
                1
              );
            } else {
              drawBoundaryPath(feature.coords, 'rgba(40, 120, 180, 0.4)', null, 1);
            }
          });
        }

        // Country boundaries - subtle white/gray
        if (overlays.countries && terrainData.countries?.length > 0) {
          terrainData.countries.forEach((feature) => {
            drawBoundaryPath(feature.coords, 'rgba(180, 180, 180, 0.5)', null, 1.5);
          });
        }

        // State/province boundaries - lighter
        if (overlays.states && terrainData.states?.length > 0) {
          terrainData.states.forEach((feature) => {
            drawBoundaryPath(feature.coords, 'rgba(120, 160, 200, 0.4)', null, 1);
          });
        }

        // County boundaries - very subtle
        if (overlays.counties && terrainData.counties?.length > 0) {
          terrainData.counties.forEach((feature) => {
            drawBoundaryPath(feature.coords, 'rgba(100, 130, 160, 0.25)', null, 0.5);
          });
        }

        // Aviation overlays - tar1090 GeoJSON data
        // US ARTCC boundaries - cyan dashed lines
        if (overlays.usArtcc && aviationOverlayData.usArtcc?.length > 0) {
          ctx.save();
          ctx.setLineDash([8, 4]);
          aviationOverlayData.usArtcc.forEach((feature) => {
            drawBoundaryPath(feature.coords, 'rgba(0, 200, 255, 0.6)', null, 1.5);
          });
          ctx.setLineDash([]);
          ctx.restore();
        }

        // US A2A Refueling tracks - yellow/orange lines
        if (overlays.usRefueling && aviationOverlayData.usRefueling?.length > 0) {
          ctx.save();
          ctx.setLineDash([6, 3]);
          aviationOverlayData.usRefueling.forEach((feature) => {
            if (feature.type === 'polygon') {
              drawBoundaryPath(
                feature.coords,
                'rgba(255, 180, 0, 0.7)',
                'rgba(255, 180, 0, 0.15)',
                2
              );
            } else {
              drawBoundaryPath(feature.coords, 'rgba(255, 180, 0, 0.8)', null, 2);
            }
          });
          ctx.setLineDash([]);
          ctx.restore();
        }

        // UK Military zones - magenta/purple
        if (overlays.ukMilZones && aviationOverlayData.ukMilZones?.length > 0) {
          ctx.save();
          ctx.setLineDash([5, 3]);
          aviationOverlayData.ukMilZones.forEach((feature) => {
            const isAwacs = feature.sourceType?.includes('awacs');
            const isAar = feature.sourceType?.includes('aar');
            if (isAwacs) {
              // AWACS orbits - purple dashed circles/polygons
              drawBoundaryPath(
                feature.coords,
                'rgba(180, 100, 255, 0.7)',
                'rgba(180, 100, 255, 0.1)',
                2
              );
            } else if (isAar) {
              // AAR zones - magenta
              drawBoundaryPath(
                feature.coords,
                'rgba(255, 50, 150, 0.7)',
                'rgba(255, 50, 150, 0.1)',
                2
              );
            } else {
              // RC (restricted/controlled) - red
              drawBoundaryPath(
                feature.coords,
                'rgba(255, 80, 80, 0.6)',
                'rgba(255, 80, 80, 0.1)',
                1.5
              );
            }
          });
          ctx.setLineDash([]);
          ctx.restore();
        }

        // EU AWACS orbits - purple circles
        if (overlays.euMilAwacs && aviationOverlayData.euMilAwacs?.length > 0) {
          ctx.save();
          ctx.setLineDash([5, 3]);
          aviationOverlayData.euMilAwacs.forEach((feature) => {
            drawBoundaryPath(
              feature.coords,
              'rgba(160, 80, 220, 0.7)',
              'rgba(160, 80, 220, 0.1)',
              2
            );
          });
          ctx.setLineDash([]);
          ctx.restore();
        }

        // Training areas - green
        if (overlays.trainingAreas && aviationOverlayData.trainingAreas?.length > 0) {
          ctx.save();
          ctx.setLineDash([4, 4]);
          aviationOverlayData.trainingAreas.forEach((feature) => {
            const isRoute = feature.sourceType?.includes('route');
            if (isRoute) {
              // Nav routes - green lines
              drawBoundaryPath(feature.coords, 'rgba(50, 200, 100, 0.8)', null, 2);
            } else {
              // Training areas - green polygons
              drawBoundaryPath(
                feature.coords,
                'rgba(50, 200, 100, 0.6)',
                'rgba(50, 200, 100, 0.1)',
                1.5
              );
            }
          });
          ctx.setLineDash([]);
          ctx.restore();
        }
      }

      // Draw VORs and Navaids (if overlay enabled)
      if (overlays.vors) {
        navAids.forEach((nav) => {
          const dist = getDistanceNm(nav.lat, nav.lon);
          if (!isPro && dist > radarRange * 1.1) return;
          if (isPro && dist > radarRange * 1.5) return;

          const pos = latLonToScreen(nav.lat, nav.lon);
          const x = pos.x;
          const y = pos.y;

          // Skip if outside canvas
          if (x < 0 || x > width || y < 0 || y > height) return;

          // Check if selected
          const isSelected =
            selectedNavaid && selectedNavaid.lat === nav.lat && selectedNavaid.lon === nav.lon;

          // Draw selection indicator
          if (isSelected) {
            ctx.save();
            ctx.strokeStyle = 'rgba(100, 220, 255, 0.9)';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.arc(x, y, 16, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
          }

          // Draw VOR symbol (hexagon)
          const vorSize = isPro ? 9 : 8;
          ctx.save();
          ctx.translate(x, y);

          const navType = nav.type || '';
          const baseColor = isSelected ? 1.0 : 0.7;
          if (navType.includes('VORTAC') || navType.includes('VOR')) {
            // Hexagon for VOR
            ctx.strokeStyle = isPro
              ? `rgba(80, 140, 220, ${baseColor + 0.1})`
              : `rgba(100, 150, 255, ${baseColor})`;
            ctx.lineWidth = isSelected ? 2 : 1.5;
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
              const angle = ((i * 60 - 30) * Math.PI) / 180;
              const px = Math.cos(angle) * vorSize;
              const py = Math.sin(angle) * vorSize;
              if (i === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.stroke();

            // Center dot
            ctx.fillStyle = isPro
              ? `rgba(80, 140, 220, ${baseColor + 0.2})`
              : `rgba(100, 150, 255, ${baseColor + 0.1})`;
            ctx.beginPath();
            ctx.arc(0, 0, 2, 0, Math.PI * 2);
            ctx.fill();
          } else if (navType.includes('TACAN')) {
            // Triangle for TACAN
            ctx.strokeStyle = `rgba(255, 150, 100, ${baseColor})`;
            ctx.lineWidth = isSelected ? 2 : 1.5;
            ctx.beginPath();
            ctx.moveTo(0, -vorSize);
            ctx.lineTo(vorSize * 0.866, vorSize * 0.5);
            ctx.lineTo(-vorSize * 0.866, vorSize * 0.5);
            ctx.closePath();
            ctx.stroke();
          } else if (navType.includes('NDB')) {
            // Circle with dots for NDB
            ctx.strokeStyle = `rgba(200, 100, 255, ${baseColor - 0.1})`;
            ctx.lineWidth = isSelected ? 1.5 : 1;
            ctx.beginPath();
            ctx.arc(0, 0, vorSize, 0, Math.PI * 2);
            ctx.stroke();
          }

          ctx.restore();

          // Label with background
          ctx.font = isSelected
            ? 'bold 12px "JetBrains Mono", monospace'
            : '12px "JetBrains Mono", monospace';
          const navLabelWidth = ctx.measureText(nav.id).width + 6;
          ctx.fillStyle = isPro ? 'rgba(10, 13, 18, 0.8)' : 'rgba(10, 15, 10, 0.75)';
          ctx.fillRect(x + 7, y - 6, navLabelWidth, 16);
          ctx.fillStyle = isPro
            ? `rgba(80, 140, 220, ${baseColor + 0.1})`
            : `rgba(100, 150, 255, ${baseColor})`;
          ctx.textAlign = 'left';
          ctx.fillText(nav.id, x + 10, y + 4);
        });
      }

      // Draw airports (if overlay enabled)
      if (overlays.airports) {
        airports.forEach((apt) => {
          const dist = getDistanceNm(apt.lat, apt.lon);
          if (!isPro && dist > radarRange * 1.1) return;
          if (isPro && dist > radarRange * 1.5) return;

          const pos = latLonToScreen(apt.lat, apt.lon);
          const x = pos.x;
          const y = pos.y;

          if (x < 0 || x > width || y < 0 || y > height) return;

          // Check if selected
          const isSelected =
            selectedAirport && selectedAirport.lat === apt.lat && selectedAirport.lon === apt.lon;

          // Draw selection indicator
          if (isSelected) {
            ctx.save();
            ctx.strokeStyle = 'rgba(100, 220, 255, 0.9)';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.arc(x, y, 18, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
          }

          // Airport symbol based on class
          ctx.save();
          ctx.translate(x, y);

          const aptClass = apt.class || 'E';
          let color = 'rgba(180, 180, 180, 0.6)';
          let hasMetar = false;
          let aptMetar = null;

          // Check for METAR-based flight category coloring (Pro mode feature)
          if (
            overlays.airportFlightCategory &&
            aviationData.metars &&
            aviationData.metars.length > 0
          ) {
            aptMetar = findMetarForAirport(apt, aviationData.metars);
            if (aptMetar) {
              hasMetar = true;
              color = getFlightCategoryColor(aptMetar, true);
            }
          }

          // Fall back to airspace class coloring if no METAR
          if (!hasMetar) {
            if (aptClass === 'B') color = 'rgba(100, 150, 255, 0.7)';
            else if (aptClass === 'C') color = 'rgba(200, 100, 200, 0.7)';
            else if (aptClass === 'D') color = 'rgba(100, 200, 100, 0.7)';
          }

          // Brighten if selected
          if (isSelected) {
            color = color.replace(/[\d.]+\)$/, '1)');
          }

          ctx.strokeStyle = color;
          ctx.lineWidth = isSelected ? 1.5 : 1;

          // Draw runway symbol (circle with lines)
          ctx.beginPath();
          ctx.arc(0, 0, isSelected ? 5 : 4, 0, Math.PI * 2);
          if (hasMetar) {
            ctx.fillStyle = color;
            ctx.fill();
          }
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(isSelected ? -10 : -8, 0);
          ctx.lineTo(isSelected ? 10 : 8, 0);
          ctx.stroke();

          // TAF indicator (small dot in upper right if TAF available)
          const aptId = apt.icao || apt.icaoId || apt.faaId || apt.id || 'APT';
          if (overlays.tafs && stationsWithTaf && stationsWithTaf.has(aptId.toUpperCase())) {
            const aptTaf = getTafForAirport(apt);
            if (aptTaf) {
              // Draw TAF indicator dot
              ctx.beginPath();
              ctx.arc(6, -6, 3, 0, Math.PI * 2);
              // Color based on worst forecast category
              const worstCat = aptTaf.forecastCategories?.includes('LIFR')
                ? 'LIFR'
                : aptTaf.forecastCategories?.includes('IFR')
                  ? 'IFR'
                  : aptTaf.forecastCategories?.includes('MVFR')
                    ? 'MVFR'
                    : 'VFR';
              const tafColors = {
                VFR: 'rgba(0, 200, 80, 0.9)',
                MVFR: 'rgba(80, 120, 255, 0.9)',
                IFR: 'rgba(255, 80, 80, 0.9)',
                LIFR: 'rgba(255, 50, 200, 0.9)',
              };
              ctx.fillStyle = tafColors[worstCat] || 'rgba(200, 200, 200, 0.9)';
              ctx.fill();
              ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
              ctx.lineWidth = 1;
              ctx.stroke();

              // Pulsing ring for IFR transitions
              if (aptTaf.hasIfrTransition) {
                ctx.beginPath();
                ctx.arc(6, -6, 5, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255, 100, 100, 0.4)';
                ctx.lineWidth = 1;
                ctx.stroke();
              }
            }
          }

          ctx.restore();

          // Label with background - add flight category if has METAR
          const labelSuffix = hasMetar ? ` ${aptMetar.fltCat || 'VFR'}` : '';
          const fullLabel = aptId + labelSuffix;
          ctx.font = isSelected
            ? 'bold 11px "JetBrains Mono", monospace'
            : '11px "JetBrains Mono", monospace';
          const aptLabelWidth = ctx.measureText(fullLabel).width + 6;
          ctx.fillStyle = isPro ? 'rgba(10, 13, 18, 0.8)' : 'rgba(10, 15, 10, 0.75)';
          ctx.fillRect(x + 7, y - 6, aptLabelWidth, 15);
          ctx.fillStyle = color;
          ctx.textAlign = 'left';
          ctx.fillText(fullLabel, x + 10, y + 4);
        });
      }

      // Draw airspace (if overlay enabled)
      if (overlays.airspace) {
        // Helper to get airspace color based on type/class
        const getAirspaceColor = (as) => {
          const asClass = as.class || as.airspace_class || as.type?.replace('CLASS_', '');
          if (asClass === 'B' || as.type === 'CLASS_B') return 'rgba(80, 120, 200, 0.35)';
          if (asClass === 'C' || as.type === 'CLASS_C') return 'rgba(180, 80, 180, 0.35)';
          if (asClass === 'D' || as.type === 'CLASS_D') return 'rgba(80, 180, 180, 0.35)';
          if (asClass === 'E' || as.type === 'CLASS_E') return 'rgba(100, 150, 100, 0.25)';
          if (asClass === 'RESTRICTED' || as.type === 'RESTRICTED') return 'rgba(200, 80, 80, 0.4)';
          if (asClass === 'PROHIBITED' || as.type === 'PROHIBITED') return 'rgba(255, 50, 50, 0.5)';
          if (asClass === 'WARNING' || as.type === 'WARNING') return 'rgba(255, 180, 50, 0.35)';
          if (asClass === 'MOA' || as.type === 'MOA') return 'rgba(200, 150, 80, 0.3)';
          if (asClass === 'ALERT' || as.type === 'ALERT') return 'rgba(255, 150, 80, 0.35)';
          if (asClass === 'TFR' || as.type === 'TFR') return 'rgba(255, 80, 80, 0.5)';
          return 'rgba(100, 100, 200, 0.3)';
        };

        airspaceData.forEach((as) => {
          const asColor = getAirspaceColor(as);

          // Extract polygon coordinates - handle GeoJSON and simple array formats
          let polygonCoords = null;
          if (as.polygon) {
            if (Array.isArray(as.polygon) && as.polygon.length >= 3) {
              // Simple array format: [[lon, lat], ...]
              polygonCoords = as.polygon;
            } else if (as.polygon.type === 'Polygon' && as.polygon.coordinates?.[0]) {
              // GeoJSON Polygon: {type: "Polygon", coordinates: [[[lon, lat], ...]]}
              polygonCoords = as.polygon.coordinates[0];
            } else if (as.polygon.type === 'MultiPolygon' && as.polygon.coordinates?.[0]?.[0]) {
              // GeoJSON MultiPolygon - use first polygon
              polygonCoords = as.polygon.coordinates[0][0];
            }
          }

          // Draw polygon boundaries (from API)
          if (polygonCoords && polygonCoords.length >= 3) {
            ctx.strokeStyle = asColor;
            ctx.fillStyle = asColor.replace(/[\d.]+\)$/, '0.1)'); // Lighter fill
            ctx.lineWidth = isPro ? 2 : 1.5;
            ctx.setLineDash([8, 4]);

            ctx.beginPath();
            polygonCoords.forEach((coord, idx) => {
              // Polygon coords are [lon, lat] format
              const lon = Array.isArray(coord) ? coord[0] : coord.lon;
              const lat = Array.isArray(coord) ? coord[1] : coord.lat;
              const screenPos = latLonToScreen(lat, lon);

              if (idx === 0) {
                ctx.moveTo(screenPos.x, screenPos.y);
              } else {
                ctx.lineTo(screenPos.x, screenPos.y);
              }
            });
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.setLineDash([]);

            // Draw label at center (if labels enabled)
            if (as.name && showAirspaceLabels) {
              const asCenter = as.center || {
                lat: as.center_lat || as.lat,
                lon: as.center_lon || as.lon,
              };
              if (asCenter?.lat && asCenter?.lon) {
                const labelPos = latLonToScreen(asCenter.lat, asCenter.lon);
                ctx.fillStyle = asColor.replace(/[\d.]+\)$/, '0.8)');
                ctx.font = isPro
                  ? 'bold 12px "JetBrains Mono", monospace'
                  : '11px "JetBrains Mono", monospace';
                ctx.textAlign = 'center';
                ctx.fillText(as.name, labelPos.x, labelPos.y);
                if (as.floor_ft !== undefined && as.ceiling_ft !== undefined) {
                  ctx.font = isPro
                    ? '10px "JetBrains Mono", monospace'
                    : '9px "JetBrains Mono", monospace';
                  ctx.fillText(`${as.floor_ft}-${as.ceiling_ft}ft`, labelPos.x, labelPos.y + 12);
                }
              }
            }
          }
          // Draw circular rings (fallback for simple boundaries)
          else if (as.rings) {
            const asCenter = as.center || {
              lat: as.center_lat || as.lat,
              lon: as.center_lon || as.lon,
            };
            const pos = latLonToScreen(asCenter.lat, asCenter.lon);

            as.rings.forEach((ring, idx) => {
              const radiusNm = ring.radius_nm || ring.radius;
              // Use same scaling as latLonToScreen for consistency
              const pixelsPerNm = isPro
                ? (Math.min(width, height) * 0.45) / radarRange
                : maxRadius / radarRange;
              const radiusPx = radiusNm * pixelsPerNm;

              if (radiusPx > 5) {
                ctx.strokeStyle = asColor;
                ctx.lineWidth = isPro ? 1.5 : 1;
                ctx.setLineDash([6, 4]);
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, radiusPx, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);

                if (idx === 0 && as.name) {
                  ctx.fillStyle = asColor.replace(/[\d.]+\)$/, '0.7)');
                  ctx.font = '11px "JetBrains Mono", monospace';
                  ctx.textAlign = 'center';
                  ctx.fillText(as.name, pos.x, pos.y - radiusPx - 6);
                }
              }
            });
          }
          // Draw simple radius circle (when only radius_nm is provided)
          else if (as.radius_nm && (as.center || (as.center_lat && as.center_lon))) {
            const asCenter = as.center || { lat: as.center_lat, lon: as.center_lon };
            const pos = latLonToScreen(asCenter.lat, asCenter.lon);
            const pixelsPerNm = isPro
              ? (Math.min(width, height) * 0.45) / radarRange
              : maxRadius / radarRange;
            const radiusPx = as.radius_nm * pixelsPerNm;

            if (radiusPx > 5) {
              ctx.strokeStyle = asColor;
              ctx.lineWidth = isPro ? 1.5 : 1;
              ctx.setLineDash([6, 4]);
              ctx.beginPath();
              ctx.arc(pos.x, pos.y, radiusPx, 0, Math.PI * 2);
              ctx.stroke();
              ctx.setLineDash([]);

              if (as.name) {
                ctx.fillStyle = asColor.replace(/[\d.]+\)$/, '0.7)');
                ctx.font = '11px "JetBrains Mono", monospace';
                ctx.textAlign = 'center';
                ctx.fillText(as.name, pos.x, pos.y - radiusPx - 6);
              }
            }
          }
        });
      }

      // Draw Airspace Advisories (SIGMETs, AIRMETs, G-AIRMETs) when overlay enabled
      if (overlays.advisories && airspaceAdvisories?.length > 0 && isPro) {
        ctx.save();
        ctx.setLineDash([6, 4]);

        // Filter advisories by hazard type
        const filteredAdvisories = airspaceAdvisories.filter((adv) => {
          if (adv.hazard && weatherAdvisoryFilters[adv.hazard] !== undefined) {
            return weatherAdvisoryFilters[adv.hazard];
          }
          return true;
        });

        filteredAdvisories.forEach((adv) => {
          // Handle GeoJSON format: { type: "Polygon", coordinates: [[[lon, lat], ...]] }
          // or flat array format: [[lon, lat], ...]
          let polygonCoords = adv.polygon;
          if (adv.polygon?.type === 'Polygon' && adv.polygon?.coordinates?.[0]) {
            polygonCoords = adv.polygon.coordinates[0];
          } else if (adv.polygon?.coordinates) {
            polygonCoords = adv.polygon.coordinates;
          }

          if (!polygonCoords || polygonCoords.length < 3) return;

          // Calculate bounding box for viewport culling and label positioning
          const lats = polygonCoords.map((p) => (Array.isArray(p) ? p[1] : p.lat));
          const lons = polygonCoords.map((p) => (Array.isArray(p) ? p[0] : p.lon));
          const minLat = Math.min(...lats);
          const maxLat = Math.max(...lats);
          const minLon = Math.min(...lons);
          const maxLon = Math.max(...lons);

          // Check if advisory intersects viewport - convert center to screen and check distance
          const centerLat = (minLat + maxLat) / 2;
          const centerLon = (minLon + maxLon) / 2;
          const centerScreen = latLonToScreen(centerLat, centerLon);

          // Estimate advisory size on screen (rough approximation)
          const corner1 = latLonToScreen(maxLat, maxLon);
          const corner2 = latLonToScreen(minLat, minLon);
          const advisoryScreenRadius =
            Math.max(Math.abs(corner1.x - corner2.x), Math.abs(corner1.y - corner2.y)) / 2;

          // Skip if center is too far outside viewport (with advisory radius as margin)
          const margin = advisoryScreenRadius + 100;
          if (
            centerScreen.x < -margin ||
            centerScreen.x > width + margin ||
            centerScreen.y < -margin ||
            centerScreen.y > height + margin
          ) {
            return;
          }

          // Get color from hazard type
          const hazardConfig = HAZARD_CONFIG[adv.hazard] || { color: '#888888' };
          const isSelected = selectedAdvisoryId === adv.id;
          const isAck = acknowledgedAdvisories?.has(adv.id);

          // Skip acknowledged advisories in rendering (or dim them)
          const baseAlpha = isAck ? 0.15 : 0.4;
          const strokeAlpha = isAck ? 0.3 : 0.7;

          ctx.strokeStyle = isSelected
            ? hazardConfig.color
            : `${hazardConfig.color}${Math.round(strokeAlpha * 255)
                .toString(16)
                .padStart(2, '0')}`;
          ctx.fillStyle = `${hazardConfig.color}${Math.round(baseAlpha * 255 * 0.3)
            .toString(16)
            .padStart(2, '0')}`;
          ctx.lineWidth = isSelected ? 3 : 1.5;

          ctx.beginPath();
          polygonCoords.forEach((coord, idx) => {
            // Polygon coords are [lon, lat] format
            const lon = Array.isArray(coord) ? coord[0] : coord.lon;
            const lat = Array.isArray(coord) ? coord[1] : coord.lat;
            const screenPos = latLonToScreen(lat, lon);

            if (idx === 0) {
              ctx.moveTo(screenPos.x, screenPos.y);
            } else {
              ctx.lineTo(screenPos.x, screenPos.y);
            }
          });
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // Draw hazard label at center if selected
          if (isSelected) {
            // Reuse minLat/maxLat/minLon/maxLon computed above for bounds check
            const centerLat = (minLat + maxLat) / 2;
            const centerLon = (minLon + maxLon) / 2;
            const labelPos = latLonToScreen(centerLat, centerLon);

            ctx.setLineDash([]);
            ctx.fillStyle = hazardConfig.color;
            ctx.font = 'bold 12px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillText(adv.hazard || adv.advisory_type || 'ADVISORY', labelPos.x, labelPos.y);

            if (adv.lower_alt_ft !== undefined && adv.upper_alt_ft !== undefined) {
              ctx.font = '10px "JetBrains Mono", monospace';
              const lower =
                adv.lower_alt_ft === 0 ? 'SFC' : `FL${Math.round(adv.lower_alt_ft / 100)}`;
              const upper =
                adv.upper_alt_ft >= 18000
                  ? `FL${Math.round(adv.upper_alt_ft / 100)}`
                  : `${adv.upper_alt_ft}ft`;
              ctx.fillText(`${lower}-${upper}`, labelPos.x, labelPos.y + 14);
            }
            ctx.setLineDash([6, 4]);
          }
        });

        ctx.setLineDash([]);
        ctx.restore();
      }

      // Draw NOTAMs when overlay enabled (Pro mode)
      if (overlays.notams && mapNotams?.length > 0 && isPro) {
        ctx.save();

        mapNotams.forEach((notam) => {
          // Skip NOTAMs without location data
          if (!notam.latitude || !notam.longitude) return;

          const pos = latLonToScreen(notam.latitude, notam.longitude);
          if (pos.x < -50 || pos.x > width + 50 || pos.y < -50 || pos.y > height + 50) return;

          // Get color from NOTAM type
          const typeConfig = NOTAM_TYPE_CONFIG[notam.type] || { color: '#6b7280' };
          const isSelected = selectedNotamId === (notam.notam_id || notam.id);
          const isAck = acknowledgedNotams?.has(notam.notam_id || notam.id);
          const isTfr = notam.type === 'TFR';

          // Dimmed if acknowledged
          const baseAlpha = isAck ? 0.3 : 0.8;

          // Calculate radius in pixels (if radius_nm is available)
          const pixelsPerNm = (Math.min(width, height) * 0.45) / radarRange;
          const radiusPx = notam.radius_nm ? notam.radius_nm * pixelsPerNm : 12;

          // Draw circle/radius for NOTAM
          ctx.strokeStyle = isSelected
            ? typeConfig.color
            : `${typeConfig.color}${Math.round(baseAlpha * 255)
                .toString(16)
                .padStart(2, '0')}`;
          ctx.fillStyle = `${typeConfig.color}${Math.round(baseAlpha * 0.2 * 255)
            .toString(16)
            .padStart(2, '0')}`;
          ctx.lineWidth = isSelected ? 2.5 : isTfr ? 2 : 1.5;

          // TFRs get dashed lines, others solid
          if (isTfr) {
            ctx.setLineDash([6, 3]);
          } else {
            ctx.setLineDash([]);
          }

          ctx.beginPath();
          ctx.arc(pos.x, pos.y, Math.max(radiusPx, 8), 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          // Draw NOTAM marker icon
          ctx.fillStyle = typeConfig.color;
          ctx.beginPath();
          ctx.moveTo(pos.x, pos.y - 6);
          ctx.lineTo(pos.x - 4, pos.y + 4);
          ctx.lineTo(pos.x + 4, pos.y + 4);
          ctx.closePath();
          ctx.fill();

          // Draw label for selected or TFR NOTAMs
          if (isSelected || isTfr) {
            ctx.setLineDash([]);
            ctx.fillStyle = typeConfig.color;
            ctx.font = isSelected
              ? 'bold 11px "JetBrains Mono", monospace'
              : '10px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';

            // Show type and location
            const label = isTfr ? 'TFR' : notam.type || 'NOTAM';
            ctx.fillText(label, pos.x, pos.y - radiusPx - 8);

            if (isSelected && notam.location) {
              ctx.font = '9px "JetBrains Mono", monospace';
              ctx.fillText(notam.location, pos.x, pos.y - radiusPx - 20);
            }

            // Show altitude info if available
            if (isSelected && (notam.floor_ft != null || notam.ceiling_ft != null)) {
              ctx.font = '9px "JetBrains Mono", monospace';
              const altText =
                notam.floor_ft != null && notam.ceiling_ft != null
                  ? `${notam.floor_ft}-${notam.ceiling_ft}ft`
                  : notam.ceiling_ft != null
                    ? `≤${notam.ceiling_ft}ft`
                    : `≥${notam.floor_ft}ft`;
              ctx.fillText(altText, pos.x, pos.y + radiusPx + 14);
            }
          }
        });

        ctx.setLineDash([]);
        ctx.restore();
      }

      // Draw PIREPs if enabled (Pro mode primarily)
      if (overlays.pireps && aviationData.pireps.length > 0) {
        aviationData.pireps.forEach((pirep) => {
          if (!pirep.lat || !pirep.lon) return;
          const pos = latLonToScreen(pirep.lat, pirep.lon);
          if (pos.x < 0 || pos.x > width || pos.y < 0 || pos.y > height) return;

          ctx.save();
          ctx.translate(pos.x, pos.y);

          // Check if this PIREP is selected
          const isSelected =
            selectedPirep && selectedPirep.lat === pirep.lat && selectedPirep.lon === pirep.lon;

          // Get severity info for sizing and effects
          const severity = getPirepMaxSeverity(pirep);
          const severityLevel = severity.level;

          // Get age for opacity
          const ageMinutes = getPirepAgeMinutes(pirep);
          const ageOpacity = getAgeOpacity(ageMinutes);

          // Severity-based marker sizing (12-20px)
          const baseSize = 6; // Half of 12px base
          let markerSize = baseSize;
          if (severityLevel >= 5)
            markerSize = 10; // 20px for severe/extreme
          else if (severityLevel >= 4)
            markerSize = 9; // 18px for mod-severe
          else if (severityLevel >= 3)
            markerSize = 8; // 16px for moderate
          else if (severityLevel >= 2) markerSize = 7; // 14px for light-moderate
          // Level 0-1 stays at baseSize (12px)

          // Draw selection indicator
          if (isSelected) {
            const selFlash = Math.floor(frameCount / 10) % 2 === 0;
            const selAlpha = selFlash ? 0.9 : 0.4;
            const selSize = markerSize + (selFlash ? 12 : 10);

            ctx.strokeStyle = `rgba(100, 220, 255, ${selAlpha})`;
            ctx.lineWidth = 2;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.arc(0, 0, selSize, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);

            // Corner brackets
            const bSize = markerSize + 6;
            const bLen = 5;
            ctx.strokeStyle = `rgba(100, 220, 255, ${selAlpha})`;
            ctx.lineWidth = 2;
            // Top-left
            ctx.beginPath();
            ctx.moveTo(-bSize, -bSize + bLen);
            ctx.lineTo(-bSize, -bSize);
            ctx.lineTo(-bSize + bLen, -bSize);
            ctx.stroke();
            // Top-right
            ctx.beginPath();
            ctx.moveTo(bSize - bLen, -bSize);
            ctx.lineTo(bSize, -bSize);
            ctx.lineTo(bSize, -bSize + bLen);
            ctx.stroke();
            // Bottom-left
            ctx.beginPath();
            ctx.moveTo(-bSize, bSize - bLen);
            ctx.lineTo(-bSize, bSize);
            ctx.lineTo(-bSize + bLen, bSize);
            ctx.stroke();
            // Bottom-right
            ctx.beginPath();
            ctx.moveTo(bSize - bLen, bSize);
            ctx.lineTo(bSize, bSize);
            ctx.lineTo(bSize, bSize - bLen);
            ctx.stroke();
          }

          // PIREP color based on type
          const pirepType = getPirepType(pirep);
          let baseColor, glowColor;
          switch (pirepType) {
            case 'urgent':
              baseColor = { r: 255, g: 50, b: 50 }; // Red for urgent
              glowColor = 'rgba(255, 50, 50, 0.6)';
              break;
            case 'turbulence':
              baseColor = { r: 255, g: 150, b: 50 }; // Orange for turbulence
              glowColor = 'rgba(255, 150, 50, 0.5)';
              break;
            case 'icing':
              baseColor = { r: 100, g: 180, b: 255 }; // Blue for icing
              glowColor = 'rgba(100, 180, 255, 0.5)';
              break;
            case 'both':
              baseColor = { r: 200, g: 100, b: 255 }; // Purple for both
              glowColor = 'rgba(200, 100, 255, 0.5)';
              break;
            case 'windshear':
              baseColor = { r: 255, g: 100, b: 200 }; // Magenta for wind shear
              glowColor = 'rgba(255, 100, 200, 0.5)';
              break;
            default:
              baseColor = { r: 255, g: 220, b: 100 }; // Yellow for routine
              glowColor = 'rgba(255, 220, 100, 0.3)';
          }

          // Apply age-based opacity
          const colorAlpha = isSelected ? 1.0 : Math.min(0.9, ageOpacity);
          const fillAlpha = isSelected ? 0.4 : Math.min(0.25, ageOpacity * 0.3);
          const color = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${colorAlpha})`;
          const fillColor = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${fillAlpha})`;

          // Glow effects for severe conditions (level 3+)
          if (severityLevel >= 3) {
            ctx.shadowColor = glowColor;
            ctx.shadowBlur = severityLevel >= 5 ? 12 : severityLevel >= 4 ? 8 : 4;
          }

          // Pulsing effect for UUA/extreme (level 5+)
          let pulseScale = 1;
          if (severity.isUrgent || severityLevel >= 5) {
            const pulsePhase = (frameCount % 60) / 60;
            pulseScale = 1 + 0.1 * Math.sin(pulsePhase * Math.PI * 2);
            ctx.shadowBlur = 8 + 8 * Math.sin(pulsePhase * Math.PI * 2);
          }

          const scaledSize = markerSize * pulseScale;

          // Draw diamond symbol
          ctx.strokeStyle = color;
          ctx.lineWidth = isSelected ? 2.5 : severityLevel >= 3 ? 2 : 1.5;
          ctx.beginPath();
          ctx.moveTo(0, -scaledSize);
          ctx.lineTo(scaledSize * 0.85, 0);
          ctx.lineTo(0, scaledSize);
          ctx.lineTo(-scaledSize * 0.85, 0);
          ctx.closePath();
          ctx.stroke();

          // Fill based on type (always fill slightly, more if selected)
          ctx.fillStyle = fillColor;
          ctx.fill();

          // Reset shadow for inner symbols
          ctx.shadowBlur = 0;
          ctx.shadowColor = 'transparent';

          // Improved inner symbols based on type
          const innerScale = scaledSize / 7; // Scale inner symbols with marker
          if (pirepType === 'both') {
            // Split diamond for both - orange/blue halves
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(0, -scaledSize * 0.5);
            ctx.lineTo(0, scaledSize * 0.5);
            ctx.lineTo(-scaledSize * 0.4, 0);
            ctx.closePath();
            ctx.fillStyle = `rgba(255, 150, 50, ${colorAlpha})`; // Orange half
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(0, -scaledSize * 0.5);
            ctx.lineTo(0, scaledSize * 0.5);
            ctx.lineTo(scaledSize * 0.4, 0);
            ctx.closePath();
            ctx.fillStyle = `rgba(100, 180, 255, ${colorAlpha})`; // Blue half
            ctx.fill();
            ctx.restore();
          } else if (pirepType === 'turbulence') {
            // Three horizontal wavy lines for turbulence
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            const waveY = [-2, 0, 2];
            waveY.forEach((y) => {
              const yScaled = y * innerScale;
              ctx.beginPath();
              ctx.moveTo(-3 * innerScale, yScaled);
              ctx.quadraticCurveTo(-1.5 * innerScale, yScaled - 1.2 * innerScale, 0, yScaled);
              ctx.quadraticCurveTo(
                1.5 * innerScale,
                yScaled + 1.2 * innerScale,
                3 * innerScale,
                yScaled
              );
              ctx.stroke();
            });
          } else if (pirepType === 'icing') {
            // 6-arm asterisk/snowflake for icing
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            const armLen = 3 * innerScale;
            for (let i = 0; i < 6; i++) {
              const angle = (i * Math.PI) / 3;
              ctx.beginPath();
              ctx.moveTo(0, 0);
              ctx.lineTo(Math.cos(angle) * armLen, Math.sin(angle) * armLen);
              ctx.stroke();
              // Add small branches on each arm
              const branchLen = armLen * 0.4;
              const branchDist = armLen * 0.6;
              const bx = Math.cos(angle) * branchDist;
              const by = Math.sin(angle) * branchDist;
              ctx.beginPath();
              ctx.moveTo(bx, by);
              ctx.lineTo(
                bx + Math.cos(angle + 0.5) * branchLen,
                by + Math.sin(angle + 0.5) * branchLen
              );
              ctx.moveTo(bx, by);
              ctx.lineTo(
                bx + Math.cos(angle - 0.5) * branchLen,
                by + Math.sin(angle - 0.5) * branchLen
              );
              ctx.stroke();
            }
          } else if (pirepType === 'windshear') {
            // Vertical double-headed arrow for wind shear
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            const arrowLen = 3.5 * innerScale;
            const arrowHead = 1.5 * innerScale;
            // Vertical line
            ctx.beginPath();
            ctx.moveTo(0, -arrowLen);
            ctx.lineTo(0, arrowLen);
            ctx.stroke();
            // Top arrow head
            ctx.beginPath();
            ctx.moveTo(-arrowHead, -arrowLen + arrowHead);
            ctx.lineTo(0, -arrowLen);
            ctx.lineTo(arrowHead, -arrowLen + arrowHead);
            ctx.stroke();
            // Bottom arrow head
            ctx.beginPath();
            ctx.moveTo(-arrowHead, arrowLen - arrowHead);
            ctx.lineTo(0, arrowLen);
            ctx.lineTo(arrowHead, arrowLen - arrowHead);
            ctx.stroke();
          }

          // Altitude label below marker
          const altLabel = formatPirepAltitude(pirep);
          if (altLabel) {
            ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.7, ageOpacity * 0.8)})`;
            ctx.font = '9px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(altLabel, 0, scaledSize + 4);
          }

          ctx.restore();
        });
      }

      // Draw Winds Aloft overlay (Pro mode only)
      if (isPro && overlays.windsAloft && windGrid && windGrid.length > 0) {
        // Adapt barb size to zoom level
        const barbSize =
          radarRange <= 25 ? 30 : radarRange <= 50 ? 25 : radarRange <= 100 ? 22 : 18;
        const minSpacing =
          radarRange <= 25 ? 50 : radarRange <= 50 ? 45 : radarRange <= 100 ? 40 : 35;

        drawWindBarbs(ctx, windGrid, latLonToScreen, {
          size: barbSize,
          minSpacing,
          opacity: 0.85,
          showLabels: radarRange <= 50,
        });

        // Draw level indicator in corner
        drawWindsLevelIndicator(ctx, 10, height - 60, windsAloftLevel, {
          themeColors,
        });
      }

      // Draw METARs if enabled
      if (overlays.metars && aviationData.metars.length > 0) {
        aviationData.metars.forEach((metar) => {
          if (!metar.lat || !metar.lon) return;
          const pos = latLonToScreen(metar.lat, metar.lon);
          if (pos.x < 0 || pos.x > width || pos.y < 0 || pos.y > height) return;

          // Check if this METAR is selected
          const isSelected =
            selectedMetar && selectedMetar.lat === metar.lat && selectedMetar.lon === metar.lon;

          // Draw selection indicator
          if (isSelected) {
            const selFlash = Math.floor(frameCount / 10) % 2 === 0;
            const selAlpha = selFlash ? 0.9 : 0.4;
            const selSize = selFlash ? 18 : 16;

            ctx.save();
            ctx.strokeStyle = `rgba(100, 220, 255, ${selAlpha})`;
            ctx.lineWidth = 2;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, selSize, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);

            // Corner brackets
            const bSize = 12;
            const bLen = 5;
            ctx.strokeStyle = `rgba(100, 220, 255, ${selAlpha})`;
            ctx.lineWidth = 2;
            // Top-left
            ctx.beginPath();
            ctx.moveTo(pos.x - bSize, pos.y - bSize + bLen);
            ctx.lineTo(pos.x - bSize, pos.y - bSize);
            ctx.lineTo(pos.x - bSize + bLen, pos.y - bSize);
            ctx.stroke();
            // Top-right
            ctx.beginPath();
            ctx.moveTo(pos.x + bSize - bLen, pos.y - bSize);
            ctx.lineTo(pos.x + bSize, pos.y - bSize);
            ctx.lineTo(pos.x + bSize, pos.y - bSize + bLen);
            ctx.stroke();
            // Bottom-left
            ctx.beginPath();
            ctx.moveTo(pos.x - bSize, pos.y + bSize - bLen);
            ctx.lineTo(pos.x - bSize, pos.y + bSize);
            ctx.lineTo(pos.x - bSize + bLen, pos.y + bSize);
            ctx.stroke();
            // Bottom-right
            ctx.beginPath();
            ctx.moveTo(pos.x + bSize - bLen, pos.y + bSize);
            ctx.lineTo(pos.x + bSize, pos.y + bSize);
            ctx.lineTo(pos.x + bSize, pos.y + bSize - bLen);
            ctx.stroke();
            ctx.restore();
          }

          // Flight category color
          let color = 'rgba(0, 255, 0, 0.7)'; // VFR
          if (metar.fltCat === 'MVFR') color = 'rgba(100, 150, 255, 0.8)';
          else if (metar.fltCat === 'IFR') color = 'rgba(255, 100, 100, 0.8)';
          else if (metar.fltCat === 'LIFR') color = 'rgba(255, 50, 200, 0.8)';

          // Make selected METARs brighter
          if (isSelected) {
            color = color.replace('0.7', '1').replace('0.8', '1');
          }

          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, isSelected ? 7 : 5, 0, Math.PI * 2);
          ctx.fill();

          // Add outline if selected
          if (isSelected) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.lineWidth = 2;
            ctx.stroke();
          }

          // Wind barb if significant wind
          if (metar.wspd && metar.wspd > 10) {
            drawWindBarb(ctx, pos.x, pos.y, metar.wdir || 0, metar.wspd, {
              size: 21,
              barbLength: 8,
              barbSpacing: 4,
              lineWidth: isSelected ? 2 : 1.5,
              color,
              opacity: 0.9,
            });
          }
        });
      }

      // Sweep line - CRT mode only (Phase 7.3: respect reduced motion)
      if (!isPro && !reducedMotion) {
        sweepAngleRef.current = (sweepAngleRef.current + 1.5) % 360;
        const sweepRad = ((sweepAngleRef.current - 90) * Math.PI) / 180;

        // Draw sweep as gradient arc
        const sweepSpan = 45;
        ctx.save();
        ctx.translate(centerX, centerY);

        for (let i = 0; i < sweepSpan; i += 3) {
          const angle1 = ((sweepAngleRef.current - i - 90) * Math.PI) / 180;
          const angle2 = ((sweepAngleRef.current - i - 3 - 90) * Math.PI) / 180;
          const alpha = 0.4 * (1 - i / sweepSpan);

          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, maxRadius, angle2, angle1);
          ctx.closePath();
          ctx.fillStyle = `rgba(0, 255, 100, ${alpha * 0.15})`;
          ctx.fill();
        }

        // Main sweep line
        ctx.strokeStyle = 'rgba(0, 255, 100, 0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(sweepRad) * maxRadius, Math.sin(sweepRad) * maxRadius);
        ctx.stroke();

        ctx.restore();
      }

      // Build conflict aircraft set from backend safety events (activeConflicts)
      // No longer doing local proximity calculations - backend handles this
      const conflictAircraft = new Set();
      activeConflicts.forEach((event) => {
        if (event.icao) conflictAircraft.add(event.icao.toUpperCase());
        if (event.icao_2) conflictAircraft.add(event.icao_2.toUpperCase());
      });

      // Phase 3: Draw CPA lines and relative altitude labels for conflicts
      if (showConflictVisualization && isPro && activeConflicts.length > 0) {
        ctx.save();
        const drawnPairs = new Set(); // Avoid drawing same pair twice

        activeConflicts.forEach((event) => {
          // Skip non-proximity events (single aircraft events)
          if (!event.icao || !event.icao_2) return;

          const pairKey = [event.icao, event.icao_2].sort().join('-');
          if (drawnPairs.has(pairKey)) return;
          drawnPairs.add(pairKey);

          // Find both aircraft
          const ac1 = sortedAircraft.find(
            (ac) => ac.hex?.toUpperCase() === event.icao?.toUpperCase()
          );
          const ac2 = sortedAircraft.find(
            (ac) => ac.hex?.toUpperCase() === event.icao_2?.toUpperCase()
          );

          if (!ac1 || !ac2 || !ac1.lat || !ac2.lat) return;

          const pos1 = latLonToScreen(ac1.lat, ac1.lon);
          const pos2 = latLonToScreen(ac2.lat, ac2.lon);

          // Skip if either is off-screen
          if (pos1.x < 0 || pos1.x > width || pos1.y < 0 || pos1.y > height) return;
          if (pos2.x < 0 || pos2.x > width || pos2.y < 0 || pos2.y > height) return;

          // Determine severity-based color
          const severity = event.severity || 'warning';
          const lineColor =
            severity === 'critical'
              ? 'rgba(255, 80, 150, 0.8)'
              : severity === 'warning'
                ? 'rgba(255, 140, 0, 0.8)'
                : 'rgba(255, 220, 0, 0.8)';

          // Draw connecting line between aircraft (pulsing effect)
          const pulseAlpha = 0.4 + Math.sin(frameCount * 0.1) * 0.3;
          ctx.strokeStyle = lineColor.replace(/[\d.]+\)$/, `${pulseAlpha})`);
          ctx.lineWidth = severity === 'critical' ? 3 : 2;
          ctx.setLineDash([8, 4]);
          ctx.beginPath();
          ctx.moveTo(pos1.x, pos1.y);
          ctx.lineTo(pos2.x, pos2.y);
          ctx.stroke();
          ctx.setLineDash([]);

          // Calculate midpoint for label
          const midX = (pos1.x + pos2.x) / 2;
          const midY = (pos1.y + pos2.y) / 2;

          // Calculate relative altitude
          const alt1 = ac1.alt || 0;
          const alt2 = ac2.alt || 0;
          const altDiff = Math.abs(alt1 - alt2);
          const isCriticalAlt = altDiff < 1000;

          // Draw relative altitude label
          const relAltText =
            alt1 > alt2 ? `△${Math.round(altDiff)}ft` : `▽${Math.round(altDiff)}ft`;

          ctx.font = 'bold 11px "JetBrains Mono", monospace';
          const labelWidth = ctx.measureText(relAltText).width + 10;

          // Background
          ctx.fillStyle = isCriticalAlt ? 'rgba(150, 40, 60, 0.9)' : 'rgba(100, 60, 20, 0.9)';
          ctx.fillRect(midX - labelWidth / 2, midY - 10, labelWidth, 18);

          // Border
          ctx.strokeStyle = isCriticalAlt ? 'rgba(255, 80, 100, 0.9)' : 'rgba(255, 180, 100, 0.9)';
          ctx.lineWidth = 1;
          ctx.strokeRect(midX - labelWidth / 2, midY - 10, labelWidth, 18);

          // Text
          ctx.fillStyle = isCriticalAlt ? 'rgba(255, 200, 200, 1)' : 'rgba(255, 230, 180, 1)';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(relAltText, midX, midY);

          // Phase 3.1: CPA X marker and time-to-CPA label
          if (ac1.lat && ac1.lon && ac2.lat && ac2.lon) {
            const cpaData = calculateCPA(ac1, ac2);

            // Draw CPA X marker at midpoint
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(midX - 5, midY - 5);
            ctx.lineTo(midX + 5, midY + 5);
            ctx.moveTo(midX + 5, midY - 5);
            ctx.lineTo(midX - 5, midY + 5);
            ctx.stroke();

            // Draw time-to-CPA label below the midpoint
            if (cpaData.tCPASeconds > 0 && !cpaData.isPast) {
              const timeLabel = formatTimeToCPA(cpaData.tCPASeconds);
              ctx.font = '9px "JetBrains Mono", monospace';
              ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';
              ctx.fillText(timeLabel, midX, midY + 14);

              // Draw distance at CPA below time label
              if (cpaData.distanceAtCPA != null) {
                const distLabel = `${cpaData.distanceAtCPA.toFixed(1)}nm`;
                ctx.fillText(distLabel, midX, midY + 26);
              }
            }
          }
        });

        ctx.restore();
      }

      // Phase 3.3: Conflict Wedge Visualization - projected path corridors
      if (showConflictVisualization && isPro) {
        ctx.save();
        const wedgeAngle = 5; // ±5 degrees heading uncertainty
        const lookaheadMinutes = 2; // 2-minute lookahead
        const wedgePixelsPerNm = (Math.min(width, height) * 0.45) / radarRange;

        // Draw wedges for aircraft in conflicts (or all aircraft if toggled)
        const wedgesToDraw =
          conflictAircraft.size > 0
            ? sortedAircraft.filter((ac) => conflictAircraft.has(ac.hex?.toUpperCase()))
            : [];

        wedgesToDraw.forEach((ac) => {
          if (!ac.lat || !ac.lon || !ac.track || !ac.gs) return;

          const pos = latLonToScreen(ac.lat, ac.lon);
          if (pos.x < -50 || pos.x > width + 50 || pos.y < -50 || pos.y > height + 50) return;

          // Calculate lookahead distance in nm (speed in kts * time in hours)
          const lookaheadNm = ac.gs * (lookaheadMinutes / 60);
          const lookaheadPx = lookaheadNm * wedgePixelsPerNm;

          // Heading in radians (canvas 0° is right, aircraft track 0° is north)
          const headingRad = ((ac.track - 90) * Math.PI) / 180;
          const leftRad = ((ac.track - wedgeAngle - 90) * Math.PI) / 180;
          const rightRad = ((ac.track + wedgeAngle - 90) * Math.PI) / 180;

          // Determine severity color based on whether this aircraft is in a critical conflict
          const isInCriticalConflict = activeConflicts.some(
            (e) =>
              e.severity === 'critical' &&
              (e.icao?.toUpperCase() === ac.hex?.toUpperCase() ||
                e.icao_2?.toUpperCase() === ac.hex?.toUpperCase())
          );
          const wedgeColor = isInCriticalConflict
            ? 'rgba(255, 80, 150, 0.15)'
            : 'rgba(255, 180, 0, 0.12)';
          const wedgeBorderColor = isInCriticalConflict
            ? 'rgba(255, 80, 150, 0.4)'
            : 'rgba(255, 180, 0, 0.3)';

          // Draw the wedge (triangle from aircraft position)
          ctx.beginPath();
          ctx.moveTo(pos.x, pos.y);
          ctx.lineTo(
            pos.x + Math.cos(leftRad) * lookaheadPx,
            pos.y + Math.sin(leftRad) * lookaheadPx
          );
          ctx.lineTo(
            pos.x + Math.cos(rightRad) * lookaheadPx,
            pos.y + Math.sin(rightRad) * lookaheadPx
          );
          ctx.closePath();

          ctx.fillStyle = wedgeColor;
          ctx.fill();
          ctx.strokeStyle = wedgeBorderColor;
          ctx.lineWidth = 1;
          ctx.stroke();

          // Draw center line (predicted track)
          ctx.beginPath();
          ctx.moveTo(pos.x, pos.y);
          ctx.lineTo(
            pos.x + Math.cos(headingRad) * lookaheadPx,
            pos.y + Math.sin(headingRad) * lookaheadPx
          );
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = isInCriticalConflict
            ? 'rgba(255, 80, 150, 0.5)'
            : 'rgba(255, 180, 0, 0.4)';
          ctx.stroke();
          ctx.setLineDash([]);
        });

        ctx.restore();
      }

      // Phase 6: J-Rings - Draw range rings around selected aircraft
      // J-Rings show concentric distance rings (5nm, 10nm, 20nm) centered on the selected aircraft
      // Toggle with 'J' key, persisted in localStorage
      if (showJRings && selectedAircraft?.lat && selectedAircraft?.lon) {
        ctx.save();

        // Get selected aircraft screen position
        const acPos = latLonToScreen(selectedAircraft.lat, selectedAircraft.lon);

        // Skip if aircraft is too far off screen
        if (
          acPos.x >= -200 &&
          acPos.x <= width + 200 &&
          acPos.y >= -200 &&
          acPos.y <= height + 200
        ) {
          // J-Ring distances in nautical miles (configurable)
          const jRingDistances = [5, 10, 20];

          // Calculate pixels per nautical mile for current view
          const pixelsPerNm = isPro
            ? (Math.min(width, height) * 0.45) / radarRange
            : maxRadius / radarRange;

          // Use cyan/theme color with lower opacity
          const ringColor = isPro
            ? themeColors?.rgba('primary', 0.35) || 'rgba(0, 200, 255, 0.35)'
            : 'rgba(0, 255, 100, 0.35)';
          const labelColor = isPro
            ? themeColors?.rgba('primary', 0.6) || 'rgba(0, 200, 255, 0.6)'
            : 'rgba(0, 255, 100, 0.6)';

          ctx.strokeStyle = ringColor;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 4]);

          jRingDistances.forEach((distNm) => {
            const radiusPx = distNm * pixelsPerNm;

            // Only draw if ring would be at least partially visible
            if (radiusPx > 10 && radiusPx < Math.max(width, height) * 2) {
              // Draw the ring
              ctx.beginPath();
              ctx.arc(acPos.x, acPos.y, radiusPx, 0, Math.PI * 2);
              ctx.stroke();

              // Draw distance label at the top of the ring
              ctx.fillStyle = labelColor;
              ctx.font = '11px "JetBrains Mono", monospace';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'bottom';

              const labelY = acPos.y - radiusPx - 3;
              // Only draw label if it's within reasonable screen bounds
              if (labelY > -20 && labelY < height + 20) {
                ctx.fillText(`${distNm}nm`, acPos.x, labelY);
              }

              // Also draw label at bottom for better visibility when panning
              const bottomLabelY = acPos.y + radiusPx + 12;
              if (bottomLabelY > 0 && bottomLabelY < height + 30 && labelY < 10) {
                ctx.textBaseline = 'top';
                ctx.fillText(`${distNm}nm`, acPos.x, acPos.y + radiusPx + 3);
              }
            }
          });

          ctx.setLineDash([]);
        }

        ctx.restore();
      }

      // Draw track history line for followed aircraft or selected aircraft (when toggle is on)
      const trackAircraftHex = followingAircraft || (showSelectedTrack && selectedAircraft?.hex);
      if (trackAircraftHex && trackHistory[trackAircraftHex]?.length > 1) {
        const history = trackHistory[trackAircraftHex];
        ctx.save();
        ctx.strokeStyle = isPro ? 'rgba(0, 200, 255, 0.7)' : 'rgba(0, 255, 100, 0.6)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]); // Dotted line
        ctx.beginPath();

        let started = false;
        history.forEach((point) => {
          const pos = latLonToScreen(point.lat, point.lon);
          // Skip points outside canvas
          if (pos.x < -50 || pos.x > width + 50 || pos.y < -50 || pos.y > height + 50) return;

          if (!started) {
            ctx.moveTo(pos.x, pos.y);
            started = true;
          } else {
            ctx.lineTo(pos.x, pos.y);
          }
        });
        ctx.stroke();
        ctx.setLineDash([]); // Reset dash
        ctx.restore();
      }

      // Phase 5.3: Performance mode - adjust detail based on aircraft count
      const aircraftCount = sortedAircraft.length;
      const perfMode = {
        skipTrails: aircraftCount > 200,
        reduceTrailLength: aircraftCount > 150,
        skipPredictionVectors: aircraftCount > 300,
        skipDataBlocks: aircraftCount > 400,
      };

      // Draw short tracks for all aircraft (ATC-style history trails)
      // Performance: Skip trails entirely when > 150 aircraft
      if (showShortTracks && overlays.aircraft && !perfMode.skipTrails) {
        ctx.save();
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Performance: Limit trail length when > 100 aircraft
        const trackLength = perfMode.reduceTrailLength
          ? Math.min(config.shortTrackLength || 15, 8)
          : config.shortTrackLength || 15;
        // Reduce max trail points at far ranges
        const lodTrailMax =
          radarRange <= 50
            ? trackLength
            : radarRange <= 100
              ? Math.min(trackLength, 15)
              : Math.min(trackLength, 8);
        const effectiveTrackLength = lodTrailMax;
        // Phase 5.4: Range-based trail point decimation
        const lodTrailStride =
          radarRange <= 50 ? 1 : radarRange <= 100 ? 2 : radarRange <= 200 ? 3 : 4;

        // Helper to get smooth altitude-based RGB color
        const getAltitudeRGB = (alt) => {
          const numAlt = Number(alt);
          if (!Number.isFinite(numAlt) || numAlt <= 0) return { r: 50, g: 255, b: 100 }; // Ground level: bright green
          // Smooth gradient: Green (0ft) -> Yellow (10000ft) -> Orange (25000ft) -> Red/Magenta (45000ft+)
          const clampedAlt = Math.max(0, Math.min(numAlt, 45000));
          if (clampedAlt < 10000) {
            // Green to Yellow transition (0-10000ft)
            const t = clampedAlt / 10000;
            return {
              r: Math.round(50 + 205 * t),
              g: Math.round(255),
              b: Math.round(100 - 100 * t),
            };
          } else if (clampedAlt < 25000) {
            // Yellow to Orange transition (10000-25000ft)
            const t = (clampedAlt - 10000) / 15000;
            return {
              r: Math.round(255),
              g: Math.round(255 - 130 * t),
              b: Math.round(0),
            };
          } else {
            // Orange to Magenta transition (25000-45000ft)
            const t = (clampedAlt - 25000) / 20000;
            return {
              r: Math.round(255),
              g: Math.round(125 - 125 * t),
              b: Math.round(0 + 255 * t),
            };
          }
        };

        // Target trail length in nm based on slider (5-60 positions maps to ~0.5-6nm)
        const targetTrailNm = effectiveTrackLength * 0.1;

        // Helper to calculate distance between two points in nm
        const getSegmentDistanceNm = (lat1, lon1, lat2, lon2) => {
          const R = 3440.065; // Earth radius in nm
          const dLat = ((lat2 - lat1) * Math.PI) / 180;
          const dLon = ((lon2 - lon1) * Math.PI) / 180;
          const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos((lat1 * Math.PI) / 180) *
              Math.cos((lat2 * Math.PI) / 180) *
              Math.sin(dLon / 2) *
              Math.sin(dLon / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          return R * c;
        };

        sortedAircraft.forEach((ac) => {
          if (!ac.hex || !ac.lat || !ac.lon) return;

          const dist = ac.distance_nm || getDistanceNm(ac.lat, ac.lon);
          if (!isPro && dist > radarRange) return;
          if (isPro && dist > radarRange * 1.5) return;

          // Combine historical data (from API) with real-time trackHistory
          const historicPositions = shortTrackHistory[ac.hex] || [];
          const realtimePositions = trackHistory[ac.hex] || [];

          // Merge and sort by time
          const now = Date.now();
          const maxAge = 300000; // 5 minutes max
          const allPositions = [
            ...historicPositions.filter((p) => now - p.time < maxAge),
            ...realtimePositions.filter((p) => now - p.time < maxAge),
          ].sort((a, b) => a.time - b.time);

          // Need at least 2 points to draw a line
          if (allPositions.length < 2) return;

          // Select positions based on target distance (uniform length for all aircraft)
          const positions = [];
          let accumulatedDist = 0;
          // Walk backward from most recent position
          for (let i = allPositions.length - 1; i >= 0; i--) {
            const p = allPositions[i];
            if (positions.length === 0) {
              positions.unshift(p);
            } else {
              const nextP = positions[0];
              const segDist = getSegmentDistanceNm(p.lat, p.lon, nextP.lat, nextP.lon);
              if (accumulatedDist + segDist <= targetTrailNm) {
                positions.unshift(p);
                accumulatedDist += segDist;
              } else {
                // Interpolate final point to hit exact target distance
                const remaining = targetTrailNm - accumulatedDist;
                const ratio = remaining / segDist;
                const interpLat = nextP.lat + (p.lat - nextP.lat) * ratio;
                const interpLon = nextP.lon + (p.lon - nextP.lon) * ratio;
                const interpAlt =
                  nextP.alt && p.alt ? nextP.alt + (p.alt - nextP.alt) * ratio : p.alt || nextP.alt;
                positions.unshift({ lat: interpLat, lon: interpLon, alt: interpAlt, time: p.time });
                break;
              }
            }
          }

          // Need at least 2 points to draw
          if (positions.length < 2) return;

          // Draw trail with fading opacity (older = more transparent)
          const isSelected = selectedAircraft?.hex === ac.hex;

          // Draw altitude gradient in pro mode when altitude trails enabled
          if (isPro && showAltitudeTrails) {
            // Draw individual segments with smooth altitude gradient
            for (let i = 1; i < positions.length; i++) {
              // LOD: skip trail points at far ranges for performance
              if (lodTrailStride > 1 && i % lodTrailStride !== 0 && i !== positions.length - 1)
                continue;
              const p1 = positions[i - 1];
              const p2 = positions[i];
              const pos1 = latLonToScreen(p1.lat, p1.lon);
              const pos2 = latLonToScreen(p2.lat, p2.lon);

              if (pos1.x < -50 || pos1.x > width + 50 || pos1.y < -50 || pos1.y > height + 50)
                continue;
              if (pos2.x < -50 || pos2.x > width + 50 || pos2.y < -50 || pos2.y > height + 50)
                continue;

              // Create gradient for this segment
              const gradient = ctx.createLinearGradient(pos1.x, pos1.y, pos2.x, pos2.y);
              const opacity1 = (isSelected ? 0.5 : 0.3) + ((i - 1) / positions.length) * 0.5;
              const opacity2 = (isSelected ? 0.5 : 0.3) + (i / positions.length) * 0.5;
              const rgb1 = getAltitudeRGB(p1.alt);
              const rgb2 = getAltitudeRGB(p2.alt);
              gradient.addColorStop(0, `rgba(${rgb1.r}, ${rgb1.g}, ${rgb1.b}, ${opacity1})`);
              gradient.addColorStop(1, `rgba(${rgb2.r}, ${rgb2.g}, ${rgb2.b}, ${opacity2})`);

              ctx.beginPath();
              ctx.moveTo(pos1.x, pos1.y);
              ctx.lineTo(pos2.x, pos2.y);
              ctx.strokeStyle = gradient;
              ctx.stroke();
            }
          } else {
            // Standard white trail for non-pro mode
            ctx.beginPath();
            let started = false;

            positions.forEach((point, i) => {
              // LOD: skip trail points at far ranges for performance
              if (lodTrailStride > 1 && i % lodTrailStride !== 0 && i !== positions.length - 1)
                return;
              const pos = latLonToScreen(point.lat, point.lon);
              if (pos.x < -50 || pos.x > width + 50 || pos.y < -50 || pos.y > height + 50) return;

              if (!started) {
                ctx.moveTo(pos.x, pos.y);
                started = true;
              } else {
                ctx.lineTo(pos.x, pos.y);
              }
            });

            const opacity = isSelected ? 0.6 : 0.35;
            ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
            ctx.stroke();
          }
        });

        ctx.restore();
      }

      // Draw aircraft (if overlay enabled)
      // Sort so aircraft with safety events are drawn last (on top)
      if (overlays.aircraft) {
        const aircraftToDraw = [...sortedAircraft].sort((a, b) => {
          const aHasSafety = conflictAircraft.has(a.hex?.toUpperCase());
          const bHasSafety = conflictAircraft.has(b.hex?.toUpperCase());
          if (aHasSafety && !bHasSafety) return 1; // a comes after b (drawn on top)
          if (!aHasSafety && bHasSafety) return -1; // b comes after a
          return 0;
        });

        // Data block thinning: limit data blocks based on screen density
        // When many aircraft are visible, show fewer data blocks to reduce clutter
        // Count visible aircraft on screen first (using same viewport culling as rendering)
        const visibleOnScreen = aircraftToDraw.filter((ac) => {
          if (!ac.lat || !ac.lon) return false; // Skip aircraft without position
          const pos = latLonToScreen(ac.lat, ac.lon);
          if (isPro) {
            // Pro mode: viewport-based visibility
            return pos.x >= -30 && pos.x <= width + 30 && pos.y >= -30 && pos.y <= height + 30;
          } else {
            // CRT mode: distance-based visibility
            const dist = ac.distance_nm || getDistanceNm(ac.lat, ac.lon);
            return dist <= radarRange;
          }
        });

        const density = visibleOnScreen.length;

        // Density-based max data blocks (in Pro mode only)
        // Fewer aircraft = show all labels; more aircraft = thin out labels
        const maxDataBlocks = isPro
          ? density <= 15
            ? Infinity // Low density: show all
            : density <= 30
              ? 25
              : density <= 50
                ? 20
                : density <= 100
                  ? 15
                  : 10 // Very crowded: show only 10
          : Infinity; // No thinning in non-Pro mode

        // Build set of aircraft that should show data blocks (priority-based)
        const dataBlockVisibleSet = new Set();
        if (maxDataBlocks !== Infinity && isPro) {
          // Calculate screen positions and local density for each aircraft
          const aircraftWithScreenPos = visibleOnScreen.map((ac) => {
            const pos = latLonToScreen(ac.lat, ac.lon);
            return { ac, x: pos.x, y: pos.y };
          });

          // Score aircraft by priority (higher = more important)
          const scoredAircraft = aircraftWithScreenPos
            .map(({ ac, x, y }) => {
              let score = 0;
              const hex = ac.hex?.toUpperCase();

              // Always show: selected, emergency, military, safety conflicts
              if (selectedAircraft?.hex?.toUpperCase() === hex) score += 10000;
              if (ac.emergency || ['7500', '7600', '7700'].includes(ac.squawk)) score += 5000;
              if (ac.military) score += 3000;
              if (conflictAircraft.has(hex)) score += 4000;

              // High priority: aircraft with ACARS messages
              const hasAcars = acarsMessages.some(
                (msg) =>
                  (msg.icao_hex && msg.icao_hex.toUpperCase() === hex) ||
                  (msg.callsign &&
                    ac.flight &&
                    msg.callsign.toUpperCase() === ac.flight.trim().toUpperCase())
              );
              if (hasAcars) score += 2000;

              // Higher priority for aircraft with callsigns vs hex-only
              if (ac.flight?.trim()) score += 500;

              // Calculate local density penalty (nearby aircraft within 80px)
              const nearbyCount = aircraftWithScreenPos.filter(
                (other) =>
                  other.ac.hex !== ac.hex &&
                  Math.abs(other.x - x) < 80 &&
                  Math.abs(other.y - y) < 50
              ).length;
              // Penalize aircraft in crowded areas (less likely to show label)
              score -= nearbyCount * 30;

              // Prefer aircraft closer to center of screen
              const centerDist = Math.sqrt(
                Math.pow(x - width / 2, 2) + Math.pow(y - height / 2, 2)
              );
              score += Math.max(0, 200 - centerDist / 3);

              // Prefer faster aircraft (more interesting)
              if (ac.gs) score += Math.min(ac.gs / 10, 50);

              return { hex, score };
            })
            .sort((a, b) => b.score - a.score);

          // Add top N aircraft to visible set
          scoredAircraft.slice(0, maxDataBlocks).forEach(({ hex }) => {
            dataBlockVisibleSet.add(hex);
          });
        }

        // Phase 14.3: Collect data block rects for auto-deconfliction
        const dataBlockRects = [];

        aircraftToDraw.forEach((ac) => {
          // Skip aircraft without valid position
          if (!ac.lat || !ac.lon) return;

          // Use latLonToScreen for positioning (do this first for early culling)
          const pos = latLonToScreen(ac.lat, ac.lon);
          const x = pos.x;
          const y = pos.y;

          // Skip if outside visible area (with margin for data blocks/blips)
          // Data blocks extend ~120px right and ~60px down from aircraft position
          // Aircraft blips are ~20px, so add margin on all sides
          const margin = 30; // Margin for aircraft blip visibility at edges
          const dataBlockMarginRight = 150; // Extra margin for data blocks on right
          const dataBlockMarginBottom = 80; // Extra margin for data blocks below

          if (isPro) {
            // Pro mode: strict viewport culling with margins
            if (
              x < -margin ||
              x > width + dataBlockMarginRight ||
              y < -margin ||
              y > height + dataBlockMarginBottom
            )
              return;
          } else {
            // CRT mode: use distance-based culling
            const dist = ac.distance_nm || getDistanceNm(ac.lat, ac.lon);
            if (dist > radarRange) return;
          }

          // Calculate blip brightness based on sweep position (CRT) or constant (Pro)
          const bearing = getBearing(ac.lat, ac.lon);
          let brightness = 1;
          if (!isPro) {
            let sweepDiff = (sweepAngleRef.current - bearing + 360) % 360;
            if (sweepDiff > 180) sweepDiff = 360 - sweepDiff;
            brightness = Math.max(0.3, 1 - sweepDiff / 180);
          }

          // Determine colors - Pro mode uses brighter colors
          const isEmergency = ac.emergency || ['7500', '7600', '7700'].includes(ac.squawk);
          const isMilitary = ac.military;
          const isProximityConflict = conflictAircraft.has(ac.hex);

          // Check for safety events (from API)
          const safetyEvent = activeConflicts.find(
            (e) =>
              e.icao?.toUpperCase() === ac.hex?.toUpperCase() ||
              e.icao_2?.toUpperCase() === ac.hex?.toUpperCase()
          );
          const hasSafetyAlert = !!safetyEvent || isProximityConflict;
          const alertSeverity = safetyEvent?.severity || (isProximityConflict ? 'warning' : null);

          // Emergency flash effect
          const flashOn = isEmergency ? Math.floor(frameCount / 15) % 2 === 0 : true;
          const flashBrightness = flashOn ? 1 : 0.3;

          // Proximity conflict flash speed based on severity
          const flashDivisor =
            alertSeverity === 'critical' ? 4 : alertSeverity === 'warning' ? 8 : 12;
          const proximityFlashOn = hasSafetyAlert
            ? Math.floor(frameCount / flashDivisor) % 2 === 0
            : false;

          // Severity-based colors
          const getSeverityColors = (severity, flashOn) => {
            const intensity = flashOn ? 1 : 0.6;
            switch (severity) {
              case 'critical':
                return {
                  primary: `rgba(255, 80, 150, ${intensity})`,
                  text: `rgba(255, 120, 180, ${intensity})`,
                  ring: `rgba(255, 80, 150, ${flashOn ? 0.9 : 0.5})`,
                  ringInner: `rgba(255, 50, 120, ${(flashOn ? 0.9 : 0.5) * 0.6})`,
                };
              case 'warning':
                return {
                  primary: `rgba(255, 140, 0, ${intensity})`,
                  text: `rgba(255, 180, 80, ${intensity})`,
                  ring: `rgba(255, 140, 0, ${flashOn ? 0.9 : 0.5})`,
                  ringInner: `rgba(255, 100, 0, ${(flashOn ? 0.9 : 0.5) * 0.6})`,
                };
              default: // low
                return {
                  primary: `rgba(255, 220, 0, ${intensity})`,
                  text: `rgba(255, 240, 100, ${intensity})`,
                  ring: `rgba(255, 220, 0, ${flashOn ? 0.9 : 0.5})`,
                  ringInner: `rgba(255, 180, 0, ${(flashOn ? 0.9 : 0.5) * 0.6})`,
                };
            }
          };

          let primaryColor, textColor;
          if (hasSafetyAlert) {
            const sevColors = getSeverityColors(alertSeverity, proximityFlashOn);
            primaryColor = sevColors.primary;
            textColor = sevColors.text;
          } else if (isEmergency) {
            const r = flashOn ? 255 : 180;
            const intensity = brightness * flashBrightness;
            primaryColor = `rgba(${r}, 50, 50, ${Math.max(0.5, intensity)})`;
            textColor = `rgba(255, 100, 100, ${Math.max(0.6, intensity)})`;
          } else if (isMilitary) {
            // Purple for military
            primaryColor = isPro ? `rgba(200, 100, 255, 0.9)` : `rgba(180, 80, 255, ${brightness})`;
            textColor = isPro ? 'rgba(220, 150, 255, 0.9)' : `rgba(200, 150, 255, ${brightness})`;
          } else if (isPro && hasHighlightGroups) {
            // Check for highlight group color (Pro mode only)
            const highlight = getAircraftHighlight(ac);
            if (highlight && highlight.color) {
              // Convert hex color to rgba for consistency
              const hexToRgba = (hex, alpha) => {
                const r = parseInt(hex.slice(1, 3), 16);
                const g = parseInt(hex.slice(3, 5), 16);
                const b = parseInt(hex.slice(5, 7), 16);
                return `rgba(${r}, ${g}, ${b}, ${alpha})`;
              };
              primaryColor = hexToRgba(highlight.color, 0.9);
              // Slightly lighter version for text
              const r = parseInt(highlight.color.slice(1, 3), 16);
              const g = parseInt(highlight.color.slice(3, 5), 16);
              const b = parseInt(highlight.color.slice(5, 7), 16);
              textColor = `rgba(${Math.min(255, r + 50)}, ${Math.min(255, g + 50)}, ${Math.min(255, b + 50)}, 0.95)`;
            } else if (showSpeedColors && ac.gs) {
              // Fall through to speed colors if no highlight match
              const speed = ac.gs;
              if (speed > 500) {
                primaryColor = 'rgba(255, 165, 0, 0.9)';
                textColor = 'rgba(255, 200, 100, 0.9)';
              } else if (speed > 300) {
                primaryColor = 'rgba(255, 255, 0, 0.9)';
                textColor = 'rgba(255, 255, 150, 0.9)';
              } else if (speed < 150) {
                primaryColor = 'rgba(100, 180, 255, 0.9)';
                textColor = 'rgba(150, 200, 255, 0.9)';
              } else {
                primaryColor = 'rgba(0, 255, 200, 0.9)';
                textColor = 'rgba(150, 255, 220, 0.9)';
              }
            } else {
              // Default green
              primaryColor = 'rgba(0, 255, 150, 0.9)';
              textColor = 'rgba(150, 255, 200, 0.9)';
            }
          } else if (showSpeedColors && ac.gs) {
            // Speed-based coloring for civilian (Phase 2.2)
            const speed = ac.gs;
            if (speed > 500) {
              // Very fast (> 500 kts): Orange
              primaryColor = isPro ? 'rgba(255, 165, 0, 0.9)' : `rgba(255, 165, 0, ${brightness})`;
              textColor = isPro ? 'rgba(255, 200, 100, 0.9)' : `rgba(255, 200, 100, ${brightness})`;
            } else if (speed > 300) {
              // Fast (300-500 kts): Yellow
              primaryColor = isPro ? 'rgba(255, 255, 0, 0.9)' : `rgba(255, 255, 0, ${brightness})`;
              textColor = isPro ? 'rgba(255, 255, 150, 0.9)' : `rgba(255, 255, 150, ${brightness})`;
            } else if (speed < 150) {
              // Slow (< 150 kts): Blue
              primaryColor = isPro
                ? 'rgba(100, 180, 255, 0.9)'
                : `rgba(100, 180, 255, ${brightness})`;
              textColor = isPro ? 'rgba(150, 200, 255, 0.9)' : `rgba(150, 200, 255, ${brightness})`;
            } else {
              // Medium (150-300 kts): Cyan (default)
              primaryColor = isPro ? 'rgba(0, 255, 200, 0.9)' : `rgba(0, 255, 200, ${brightness})`;
              textColor = isPro ? 'rgba(150, 255, 220, 0.9)' : `rgba(150, 255, 220, ${brightness})`;
            }
          } else {
            // Green for civilian (default)
            primaryColor = isPro ? 'rgba(0, 255, 150, 0.9)' : `rgba(0, 255, 150, ${brightness})`;
            textColor = isPro ? 'rgba(150, 255, 200, 0.9)' : `rgba(150, 255, 200, ${brightness})`;
          }

          // Draw safety alert warning ring (severity-based colors)
          if (hasSafetyAlert) {
            ctx.save();
            const sevColors = getSeverityColors(alertSeverity, proximityFlashOn);
            const ringSize = proximityFlashOn ? 24 : 20;

            // Outer warning ring
            ctx.beginPath();
            ctx.arc(x, y, ringSize, 0, Math.PI * 2);
            ctx.strokeStyle = sevColors.ring;
            ctx.lineWidth = alertSeverity === 'critical' ? 4 : 3;
            ctx.stroke();

            // Inner ring
            ctx.beginPath();
            ctx.arc(x, y, ringSize - 6, 0, Math.PI * 2);
            ctx.strokeStyle = sevColors.ringInner;
            ctx.lineWidth = 1.5;
            ctx.stroke();

            ctx.restore();
          }

          // Draw emergency glow ring
          if (isEmergency && flashOn && !hasSafetyAlert) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(x, y, 18 + Math.sin(frameCount * 0.2) * 3, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 0, 0, ${0.4 + Math.sin(frameCount * 0.15) * 0.2})`;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
          }

          // Draw selection highlight (flashing green outline)
          const isSelected = selectedAircraft && selectedAircraft.hex === ac.hex;
          if (isSelected) {
            const selFlash = Math.floor(frameCount / 10) % 2 === 0;
            const selAlpha = selFlash ? 0.9 : 0.4;
            const selSize = selFlash ? 22 : 20;

            ctx.save();
            ctx.strokeStyle = `rgba(100, 220, 255, ${selAlpha})`;
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.arc(x, y, selSize, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);

            // Corner brackets
            ctx.strokeStyle = `rgba(100, 220, 255, ${selAlpha})`;
            ctx.lineWidth = 2;
            const bSize = 15;
            const bLen = 6;
            // Top-left
            ctx.beginPath();
            ctx.moveTo(x - bSize, y - bSize + bLen);
            ctx.lineTo(x - bSize, y - bSize);
            ctx.lineTo(x - bSize + bLen, y - bSize);
            ctx.stroke();
            // Top-right
            ctx.beginPath();
            ctx.moveTo(x + bSize - bLen, y - bSize);
            ctx.lineTo(x + bSize, y - bSize);
            ctx.lineTo(x + bSize, y - bSize + bLen);
            ctx.stroke();
            // Bottom-left
            ctx.beginPath();
            ctx.moveTo(x - bSize, y + bSize - bLen);
            ctx.lineTo(x - bSize, y + bSize);
            ctx.lineTo(x - bSize + bLen, y + bSize);
            ctx.stroke();
            // Bottom-right
            ctx.beginPath();
            ctx.moveTo(x + bSize - bLen, y + bSize);
            ctx.lineTo(x + bSize, y + bSize);
            ctx.lineTo(x + bSize, y + bSize - bLen);
            ctx.stroke();

            ctx.restore();
          }

          // Draw aircraft symbol (chevron pointing in direction of travel)
          const track = ((ac.track || 0) * Math.PI) / 180;
          // Phase 5.4: Level of Detail (LOD) - adjust symbol size based on range
          const lodFactor =
            radarRange <= 25 ? 1.2 : radarRange <= 75 ? 1 : radarRange <= 150 ? 0.9 : 0.8;
          const symSize = Math.round((isPro ? 10 : 9) * lodFactor);

          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(track);

          // Main symbol - different shapes for accessibility (Phase 7.1)
          ctx.fillStyle = primaryColor;
          ctx.strokeStyle = primaryColor;
          ctx.lineWidth = 2;

          if (highContrastMode && isPro) {
            // High contrast mode: use different shapes per aircraft type
            if (isEmergency) {
              // Emergency: Circle with X
              ctx.beginPath();
              ctx.arc(0, 0, symSize * 0.8, 0, Math.PI * 2);
              ctx.stroke();
              // X inside
              ctx.beginPath();
              ctx.moveTo(-symSize * 0.5, -symSize * 0.5);
              ctx.lineTo(symSize * 0.5, symSize * 0.5);
              ctx.moveTo(symSize * 0.5, -symSize * 0.5);
              ctx.lineTo(-symSize * 0.5, symSize * 0.5);
              ctx.stroke();
            } else if (isMilitary) {
              // Military: Diamond
              ctx.beginPath();
              ctx.moveTo(0, -symSize);
              ctx.lineTo(symSize * 0.7, 0);
              ctx.lineTo(0, symSize);
              ctx.lineTo(-symSize * 0.7, 0);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
            } else {
              // Civilian: Triangle (default chevron)
              ctx.beginPath();
              ctx.moveTo(0, -symSize);
              ctx.lineTo(-symSize * 0.6, symSize * 0.5);
              ctx.lineTo(0, symSize * 0.2);
              ctx.lineTo(symSize * 0.6, symSize * 0.5);
              ctx.closePath();
              ctx.fill();
            }
          } else {
            // Normal mode: filled chevron for all
            ctx.beginPath();
            ctx.moveTo(0, -symSize);
            ctx.lineTo(-symSize * 0.6, symSize * 0.5);
            ctx.lineTo(0, symSize * 0.2);
            ctx.lineTo(symSize * 0.6, symSize * 0.5);
            ctx.closePath();
            ctx.fill();
          }

          // Calculate turn rate from track history for curved velocity vectors
          let turnRate = 0; // degrees per second, positive = right turn
          const trackHistory = trackHistoryRef.current[ac.hex];
          if (trackHistory && trackHistory.length >= 2) {
            const oldest = trackHistory[0];
            const newest = trackHistory[trackHistory.length - 1];
            const timeDiff = (newest.time - oldest.time) / 1000; // seconds
            if (timeDiff > 0.5) {
              // Calculate track change, handling wrap-around at 360°
              let trackChange = newest.track - oldest.track;
              if (trackChange > 180) trackChange -= 360;
              if (trackChange < -180) trackChange += 360;
              turnRate = trackChange / timeDiff;
              // Clamp to reasonable values (max ~6°/sec for steep turns)
              turnRate = Math.max(-6, Math.min(6, turnRate));
            }
          }

          // Velocity vector line - basic (short)
          if (ac.gs > 50) {
            const vecLen = Math.min(20, ac.gs / 25);
            ctx.strokeStyle = isPro
              ? themeColors.rgba('vector', 0.6)
              : `rgba(0, 220, 255, ${brightness * 0.5})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, -symSize);
            ctx.lineTo(0, -symSize - vecLen);
            ctx.stroke();
          }

          // Extended prediction vectors (Phase 2.3) - skip when too many aircraft
          // Now supports curved paths for turning aircraft
          if (showPredictionVectors && ac.gs > 50 && isPro && !perfMode.skipPredictionVectors) {
            const pixelsPerNm = (Math.min(width, height) * 0.45) / radarRange;
            const nmPerSecond = ac.gs / 3600; // Convert knots to nm/second
            const isTurning = Math.abs(turnRate) > 0.3; // Significant turn threshold

            // Max vector lengths in pixels (prevents excessively long vectors when zoomed in)
            const maxLen30s = 120;
            const maxLen60s = 200;
            const maxLen120s = 280;

            if (isTurning) {
              // Draw curved prediction vectors for turning aircraft
              // Simple approach: integrate position with changing heading
              const pxPerSecond = nmPerSecond * pixelsPerNm;

              // Helper to draw curved path segment with max length
              const drawCurvedSegment = (startSec, endSec, opacity, dashPattern, maxLen) => {
                ctx.strokeStyle = themeColors.rgba('vector', opacity);
                ctx.lineWidth = 1;
                ctx.setLineDash(dashPattern);
                ctx.beginPath();

                const stepSec = 2;
                let startX = 0,
                  startY = -symSize - 20;
                let totalDist = 0;

                // Calculate starting position from previous segments
                if (startSec > 0) {
                  let headingRad = 0;
                  let posX = 0,
                    posY = 0;
                  for (let t = 0; t < startSec; t += stepSec) {
                    const dt = Math.min(stepSec, startSec - t);
                    headingRad += (turnRate * dt * Math.PI) / 180;
                    posX += Math.sin(headingRad) * pxPerSecond * dt;
                    posY -= Math.cos(headingRad) * pxPerSecond * dt;
                  }
                  startX = posX;
                  startY = posY - symSize - 20;
                }

                ctx.moveTo(startX, startY);

                let headingRad = (turnRate * startSec * Math.PI) / 180;
                let posX = startX,
                  posY = startY;

                for (let t = startSec; t < endSec; t += stepSec) {
                  const dt = Math.min(stepSec, endSec - t);
                  headingRad += (turnRate * dt * Math.PI) / 180;
                  const dx = Math.sin(headingRad) * pxPerSecond * dt;
                  const dy = -Math.cos(headingRad) * pxPerSecond * dt;
                  posX += dx;
                  posY += dy;
                  totalDist += Math.sqrt(dx * dx + dy * dy);

                  ctx.lineTo(posX, posY);
                  if (totalDist > maxLen) break; // Stop if max length reached
                }
                ctx.stroke();
              };

              // 30-second prediction (dotted)
              drawCurvedSegment(0, 30, 0.4, [3, 3], maxLen30s);

              // 60-second prediction (fainter dotted)
              if (predictionSeconds >= 60) {
                drawCurvedSegment(30, 60, 0.25, [2, 4], maxLen60s - maxLen30s);
              }

              // 120-second prediction (very faint)
              if (predictionSeconds >= 120) {
                drawCurvedSegment(60, 120, 0.15, [2, 6], maxLen120s - maxLen60s);
              }
            } else {
              // Straight prediction vectors (original behavior) with max lengths
              const nm30s = nmPerSecond * 30;
              const px30s = Math.min(nm30s * pixelsPerNm, maxLen30s);
              ctx.strokeStyle = themeColors.rgba('vector', 0.4);
              ctx.lineWidth = 1;
              ctx.setLineDash([3, 3]);
              ctx.beginPath();
              ctx.moveTo(0, -symSize - 20);
              ctx.lineTo(0, -symSize - 20 - px30s);
              ctx.stroke();

              // 60-second prediction (fainter dotted)
              if (predictionSeconds >= 60) {
                const nm60s = nmPerSecond * 60;
                const px60s = Math.min(nm60s * pixelsPerNm, maxLen60s);
                ctx.strokeStyle = themeColors.rgba('vector', 0.25);
                ctx.setLineDash([2, 4]);
                ctx.beginPath();
                ctx.moveTo(0, -symSize - 20 - px30s);
                ctx.lineTo(0, -symSize - 20 - px60s);
                ctx.stroke();
              }

              // 120-second prediction (very faint)
              if (predictionSeconds >= 120) {
                const nm120s = nmPerSecond * 120;
                const px120s = Math.min(nm120s * pixelsPerNm, maxLen120s);
                const px60sStart = Math.min(nmPerSecond * 60 * pixelsPerNm, maxLen60s);
                ctx.strokeStyle = themeColors.rgba('vector', 0.15);
                ctx.setLineDash([2, 6]);
                ctx.beginPath();
                ctx.moveTo(0, -symSize - 20 - px60sStart);
                ctx.lineTo(0, -symSize - 20 - px120s);
                ctx.stroke();
              }
            }
            ctx.setLineDash([]);
          }

          ctx.restore();

          // Altitude trend indicators (Phase 2.1) - drawn outside rotation
          const vs = ac.vr ?? ac.baro_rate ?? ac.geom_rate ?? 0;
          if (showVsTrend && isPro && Math.abs(vs) > 500) {
            const isClimbing = vs > 0;
            const isRapid = Math.abs(vs) > 2000;
            const trendColor = isClimbing ? 'rgba(0, 255, 100, 0.9)' : 'rgba(255, 200, 0, 0.9)';

            ctx.save();
            ctx.fillStyle = trendColor;
            ctx.font = isRapid
              ? 'bold 12px "JetBrains Mono", monospace'
              : '10px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Draw single or double chevron
            const trendX = x - 18;
            const trendY = y;
            if (isRapid) {
              // Double chevron for rapid climb/descent
              ctx.fillText(isClimbing ? '▲▲' : '▼▼', trendX, trendY);
            } else {
              // Single chevron
              ctx.fillText(isClimbing ? '▲' : '▼', trendX, trendY);
            }
            ctx.restore();
          }

          // Phase 8.2: MSAW warning visualization - pulsing ring around aircraft
          if (msaw.enabled) {
            const msawWarning = msaw.getWarning(ac.hex);
            if (msawWarning) {
              const pulseAlpha = 0.4 + 0.4 * Math.abs(Math.sin(Date.now() / 300));
              const ringColor =
                msawWarning.status === 'alert'
                  ? `rgba(255, 50, 50, ${pulseAlpha})` // Red for alert (<500ft)
                  : `rgba(255, 200, 0, ${pulseAlpha})`; // Yellow for warning (<1000ft)
              ctx.save();
              ctx.strokeStyle = ringColor;
              ctx.lineWidth = 2.5;
              ctx.beginPath();
              ctx.arc(x, y, symSize + 6, 0, Math.PI * 2);
              ctx.stroke();
              // Draw "MSAW" text above aircraft
              ctx.fillStyle = ringColor;
              ctx.font = '9px monospace';
              ctx.textAlign = 'center';
              ctx.fillText('MSAW', x, y - symSize - 8);
              ctx.restore();
            }
          }

          // Phase 8.4: Wake turbulence separation ring for H/J aircraft
          if (showWakeRings && isPro) {
            const wakeCat = determineWakeCategory(ac, aircraftInfo?.[ac.hex?.toUpperCase()] || {});
            const WAKE_SEP_NM = { J: 8, H: 6 };
            const sepNm = WAKE_SEP_NM[wakeCat] || 0;
            if (sepNm > 0) {
              const wakePixelsPerNm = (Math.min(width, height) * 0.45) / radarRange;
              const sepPx = sepNm * wakePixelsPerNm;
              const catColor = getWakeCategoryColor(wakeCat);
              ctx.save();
              ctx.strokeStyle = catColor + '66'; // semi-transparent
              ctx.lineWidth = 1.5;
              ctx.setLineDash([6, 4]);
              ctx.beginPath();
              ctx.arc(x, y, sepPx, 0, Math.PI * 2);
              ctx.stroke();
              ctx.setLineDash([]);
              // Label
              ctx.fillStyle = catColor + '99';
              ctx.font = '8px monospace';
              ctx.textAlign = 'left';
              ctx.fillText(`${sepNm}nm`, x + sepPx + 3, y);
              ctx.restore();
            }
          }

          // Position for data block (used by both data block and alert labels)
          // Phase 14.3: Support custom data block positions with leader lines
          const dataBlockOffset = getDataBlockOffset(ac.hex);
          const hasCustomPosition = hasCustomDataBlockOffset(ac.hex);
          const blockX = x + DATA_BLOCK_DEFAULT_X + dataBlockOffset.x;
          const blockY = y + DATA_BLOCK_DEFAULT_Y + dataBlockOffset.y;
          if (hasCustomPosition && isPro) {
            const leaderDist = Math.sqrt(dataBlockOffset.x ** 2 + dataBlockOffset.y ** 2);
            if (leaderDist > 20) {
              ctx.save();
              ctx.strokeStyle = themeColors.rgba('vector', 0.4);
              ctx.lineWidth = 1;
              ctx.setLineDash([3, 3]);
              ctx.beginPath();
              ctx.moveTo(x, y);
              ctx.lineTo(blockX - 2, blockY + 10);
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.restore();
            }
          }

          // Draw data block (callsign, speed, altitude, etc.) - respects showDataBlocks toggle, performance mode, and dataBlockConfig
          // Debug: Log data block thinning info (only once per draw cycle)
          if (frameCount === 1 && ac === aircraftToDraw[0]) {
            console.log('[MapView] Data block thinning:', {
              isPro,
              showDataBlocks,
              visibleDensity: density,
              maxDataBlocks: maxDataBlocks === Infinity ? 'unlimited' : maxDataBlocks,
              dataBlockSetSize: dataBlockVisibleSet.size,
              thinningActive: isPro && dataBlockVisibleSet.size > 0,
            });
          }
          // Check if data block should be shown (respects thinning at zoomed-out levels)
          // If thinning is not active (set is empty) or aircraft is in priority set, show data block
          const acHex = ac.hex?.toUpperCase();
          const showThisDataBlock =
            !isPro || // Always show in non-Pro mode
            dataBlockVisibleSet.size === 0 || // No thinning active
            !acHex || // Always show if no hex (shouldn't happen but be safe)
            dataBlockVisibleSet.has(acHex);

          if (showDataBlocks && !perfMode.skipDataBlocks && showThisDataBlock) {
            const callsign = ac.flight?.trim() || ac.hex;
            const speed = ac.gs ? `${Math.round(ac.gs)}` : '---';
            const altitude = ac.alt ? `${Math.round(ac.alt / 100)}` : '---';
            const heading = ac.track != null ? `${Math.round(ac.track)}°` : '---';
            const verticalSpeed =
              (ac.vr ?? ac.baro_rate) != null
                ? `${(ac.vr ?? ac.baro_rate) > 0 ? '+' : ''}${Math.round(ac.vr ?? ac.baro_rate)}fpm`
                : null;
            const aircraftType = ac.t || ac.desc || null;
            // Phase 8.4: Wake Turbulence Category
            const acInfo = aircraftInfo?.[ac.hex?.toUpperCase()] || {};
            const wakeCategory = determineWakeCategory(ac, acInfo);
            const wakeColor = wakeCategory ? getWakeCategoryColor(wakeCategory) : null;

            ctx.font = '13px "JetBrains Mono", monospace';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';

            // Build data block content based on config
            let labelLines = [];
            let labelWidth = 0;

            if (dataBlockConfig.compact) {
              // Compact mode: single line with all enabled fields
              const compactParts = [];
              if (dataBlockConfig.showCallsign) compactParts.push(callsign);
              if (dataBlockConfig.showSpeed) compactParts.push(`${speed}kts`);
              if (dataBlockConfig.showAltitude) compactParts.push(`FL${altitude}`);
              if (dataBlockConfig.showHeading) compactParts.push(heading);
              if (dataBlockConfig.showVerticalSpeed && verticalSpeed)
                compactParts.push(verticalSpeed);
              if (dataBlockConfig.showAircraftType && aircraftType) compactParts.push(aircraftType);
              if (dataBlockConfig.showWakeCategory && wakeCategory)
                compactParts.push(`[${wakeCategory}]`);

              const compactLine = compactParts.join(' ');
              labelLines = [{ text: compactLine, isCallsign: true }];
              labelWidth = ctx.measureText(compactLine).width + 8;
            } else {
              // Multi-line mode: each field on separate line or grouped logically
              // Line 1: Callsign (if enabled)
              if (dataBlockConfig.showCallsign) {
                labelLines.push({ text: callsign, isCallsign: true });
                labelWidth = Math.max(labelWidth, ctx.measureText(callsign).width);
              }

              // Line 2: Speed and Altitude (combined if both enabled)
              const line2Parts = [];
              if (dataBlockConfig.showSpeed) line2Parts.push(`${speed}kts`);
              if (dataBlockConfig.showAltitude) line2Parts.push(altitude);
              if (line2Parts.length > 0) {
                const line2 = line2Parts.join(' ');
                labelLines.push({ text: line2, isCallsign: false });
                labelWidth = Math.max(labelWidth, ctx.measureText(line2).width);
              }

              // Line 3: Heading (if enabled)
              if (dataBlockConfig.showHeading) {
                const headingLine = `HDG ${heading}`;
                labelLines.push({ text: headingLine, isCallsign: false });
                labelWidth = Math.max(labelWidth, ctx.measureText(headingLine).width);
              }

              // Line 4: Vertical Speed (if enabled and available)
              if (dataBlockConfig.showVerticalSpeed && verticalSpeed) {
                const vsLine = `VS ${verticalSpeed}`;
                labelLines.push({ text: vsLine, isCallsign: false });
                labelWidth = Math.max(labelWidth, ctx.measureText(vsLine).width);
              }

              // Line 5: Aircraft Type (if enabled and available)
              if (dataBlockConfig.showAircraftType && aircraftType) {
                labelLines.push({ text: aircraftType, isCallsign: false });
                labelWidth = Math.max(labelWidth, ctx.measureText(aircraftType).width);
              }

              // Line 6: Wake Turbulence Category (Phase 8.4)
              if (dataBlockConfig.showWakeCategory && wakeCategory) {
                const wakeLine = `WTC ${wakeCategory}`;
                labelLines.push({ text: wakeLine, isCallsign: false, color: wakeColor });
                labelWidth = Math.max(labelWidth, ctx.measureText(wakeLine).width);
              }

              labelWidth += 8;
            }

            // Calculate label height based on number of lines (15px per line + padding)
            const lineHeight = 15;
            const labelHeight = Math.max(18, labelLines.length * lineHeight + 4);

            // Phase 14.3: Collect data block rect for auto-deconfliction
            if (isPro) {
              dataBlockRects.push({
                hex: ac.hex?.toUpperCase(),
                x: blockX - 4,
                y: blockY - 2,
                width: labelWidth,
                height: labelHeight,
                aircraftX: x,
                aircraftY: y,
              });
            }

            // Draw background for label readability
            ctx.fillStyle = isPro ? 'rgba(10, 13, 18, 0.85)' : 'rgba(10, 15, 10, 0.8)';
            ctx.fillRect(blockX - 4, blockY - 2, labelWidth, labelHeight);

            // ACARS indicator - small green dot at top-right corner if aircraft has ACARS messages
            const hasAcars = acarsMessages.some(
              (msg) =>
                (msg.icao_hex && msg.icao_hex.toUpperCase() === ac.hex?.toUpperCase()) ||
                callsignsMatch(msg.callsign, ac.flight)
            );
            if (hasAcars) {
              ctx.save();
              ctx.fillStyle = 'rgba(0, 255, 100, 0.9)';
              ctx.beginPath();
              ctx.arc(blockX + labelWidth - 8, blockY + 2, 4, 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();
            }

            // Draw each line
            labelLines.forEach((line, index) => {
              if (line.isCallsign) {
                ctx.fillStyle = textColor;
                ctx.font = '13px "JetBrains Mono", monospace';
              } else if (line.color) {
                // Phase 8.4: Custom color for wake turbulence category
                ctx.fillStyle = line.color;
                ctx.font = 'bold 12px "JetBrains Mono", monospace';
              } else {
                ctx.fillStyle = isPro
                  ? `rgba(100, 200, 180, 0.85)`
                  : `rgba(0, 200, 100, ${brightness * 0.85})`;
                ctx.font = '12px "JetBrains Mono", monospace';
              }
              ctx.fillText(line.text, blockX, blockY + index * lineHeight);
            });

            // Draw status badges (MIL, EMG) after callsign line
            if (labelLines.length > 0 && (isMilitary || isEmergency)) {
              ctx.save();
              ctx.font = 'bold 9px "JetBrains Mono", monospace';
              const callsignWidth = ctx.measureText(labelLines[0]?.text || '').width;
              let badgeX = blockX + callsignWidth + 6;
              const badgeY = blockY - 1;

              // Military badge
              if (isMilitary) {
                const milText = 'MIL';
                const milWidth = ctx.measureText(milText).width + 6;
                ctx.fillStyle = 'rgba(168, 85, 247, 0.3)';
                ctx.fillRect(badgeX, badgeY, milWidth, 12);
                ctx.strokeStyle = 'rgba(168, 85, 247, 0.6)';
                ctx.lineWidth = 1;
                ctx.strokeRect(badgeX, badgeY, milWidth, 12);
                ctx.fillStyle = 'rgba(192, 132, 252, 0.95)';
                ctx.fillText(milText, badgeX + 3, badgeY + 9);
                badgeX += milWidth + 4;
              }

              // Emergency badge
              if (isEmergency) {
                const emgText = 'EMG';
                const emgWidth = ctx.measureText(emgText).width + 6;
                ctx.fillStyle = 'rgba(248, 81, 73, 0.3)';
                ctx.fillRect(badgeX, badgeY, emgWidth, 12);
                ctx.strokeStyle = 'rgba(248, 81, 73, 0.6)';
                ctx.lineWidth = 1;
                ctx.strokeRect(badgeX, badgeY, emgWidth, 12);
                ctx.fillStyle = 'rgba(255, 100, 100, 0.95)';
                ctx.fillText(emgText, badgeX + 3, badgeY + 9);
              }
              ctx.restore();
            }
          } // end showDataBlocks

          // Emergency squawk meaning label (Pro mode) - slow fade (always shown)
          if (isEmergency && isPro) {
            const squawkMeanings = {
              7500: 'HIJACK',
              7600: 'RADIO FAIL',
              7700: 'EMERGENCY',
            };
            const meaning = squawkMeanings[ac.squawk] || 'EMERGENCY';

            // Slow fade effect (cycle over ~3 seconds at 60fps)
            const fadeAlpha = 0.5 + Math.sin(frameCount * 0.035) * 0.5;

            ctx.save();
            ctx.font = 'bold 14px "JetBrains Mono", monospace';
            ctx.textAlign = 'left';

            // Draw background box for visibility
            const labelText = `⚠ ${meaning}`;
            const textWidth = ctx.measureText(labelText).width;
            ctx.fillStyle = `rgba(120, 0, 0, 0.85)`;
            ctx.fillRect(blockX - 3, blockY + 30, textWidth + 8, 20);

            // Draw border
            ctx.strokeStyle = `rgba(255, 60, 60, 0.9)`;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(blockX - 3, blockY + 30, textWidth + 8, 20);

            // Draw white text with slow fade
            ctx.fillStyle = `rgba(255, 255, 255, ${fadeAlpha})`;
            ctx.fillText(labelText, blockX + 1, blockY + 34);
            ctx.restore();
          }

          // Safety event / Proximity conflict warning label (Pro mode)
          if (hasSafetyAlert && isPro && !isEmergency) {
            const fadeAlpha = 0.5 + Math.sin(frameCount * 0.05) * 0.5;
            const sevColors = getSeverityColors(alertSeverity, proximityFlashOn);

            // Get event type name for label
            const eventNames = {
              tcas_ra: 'TCAS RA',
              extreme_vs: 'EXTREME V/S',
              vs_reversal: 'V/S REVERSAL',
              proximity_conflict: 'PROXIMITY',
              rapid_descent: 'RAPID DESCENT',
              rapid_climb: 'RAPID CLIMB',
            };
            const alertLabel = safetyEvent
              ? eventNames[safetyEvent.event_type] ||
                safetyEvent.event_type?.replace(/_/g, ' ').toUpperCase() ||
                'ALERT'
              : 'PROXIMITY';

            ctx.save();
            ctx.font = 'bold 14px "JetBrains Mono", monospace';
            ctx.textAlign = 'left';

            const labelText = `⚠ ${alertLabel}`;
            const textWidth = ctx.measureText(labelText).width;

            // Background color based on severity
            const bgColor =
              alertSeverity === 'critical'
                ? 'rgba(100, 30, 60, 0.85)'
                : alertSeverity === 'warning'
                  ? 'rgba(100, 60, 0, 0.85)'
                  : 'rgba(100, 80, 0, 0.85)';
            ctx.fillStyle = bgColor;
            ctx.fillRect(blockX - 3, blockY + 30, textWidth + 8, 20);

            // Border color based on severity
            ctx.strokeStyle = sevColors.ring;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(blockX - 3, blockY + 30, textWidth + 8, 20);

            // White text with fade
            ctx.fillStyle = `rgba(255, 255, 255, ${fadeAlpha})`;
            ctx.fillText(labelText, blockX + 1, blockY + 34);
            ctx.restore();
          }
        });

        // Phase 14.3: After drawing all data blocks, run auto-deconfliction
        if (autoDeconflictEnabled && dataBlockRects.length > 0) {
          maybeDeconflict(dataBlockRects);
        }
      }

      // ========== PRO MODE OVERLAYS ==========
      if (isPro) {
        const proPixelsPerNm = (Math.min(width, height) * 0.45) / radarRange;

        // Draw measurement tool (Phase 1.2)
        if (measurementPoints.length > 0) {
          ctx.save();
          ctx.strokeStyle = 'rgba(255, 200, 0, 0.9)';
          ctx.fillStyle = 'rgba(255, 200, 0, 0.9)';
          ctx.lineWidth = 2;

          // Draw point A marker
          const ptA = measurementPoints[0];
          const aX =
            centerX +
            (ptA.lon - feederLon) * 60 * Math.cos((feederLat * Math.PI) / 180) * proPixelsPerNm +
            proPanOffset.x;
          const aY = centerY - (ptA.lat - feederLat) * 60 * proPixelsPerNm + proPanOffset.y;
          ctx.beginPath();
          ctx.arc(aX, aY, 6, 0, Math.PI * 2);
          ctx.stroke();
          ctx.font = 'bold 12px "JetBrains Mono", monospace';
          ctx.textAlign = 'left';
          ctx.fillText('A', aX + 10, aY + 4);

          // Draw line and point B if we have two points
          if (measurementPoints.length === 2) {
            const ptB = measurementPoints[1];
            const bX =
              centerX +
              (ptB.lon - feederLon) * 60 * Math.cos((feederLat * Math.PI) / 180) * proPixelsPerNm +
              proPanOffset.x;
            const bY = centerY - (ptB.lat - feederLat) * 60 * proPixelsPerNm + proPanOffset.y;

            // Draw line between points
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            ctx.moveTo(aX, aY);
            ctx.lineTo(bX, bY);
            ctx.stroke();
            ctx.setLineDash([]);

            // Draw point B marker
            ctx.beginPath();
            ctx.arc(bX, bY, 6, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillText('B', bX + 10, bY + 4);

            // Calculate and display distance/bearing
            const dLat = ptB.lat - ptA.lat;
            const dLon = ptB.lon - ptA.lon;
            const nmY = dLat * 60;
            const nmX = dLon * 60 * Math.cos((((ptA.lat + ptB.lat) / 2) * Math.PI) / 180);
            const distance = Math.sqrt(nmX * nmX + nmY * nmY);
            const bearing = ((Math.atan2(nmX, nmY) * 180) / Math.PI + 360) % 360;

            // Draw label at midpoint
            const midX = (aX + bX) / 2;
            const midY = (aY + bY) / 2;
            const labelText = `${distance.toFixed(1)} nm / ${bearing.toFixed(0)}°`;
            const labelWidth = ctx.measureText(labelText).width + 10;
            ctx.fillStyle = 'rgba(20, 30, 40, 0.9)';
            ctx.fillRect(midX - labelWidth / 2, midY - 20, labelWidth, 18);
            ctx.fillStyle = 'rgba(255, 200, 0, 0.9)';
            ctx.textAlign = 'center';
            ctx.fillText(labelText, midX, midY - 7);
          }
          ctx.restore();
        }

        // Draw cursor info readout (Phase 1.1) - bottom-left corner
        if (cursorInfo) {
          ctx.save();
          ctx.fillStyle = 'rgba(15, 25, 35, 0.9)';
          ctx.fillRect(10, height - 70, 180, 60);
          ctx.strokeStyle = 'rgba(80, 140, 200, 0.5)';
          ctx.lineWidth = 1;
          ctx.strokeRect(10, height - 70, 180, 60);

          ctx.font = '11px "JetBrains Mono", monospace';
          ctx.fillStyle = 'rgba(100, 180, 255, 0.9)';
          ctx.textAlign = 'left';

          const latStr = `${Math.abs(cursorInfo.lat).toFixed(4)}°${cursorInfo.lat >= 0 ? 'N' : 'S'}`;
          const lonStr = `${Math.abs(cursorInfo.lon).toFixed(4)}°${cursorInfo.lon >= 0 ? 'E' : 'W'}`;
          ctx.fillText(`LAT: ${latStr}`, 18, height - 52);
          ctx.fillText(`LON: ${lonStr}`, 18, height - 38);
          ctx.fillStyle = 'rgba(150, 220, 255, 0.9)';
          ctx.fillText(`DST: ${cursorInfo.distance.toFixed(1)} nm`, 18, height - 24);
          ctx.fillText(`BRG: ${cursorInfo.bearing.toFixed(0)}°`, 110, height - 24);
          ctx.restore();
        }

        // Draw FPS counter (Phase 5.3 - debug mode)
        if (showFpsCounter) {
          const now = Date.now();
          fpsRef.current.frames++;
          if (now - fpsRef.current.lastTime >= 1000) {
            fpsRef.current.fps = fpsRef.current.frames;
            fpsRef.current.frames = 0;
            fpsRef.current.lastTime = now;
          }
          ctx.save();
          ctx.fillStyle = 'rgba(15, 25, 35, 0.8)';
          ctx.fillRect(width - 70, 10, 60, 22);
          ctx.font = '12px "JetBrains Mono", monospace';
          ctx.fillStyle =
            fpsRef.current.fps >= 30 ? 'rgba(0, 255, 100, 0.9)' : 'rgba(255, 150, 0, 0.9)';
          ctx.textAlign = 'right';
          ctx.fillText(`${fpsRef.current.fps} FPS`, width - 15, 26);
          ctx.restore();
        }

        // Draw keyboard shortcut hint (bottom-right)
        ctx.save();
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(80, 120, 160, 0.5)';
        ctx.textAlign = 'right';
        ctx.fillText('Press ? for shortcuts', width - 15, height - 10);
        ctx.restore();
      }

      // Add scanlines effect - CRT mode only
      if (!isPro) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.03)';
        for (let y = 0; y < height; y += 2) {
          ctx.fillRect(0, y, width, 1);
        }

        // Subtle vignette - CRT mode only
        const gradient = ctx.createRadialGradient(
          centerX,
          centerY,
          0,
          centerX,
          centerY,
          Math.max(width, height) * 0.7
        );
        gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0.4)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      // Bug fix #5: Clean up all tracked event listeners to prevent duplicates
      eventListeners.forEach(({ target, event, handler, options }) => {
        target.removeEventListener(event, handler, options);
      });
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [
    config.mapMode,
    sortedAircraft,
    radarRange,
    feederLat,
    feederLon,
    selectedAircraft,
    selectedMetar,
    selectedPirep,
    selectedNavaid,
    selectedAirport,
    overlays,
    aviationData,
    aviationOverlayData,
    proPanOffset,
    followingAircraft,
    trackHistory,
    showSelectedTrack,
    safetyEvents,
    showShortTracks,
    shortTrackHistory,
    config.shortTrackLength,
    gridOpacity,
    showCompassRose,
    showSpeedColors,
    showPredictionVectors,
    predictionSeconds,
    showConflictVisualization,
    showDataBlocks,
    measurementPoints,
    cursorInfo,
    showFpsCounter,
    showAltitudeTrails,
    reducedMotion,
    msaw,
    showWakeRings,
    aircraftInfo,
  ]);

  // Leaflet map setup
  useEffect(() => {
    if (config.mapMode !== 'map' || !mapRef.current) return;

    if (!leafletMapRef.current) {
      // Use initial center from URL if available, otherwise use feeder location
      const center = initialCenterRef.current
        ? [initialCenterRef.current.lat, initialCenterRef.current.lon]
        : [feederLat, feederLon];
      const zoom = initialZoomRef.current || 8;

      leafletMapRef.current = L.map(mapRef.current, {
        center,
        zoom,
        zoomControl: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
      }).addTo(leafletMapRef.current);

      // Add feeder marker
      const feederIcon = L.divIcon({
        className: 'feeder-marker',
        html: `<div style="width: 12px; height: 12px; background: #00ff88; border: 2px solid #004422; border-radius: 50%; box-shadow: 0 0 10px #00ff88;"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });
      feederMarkerRef.current = L.marker(center, { icon: feederIcon })
        .addTo(leafletMapRef.current)
        .bindTooltip('Feeder Location', { permanent: false });

      // Update viewport center on map move/zoom for dynamic aviation data loading and URL sync
      const handleViewportChange = () => {
        // Debounce viewport updates to avoid excessive API calls and URL spam
        if (viewportUpdateTimeoutRef.current) {
          clearTimeout(viewportUpdateTimeoutRef.current);
        }
        viewportUpdateTimeoutRef.current = setTimeout(() => {
          const mapCenter = leafletMapRef.current?.getCenter();
          const mapZoom = leafletMapRef.current?.getZoom();
          if (mapCenter) {
            setViewportCenter({ lat: mapCenter.lat, lon: mapCenter.lng });

            // Update URL with center if significantly different from feeder location
            // Use refs to get latest values
            const currentFeederLat = feederLatRef.current;
            const currentFeederLon = feederLonRef.current;
            const latDiff = Math.abs(mapCenter.lat - currentFeederLat);
            const lonDiff = Math.abs(mapCenter.lng - currentFeederLon);
            const zoomDiff = Math.abs(mapZoom - 8);

            // Use ref to get latest setHashParams function
            const updateHash = setHashParamsRef.current;
            if (updateHash && (latDiff > 0.01 || lonDiff > 0.01 || zoomDiff > 0)) {
              updateHash({
                lat: mapCenter.lat.toFixed(4),
                lon: mapCenter.lng.toFixed(4),
                zoom: String(mapZoom),
              });
            } else if (updateHash && latDiff <= 0.01 && lonDiff <= 0.01 && zoomDiff === 0) {
              // Clear center params if back to default
              updateHash({ lat: undefined, lon: undefined, zoom: undefined });
            }
          }
        }, 500); // 500ms debounce
      };

      leafletMapRef.current.on('moveend', handleViewportChange);
      leafletMapRef.current.on('zoomend', handleViewportChange);

      setTimeout(() => {
        leafletMapRef.current?.invalidateSize();
      }, 100);
    }

    const tilePane = leafletMapRef.current.getPane('tilePane');
    if (tilePane) {
      if (config.mapDarkMode) {
        tilePane.classList.add('dark-tiles');
      } else {
        tilePane.classList.remove('dark-tiles');
      }
    }

    return () => {
      // Clean up viewport update timeout
      if (viewportUpdateTimeoutRef.current) {
        clearTimeout(viewportUpdateTimeoutRef.current);
      }
      // Always clean up map on effect re-run or unmount
      if (leafletMapRef.current) {
        leafletMapRef.current.off('moveend');
        leafletMapRef.current.off('zoomend');
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
        markersRef.current = {};
        shortTrackPolylinesRef.current = {};
        feederMarkerRef.current = null;
      }
    };
  }, [config.mapMode, config.mapDarkMode]);

  // Leaflet marker creation/removal (runs when aircraft list changes)
  useEffect(() => {
    if (config.mapMode !== 'map' || !leafletMapRef.current) return;

    console.log('Updating markers:', sortedAircraft.length, 'aircraft with position');

    const currentHexes = new Set(sortedAircraft.map((a) => a.hex));

    // Remove markers for aircraft no longer present
    Object.keys(markersRef.current).forEach((hex) => {
      if (!currentHexes.has(hex)) {
        try {
          markersRef.current[hex]?.remove();
        } catch (e) {
          // Already removed
        }
        delete markersRef.current[hex];
      }
    });

    // Build set of aircraft with safety events for z-index priority
    const safetyAircraftHexes = new Set();
    safetyEvents.forEach((event) => {
      if (event.icao) safetyAircraftHexes.add(event.icao.toUpperCase());
      if (event.icao_2) safetyAircraftHexes.add(event.icao_2.toUpperCase());
    });

    // Create markers for new aircraft (positions updated by animation loop below)
    sortedAircraft.slice(0, 150).forEach((ac) => {
      if (!ac.lat || !ac.lon) return;

      const hasSafetyEvent = safetyAircraftHexes.has(ac.hex?.toUpperCase());
      const color = ac.emergency ? '#f85149' : ac.military ? '#a371f7' : '#00d4ff';
      const rotation = ac.track || 0;

      const icon = L.divIcon({
        className: `aircraft-marker${hasSafetyEvent ? ' safety-event' : ''}`,
        html: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="transform: rotate(${rotation}deg); filter: drop-shadow(0 0 4px ${color});">
          <path d="M12 2L4 12l8 2 8-2-8-10z" fill="${color}" stroke="${color}" stroke-width="1"/>
          <path d="M12 14v8M8 18l4 2 4-2" stroke="${color}" stroke-width="1.5"/>
        </svg>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      // Set higher z-index for aircraft with safety events or emergencies
      const zOffset = hasSafetyEvent ? 2000 : ac.emergency ? 1000 : 0;

      // Bug fix #1 & #3: Add null check before marker methods
      const existingMarker = markersRef.current[ac.hex];
      if (existingMarker) {
        // Update icon and z-index (position updated by animation loop)
        existingMarker.setIcon(icon);
        existingMarker.setZIndexOffset(zOffset);
      } else {
        const marker = L.marker([ac.lat, ac.lon], { icon, zIndexOffset: zOffset })
          .addTo(leafletMapRef.current)
          .on('click', () => selectAircraft(ac))
          .on('dblclick', () => openAircraftSidebar(ac.hex));
        // Bug fix #10: Handle edge cases for tooltip - fallback for both flight and hex being falsy,
        // and properly handle altitude 0 (valid) vs null/undefined
        const displayName = ac.flight?.trim() || ac.hex || 'Unknown';
        const displayAlt = ac.alt != null ? `${ac.alt}ft` : '?';
        marker.bindTooltip(`${displayName}<br>${displayAlt}`, {
          permanent: false,
          direction: 'top',
        });
        markersRef.current[ac.hex] = marker;
      }
    });
  }, [sortedAircraft, config.mapMode, safetyEvents]);

  // High-frequency Leaflet marker position updates using positionsRef
  // This runs in a requestAnimationFrame loop for smooth interpolated movement
  useEffect(() => {
    // Bug fix #6: Add null check for positionsRef before accessing .current
    if (config.mapMode !== 'map' || !leafletMapRef.current || !positionsRef) return;

    let animFrameId = null;

    const updateMarkerPositions = () => {
      // Bug fix #6: Verify positionsRef still exists before accessing .current
      if (!positionsRef) {
        return; // Stop the loop if positionsRef becomes null
      }
      const positions = positionsRef.current;
      if (!positions) {
        animFrameId = requestAnimationFrame(updateMarkerPositions);
        return;
      }

      // Update marker positions from interpolated data
      // Bug fix #1: Verify markersRef.current exists
      if (!markersRef.current) {
        animFrameId = requestAnimationFrame(updateMarkerPositions);
        return;
      }

      for (const hex in markersRef.current) {
        const marker = markersRef.current[hex];
        if (!marker) continue;

        const interpolated = positions[hex] || positions[hex.toUpperCase()];
        if (interpolated && interpolated.lat != null && interpolated.lon != null) {
          try {
            marker.setLatLng([interpolated.lat, interpolated.lon]);

            // Update icon rotation if track changed significantly
            if (interpolated.track != null) {
              const currentIcon = marker.getIcon();
              if (currentIcon && currentIcon.options && currentIcon.options.html) {
                // Extract current rotation from icon HTML
                const match = currentIcon.options.html.match(/rotate\(([0-9.]+)deg\)/);
                const currentRotation = match ? parseFloat(match[1]) : 0;
                const newRotation = interpolated.track;

                // Only update icon if rotation changed by more than 2 degrees
                let diff = Math.abs(newRotation - currentRotation);
                if (diff > 180) diff = 360 - diff;
                if (diff > 2) {
                  const newHtml = currentIcon.options.html.replace(
                    /rotate\([0-9.]+deg\)/,
                    `rotate(${newRotation}deg)`
                  );
                  marker.setIcon(
                    L.divIcon({
                      ...currentIcon.options,
                      html: newHtml,
                    })
                  );
                }
              }
            }
          } catch (e) {
            // Marker was removed, skip
            continue;
          }
        }
      }

      animFrameId = requestAnimationFrame(updateMarkerPositions);
    };

    animFrameId = requestAnimationFrame(updateMarkerPositions);

    return () => {
      if (animFrameId) {
        cancelAnimationFrame(animFrameId);
      }
    };
  }, [config.mapMode, positionsRef]);

  // Leaflet polyline updates for short tracks in map mode
  useEffect(() => {
    if (config.mapMode !== 'map' || !leafletMapRef.current) return;

    // Remove all polylines if short tracks disabled
    if (!showShortTracks) {
      Object.values(shortTrackPolylinesRef.current).forEach((polyline) => polyline.remove());
      shortTrackPolylinesRef.current = {};
      return;
    }

    const currentHexes = new Set(sortedAircraft.map((a) => a.hex));
    const now = Date.now();
    const trackLength = config.shortTrackLength || 15;
    const maxAge = trackLength * 6000; // ~6 seconds per position

    // Remove polylines for aircraft no longer present
    Object.keys(shortTrackPolylinesRef.current).forEach((hex) => {
      if (!currentHexes.has(hex)) {
        shortTrackPolylinesRef.current[hex].remove();
        delete shortTrackPolylinesRef.current[hex];
      }
    });

    // Update or create polylines for each aircraft
    sortedAircraft.slice(0, 150).forEach((ac) => {
      if (!ac.lat || !ac.lon || !ac.hex) return;

      // Combine historical and realtime positions
      const historicPositions = shortTrackHistory[ac.hex] || [];
      const realtimePositions = trackHistory[ac.hex] || [];

      const allPositions = [
        ...historicPositions.filter((p) => now - p.time < maxAge),
        ...realtimePositions.filter((p) => now - p.time < maxAge),
      ].sort((a, b) => a.time - b.time);

      // Keep only last N positions (configurable)
      const positions = allPositions.slice(-trackLength);

      if (positions.length < 2) {
        // Remove existing polyline if not enough points
        if (shortTrackPolylinesRef.current[ac.hex]) {
          shortTrackPolylinesRef.current[ac.hex].remove();
          delete shortTrackPolylinesRef.current[ac.hex];
        }
        return;
      }

      const latlngs = positions.map((p) => [p.lat, p.lon]);
      const color = '#ffffff';

      if (shortTrackPolylinesRef.current[ac.hex]) {
        shortTrackPolylinesRef.current[ac.hex].setLatLngs(latlngs);
      } else {
        const polyline = L.polyline(latlngs, {
          color: color,
          weight: 2,
          opacity: 0.5,
          dashArray: '4, 4',
        }).addTo(leafletMapRef.current);
        shortTrackPolylinesRef.current[ac.hex] = polyline;
      }
    });
  }, [
    sortedAircraft,
    config.mapMode,
    config.shortTrackLength,
    showShortTracks,
    shortTrackHistory,
    trackHistory,
  ]);

  const _cycleMapMode = () => {
    const modes = ['radar', 'crt', 'pro', 'map'];
    const currentIndex = modes.indexOf(config.mapMode);
    const nextMode = modes[(currentIndex + 1) % modes.length];
    const newConfig = { ...config, mapMode: nextMode };
    setConfig(newConfig);
    saveConfig(newConfig);
    // Update URL hash with new mode
    if (setHashParams) {
      setHashParams({ mode: nextMode });
    }
  };

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

  // Update URL when overlays change
  const updateOverlays = (newOverlays) => {
    setOverlays(newOverlays);
    saveOverlays(newOverlays);
    if (setHashParams) {
      const enabledOverlays = Object.entries(newOverlays)
        .filter(([, enabled]) => enabled)
        .map(([key]) => key)
        .join(',');
      setHashParams({ overlays: enabledOverlays || undefined });
    }
  };

  // Update layer opacity
  const _updateLayerOpacity = (layer, opacity) => {
    setLayerOpacities((prev) => ({ ...prev, [layer]: opacity }));
  };

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

  // Open sidebar quick view for aircraft
  const openAircraftSidebar = (hex) => {
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
  };

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

  // Update URL when selecting aircraft (popup, not full detail)
  const selectAircraft = (ac) => {
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
  };

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
  const getSeverityClass = (severity) => {
    switch (severity) {
      case 'critical':
        return 'severity-critical';
      case 'warning':
        return 'severity-warning';
      default:
        return 'severity-low';
    }
  };

  // Get event type display name
  const getEventTypeName = (eventType) => {
    const names = {
      tcas_ra: 'TCAS RA',
      extreme_vs: 'EXTREME V/S',
      vs_reversal: 'V/S REVERSAL',
      proximity_conflict: 'PROXIMITY',
      rapid_descent: 'RAPID DESCENT',
      rapid_climb: 'RAPID CLIMB',
      squawk_hijack: 'SQUAWK 7500',
      squawk_radio_failure: 'SQUAWK 7600',
      squawk_emergency: 'SQUAWK 7700',
    };
    return names[eventType] || eventType?.replace(/_/g, ' ').toUpperCase() || 'ALERT';
  };

  // Render event-specific banner content based on event type
  const renderEventBannerContent = (event) => {
    const eventType = event.event_type;
    const details = event.details || {};

    // Emergency squawks - show squawk code prominently
    if (eventType?.startsWith('squawk_')) {
      const squawkMeanings = {
        squawk_hijack: 'HIJACK',
        squawk_radio_failure: 'RADIO FAILURE',
        squawk_emergency: 'EMERGENCY',
      };
      return (
        <>
          <div className="banner-main-info">
            <span className="banner-squawk-code">{details.squawk || event.squawk}</span>
            <span className="banner-squawk-meaning">
              {squawkMeanings[eventType] || 'EMERGENCY'}
            </span>
          </div>
          <div className="banner-aircraft">
            <span className="banner-callsign">{event.callsign || event.icao}</span>
            {details.altitude && (
              <span className="banner-altitude">{details.altitude.toLocaleString()}ft</span>
            )}
          </div>
        </>
      );
    }

    // Proximity conflict - show separation info
    if (eventType === 'proximity_conflict') {
      return (
        <>
          <div className="banner-main-info">
            <span className="banner-separation-horiz">
              {details.horizontal_nm || details.distance_nm}nm
            </span>
            <span className="banner-separation-divider">/</span>
            <span className="banner-separation-vert">
              {details.vertical_ft || details.altitude_diff_ft}ft
            </span>
          </div>
          <div className="banner-aircraft">
            <span className="banner-callsign">{event.callsign || event.icao}</span>
            <span className="banner-vs-aircraft">↔</span>
            <span className="banner-callsign">{event.callsign_2 || event.icao_2}</span>
          </div>
        </>
      );
    }

    // TCAS RA - show VS change
    if (eventType === 'tcas_ra') {
      return (
        <>
          <div className="banner-main-info">
            <span className="banner-vs-change">
              {details.previous_vs > 0 ? '+' : ''}
              {details.previous_vs} → {details.current_vs > 0 ? '+' : ''}
              {details.current_vs}
            </span>
            <span className="banner-vs-unit">fpm</span>
          </div>
          <div className="banner-aircraft">
            <span className="banner-callsign">{event.callsign || event.icao}</span>
            {details.altitude && (
              <span className="banner-altitude">{details.altitude.toLocaleString()}ft</span>
            )}
          </div>
        </>
      );
    }

    // VS Reversal - show VS change
    if (eventType === 'vs_reversal') {
      return (
        <>
          <div className="banner-main-info">
            <span className="banner-vs-change">
              {details.previous_vs > 0 ? '+' : ''}
              {details.previous_vs} → {details.current_vs > 0 ? '+' : ''}
              {details.current_vs}
            </span>
            <span className="banner-vs-unit">fpm</span>
          </div>
          <div className="banner-aircraft">
            <span className="banner-callsign">{event.callsign || event.icao}</span>
            {details.altitude && (
              <span className="banner-altitude">{details.altitude.toLocaleString()}ft</span>
            )}
          </div>
        </>
      );
    }

    // Extreme VS - show current VS
    if (eventType === 'extreme_vs') {
      const vs = details.vertical_rate;
      return (
        <>
          <div className="banner-main-info">
            <span className="banner-vs-value">
              {vs > 0 ? '+' : ''}
              {vs}
            </span>
            <span className="banner-vs-unit">fpm</span>
          </div>
          <div className="banner-aircraft">
            <span className="banner-callsign">{event.callsign || event.icao}</span>
            {details.altitude && (
              <span className="banner-altitude">{details.altitude.toLocaleString()}ft</span>
            )}
          </div>
        </>
      );
    }

    // Default fallback
    return (
      <>
        <div className="banner-main-info">
          <span className="banner-callsign">{event.callsign || event.icao}</span>
          {event.callsign_2 && <span className="banner-callsign-2">↔ {event.callsign_2}</span>}
        </div>
        {event.message && <div className="banner-message">{event.message}</div>}
      </>
    );
  };

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
      {/* Mobile Map Header - map controls for mobile devices */}
      <div className="mobile-map-header">
        <input
          type="text"
          className="mobile-search-input"
          placeholder="Search callsign, squawk, ICAO..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            className="mobile-search-clear"
            onClick={(e) => {
              e.stopPropagation();
              setSearchQuery('');
            }}
          >
            <X size={16} />
          </button>
        )}
        <div className="mobile-header-actions">
          <button
            className={`mobile-header-btn ${showShortTracks ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setShowShortTracks(!showShortTracks);
            }}
            title="Trails"
          >
            <Navigation size={18} />
          </button>
          <button
            className="mobile-header-btn"
            onClick={(e) => {
              e.stopPropagation();
              if (config.mapMode === 'map' && leafletMapRef.current) {
                leafletMapRef.current.flyTo([feederLat, feederLon], 10, { duration: 1 });
              } else if (config.mapMode === 'pro' || config.mapMode === 'crt') {
                setProPanOffset({ x: 0, y: 0 });
              }
            }}
            title="Center"
          >
            <LocateFixed size={18} />
          </button>
          <button
            className={`mobile-header-btn ${soundMuted ? 'muted' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setSoundMuted(!soundMuted);
            }}
            title={soundMuted ? 'Unmute' : 'Mute'}
          >
            {soundMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </div>
        <button
          className={`mobile-menu-btn ${showMobileControls ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setShowMobileControls(!showMobileControls);
          }}
        >
          {showMobileControls ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile Controls Dropdown */}
      {showMobileControls && (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div className="mobile-controls-dropdown" onClick={(e) => e.stopPropagation()}>
          <div className="mobile-controls-grid">
            <button
              className={`mobile-control-item ${showAircraftList ? 'active' : ''}`}
              onClick={() => {
                setShowAircraftList(!showAircraftList);
                setShowMobileControls(false);
              }}
            >
              <Plane size={18} />
              <span>Aircraft ({aircraft.length})</span>
            </button>
            <button
              className={`mobile-control-item ${showFilterMenu ? 'active' : ''}`}
              onClick={() => {
                setShowFilterMenu(!showFilterMenu);
                setShowOverlayMenu(false);
              }}
            >
              <Filter size={18} />
              <span>Filters</span>
            </button>
            <button
              className={`mobile-control-item ${showOverlayMenu ? 'active' : ''}`}
              onClick={() => {
                setShowOverlayMenu(!showOverlayMenu);
                setShowFilterMenu(false);
              }}
            >
              <Layers size={18} />
              <span>Layers</span>
            </button>
            <button
              className={`mobile-control-item ${showShortTracks ? 'active' : ''}`}
              onClick={() => setShowShortTracks(!showShortTracks)}
            >
              <Navigation size={18} />
              <span>Trails</span>
            </button>
            <button
              className="mobile-control-item"
              onClick={() => {
                if (config.mapMode === 'map' && leafletMapRef.current) {
                  leafletMapRef.current.flyTo([feederLat, feederLon], 10, { duration: 1 });
                } else if (config.mapMode === 'pro' || config.mapMode === 'crt') {
                  setProPanOffset({ x: 0, y: 0 });
                }
                setShowMobileControls(false);
              }}
            >
              <LocateFixed size={18} />
              <span>Center</span>
            </button>
            <button
              className={`mobile-control-item ${soundMuted ? 'active muted' : ''}`}
              onClick={() => setSoundMuted(!soundMuted)}
            >
              {soundMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              <span>{soundMuted ? 'Unmute' : 'Mute'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Safety Event Banner - Shows highest priority event (only in map/radar mode) */}
      {activeConflicts.length > 0 && config.mapMode !== 'pro' && config.mapMode !== 'crt' && (
        <div className="conflict-banners-container">
          {activeConflicts
            .filter((event) => !acknowledgedEvents.has(event.id))
            .slice(0, 1)
            .map((event, idx) => (
              <div
                key={event.id || `conflict-${event.icao}-${idx}`}
                className={`conflict-banner ${getSeverityClass(event.severity)} event-type-${event.event_type}`}
                onClick={() => {
                  // Find and select the aircraft
                  const ac = aircraft.find(
                    (a) => a.hex?.toUpperCase() === event.icao?.toUpperCase()
                  );
                  if (ac) {
                    setSelectedMetar(null);
                    setSelectedPirep(null);
                    setSelectedNavaid(null);
                    setSelectedAirport(null);
                    setPopupPosition({ x: 16, y: 16 });
                    selectAircraft(ac);
                    // Fly to the aircraft location based on map mode
                    if (ac.lat && ac.lon) {
                      if (config.mapMode === 'map' && leafletMapRef.current) {
                        leafletMapRef.current.flyTo([ac.lat, ac.lon], 12, {
                          duration: 1.5,
                          easeLinearity: 0.25,
                        });
                      }
                    }
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const ac = aircraft.find(
                      (a) => a.hex?.toUpperCase() === event.icao?.toUpperCase()
                    );
                    if (ac) {
                      setSelectedMetar(null);
                      setSelectedPirep(null);
                      setSelectedNavaid(null);
                      setSelectedAirport(null);
                      setPopupPosition({ x: 16, y: 16 });
                      selectAircraft(ac);
                    }
                  }
                }}
                role="button"
                tabIndex={0}
                style={{ cursor: 'pointer' }}
              >
                <AlertTriangle size={28} />
                <div className="conflict-banner-content">
                  <strong className="banner-event-type">
                    {getEventTypeName(event.event_type)}
                  </strong>
                  {renderEventBannerContent(event)}
                </div>
                <button
                  className="conflict-ack-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    acknowledgeEvent(event.id);
                  }}
                  title="Acknowledge and dismiss"
                >
                  <Check size={20} />
                </button>
              </div>
            ))}
        </div>
      )}

      {/* Simple Radar Mode */}
      {config.mapMode === 'radar' && (
        <div className="map-overlay">
          <div className="radar-grid">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="radar-ring"
                style={{ width: `${(i + 1) * 20}%`, height: `${(i + 1) * 20}%` }}
              />
            ))}
            <div className="radar-crosshair" />
          </div>

          {/* Feeder location marker */}
          <div
            className="feeder-marker-radar"
            style={{
              left: `${feederPos.x}%`,
              top: `${feederPos.y}%`,
            }}
            title="Feeder Location"
          >
            <Radio size={16} />
          </div>

          <div className="aircraft-blips">
            {sortedAircraft.slice(0, 100).map((ac) => {
              const pos = getPosition(ac.lat, ac.lon);
              return (
                <div
                  key={ac.hex}
                  className={`aircraft-blip ${ac.military ? 'military' : ''} ${ac.emergency ? 'emergency' : ''}`}
                  style={{
                    left: `${pos.x}%`,
                    top: `${pos.y}%`,
                    transform: `translate(-50%, -50%) rotate(${ac.track || 0}deg)`,
                  }}
                  onClick={() => selectAircraft(ac)}
                  onContextMenu={(e) => handleAircraftContextMenu(e, ac)}
                  onKeyDown={(e) => e.key === 'Enter' && selectAircraft(ac)}
                  role="button"
                  tabIndex={0}
                  title={`${ac.flight || ac.hex} - ${ac.alt || '?'}ft${hasAircraftNote(ac.hex) ? ' [Note]' : ''}`}
                  aria-label={`Aircraft ${ac.flight || ac.hex}${hasAircraftNote(ac.hex) ? ', has note' : ''}`}
                >
                  <Plane size={16} />
                  {hasAircraftNote(ac.hex) && (
                    <span className="aircraft-note-indicator" title="Has note" aria-hidden="true">
                      *
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
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
                  onClick={(e) => {
                    const rect = canvasRef.current.getBoundingClientRect();
                    const clickX = e.clientX - rect.left;
                    const clickY = e.clientY - rect.top;
                    const centerX = rect.width / 2;
                    const centerY = rect.height / 2;
                    const maxRadius = Math.min(rect.width, rect.height) * 0.45;
                    const pixelsPerNm = maxRadius / radarRange;

                    // Phase 1.2: Measurement tool (Shift+click)
                    if (e.shiftKey && config.mapMode === 'pro') {
                      // Convert click position to lat/lon
                      const nmX = (clickX - centerX - proPanOffset.x) / pixelsPerNm;
                      const nmY = -(clickY - centerY - proPanOffset.y) / pixelsPerNm;
                      const clickLat = feederLat + nmY / 60;
                      const clickLon =
                        feederLon + nmX / (60 * Math.cos((feederLat * Math.PI) / 180));

                      if (measurementPoints.length === 0) {
                        // First point
                        setMeasurementPoints([{ lat: clickLat, lon: clickLon }]);
                      } else if (measurementPoints.length === 1) {
                        // Second point
                        setMeasurementPoints((prev) => [...prev, { lat: clickLat, lon: clickLon }]);
                      } else {
                        // Third click clears and starts new measurement
                        setMeasurementPoints([{ lat: clickLat, lon: clickLon }]);
                      }
                      return; // Don't process as regular click
                    }

                    // Helper to convert lat/lon to screen position
                    const getScreenPos = (lat, lon) => {
                      const dLat = lat - feederLat;
                      const dLon = lon - feederLon;
                      const nmY = dLat * 60;
                      const nmX = dLon * 60 * Math.cos((feederLat * Math.PI) / 180);

                      if (config.mapMode === 'pro') {
                        return {
                          x: centerX + nmX * pixelsPerNm + proPanOffset.x,
                          y: centerY - nmY * pixelsPerNm + proPanOffset.y,
                        };
                      } else {
                        const dist = Math.sqrt(nmX * nmX + nmY * nmY);
                        const bearing = getBearing(lat, lon);
                        const radius = (dist / radarRange) * maxRadius;
                        const rad = ((bearing - 90) * Math.PI) / 180;
                        return {
                          x: centerX + Math.cos(rad) * radius,
                          y: centerY + Math.sin(rad) * radius,
                        };
                      }
                    };

                    let closest = null;
                    let closestDist = 30;
                    let closestType = null; // 'aircraft', 'metar', 'pirep', 'navaid', 'airport'

                    // Check aircraft (if overlay enabled)
                    if (overlays.aircraft) {
                      sortedAircraft.forEach((ac) => {
                        const dist = ac.distance_nm || getDistanceNm(ac.lat, ac.lon);
                        if (config.mapMode === 'crt' && dist > radarRange) return;
                        if (config.mapMode === 'pro' && dist > radarRange * 1.5) return;

                        const pos = getScreenPos(ac.lat, ac.lon);
                        const clickDist = Math.sqrt((clickX - pos.x) ** 2 + (clickY - pos.y) ** 2);
                        if (clickDist < closestDist) {
                          closestDist = clickDist;
                          closest = ac;
                          closestType = 'aircraft';
                        }
                      });
                    }

                    // Check METARs if enabled
                    if (overlays.metars && aviationData.metars.length > 0) {
                      aviationData.metars.forEach((metar) => {
                        if (!metar.lat || !metar.lon) return;
                        const pos = getScreenPos(metar.lat, metar.lon);
                        if (pos.x < 0 || pos.x > rect.width || pos.y < 0 || pos.y > rect.height)
                          return;

                        const clickDist = Math.sqrt((clickX - pos.x) ** 2 + (clickY - pos.y) ** 2);
                        if (clickDist < closestDist) {
                          closestDist = clickDist;
                          closest = metar;
                          closestType = 'metar';
                        }
                      });
                    }

                    // Check PIREPs if enabled
                    if (overlays.pireps && aviationData.pireps.length > 0) {
                      aviationData.pireps.forEach((pirep) => {
                        if (!pirep.lat || !pirep.lon) return;
                        const pos = getScreenPos(pirep.lat, pirep.lon);
                        if (pos.x < 0 || pos.x > rect.width || pos.y < 0 || pos.y > rect.height)
                          return;

                        const clickDist = Math.sqrt((clickX - pos.x) ** 2 + (clickY - pos.y) ** 2);
                        if (clickDist < closestDist) {
                          closestDist = clickDist;
                          closest = pirep;
                          closestType = 'pirep';
                        }
                      });
                    }

                    // Check Navaids if enabled (use fallback data if API data empty)
                    if (overlays.vors) {
                      const navAidsToCheck =
                        aviationData.navaids.length > 0
                          ? aviationData.navaids
                          : [
                              {
                                id: 'SEA',
                                name: 'Seattle VORTAC',
                                lat: 47.435,
                                lon: -122.309,
                                type: 'VORTAC',
                              },
                              {
                                id: 'PAE',
                                name: 'Paine Field',
                                lat: 47.906,
                                lon: -122.283,
                                type: 'VOR/DME',
                              },
                              {
                                id: 'BFI',
                                name: 'Boeing Field',
                                lat: 47.529,
                                lon: -122.302,
                                type: 'VOR/DME',
                              },
                              {
                                id: 'TCM',
                                name: 'McChord',
                                lat: 47.136,
                                lon: -122.476,
                                type: 'TACAN',
                              },
                              {
                                id: 'OLM',
                                name: 'Olympia',
                                lat: 46.969,
                                lon: -122.902,
                                type: 'VOR/DME',
                              },
                              {
                                id: 'EPH',
                                name: 'Ephrata',
                                lat: 47.385,
                                lon: -119.515,
                                type: 'VOR/DME',
                              },
                              {
                                id: 'ELN',
                                name: 'Ellensburg',
                                lat: 47.033,
                                lon: -120.53,
                                type: 'VOR/DME',
                              },
                              {
                                id: 'YYJ',
                                name: 'Victoria',
                                lat: 48.647,
                                lon: -123.426,
                                type: 'VOR/DME',
                              },
                              {
                                id: 'CV',
                                name: 'Coupeville',
                                lat: 48.188,
                                lon: -122.688,
                                type: 'NDB',
                              },
                              {
                                id: 'BTG',
                                name: 'Battleground',
                                lat: 45.816,
                                lon: -122.531,
                                type: 'VOR/DME',
                              },
                              {
                                id: 'UBG',
                                name: 'Bellingham',
                                lat: 48.795,
                                lon: -122.538,
                                type: 'VOR/DME',
                              },
                              {
                                id: 'GEG',
                                name: 'Spokane',
                                lat: 47.625,
                                lon: -117.539,
                                type: 'VORTAC',
                              },
                            ];
                      navAidsToCheck.forEach((nav) => {
                        if (!nav.lat || !nav.lon) return;
                        const pos = getScreenPos(nav.lat, nav.lon);
                        if (pos.x < 0 || pos.x > rect.width || pos.y < 0 || pos.y > rect.height)
                          return;

                        const clickDist = Math.sqrt((clickX - pos.x) ** 2 + (clickY - pos.y) ** 2);
                        if (clickDist < closestDist) {
                          closestDist = clickDist;
                          closest = nav;
                          closestType = 'navaid';
                        }
                      });
                    }

                    // Check Airports if enabled (use fallback data if API data empty)
                    if (overlays.airports) {
                      const airportsToCheck =
                        aviationData.airports.length > 0
                          ? aviationData.airports
                          : [
                              {
                                icao: 'KSEA',
                                name: 'Seattle-Tacoma',
                                lat: 47.449,
                                lon: -122.309,
                                class: 'B',
                              },
                              {
                                icao: 'KBFI',
                                name: 'Boeing Field',
                                lat: 47.529,
                                lon: -122.302,
                                class: 'D',
                              },
                              {
                                icao: 'KPAE',
                                name: 'Paine Field',
                                lat: 47.906,
                                lon: -122.283,
                                class: 'D',
                              },
                              {
                                icao: 'KPDX',
                                name: 'Portland Intl',
                                lat: 45.589,
                                lon: -122.597,
                                class: 'C',
                              },
                              {
                                icao: 'KGEG',
                                name: 'Spokane',
                                lat: 47.62,
                                lon: -117.534,
                                class: 'C',
                              },
                            ];
                      airportsToCheck.forEach((apt) => {
                        if (!apt.lat || !apt.lon) return;
                        const pos = getScreenPos(apt.lat, apt.lon);
                        if (pos.x < 0 || pos.x > rect.width || pos.y < 0 || pos.y > rect.height)
                          return;

                        const clickDist = Math.sqrt((clickX - pos.x) ** 2 + (clickY - pos.y) ** 2);
                        if (clickDist < closestDist) {
                          closestDist = clickDist;
                          closest = apt;
                          closestType = 'airport';
                        }
                      });
                    }

                    // Check Airspaces if enabled - use point-in-polygon test
                    if (overlays.airspace) {
                      // Compute filtered airspace data inline (same logic as canvas rendering)
                      const rawAirspaces = [
                        ...(aviationData.airspaces || []),
                        ...(aviationData.boundaries || []),
                      ];
                      const filteredAirspaces = rawAirspaces.filter((as) => {
                        const asClass =
                          as.class || as.airspace_class || as.type?.replace('CLASS_', '') || '';
                        if (airspaceTypeFilters[asClass] !== undefined) {
                          return airspaceTypeFilters[asClass];
                        }
                        // For G-AIRMETs and other advisories, filter by hazard type
                        if (as.isAdvisory && as.hazard) {
                          if (weatherAdvisoryFilters[as.hazard] !== undefined) {
                            return weatherAdvisoryFilters[as.hazard];
                          }
                        }
                        return true;
                      });
                      filteredAirspaces.forEach((as) => {
                        // Get polygon coordinates
                        let polygonCoords = null;
                        if (as.polygon) {
                          if (Array.isArray(as.polygon) && as.polygon.length >= 3) {
                            polygonCoords = as.polygon;
                          } else if (as.polygon.type === 'Polygon' && as.polygon.coordinates?.[0]) {
                            polygonCoords = as.polygon.coordinates[0];
                          } else if (
                            as.polygon.type === 'MultiPolygon' &&
                            as.polygon.coordinates?.[0]?.[0]
                          ) {
                            polygonCoords = as.polygon.coordinates[0][0];
                          }
                        }

                        if (!polygonCoords || polygonCoords.length < 3) return;

                        // Convert click position to lat/lon
                        const clickLat =
                          feederLat +
                          ((centerY - clickY + proPanOffset.y) / pixelsPerNm) * (1 / 60);
                        const clickLon =
                          feederLon +
                          ((clickX - centerX - proPanOffset.x) / pixelsPerNm) *
                            (1 / 60) *
                            (1 / Math.cos((feederLat * Math.PI) / 180));

                        // Point-in-polygon test (ray casting algorithm)
                        let inside = false;
                        for (
                          let i = 0, j = polygonCoords.length - 1;
                          i < polygonCoords.length;
                          j = i++
                        ) {
                          const xi = Array.isArray(polygonCoords[i])
                            ? polygonCoords[i][0]
                            : polygonCoords[i].lon;
                          const yi = Array.isArray(polygonCoords[i])
                            ? polygonCoords[i][1]
                            : polygonCoords[i].lat;
                          const xj = Array.isArray(polygonCoords[j])
                            ? polygonCoords[j][0]
                            : polygonCoords[j].lon;
                          const yj = Array.isArray(polygonCoords[j])
                            ? polygonCoords[j][1]
                            : polygonCoords[j].lat;

                          if (
                            yi > clickLat !== yj > clickLat &&
                            clickLon < ((xj - xi) * (clickLat - yi)) / (yj - yi) + xi
                          ) {
                            inside = !inside;
                          }
                        }

                        if (inside) {
                          // Don't override aircraft selections - aircraft have priority
                          if (closestType === 'aircraft') return;

                          // Use center distance as priority (closer centers = higher priority)
                          const centerLat = as.center_lat || as.lat;
                          const centerLon = as.center_lon || as.lon;
                          if (centerLat && centerLon) {
                            const centerPos = getScreenPos(centerLat, centerLon);
                            const clickDist = Math.sqrt(
                              (clickX - centerPos.x) ** 2 + (clickY - centerPos.y) ** 2
                            );
                            // Only select airspace if nothing else is close (closestDist > 30)
                            if (closestDist > 30) {
                              closestDist = Math.min(clickDist, 25); // Cap distance for polygon items
                              closest = as;
                              closestType = 'airspace';
                            }
                          } else if (closestDist > 30) {
                            // No center, just select if inside and nothing else is close
                            closest = as;
                            closestType = 'airspace';
                            closestDist = 20;
                          }
                        }
                      });
                    }

                    // Handle click based on type
                    if (closest) {
                      // Only clear aircraft selection if not pinned, or if selecting a new aircraft
                      if (!panelPinned || closestType === 'aircraft') {
                        selectAircraft(null);
                      }
                      setSelectedMetar(null);
                      setSelectedPirep(null);
                      setSelectedNavaid(null);
                      setSelectedAirport(null);
                      setSelectedAirspace(null);
                      setSelectedTaf(null);
                      setSelectedSigmet(null);

                      if (closestType === 'aircraft') {
                        selectAircraft(closest);
                      } else if (closestType === 'metar') {
                        setSelectedMetar(closest);
                      } else if (closestType === 'pirep') {
                        setSelectedPirep(closest);
                      } else if (closestType === 'navaid') {
                        setSelectedNavaid(closest);
                      } else if (closestType === 'airport') {
                        setSelectedAirport(closest);
                        // Also show TAF if available for this airport
                        if (overlays.tafs) {
                          const aptTaf = getTafForAirport(closest);
                          if (aptTaf) {
                            setSelectedTaf(aptTaf);
                          }
                        }
                      } else if (closestType === 'airspace') {
                        setSelectedAirspace(closest);
                      } else if (closestType === 'sigmet') {
                        setSelectedSigmet(closest);
                      }
                    } else {
                      // Clicked on empty area - clear all selections (unless panel is pinned)
                      if (!panelPinned) {
                        selectAircraft(null);
                      }
                      setSelectedMetar(null);
                      setSelectedTaf(null);
                      setSelectedPirep(null);
                      setSelectedNavaid(null);
                      setSelectedAirport(null);
                      setSelectedAirspace(null);
                      setSelectedSigmet(null);
                    }
                  }}
                  onDoubleClick={(e) => {
                    // Double-click to open aircraft detail page
                    const rect = canvasRef.current.getBoundingClientRect();
                    const clickX = e.clientX - rect.left;
                    const clickY = e.clientY - rect.top;
                    const centerX = rect.width / 2;
                    const centerY = rect.height / 2;
                    const maxRadius = Math.min(rect.width, rect.height) * 0.45;
                    const pixelsPerNm = maxRadius / radarRange;

                    const getScreenPos = (lat, lon) => {
                      const dLat = lat - feederLat;
                      const dLon = lon - feederLon;
                      const nmY = dLat * 60;
                      const nmX = dLon * 60 * Math.cos((feederLat * Math.PI) / 180);

                      if (config.mapMode === 'pro') {
                        return {
                          x: centerX + nmX * pixelsPerNm + proPanOffset.x,
                          y: centerY - nmY * pixelsPerNm + proPanOffset.y,
                        };
                      } else {
                        const dist = Math.sqrt(nmX * nmX + nmY * nmY);
                        const bearing = getBearing(lat, lon);
                        const radius = (dist / radarRange) * maxRadius;
                        const rad = ((bearing - 90) * Math.PI) / 180;
                        return {
                          x: centerX + Math.cos(rad) * radius,
                          y: centerY + Math.sin(rad) * radius,
                        };
                      }
                    };

                    let closestAircraft = null;
                    let closestDist = 30;

                    if (overlays.aircraft) {
                      sortedAircraft.forEach((ac) => {
                        const dist = ac.distance_nm || getDistanceNm(ac.lat, ac.lon);
                        if (config.mapMode === 'crt' && dist > radarRange) return;
                        if (config.mapMode === 'pro' && dist > radarRange * 1.5) return;

                        const pos = getScreenPos(ac.lat, ac.lon);
                        const clickDist = Math.sqrt((clickX - pos.x) ** 2 + (clickY - pos.y) ** 2);
                        if (clickDist < closestDist) {
                          closestDist = clickDist;
                          closestAircraft = ac;
                        }
                      });
                    }

                    if (closestAircraft) {
                      openAircraftSidebar(closestAircraft.hex);
                    } else if (config.mapMode === 'pro') {
                      // Phase 1.3: Double-click on empty space to center
                      const newPanX = proPanOffset.x - (clickX - centerX);
                      const newPanY = proPanOffset.y - (clickY - centerY);
                      setFollowingAircraft(null);
                      animatePanTo(newPanX, newPanY);
                    }
                  }}
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
      <div className="map-controls">
        {config.mapMode === 'map' && (
          <>
            <button
              className={`map-control-btn ${config.mapDarkMode ? 'active' : ''}`}
              onClick={toggleDarkMode}
            >
              {config.mapDarkMode ? <Moon size={16} /> : <Sun size={16} />}
              <span>{config.mapDarkMode ? 'Dark' : 'Light'}</span>
            </button>
            <button
              className={`map-control-btn ${showShortTracks ? 'active' : ''}`}
              onClick={() => setShowShortTracks(!showShortTracks)}
              title={showShortTracks ? 'Hide short tracks' : 'Show short tracks (ATC trails)'}
            >
              <Navigation size={16} />
              <span>Trails</span>
            </button>
            {showShortTracks && (
              <div className="track-length-control">
                <input
                  type="range"
                  min="5"
                  max="50"
                  value={config.shortTrackLength || 15}
                  onChange={(e) => {
                    const newValue = parseInt(e.target.value);
                    setConfig((prev) => {
                      const newConfig = { ...prev, shortTrackLength: newValue };
                      saveConfig(newConfig);
                      return newConfig;
                    });
                  }}
                  title={`Trail length: ${config.shortTrackLength || 15} positions`}
                />
                <span className="track-length-value">{config.shortTrackLength || 15}</span>
              </div>
            )}
          </>
        )}
        {(config.mapMode === 'crt' || config.mapMode === 'pro') && (
          <>
            <button
              className={`map-control-btn ${showFilterMenu ? 'active' : ''}`}
              onClick={() => {
                setShowFilterMenu(!showFilterMenu);
                setShowOverlayMenu(false);
              }}
            >
              <Filter size={16} />
              <span>Filter</span>
            </button>
            <button
              className={`map-control-btn ${showOverlayMenu ? 'active' : ''}`}
              onClick={() => {
                setShowOverlayMenu(!showOverlayMenu);
                setShowFilterMenu(false);
              }}
            >
              <Layers size={16} />
              <span>Layers</span>
            </button>
            <button
              className={`map-control-btn ${showShortTracks ? 'active' : ''}`}
              onClick={() => setShowShortTracks(!showShortTracks)}
              title={showShortTracks ? 'Hide short tracks' : 'Show short tracks (ATC trails)'}
            >
              <Navigation size={16} />
              <span>Trails</span>
            </button>
            {showShortTracks && (
              <div className="track-length-control">
                <input
                  type="range"
                  min="5"
                  max="50"
                  value={config.shortTrackLength || 15}
                  onChange={(e) => {
                    const newValue = parseInt(e.target.value);
                    setConfig((prev) => {
                      const newConfig = { ...prev, shortTrackLength: newValue };
                      saveConfig(newConfig);
                      return newConfig;
                    });
                  }}
                  title={`Trail length: ${config.shortTrackLength || 15} positions`}
                />
                <span className="track-length-value">{config.shortTrackLength || 15}</span>
              </div>
            )}
          </>
        )}
        <button
          className={`map-control-btn sound-mute-btn ${soundMuted ? 'muted' : ''}`}
          onClick={() => setSoundMuted(!soundMuted)}
          title={soundMuted ? 'Unmute alerts' : 'Mute alerts'}
        >
          {soundMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <button
          className="map-control-btn"
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>

      {/* Overlay Menu - available on all map modes */}
      {showOverlayMenu && (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div className="overlay-menu" onClick={(e) => e.stopPropagation()}>
          <div className="overlay-menu-header">
            <span>Map Layers</span>
            <button onClick={() => setShowOverlayMenu(false)}>
              <X size={14} />
            </button>
          </div>
          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={overlays.aircraft}
              onChange={() => updateOverlays({ ...overlays, aircraft: !overlays.aircraft })}
            />
            <span className="toggle-label">Aircraft</span>
          </label>
          <div className="overlay-divider" />
          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={overlays.vors}
              onChange={() => updateOverlays({ ...overlays, vors: !overlays.vors })}
            />
            <span className="toggle-label">VORs & NAVAIDs</span>
          </label>
          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={overlays.airports}
              onChange={() => updateOverlays({ ...overlays, airports: !overlays.airports })}
            />
            <span className="toggle-label">Airports</span>
          </label>
          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={overlays.airspace}
              onChange={() => updateOverlays({ ...overlays, airspace: !overlays.airspace })}
            />
            <span className="toggle-label">Airspace</span>
          </label>
          {overlays.airspace && (
            <>
              <label className="overlay-toggle" style={{ paddingLeft: '20px' }}>
                <input
                  type="checkbox"
                  checked={showAirspaceLabels}
                  onChange={() => {
                    const newVal = !showAirspaceLabels;
                    setShowAirspaceLabels(newVal);
                    localStorage.setItem('adsb-show-airspace-labels', String(newVal));
                  }}
                />
                <span className="toggle-label">Show Labels</span>
              </label>
              <div
                className="overlay-section-title"
                style={{ paddingLeft: '20px', fontSize: '10px', marginTop: '8px' }}
              >
                Airspace Types
              </div>
              {[
                { key: 'B', label: 'Class B' },
                { key: 'C', label: 'Class C' },
                { key: 'D', label: 'Class D' },
                { key: 'E', label: 'Class E' },
                { key: 'MOA', label: 'MOA' },
                { key: 'RESTRICTED', label: 'Restricted' },
                { key: 'WARNING', label: 'Warning' },
                { key: 'PROHIBITED', label: 'Prohibited' },
                { key: 'TFR', label: 'TFR' },
                { key: 'ALERT', label: 'Alert' },
              ].map(({ key, label }) => (
                <label key={key} className="overlay-toggle" style={{ paddingLeft: '30px' }}>
                  <input
                    type="checkbox"
                    checked={airspaceTypeFilters[key] ?? true}
                    onChange={() => {
                      const newFilters = {
                        ...airspaceTypeFilters,
                        [key]: !airspaceTypeFilters[key],
                      };
                      setAirspaceTypeFilters(newFilters);
                      localStorage.setItem(
                        'adsb-airspace-type-filters',
                        JSON.stringify(newFilters)
                      );
                    }}
                  />
                  <span className="toggle-label">{label}</span>
                </label>
              ))}
              <div
                className="overlay-section-title"
                style={{ paddingLeft: '20px', fontSize: '10px', marginTop: '8px' }}
              >
                Weather Advisories (G-AIRMET)
              </div>
              {[
                { key: 'IFR', label: 'IFR Conditions' },
                { key: 'TURB', label: 'Turbulence' },
                { key: 'ICE', label: 'Icing' },
                { key: 'TS', label: 'Thunderstorm' },
                { key: 'MT_OBSC', label: 'Mountain Obscuration' },
                { key: 'LLWS', label: 'Low Level Wind Shear' },
                { key: 'SFC_WND', label: 'Surface Wind' },
                { key: 'FZLVL', label: 'Freezing Level' },
              ].map(({ key, label }) => (
                <label key={key} className="overlay-toggle" style={{ paddingLeft: '30px' }}>
                  <input
                    type="checkbox"
                    checked={weatherAdvisoryFilters[key] ?? true}
                    onChange={() => {
                      const newFilters = {
                        ...weatherAdvisoryFilters,
                        [key]: !weatherAdvisoryFilters[key],
                      };
                      setWeatherAdvisoryFilters(newFilters);
                      localStorage.setItem(
                        'adsb-weather-advisory-filters',
                        JSON.stringify(newFilters)
                      );
                    }}
                  />
                  <span className="toggle-label">{label}</span>
                </label>
              ))}
            </>
          )}
          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={overlays.metars}
              onChange={() => updateOverlays({ ...overlays, metars: !overlays.metars })}
            />
            <span className="toggle-label">METARs (Weather)</span>
          </label>
          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={overlays.tafs}
              onChange={() => updateOverlays({ ...overlays, tafs: !overlays.tafs })}
            />
            <span className="toggle-label">TAFs (Forecasts)</span>
          </label>
          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={overlays.pireps}
              onChange={() => updateOverlays({ ...overlays, pireps: !overlays.pireps })}
            />
            <span className="toggle-label">PIREPs</span>
          </label>
          <label className="overlay-toggle">
            <input
              type="checkbox"
              checked={overlays.convectiveSigmets}
              onChange={() =>
                updateOverlays({ ...overlays, convectiveSigmets: !overlays.convectiveSigmets })
              }
            />
            <span className="toggle-label">Convective SIGMETs</span>
          </label>
          {config.mapMode === 'pro' && (
            <>
              <label className="overlay-toggle">
                <input
                  type="checkbox"
                  checked={overlays.windsAloft}
                  onChange={() => updateOverlays({ ...overlays, windsAloft: !overlays.windsAloft })}
                />
                <span className="toggle-label">
                  <Wind size={12} /> Winds Aloft (Shift+W)
                </span>
              </label>
              {overlays.windsAloft && (
                <div className="overlay-setting" style={{ paddingLeft: '20px' }}>
                  <span className="setting-label">Altitude Level</span>
                  <select
                    className="overlay-select"
                    value={windsAloftLevel}
                    onChange={(e) => {
                      const level = parseInt(e.target.value, 10);
                      setWindsAloftLevel(level);
                      localStorage.setItem('adsb-winds-aloft-level', String(level));
                    }}
                  >
                    {WINDS_ALOFT_LEVELS.map((level) => (
                      <option key={level.value} value={level.value}>
                        {level.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="overlay-divider" />
              <div className="overlay-section-title">Terrain Context</div>
              <label className="overlay-toggle">
                <input
                  type="checkbox"
                  checked={overlays.countries}
                  onChange={() => updateOverlays({ ...overlays, countries: !overlays.countries })}
                />
                <span className="toggle-label">Countries</span>
              </label>
              <label className="overlay-toggle">
                <input
                  type="checkbox"
                  checked={overlays.states}
                  onChange={() => updateOverlays({ ...overlays, states: !overlays.states })}
                />
                <span className="toggle-label">States</span>
              </label>
              <label className="overlay-toggle">
                <input
                  type="checkbox"
                  checked={overlays.counties}
                  onChange={() => updateOverlays({ ...overlays, counties: !overlays.counties })}
                />
                <span className="toggle-label">Counties</span>
              </label>
              <label className="overlay-toggle">
                <input
                  type="checkbox"
                  checked={overlays.water}
                  onChange={() => updateOverlays({ ...overlays, water: !overlays.water })}
                />
                <span className="toggle-label">Water Bodies</span>
              </label>
              <div className="overlay-divider" />
              <div className="overlay-section-title">Aviation Overlays</div>
              <label className="overlay-toggle">
                <input
                  type="checkbox"
                  checked={overlays.usArtcc}
                  onChange={() => updateOverlays({ ...overlays, usArtcc: !overlays.usArtcc })}
                />
                <span className="toggle-label">US ARTCC Boundaries</span>
              </label>
              <label className="overlay-toggle">
                <input
                  type="checkbox"
                  checked={overlays.usRefueling}
                  onChange={() =>
                    updateOverlays({ ...overlays, usRefueling: !overlays.usRefueling })
                  }
                />
                <span className="toggle-label">US Refueling Tracks</span>
              </label>
              <label className="overlay-toggle">
                <input
                  type="checkbox"
                  checked={overlays.ukMilZones}
                  onChange={() => updateOverlays({ ...overlays, ukMilZones: !overlays.ukMilZones })}
                />
                <span className="toggle-label">UK Military Zones</span>
              </label>
              <label className="overlay-toggle">
                <input
                  type="checkbox"
                  checked={overlays.euMilAwacs}
                  onChange={() => updateOverlays({ ...overlays, euMilAwacs: !overlays.euMilAwacs })}
                />
                <span className="toggle-label">EU AWACS Orbits</span>
              </label>
              <label className="overlay-toggle">
                <input
                  type="checkbox"
                  checked={overlays.trainingAreas}
                  onChange={() =>
                    updateOverlays({ ...overlays, trainingAreas: !overlays.trainingAreas })
                  }
                />
                <span className="toggle-label">Training Areas</span>
              </label>
              <div className="overlay-divider" />
              <div className="overlay-section-title">Pro Display Settings</div>
              {/* Phase 5.1: Theme Selector */}
              <div className="overlay-setting">
                <span className="setting-label">Color Theme (Shift+T)</span>
                <select
                  className="overlay-select"
                  value={proTheme}
                  onChange={(e) => setProTheme(e.target.value)}
                >
                  <option value="cyan">Classic Cyan</option>
                  <option value="amber">Amber/Gold</option>
                  <option value="green">Green Phosphor</option>
                  <option value="high-contrast">High Contrast</option>
                </select>
              </div>
              {/* Phase 4.3: Compass Rose Toggle */}
              <label className="overlay-toggle">
                <input
                  type="checkbox"
                  checked={showCompassRose}
                  onChange={() => {
                    const newVal = !showCompassRose;
                    setShowCompassRose(newVal);
                    localStorage.setItem('adsb-pro-compass-rose', String(newVal));
                  }}
                />
                <span className="toggle-label">
                  <Compass size={12} /> Compass Rose (P)
                </span>
              </label>
              {/* Phase 4.2: Grid Opacity */}
              <div className="overlay-setting">
                <span className="setting-label">Grid Opacity (G)</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round(gridOpacity * 100)}
                  onChange={(e) => {
                    const newVal = parseInt(e.target.value) / 100;
                    setGridOpacity(newVal);
                    localStorage.setItem('adsb-pro-grid-opacity', String(newVal));
                  }}
                  className="overlay-slider"
                />
                <span className="setting-value">{Math.round(gridOpacity * 100)}%</span>
              </div>
              {/* Display toggles */}
              <label className="overlay-toggle">
                <input
                  type="checkbox"
                  checked={showDataBlocks}
                  onChange={() => {
                    const newVal = !showDataBlocks;
                    setShowDataBlocks(newVal);
                    localStorage.setItem('adsb-pro-show-datablocks', String(newVal));
                  }}
                />
                <span className="toggle-label">Data Blocks (L)</span>
              </label>
              <label className="overlay-toggle">
                <input
                  type="checkbox"
                  checked={showPredictionVectors}
                  onChange={() => {
                    const newVal = !showPredictionVectors;
                    setShowPredictionVectors(newVal);
                    localStorage.setItem('adsb-pro-prediction-vectors', String(newVal));
                  }}
                />
                <span className="toggle-label">Velocity Vectors (V)</span>
              </label>
              <label className="overlay-toggle">
                <input
                  type="checkbox"
                  checked={showVsTrend}
                  onChange={() => {
                    const newVal = !showVsTrend;
                    setShowVsTrend(newVal);
                    localStorage.setItem('adsb-pro-vs-trend', String(newVal));
                  }}
                />
                <span className="toggle-label">VS Trend Indicators (Y)</span>
              </label>
              <label className="overlay-toggle">
                <input
                  type="checkbox"
                  checked={showSpeedColors}
                  onChange={() => {
                    const newVal = !showSpeedColors;
                    setShowSpeedColors(newVal);
                    localStorage.setItem('adsb-pro-speed-colors', String(newVal));
                  }}
                />
                <span className="toggle-label">Speed Coloring (S)</span>
              </label>
              <label className="overlay-toggle">
                <input
                  type="checkbox"
                  checked={showAltitudeTrails}
                  onChange={() => {
                    const newVal = !showAltitudeTrails;
                    setShowAltitudeTrails(newVal);
                    localStorage.setItem('adsb-pro-altitude-trails', String(newVal));
                  }}
                />
                <span className="toggle-label">Altitude-Colored Trails (A)</span>
              </label>
              <label className="overlay-toggle">
                <input
                  type="checkbox"
                  checked={showConflictVisualization}
                  onChange={() => {
                    const newVal = !showConflictVisualization;
                    setShowConflictVisualization(newVal);
                    localStorage.setItem('adsb-pro-conflict-viz', String(newVal));
                  }}
                />
                <span className="toggle-label">Conflict Visualization (C)</span>
              </label>
              <div className="overlay-divider" />
              <div className="overlay-section-title">Data Block Fields</div>
              {/* Phase 5.2: Data Block Configuration */}
              <label className="overlay-toggle">
                <input
                  type="checkbox"
                  checked={dataBlockConfig.showAltitude}
                  onChange={() => {
                    const newConfig = {
                      ...dataBlockConfig,
                      showAltitude: !dataBlockConfig.showAltitude,
                    };
                    setDataBlockConfig(newConfig);
                    localStorage.setItem('adsb-pro-datablock-config', JSON.stringify(newConfig));
                  }}
                />
                <span className="toggle-label">Altitude</span>
              </label>
              <label className="overlay-toggle">
                <input
                  type="checkbox"
                  checked={dataBlockConfig.showSpeed}
                  onChange={() => {
                    const newConfig = { ...dataBlockConfig, showSpeed: !dataBlockConfig.showSpeed };
                    setDataBlockConfig(newConfig);
                    localStorage.setItem('adsb-pro-datablock-config', JSON.stringify(newConfig));
                  }}
                />
                <span className="toggle-label">Speed</span>
              </label>
              <label className="overlay-toggle">
                <input
                  type="checkbox"
                  checked={dataBlockConfig.showHeading}
                  onChange={() => {
                    const newConfig = {
                      ...dataBlockConfig,
                      showHeading: !dataBlockConfig.showHeading,
                    };
                    setDataBlockConfig(newConfig);
                    localStorage.setItem('adsb-pro-datablock-config', JSON.stringify(newConfig));
                  }}
                />
                <span className="toggle-label">Heading</span>
              </label>
              <label className="overlay-toggle">
                <input
                  type="checkbox"
                  checked={dataBlockConfig.showVerticalSpeed}
                  onChange={() => {
                    const newConfig = {
                      ...dataBlockConfig,
                      showVerticalSpeed: !dataBlockConfig.showVerticalSpeed,
                    };
                    setDataBlockConfig(newConfig);
                    localStorage.setItem('adsb-pro-datablock-config', JSON.stringify(newConfig));
                  }}
                />
                <span className="toggle-label">Vertical Speed</span>
              </label>
              <label className="overlay-toggle">
                <input
                  type="checkbox"
                  checked={dataBlockConfig.showAircraftType}
                  onChange={() => {
                    const newConfig = {
                      ...dataBlockConfig,
                      showAircraftType: !dataBlockConfig.showAircraftType,
                    };
                    setDataBlockConfig(newConfig);
                    localStorage.setItem('adsb-pro-datablock-config', JSON.stringify(newConfig));
                  }}
                />
                <span className="toggle-label">Aircraft Type</span>
              </label>
              <label className="overlay-toggle">
                <input
                  type="checkbox"
                  checked={dataBlockConfig.compact}
                  onChange={() => {
                    const newConfig = { ...dataBlockConfig, compact: !dataBlockConfig.compact };
                    setDataBlockConfig(newConfig);
                    localStorage.setItem('adsb-pro-datablock-config', JSON.stringify(newConfig));
                  }}
                />
                <span className="toggle-label">Compact Mode</span>
              </label>
              <button
                className="legend-toggle-btn"
                onClick={() => {
                  setShowDataBlockConfigPanel(true);
                  setShowOverlayMenu(false);
                }}
                style={{ marginTop: '8px' }}
              >
                <Settings2 size={14} />
                <span>Advanced Config...</span>
              </button>
              <div className="overlay-divider" />
              <div className="overlay-section-title">Layer Opacity</div>
              {/* Phase 4.4: Layer Opacity Controls */}
              <div className="overlay-setting">
                <span className="setting-label">ARTCC</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round((layerOpacities.usArtcc || 0.5) * 100)}
                  onChange={(e) => {
                    const newVal = parseInt(e.target.value) / 100;
                    const newOpacities = { ...layerOpacities, usArtcc: newVal };
                    setLayerOpacities(newOpacities);
                    saveLayerOpacities(newOpacities);
                  }}
                  className="overlay-slider"
                />
              </div>
              <div className="overlay-setting">
                <span className="setting-label">Refueling Tracks</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round((layerOpacities.usRefueling || 0.5) * 100)}
                  onChange={(e) => {
                    const newVal = parseInt(e.target.value) / 100;
                    const newOpacities = { ...layerOpacities, usRefueling: newVal };
                    setLayerOpacities(newOpacities);
                    saveLayerOpacities(newOpacities);
                  }}
                  className="overlay-slider"
                />
              </div>
              <div className="overlay-setting">
                <span className="setting-label">Military Zones</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round((layerOpacities.ukMilZones || 0.5) * 100)}
                  onChange={(e) => {
                    const newVal = parseInt(e.target.value) / 100;
                    const newOpacities = { ...layerOpacities, ukMilZones: newVal };
                    setLayerOpacities(newOpacities);
                    saveLayerOpacities(newOpacities);
                  }}
                  className="overlay-slider"
                />
              </div>
              <div className="overlay-setting">
                <span className="setting-label">Water Bodies</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round((layerOpacities.water || 0.5) * 100)}
                  onChange={(e) => {
                    const newVal = parseInt(e.target.value) / 100;
                    const newOpacities = { ...layerOpacities, water: newVal };
                    setLayerOpacities(newOpacities);
                    saveLayerOpacities(newOpacities);
                  }}
                  className="overlay-slider"
                />
              </div>
            </>
          )}
          <div className="overlay-divider" />
          <button
            className="legend-toggle-btn"
            onClick={() => {
              setShowLegend(!showLegend);
              setShowOverlayMenu(false);
            }}
          >
            <HelpCircle size={14} />
            <span>Symbol Legend</span>
          </button>
          <div className="overlay-note">Weather data from aviationweather.gov</div>
        </div>
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
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div className="overlay-menu filter-menu" onClick={(e) => e.stopPropagation()}>
          <div className="overlay-menu-header">
            <span>Traffic Filters</span>
            <button onClick={() => setShowFilterMenu(false)}>
              <X size={14} />
            </button>
          </div>

          <div className="filter-section">
            <label className="overlay-toggle">
              <input
                type="checkbox"
                checked={trafficFilters.safetyEventsOnly}
                onChange={() =>
                  updateTrafficFilters((prev) => ({
                    ...prev,
                    safetyEventsOnly: !prev.safetyEventsOnly,
                  }))
                }
              />
              <span className="toggle-label">
                <AlertTriangle size={12} /> Safety Events Only
              </span>
            </label>
          </div>

          <div className="overlay-divider" />

          <div className="filter-section">
            <div className="filter-section-title">Type</div>
            <label className="overlay-toggle">
              <input
                type="checkbox"
                checked={trafficFilters.showMilitary}
                onChange={() =>
                  updateTrafficFilters((prev) => ({ ...prev, showMilitary: !prev.showMilitary }))
                }
              />
              <span className="toggle-label">
                <Shield size={12} /> Military
              </span>
            </label>
            <label className="overlay-toggle">
              <input
                type="checkbox"
                checked={trafficFilters.showCivil}
                onChange={() =>
                  updateTrafficFilters((prev) => ({ ...prev, showCivil: !prev.showCivil }))
                }
              />
              <span className="toggle-label">
                <Plane size={12} /> Civil
              </span>
            </label>
          </div>

          <div className="filter-section">
            <div className="filter-section-title">Category</div>
            <label className="overlay-toggle">
              <input
                type="checkbox"
                checked={trafficFilters.showGA}
                onChange={() => updateTrafficFilters((prev) => ({ ...prev, showGA: !prev.showGA }))}
              />
              <span className="toggle-label">GA / Light</span>
            </label>
            <label className="overlay-toggle">
              <input
                type="checkbox"
                checked={trafficFilters.showAirliners}
                onChange={() =>
                  updateTrafficFilters((prev) => ({ ...prev, showAirliners: !prev.showAirliners }))
                }
              />
              <span className="toggle-label">Airliners / Heavy</span>
            </label>
          </div>

          <div className="filter-section">
            <div className="filter-section-title">Status</div>
            <label className="overlay-toggle">
              <input
                type="checkbox"
                checked={trafficFilters.showAirborne}
                onChange={() =>
                  updateTrafficFilters((prev) => ({ ...prev, showAirborne: !prev.showAirborne }))
                }
              />
              <span className="toggle-label">Airborne</span>
            </label>
            <label className="overlay-toggle">
              <input
                type="checkbox"
                checked={trafficFilters.showGround}
                onChange={() =>
                  updateTrafficFilters((prev) => ({ ...prev, showGround: !prev.showGround }))
                }
              />
              <span className="toggle-label">On Ground</span>
            </label>
          </div>

          <div className="filter-section">
            <div className="filter-section-title">Transponder</div>
            <label className="overlay-toggle">
              <input
                type="checkbox"
                checked={trafficFilters.showWithSquawk}
                onChange={() =>
                  updateTrafficFilters((prev) => ({
                    ...prev,
                    showWithSquawk: !prev.showWithSquawk,
                  }))
                }
              />
              <span className="toggle-label">With Squawk</span>
            </label>
            <label className="overlay-toggle">
              <input
                type="checkbox"
                checked={trafficFilters.showWithoutSquawk}
                onChange={() =>
                  updateTrafficFilters((prev) => ({
                    ...prev,
                    showWithoutSquawk: !prev.showWithoutSquawk,
                  }))
                }
              />
              <span className="toggle-label">No Squawk (ADS-B)</span>
            </label>
          </div>

          <div className="filter-section">
            <div className="filter-section-title">Altitude (ft)</div>
            <div className="filter-range-row">
              <input
                type="number"
                className="filter-range-input"
                value={trafficFilters.minAltitude}
                onChange={(e) =>
                  updateTrafficFilters((prev) => ({
                    ...prev,
                    minAltitude: Math.max(0, parseInt(e.target.value) || 0),
                  }))
                }
                min="0"
                max="60000"
                step="1000"
                placeholder="Min"
              />
              <span className="filter-range-sep">to</span>
              <input
                type="number"
                className="filter-range-input"
                value={trafficFilters.maxAltitude}
                onChange={(e) =>
                  updateTrafficFilters((prev) => ({
                    ...prev,
                    maxAltitude: Math.min(60000, parseInt(e.target.value) || 60000),
                  }))
                }
                min="0"
                max="60000"
                step="1000"
                placeholder="Max"
              />
            </div>
          </div>

          <div className="overlay-divider" />
          <button
            className="filter-reset-btn"
            onClick={() =>
              updateTrafficFilters({
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
              })
            }
          >
            <RefreshCw size={14} />
            <span>Reset Filters</span>
          </button>
        </div>
      )}

      {/* Symbol Legend Panel */}
      {showLegend && (config.mapMode === 'crt' || config.mapMode === 'pro') && (
        <div
          className={`legend-panel ${config.mapMode === 'pro' ? 'pro-style' : ''} ${isLegendDragging ? 'dragging' : ''} ${legendCollapsed ? 'collapsed' : ''}`}
          style={
            legendPosition.x !== null
              ? {
                  left: legendPosition.x,
                  top: legendPosition.y,
                  right: 'auto',
                  bottom: 'auto',
                }
              : {}
          }
        >
          <div
            role="toolbar"
            aria-label="Legend panel drag handle"
            tabIndex={0}
            className="legend-header"
            onMouseDown={handleLegendMouseDown}
            onTouchStart={(e) => {
              if (e.target.closest('button')) return;
              const touch = e.touches[0];
              setIsLegendDragging(true);
              const rect = e.currentTarget.parentElement.getBoundingClientRect();
              legendDragStartRef.current = {
                x: touch.clientX,
                y: touch.clientY,
                startX: legendPosition.x ?? rect.left,
                startY: legendPosition.y ?? rect.top,
              };
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setShowLegend(false);
            }}
          >
            <span>Symbol Legend</span>
            <div className="legend-header-buttons">
              <button
                onClick={() => setLegendCollapsed(!legendCollapsed)}
                title={legendCollapsed ? 'Expand' : 'Collapse'}
              >
                {legendCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </button>
              <button onClick={() => setShowLegend(false)} title="Close">
                <X size={14} />
              </button>
            </div>
          </div>

          {!legendCollapsed && (
            <>
              <div className="legend-section">
                <div className="legend-section-title">Flight Categories (METAR)</div>
                <div className="legend-item">
                  <span className="legend-symbol metar-vfr">●</span>
                  <span>VFR - Visual (good visibility)</span>
                </div>
                <div className="legend-item">
                  <span className="legend-symbol metar-mvfr">●</span>
                  <span>MVFR - Marginal Visual</span>
                </div>
                <div className="legend-item">
                  <span className="legend-symbol metar-ifr">●</span>
                  <span>IFR - Instrument Required</span>
                </div>
                <div className="legend-item">
                  <span className="legend-symbol metar-lifr">●</span>
                  <span>LIFR - Low Instrument</span>
                </div>
              </div>

              <div className="legend-section">
                <div className="legend-section-title">PIREP Types</div>
                <div className="legend-item">
                  <span className="legend-symbol pirep-routine">◆</span>
                  <span>Routine Report</span>
                </div>
                <div className="legend-item">
                  <span className="legend-symbol pirep-turb">◆</span>
                  <span>Turbulence</span>
                </div>
                <div className="legend-item">
                  <span className="legend-symbol pirep-ice">◆</span>
                  <span>Icing</span>
                </div>
                <div className="legend-item">
                  <span className="legend-symbol pirep-both">◆</span>
                  <span>Turbulence + Icing</span>
                </div>
                <div className="legend-item">
                  <span className="legend-symbol pirep-ws">◆</span>
                  <span>Wind Shear</span>
                </div>
                <div className="legend-item">
                  <span className="legend-symbol pirep-urgent">◆</span>
                  <span>Urgent (UUA)</span>
                </div>
              </div>

              <div className="legend-section">
                <div className="legend-section-title">Aircraft</div>
                <div className="legend-item">
                  <span className="legend-symbol aircraft-normal">▲</span>
                  <span>Normal Traffic</span>
                </div>
                <div className="legend-item">
                  <span className="legend-symbol aircraft-military">▲</span>
                  <span>Military</span>
                </div>
                <div className="legend-item">
                  <span className="legend-symbol aircraft-emergency">▲</span>
                  <span>Emergency (7500/7600/7700)</span>
                </div>
                <div className="legend-item">
                  <span className="legend-symbol aircraft-conflict">▲</span>
                  <span>Traffic Conflict</span>
                </div>
              </div>

              <div className="legend-section">
                <div className="legend-section-title">Navigation</div>
                <div className="legend-item">
                  <span className="legend-symbol nav-vor">⬡</span>
                  <span>VOR/DME</span>
                </div>
                <div className="legend-item">
                  <span className="legend-symbol nav-airport">✈</span>
                  <span>Airport</span>
                </div>
              </div>
            </>
          )}
        </div>
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

      {/* Show Aircraft List Button (when hidden) */}
      {(config.mapMode === 'crt' || config.mapMode === 'pro') && !showAircraftList && (
        <button
          className={`aircraft-list-show-btn ${config.mapMode === 'pro' ? 'pro-style' : ''}`}
          onClick={() => setShowAircraftList(true)}
        >
          <Plane size={14} />
          <span>{inRangeCount}</span>
          <ChevronLeft size={14} />
        </button>
      )}

      {/* Collapsible Aircraft List Panel */}
      {(config.mapMode === 'crt' || config.mapMode === 'pro') && showAircraftList && (
        <div
          className={`radar-aircraft-list expanded ${config.mapMode === 'pro' ? 'pro-style' : ''} ${isListDragging ? 'dragging' : ''}`}
          style={
            aircraftListPosition.x !== null
              ? {
                  left: aircraftListPosition.x,
                  top: aircraftListPosition.y,
                  right: 'auto',
                  bottom: 'auto',
                }
              : {}
          }
        >
          <div
            role="toolbar"
            aria-label="Aircraft list controls"
            className="aircraft-list-header"
            onMouseDown={handleListMouseDown}
            onTouchStart={(e) => {
              const touch = e.touches[0];
              handleListMouseDown({
                clientX: touch.clientX,
                clientY: touch.clientY,
                currentTarget: e.currentTarget.parentElement,
                preventDefault: () => {},
              });
            }}
          >
            <button className="aircraft-list-toggle" onClick={() => setListExpanded(!listExpanded)}>
              <Plane size={14} />
              <span>Aircraft ({inRangeCount})</span>
              {listExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
            <button
              className="aircraft-list-close"
              onClick={() => setShowAircraftList(false)}
              title="Hide aircraft list"
            >
              <X size={14} />
            </button>
          </div>

          {listExpanded && (
            <div className="aircraft-list-content">
              {(() => {
                // Filter aircraft in range
                const inRangeAircraft = sortedAircraft.filter((ac) => {
                  const dist = ac.distance_nm || 0;
                  return config.mapMode === 'pro' ? dist <= radarRange * 1.5 : dist <= radarRange;
                });

                // Sort: emergencies first, then conflicts (from backend), then by distance
                const prioritySorted = [...inRangeAircraft].sort((a, b) => {
                  const aEmergency = a.emergency || ['7500', '7600', '7700'].includes(a.squawk);
                  const bEmergency = b.emergency || ['7500', '7600', '7700'].includes(b.squawk);
                  const aConflict = activeConflicts.some(
                    (e) =>
                      e.icao?.toUpperCase() === a.hex?.toUpperCase() ||
                      e.icao_2?.toUpperCase() === a.hex?.toUpperCase()
                  );
                  const bConflict = activeConflicts.some(
                    (e) =>
                      e.icao?.toUpperCase() === b.hex?.toUpperCase() ||
                      e.icao_2?.toUpperCase() === b.hex?.toUpperCase()
                  );

                  // Emergency first
                  if (aEmergency && !bEmergency) return -1;
                  if (!aEmergency && bEmergency) return 1;
                  // Then conflicts
                  if (aConflict && !bConflict) return -1;
                  if (!aConflict && bConflict) return 1;
                  // Then by distance
                  return (a.distance_nm || 999) - (b.distance_nm || 999);
                });

                // Lazy load - show initial batch plus loaded items
                const displayCount = Math.min(listDisplayCount, prioritySorted.length);
                const displayAircraft = prioritySorted.slice(0, displayCount);
                const hasMore = prioritySorted.length > displayCount;

                return (
                  <>
                    {displayAircraft.map((ac) => {
                      const tailInfo = getTailInfo(ac.hex, ac.flight);
                      const isEmergency =
                        ac.emergency || ['7500', '7600', '7700'].includes(ac.squawk);
                      const safetyEvent = activeConflicts.find(
                        (e) =>
                          e.icao?.toUpperCase() === ac.hex?.toUpperCase() ||
                          e.icao_2?.toUpperCase() === ac.hex?.toUpperCase()
                      );
                      const isConflict = !!safetyEvent;
                      const conflictSeverity = safetyEvent?.severity || null;

                      return (
                        <div
                          key={ac.hex}
                          className={`aircraft-list-item ${selectedAircraft?.hex === ac.hex ? 'selected' : ''} ${isEmergency ? 'emergency flash-emergency' : ''} ${isConflict ? `conflict flash-conflict ${getSeverityClass(conflictSeverity)}` : ''} ${ac.military ? 'military' : ''}`}
                          onClick={() => selectAircraft(ac)}
                          onKeyDown={(e) => e.key === 'Enter' && selectAircraft(ac)}
                          role="button"
                          tabIndex={0}
                          title={
                            safetyEvent
                              ? `${getEventTypeName(safetyEvent.event_type)}: ${safetyEvent.message}`
                              : ''
                          }
                          aria-label={`Select aircraft ${ac.flight?.trim() || ac.hex}`}
                        >
                          <div className="aircraft-list-primary">
                            <span className="aircraft-flag">{tailInfo.flag}</span>
                            <span className="aircraft-callsign">{ac.flight?.trim() || ac.hex}</span>
                            {tailInfo.tailNumber && (
                              <span className="aircraft-tail">({tailInfo.tailNumber})</span>
                            )}
                            {ac.military && <Shield size={10} className="mil-icon" />}
                            {isEmergency && <AlertTriangle size={10} className="emerg-icon" />}
                            {isConflict && (
                              <Zap
                                size={10}
                                className={`conflict-icon ${getSeverityClass(conflictSeverity)}`}
                              />
                            )}
                          </div>
                          <div className="aircraft-list-secondary">
                            <span className="aircraft-alt">
                              {ac.alt ? `${(ac.alt / 1000).toFixed(1)}k` : '--'}
                            </span>
                            <span className="aircraft-speed">
                              {ac.gs ? `${Math.round(ac.gs)}kt` : '--'}
                            </span>
                            <span className="aircraft-dist">
                              {ac.distance_nm?.toFixed(1) || '--'}nm
                            </span>
                            <button
                              className="aircraft-detail-link"
                              onClick={(e) => {
                                e.stopPropagation();
                                openAircraftDetail(ac.hex);
                              }}
                              title="View full details"
                            >
                              <ExternalLink size={10} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {hasMore && (
                      <button
                        className="aircraft-list-load-more"
                        onClick={(e) => {
                          e.stopPropagation();
                          setListDisplayCount((prev) => prev + 20);
                        }}
                      >
                        Load more ({prioritySorted.length - displayCount} remaining)
                      </button>
                    )}
                    {prioritySorted.length === 0 && (
                      <div className="aircraft-list-empty">No aircraft in range</div>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </div>
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
      {liveAircraft &&
        (() => {
          const isEmergency =
            liveAircraft.emergency || ['7500', '7600', '7700'].includes(liveAircraft.squawk);
          const squawkMeanings = { 7500: 'HIJACK', 7600: 'RADIO', 7700: 'EMERG' };
          const squawkLabel = squawkMeanings[liveAircraft.squawk];

          // Check if this aircraft has a safety event
          const safetyEvent = activeConflicts.find(
            (e) =>
              e.icao?.toUpperCase() === liveAircraft.hex?.toUpperCase() ||
              e.icao_2?.toUpperCase() === liveAircraft.hex?.toUpperCase()
          );

          const isConflict = !!safetyEvent;
          const conflictSeverity = safetyEvent?.severity || null;
          const conflictTitle = safetyEvent ? getEventTypeName(safetyEvent.event_type) : null;

          // Get the other aircraft in a two-aircraft conflict from safety event
          const otherAircraftHex = safetyEvent?.icao_2
            ? safetyEvent.icao?.toUpperCase() === liveAircraft.hex?.toUpperCase()
              ? safetyEvent.icao_2
              : safetyEvent.icao
            : null;
          const otherAircraft = otherAircraftHex
            ? aircraft.find((ac) => ac.hex?.toUpperCase() === otherAircraftHex?.toUpperCase())
            : null;

          // Build conflictInfo for display
          const conflictInfo = safetyEvent?.icao_2
            ? {
                hex1: safetyEvent.icao,
                hex2: safetyEvent.icao_2,
                horizontalNm:
                  safetyEvent.horizontalNm ||
                  safetyEvent.details?.horizontal_nm?.toFixed(1) ||
                  '--',
                verticalFt: safetyEvent.verticalFt || safetyEvent.details?.altitude_diff_ft || '--',
              }
            : null;

          // Vertical rate arrows - chevron style like ATC displays
          const vr = liveAircraft.vr || 0;
          const absVr = Math.abs(vr);
          const vrArrows = absVr > 2000 ? 3 : absVr > 1000 ? 2 : absVr > 300 ? 1 : 0;
          // Use chevron characters that look like the image
          const vrChevron = vr > 0 ? '▲' : vr < 0 ? '▼' : '';

          // Other aircraft vertical rate
          const otherVr = otherAircraft?.vr || 0;
          const otherAbsVr = Math.abs(otherVr);
          const otherVrArrows =
            otherAbsVr > 2000 ? 3 : otherAbsVr > 1000 ? 2 : otherAbsVr > 300 ? 1 : 0;
          const otherVrChevron = otherVr > 0 ? '▲' : otherVr < 0 ? '▼' : '';

          return (
            <div
              className={`aircraft-popup-container ${isConflict ? 'with-conflict' : ''}`}
              style={{ left: popupPosition.x, top: popupPosition.y }}
            >
              {/* Main Aircraft Panel */}
              <div
                className={`aircraft-popup ${config.mapMode === 'crt' ? 'crt-popup' : ''} ${config.mapMode === 'pro' ? 'pro-popup' : ''} ${isEmergency ? 'emergency-popup' : ''} ${isConflict ? `conflict-popup ${getSeverityClass(conflictSeverity)}` : ''} ${isDragging ? 'dragging' : ''}`}
              >
                <button className="popup-close" onClick={() => selectAircraft(null)}>
                  <X size={16} />
                </button>
                <div
                  role="toolbar"
                  aria-label="Drag to move panel"
                  tabIndex={0}
                  className={`popup-header ${isEmergency ? 'emergency-header' : ''} ${isConflict ? `conflict-header ${getSeverityClass(conflictSeverity)}` : ''}`}
                  onMouseDown={handlePopupMouseDown}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') selectAircraft(null);
                  }}
                >
                  <Plane size={20} />
                  <span className="popup-callsign">{liveAircraft.flight || liveAircraft.hex}</span>
                  {isConflict && (
                    <span className={`popup-conflict-tag ${getSeverityClass(conflictSeverity)}`}>
                      ⚠️ {conflictTitle}
                    </span>
                  )}
                  {isEmergency && squawkLabel && (
                    <span className="popup-squawk-tag">{squawkLabel}</span>
                  )}
                  {liveAircraft.military && <Shield size={14} className="military-badge" />}
                </div>

                <div className="popup-details">
                  <div className="detail-row">
                    <span>ICAO</span>
                    <span>{liveAircraft.hex}</span>
                  </div>
                  {(() => {
                    const tailInfo = getTailInfo(liveAircraft.hex, liveAircraft.flight);
                    return (
                      <>
                        <div className="detail-row">
                          <span>Tail #</span>
                          <span className={tailInfo.tailNumber ? 'tail-number' : 'tail-unknown'}>
                            {tailInfo.tailNumber || '--'}
                          </span>
                        </div>
                        <div className="detail-row">
                          <span>Country</span>
                          <span>{tailInfo.country || '--'}</span>
                        </div>
                      </>
                    );
                  })()}
                  <div className="detail-row">
                    <span>Type</span>
                    <span>{liveAircraft.type || '--'}</span>
                  </div>
                  <div className="detail-row">
                    <span>Altitude</span>
                    <span>{liveAircraft.alt?.toLocaleString() || '--'} ft</span>
                  </div>
                  <div className="detail-row">
                    <span>Speed</span>
                    <span>{liveAircraft.gs?.toFixed(0) || '--'} kts</span>
                  </div>
                  <div className="detail-row">
                    <span>Distance</span>
                    <span>{liveAircraft.distance_nm?.toFixed(1) || '--'} nm</span>
                  </div>
                  <div className="detail-row">
                    <span>Track</span>
                    <span>{liveAircraft.track?.toFixed(0) || '--'}°</span>
                  </div>
                  <div className="detail-row">
                    <span>V/S</span>
                    <span
                      className={`vs-value ${vr > 0 ? 'climbing' : vr < 0 ? 'descending' : ''}`}
                    >
                      {vrArrows > 0 && (
                        <span className={`vs-chevrons chevrons-${vrArrows}`}>
                          {Array(vrArrows)
                            .fill(vrChevron)
                            .map((c, i) => (
                              <span key={i} className="vs-chevron">
                                {c}
                              </span>
                            ))}
                        </span>
                      )}
                      {liveAircraft.vr || '--'} fpm
                    </span>
                  </div>
                  <div className="detail-row">
                    <span>Squawk</span>
                    <span
                      className={liveAircraft.squawk?.match(/^7[567]00$/) ? 'emergency-squawk' : ''}
                    >
                      {liveAircraft.squawk || '--'}
                    </span>
                  </div>
                </div>

                {/* External Lookup Links */}
                <div className="popup-links">
                  <span className="links-label">Lookup:</span>
                  <div className="links-row">
                    {liveAircraft.flight && (
                      <a
                        href={`https://flightaware.com/live/flight/${liveAircraft.flight.trim()}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="lookup-link"
                        title="FlightAware"
                      >
                        <ExternalLink size={12} /> FA
                      </a>
                    )}
                    <a
                      href={`https://globe.adsbexchange.com/?icao=${liveAircraft.hex}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="lookup-link"
                      title="ADS-B Exchange"
                    >
                      <ExternalLink size={12} /> ADSBx
                    </a>
                    <a
                      href={`https://www.planespotters.net/hex/${liveAircraft.hex.toUpperCase()}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="lookup-link"
                      title="Planespotters"
                    >
                      <ExternalLink size={12} /> PS
                    </a>
                    <a
                      href={`https://www.jetphotos.com/registration/${liveAircraft.hex.toUpperCase()}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="lookup-link"
                      title="JetPhotos"
                    >
                      <ExternalLink size={12} /> JP
                    </a>
                    <a
                      href={`https://opensky-network.org/aircraft-profile?icao24=${liveAircraft.hex.toLowerCase()}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="lookup-link"
                      title="OpenSky Network"
                    >
                      <ExternalLink size={12} /> OSN
                    </a>
                    {liveAircraft.flight && (
                      <a
                        href={`https://www.flightradar24.com/${liveAircraft.flight.trim()}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="lookup-link"
                        title="Flightradar24"
                      >
                        <ExternalLink size={12} /> FR24
                      </a>
                    )}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="popup-action-buttons">
                  <button
                    className={`popup-action-btn ${followingAircraft === liveAircraft.hex ? 'active' : ''}`}
                    onClick={() => {
                      if (!liveAircraft.lat || !liveAircraft.lon) return;

                      if (config.mapMode === 'map' && leafletMapRef.current) {
                        // Leaflet map mode - fly to location
                        leafletMapRef.current.flyTo([liveAircraft.lat, liveAircraft.lon], 14, {
                          duration: 1.5,
                          easeLinearity: 0.25,
                        });
                      } else if (config.mapMode === 'pro') {
                        // Pro mode - toggle following this aircraft
                        if (followingAircraft === liveAircraft.hex) {
                          setFollowingAircraft(null);
                        } else {
                          setFollowingAircraft(liveAircraft.hex);
                        }
                      }
                      // CRT/Radar modes are always centered on feeder, no jump needed
                    }}
                  >
                    <Crosshair size={14} />
                    {followingAircraft === liveAircraft.hex ? 'Following' : 'Follow Aircraft'}
                  </button>
                  <button
                    className="popup-action-btn"
                    onClick={() => openAircraftSidebar(liveAircraft.hex)}
                  >
                    <ExternalLink size={14} />
                    Details
                  </button>
                </div>

                {/* Create Alert Button */}
                <button
                  className="popup-create-alert"
                  onClick={() => {
                    // Store selected aircraft for alert creation
                    window.dispatchEvent(
                      new CustomEvent('createAlertFromAircraft', {
                        detail: liveAircraft,
                      })
                    );
                    selectAircraft(null);
                  }}
                >
                  <Bell size={14} />
                  Create Alert for this Aircraft
                </button>
              </div>

              {/* Conflict Side Panel - Shows other aircraft */}
              {isConflict && otherAircraft && (
                <div
                  className={`conflict-side-panel ${config.mapMode === 'pro' ? 'pro-style' : ''} ${getSeverityClass(conflictSeverity)}`}
                >
                  <div
                    className={`conflict-separation-header ${getSeverityClass(conflictSeverity)}`}
                  >
                    <AlertTriangle size={16} />
                    <span>{conflictTitle}</span>
                  </div>
                  <div className="conflict-separation-info">
                    <div className="separation-value">
                      {conflictInfo?.horizontalNm || '--'}
                      <span>nm</span>
                    </div>
                    <div className="separation-value">
                      {conflictInfo?.verticalFt || '--'}
                      <span>ft</span>
                    </div>
                  </div>
                  {safetyEvent && (
                    <div
                      className="conflict-message-row clickable"
                      onClick={() => onViewHistoryEvent?.(safetyEvent.id)}
                      onKeyDown={(e) => e.key === 'Enter' && onViewHistoryEvent?.(safetyEvent.id)}
                      role="button"
                      tabIndex={0}
                      title="View in History"
                    >
                      <span className="conflict-event-message">{safetyEvent.message}</span>
                    </div>
                  )}
                  <div className="conflict-other-header">
                    <Plane size={16} />
                    <span>{otherAircraft.flight?.trim() || otherAircraft.hex}</span>
                  </div>
                  <div className="conflict-other-details">
                    <div className="conflict-detail">
                      <span>Alt</span>
                      <span>{otherAircraft.alt?.toLocaleString() || '--'} ft</span>
                    </div>
                    <div className="conflict-detail">
                      <span>Spd</span>
                      <span>{otherAircraft.gs?.toFixed(0) || '--'} kts</span>
                    </div>
                    <div className="conflict-detail">
                      <span>V/S</span>
                      <span
                        className={`vs-value ${otherVr > 0 ? 'climbing' : otherVr < 0 ? 'descending' : ''}`}
                      >
                        {otherVrArrows > 0 && (
                          <span className={`vs-chevrons chevrons-${otherVrArrows}`}>
                            {Array(otherVrArrows).fill(otherVrChevron).join('')}
                          </span>
                        )}{' '}
                        {otherAircraft.vr || '--'}
                      </span>
                    </div>
                    <div className="conflict-detail">
                      <span>Trk</span>
                      <span>{otherAircraft.track?.toFixed(0) || '--'}°</span>
                    </div>
                    <div className="conflict-detail">
                      <span>Type</span>
                      <span>{otherAircraft.type || '--'}</span>
                    </div>
                  </div>
                  <button
                    className={`conflict-select-btn ${getSeverityClass(conflictSeverity)}`}
                    onClick={() => selectAircraft(otherAircraft)}
                  >
                    Select {otherAircraft.flight?.trim() || otherAircraft.hex}
                  </button>
                </div>
              )}
            </div>
          );
        })()}

      {/* METAR Popup */}
      {selectedMetar &&
        (() => {
          const decoded = decodeMetar(selectedMetar);
          return (
            <div
              className={`weather-popup ${config.mapMode === 'pro' ? 'pro-popup' : 'crt-popup'} ${isDragging ? 'dragging' : ''}`}
              style={{ left: popupPosition.x, top: popupPosition.y }}
            >
              <button className="popup-close" onClick={() => setSelectedMetar(null)}>
                <X size={16} />
              </button>
              <div
                role="toolbar"
                aria-label="Drag to move panel"
                tabIndex={0}
                className="popup-header"
                onMouseDown={handlePopupMouseDown}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setSelectedMetar(null);
                }}
              >
                <MapPin size={20} />
                <span className="popup-callsign">
                  {selectedMetar.stationId || selectedMetar.icaoId || 'METAR'}
                </span>
                <span className={`flt-cat-badge ${(selectedMetar.fltCat || 'VFR').toLowerCase()}`}>
                  {selectedMetar.fltCat || 'VFR'}
                </span>
              </div>
              <div className="popup-details">
                {selectedMetar.name && (
                  <div className="detail-row">
                    <span>Name</span>
                    <span>{selectedMetar.name}</span>
                  </div>
                )}

                {/* Flight Category with explanation */}
                <div className="detail-row decoded-section">
                  <span>Conditions</span>
                  <div className="decoded-value">
                    <strong>{decoded?.flightCategory || 'VFR'}</strong>
                    <span className="decoded-desc">{decoded?.flightCategoryDesc}</span>
                  </div>
                </div>

                {/* Temperature with description */}
                {decoded?.temperature && (
                  <div className="detail-row decoded-section">
                    <span>Temperature</span>
                    <div className="decoded-value">
                      <strong>
                        {decoded.temperature.celsius}°C / {decoded.temperature.fahrenheit}°F
                      </strong>
                      <span className="decoded-desc">{decoded.temperature.description}</span>
                    </div>
                  </div>
                )}

                {/* Dewpoint with fog risk */}
                {decoded?.dewpoint && (
                  <div className="detail-row decoded-section">
                    <span>Dewpoint</span>
                    <div className="decoded-value">
                      <strong>{decoded.dewpoint.celsius}°C</strong>
                      {decoded.dewpoint.spread !== undefined && (
                        <span className="decoded-desc">
                          Spread: {decoded.dewpoint.spread}°C • {decoded.dewpoint.fogRisk}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Wind with description */}
                {decoded?.wind && (
                  <div className="detail-row decoded-section">
                    <span className="section-icon">
                      <Navigation size={14} /> Wind
                    </span>
                    <div className="decoded-value">
                      <strong>
                        {windDirToCardinal(decoded.wind.direction)} {decoded.wind.text}
                      </strong>
                      <span className="decoded-desc">{decoded.wind.description}</span>
                    </div>
                  </div>
                )}

                {/* Visibility with description */}
                {decoded?.visibility && (
                  <div className="detail-row decoded-section">
                    <span>Visibility</span>
                    <div className="decoded-value">
                      <strong>
                        {decoded.visibility.value} {decoded.visibility.unit}
                      </strong>
                      <span className="decoded-desc">{decoded.visibility.description}</span>
                    </div>
                  </div>
                )}

                {/* Altimeter with description */}
                {decoded?.altimeter && (
                  <div className="detail-row decoded-section">
                    <span>Altimeter</span>
                    <div className="decoded-value">
                      <strong>{decoded.altimeter.inhg}&quot; Hg</strong>
                      <span className="decoded-desc">{decoded.altimeter.description}</span>
                    </div>
                  </div>
                )}

                {/* Clouds with decoded descriptions */}
                {decoded?.clouds && decoded.clouds.length > 0 && (
                  <div className="detail-row decoded-section">
                    <span>Clouds</span>
                    <div className="decoded-value cloud-layers">
                      {decoded.clouds.map((c, i) => (
                        <div key={i} className="cloud-layer">
                          <strong>
                            {c.cover} @ {c.baseDesc}
                          </strong>
                          <span className="decoded-desc">{c.coverDesc}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Weather phenomena */}
                {decoded?.weather && decoded.weather.length > 0 && (
                  <div className="detail-row decoded-section wx-section">
                    <span>Weather</span>
                    <div className="decoded-value">
                      {decoded.weather.map((w, i) => (
                        <div key={i} className="wx-item">
                          <strong>{w.code}</strong>
                          <span className="decoded-desc">{w.description}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Raw METAR */}
                {selectedMetar.rawOb && (
                  <div className="detail-row raw-section">
                    <span>Raw METAR</span>
                    <span className="mono raw-text">{selectedMetar.rawOb}</span>
                  </div>
                )}

                <div className="detail-row">
                  <span>Observed</span>
                  <span>{decoded?.time || '--'}</span>
                </div>
              </div>
            </div>
          );
        })()}

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
      {selectedPirep &&
        (() => {
          const decoded = decodePirep(selectedPirep);
          return (
            <div
              className={`weather-popup pirep-popup ${config.mapMode === 'pro' ? 'pro-popup' : 'crt-popup'} ${decoded?.type === 'UUA' ? 'urgent-pirep' : ''} ${isDragging ? 'dragging' : ''}`}
              style={{ left: popupPosition.x, top: popupPosition.y }}
            >
              <button className="popup-close" onClick={() => setSelectedPirep(null)}>
                <X size={16} />
              </button>
              <div
                role="toolbar"
                aria-label="Drag to move panel"
                tabIndex={0}
                className="popup-header"
                onMouseDown={handlePopupMouseDown}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setSelectedPirep(null);
                }}
              >
                <AlertTriangle size={20} />
                <span className="popup-callsign">PIREP</span>
                <span className={`pirep-type-badge ${decoded?.type === 'UUA' ? 'urgent' : ''}`}>
                  {decoded?.type || 'UA'}
                </span>
              </div>

              {/* Urgent warning banner */}
              {decoded?.type === 'UUA' && (
                <div className="urgent-banner">
                  ⚠️ URGENT PILOT REPORT - Significant weather hazard
                </div>
              )}

              <div className="popup-details">
                {/* Location */}
                {decoded?.location && (
                  <div className="detail-row">
                    <span>Location</span>
                    <span>{decoded.location}</span>
                  </div>
                )}

                {/* Aircraft */}
                {decoded?.aircraft && (
                  <div className="detail-row">
                    <span>Aircraft</span>
                    <span>{decoded.aircraft}</span>
                  </div>
                )}

                {/* Altitude/Flight Level */}
                {decoded?.altitude && (
                  <div className="detail-row decoded-section">
                    <span>Altitude</span>
                    <div className="decoded-value">
                      <strong>{decoded.altitude.text}</strong>
                    </div>
                  </div>
                )}

                {/* Sky Condition */}
                {decoded?.sky && (
                  <div className="detail-row decoded-section">
                    <span>Sky</span>
                    <div className="decoded-value">
                      <strong>{decoded.sky.description}</strong>
                    </div>
                  </div>
                )}

                {/* Turbulence with full decoding */}
                {decoded?.turbulence && (
                  <div
                    className={`detail-row decoded-section turb-section level-${decoded.turbulence.level}`}
                  >
                    <span className="section-icon">
                      <Wind size={14} /> Turbulence
                    </span>
                    <div className="decoded-value">
                      <strong className="turb-intensity">{decoded.turbulence.intensity}</strong>
                      {decoded.turbulence.type && (
                        <span className="turb-type">{decoded.turbulence.type}</span>
                      )}
                      {decoded.turbulence.detail && (
                        <span className="decoded-desc">{decoded.turbulence.detail}</span>
                      )}
                      {decoded.turbulence.warning && (
                        <span className="hazard-warning">{decoded.turbulence.warning}</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Icing with full decoding */}
                {decoded?.icing && (
                  <div
                    className={`detail-row decoded-section icing-section level-${decoded.icing.level}`}
                  >
                    <span className="section-icon">
                      <Snowflake size={14} /> Icing
                    </span>
                    <div className="decoded-value">
                      <strong className="icing-intensity">{decoded.icing.intensity}</strong>
                      {decoded.icing.type && (
                        <span className="icing-type">{decoded.icing.type}</span>
                      )}
                      {decoded.icing.detail && (
                        <span className="decoded-desc">{decoded.icing.detail}</span>
                      )}
                      {decoded.icing.warning && (
                        <span className="hazard-warning">{decoded.icing.warning}</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Wind Shear / LLWS with full decoding */}
                {decoded?.windshear && (
                  <div
                    className={`detail-row decoded-section ws-section level-${decoded.windshear.level}`}
                  >
                    <span className="section-icon">
                      <Wind size={14} /> Wind Shear
                    </span>
                    <div className="decoded-value">
                      <strong className="ws-intensity">{decoded.windshear.intensity}</strong>
                      {decoded.windshear.gainLoss && (
                        <span className="ws-type">{decoded.windshear.gainLoss}</span>
                      )}
                      {decoded.windshear.altRange && (
                        <span className="ws-type">at {decoded.windshear.altRange}</span>
                      )}
                      {decoded.windshear.detail && (
                        <span className="decoded-desc">{decoded.windshear.detail}</span>
                      )}
                      {decoded.windshear.warning && (
                        <span className="hazard-warning">{decoded.windshear.warning}</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Weather */}
                {decoded?.weather && (
                  <div className="detail-row">
                    <span>Weather</span>
                    <span>{decoded.weather.description}</span>
                  </div>
                )}

                {/* Temperature at altitude */}
                {decoded?.temperature && (
                  <div className="detail-row decoded-section">
                    <span className="section-icon">
                      <Thermometer size={14} /> Temp
                    </span>
                    <div className="decoded-value">
                      <strong>
                        {decoded.temperature.celsius}°C / {decoded.temperature.fahrenheit}°F
                      </strong>
                      {decoded.temperature.isaDeviation !== null && (
                        <span className="decoded-desc">
                          ISA deviation: {decoded.temperature.isaDeviation > 0 ? '+' : ''}
                          {decoded.temperature.isaDeviation}°C
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Wind at altitude */}
                {decoded?.wind && (
                  <div className="detail-row">
                    <span className="section-icon">
                      <Navigation size={14} /> Wind
                    </span>
                    <span>
                      {windDirToCardinal(decoded.wind.direction)} ({decoded.wind.direction}°) at{' '}
                      {decoded.wind.speed}kt
                    </span>
                  </div>
                )}

                {/* Remarks */}
                {decoded?.remarks && (
                  <div className="detail-row">
                    <span>Remarks</span>
                    <span>{decoded.remarks}</span>
                  </div>
                )}

                {/* Raw PIREP */}
                {selectedPirep.rawOb && (
                  <div className="detail-row raw-section">
                    <span>Raw PIREP</span>
                    <span className="mono raw-text">{selectedPirep.rawOb}</span>
                  </div>
                )}

                {/* Reported time - only show if valid */}
                {decoded?.time && (
                  <div className="detail-row">
                    <span>Reported</span>
                    <span>{decoded.time}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

      {/* Navaid Popup */}
      {selectedNavaid && (
        <div
          className={`weather-popup navaid-popup ${config.mapMode === 'pro' ? 'pro-popup' : 'crt-popup'} ${isDragging ? 'dragging' : ''}`}
          style={{ left: popupPosition.x, top: popupPosition.y }}
        >
          <button className="popup-close" onClick={() => setSelectedNavaid(null)}>
            <X size={16} />
          </button>
          <div
            role="toolbar"
            aria-label="Drag to move panel"
            tabIndex={0}
            className="popup-header"
            onMouseDown={handlePopupMouseDown}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setSelectedNavaid(null);
            }}
          >
            <Radio size={20} />
            <span className="popup-callsign">{selectedNavaid.id}</span>
            <span className="navaid-type-badge">{selectedNavaid.type || 'NAV'}</span>
          </div>

          <div className="popup-details">
            <div className="detail-row">
              <span>Type</span>
              <span>{selectedNavaid.type || 'Unknown'}</span>
            </div>

            {selectedNavaid.name && (
              <div className="detail-row">
                <span>Name</span>
                <span>{selectedNavaid.name}</span>
              </div>
            )}

            {selectedNavaid.freq && (
              <div className="detail-row">
                <span>Frequency</span>
                <span>{selectedNavaid.freq} MHz</span>
              </div>
            )}

            {selectedNavaid.channel && (
              <div className="detail-row">
                <span>Channel</span>
                <span>{selectedNavaid.channel}</span>
              </div>
            )}

            <div className="detail-row">
              <span>Position</span>
              <span>
                {selectedNavaid.lat?.toFixed(4)}°, {selectedNavaid.lon?.toFixed(4)}°
              </span>
            </div>

            {selectedNavaid.elev && (
              <div className="detail-row">
                <span>Elevation</span>
                <span>{selectedNavaid.elev.toLocaleString()} ft</span>
              </div>
            )}

            <div className="detail-row">
              <span>Distance</span>
              <span>{getDistanceNm(selectedNavaid.lat, selectedNavaid.lon).toFixed(1)} nm</span>
            </div>

            <div className="detail-row">
              <span>Bearing</span>
              <span>{Math.round(getBearing(selectedNavaid.lat, selectedNavaid.lon))}°</span>
            </div>
          </div>
        </div>
      )}

      {/* Airport Popup */}
      {selectedAirport && (
        <div
          className={`weather-popup airport-popup ${config.mapMode === 'pro' ? 'pro-popup' : 'crt-popup'} ${isDragging ? 'dragging' : ''}`}
          style={{ left: popupPosition.x, top: popupPosition.y }}
        >
          <button className="popup-close" onClick={() => setSelectedAirport(null)}>
            <X size={16} />
          </button>
          <div
            role="toolbar"
            aria-label="Drag to move panel"
            tabIndex={0}
            className="popup-header"
            onMouseDown={handlePopupMouseDown}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setSelectedAirport(null);
            }}
          >
            <Plane size={20} />
            <span className="popup-callsign">
              {selectedAirport.icao ||
                selectedAirport.icaoId ||
                selectedAirport.faaId ||
                selectedAirport.id ||
                'APT'}
            </span>
            {selectedAirport.class && (
              <span className={`airport-class-badge class-${selectedAirport.class.toLowerCase()}`}>
                Class {selectedAirport.class}
              </span>
            )}
          </div>

          <div className="popup-details">
            {(selectedAirport.name || selectedAirport.site) && (
              <div className="detail-row">
                <span>Name</span>
                <span>{selectedAirport.name || selectedAirport.site}</span>
              </div>
            )}

            {(selectedAirport.city || selectedAirport.assocCity) && (
              <div className="detail-row">
                <span>City</span>
                <span>{selectedAirport.city || selectedAirport.assocCity}</span>
              </div>
            )}

            {(selectedAirport.state || selectedAirport.stateProv) && (
              <div className="detail-row">
                <span>State</span>
                <span>{selectedAirport.state || selectedAirport.stateProv}</span>
              </div>
            )}

            <div className="detail-row">
              <span>Position</span>
              <span>
                {selectedAirport.lat?.toFixed(4)}°, {selectedAirport.lon?.toFixed(4)}°
              </span>
            </div>

            {(selectedAirport.elev !== undefined && selectedAirport.elev !== null) ||
            selectedAirport.elev_ft ? (
              <div className="detail-row">
                <span>Elevation</span>
                <span>{(selectedAirport.elev ?? selectedAirport.elev_ft).toLocaleString()} ft</span>
              </div>
            ) : null}

            {selectedAirport.rwy_length && (
              <div className="detail-row">
                <span>Longest Runway</span>
                <span>{selectedAirport.rwy_length.toLocaleString()} ft</span>
              </div>
            )}

            <div className="detail-row">
              <span>Distance</span>
              <span>{getDistanceNm(selectedAirport.lat, selectedAirport.lon).toFixed(1)} nm</span>
            </div>

            <div className="detail-row">
              <span>Bearing</span>
              <span>{Math.round(getBearing(selectedAirport.lat, selectedAirport.lon))}°</span>
            </div>

            {/* External links */}
            <div className="detail-row lookup-section">
              <span>LOOKUP:</span>
              <div className="lookup-links">
                <a
                  href={`https://www.airnav.com/airport/${selectedAirport.icao || selectedAirport.icaoId || selectedAirport.faaId || selectedAirport.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={12} /> AirNav
                </a>
                <a
                  href={`https://skyvector.com/airport/${selectedAirport.icao || selectedAirport.icaoId || selectedAirport.faaId || selectedAirport.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={12} /> SkyVector
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Airspace Popup */}
      {selectedAirspace && (
        <div
          className={`weather-popup airspace-popup ${config.mapMode === 'pro' ? 'pro-popup' : 'crt-popup'} ${isDragging ? 'dragging' : ''}`}
          style={{ left: popupPosition.x, top: popupPosition.y }}
        >
          <button className="popup-close" onClick={() => setSelectedAirspace(null)}>
            <X size={16} />
          </button>
          <div
            role="toolbar"
            aria-label="Drag to move panel"
            tabIndex={0}
            className="popup-header"
            onMouseDown={handlePopupMouseDown}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setSelectedAirspace(null);
            }}
          >
            <Layers size={20} />
            <span className="popup-callsign">{selectedAirspace.name || 'Airspace'}</span>
            <span
              className={`airport-class-badge class-${(selectedAirspace.class || selectedAirspace.airspace_class || '').toLowerCase()}`}
            >
              {selectedAirspace.class ||
                selectedAirspace.airspace_class ||
                selectedAirspace.type ||
                'Airspace'}
            </span>
          </div>

          <div className="popup-details">
            {selectedAirspace.name && (
              <div className="detail-row">
                <span>Name</span>
                <span>{selectedAirspace.name}</span>
              </div>
            )}

            <div className="detail-row">
              <span>Class/Type</span>
              <span>
                {selectedAirspace.class ||
                  selectedAirspace.airspace_class ||
                  selectedAirspace.type ||
                  'Unknown'}
              </span>
            </div>

            {(selectedAirspace.floor_ft !== undefined ||
              selectedAirspace.lower_alt_ft !== undefined) && (
              <div className="detail-row">
                <span>Floor</span>
                <span>
                  {(selectedAirspace.floor_ft ?? selectedAirspace.lower_alt_ft)?.toLocaleString() ||
                    'SFC'}{' '}
                  ft
                </span>
              </div>
            )}

            {(selectedAirspace.ceiling_ft !== undefined ||
              selectedAirspace.upper_alt_ft !== undefined) && (
              <div className="detail-row">
                <span>Ceiling</span>
                <span>
                  {(
                    selectedAirspace.ceiling_ft ?? selectedAirspace.upper_alt_ft
                  )?.toLocaleString() || 'UNL'}{' '}
                  ft
                </span>
              </div>
            )}

            {selectedAirspace.controlling_agency && (
              <div className="detail-row">
                <span>Agency</span>
                <span>{selectedAirspace.controlling_agency}</span>
              </div>
            )}

            {selectedAirspace.schedule && (
              <div className="detail-row">
                <span>Schedule</span>
                <span>{selectedAirspace.schedule}</span>
              </div>
            )}

            {(selectedAirspace.center_lat || selectedAirspace.lat) && (
              <div className="detail-row">
                <span>Center</span>
                <span>
                  {(selectedAirspace.center_lat || selectedAirspace.lat)?.toFixed(4)}°,{' '}
                  {(selectedAirspace.center_lon || selectedAirspace.lon)?.toFixed(4)}°
                </span>
              </div>
            )}

            {selectedAirspace.source && (
              <div className="detail-row">
                <span>Source</span>
                <span>{selectedAirspace.source}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Convective SIGMET Popup */}
      {selectedSigmet && (
        <div
          className={`weather-popup sigmet-popup ${config.mapMode === 'pro' ? 'pro-popup' : 'crt-popup'} ${isDragging ? 'dragging' : ''}`}
          style={{ left: popupPosition.x, top: popupPosition.y }}
        >
          <button className="popup-close" onClick={() => setSelectedSigmet(null)}>
            <X size={16} />
          </button>
          <div
            role="toolbar"
            aria-label="Drag to move panel"
            tabIndex={0}
            className="popup-header"
            onMouseDown={handlePopupMouseDown}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setSelectedSigmet(null);
            }}
          >
            <AlertTriangle size={20} />
            <span className="popup-callsign">SIGMET</span>
            <span
              className={`sigmet-severity-badge severity-${selectedSigmet.severity?.level || 1}`}
              style={{
                backgroundColor: selectedSigmet.severity?.color || 'rgba(255, 200, 0, 0.5)',
                border: `1px solid ${selectedSigmet.severity?.stroke || 'rgba(255, 200, 0, 0.8)'}`,
              }}
            >
              {selectedSigmet.severity?.label || 'Convective'}
            </span>
          </div>

          <div className="popup-details">
            <div className="detail-row">
              <span>ID</span>
              <span className="mono">{selectedSigmet.id || '---'}</span>
            </div>

            <div className="detail-row">
              <span>Type</span>
              <span>{selectedSigmet.type || selectedSigmet.hazard || 'Convective'}</span>
            </div>

            {selectedSigmet.qualifier && (
              <div className="detail-row">
                <span>Qualifier</span>
                <span>{selectedSigmet.qualifier}</span>
              </div>
            )}

            <div className="detail-row">
              <span>Valid Time</span>
              <span>{selectedSigmet.validTimeDisplay || '---'}</span>
            </div>

            {selectedSigmet.altitude && (
              <div className="detail-row">
                <span>Altitude</span>
                <span>
                  FL{Math.round((selectedSigmet.altitude.lower || 0) / 100)} - FL
                  {Math.round((selectedSigmet.altitude.upper || 45000) / 100)}
                </span>
              </div>
            )}

            {selectedSigmet.movement && (
              <div className="detail-row">
                <span>Movement</span>
                <span>{selectedSigmet.movement}</span>
              </div>
            )}

            {selectedSigmet.intensity && (
              <div className="detail-row">
                <span>Trend</span>
                <span>{selectedSigmet.intensity}</span>
              </div>
            )}

            {selectedSigmet.rawText && (
              <div className="detail-row raw-section">
                <span>Raw Text</span>
                <span className="mono raw-text" style={{ fontSize: '10px', maxWidth: '250px' }}>
                  {selectedSigmet.rawText}
                </span>
              </div>
            )}

            {selectedSigmet.source && (
              <div className="detail-row">
                <span>Source</span>
                <span>{selectedSigmet.source}</span>
              </div>
            )}
          </div>
        </div>
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
        <div className="acars-panel">
          <div className="acars-panel-header">
            <div className="acars-panel-title">
              <MessageCircle size={18} />
              <span>ACARS Messages</span>
              {acarsStatus && (
                <span className={`acars-status-dot ${acarsStatus.running ? 'active' : ''}`} />
              )}
            </div>
            <button className="acars-close" onClick={() => setShowAcarsPanel(false)}>
              <X size={16} />
            </button>
          </div>
          {acarsStatus && (
            <div className="acars-stats">
              <div className="acars-stat">
                <span>Buffer</span>
                <span>{acarsStatus.buffer_size || 0}</span>
              </div>
              <div className="acars-stat">
                <span>ACARS</span>
                <span>{acarsStatus.acars?.total_received || 0}</span>
              </div>
              <div className="acars-stat">
                <span>VDL2</span>
                <span>{acarsStatus.vdlm2?.total_received || 0}</span>
              </div>
            </div>
          )}
          {/* ACARS Filters */}
          <div className="acars-filters">
            <label className="acars-filter-toggle">
              <input
                type="checkbox"
                checked={acarsFilters.hideEmpty}
                onChange={(e) => setAcarsFilters({ ...acarsFilters, hideEmpty: e.target.checked })}
              />
              <span>Hide empty</span>
            </label>
            <select
              className="acars-source-filter"
              value={acarsFilters.sourceFilter}
              onChange={(e) => setAcarsFilters({ ...acarsFilters, sourceFilter: e.target.value })}
            >
              <option value="all">All Sources</option>
              <option value="acars">ACARS Only</option>
              <option value="vdlm2">VDL2 Only</option>
            </select>
            <input
              type="text"
              className="acars-callsign-filter"
              placeholder="Callsign..."
              value={acarsFilters.callsignFilter}
              onChange={(e) => setAcarsFilters({ ...acarsFilters, callsignFilter: e.target.value })}
            />
          </div>
          <div className="acars-messages">
            {(() => {
              // Filter messages
              let filtered = acarsMessages;

              // Hide empty messages
              if (acarsFilters.hideEmpty) {
                filtered = filtered.filter((msg) => msg.text && msg.text.trim().length > 0);
              }

              // Source filter
              if (acarsFilters.sourceFilter !== 'all') {
                filtered = filtered.filter((msg) => msg.source === acarsFilters.sourceFilter);
              }

              // Callsign filter
              if (acarsFilters.callsignFilter) {
                const cf = acarsFilters.callsignFilter.toLowerCase();
                filtered = filtered.filter(
                  (msg) =>
                    (msg.callsign && msg.callsign.toLowerCase().includes(cf)) ||
                    (msg.icao_hex && msg.icao_hex.toLowerCase().includes(cf))
                );
              }

              if (filtered.length === 0) {
                return <div className="acars-empty">No messages match filters</div>;
              }

              return filtered.slice(0, 50).map((msg, i) => {
                // Find matching aircraft by ICAO hex or callsign (handles IATA/ICAO conversion)
                const matchingAircraft = aircraft.find(
                  (ac) =>
                    (msg.icao_hex && ac.hex?.toUpperCase() === msg.icao_hex.toUpperCase()) ||
                    callsignsMatch(msg.callsign, ac.flight)
                );

                // Check cache for hex lookup by callsign (from history API)
                const cachedHex = msg.callsign
                  ? callsignHexCache[msg.callsign.trim().toUpperCase()]
                  : null;

                // Get hex for linking - prefer matched aircraft, then message icao_hex, then cached lookup
                const linkHex = matchingAircraft?.hex || msg.icao_hex || cachedHex;
                const canLink = !!linkHex;
                const isMatched = !!matchingAircraft; // Aircraft is currently in range
                const isFromHistory = !isMatched && !msg.icao_hex && cachedHex; // Linked via history lookup

                return (
                  <div
                    key={i}
                    className={`acars-message ${canLink ? 'clickable' : ''} ${isMatched ? 'matched' : ''}`}
                    onClick={() => {
                      if (canLink) {
                        // Open aircraft detail page
                        setAircraftDetailHex(linkHex);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && canLink) {
                        setAircraftDetailHex(linkHex);
                      }
                    }}
                    role={canLink ? 'button' : undefined}
                    tabIndex={canLink ? 0 : undefined}
                    title={
                      isMatched
                        ? 'Click to view aircraft (in range)'
                        : isFromHistory
                          ? 'Click to view aircraft (from history)'
                          : canLink
                            ? 'Click to view aircraft details'
                            : 'Aircraft not in range - no ICAO hex'
                    }
                  >
                    <div className="acars-msg-header">
                      <span className={`acars-callsign ${canLink ? 'clickable' : ''}`}>
                        {msg.callsign || msg.icao_hex || 'Unknown'}
                      </span>
                      <span className="acars-label">{msg.label || '--'}</span>
                      <span className={`acars-source-badge ${msg.source}`}>{msg.source}</span>
                      <span className="acars-time">
                        {msg.timestamp ? new Date(msg.timestamp * 1000).toLocaleTimeString() : '--'}
                      </span>
                    </div>
                    {msg.text && <div className="acars-text">{msg.text}</div>}
                  </div>
                );
              });
            })()}
          </div>
        </div>
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
