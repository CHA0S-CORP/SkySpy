import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Plane, Radio, MapPin, Activity, Clock, Filter, ChevronUp, ChevronDown,
  ChevronLeft, ChevronRight, X, Eye, EyeOff, Settings, Trash2, Plus, Shield, 
  Bell, Database, Zap, RefreshCw, TestTube2, AlertTriangle, BarChart3, History, 
  Map as MapIcon, Radar, Moon, Sun, BellRing, BellOff, Layers, ExternalLink,
  Ship, Radio as RadioIcon, LayoutDashboard, LineChart, MessageSquare, Anchor,
  Wind, Snowflake, CloudRain, Thermometer, Navigation, Info, HelpCircle, Compass,
  Volume2, VolumeX, Check, Menu, Search, Signal, Crosshair, BellPlus, TrendingUp, TrendingDown, Minus,
  ArrowUpRight, ArrowDownRight, ArrowRight, LocateFixed, Maximize2, Minimize2, Pin, PinOff, MessageCircle,
  Camera, Calendar, Building2, Flag, Hash, Wifi, WifiOff
} from 'lucide-react';

// Import utilities
import {
  getConfig, saveConfig, getOverlays, saveOverlays,
  getTailInfo, getCountryFromIcao, getTailNumber, getCategoryName,
  decodeMetar, decodePirep, getPirepType, windDirToCardinal,
  utcToLocal, utcToLocalTime, callsignsMatch
} from '../../utils';

// Import AircraftDetailPage
import { AircraftDetailPage } from '../aircraft/AircraftDetailPage';

function MapView({ aircraft, config, setConfig, feederLocation, safetyEvents: wsSafetyEvents, wsRequest, wsConnected, onViewHistoryEvent, hashParams = {}, setHashParams }) {
  const [selectedAircraft, setSelectedAircraft] = useState(null);
  const [selectedMetar, setSelectedMetar] = useState(null);
  const [selectedPirep, setSelectedPirep] = useState(null);
  const [selectedNavaid, setSelectedNavaid] = useState(null);
  const [selectedAirport, setSelectedAirport] = useState(null);
  const [radarRange, setRadarRange] = useState(50); // nm
  const [showOverlayMenu, setShowOverlayMenu] = useState(false);
  const [safetyEvents, setSafetyEvents] = useState([]); // Safety events from API/WebSocket
  const [acknowledgedEvents, setAcknowledgedEvents] = useState(new Set()); // Acknowledged event IDs
  const [showAircraftList, setShowAircraftList] = useState(() => {
    const saved = localStorage.getItem('adsb-show-aircraft-list');
    return saved === null ? false : saved === 'true';
  });
  const [listExpanded, setListExpanded] = useState(() => {
    const saved = localStorage.getItem('adsb-list-expanded');
    return saved === null ? true : saved === 'true';
  });
  const [showLegend, setShowLegend] = useState(false); // Legend panel visibility
  const [legendCollapsed, setLegendCollapsed] = useState(false); // Legend content collapsed
  const [listDisplayCount, setListDisplayCount] = useState(20); // Lazy load count for aircraft list
  const [showRangeControl, setShowRangeControl] = useState(false); // Show range control when cursor near
  const [soundMuted, setSoundMuted] = useState(() => localStorage.getItem('adsb-sound-muted') === 'true');
  const [searchQuery, setSearchQuery] = useState(''); // Search filter
  const [trackHistory, setTrackHistory] = useState({}); // Per-aircraft position history for trails
  const [showSelectedTrack, setShowSelectedTrack] = useState(false); // Show track line for selected aircraft
  const [showShortTracks, setShowShortTracks] = useState(() => localStorage.getItem('adsb-show-short-tracks') === 'true'); // Show short ~5nm trails for all aircraft (ATC style)
  const [shortTrackHistory, setShortTrackHistory] = useState({}); // Historical positions for short tracks (from API)

  // New feature states
  const [isFullscreen, setIsFullscreen] = useState(false); // Fullscreen mode
  const [panelPinned, setPanelPinned] = useState(false); // Pin pro details panel
  const [showAcarsPanel, setShowAcarsPanel] = useState(false); // ACARS messages panel
  const [acarsMessages, setAcarsMessages] = useState([]); // Live ACARS messages
  const [acarsStatus, setAcarsStatus] = useState(null); // ACARS service status
  const [acarsFilters, setAcarsFilters] = useState(() => {
    try {
      const saved = localStorage.getItem('adsb-acars-filters');
      return saved ? JSON.parse(saved) : {
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
  const [aircraftDetailHex, setAircraftDetailHex] = useState(null); // Aircraft for detail page
  const [aircraftInfo, setAircraftInfo] = useState({}); // Cached aircraft info
  const [callsignHexCache, setCallsignHexCache] = useState({}); // Callsign → ICAO hex cache for ACARS linking
  
  // Traffic filters state
  const [trafficFilters, setTrafficFilters] = useState(() => {
    try {
      const saved = localStorage.getItem('adsb-traffic-filters');
      return saved ? JSON.parse(saved) : {
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
  const [proPhotoError, setProPhotoError] = useState(false); // Track photo loading errors for Pro panel
  const [proPhotoRetry, setProPhotoRetry] = useState(0); // Retry counter for pro panel photo
  const [proPhotoUrl, setProPhotoUrl] = useState(null); // S3 URL for pro panel photo
  
  // Aviation overlay states - load from localStorage
  const [overlays, setOverlays] = useState(getOverlays);
  
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

  // Pro mode pan state (middle mouse button panning)
  const [proPanOffset, setProPanOffset] = useState({ x: 0, y: 0 });
  const [isProPanning, setIsProPanning] = useState(false);
  const proPanStartRef = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });
  const proPanOffsetRef = useRef(proPanOffset); // Ref to access latest pan offset in callbacks
  const [followingAircraft, setFollowingAircraft] = useState(null); // ICAO hex of aircraft to follow

  // Keep pan offset ref in sync
  useEffect(() => {
    proPanOffsetRef.current = proPanOffset;
  }, [proPanOffset]);
  
  // Aviation data from REST endpoints
  const [aviationData, setAviationData] = useState({
    navaids: [],
    airports: [],
    airspaces: [],      // G-AIRMET advisories from /api/v1/aviation/airspaces
    boundaries: [],     // Static airspace boundaries from /api/v1/aviation/airspace-boundaries
    metars: [],
    pireps: [],
  });

  // Terrain overlay data (pro mode only) - cached GeoJSON boundaries
  const [terrainData, setTerrainData] = useState({
    water: null,
    counties: null,
    states: null,
    countries: null,
  });

  // Map viewport center for dynamic data loading (updated on pan/zoom)
  const [viewportCenter, setViewportCenter] = useState({ lat: null, lon: null });
  const viewportUpdateTimeoutRef = useRef(null);

  // Store initial center from URL to apply when map initializes
  const initialCenterRef = useRef(null);
  const initialZoomRef = useRef(null);
  const centerUpdateTimeoutRef = useRef(null);

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
  const conflictsRef = useRef([]); // Track conflicts for banner
  const shortTrackFetchedRef = useRef(new Set()); // Track which aircraft have had history fetched

  // Pro panel canvas refs
  const trackCanvasRef = useRef(null);
  const altProfileCanvasRef = useRef(null);
  const speedProfileCanvasRef = useRef(null);
  const vsProfileCanvasRef = useRef(null);
  const distProfileCanvasRef = useRef(null);

  // Pro panel distance trend tracking
  const proPrevDistanceRef = useRef(null);
  const proDistanceTrendRef = useRef(null); // 'approaching', 'receding', or 'stable'
  const proTrackedAircraftRef = useRef(null); // Track which aircraft we're monitoring

  // Notification tracking refs
  const notifiedConflictsRef = useRef(new Set()); // Track notified conflict pairs
  const notifiedEmergenciesRef = useRef(new Set()); // Track notified emergency aircraft
  const alarmAudioRef = useRef(null); // Audio element for conflict alarm
  const alarmPlayingRef = useRef(false); // Track if alarm is currently playing
  const alarmIntervalRef = useRef(null); // Interval for looping alarm

  // Use feeder location or default
  const feederLat = feederLocation?.lat || 47.9377;
  const feederLon = feederLocation?.lon || -121.9687;

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
    let newConfig = { ...config };
    let configChanged = false;

    // Sync mode from URL
    if (hashParams.mode && VALID_MODES.includes(hashParams.mode) && hashParams.mode !== config.mapMode) {
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
      const enabledOverlays = hashParams.overlays.split(',').map(s => s.trim());
      const newOverlays = { ...overlays };
      Object.keys(newOverlays).forEach(key => {
        newOverlays[key] = enabledOverlays.includes(key);
      });
      setOverlays(newOverlays);
      saveOverlays(newOverlays);
    }

    // Sync traffic filters from URL (comma-separated list of enabled filters + altitude range)
    if (hashParams.filters || hashParams.minAlt !== undefined || hashParams.maxAlt !== undefined) {
      const newFilters = { ...trafficFilters };

      if (hashParams.filters) {
        const enabledFilters = hashParams.filters.split(',').map(s => s.trim());
        // Boolean filter keys
        const boolKeys = ['showMilitary', 'showCivil', 'showGround', 'showAirborne',
                          'showWithSquawk', 'showWithoutSquawk', 'safetyEventsOnly',
                          'showGA', 'showAirliners'];
        boolKeys.forEach(key => {
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
      const boolKeys = ['showMilitary', 'showCivil', 'showGround', 'showAirborne',
                        'showWithSquawk', 'showWithoutSquawk', 'safetyEventsOnly',
                        'showGA', 'showAirliners'];
      const enabledFilters = boolKeys.filter(key => trafficFilters[key]).join(',');
      setHashParams({
        filters: enabledFilters || undefined,
        minAlt: trafficFilters.minAltitude !== 0 ? String(trafficFilters.minAltitude) : undefined,
        maxAlt: trafficFilters.maxAltitude !== 60000 ? String(trafficFilters.maxAltitude) : undefined,
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
      const ac = aircraft.find(a => a.hex?.toLowerCase() === hashParams.selected.toLowerCase());
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
  const sendNotification = useCallback((title, body, tag, urgent = false) => {
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
        silent: false
      });
      
      // Auto-close non-urgent notifications after 10 seconds
      if (!urgent) {
        setTimeout(() => notif.close(), 10000);
      }
    } catch (e) {
      console.warn('Notification failed:', e);
    }
  }, [config.browserNotifications]);
  
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
      playTone(now, 1800, 0.25);        // High
      playTone(now + 0.25, 1200, 0.25); // Low
      playTone(now + 0.5, 1800, 0.25);  // High
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
  const playConflictAlarm = useCallback((severity = 'low') => {
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
  }, [playAlarmStage1, playAlarmStage2, playAlarmStage3]);
  
  // Get highest severity from active events
  const getHighestSeverity = useCallback((events) => {
    if (events.some(e => e.severity === 'critical')) return 'critical';
    if (events.some(e => e.severity === 'warning')) return 'warning';
    return 'low';
  }, []);
  
  // Start looping alarm for unacknowledged events
  const startAlarmLoop = useCallback((severity = 'low') => {
    if (alarmIntervalRef.current || soundMuted) return;
    
    playConflictAlarm(severity);
    
    // Determine loop interval based on severity
    const interval = severity === 'critical' ? 1500 : severity === 'warning' ? 2500 : 3000;
    
    alarmIntervalRef.current = setInterval(() => {
      playConflictAlarm(severity);
    }, interval);
  }, [playConflictAlarm, soundMuted]);
  
  // Stop the alarm loop
  const stopAlarmLoop = useCallback(() => {
    if (alarmIntervalRef.current) {
      clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    }
  }, []);
  
  // Acknowledge a safety event via API and update local state
  const acknowledgeEvent = useCallback(async (eventId) => {
    const baseUrl = config.apiBaseUrl || '';

    // Stop audio immediately regardless of API result
    stopAlarmLoop();

    // Update local state immediately for UI feedback
    setAcknowledgedEvents(prev => new Set([...prev, eventId]));

    // Try to persist to API (fire-and-forget, don't block on failure)
    try {
      await fetch(`${baseUrl}/api/v1/safety/active/${encodeURIComponent(eventId)}/acknowledge`, {
        method: 'POST'
      });
    } catch (err) {
      console.error('Failed to acknowledge event via API:', err);
      // Audio is already stopped and UI is updated, so this is just a log
    }
  }, [config.apiBaseUrl, stopAlarmLoop]);

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
    setProPhotoError(false);
    setProPhotoRetry(0);
    setProPhotoUrl(null);

    if (selectedAircraft?.hex) {
      const fetchPhoto = async () => {
        try {
          // Use WebSocket if available, otherwise fall back to HTTP
          if (wsRequest && wsConnected) {
            const data = await wsRequest('photo-cache', { icao: selectedAircraft.hex });
            if (data?.thumbnail_url) {
              setProPhotoUrl(data.thumbnail_url);
            } else if (data?.photo_url) {
              setProPhotoUrl(data.photo_url);
            } else if (data?.error) {
              console.debug('Photo cache WS error:', data.error);
              setProPhotoError(true);
            } else {
              // No photo URL returned
              console.debug('Photo cache WS: no URL in response', data);
              setProPhotoError(true);
            }
          } else {
            // Fallback to HTTP POST
            const res = await fetch(`${config.apiBaseUrl || ''}/api/v1/aircraft/${selectedAircraft.hex}/photo/cache`, {
              method: 'POST'
            });
            if (res.ok) {
              const data = await res.json();
              if (data?.thumbnail_url) {
                setProPhotoUrl(data.thumbnail_url);
              } else if (data?.photo_url) {
                setProPhotoUrl(data.photo_url);
              } else {
                setProPhotoError(true);
              }
            } else {
              setProPhotoError(true);
            }
          }
        } catch (err) {
          console.debug('Photo cache error:', err);
          setProPhotoError(true);
        }
      };
      fetchPhoto();
    }
  }, [selectedAircraft?.hex, config.apiBaseUrl, wsRequest, wsConnected]);
  
  // Merge WebSocket safety events with local state
  useEffect(() => {
    if (wsSafetyEvents && wsSafetyEvents.length > 0) {
      setSafetyEvents(prev => {
        const existingIds = new Set(prev.map(e => e.id));
        const newEvents = wsSafetyEvents.filter(e => !existingIds.has(e.id));
        if (newEvents.length === 0) return prev;
        return [...newEvents, ...prev].slice(0, 50);
      });
    }
  }, [wsSafetyEvents]);

  // Fetch safety events via WebSocket on connect
  useEffect(() => {
    if (!wsRequest || !wsConnected) return;

    const fetchSafetyEvents = async () => {
      try {
        const data = await wsRequest('safety-events', { limit: 20 });
        const events = Array.isArray(data) ? data : (data?.data || data?.events || []);
        if (events.length > 0) {
          setSafetyEvents(prev => {
            const existingIds = new Set(prev.map(e => e.id));
            const newEvents = events.filter(e => !existingIds.has(e.id));
            if (newEvents.length === 0) return prev;
            return [...newEvents, ...prev].slice(0, 50);
          });
        }
      } catch (err) {
        // Silent fail - real-time push is primary
        console.warn('Safety events fetch failed:', err.message);
      }
    };

    fetchSafetyEvents();
    // Refresh every 30 seconds (less frequent since we have real-time push)
    const interval = setInterval(fetchSafetyEvents, 30000);
    return () => clearInterval(interval);
  }, [wsRequest, wsConnected]);
  
  // Convert safety events to conflict format for display with LIVE separation data
  const activeConflicts = useMemo(() => {
    // Get unacknowledged safety events (last 60 seconds)
    const cutoff = Date.now() - 60000;
    return safetyEvents.filter(event => {
      if (acknowledgedEvents.has(event.id)) return false;
      const eventTime = new Date(event.timestamp).getTime();
      return eventTime > cutoff;
    }).map(event => {
      // Try to calculate live separation if both aircraft are available
      let horizontalNm = event.details?.horizontal_nm?.toFixed(1) || '--';
      let verticalFt = event.details?.vertical_ft || event.details?.altitude || '--';
      
      // For two-aircraft events (like proximity_conflict, tcas_ra), calculate live values
      if (event.icao && event.icao_2) {
        const ac1 = aircraft.find(a => a.hex?.toLowerCase() === event.icao?.toLowerCase());
        const ac2 = aircraft.find(a => a.hex?.toLowerCase() === event.icao_2?.toLowerCase());
        
        if (ac1?.lat && ac1?.lon && ac2?.lat && ac2?.lon) {
          // Calculate horizontal distance between aircraft
          const dLat = (ac2.lat - ac1.lat) * 60; // nm
          const dLon = (ac2.lon - ac1.lon) * 60 * Math.cos(ac1.lat * Math.PI / 180); // nm
          horizontalNm = Math.sqrt(dLat * dLat + dLon * dLon).toFixed(1);
        }
        
        if (ac1?.alt && ac2?.alt) {
          verticalFt = Math.round(Math.abs(ac2.alt - ac1.alt));
        }
      }
      // For single-aircraft events (extreme_vs, rapid_descent, etc.), show current altitude/vs
      else if (event.icao) {
        const ac = aircraft.find(a => a.hex?.toLowerCase() === event.icao?.toLowerCase());
        if (ac?.alt) {
          verticalFt = Math.round(ac.alt);
        }
        // For V/S events, show current vertical rate
        if (event.event_type?.includes('vs') || event.event_type?.includes('descent') || event.event_type?.includes('climb')) {
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
    const unacknowledged = activeConflicts.filter(event => !acknowledgedEvents.has(event.id));
    
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
        
        // Auto-acknowledge low severity events after 5 seconds
        setTimeout(() => {
          unacknowledged.forEach(e => {
            if (e.severity === 'low') acknowledgeEvent(e.id);
          });
        }, 5000);
      } else {
        // For warning/critical, loop until acknowledged
        startAlarmLoop(severity);
      }
    } else {
      stopAlarmLoop();
    }
    
    // Send browser notifications for NEW events and auto-focus on critical/warning
    activeConflicts.forEach(event => {
      const eventKey = `safety-${event.id}`;

      if (!notifiedConflictsRef.current.has(eventKey)) {
        notifiedConflictsRef.current.add(eventKey);

        const severityEmoji = event.severity === 'critical' ? '🚨' :
                             event.severity === 'warning' ? '⚠️' : '🔔';
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
  }, [activeConflicts, acknowledgedEvents, acknowledgeEvent, getHighestSeverity, playConflictAlarm, sendNotification, startAlarmLoop, stopAlarmLoop, aircraft]);
  
  
  // Monitor for emergency squawks and send notifications
  useEffect(() => {
    const emergencySquawks = { '7500': 'HIJACK', '7600': 'RADIO FAILURE', '7700': 'EMERGENCY' };
    
    aircraft.forEach(ac => {
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
      aircraft.filter(ac => ac.emergency || emergencySquawks[ac.squawk]).map(ac => ac.hex)
    );
    notifiedEmergenciesRef.current.forEach(key => {
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

  // Fetch ACARS status via Socket.IO (with HTTP fallback)
  useEffect(() => {
    const fetchAcarsStatus = async () => {
      // Try Socket.IO first if connected
      if (wsRequest && wsConnected) {
        try {
          const data = await wsRequest('acars-status', {});
          if (data && !data.error) {
            setAcarsStatus(data);
            return;
          }
        } catch (err) {
          // Fall through to HTTP
        }
      }

      // HTTP fallback
      const baseUrl = config.apiBaseUrl || '';
      try {
        const statusRes = await fetch(`${baseUrl}/api/v1/acars/status`);
        if (statusRes.ok) {
          const data = await statusRes.json();
          setAcarsStatus(data);
        }
      } catch (err) {
        // Silently fail - ACARS may not be available
      }
    };

    fetchAcarsStatus();
    const interval = setInterval(fetchAcarsStatus, 10000); // Check status every 10s
    return () => clearInterval(interval);
  }, [config.apiBaseUrl, wsRequest, wsConnected]);

  // Fetch ACARS messages (only when panel is open)
  useEffect(() => {
    if (!showAcarsPanel) return;

    const fetchAcarsMessages = async () => {
      const baseUrl = config.apiBaseUrl || '';
      try {
        const msgRes = await fetch(`${baseUrl}/api/v1/acars/messages/recent?limit=50`);
        if (msgRes.ok) {
          const data = await msgRes.json();
          setAcarsMessages(data.messages || []);
        }
      } catch (err) {
        console.log('ACARS messages fetch error:', err.message);
      }
    };

    fetchAcarsMessages();
    const interval = setInterval(fetchAcarsMessages, 10000); // Reduced from 5s to 10s
    return () => clearInterval(interval);
  }, [showAcarsPanel, config.apiBaseUrl]);

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
        const hasMatch = aircraft.some(ac => callsignsMatch(cs, ac.flight));
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
            const result = await wsRequest('sightings', { callsign: callsign, hours: 24, limit: 1 });
            if (result && result.sightings) {
              data = result;
            } else {
              throw new Error('Invalid sightings response');
            }
          } else {
            const res = await fetch(`${baseUrl}/api/v1/history/sightings?callsign=${encodeURIComponent(callsign)}&hours=24&limit=1`);
            if (res.ok) {
              data = await res.json();
            } else {
              throw new Error('HTTP request failed');
            }
          }
          if (data.sightings && data.sightings.length > 0 && data.sightings[0].icao_hex) {
            setCallsignHexCache(prev => ({
              ...prev,
              [callsign]: data.sightings[0].icao_hex
            }));
          } else {
            // Mark as not found to avoid re-querying
            setCallsignHexCache(prev => ({ ...prev, [callsign]: null }));
          }
        } catch (err) {
          // Silently fail - link just won't work for this callsign
        }
      }
    };

    lookupCallsigns();
  }, [showAcarsPanel, acarsMessages, aircraft, callsignHexCache, config.apiBaseUrl, wsRequest, wsConnected]);

  // Fetch aircraft info when selecting aircraft
  useEffect(() => {
    if (!selectedAircraft?.hex) return;
    if (aircraftInfo[selectedAircraft.hex]) return; // Already cached

    const fetchInfo = async () => {
      // Prefer Socket.IO request if available
      if (wsRequest && wsConnected) {
        try {
          const data = await wsRequest('aircraft-info', { icao: selectedAircraft.hex });
          if (data && !data.error) {
            setAircraftInfo(prev => ({ ...prev, [selectedAircraft.hex]: data }));
          }
        } catch (err) {
          console.log('Aircraft info WS request error:', err.message);
        }
      } else {
        // Fallback to HTTP
        const baseUrl = config.apiBaseUrl || '';
        try {
          const res = await fetch(`${baseUrl}/api/v1/aircraft/${selectedAircraft.hex}/info`);
          if (res.ok) {
            const data = await res.json();
            setAircraftInfo(prev => ({ ...prev, [selectedAircraft.hex]: data }));
          }
        } catch (err) {
          console.log('Aircraft info fetch error:', err.message);
        }
      }
    };

    fetchInfo();
  }, [selectedAircraft?.hex, config.apiBaseUrl, aircraftInfo, wsRequest, wsConnected]);

  // Popup drag handlers
  const handlePopupMouseDown = (e) => {
    if (e.target.closest('.popup-close') || e.target.closest('a') || e.target.closest('button')) return;
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startX: popupPosition.x,
      startY: popupPosition.y
    };
    e.preventDefault();
  };

  const handlePopupMouseMove = useCallback((e) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPopupPosition({
      x: Math.max(0, dragStartRef.current.startX + dx),
      y: Math.max(0, dragStartRef.current.startY + dy)
    });
  }, [isDragging]);

  const handlePopupMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Add global mouse handlers for dragging
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handlePopupMouseMove);
      window.addEventListener('mouseup', handlePopupMouseUp);
      return () => {
        window.removeEventListener('mousemove', handlePopupMouseMove);
        window.removeEventListener('mouseup', handlePopupMouseUp);
      };
    }
  }, [isDragging, handlePopupMouseMove, handlePopupMouseUp]);

  // Legend drag handlers
  const handleLegendMouseDown = (e) => {
    if (e.target.closest('button')) return;
    setIsLegendDragging(true);
    const rect = e.currentTarget.getBoundingClientRect();
    legendDragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startX: legendPosition.x ?? rect.left,
      startY: legendPosition.y ?? rect.top
    };
    e.preventDefault();
  };

  const handleLegendMouseMove = useCallback((e) => {
    if (!isLegendDragging) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const dx = clientX - legendDragStartRef.current.x;
    const dy = clientY - legendDragStartRef.current.y;
    setLegendPosition({
      x: Math.max(0, legendDragStartRef.current.startX + dx),
      y: Math.max(0, legendDragStartRef.current.startY + dy)
    });
  }, [isLegendDragging]);

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
      startY: aircraftListPosition.y ?? rect.top
    };
    e.preventDefault();
  };

  const handleListMouseMove = useCallback((e) => {
    if (!isListDragging) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const dx = clientX - listDragStartRef.current.x;
    const dy = clientY - listDragStartRef.current.y;
    setAircraftListPosition({
      x: Math.max(0, listDragStartRef.current.startX + dx),
      y: Math.max(0, listDragStartRef.current.startY + dy)
    });
  }, [isListDragging]);

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
  const handleProPanStart = useCallback((e) => {
    // Middle mouse button (button 1) or auxiliary button
    if (e.button !== 1 || config.mapMode !== 'pro') return;
    e.preventDefault();
    setIsProPanning(true);
    proPanStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      offsetX: proPanOffset.x,
      offsetY: proPanOffset.y
    };
  }, [config.mapMode, proPanOffset]);

  const handleProPanMove = useCallback((e) => {
    if (!isProPanning) return;
    // Stop following when manually panning
    setFollowingAircraft(null);
    const dx = e.clientX - proPanStartRef.current.x;
    const dy = e.clientY - proPanStartRef.current.y;
    setProPanOffset({
      x: proPanStartRef.current.offsetX + dx,
      y: proPanStartRef.current.offsetY + dy
    });
  }, [isProPanning]);

  const handleProPanEnd = useCallback(() => {
    setIsProPanning(false);
    // Update URL with pan offset for pro/crt mode (store as pixels since lat/lon conversion is complex)
    const updateHash = setHashParamsRef.current;
    const offset = proPanOffsetRef.current;
    if (updateHash && (offset.x !== 0 || offset.y !== 0)) {
      updateHash({
        panX: String(Math.round(offset.x)),
        panY: String(Math.round(offset.y))
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

    const followedAc = aircraft.find(ac => ac.hex === followingAircraft);
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
    const nmX = dLon * 60 * Math.cos(feederLat * Math.PI / 180);

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

  // Handle mouse move on radar container to show/hide range control
  const handleContainerMouseMove = useCallback((e) => {
    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    const containerHeight = rect.height;
    
    // Show range control when mouse is in bottom 15% of container
    const showThreshold = containerHeight * 0.85;
    setShowRangeControl(mouseY > showThreshold);
  }, []);

  const handleContainerMouseLeave = useCallback(() => {
    setShowRangeControl(false);
  }, []);

  // Track aircraft position history for trails and profile charts
  useEffect(() => {
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes of history
    
    setTrackHistory(prev => {
      const updated = { ...prev };
      
      // Add new positions for each aircraft
      aircraft.forEach(ac => {
        if (ac.lat && ac.lon && ac.hex) {
          if (!updated[ac.hex]) {
            updated[ac.hex] = [];
          }
          
          // Calculate distance from feeder
          const dLat = ac.lat - feederLat;
          const dLon = ac.lon - feederLon;
          const latNm = dLat * 60;
          const lonNm = dLon * 60 * Math.cos(feederLat * Math.PI / 180);
          const dist = Math.sqrt(latNm * latNm + lonNm * lonNm);
          
          // Only add if position has changed or enough time has passed
          const lastPos = updated[ac.hex][updated[ac.hex].length - 1];
          if (!lastPos || 
              now - lastPos.time > 3000 || // At least 3 seconds between points
              Math.abs(lastPos.lat - ac.lat) > 0.001 || 
              Math.abs(lastPos.lon - ac.lon) > 0.001) {
            updated[ac.hex].push({
              lat: ac.lat,
              lon: ac.lon,
              alt: ac.alt_baro || ac.alt_geom || ac.alt,
              spd: ac.gs || ac.tas || ac.ias,
              vs: ac.vr ?? ac.baro_rate ?? ac.geom_rate ?? 0,
              trk: ac.track || ac.true_heading || ac.mag_heading,
              dist: dist,
              time: now
            });
          }
          
          // Remove old positions
          updated[ac.hex] = updated[ac.hex].filter(p => now - p.time < maxAge);
        }
      });
      
      // Clean up aircraft that are no longer present
      const activeHexes = new Set(aircraft.map(ac => ac.hex));
      Object.keys(updated).forEach(hex => {
        if (!activeHexes.has(hex)) {
          // Keep for a bit after aircraft disappears, then remove
          if (updated[hex].length > 0 && now - updated[hex][updated[hex].length - 1].time > 60000) {
            delete updated[hex];
          }
        }
      });
      
      return updated;
    });
  }, [aircraft, feederLat, feederLon]);

  // Fetch historical positions for short tracks when enabled (debounced, prefer WebSocket)
  useEffect(() => {
    if (!showShortTracks) return;

    const baseUrl = config.apiBaseUrl || '';

    // Debounce the fetch to avoid slamming the API on every aircraft update
    const timeoutId = setTimeout(() => {
      const visibleAircraft = aircraft.filter(ac => ac.hex && ac.lat && ac.lon);

      // Fetch history for aircraft we haven't fetched yet
      const toFetch = visibleAircraft
        .filter(ac => !shortTrackFetchedRef.current.has(ac.hex))
        .slice(0, 10); // Limit concurrent fetches

      if (toFetch.length > 0) {
        toFetch.forEach(async (ac) => {
          shortTrackFetchedRef.current.add(ac.hex);
          try {
            let data;
            if (wsRequest && wsConnected) {
              const result = await wsRequest('sightings', { icao_hex: ac.hex, hours: 1, limit: 50 });
              if (result && result.sightings) {
                data = result;
              } else {
                throw new Error('Invalid sightings response');
              }
            } else {
              const res = await fetch(`${baseUrl}/api/v1/history/sightings/${ac.hex}?hours=1&limit=50`);
              if (res.ok) {
                data = await res.json();
              } else {
                throw new Error('HTTP request failed');
              }
            }
            if (data.sightings && data.sightings.length > 0) {
              // Convert to our format and filter to ~5nm trail (about 30 positions at typical speeds)
              const positions = data.sightings
                .reverse() // API returns newest first, we want oldest first
                .slice(-30) // Keep last 30 positions
                .map(s => ({
                  lat: s.lat,
                  lon: s.lon,
                  time: new Date(s.timestamp).getTime()
                }));

              setShortTrackHistory(prev => ({
                ...prev,
                [ac.hex]: positions
              }));
            }
          } catch (e) {
            // Silently fail - real-time data will still work
          }
        });
      }

      // Cleanup old entries when aircraft disappear (only if needed)
      const activeHexes = new Set(aircraft.map(a => a.hex));
      setShortTrackHistory(prev => {
        const hexesToRemove = Object.keys(prev).filter(hex => !activeHexes.has(hex));
        if (hexesToRemove.length === 0) return prev; // No change needed
        const updated = { ...prev };
        hexesToRemove.forEach(hex => {
          delete updated[hex];
          shortTrackFetchedRef.current.delete(hex);
        });
        return updated;
      });
    }, 2000); // 2 second debounce

    return () => clearTimeout(timeoutId);
  }, [showShortTracks, aircraft, config.apiBaseUrl, wsRequest, wsConnected]);

  // Draw track history canvas when selected aircraft or history changes
  useEffect(() => {
    if (!trackCanvasRef.current || !selectedAircraft || !trackHistory[selectedAircraft.hex]) return;

    const canvas = trackCanvasRef.current;
    const ctx = canvas.getContext('2d');
    const history = trackHistory[selectedAircraft.hex];
    
    ctx.clearRect(0, 0, 280, 80);
    
    if (history.length < 2) return;
    
    // Find bounds
    let minLat = Infinity, maxLat = -Infinity;
    let minLon = Infinity, maxLon = -Infinity;
    history.forEach(p => {
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
  const [canvasAnimFrame, setCanvasAnimFrame] = useState(0);

  // Auto-refresh canvas animation when waiting for data
  useEffect(() => {
    if (!selectedAircraft) return;

    const history = trackHistory[selectedAircraft.hex];
    const needsAnimation = !history || history.length < 2;

    if (needsAnimation) {
      const interval = setInterval(() => {
        setCanvasAnimFrame(f => (f + 1) % 12);
      }, 150);
      return () => clearInterval(interval);
    }
  }, [selectedAircraft, trackHistory]);

  // Helper to draw animated "waiting for data" spinner on canvas
  const drawWaitingSpinner = (ctx, width, height, color = 'rgba(138, 148, 158, 0.4)', frame = 0) => {
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

    const alts = history.map(p => p.alt || 0);
    const validAlts = alts.filter(a => a > 0);

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
      return 60 - pad - (normalized * (60 - pad * 2));
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

    const speeds = history.map(p => p.spd || 0);
    const validSpeeds = speeds.filter(s => s > 0);

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
      return 60 - pad - (normalized * (60 - pad * 2));
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

    const vsValues = history.map(p => p.vs || 0);
    const maxAbsVs = Math.max(Math.abs(Math.min(...vsValues)), Math.abs(Math.max(...vsValues)), 500);

    const getY = (vs) => {
      const normalized = Math.max(-1, Math.min(1, vs / maxAbsVs));
      return centerY - (normalized * halfHeight);
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
    const latestVs = history.length > 0 ? (history[history.length - 1].vs || 0) : 0;
    ctx.strokeStyle = latestVs > 0 ? 'rgba(34, 197, 94, 0.9)' : latestVs < 0 ? 'rgba(249, 115, 22, 0.9)' : 'rgba(138, 148, 158, 0.9)';
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

    const dists = history.map(p => p.dist || 0).filter(d => d > 0);

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
      return 60 - pad - (normalized * (60 - pad * 2));
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

  // Fetch aviation data via WebSocket - uses viewport center for dynamic loading
  // Debounced to avoid timeouts during panning/zooming
  useEffect(() => {
    if (!wsRequest || !wsConnected) return;

    // Don't fetch while actively panning
    if (isProPanning) return;

    // Use viewport center if available, otherwise fall back to feeder location
    const centerLat = viewportCenter.lat ?? feederLat;
    const centerLon = viewportCenter.lon ?? feederLon;

    const extractData = (response) => {
      if (!response) return [];
      if (Array.isArray(response)) return response;
      if (response.data && Array.isArray(response.data)) return response.data;
      if (response.features) {
        return response.features.map(f => ({
          ...f.properties,
          lat: f.geometry?.coordinates?.[1],
          lon: f.geometry?.coordinates?.[0]
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

    const fetchAviationData = async () => {
      const baseParams = { lat: centerLat, lon: centerLon };

      try {
        // Fetch all data in parallel via WebSocket requests
        const promises = [];

        // NAVAIDs
        promises.push(
          wsRequest('navaids', { ...baseParams, radius: Math.round(radarRange * 1.5) })
            .then(data => ({ type: 'navaids', data: extractData(data) }))
            .catch(err => ({ type: 'navaids', error: err.message }))
        );

        // Airports
        promises.push(
          wsRequest('airports', { ...baseParams, radius: Math.round(radarRange * 1.2), limit: 50 })
            .then(data => ({ type: 'airports', data: extractData(data).map(normalizeAirport) }))
            .catch(err => ({ type: 'airports', error: err.message }))
        );

        // Airspace (if enabled)
        if (overlays.airspace) {
          // G-AIRMET advisories
          promises.push(
            wsRequest('airspaces', baseParams)
              .then(data => {
                const advisories = (data?.advisories || extractData(data)).map(adv => ({
                  ...adv,
                  isAdvisory: true,
                  type: adv.type || 'GAIRMET',
                }));
                return { type: 'airspaces', data: advisories };
              })
              .catch(err => ({ type: 'airspaces', error: err.message }))
          );

          // Static boundaries
          promises.push(
            wsRequest('airspace-boundaries', { ...baseParams, radius: Math.round(radarRange * 1.5) })
              .then(data => {
                // Response has { boundaries: [...], count, source, ... }
                const rawBoundaries = data?.boundaries || extractData(data);
                const boundaries = rawBoundaries.map(b => ({
                  ...b,
                  isBoundary: true,
                  type: b.class ? `CLASS_${b.class}` : b.type,
                }));
                return { type: 'boundaries', data: boundaries };
              })
              .catch(err => ({ type: 'boundaries', error: err.message }))
          );
        }

        // METARs (if enabled)
        if (overlays.metars) {
          promises.push(
            wsRequest('metars', { ...baseParams, radius: Math.round(radarRange) })
              .then(data => ({ type: 'metars', data: extractData(data) }))
              .catch(err => ({ type: 'metars', error: err.message }))
          );
        }

        // PIREPs (if enabled)
        if (overlays.pireps) {
          promises.push(
            wsRequest('pireps', { ...baseParams, radius: Math.round(radarRange * 1.5), hours: 3 })
              .then(data => ({ type: 'pireps', data: extractData(data) }))
              .catch(err => ({ type: 'pireps', error: err.message }))
          );
        }

        const results = await Promise.all(promises);

        // Update state with results
        setAviationData(prev => {
          const updated = { ...prev };
          results.forEach(result => {
            if (!result.error && result.data) {
              updated[result.type] = result.data;
            }
          });
          return updated;
        });

        const errors = results.filter(r => r.error);
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
  }, [wsRequest, wsConnected, viewportCenter.lat, viewportCenter.lon, feederLat, feederLon, radarRange, overlays.metars, overlays.pireps, overlays.airspace, isProPanning]);

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
        const isNearViewport = coords.some(([lon, lat]) =>
          lat >= minLat - 2 && lat <= maxLat + 2 &&
          lon >= minLon - 2 && lon <= maxLon + 2
        );
        if (isNearViewport) {
          features.push({ type, coords });
        }
      };

      geojson.features?.forEach(feature => {
        const geomType = feature.geometry?.type;
        const coords = feature.geometry?.coordinates;
        if (!coords) return;

        if (geomType === 'Polygon') {
          coords.forEach(ring => processCoords(ring, 'polygon'));
        } else if (geomType === 'MultiPolygon') {
          coords.forEach(poly => poly.forEach(ring => processCoords(ring, 'polygon')));
        } else if (geomType === 'LineString') {
          processCoords(coords, 'line');
        } else if (geomType === 'MultiLineString') {
          coords.forEach(line => processCoords(line, 'line'));
        }
      });
      return features;
    };

    const degPerNm = 1/60;
    const lonScale = Math.cos(feederLat * Math.PI / 180);
    const filterBounds = {
      minLat: feederLat - radarRange * degPerNm * 2,
      maxLat: feederLat + radarRange * degPerNm * 2,
      minLon: feederLon - (radarRange * degPerNm * 2) / lonScale,
      maxLon: feederLon + (radarRange * degPerNm * 2) / lonScale,
    };

    const dataUrls = {
      countries: 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson',
      states: 'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json',
      counties: 'https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json',
      // Water - 50m resolution lakes and rivers
      lakes: 'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/50m/physical/ne_50m_lakes.json',
      rivers: 'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/50m/physical/ne_50m_rivers_lake_centerlines.json',
    };

    const fetchTerrain = async (type, url) => {
      try {
        console.log(`Fetching ${type} terrain data from:`, url);
        const resp = await fetch(url);
        if (!resp.ok) {
          console.warn(`Failed to fetch ${type}: ${resp.status}`);
          return [];
        }
        const geojson = await resp.json();
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
        setTerrainData(prev => ({ ...prev, ...updates }));
      }
    };

    loadTerrainData();
  }, [config.mapMode, overlays.water, overlays.counties, overlays.states, overlays.countries, feederLat, feederLon, radarRange, terrainData.countries, terrainData.states, terrainData.water, terrainData.counties]);

  const sortedAircraft = useMemo(() => {
    let filtered = [...aircraft].filter(a => a.lat && a.lon);

    // Build set of aircraft with safety events for safetyEventsOnly filter
    const safetyHexes = new Set();
    if (trafficFilters.safetyEventsOnly) {
      safetyEvents.forEach(event => {
        if (event.icao) safetyHexes.add(event.icao.toUpperCase());
        if (event.icao_2) safetyHexes.add(event.icao_2.toUpperCase());
      });
    }

    // Apply traffic filters
    filtered = filtered.filter(ac => {
      // Safety events only filter
      if (trafficFilters.safetyEventsOnly) {
        if (!safetyHexes.has(ac.hex?.toUpperCase())) return false;
      }

      // Military/Civil filter
      if (ac.military && !trafficFilters.showMilitary) return false;
      if (!ac.military && !trafficFilters.showCivil) return false;

      // Ground/Airborne filter
      const isGround = ac.alt_baro === 'ground' || ac.on_ground || (typeof ac.alt === 'number' && ac.alt < 100);
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
      filtered = filtered.filter(ac => {
        const callsign = (ac.flight || '').toLowerCase().trim();
        const hex = (ac.hex || '').toLowerCase();
        const squawk = (ac.squawk || '').toLowerCase();
        const tail = getTailInfo(ac.hex, ac.flight).tailNumber?.toLowerCase() || '';
        return callsign.includes(query) || 
               hex.includes(query) || 
               squawk.includes(query) || 
               tail.includes(query);
      });
    }
    
    return filtered.sort((a, b) => (a.distance_nm || 999) - (b.distance_nm || 999));
  }, [aircraft, searchQuery, trafficFilters, safetyEvents]);

  // Live aircraft data for selected aircraft (updates in real-time)
  const liveAircraft = useMemo(() => {
    if (!selectedAircraft) return null;
    return sortedAircraft.find(a => a.hex === selectedAircraft.hex) || selectedAircraft;
  }, [selectedAircraft, sortedAircraft]);

  // Calculate bounds for simple radar mode (include feeder location)
  const bounds = useMemo(() => {
    const allLats = [...sortedAircraft.map(a => a.lat), feederLat];
    const allLons = [...sortedAircraft.map(a => a.lon), feederLon];
    
    if (sortedAircraft.length === 0) {
      return {
        minLat: feederLat - 1,
        maxLat: feederLat + 1,
        minLon: feederLon - 1.5,
        maxLon: feederLon + 1.5
      };
    }
    
    const latPad = Math.max(0.3, (Math.max(...allLats) - Math.min(...allLats)) * 0.15);
    const lonPad = Math.max(0.4, (Math.max(...allLons) - Math.min(...allLons)) * 0.15);
    
    return {
      minLat: Math.min(...allLats) - latPad,
      maxLat: Math.max(...allLats) + latPad,
      minLon: Math.min(...allLons) - lonPad,
      maxLon: Math.max(...allLons) + lonPad
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
    const lonNm = dLon * 60 * Math.cos(feederLat * Math.PI / 180);
    return Math.sqrt(latNm * latNm + lonNm * lonNm);
  };

  // Calculate bearing from feeder
  const getBearing = (lat, lon) => {
    const dLat = lat - feederLat;
    const dLon = lon - feederLon;
    const latNm = dLat * 60;
    const lonNm = dLon * 60 * Math.cos(feederLat * Math.PI / 180);
    return (Math.atan2(lonNm, latNm) * 180 / Math.PI + 360) % 360;
  };

  // Get color class for speed based on value and altitude (for pro panel)
  const getSpeedColorClass = (speed, altitude) => {
    if (!speed) return '';
    const isBelowTransition = altitude && altitude < 10000;
    const isOverLimit = isBelowTransition && speed > 250;
    if (isOverLimit) return 'speed-violation';
    if (speed > 500) return 'speed-high';
    if (speed > 300) return 'speed-medium';
    return 'speed-normal';
  };

  // Get color class for altitude (for pro panel)
  const getAltitudeColorClass = (altitude) => {
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
  const getSignalStrengthClass = (rssi) => {
    if (rssi > -20) return 'excellent';
    if (rssi > -30) return 'good';
    if (rssi > -40) return 'fair';
    return 'weak';
  };

  // Update aircraft history for trails
  useEffect(() => {
    if (config.mapMode !== 'crt') return;
    
    const now = Date.now();
    sortedAircraft.forEach(ac => {
      if (!ac.hex) return;
      if (!historyRef.current[ac.hex]) {
        historyRef.current[ac.hex] = [];
      }
      const history = historyRef.current[ac.hex];
      // Add position if moved significantly or first position
      if (history.length === 0 || 
          Math.abs(history[history.length - 1].lat - ac.lat) > 0.001 ||
          Math.abs(history[history.length - 1].lon - ac.lon) > 0.001) {
        history.push({ lat: ac.lat, lon: ac.lon, time: now });
      }
      // Keep only last 60 seconds of history (about 6 positions at 10s intervals)
      while (history.length > 0 && now - history[0].time > 60000) {
        history.shift();
      }
    });
    
    // Clean up old aircraft
    const activeHexes = new Set(sortedAircraft.map(a => a.hex));
    Object.keys(historyRef.current).forEach(hex => {
      if (!activeHexes.has(hex)) {
        delete historyRef.current[hex];
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
    window.addEventListener('resize', resize);

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
        setProPanOffset(prev => ({
          x: prev.x * scaleFactor,
          y: prev.y * scaleFactor
        }));
        updateRadarRange(clampedRange);
      }
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });

    // Use fetched aviation data or fallback to static
    const navAids = aviationData.navaids.length > 0 ? aviationData.navaids : [
      { id: 'SEA', name: 'Seattle VORTAC', lat: 47.435, lon: -122.309, type: 'VORTAC' },
      { id: 'PAE', name: 'Paine Field', lat: 47.906, lon: -122.283, type: 'VOR/DME' },
      { id: 'BFI', name: 'Boeing Field', lat: 47.529, lon: -122.302, type: 'VOR/DME' },
      { id: 'TCM', name: 'McChord', lat: 47.136, lon: -122.476, type: 'TACAN' },
      { id: 'OLM', name: 'Olympia', lat: 46.969, lon: -122.902, type: 'VOR/DME' },
      { id: 'EPH', name: 'Ephrata', lat: 47.385, lon: -119.515, type: 'VOR/DME' },
      { id: 'ELN', name: 'Ellensburg', lat: 47.033, lon: -120.530, type: 'VOR/DME' },
      { id: 'YYJ', name: 'Victoria', lat: 48.647, lon: -123.426, type: 'VOR/DME' },
      { id: 'CV', name: 'Coupeville', lat: 48.188, lon: -122.688, type: 'NDB' },
      { id: 'BTG', name: 'Battleground', lat: 45.816, lon: -122.531, type: 'VOR/DME' },
      { id: 'UBG', name: 'Bellingham', lat: 48.795, lon: -122.538, type: 'VOR/DME' },
      { id: 'GEG', name: 'Spokane', lat: 47.625, lon: -117.539, type: 'VORTAC' },
    ];

    const airports = aviationData.airports.length > 0 ? aviationData.airports : [
      { icao: 'KSEA', name: 'Seattle-Tacoma', lat: 47.449, lon: -122.309, class: 'B' },
      { icao: 'KBFI', name: 'Boeing Field', lat: 47.529, lon: -122.302, class: 'D' },
      { icao: 'KPAE', name: 'Paine Field', lat: 47.906, lon: -122.283, class: 'D' },
      { icao: 'KPDX', name: 'Portland Intl', lat: 45.589, lon: -122.597, class: 'C' },
      { icao: 'KGEG', name: 'Spokane', lat: 47.620, lon: -117.534, class: 'C' },
    ];

    // Combine airspace advisories and boundaries from API, or use static fallback
    const airspaceData = (aviationData.airspaces.length > 0 || aviationData.boundaries.length > 0)
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
          ]
        }
      ];

    // Animation loop
    const isPro = config.mapMode === 'pro';
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
        ? Math.max(width, height) * 0.5  // Pro: allow overflow for rectangular
        : Math.min(width, height) * 0.48; // CRT: fill more of the circle

      // Clear with dark background
      ctx.fillStyle = isPro ? '#0a0d12' : '#0a0f0a';
      ctx.fillRect(0, 0, width, height);

      // For Pro mode, calculate scale to show full area (no circular limit)
      // nmPerPixel tells us how many nm one pixel represents
      const nmPerPixel = isPro ? radarRange / (Math.min(width, height) * 0.45) : radarRange / maxRadius;
      
      // Helper to convert lat/lon to screen coordinates
      const latLonToScreen = (lat, lon) => {
        const dLat = lat - feederLat;
        const dLon = lon - feederLon;
        const nmY = dLat * 60; // North is up
        const nmX = dLon * 60 * Math.cos(feederLat * Math.PI / 180);

        if (isPro) {
          // Pro mode: linear mapping, no circular constraint, with pan offset
          const pixelsPerNm = (Math.min(width, height) * 0.45) / radarRange;
          return {
            x: centerX + nmX * pixelsPerNm + proPanOffset.x,
            y: centerY - nmY * pixelsPerNm + proPanOffset.y // Flip Y for screen coords
          };
        } else {
          // CRT mode: polar mapping with circular constraint
          const dist = Math.sqrt(nmX * nmX + nmY * nmY);
          const bearing = Math.atan2(nmX, nmY) * 180 / Math.PI;
          const radius = (dist / radarRange) * maxRadius;
          const rad = (bearing - 90) * Math.PI / 180;
          return {
            x: centerX + Math.cos(rad) * radius,
            y: centerY + Math.sin(rad) * radius
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
        // PRO MODE: Draw lat/lon grid
        const gridColor = 'rgba(40, 80, 120, 0.3)';
        const gridLabelColor = 'rgba(80, 140, 180, 0.7)';
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.font = '12px "JetBrains Mono", monospace';
        ctx.fillStyle = gridLabelColor;
        
        // Calculate grid spacing based on range
        const degPerNm = 1/60;
        let gridSpacingDeg = radarRange <= 30 ? 0.25 : radarRange <= 75 ? 0.5 : radarRange <= 150 ? 1 : 2;
        
        // Latitude lines (horizontal)
        const minGridLat = Math.floor((feederLat - radarRange * degPerNm) / gridSpacingDeg) * gridSpacingDeg;
        const maxGridLat = Math.ceil((feederLat + radarRange * degPerNm) / gridSpacingDeg) * gridSpacingDeg;
        
        for (let lat = minGridLat; lat <= maxGridLat; lat += gridSpacingDeg) {
          const p1 = latLonToScreen(lat, feederLon - radarRange * degPerNm * 1.5);
          const p2 = latLonToScreen(lat, feederLon + radarRange * degPerNm * 1.5);
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
        const lonScale = Math.cos(feederLat * Math.PI / 180);
        const minGridLon = Math.floor((feederLon - radarRange * degPerNm / lonScale) / gridSpacingDeg) * gridSpacingDeg;
        const maxGridLon = Math.ceil((feederLon + radarRange * degPerNm / lonScale) / gridSpacingDeg) * gridSpacingDeg;
        
        for (let lon = minGridLon; lon <= maxGridLon; lon += gridSpacingDeg) {
          const p1 = latLonToScreen(feederLat, lon);
          if (p1.x > 0 && p1.x < width) {
            ctx.beginPath();
            ctx.moveTo(p1.x, 0);
            ctx.lineTo(p1.x, height);
            ctx.stroke();
            ctx.textAlign = 'center';
            ctx.fillText(`${Math.abs(lon).toFixed(2)}°W`, p1.x, height - 8);
          }
        }
        
        // Scale bar
        const scaleBarNm = radarRange <= 30 ? 10 : radarRange <= 75 ? 25 : radarRange <= 150 ? 50 : 100;
        const scaleBarPx = (scaleBarNm / radarRange) * (Math.min(width, height) * 0.45);
        const scaleBarY = height - 20;
        
        // Draw text clearly above the line
        ctx.fillStyle = 'rgba(100, 180, 255, 0.8)';
        ctx.textAlign = 'center';
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.fillText(`${scaleBarNm} nm`, width - 20 - scaleBarPx/2, scaleBarY - 10);
        
        // Draw the scale bar line below text
        ctx.strokeStyle = 'rgba(100, 180, 255, 0.6)';
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
        const proRingDistances = radarRange <= 30 ? [10, 20, 30] : 
                                 radarRange <= 75 ? [25, 50, 75] : 
                                 radarRange <= 150 ? [50, 100, 150] :
                                 [100, 200, 300];
        
        const proPixelsPerNm = (Math.min(width, height) * 0.45) / radarRange;
        ctx.strokeStyle = 'rgba(60, 100, 140, 0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([8, 8]);
        
        proRingDistances.forEach(dist => {
          if (dist > radarRange * 1.2) return;
          const radius = dist * proPixelsPerNm;
          ctx.beginPath();
          ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
          ctx.stroke();
          
          // Range label (top of ring)
          ctx.fillStyle = 'rgba(80, 130, 170, 0.6)';
          ctx.font = '11px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`${dist}nm`, centerX, centerY - radius - 4);
        });
        ctx.setLineDash([]);
        
      } else {
        // CRT MODE: Draw range rings
        const ringDistances = radarRange <= 50 ? [10, 20, 30, 40, 50] : 
                              radarRange <= 100 ? [25, 50, 75, 100] : 
                              [50, 100, 150];
        
        ctx.strokeStyle = 'rgba(0, 180, 80, 0.4)';
        ctx.lineWidth = 1;
        
        ringDistances.forEach(dist => {
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
          { angle: 270, label: 'W' }
        ];
        
        ctx.strokeStyle = 'rgba(0, 180, 80, 0.25)';
        ctx.lineWidth = 1;
        
        compassPoints.forEach(({ angle, label }) => {
          const rad = (angle - 90) * Math.PI / 180;
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
          ctx.fillText(label, centerX + Math.cos(rad) * labelRadius, centerY + Math.sin(rad) * labelRadius);
        });

        // Draw 30-degree lines
        ctx.strokeStyle = 'rgba(0, 180, 80, 0.15)';
        for (let angle = 30; angle < 360; angle += 30) {
          if (angle % 90 === 0) continue;
          const rad = (angle - 90) * Math.PI / 180;
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
          terrainData.water.forEach(feature => {
            if (feature.type === 'polygon') {
              drawBoundaryPath(feature.coords, 'rgba(40, 120, 180, 0.5)', 'rgba(20, 60, 100, 0.25)', 1);
            } else {
              drawBoundaryPath(feature.coords, 'rgba(40, 120, 180, 0.4)', null, 1);
            }
          });
        }

        // Country boundaries - subtle white/gray
        if (overlays.countries && terrainData.countries?.length > 0) {
          terrainData.countries.forEach(feature => {
            drawBoundaryPath(feature.coords, 'rgba(180, 180, 180, 0.5)', null, 1.5);
          });
        }

        // State/province boundaries - lighter
        if (overlays.states && terrainData.states?.length > 0) {
          terrainData.states.forEach(feature => {
            drawBoundaryPath(feature.coords, 'rgba(120, 160, 200, 0.4)', null, 1);
          });
        }

        // County boundaries - very subtle
        if (overlays.counties && terrainData.counties?.length > 0) {
          terrainData.counties.forEach(feature => {
            drawBoundaryPath(feature.coords, 'rgba(100, 130, 160, 0.25)', null, 0.5);
          });
        }
      }

      // Draw VORs and Navaids (if overlay enabled)
      if (overlays.vors) {
        navAids.forEach(nav => {
          const dist = getDistanceNm(nav.lat, nav.lon);
          if (!isPro && dist > radarRange * 1.1) return;
          if (isPro && dist > radarRange * 1.5) return;
          
          const pos = latLonToScreen(nav.lat, nav.lon);
          const x = pos.x;
          const y = pos.y;
          
          // Skip if outside canvas
          if (x < 0 || x > width || y < 0 || y > height) return;
          
          // Check if selected
          const isSelected = selectedNavaid && 
            selectedNavaid.lat === nav.lat && 
            selectedNavaid.lon === nav.lon;
          
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
            ctx.strokeStyle = isPro ? `rgba(80, 140, 220, ${baseColor + 0.1})` : `rgba(100, 150, 255, ${baseColor})`;
            ctx.lineWidth = isSelected ? 2 : 1.5;
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
              const angle = (i * 60 - 30) * Math.PI / 180;
              const px = Math.cos(angle) * vorSize;
              const py = Math.sin(angle) * vorSize;
              if (i === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.stroke();
            
            // Center dot
            ctx.fillStyle = isPro ? `rgba(80, 140, 220, ${baseColor + 0.2})` : `rgba(100, 150, 255, ${baseColor + 0.1})`;
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
          ctx.font = isSelected ? 'bold 12px "JetBrains Mono", monospace' : '12px "JetBrains Mono", monospace';
          const navLabelWidth = ctx.measureText(nav.id).width + 6;
          ctx.fillStyle = isPro ? 'rgba(10, 13, 18, 0.8)' : 'rgba(10, 15, 10, 0.75)';
          ctx.fillRect(x + 7, y - 6, navLabelWidth, 16);
          ctx.fillStyle = isPro ? `rgba(80, 140, 220, ${baseColor + 0.1})` : `rgba(100, 150, 255, ${baseColor})`;
          ctx.textAlign = 'left';
          ctx.fillText(nav.id, x + 10, y + 4);
        });
      }

      // Draw airports (if overlay enabled)
      if (overlays.airports) {
        airports.forEach(apt => {
          const dist = getDistanceNm(apt.lat, apt.lon);
          if (!isPro && dist > radarRange * 1.1) return;
          if (isPro && dist > radarRange * 1.5) return;
          
          const pos = latLonToScreen(apt.lat, apt.lon);
          const x = pos.x;
          const y = pos.y;
          
          if (x < 0 || x > width || y < 0 || y > height) return;
          
          // Check if selected
          const isSelected = selectedAirport && 
            selectedAirport.lat === apt.lat && 
            selectedAirport.lon === apt.lon;
          
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
          if (aptClass === 'B') color = 'rgba(100, 150, 255, 0.7)';
          else if (aptClass === 'C') color = 'rgba(200, 100, 200, 0.7)';
          else if (aptClass === 'D') color = 'rgba(100, 200, 100, 0.7)';
          
          // Brighten if selected
          if (isSelected) {
            color = color.replace(/[\d.]+\)$/, '1)');
          }
          
          ctx.strokeStyle = color;
          ctx.lineWidth = isSelected ? 1.5 : 1;
          
          // Draw runway symbol (circle with lines)
          ctx.beginPath();
          ctx.arc(0, 0, isSelected ? 5 : 4, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(isSelected ? -10 : -8, 0);
          ctx.lineTo(isSelected ? 10 : 8, 0);
          ctx.stroke();
          
          ctx.restore();
          
          // Label with background
          const aptId = apt.icao || apt.icaoId || apt.faaId || apt.id || 'APT';
          ctx.font = isSelected ? 'bold 11px "JetBrains Mono", monospace' : '11px "JetBrains Mono", monospace';
          const aptLabelWidth = ctx.measureText(aptId).width + 6;
          ctx.fillStyle = isPro ? 'rgba(10, 13, 18, 0.8)' : 'rgba(10, 15, 10, 0.75)';
          ctx.fillRect(x + 7, y - 6, aptLabelWidth, 15);
          ctx.fillStyle = color;
          ctx.textAlign = 'left';
          ctx.fillText(aptId, x + 10, y + 4);
        });
      }

      // Draw airspace (if overlay enabled)
      if (overlays.airspace) {
        // Helper to get airspace color based on type/class
        const getAirspaceColor = (as) => {
          const asClass = as.class || as.type?.replace('CLASS_', '');
          if (asClass === 'B' || as.type === 'CLASS_B') return 'rgba(80, 120, 200, 0.35)';
          if (asClass === 'C' || as.type === 'CLASS_C') return 'rgba(180, 80, 180, 0.35)';
          if (asClass === 'D' || as.type === 'CLASS_D') return 'rgba(80, 180, 180, 0.35)';
          if (as.type === 'RESTRICTED' || as.type === 'R') return 'rgba(200, 80, 80, 0.4)';
          if (as.type === 'MOA') return 'rgba(200, 150, 80, 0.3)';
          if (as.type === 'TFR') return 'rgba(255, 80, 80, 0.5)';
          return 'rgba(100, 100, 200, 0.3)';
        };

        airspaceData.forEach(as => {
          const asColor = getAirspaceColor(as);

          // Draw polygon boundaries (from API)
          if (as.polygon && Array.isArray(as.polygon) && as.polygon.length >= 3) {
            ctx.strokeStyle = asColor;
            ctx.fillStyle = asColor.replace(/[\d.]+\)$/, '0.1)'); // Lighter fill
            ctx.lineWidth = isPro ? 2 : 1.5;
            ctx.setLineDash([8, 4]);

            ctx.beginPath();
            as.polygon.forEach((coord, idx) => {
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

            // Draw label at center
            if (as.name) {
              const asCenter = as.center || { lat: as.lat, lon: as.lon };
              if (asCenter?.lat && asCenter?.lon) {
                const labelPos = latLonToScreen(asCenter.lat, asCenter.lon);
                ctx.fillStyle = asColor.replace(/[\d.]+\)$/, '0.8)');
                ctx.font = isPro ? 'bold 12px "JetBrains Mono", monospace' : '11px "JetBrains Mono", monospace';
                ctx.textAlign = 'center';
                ctx.fillText(as.name, labelPos.x, labelPos.y);
                if (as.floor_ft !== undefined && as.ceiling_ft !== undefined) {
                  ctx.font = isPro ? '10px "JetBrains Mono", monospace' : '9px "JetBrains Mono", monospace';
                  ctx.fillText(`${as.floor_ft}-${as.ceiling_ft}ft`, labelPos.x, labelPos.y + 12);
                }
              }
            }
          }
          // Draw circular rings (fallback for simple boundaries)
          else if (as.rings) {
            const asCenter = as.center || { lat: as.lat, lon: as.lon };
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
          else if (as.radius_nm && as.center) {
            const pos = latLonToScreen(as.center.lat, as.center.lon);
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

      // Draw PIREPs if enabled (Pro mode primarily)
      if (overlays.pireps && aviationData.pireps.length > 0) {
        aviationData.pireps.forEach(pirep => {
          if (!pirep.lat || !pirep.lon) return;
          const pos = latLonToScreen(pirep.lat, pirep.lon);
          if (pos.x < 0 || pos.x > width || pos.y < 0 || pos.y > height) return;
          
          ctx.save();
          ctx.translate(pos.x, pos.y);
          
          // Check if this PIREP is selected
          const isSelected = selectedPirep && 
            selectedPirep.lat === pirep.lat && 
            selectedPirep.lon === pirep.lon;
          
          // Draw selection indicator
          if (isSelected) {
            const selFlash = Math.floor(frameCount / 10) % 2 === 0;
            const selAlpha = selFlash ? 0.9 : 0.4;
            const selSize = selFlash ? 18 : 16;
            
            ctx.strokeStyle = `rgba(100, 220, 255, ${selAlpha})`;
            ctx.lineWidth = 2;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.arc(0, 0, selSize, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Corner brackets
            const bSize = 12;
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
          let color, fillColor;
          switch (pirepType) {
            case 'urgent':
              color = 'rgba(255, 50, 50, 0.9)';  // Red for urgent
              fillColor = 'rgba(255, 50, 50, 0.3)';
              break;
            case 'turbulence':
              color = 'rgba(255, 150, 50, 0.85)';  // Orange for turbulence
              fillColor = 'rgba(255, 150, 50, 0.25)';
              break;
            case 'icing':
              color = 'rgba(100, 180, 255, 0.85)';  // Blue for icing
              fillColor = 'rgba(100, 180, 255, 0.25)';
              break;
            case 'both':
              color = 'rgba(200, 100, 255, 0.85)';  // Purple for both
              fillColor = 'rgba(200, 100, 255, 0.25)';
              break;
            case 'windshear':
              color = 'rgba(255, 100, 200, 0.85)';  // Magenta for wind shear
              fillColor = 'rgba(255, 100, 200, 0.25)';
              break;
            default:
              color = 'rgba(255, 220, 100, 0.7)';  // Yellow for routine
              fillColor = 'rgba(255, 220, 100, 0.15)';
          }
          
          // Make selected PIREPs brighter
          if (isSelected) {
            color = color.replace(/0\.\d+\)/, '1)');
          }
          
          // Draw diamond symbol
          ctx.strokeStyle = color;
          ctx.lineWidth = isSelected ? 2.5 : 1.5;
          ctx.beginPath();
          ctx.moveTo(0, -7);
          ctx.lineTo(6, 0);
          ctx.lineTo(0, 7);
          ctx.lineTo(-6, 0);
          ctx.closePath();
          ctx.stroke();
          
          // Fill based on type (always fill slightly, more if selected)
          ctx.fillStyle = isSelected ? color.replace(/[\d.]+\)$/, '0.4)') : fillColor;
          ctx.fill();
          
          // Add inner symbol for turb/ice
          if (pirepType === 'turbulence' || pirepType === 'both') {
            // Wavy line for turbulence
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(-3, 0);
            ctx.quadraticCurveTo(-1.5, -2, 0, 0);
            ctx.quadraticCurveTo(1.5, 2, 3, 0);
            ctx.stroke();
          }
          if (pirepType === 'icing') {
            // Snowflake-ish symbol for icing
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, -3);
            ctx.lineTo(0, 3);
            ctx.moveTo(-2.5, -1.5);
            ctx.lineTo(2.5, 1.5);
            ctx.moveTo(-2.5, 1.5);
            ctx.lineTo(2.5, -1.5);
            ctx.stroke();
          }
          if (pirepType === 'windshear') {
            // Arrow-like symbol for wind shear
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(-3, 1);
            ctx.lineTo(0, -2);
            ctx.lineTo(3, 1);
            ctx.stroke();
          }
          
          ctx.restore();
        });
      }

      // Draw METARs if enabled
      if (overlays.metars && aviationData.metars.length > 0) {
        aviationData.metars.forEach(metar => {
          if (!metar.lat || !metar.lon) return;
          const pos = latLonToScreen(metar.lat, metar.lon);
          if (pos.x < 0 || pos.x > width || pos.y < 0 || pos.y > height) return;
          
          // Check if this METAR is selected
          const isSelected = selectedMetar && 
            selectedMetar.lat === metar.lat && 
            selectedMetar.lon === metar.lon;
          
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
            const windDir = (metar.wdir || 0) * Math.PI / 180;
            ctx.strokeStyle = color;
            ctx.lineWidth = isSelected ? 2 : 1.5;
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            ctx.lineTo(pos.x + Math.sin(windDir) * 15, pos.y - Math.cos(windDir) * 15);
            ctx.stroke();
          }
        });
      }

      // Sweep line - CRT mode only
      if (!isPro) {
        sweepAngleRef.current = (sweepAngleRef.current + 1.5) % 360;
        const sweepRad = (sweepAngleRef.current - 90) * Math.PI / 180;
        
        // Draw sweep as gradient arc
        const sweepSpan = 45;
        ctx.save();
        ctx.translate(centerX, centerY);
        
        for (let i = 0; i < sweepSpan; i += 3) {
          const angle1 = (sweepAngleRef.current - i - 90) * Math.PI / 180;
          const angle2 = (sweepAngleRef.current - i - 3 - 90) * Math.PI / 180;
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
      activeConflicts.forEach(event => {
        if (event.icao) conflictAircraft.add(event.icao.toUpperCase());
        if (event.icao_2) conflictAircraft.add(event.icao_2.toUpperCase());
      });

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
        history.forEach((point, i) => {
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

      // Draw short tracks for all aircraft (ATC-style history trails)
      if (showShortTracks && overlays.aircraft) {
        ctx.save();
        ctx.lineWidth = 1.5;

        sortedAircraft.forEach(ac => {
          if (!ac.hex || !ac.lat || !ac.lon) return;

          const dist = ac.distance_nm || getDistanceNm(ac.lat, ac.lon);
          if (!isPro && dist > radarRange) return;
          if (isPro && dist > radarRange * 1.5) return;

          // Combine historical data (from API) with real-time trackHistory
          const historicPositions = shortTrackHistory[ac.hex] || [];
          const realtimePositions = trackHistory[ac.hex] || [];

          // Merge: use historic for old data, realtime for recent
          // Filter to keep only positions that would create ~5nm trail
          const now = Date.now();
          const trackLength = config.shortTrackLength || 15;
          const maxAge = trackLength * 6000; // ~6 seconds per position
          const allPositions = [
            ...historicPositions.filter(p => now - p.time < maxAge),
            ...realtimePositions.filter(p => now - p.time < maxAge)
          ].sort((a, b) => a.time - b.time);

          // Need at least 2 points to draw a line
          if (allPositions.length < 2) return;

          // Keep only last N positions for short trail (configurable)
          const positions = allPositions.slice(-trackLength);

          // Draw trail with fading opacity (older = more transparent)
          const isSelected = selectedAircraft?.hex === ac.hex;
          const baseColor = 'rgba(255, 255, 255,';

          ctx.beginPath();
          let started = false;

          positions.forEach((point, i) => {
            const pos = latLonToScreen(point.lat, point.lon);
            if (pos.x < -50 || pos.x > width + 50 || pos.y < -50 || pos.y > height + 50) return;

            if (!started) {
              ctx.moveTo(pos.x, pos.y);
              started = true;
            } else {
              ctx.lineTo(pos.x, pos.y);
            }
          });

          // Use slightly brighter for selected aircraft
          const opacity = isSelected ? 0.6 : 0.35;
          ctx.strokeStyle = `${baseColor} ${opacity})`;
          ctx.stroke();

          // Draw small dots at each position for ATC-style display
          positions.forEach((point, i) => {
            const pos = latLonToScreen(point.lat, point.lon);
            if (pos.x < -50 || pos.x > width + 50 || pos.y < -50 || pos.y > height + 50) return;

            const dotOpacity = 0.15 + (i / positions.length) * 0.35;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, isPro ? 2 : 1.5, 0, Math.PI * 2);
            ctx.fillStyle = `${baseColor} ${dotOpacity})`;
            ctx.fill();
          });
        });

        ctx.restore();
      }

      // Draw aircraft (if overlay enabled)
      // Sort so aircraft with safety events are drawn last (on top)
      if (overlays.aircraft) {
        const aircraftToDraw = [...sortedAircraft].sort((a, b) => {
          const aHasSafety = conflictAircraft.has(a.hex?.toUpperCase());
          const bHasSafety = conflictAircraft.has(b.hex?.toUpperCase());
          if (aHasSafety && !bHasSafety) return 1;  // a comes after b (drawn on top)
          if (!aHasSafety && bHasSafety) return -1; // b comes after a
          return 0;
        });

        aircraftToDraw.forEach(ac => {
        const dist = ac.distance_nm || getDistanceNm(ac.lat, ac.lon);
        if (!isPro && dist > radarRange) return;
        if (isPro && dist > radarRange * 1.5) return;

        // Use latLonToScreen for positioning
        const pos = latLonToScreen(ac.lat, ac.lon);
        const x = pos.x;
        const y = pos.y;

        // Skip if outside canvas (Pro mode)
        if (isPro && (x < 0 || x > width || y < 0 || y > height)) return;

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
        const safetyEvent = activeConflicts.find(e =>
          e.icao?.toUpperCase() === ac.hex?.toUpperCase() ||
          e.icao_2?.toUpperCase() === ac.hex?.toUpperCase()
        );
        const hasSafetyAlert = !!safetyEvent || isProximityConflict;
        const alertSeverity = safetyEvent?.severity || (isProximityConflict ? 'warning' : null);
        
        // Emergency flash effect
        const flashOn = isEmergency ? (Math.floor(frameCount / 15) % 2 === 0) : true;
        const flashBrightness = flashOn ? 1 : 0.3;
        
        // Proximity conflict flash speed based on severity
        const flashDivisor = alertSeverity === 'critical' ? 4 : alertSeverity === 'warning' ? 8 : 12;
        const proximityFlashOn = hasSafetyAlert ? (Math.floor(frameCount / flashDivisor) % 2 === 0) : false;
        
        // Severity-based colors
        const getSeverityColors = (severity, flashOn) => {
          const intensity = flashOn ? 1 : 0.6;
          switch (severity) {
            case 'critical':
              return {
                primary: `rgba(255, 80, 150, ${intensity})`,
                text: `rgba(255, 120, 180, ${intensity})`,
                ring: `rgba(255, 80, 150, ${flashOn ? 0.9 : 0.5})`,
                ringInner: `rgba(255, 50, 120, ${(flashOn ? 0.9 : 0.5) * 0.6})`
              };
            case 'warning':
              return {
                primary: `rgba(255, 140, 0, ${intensity})`,
                text: `rgba(255, 180, 80, ${intensity})`,
                ring: `rgba(255, 140, 0, ${flashOn ? 0.9 : 0.5})`,
                ringInner: `rgba(255, 100, 0, ${(flashOn ? 0.9 : 0.5) * 0.6})`
              };
            default: // low
              return {
                primary: `rgba(255, 220, 0, ${intensity})`,
                text: `rgba(255, 240, 100, ${intensity})`,
                ring: `rgba(255, 220, 0, ${flashOn ? 0.9 : 0.5})`,
                ringInner: `rgba(255, 180, 0, ${(flashOn ? 0.9 : 0.5) * 0.6})`
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
        } else {
          // Green for civilian
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
        const track = (ac.track || 0) * Math.PI / 180;
        const symSize = isPro ? 10 : 9;
        
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(track);
        
        // Main symbol - filled chevron
        ctx.fillStyle = primaryColor;
        ctx.strokeStyle = primaryColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -symSize);
        ctx.lineTo(-symSize * 0.6, symSize * 0.5);
        ctx.lineTo(0, symSize * 0.2);
        ctx.lineTo(symSize * 0.6, symSize * 0.5);
        ctx.closePath();
        ctx.fill();
        
        // Velocity vector line - shorter, proportional
        if (ac.gs > 50) {
          const vecLen = Math.min(20, ac.gs / 25); // Much shorter vector
          ctx.strokeStyle = isPro ? `rgba(100, 200, 255, 0.6)` : `rgba(0, 220, 255, ${brightness * 0.5})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, -symSize);
          ctx.lineTo(0, -symSize - vecLen);
          ctx.stroke();
        }
        
        ctx.restore();

        // Draw data block (callsign, speed, altitude)
        const callsign = ac.flight?.trim() || ac.hex;
        const speed = ac.gs ? `${Math.round(ac.gs)}` : '---';
        const altitude = ac.alt ? `${Math.round(ac.alt / 100)}` : '---';
        
        // Position data block to avoid overlap
        const blockX = x + 14;
        const blockY = y - 10;
        
        ctx.font = '13px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        
        // Draw background for label readability
        const labelWidth = Math.max(
          ctx.measureText(callsign).width,
          ctx.measureText(`${speed}kts ${altitude}`).width
        ) + 8;
        const labelHeight = 32;
        ctx.fillStyle = isPro ? 'rgba(10, 13, 18, 0.85)' : 'rgba(10, 15, 10, 0.8)';
        ctx.fillRect(blockX - 4, blockY - 2, labelWidth, labelHeight);

        // ACARS indicator - small green dot at top-right corner if aircraft has ACARS messages
        const hasAcars = acarsMessages.some(msg =>
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

        // Callsign
        ctx.fillStyle = textColor;
        ctx.fillText(callsign, blockX, blockY);
        
        // Speed and altitude on second line
        ctx.fillStyle = isPro ? `rgba(100, 200, 180, 0.85)` : `rgba(0, 200, 100, ${brightness * 0.85})`;
        ctx.font = '12px "JetBrains Mono", monospace';
        ctx.fillText(`${speed}kts ${altitude}`, blockX, blockY + 15);
        
        // Emergency squawk meaning label (Pro mode) - slow fade
        if (isEmergency && isPro) {
          const squawkMeanings = {
            '7500': 'HIJACK',
            '7600': 'RADIO FAIL',
            '7700': 'EMERGENCY'
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
            'tcas_ra': 'TCAS RA',
            'extreme_vs': 'EXTREME V/S',
            'vs_reversal': 'V/S REVERSAL',
            'proximity_conflict': 'PROXIMITY',
            'rapid_descent': 'RAPID DESCENT',
            'rapid_climb': 'RAPID CLIMB',
          };
          const alertLabel = safetyEvent ? 
            (eventNames[safetyEvent.event_type] || safetyEvent.event_type?.replace(/_/g, ' ').toUpperCase() || 'ALERT') :
            'PROXIMITY';
          
          ctx.save();
          ctx.font = 'bold 14px "JetBrains Mono", monospace';
          ctx.textAlign = 'left';
          
          const labelText = `⚠ ${alertLabel}`;
          const textWidth = ctx.measureText(labelText).width;
          
          // Background color based on severity
          const bgColor = alertSeverity === 'critical' ? 'rgba(100, 30, 60, 0.85)' :
                          alertSeverity === 'warning' ? 'rgba(100, 60, 0, 0.85)' :
                          'rgba(100, 80, 0, 0.85)';
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
      }

      // Add scanlines effect - CRT mode only
      if (!isPro) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.03)';
        for (let y = 0; y < height; y += 2) {
          ctx.fillRect(0, y, width, 1);
        }

        // Subtle vignette - CRT mode only
        const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.max(width, height) * 0.7);
        gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0.4)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('wheel', handleWheel);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [config.mapMode, sortedAircraft, radarRange, feederLat, feederLon, selectedAircraft, selectedMetar, selectedPirep, selectedNavaid, selectedAirport, overlays, aviationData, proPanOffset, followingAircraft, trackHistory, showSelectedTrack, safetyEvents, showShortTracks, shortTrackHistory]);

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
        zoomControl: true
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(leafletMapRef.current);
      
      // Add feeder marker
      const feederIcon = L.divIcon({
        className: 'feeder-marker',
        html: `<div style="width: 12px; height: 12px; background: #00ff88; border: 2px solid #004422; border-radius: 50%; box-shadow: 0 0 10px #00ff88;"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6]
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
                zoom: String(mapZoom)
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
  }, [config.mapMode, config.mapDarkMode, feederLat, feederLon]);

  // Leaflet marker updates
  useEffect(() => {
    if (config.mapMode !== 'map' || !leafletMapRef.current) return;
    
    console.log('Updating markers:', sortedAircraft.length, 'aircraft with position');

    const currentHexes = new Set(sortedAircraft.map(a => a.hex));

    Object.keys(markersRef.current).forEach(hex => {
      if (!currentHexes.has(hex)) {
        markersRef.current[hex].remove();
        delete markersRef.current[hex];
      }
    });

    // Build set of aircraft with safety events for z-index priority
    const safetyAircraftHexes = new Set();
    safetyEvents.forEach(event => {
      if (event.icao) safetyAircraftHexes.add(event.icao.toUpperCase());
      if (event.icao_2) safetyAircraftHexes.add(event.icao_2.toUpperCase());
    });

    sortedAircraft.slice(0, 150).forEach(ac => {
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
        iconAnchor: [12, 12]
      });

      // Set higher z-index for aircraft with safety events or emergencies
      const zOffset = hasSafetyEvent ? 2000 : ac.emergency ? 1000 : 0;

      if (markersRef.current[ac.hex]) {
        markersRef.current[ac.hex].setLatLng([ac.lat, ac.lon]);
        markersRef.current[ac.hex].setIcon(icon);
        markersRef.current[ac.hex].setZIndexOffset(zOffset);
      } else {
        const marker = L.marker([ac.lat, ac.lon], { icon, zIndexOffset: zOffset })
          .addTo(leafletMapRef.current)
          .on('click', () => selectAircraft(ac))
          .on('dblclick', () => openAircraftDetail(ac.hex));
        marker.bindTooltip(`${ac.flight || ac.hex}<br>${ac.alt || '?'}ft`, {
          permanent: false,
          direction: 'top'
        });
        markersRef.current[ac.hex] = marker;
      }
    });
  }, [sortedAircraft, config.mapMode, safetyEvents]);

  // Leaflet polyline updates for short tracks in map mode
  useEffect(() => {
    if (config.mapMode !== 'map' || !leafletMapRef.current) return;

    // Remove all polylines if short tracks disabled
    if (!showShortTracks) {
      Object.values(shortTrackPolylinesRef.current).forEach(polyline => polyline.remove());
      shortTrackPolylinesRef.current = {};
      return;
    }

    const currentHexes = new Set(sortedAircraft.map(a => a.hex));
    const now = Date.now();
    const trackLength = config.shortTrackLength || 15;
    const maxAge = trackLength * 6000; // ~6 seconds per position

    // Remove polylines for aircraft no longer present
    Object.keys(shortTrackPolylinesRef.current).forEach(hex => {
      if (!currentHexes.has(hex)) {
        shortTrackPolylinesRef.current[hex].remove();
        delete shortTrackPolylinesRef.current[hex];
      }
    });

    // Update or create polylines for each aircraft
    sortedAircraft.slice(0, 150).forEach(ac => {
      if (!ac.lat || !ac.lon || !ac.hex) return;

      // Combine historical and realtime positions
      const historicPositions = shortTrackHistory[ac.hex] || [];
      const realtimePositions = trackHistory[ac.hex] || [];

      const allPositions = [
        ...historicPositions.filter(p => now - p.time < maxAge),
        ...realtimePositions.filter(p => now - p.time < maxAge)
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

      const latlngs = positions.map(p => [p.lat, p.lon]);
      const color = '#ffffff';

      if (shortTrackPolylinesRef.current[ac.hex]) {
        shortTrackPolylinesRef.current[ac.hex].setLatLngs(latlngs);
      } else {
        const polyline = L.polyline(latlngs, {
          color: color,
          weight: 2,
          opacity: 0.5,
          dashArray: '4, 4'
        }).addTo(leafletMapRef.current);
        shortTrackPolylinesRef.current[ac.hex] = polyline;
      }
    });
  }, [sortedAircraft, config.mapMode, showShortTracks, shortTrackHistory, trackHistory]);

  const cycleMapMode = () => {
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

  // Update URL when traffic filters change
  const updateTrafficFilters = (newFiltersOrUpdater) => {
    setTrafficFilters(prev => {
      const newFilters = typeof newFiltersOrUpdater === 'function'
        ? newFiltersOrUpdater(prev)
        : newFiltersOrUpdater;

      // Update URL with enabled boolean filters and altitude range
      if (setHashParams) {
        const boolKeys = ['showMilitary', 'showCivil', 'showGround', 'showAirborne',
                          'showWithSquawk', 'showWithoutSquawk', 'safetyEventsOnly',
                          'showGA', 'showAirliners'];
        const enabledFilters = boolKeys.filter(key => newFilters[key]).join(',');
        setHashParams({
          filters: enabledFilters || undefined,
          minAlt: newFilters.minAltitude !== 0 ? String(newFilters.minAltitude) : undefined,
          maxAlt: newFilters.maxAltitude !== 60000 ? String(newFilters.maxAltitude) : undefined,
        });
      }

      return newFilters;
    });
  };

  // Update URL when opening aircraft detail (and clear when closing)
  const openAircraftDetail = (hex) => {
    setAircraftDetailHex(hex);
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

  // Get feeder position for simple radar
  const feederPos = getPosition(feederLat, feederLon);

  // Count aircraft in range for CRT mode
  const inRangeCount = sortedAircraft.filter(ac => {
    const dist = ac.distance_nm || getDistanceNm(ac.lat, ac.lon);
    return dist <= radarRange;
  }).length;

  // Get severity color class
  const getSeverityClass = (severity) => {
    switch (severity) {
      case 'critical': return 'severity-critical';
      case 'warning': return 'severity-warning';
      default: return 'severity-low';
    }
  };

  // Get event type display name
  const getEventTypeName = (eventType) => {
    const names = {
      'tcas_ra': 'TCAS RA',
      'extreme_vs': 'EXTREME V/S',
      'vs_reversal': 'V/S REVERSAL',
      'proximity_conflict': 'PROXIMITY',
      'rapid_descent': 'RAPID DESCENT',
      'rapid_climb': 'RAPID CLIMB',
      'squawk_hijack': 'SQUAWK 7500',
      'squawk_radio_failure': 'SQUAWK 7600',
      'squawk_emergency': 'SQUAWK 7700',
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
        'squawk_hijack': 'HIJACK',
        'squawk_radio_failure': 'RADIO FAILURE',
        'squawk_emergency': 'EMERGENCY'
      };
      return (
        <>
          <div className="banner-main-info">
            <span className="banner-squawk-code">{details.squawk || event.squawk}</span>
            <span className="banner-squawk-meaning">{squawkMeanings[eventType] || 'EMERGENCY'}</span>
          </div>
          <div className="banner-aircraft">
            <span className="banner-callsign">{event.callsign || event.icao}</span>
            {details.altitude && <span className="banner-altitude">{details.altitude.toLocaleString()}ft</span>}
          </div>
        </>
      );
    }

    // Proximity conflict - show separation info
    if (eventType === 'proximity_conflict') {
      return (
        <>
          <div className="banner-main-info">
            <span className="banner-separation-horiz">{details.horizontal_nm || details.distance_nm}nm</span>
            <span className="banner-separation-divider">/</span>
            <span className="banner-separation-vert">{details.vertical_ft || details.altitude_diff_ft}ft</span>
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
              {details.previous_vs > 0 ? '+' : ''}{details.previous_vs} → {details.current_vs > 0 ? '+' : ''}{details.current_vs}
            </span>
            <span className="banner-vs-unit">fpm</span>
          </div>
          <div className="banner-aircraft">
            <span className="banner-callsign">{event.callsign || event.icao}</span>
            {details.altitude && <span className="banner-altitude">{details.altitude.toLocaleString()}ft</span>}
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
              {details.previous_vs > 0 ? '+' : ''}{details.previous_vs} → {details.current_vs > 0 ? '+' : ''}{details.current_vs}
            </span>
            <span className="banner-vs-unit">fpm</span>
          </div>
          <div className="banner-aircraft">
            <span className="banner-callsign">{event.callsign || event.icao}</span>
            {details.altitude && <span className="banner-altitude">{details.altitude.toLocaleString()}ft</span>}
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
            <span className="banner-vs-value">{vs > 0 ? '+' : ''}{vs}</span>
            <span className="banner-vs-unit">fpm</span>
          </div>
          <div className="banner-aircraft">
            <span className="banner-callsign">{event.callsign || event.icao}</span>
            {details.altitude && <span className="banner-altitude">{details.altitude.toLocaleString()}ft</span>}
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

  return (
    <div className="map-container" onClick={initAudioContext}>
      {/* Safety Event Banner - Shows highest priority event (only in map/radar mode) */}
      {activeConflicts.length > 0 && config.mapMode !== 'pro' && config.mapMode !== 'crt' && (
        <div className="conflict-banners-container">
          {activeConflicts
            .filter(event => !acknowledgedEvents.has(event.id))
            .slice(0, 1)
            .map((event, idx) => (
            <div
              key={event.id || `conflict-${event.icao}-${idx}`}
              className={`conflict-banner ${getSeverityClass(event.severity)} event-type-${event.event_type}`}
              onClick={() => {
                // Find and select the aircraft
                const ac = aircraft.find(a => a.hex?.toUpperCase() === event.icao?.toUpperCase());
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
                        easeLinearity: 0.25
                      });
                    }
                    // CRT/Radar modes are centered on feeder, no pan available
                  }
                }
              }}
              style={{ cursor: 'pointer' }}
            >
              <AlertTriangle size={28} />
              <div className="conflict-banner-content">
                <strong className="banner-event-type">{getEventTypeName(event.event_type)}</strong>
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
            {sortedAircraft.slice(0, 100).map(ac => {
              const pos = getPosition(ac.lat, ac.lon);
              return (
                <div
                  key={ac.hex}
                  className={`aircraft-blip ${ac.military ? 'military' : ''} ${ac.emergency ? 'emergency' : ''}`}
                  style={{
                    left: `${pos.x}%`,
                    top: `${pos.y}%`,
                    transform: `translate(-50%, -50%) rotate(${ac.track || 0}deg)`
                  }}
                  onClick={() => selectAircraft(ac)}
                  title={`${ac.flight || ac.hex} - ${ac.alt || '?'}ft`}
                >
                  <Plane size={16} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* CRT ATC Radar Mode & Pro Mode - Canvas Based */}
      {(config.mapMode === 'crt' || config.mapMode === 'pro') && (
        <div 
          className={`crt-radar-container ${config.mapMode === 'pro' ? 'pro-mode' : ''}`} 
          ref={containerRef}
          onMouseMove={handleContainerMouseMove}
          onMouseLeave={handleContainerMouseLeave}
        >
          <canvas
            ref={canvasRef}
            className="crt-radar-canvas"
            onMouseDown={handleProPanStart}
            onContextMenu={(e) => e.preventDefault()}
            style={{ cursor: isProPanning ? 'grabbing' : (config.mapMode === 'pro' ? 'grab' : 'default') }}
            onClick={(e) => {
            const rect = canvasRef.current.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const clickY = e.clientY - rect.top;
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            const maxRadius = Math.min(rect.width, rect.height) * 0.45;
            const pixelsPerNm = maxRadius / radarRange;
            
            // Helper to convert lat/lon to screen position
            const getScreenPos = (lat, lon) => {
              const dLat = lat - feederLat;
              const dLon = lon - feederLon;
              const nmY = dLat * 60;
              const nmX = dLon * 60 * Math.cos(feederLat * Math.PI / 180);

              if (config.mapMode === 'pro') {
                return { x: centerX + nmX * pixelsPerNm + proPanOffset.x, y: centerY - nmY * pixelsPerNm + proPanOffset.y };
              } else {
                const dist = Math.sqrt(nmX * nmX + nmY * nmY);
                const bearing = getBearing(lat, lon);
                const radius = (dist / radarRange) * maxRadius;
                const rad = (bearing - 90) * Math.PI / 180;
                return { x: centerX + Math.cos(rad) * radius, y: centerY + Math.sin(rad) * radius };
              }
            };
            
            let closest = null;
            let closestDist = 30;
            let closestType = null; // 'aircraft', 'metar', 'pirep', 'navaid', 'airport'
            
            // Check aircraft (if overlay enabled)
            if (overlays.aircraft) {
              sortedAircraft.forEach(ac => {
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
              aviationData.metars.forEach(metar => {
                if (!metar.lat || !metar.lon) return;
                const pos = getScreenPos(metar.lat, metar.lon);
                if (pos.x < 0 || pos.x > rect.width || pos.y < 0 || pos.y > rect.height) return;
                
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
              aviationData.pireps.forEach(pirep => {
                if (!pirep.lat || !pirep.lon) return;
                const pos = getScreenPos(pirep.lat, pirep.lon);
                if (pos.x < 0 || pos.x > rect.width || pos.y < 0 || pos.y > rect.height) return;
                
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
              const navAidsToCheck = aviationData.navaids.length > 0 ? aviationData.navaids : [
                { id: 'SEA', name: 'Seattle VORTAC', lat: 47.435, lon: -122.309, type: 'VORTAC' },
                { id: 'PAE', name: 'Paine Field', lat: 47.906, lon: -122.283, type: 'VOR/DME' },
                { id: 'BFI', name: 'Boeing Field', lat: 47.529, lon: -122.302, type: 'VOR/DME' },
                { id: 'TCM', name: 'McChord', lat: 47.136, lon: -122.476, type: 'TACAN' },
                { id: 'OLM', name: 'Olympia', lat: 46.969, lon: -122.902, type: 'VOR/DME' },
                { id: 'EPH', name: 'Ephrata', lat: 47.385, lon: -119.515, type: 'VOR/DME' },
                { id: 'ELN', name: 'Ellensburg', lat: 47.033, lon: -120.530, type: 'VOR/DME' },
                { id: 'YYJ', name: 'Victoria', lat: 48.647, lon: -123.426, type: 'VOR/DME' },
                { id: 'CV', name: 'Coupeville', lat: 48.188, lon: -122.688, type: 'NDB' },
                { id: 'BTG', name: 'Battleground', lat: 45.816, lon: -122.531, type: 'VOR/DME' },
                { id: 'UBG', name: 'Bellingham', lat: 48.795, lon: -122.538, type: 'VOR/DME' },
                { id: 'GEG', name: 'Spokane', lat: 47.625, lon: -117.539, type: 'VORTAC' },
              ];
              navAidsToCheck.forEach(nav => {
                if (!nav.lat || !nav.lon) return;
                const pos = getScreenPos(nav.lat, nav.lon);
                if (pos.x < 0 || pos.x > rect.width || pos.y < 0 || pos.y > rect.height) return;
                
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
              const airportsToCheck = aviationData.airports.length > 0 ? aviationData.airports : [
                { icao: 'KSEA', name: 'Seattle-Tacoma', lat: 47.449, lon: -122.309, class: 'B' },
                { icao: 'KBFI', name: 'Boeing Field', lat: 47.529, lon: -122.302, class: 'D' },
                { icao: 'KPAE', name: 'Paine Field', lat: 47.906, lon: -122.283, class: 'D' },
                { icao: 'KPDX', name: 'Portland Intl', lat: 45.589, lon: -122.597, class: 'C' },
                { icao: 'KGEG', name: 'Spokane', lat: 47.620, lon: -117.534, class: 'C' },
              ];
              airportsToCheck.forEach(apt => {
                if (!apt.lat || !apt.lon) return;
                const pos = getScreenPos(apt.lat, apt.lon);
                if (pos.x < 0 || pos.x > rect.width || pos.y < 0 || pos.y > rect.height) return;
                
                const clickDist = Math.sqrt((clickX - pos.x) ** 2 + (clickY - pos.y) ** 2);
                if (clickDist < closestDist) {
                  closestDist = clickDist;
                  closest = apt;
                  closestType = 'airport';
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
              }
            } else {
              // Clicked on empty area - clear all selections (unless panel is pinned)
              if (!panelPinned) {
                selectAircraft(null);
              }
              setSelectedMetar(null);
              setSelectedPirep(null);
              setSelectedNavaid(null);
              setSelectedAirport(null);
            }
          }} onDoubleClick={(e) => {
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
              const nmX = dLon * 60 * Math.cos(feederLat * Math.PI / 180);

              if (config.mapMode === 'pro') {
                return { x: centerX + nmX * pixelsPerNm + proPanOffset.x, y: centerY - nmY * pixelsPerNm + proPanOffset.y };
              } else {
                const dist = Math.sqrt(nmX * nmX + nmY * nmY);
                const bearing = getBearing(lat, lon);
                const radius = (dist / radarRange) * maxRadius;
                const rad = (bearing - 90) * Math.PI / 180;
                return { x: centerX + Math.cos(rad) * radius, y: centerY + Math.sin(rad) * radius };
              }
            };

            let closestAircraft = null;
            let closestDist = 30;

            if (overlays.aircraft) {
              sortedAircraft.forEach(ac => {
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
              openAircraftDetail(closestAircraft.hex);
            }
          }} />
          
          {/* CRT overlay effects (CRT mode only) */}
          {config.mapMode === 'crt' && (
            <div className="crt-effects">
              <div className="crt-scanlines" />
            </div>
          )}
          
          {/* Range control */}
          <div className={`crt-range-control ${config.mapMode === 'pro' ? 'pro-style' : ''} ${showRangeControl ? 'visible' : ''}`}>
            <span className="crt-range-label">RNG</span>
            {[10, 25, 50, 100, 200].map(r => (
              <button
                key={r}
                className={`crt-range-btn ${radarRange === r ? 'active' : ''}`}
                onClick={() => updateRadarRange(r)}
              >
                {r}
              </button>
            ))}
          </div>

          {/* Scope info */}
          <div className={`crt-scope-info ${config.mapMode === 'pro' ? 'pro-style' : ''}`}>
            <div className="crt-info-row">
              <span className="crt-label">TGT</span>
              <span className="crt-value">{inRangeCount}</span>
            </div>
            <div className="crt-info-row">
              <span className="crt-label">RNG</span>
              <span className="crt-value">{radarRange}NM</span>
            </div>
            <div className="crt-info-row">
              <span className="crt-label">CTR</span>
              <span className="crt-value">{feederLat.toFixed(1)}°N</span>
            </div>
            <div className="crt-info-row">
              <span className="crt-label"></span>
              <span className="crt-value">{Math.abs(feederLon).toFixed(1)}°W</span>
            </div>
          </div>
        </div>
      )}

      {/* Leaflet Map Mode */}
      {config.mapMode === 'map' && (
        <div ref={mapRef} className="leaflet-map" />
      )}

      {/* Map Controls */}
      <div className="map-controls">
        {config.mapMode === 'map' && (
          <>
            <button className={`map-control-btn ${config.mapDarkMode ? 'active' : ''}`} onClick={toggleDarkMode}>
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
                  onChange={(e) => setConfig({ ...config, shortTrackLength: parseInt(e.target.value) })}
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
              onClick={() => { setShowFilterMenu(!showFilterMenu); setShowOverlayMenu(false); }}
            >
              <Filter size={16} />
              <span>Filter</span>
            </button>
            <button
              className={`map-control-btn ${showOverlayMenu ? 'active' : ''}`}
              onClick={() => { setShowOverlayMenu(!showOverlayMenu); setShowFilterMenu(false); }}
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
                  onChange={(e) => setConfig({ ...config, shortTrackLength: parseInt(e.target.value) })}
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

      {/* Overlay Menu */}
      {showOverlayMenu && (config.mapMode === 'crt' || config.mapMode === 'pro') && (
        <div className="overlay-menu">
          <div className="overlay-menu-header">
            <span>Map Layers</span>
            <button onClick={() => setShowOverlayMenu(false)}><X size={14} /></button>
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
              checked={overlays.pireps}
              onChange={() => updateOverlays({ ...overlays, pireps: !overlays.pireps })}
            />
            <span className="toggle-label">PIREPs</span>
          </label>
          {config.mapMode === 'pro' && (
            <>
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
            </>
          )}
          <div className="overlay-divider" />
          <button
            className="legend-toggle-btn"
            onClick={() => { setShowLegend(!showLegend); setShowOverlayMenu(false); }}
          >
            <HelpCircle size={14} />
            <span>Symbol Legend</span>
          </button>
          <div className="overlay-note">
            Weather data from aviationweather.gov
          </div>
        </div>
      )}

      {/* Traffic Filter Menu */}
      {showFilterMenu && (config.mapMode === 'crt' || config.mapMode === 'pro') && (
        <div className="overlay-menu filter-menu">
          <div className="overlay-menu-header">
            <span>Traffic Filters</span>
            <button onClick={() => setShowFilterMenu(false)}><X size={14} /></button>
          </div>

          <div className="filter-section">
            <label className="overlay-toggle">
              <input
                type="checkbox"
                checked={trafficFilters.safetyEventsOnly}
                onChange={() => updateTrafficFilters(prev => ({ ...prev, safetyEventsOnly: !prev.safetyEventsOnly }))}
              />
              <span className="toggle-label"><AlertTriangle size={12} /> Safety Events Only</span>
            </label>
          </div>

          <div className="overlay-divider" />

          <div className="filter-section">
            <div className="filter-section-title">Type</div>
            <label className="overlay-toggle">
              <input
                type="checkbox"
                checked={trafficFilters.showMilitary}
                onChange={() => updateTrafficFilters(prev => ({ ...prev, showMilitary: !prev.showMilitary }))}
              />
              <span className="toggle-label"><Shield size={12} /> Military</span>
            </label>
            <label className="overlay-toggle">
              <input
                type="checkbox"
                checked={trafficFilters.showCivil}
                onChange={() => updateTrafficFilters(prev => ({ ...prev, showCivil: !prev.showCivil }))}
              />
              <span className="toggle-label"><Plane size={12} /> Civil</span>
            </label>
          </div>

          <div className="filter-section">
            <div className="filter-section-title">Category</div>
            <label className="overlay-toggle">
              <input
                type="checkbox"
                checked={trafficFilters.showGA}
                onChange={() => updateTrafficFilters(prev => ({ ...prev, showGA: !prev.showGA }))}
              />
              <span className="toggle-label">GA / Light</span>
            </label>
            <label className="overlay-toggle">
              <input
                type="checkbox"
                checked={trafficFilters.showAirliners}
                onChange={() => updateTrafficFilters(prev => ({ ...prev, showAirliners: !prev.showAirliners }))}
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
                onChange={() => updateTrafficFilters(prev => ({ ...prev, showAirborne: !prev.showAirborne }))}
              />
              <span className="toggle-label">Airborne</span>
            </label>
            <label className="overlay-toggle">
              <input 
                type="checkbox" 
                checked={trafficFilters.showGround} 
                onChange={() => updateTrafficFilters(prev => ({ ...prev, showGround: !prev.showGround }))}
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
                onChange={() => updateTrafficFilters(prev => ({ ...prev, showWithSquawk: !prev.showWithSquawk }))}
              />
              <span className="toggle-label">With Squawk</span>
            </label>
            <label className="overlay-toggle">
              <input 
                type="checkbox" 
                checked={trafficFilters.showWithoutSquawk} 
                onChange={() => updateTrafficFilters(prev => ({ ...prev, showWithoutSquawk: !prev.showWithoutSquawk }))}
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
                onChange={(e) => updateTrafficFilters(prev => ({
                  ...prev,
                  minAltitude: Math.max(0, parseInt(e.target.value) || 0)
                }))}
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
                onChange={(e) => updateTrafficFilters(prev => ({
                  ...prev,
                  maxAltitude: Math.min(60000, parseInt(e.target.value) || 60000)
                }))}
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
            onClick={() => updateTrafficFilters({
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
            })}
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
          style={legendPosition.x !== null ? { 
            left: legendPosition.x, 
            top: legendPosition.y,
            right: 'auto',
            bottom: 'auto'
          } : {}}
          onMouseDown={handleLegendMouseDown}
          onTouchStart={(e) => {
            if (e.target.closest('button')) return;
            const touch = e.touches[0];
            setIsLegendDragging(true);
            const rect = e.currentTarget.getBoundingClientRect();
            legendDragStartRef.current = {
              x: touch.clientX,
              y: touch.clientY,
              startX: legendPosition.x ?? rect.left,
              startY: legendPosition.y ?? rect.top
            };
          }}
        >
          <div className="legend-header">
            <span>Symbol Legend</span>
            <div className="legend-header-buttons">
              <button onClick={() => setLegendCollapsed(!legendCollapsed)} title={legendCollapsed ? 'Expand' : 'Collapse'}>
                {legendCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </button>
              <button onClick={() => setShowLegend(false)} title="Close"><X size={14} /></button>
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
          style={aircraftListPosition.x !== null ? { 
            left: aircraftListPosition.x, 
            top: aircraftListPosition.y,
            right: 'auto',
            bottom: 'auto'
          } : {}}
        >
          <div 
            className="aircraft-list-header"
            onMouseDown={handleListMouseDown}
            onTouchStart={(e) => {
              const touch = e.touches[0];
              handleListMouseDown({ clientX: touch.clientX, clientY: touch.clientY, currentTarget: e.currentTarget.parentElement, preventDefault: () => {} });
            }}
          >
            <button 
              className="aircraft-list-toggle"
              onClick={() => setListExpanded(!listExpanded)}
            >
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
                const inRangeAircraft = sortedAircraft.filter(ac => {
                  const dist = ac.distance_nm || 0;
                  return config.mapMode === 'pro' ? dist <= radarRange * 1.5 : dist <= radarRange;
                });
                
                // Sort: emergencies first, then conflicts (from backend), then by distance
                const prioritySorted = [...inRangeAircraft].sort((a, b) => {
                  const aEmergency = a.emergency || ['7500', '7600', '7700'].includes(a.squawk);
                  const bEmergency = b.emergency || ['7500', '7600', '7700'].includes(b.squawk);
                  const aConflict = activeConflicts.some(e =>
                    e.icao?.toUpperCase() === a.hex?.toUpperCase() ||
                    e.icao_2?.toUpperCase() === a.hex?.toUpperCase()
                  );
                  const bConflict = activeConflicts.some(e =>
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
                    {displayAircraft.map(ac => {
                      const tailInfo = getTailInfo(ac.hex, ac.flight);
                      const isEmergency = ac.emergency || ['7500', '7600', '7700'].includes(ac.squawk);
                      const safetyEvent = activeConflicts.find(e =>
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
                          title={safetyEvent ? `${getEventTypeName(safetyEvent.event_type)}: ${safetyEvent.message}` : ''}
                        >
                          <div className="aircraft-list-primary">
                            <span className="aircraft-flag">{tailInfo.flag}</span>
                            <span className="aircraft-callsign">{ac.flight?.trim() || ac.hex}</span>
                            {tailInfo.tailNumber && <span className="aircraft-tail">({tailInfo.tailNumber})</span>}
                            {ac.military && <Shield size={10} className="mil-icon" />}
                            {isEmergency && <AlertTriangle size={10} className="emerg-icon" />}
                            {isConflict && <Zap size={10} className={`conflict-icon ${getSeverityClass(conflictSeverity)}`} />}
                          </div>
                          <div className="aircraft-list-secondary">
                            <span className="aircraft-alt">{ac.alt ? `${(ac.alt/1000).toFixed(1)}k` : '--'}</span>
                            <span className="aircraft-speed">{ac.gs ? `${Math.round(ac.gs)}kt` : '--'}</span>
                            <span className="aircraft-dist">{ac.distance_nm?.toFixed(1) || '--'}nm</span>
                            <button 
                              className="aircraft-detail-link"
                              onClick={(e) => { e.stopPropagation(); openAircraftDetail(ac.hex); }}
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
                          setListDisplayCount(prev => prev + 20);
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
          <div className="legend-item"><span className="dot civilian" /> Civilian ({sortedAircraft.filter(a => !a.military && !a.emergency).length})</div>
          <div className="legend-item"><span className="dot military" /> Military ({sortedAircraft.filter(a => a.military).length})</div>
          <div className="legend-item"><span className="dot emergency" /> Emergency ({sortedAircraft.filter(a => a.emergency).length})</div>
          <div className="legend-item" style={{ borderTop: '1px solid var(--border)', paddingTop: '8px', marginTop: '4px' }}>
            <span style={{ color: 'var(--text-dim)', fontSize: '11px' }}>
              {sortedAircraft.length} with position / {aircraft.length} total
            </span>
          </div>
        </div>
      )}

      {/* Selected Aircraft Popup */}
      {liveAircraft && (() => {
        const isEmergency = liveAircraft.emergency || ['7500', '7600', '7700'].includes(liveAircraft.squawk);
        const squawkMeanings = { '7500': 'HIJACK', '7600': 'RADIO', '7700': 'EMERG' };
        const squawkLabel = squawkMeanings[liveAircraft.squawk];

        // Check if this aircraft has a safety event
        const safetyEvent = activeConflicts.find(e =>
          e.icao?.toUpperCase() === liveAircraft.hex?.toUpperCase() ||
          e.icao_2?.toUpperCase() === liveAircraft.hex?.toUpperCase()
        );

        const isConflict = !!safetyEvent;
        const conflictSeverity = safetyEvent?.severity || null;
        const conflictTitle = safetyEvent ? getEventTypeName(safetyEvent.event_type) : null;

        // Get the other aircraft in a two-aircraft conflict from safety event
        const otherAircraftHex = safetyEvent?.icao_2
          ? (safetyEvent.icao?.toUpperCase() === liveAircraft.hex?.toUpperCase()
              ? safetyEvent.icao_2
              : safetyEvent.icao)
          : null;
        const otherAircraft = otherAircraftHex
          ? aircraft.find(ac => ac.hex?.toUpperCase() === otherAircraftHex?.toUpperCase())
          : null;

        // Build conflictInfo for display
        const conflictInfo = safetyEvent?.icao_2 ? {
          hex1: safetyEvent.icao,
          hex2: safetyEvent.icao_2,
          horizontalNm: safetyEvent.horizontalNm || safetyEvent.details?.horizontal_nm?.toFixed(1) || '--',
          verticalFt: safetyEvent.verticalFt || safetyEvent.details?.altitude_diff_ft || '--'
        } : null;
        
        // Vertical rate arrows - chevron style like ATC displays
        const vr = liveAircraft.vr || 0;
        const absVr = Math.abs(vr);
        const vrArrows = absVr > 2000 ? 3 : absVr > 1000 ? 2 : absVr > 300 ? 1 : 0;
        // Use chevron characters that look like the image
        const vrChevron = vr > 0 ? '▲' : vr < 0 ? '▼' : '';
        
        // Other aircraft vertical rate
        const otherVr = otherAircraft?.vr || 0;
        const otherAbsVr = Math.abs(otherVr);
        const otherVrArrows = otherAbsVr > 2000 ? 3 : otherAbsVr > 1000 ? 2 : otherAbsVr > 300 ? 1 : 0;
        const otherVrChevron = otherVr > 0 ? '▲' : otherVr < 0 ? '▼' : '';
        
        return (
        <div 
          className={`aircraft-popup-container ${isConflict ? 'with-conflict' : ''}`}
          style={{ left: popupPosition.x, top: popupPosition.y }}
        >
          {/* Main Aircraft Panel */}
          <div 
            className={`aircraft-popup ${config.mapMode === 'crt' ? 'crt-popup' : ''} ${config.mapMode === 'pro' ? 'pro-popup' : ''} ${isEmergency ? 'emergency-popup' : ''} ${isConflict ? `conflict-popup ${getSeverityClass(conflictSeverity)}` : ''} ${isDragging ? 'dragging' : ''}`}
            onMouseDown={handlePopupMouseDown}
          >
            <button className="popup-close" onClick={() => selectAircraft(null)}>
              <X size={16} />
            </button>
            <div className={`popup-header ${isEmergency ? 'emergency-header' : ''} ${isConflict ? `conflict-header ${getSeverityClass(conflictSeverity)}` : ''}`}>
              <Plane size={20} />
              <span className="popup-callsign">{liveAircraft.flight || liveAircraft.hex}</span>
              {isConflict && <span className={`popup-conflict-tag ${getSeverityClass(conflictSeverity)}`}>⚠️ {conflictTitle}</span>}
              {isEmergency && squawkLabel && <span className="popup-squawk-tag">{squawkLabel}</span>}
              {liveAircraft.military && <Shield size={14} className="military-badge" />}
            </div>
          
            <div className="popup-details">
              <div className="detail-row"><span>ICAO</span><span>{liveAircraft.hex}</span></div>
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
            <div className="detail-row"><span>Type</span><span>{liveAircraft.type || '--'}</span></div>
            <div className="detail-row"><span>Altitude</span><span>{liveAircraft.alt?.toLocaleString() || '--'} ft</span></div>
            <div className="detail-row"><span>Speed</span><span>{liveAircraft.gs?.toFixed(0) || '--'} kts</span></div>
            <div className="detail-row"><span>Distance</span><span>{liveAircraft.distance_nm?.toFixed(1) || '--'} nm</span></div>
            <div className="detail-row"><span>Track</span><span>{liveAircraft.track?.toFixed(0) || '--'}°</span></div>
            <div className="detail-row">
              <span>V/S</span>
              <span className={`vs-value ${vr > 0 ? 'climbing' : vr < 0 ? 'descending' : ''}`}>
                {vrArrows > 0 && (
                  <span className={`vs-chevrons chevrons-${vrArrows}`}>
                    {Array(vrArrows).fill(vrChevron).map((c, i) => (
                      <span key={i} className="vs-chevron">{c}</span>
                    ))}
                  </span>
                )}
                {liveAircraft.vr || '--'} fpm
              </span>
            </div>
            <div className="detail-row">
              <span>Squawk</span>
              <span className={liveAircraft.squawk?.match(/^7[567]00$/) ? 'emergency-squawk' : ''}>
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
                    easeLinearity: 0.25
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
              onClick={() => openAircraftDetail(liveAircraft.hex)}
            >
              <ExternalLink size={14} />
              Full Details
            </button>
          </div>

          {/* Create Alert Button */}
          <button
            className="popup-create-alert"
            onClick={() => {
              // Store selected aircraft for alert creation
              window.dispatchEvent(new CustomEvent('createAlertFromAircraft', {
                detail: liveAircraft
              }));
              selectAircraft(null);
            }}
          >
            <Bell size={14} />
            Create Alert for this Aircraft
          </button>
        </div>
        
        {/* Conflict Side Panel - Shows other aircraft */}
        {isConflict && otherAircraft && (
          <div className={`conflict-side-panel ${config.mapMode === 'pro' ? 'pro-style' : ''} ${getSeverityClass(conflictSeverity)}`}>
            <div className={`conflict-separation-header ${getSeverityClass(conflictSeverity)}`}>
              <AlertTriangle size={16} />
              <span>{conflictTitle}</span>
            </div>
            <div className="conflict-separation-info">
              <div className="separation-value">{conflictInfo?.horizontalNm || '--'}<span>nm</span></div>
              <div className="separation-value">{conflictInfo?.verticalFt || '--'}<span>ft</span></div>
            </div>
            {safetyEvent && (
              <div
                className="conflict-message-row clickable"
                onClick={() => onViewHistoryEvent?.(safetyEvent.id)}
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
                <span className={`vs-value ${otherVr > 0 ? 'climbing' : otherVr < 0 ? 'descending' : ''}`}>
                  {otherVrArrows > 0 && (
                    <span className={`vs-chevrons chevrons-${otherVrArrows}`}>
                      {Array(otherVrArrows).fill(otherVrChevron).join('')}
                    </span>
                  )}
                  {' '}{otherAircraft.vr || '--'}
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
      {selectedMetar && (() => {
        const decoded = decodeMetar(selectedMetar);
        return (
        <div 
          className={`weather-popup ${config.mapMode === 'pro' ? 'pro-popup' : 'crt-popup'} ${isDragging ? 'dragging' : ''}`}
          style={{ left: popupPosition.x, top: popupPosition.y }}
          onMouseDown={handlePopupMouseDown}
        >
          <button className="popup-close" onClick={() => setSelectedMetar(null)}>
            <X size={16} />
          </button>
          <div className="popup-header">
            <MapPin size={20} />
            <span className="popup-callsign">{selectedMetar.stationId || selectedMetar.icaoId || 'METAR'}</span>
            <span className={`flt-cat-badge ${(selectedMetar.fltCat || 'VFR').toLowerCase()}`}>
              {selectedMetar.fltCat || 'VFR'}
            </span>
          </div>
          <div className="popup-details">
            {selectedMetar.name && (
              <div className="detail-row"><span>Name</span><span>{selectedMetar.name}</span></div>
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
                  <strong>{decoded.temperature.celsius}°C / {decoded.temperature.fahrenheit}°F</strong>
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
                <span className="section-icon"><Navigation size={14} /> Wind</span>
                <div className="decoded-value">
                  <strong>{windDirToCardinal(decoded.wind.direction)} {decoded.wind.text}</strong>
                  <span className="decoded-desc">{decoded.wind.description}</span>
                </div>
              </div>
            )}
            
            {/* Visibility with description */}
            {decoded?.visibility && (
              <div className="detail-row decoded-section">
                <span>Visibility</span>
                <div className="decoded-value">
                  <strong>{decoded.visibility.value} {decoded.visibility.unit}</strong>
                  <span className="decoded-desc">{decoded.visibility.description}</span>
                </div>
              </div>
            )}
            
            {/* Altimeter with description */}
            {decoded?.altimeter && (
              <div className="detail-row decoded-section">
                <span>Altimeter</span>
                <div className="decoded-value">
                  <strong>{decoded.altimeter.inhg}" Hg</strong>
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
                      <strong>{c.cover} @ {c.baseDesc}</strong>
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

      {/* PIREP Popup */}
      {selectedPirep && (() => {
        const decoded = decodePirep(selectedPirep);
        return (
        <div 
          className={`weather-popup pirep-popup ${config.mapMode === 'pro' ? 'pro-popup' : 'crt-popup'} ${decoded?.type === 'UUA' ? 'urgent-pirep' : ''} ${isDragging ? 'dragging' : ''}`}
          style={{ left: popupPosition.x, top: popupPosition.y }}
          onMouseDown={handlePopupMouseDown}
        >
          <button className="popup-close" onClick={() => setSelectedPirep(null)}>
            <X size={16} />
          </button>
          <div className="popup-header">
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
              <div className={`detail-row decoded-section turb-section level-${decoded.turbulence.level}`}>
                <span className="section-icon"><Wind size={14} /> Turbulence</span>
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
              <div className={`detail-row decoded-section icing-section level-${decoded.icing.level}`}>
                <span className="section-icon"><Snowflake size={14} /> Icing</span>
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
              <div className={`detail-row decoded-section ws-section level-${decoded.windshear.level}`}>
                <span className="section-icon"><Wind size={14} /> Wind Shear</span>
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
                <span className="section-icon"><Thermometer size={14} /> Temp</span>
                <div className="decoded-value">
                  <strong>{decoded.temperature.celsius}°C / {decoded.temperature.fahrenheit}°F</strong>
                  {decoded.temperature.isaDeviation !== null && (
                    <span className="decoded-desc">
                      ISA deviation: {decoded.temperature.isaDeviation > 0 ? '+' : ''}{decoded.temperature.isaDeviation}°C
                    </span>
                  )}
                </div>
              </div>
            )}
            
            {/* Wind at altitude */}
            {decoded?.wind && (
              <div className="detail-row">
                <span className="section-icon"><Navigation size={14} /> Wind</span>
                <span>{windDirToCardinal(decoded.wind.direction)} ({decoded.wind.direction}°) at {decoded.wind.speed}kt</span>
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
          onMouseDown={handlePopupMouseDown}
        >
          <button className="popup-close" onClick={() => setSelectedNavaid(null)}>
            <X size={16} />
          </button>
          <div className="popup-header">
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
              <span>{selectedNavaid.lat?.toFixed(4)}°, {selectedNavaid.lon?.toFixed(4)}°</span>
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
          onMouseDown={handlePopupMouseDown}
        >
          <button className="popup-close" onClick={() => setSelectedAirport(null)}>
            <X size={16} />
          </button>
          <div className="popup-header">
            <Plane size={20} />
            <span className="popup-callsign">{selectedAirport.icao || selectedAirport.icaoId || selectedAirport.faaId || selectedAirport.id || 'APT'}</span>
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
              <span>{selectedAirport.lat?.toFixed(4)}°, {selectedAirport.lon?.toFixed(4)}°</span>
            </div>
            
            {(selectedAirport.elev !== undefined && selectedAirport.elev !== null) || selectedAirport.elev_ft ? (
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
                <a href={`https://www.airnav.com/airport/${selectedAirport.icao || selectedAirport.icaoId || selectedAirport.faaId || selectedAirport.id}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={12} /> AirNav
                </a>
                <a href={`https://skyvector.com/airport/${selectedAirport.icao || selectedAirport.icaoId || selectedAirport.faaId || selectedAirport.id}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={12} /> SkyVector
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pro Mode Search Bar */}
      {config.mapMode === 'pro' && (
        <div className="pro-search-bar">
          <Search size={18} className="search-icon" />
          <input 
            type="text" 
            placeholder="Search callsign, squawk, or ICAO..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          <div className="pro-header-right">
            <div className="pro-time">
              <Clock size={14} />
              <span>{new Date().toISOString().slice(11, 19)} Z</span>
            </div>
            {acarsStatus && (
              <div className={`acars-status-badge ${acarsStatus.running ? 'running' : 'stopped'}`} title={`ACARS: ${acarsStatus.running ? 'Running' : 'Stopped'}`}>
                <MessageCircle size={12} />
                <span>{acarsStatus.buffer_size || 0}</span>
              </div>
            )}
            <button 
              className={`pro-header-btn ${soundMuted ? 'muted' : ''}`}
              onClick={() => setSoundMuted(!soundMuted)}
              title={soundMuted ? 'Unmute' : 'Mute'}
            >
              {soundMuted ? <VolumeX size={18} /> : <Bell size={18} />}
            </button>
            <button 
              className={`pro-header-btn ${showAcarsPanel ? 'active' : ''}`}
              onClick={() => setShowAcarsPanel(!showAcarsPanel)}
              title="ACARS Messages"
            >
              <MessageCircle size={18} />
            </button>
            <button 
              className={`pro-header-btn ${showFilterMenu ? 'active' : ''}`} 
              onClick={() => { setShowFilterMenu(!showFilterMenu); setShowOverlayMenu(false); }}
              title="Traffic Filters"
            >
              <Filter size={18} />
            </button>
            <button
              className={`pro-header-btn ${showOverlayMenu ? 'active' : ''}`}
              onClick={() => { setShowOverlayMenu(!showOverlayMenu); setShowFilterMenu(false); }}
              title="Map Layers"
            >
              <Layers size={18} />
            </button>
            <button
              className={`pro-header-btn ${showShortTracks ? 'active' : ''}`}
              onClick={() => setShowShortTracks(!showShortTracks)}
              title={showShortTracks ? 'Hide short tracks (ATC trails)' : 'Show short tracks (ATC trails)'}
            >
              <Navigation size={18} />
            </button>
            {showShortTracks && (
              <div className="pro-track-length-slider">
                <input
                  type="range"
                  min="5"
                  max="60"
                  step="5"
                  value={config.shortTrackLength || 15}
                  onChange={(e) => setConfig({ ...config, shortTrackLength: parseInt(e.target.value) })}
                  title={`Trail length: ${config.shortTrackLength || 15} positions`}
                />
                <span className="track-length-value">{config.shortTrackLength || 15}</span>
              </div>
            )}
            <button
              className={`pro-header-btn ${showSelectedTrack ? 'active' : ''}`}
              onClick={() => setShowSelectedTrack(!showSelectedTrack)}
              title={showSelectedTrack ? 'Hide flight track' : 'Show flight track'}
              disabled={!selectedAircraft}
            >
              <Activity size={18} />
            </button>
            <button
              className={`pro-header-btn ${proPanOffset.x !== 0 || proPanOffset.y !== 0 || followingAircraft ? 'active' : ''}`}
              onClick={() => {
                setProPanOffset({ x: 0, y: 0 });
                setFollowingAircraft(null);
                if (setHashParams) {
                  setHashParams({ panX: undefined, panY: undefined });
                }
              }}
              title="Re-center view (middle-click + drag to pan)"
            >
              <Crosshair size={18} />
            </button>
            <button
              className="pro-header-btn"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
          </div>
        </div>
      )}


      {/* Pro Mode Details Panel */}
      {config.mapMode === 'pro' && liveAircraft && (() => {
        // liveAircraft is already memoized above for live updates
        const isEmergency = ['7500', '7600', '7700'].includes(liveAircraft.squawk);
        const emergencyType = liveAircraft.squawk === '7500' ? 'HIJACK' :
                             liveAircraft.squawk === '7600' ? 'RADIO FAILURE' :
                             liveAircraft.squawk === '7700' ? 'EMERGENCY' : null;

        // Check for safety event from backend
        const safetyEvent = activeConflicts.find(e =>
          e.icao?.toUpperCase() === liveAircraft.hex?.toUpperCase() ||
          e.icao_2?.toUpperCase() === liveAircraft.hex?.toUpperCase()
        );

        const isInConflict = !!safetyEvent;
        const conflictSeverity = safetyEvent?.severity || null;
        const conflictTitle = safetyEvent ? getEventTypeName(safetyEvent.event_type) : null;
        
        return (
        <div className={`pro-details-panel ${isEmergency ? 'emergency' : ''} ${isInConflict ? `conflict ${getSeverityClass(conflictSeverity)}` : ''} ${panelPinned ? 'pinned' : ''}`}>
          <div className="pro-panel-title-bar">
            <span className="pro-panel-title">TARGET DETAILS</span>
            <div className="pro-panel-actions">
              <button
                className={`pro-panel-btn ${followingAircraft === liveAircraft.hex ? 'active' : ''}`}
                onClick={() => {
                  if (!liveAircraft.lat || !liveAircraft.lon) return;
                  // Toggle following this aircraft
                  if (followingAircraft === liveAircraft.hex) {
                    setFollowingAircraft(null);
                  } else {
                    setFollowingAircraft(liveAircraft.hex);
                  }
                }}
                title={followingAircraft === liveAircraft.hex ? 'Stop following' : 'Follow aircraft'}
              >
                <Crosshair size={14} />
              </button>
              <button
                className={`pro-panel-btn ${panelPinned ? 'active' : ''}`}
                onClick={() => setPanelPinned(!panelPinned)}
                title={panelPinned ? 'Unpin panel' : 'Pin panel open'}
              >
                {panelPinned ? <PinOff size={14} /> : <Pin size={14} />}
              </button>
              <button
                className="pro-panel-btn"
                onClick={() => openAircraftDetail(liveAircraft.hex)}
                title="View full aircraft details"
              >
                <ExternalLink size={14} />
              </button>
              <button className="pro-panel-close" onClick={() => !panelPinned && selectAircraft(null)}>
                <X size={18} />
              </button>
            </div>
          </div>
          
          {/* Emergency Banner */}
          {isEmergency && (
            <div className={`pro-emergency-banner squawk-${liveAircraft.squawk}`}>
              <AlertTriangle size={18} />
              <span className="emergency-type">{emergencyType}</span>
              <span className="emergency-squawk">SQUAWK {liveAircraft.squawk}</span>
            </div>
          )}

          {/* Safety Event / Conflict Banner */}
          {isInConflict && safetyEvent && (
            <div
              className={`pro-conflict-banner ${getSeverityClass(conflictSeverity)} clickable`}
              onClick={() => onViewHistoryEvent?.(safetyEvent.id)}
              title="View in History"
            >
              <Zap size={18} />
              <div className="conflict-info">
                <span className="conflict-label">{conflictTitle}</span>
                <span className="conflict-message">{safetyEvent.message}</span>
              </div>
              {safetyEvent.hex2 && (
                <div className="conflict-separation">
                  <span>{safetyEvent.horizontalNm}nm</span>
                  <span>{safetyEvent.verticalFt}ft</span>
                </div>
              )}
            </div>
          )}
          
          <div className="pro-panel-header">
            <div className="pro-callsign-row">
              <span className="pro-flag">{getTailInfo(liveAircraft.hex, liveAircraft.flight).flag}</span>
              <h2 className="pro-callsign">{liveAircraft.flight?.trim() || liveAircraft.hex?.toUpperCase()}</h2>
            </div>
            <div className="pro-badges">
              <span className="pro-badge hex">{liveAircraft.hex?.toUpperCase()}</span>
              {(aircraftInfo[liveAircraft.hex]?.type_name || aircraftInfo[liveAircraft.hex]?.model || liveAircraft.type) && (
                <span className={`pro-badge model ${liveAircraft.military ? 'military' : ''}`}>
                  {aircraftInfo[liveAircraft.hex]?.type_name || aircraftInfo[liveAircraft.hex]?.model || liveAircraft.type}
                </span>
              )}
              <span className="pro-badge category" title={liveAircraft.category || 'A3'}>{getCategoryName(liveAircraft.category)}</span>
              {aircraftInfo[liveAircraft.hex]?.registration && (
                <span className="pro-badge reg">{aircraftInfo[liveAircraft.hex].registration}</span>
              )}
              {aircraftInfo[liveAircraft.hex]?.year_built && (
                <span className="pro-badge built">
                  {aircraftInfo[liveAircraft.hex].year_built}
                  {aircraftInfo[liveAircraft.hex].age_years && ` (${aircraftInfo[liveAircraft.hex].age_years}y)`}
                </span>
              )}
              {isEmergency && <span className="pro-badge emergency">EMG</span>}
            </div>
            {/* Quick Alert Actions */}
            <div className="pro-quick-alerts">
              {liveAircraft.flight?.trim() && (
                <button
                  className="pro-alert-btn"
                  onClick={() => {
                    // Add callsign alert - this would integrate with your alerts system
                    console.log('Add alert for callsign:', liveAircraft.flight?.trim());
                    alert(`Alert added for callsign: ${liveAircraft.flight?.trim()}`);
                  }}
                  title={`Add alert for ${liveAircraft.flight?.trim()}`}
                >
                  <BellPlus size={12} />
                  <span>Alert {liveAircraft.flight?.trim()}</span>
                </button>
              )}
              {getTailInfo(liveAircraft.hex, liveAircraft.flight).tailNumber && (
                <button
                  className="pro-alert-btn"
                  onClick={() => {
                    const tail = getTailInfo(liveAircraft.hex, liveAircraft.flight).tailNumber;
                    console.log('Add alert for tail:', tail);
                    alert(`Alert added for tail: ${tail}`);
                  }}
                  title={`Add alert for ${getTailInfo(liveAircraft.hex, liveAircraft.flight).tailNumber}`}
                >
                  <BellPlus size={12} />
                  <span>Alert {getTailInfo(liveAircraft.hex, liveAircraft.flight).tailNumber}</span>
                </button>
              )}
            </div>
          </div>

          {/* Aircraft Thumbnail - Using S3 URL directly */}
          <div className="pro-aircraft-photo">
            {!proPhotoError && proPhotoUrl ? (
              <img
                key={`${liveAircraft.hex}-${proPhotoRetry}-${proPhotoUrl}`}
                src={proPhotoUrl}
                alt={liveAircraft.flight?.trim() || liveAircraft.hex}
                onError={() => setProPhotoError(true)}
                loading="lazy"
              />
            ) : (
              <div className="pro-photo-placeholder">
                <Plane size={48} />
                <span>No Photo Available</span>
                <button
                  className="pro-photo-retry"
                  onClick={async () => {
                    setProPhotoError(false);
                    setProPhotoRetry(c => c + 1);
                    // Re-fetch the photo URL using WebSocket or HTTP
                    try {
                      if (wsRequest && wsConnected) {
                        const data = await wsRequest('photo-cache', { icao: liveAircraft.hex });
                        if (data?.thumbnail_url) {
                          setProPhotoUrl(data.thumbnail_url);
                        } else if (data?.photo_url) {
                          setProPhotoUrl(data.photo_url);
                        } else {
                          setProPhotoError(true);
                        }
                      } else {
                        const res = await fetch(`${config.apiBaseUrl || ''}/api/v1/aircraft/${liveAircraft.hex}/photo/cache`, {
                          method: 'POST'
                        });
                        if (res.ok) {
                          const data = await res.json();
                          if (data?.thumbnail_url) {
                            setProPhotoUrl(data.thumbnail_url);
                          } else if (data?.photo_url) {
                            setProPhotoUrl(data.photo_url);
                          }
                        } else {
                          setProPhotoError(true);
                        }
                      }
                    } catch {
                      setProPhotoError(true);
                    }
                  }}
                >
                  <RefreshCw size={14} /> Retry
                </button>
              </div>
            )}
          </div>

          {/* Operator Label */}
          {aircraftInfo[liveAircraft.hex] && (aircraftInfo[liveAircraft.hex].operator || aircraftInfo[liveAircraft.hex].owner) && (
            <div className="pro-operator-label">
              <Building2 size={14} />
              <span>{aircraftInfo[liveAircraft.hex].operator || aircraftInfo[liveAircraft.hex].owner}</span>
            </div>
          )}

          <div className="pro-stats-grid">
            {(() => {
              // Calculate values for color coding
              const proAltitude = liveAircraft.alt_baro || liveAircraft.alt_geom || liveAircraft.alt || 0;
              const proSpeed = liveAircraft.gs || liveAircraft.tas;
              const proAltClass = getAltitudeColorClass(proAltitude);
              const proSpeedClass = getSpeedColorClass(proSpeed, proAltitude);

              // Track distance trend - reset if aircraft changed
              const proDistanceNm = liveAircraft.distance_nm || getDistanceNm(liveAircraft.lat, liveAircraft.lon);
              if (proTrackedAircraftRef.current !== liveAircraft.hex) {
                // Aircraft changed, reset tracking
                proTrackedAircraftRef.current = liveAircraft.hex;
                proPrevDistanceRef.current = proDistanceNm;
                proDistanceTrendRef.current = null;
              } else if (proPrevDistanceRef.current !== null) {
                const delta = proDistanceNm - proPrevDistanceRef.current;
                // Use very small threshold (0.01 nm = ~60 feet) to detect movement
                if (delta < -0.01) {
                  proDistanceTrendRef.current = 'approaching';
                } else if (delta > 0.01) {
                  proDistanceTrendRef.current = 'receding';
                }
                // Keep previous trend if no significant change (don't reset to stable)
                proPrevDistanceRef.current = proDistanceNm;
              }
              const proDistTrend = proDistanceTrendRef.current;

              // RSSI signal strength
              const proRssi = liveAircraft.rssi;
              const proSignalClass = proRssi !== undefined ? getSignalStrengthClass(proRssi) : 'weak';

              return (
                <>
                  <div className="pro-stat">
                    <div className="pro-stat-label"><Crosshair size={14} /> ALTITUDE</div>
                    <div className={`pro-stat-value ${proAltClass}`}>{proAltitude.toLocaleString()} <span className="unit">ft</span></div>
                  </div>
                  <div className="pro-stat">
                    <div className="pro-stat-label"><Navigation size={14} /> SPEED</div>
                    <div className={`pro-stat-value ${proSpeedClass}`}>{proSpeed || '--'} <span className="unit">kts</span></div>
                  </div>
                  <div className="pro-stat">
                    <div className="pro-stat-label"><Plane size={14} /> TYPE</div>
                    <div className="pro-stat-value">{liveAircraft.type || '--'}</div>
                  </div>
                  <div className="pro-stat">
                    <div className="pro-stat-label"><Radio size={14} /> SQUAWK</div>
                    <div className="pro-stat-value">{liveAircraft.squawk || '1200'}</div>
                  </div>
                  <div className="pro-stat">
                    <div className="pro-stat-label"><TrendingUp size={14} /> V/S</div>
                    {(() => {
                      const vs = liveAircraft.vr ?? liveAircraft.baro_rate ?? liveAircraft.geom_rate ?? 0;
                      const isExtreme = Math.abs(vs) > 3000;
                      const vsClass = vs > 0 ? 'climbing' : vs < 0 ? 'descending' : '';
                      return (
                        <div className={`pro-stat-value ${vsClass} ${isExtreme ? 'extreme-vs' : ''}`}>
                          {vs > 0 ? '+' : ''}{vs} <span className="unit">fpm</span>
                        </div>
                      );
                    })()}
                  </div>
                  <div className="pro-stat">
                    <div className="pro-stat-label"><LocateFixed size={14} /> TRACK</div>
                    <div className="pro-stat-value">
                      {Math.round(liveAircraft.track || liveAircraft.true_heading || 0)}°
                      <span className="unit cardinal">{windDirToCardinal(liveAircraft.track || liveAircraft.true_heading)}</span>
                    </div>
                  </div>
                  <div className="pro-stat">
                    <div className="pro-stat-label"><MapPin size={14} /> DISTANCE</div>
                    <div className={`pro-stat-value distance-value ${proDistTrend || ''}`}>
                      {proDistTrend === 'approaching' ? (
                        <ArrowDownRight size={14} className="trend-icon approaching" />
                      ) : proDistTrend === 'receding' ? (
                        <ArrowUpRight size={14} className="trend-icon receding" />
                      ) : (
                        <ArrowRight size={14} className="trend-icon stable" />
                      )}
                      {proDistanceNm.toFixed(1)} <span className="unit">nm</span>
                    </div>
                  </div>
                  <div className="pro-stat">
                    <div className="pro-stat-label"><Signal size={14} /> RSSI</div>
                    <div className="pro-stat-value rssi-stat">
                      {proRssi !== undefined ? (
                        <>
                          <span className={`signal-bars ${proSignalClass}`}>
                            <span className="bar bar-1"></span>
                            <span className="bar bar-2"></span>
                            <span className="bar bar-3"></span>
                            <span className="bar bar-4"></span>
                          </span>
                          <span>{proRssi.toFixed(0)}</span>
                          <span className="unit">dB</span>
                        </>
                      ) : (
                        <>-- <span className="unit">dB</span></>
                      )}
                    </div>
                  </div>
                </>
              );
            })()}
          </div>

          <div className="pro-graphs-container">
            <div className="pro-profile-chart">
              <div className="pro-section-header">
                ALTITUDE PROFILE
                <span className="profile-value cyan">{(liveAircraft.alt_baro || liveAircraft.alt_geom || liveAircraft.alt || 0).toLocaleString()}</span>
              </div>
              <canvas
                className="profile-canvas"
                width={280}
                height={60}
                ref={altProfileCanvasRef}
              />
            </div>

            <div className="pro-profile-chart">
              <div className="pro-section-header">
                SPEED PROFILE
                <span className="profile-value green">{liveAircraft.gs || liveAircraft.tas || '--'}</span>
              </div>
              <canvas
                className="profile-canvas"
                width={280}
                height={60}
                ref={speedProfileCanvasRef}
              />
            </div>

            <div className="pro-profile-chart">
              <div className="pro-section-header">
                VERTICAL SPEED
                <span className={`profile-value ${(liveAircraft.vr ?? liveAircraft.baro_rate ?? 0) > 0 ? 'cyan' : (liveAircraft.vr ?? liveAircraft.baro_rate ?? 0) < 0 ? 'red' : ''}`}>
                  {(liveAircraft.vr ?? liveAircraft.baro_rate ?? liveAircraft.geom_rate ?? 0) > 0 ? '+' : ''}{liveAircraft.vr ?? liveAircraft.baro_rate ?? liveAircraft.geom_rate ?? 0}
                </span>
              </div>
              <canvas
                className="profile-canvas"
                width={280}
                height={60}
                ref={vsProfileCanvasRef}
              />
            </div>

            <div className="pro-profile-chart">
              <div className="pro-section-header">
                DISTANCE
                <span className="profile-value purple">{(liveAircraft.distance_nm || getDistanceNm(liveAircraft.lat, liveAircraft.lon)).toFixed(1)}</span>
              </div>
              <canvas
                className="profile-canvas"
                width={280}
                height={60}
                ref={distProfileCanvasRef}
              />
            </div>

            <div className="pro-track-history">
              <div className="pro-section-header">TRACK HISTORY</div>
              <canvas
                className="track-history-canvas"
                width={280}
                height={80}
                ref={trackCanvasRef}
              />
            </div>
          </div>

          <div className="pro-external-links">
            <div className="pro-section-header">EXTERNAL</div>
            <div className="pro-links">
              <a href={`https://flightaware.com/live/flight/${liveAircraft.flight?.trim() || liveAircraft.hex}`} target="_blank" rel="noopener noreferrer" className="pro-link">
                FlightAware <ExternalLink size={12} />
              </a>
              <a href={`https://globe.adsbexchange.com/?icao=${liveAircraft.hex}`} target="_blank" rel="noopener noreferrer" className="pro-link">
                ADSBx <ExternalLink size={12} />
              </a>
            </div>
          </div>
        </div>
        );
      })()}

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
                onChange={(e) => setAcarsFilters({...acarsFilters, hideEmpty: e.target.checked})}
              />
              <span>Hide empty</span>
            </label>
            <select 
              className="acars-source-filter"
              value={acarsFilters.sourceFilter}
              onChange={(e) => setAcarsFilters({...acarsFilters, sourceFilter: e.target.value})}
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
              onChange={(e) => setAcarsFilters({...acarsFilters, callsignFilter: e.target.value})}
            />
          </div>
          <div className="acars-messages">
            {(() => {
              // Filter messages
              let filtered = acarsMessages;
              
              // Hide empty messages
              if (acarsFilters.hideEmpty) {
                filtered = filtered.filter(msg => msg.text && msg.text.trim().length > 0);
              }
              
              // Source filter
              if (acarsFilters.sourceFilter !== 'all') {
                filtered = filtered.filter(msg => msg.source === acarsFilters.sourceFilter);
              }
              
              // Callsign filter
              if (acarsFilters.callsignFilter) {
                const cf = acarsFilters.callsignFilter.toLowerCase();
                filtered = filtered.filter(msg => 
                  (msg.callsign && msg.callsign.toLowerCase().includes(cf)) ||
                  (msg.icao_hex && msg.icao_hex.toLowerCase().includes(cf))
                );
              }
              
              if (filtered.length === 0) {
                return <div className="acars-empty">No messages match filters</div>;
              }
              
              return filtered.slice(0, 50).map((msg, i) => {
                // Find matching aircraft by ICAO hex or callsign (handles IATA/ICAO conversion)
                const matchingAircraft = aircraft.find(ac =>
                  (msg.icao_hex && ac.hex?.toUpperCase() === msg.icao_hex.toUpperCase()) ||
                  callsignsMatch(msg.callsign, ac.flight)
                );

                // Check cache for hex lookup by callsign (from history API)
                const cachedHex = msg.callsign ? callsignHexCache[msg.callsign.trim().toUpperCase()] : null;

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
                    title={isMatched ? 'Click to view aircraft (in range)' : isFromHistory ? 'Click to view aircraft (from history)' : canLink ? 'Click to view aircraft details' : 'Aircraft not in range - no ICAO hex'}
                  >
                    <div className="acars-msg-header">
                      <span className={`acars-callsign ${canLink ? 'clickable' : ''}`}>{msg.callsign || msg.icao_hex || 'Unknown'}</span>
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

      {/* Aircraft Detail Modal */}
      {aircraftDetailHex && (
        <div className="aircraft-detail-overlay" onClick={() => openAircraftDetail(null)}>
          <div className="aircraft-detail-modal" onClick={e => e.stopPropagation()}>
            <AircraftDetailPage
              hex={aircraftDetailHex}
              apiUrl={config.apiBaseUrl}
              onClose={() => openAircraftDetail(null)}
              onSelectAircraft={(newHex) => openAircraftDetail(newHex)}
              aircraft={aircraft.find(a => a.hex === aircraftDetailHex)}
              aircraftInfo={aircraftInfo[aircraftDetailHex]}
              feederLocation={{ lat: feederLat, lon: feederLon }}
            />
          </div>
        </div>
      )}
    </div>
  );
}



export { MapView };
