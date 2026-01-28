/**
 * CannonballMode - Glanceable law enforcement detection display
 *
 * A full-screen, high-contrast interface optimized for detecting
 * law enforcement aircraft while driving. Features:
 * - Large distance display
 * - Direction indicator
 * - Color-coded threat levels
 * - Voice announcements
 * - Haptic feedback
 * - Multiple display modes (single, grid, radar, headsUp)
 * - Theme support (dark, red, highContrast, amoled, daylight)
 * - GPS permission flow with recovery UI
 * - Gesture controls (swipe, double-tap)
 * - Urgency scoring and predictive alerts
 * - Settings persistence
 * - Wake lock to prevent screen sleep
 */
import React, { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import {
  X, Navigation2, Volume2, VolumeX, History, Trash2,
  Wifi, WifiOff, MapPin, MapPinOff, Settings, AlertTriangle,
  Eye, EyeOff, ChevronUp, ChevronDown, Minus, Check,
  Circle, Target, Mic, MicOff, RefreshCw, Server,
} from 'lucide-react';

import { useDeviceGPS, GPS_PERMISSION_STATES } from '../../hooks/useDeviceGPS';
import { useVoiceAlerts } from '../../hooks/useVoiceAlerts';
import { useThreatHistory } from '../../hooks/useThreatHistory';
import { useHapticFeedback } from '../../hooks/useHapticFeedback';
import {
  identifyLawEnforcement,
  getThreatLevel,
  calculateDistanceNm,
  calculateBearing,
  getDirectionName,
} from '../../utils/lawEnforcement';
import {
  calculateClosingSpeed,
  calculateETA,
  calculateUrgencyScore,
  detectCirclingBehavior,
  detectLoitering,
} from '../../utils/threatPrediction';

import { useVoiceControl } from '../../hooks/useVoiceControl';
import { useCannonballAPI } from '../../hooks/useCannonballAPI';

// Sub-components
import { SettingsPanel, DEFAULT_SETTINGS } from '../cannonball/SettingsPanel';
import { ThreatGrid } from '../cannonball/ThreatGrid';
import { MiniRadar } from '../cannonball/MiniRadar';
import { GPSPermissionModal } from '../cannonball/GPSPermissionModal';

// Speed threshold for simplified UI (in m/s, ~50 mph)
const HIGH_SPEED_THRESHOLD = 22;

// Storage key for settings persistence
const SETTINGS_STORAGE_KEY = 'cannonball_settings';

// Load settings from localStorage
function loadSettings() {
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch (err) {
    console.warn('Failed to load cannonball settings:', err);
  }
  return DEFAULT_SETTINGS;
}

// Save settings to localStorage
function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('Failed to save cannonball settings:', err);
  }
}

// Wake Lock API wrapper
async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      return await navigator.wakeLock.request('screen');
    } catch (err) {
      console.warn('Wake lock failed:', err);
    }
  }
  return null;
}

/**
 * StatusBar component - shows GPS and connection status
 */
const StatusBar = memo(function StatusBar({
  gpsActive,
  gpsAccuracy,
  connected,
  backendConnected,
  useBackend,
  threatCount,
  persistent,
  voiceEnabled,
  voiceControlActive,
  onToggleVoice,
  onTogglePersistent,
  onToggleVoiceControl,
  onShowHistory,
  onShowSettings,
  onExit,
}) {
  return (
    <div className="cannonball-status-bar">
      <div className="status-left">
        <div className={`status-indicator ${gpsActive ? 'active' : 'inactive'}`}>
          {gpsActive ? <MapPin size={18} /> : <MapPinOff size={18} />}
          <span>{gpsActive ? `GPS ${gpsAccuracy ? `(${Math.round(gpsAccuracy)}m)` : ''}` : 'NO GPS'}</span>
        </div>
        <div className={`status-indicator ${connected ? 'active' : 'inactive'}`}>
          {connected ? <Wifi size={18} /> : <WifiOff size={18} />}
          <span>{connected ? 'LIVE' : 'OFFLINE'}</span>
        </div>
        {useBackend && (
          <div className={`status-indicator ${backendConnected ? 'active' : 'inactive'}`}>
            <Server size={16} />
            <span>{backendConnected ? 'API' : 'LOCAL'}</span>
          </div>
        )}
      </div>

      <div className="status-center">
        {threatCount > 0 && (
          <div className="threat-badge">
            <AlertTriangle size={14} />
            <span>{threatCount}</span>
          </div>
        )}
      </div>

      <div className="status-right">
        <button
          className={`status-btn ${voiceEnabled ? 'active' : ''}`}
          onClick={onToggleVoice}
          title={voiceEnabled ? 'Disable voice' : 'Enable voice'}
        >
          {voiceEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
        </button>
        {onToggleVoiceControl && (
          <button
            className={`status-btn ${voiceControlActive ? 'active' : ''}`}
            onClick={onToggleVoiceControl}
            title={voiceControlActive ? 'Disable voice control' : 'Enable voice control'}
          >
            {voiceControlActive ? <Mic size={20} /> : <MicOff size={20} />}
          </button>
        )}
        <button
          className={`status-btn ${persistent ? 'active' : ''}`}
          onClick={onTogglePersistent}
          title={persistent ? 'History enabled' : 'Ephemeral mode'}
        >
          {persistent ? <Eye size={20} /> : <EyeOff size={20} />}
        </button>
        <button className="status-btn" onClick={onShowHistory} title="View history">
          <History size={20} />
        </button>
        <button className="status-btn" onClick={onShowSettings} title="Settings">
          <Settings size={20} />
        </button>
        <button className="status-btn exit-btn" onClick={onExit} title="Exit Cannonball">
          <X size={22} />
        </button>
      </div>
    </div>
  );
});

/**
 * DirectionArrow component - rotates based on threat bearing
 */
const DirectionArrow = memo(function DirectionArrow({ bearing, userHeading, threatLevel, size = 80 }) {
  // Calculate relative bearing if user heading is available
  const rotation = userHeading !== null
    ? (bearing - userHeading + 360) % 360
    : bearing;

  return (
    <div
      className={`direction-arrow threat-${threatLevel}`}
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      <Navigation2 size={size} />
    </div>
  );
});

/**
 * Format distance for display
 */
function formatDistance(nm) {
  if (nm < 0.5) {
    const feet = Math.round(nm * 6076.12 / 100) * 100;
    return { value: feet, unit: 'FT' };
  } else if (nm < 10) {
    return { value: nm.toFixed(1), unit: 'NM' };
  } else {
    return { value: Math.round(nm), unit: 'NM' };
  }
}

/**
 * Get urgency level from score
 */
function getUrgencyLevel(score) {
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

/**
 * ThreatDisplay component - main threat information (single mode)
 */
const ThreatDisplay = memo(function ThreatDisplay({
  threat,
  userHeading,
  showMiniRadar,
  threats,
  onThreatClick,
  showUrgency = true,
  showAgencyInfo = true,
  showPatternDetails = true,
}) {
  const threatLevel = threat.threat_level || 'info';
  const distance = formatDistance(threat.distance_nm);

  // Trend indicator
  const TrendIcon = threat.trend === 'approaching' ? ChevronDown
    : threat.trend === 'departing' ? ChevronUp
    : Minus;

  // Calculate urgency display
  const urgencyLevel = threat.urgencyScore ? getUrgencyLevel(threat.urgencyScore) : null;

  return (
    <div className={`threat-display threat-${threatLevel}`}>
      <div className="threat-header">
        <span className="threat-category">{threat.category || 'AIRCRAFT'}</span>
        {threat.callsign && (
          <span className="threat-callsign">{threat.callsign}</span>
        )}
        {/* Show agency name if known (from backend) */}
        {showAgencyInfo && threat.agencyName && (
          <span className="threat-agency">{threat.agencyName}</span>
        )}
        {/* Show known LE badge */}
        {threat.knownLE && (
          <span className="known-le-badge">KNOWN LE</span>
        )}
        {showUrgency && urgencyLevel && (
          <span className={`urgency-badge urgency-${urgencyLevel}`}>
            <AlertTriangle size={12} />
            {threat.urgencyScore}
          </span>
        )}
      </div>

      <div className="threat-main">
        <DirectionArrow
          bearing={threat.bearing}
          userHeading={userHeading}
          threatLevel={threatLevel}
        />

        <div className="distance-display">
          <span className="distance-value">{distance.value}</span>
          <span className="distance-unit">{distance.unit}</span>
        </div>

        <div className="direction-label">
          {getDirectionName(threat.bearing)}
        </div>
      </div>

      <div className="threat-footer">
        <div className="threat-info">
          <span className={`trend-indicator ${threat.trend}`}>
            <TrendIcon size={20} />
            {threat.trend?.toUpperCase() || 'UNKNOWN'}
          </span>
        </div>

        {/* Predictive alerts */}
        {threat.prediction && (
          <div className="threat-predictions">
            {threat.prediction.willIntercept && (
              <span className="intercept-warning">
                <Target size={14} />
                INTERCEPT
              </span>
            )}
            {threat.closingSpeed > 100 && threat.trend === 'approaching' && (
              <span className="prediction-badge closing-fast">
                CLOSING FAST ({Math.round(threat.closingSpeed)} kt)
              </span>
            )}
            {threat.behavior?.isCircling && (
              <span className="prediction-badge circling">
                <Circle size={12} />
                CIRCLING
              </span>
            )}
            {threat.behavior?.isLoitering && (
              <span className="prediction-badge loitering">
                LOITERING {threat.behavior.duration}m
              </span>
            )}
          </div>
        )}

        {/* Backend pattern badges */}
        {showPatternDetails && threat.patterns && threat.patterns.length > 0 && (
          <div className="pattern-badges">
            {threat.patterns.map((pattern, idx) => (
              <span key={idx} className={`pattern-badge ${pattern.type || pattern.pattern_type}`}>
                {pattern.type === 'circling' && <RefreshCw size={10} />}
                {pattern.type === 'grid_search' && <Target size={10} />}
                {(pattern.type || pattern.pattern_type || 'unknown').replace('_', ' ').toUpperCase()}
                {pattern.confidence_score && ` (${Math.round(pattern.confidence_score * 100)}%)`}
              </span>
            ))}
          </div>
        )}

        <div className="threat-details">
          {threat.altitude && (
            <span className="detail">{Math.round(threat.altitude).toLocaleString()} FT</span>
          )}
          {threat.ground_speed && (
            <span className="detail">{Math.round(threat.ground_speed)} KTS</span>
          )}
        </div>
      </div>

      {/* Mini radar overlay */}
      {showMiniRadar && threats.length > 0 && (
        <div className="mini-radar-overlay">
          <MiniRadar
            threats={threats}
            userHeading={userHeading}
            size={120}
            maxRange={15}
            onThreatClick={onThreatClick}
          />
        </div>
      )}
    </div>
  );
});

/**
 * ClearStatus component - shown when no threats
 */
const ClearStatus = memo(function ClearStatus({ gpsActive }) {
  return (
    <div className="clear-status">
      <div className="clear-icon">
        <div className="clear-circle" />
      </div>
      <div className="clear-text">ALL CLEAR</div>
      <div className="clear-subtext">
        {gpsActive ? 'Scanning for threats...' : 'Enable GPS for scanning'}
      </div>
    </div>
  );
});

/**
 * ThreatList component - secondary threats
 */
const ThreatList = memo(function ThreatList({ threats, onSelect }) {
  if (threats.length === 0) return null;

  return (
    <div className="threat-list">
      {threats.map((threat, index) => (
        <button
          key={threat.hex || index}
          className={`threat-item threat-${threat.threat_level}`}
          onClick={() => onSelect(threat)}
        >
          <span className="item-category">{threat.category}</span>
          <span className="item-distance">{threat.distance_nm.toFixed(1)} NM</span>
          <span className="item-direction">{getDirectionName(threat.bearing)}</span>
          {threat.urgencyScore >= 60 && (
            <span className="urgency-badge urgency-high">{threat.urgencyScore}</span>
          )}
        </button>
      ))}
    </div>
  );
});

/**
 * HeadsUpDisplay component - minimal glanceable display mode
 * Shows only essential info: large direction arrow, distance, threat color
 */
const HeadsUpDisplay = memo(function HeadsUpDisplay({
  threat,
  threatCount,
  userHeading,
  gpsActive,
}) {
  // No threats - show all clear
  if (!threat) {
    return (
      <div className="heads-up-display threat-level-info">
        <div className="heads-up-all-clear">
          <div className="heads-up-all-clear-icon">
            <Check size={60} color="#22c55e" />
          </div>
          <div className="heads-up-all-clear-text">ALL CLEAR</div>
        </div>
      </div>
    );
  }

  const threatLevel = threat.threat_level || 'info';
  const distance = formatDistance(threat.distance_nm);

  // Calculate relative bearing
  const rotation = userHeading !== null
    ? (threat.bearing - userHeading + 360) % 360
    : threat.bearing;

  return (
    <div className={`heads-up-display threat-level-${threatLevel}`}>
      {/* Large direction arrow */}
      <div
        className={`heads-up-arrow threat-${threatLevel}`}
        style={{ transform: `rotate(${rotation}deg)` }}
      >
        <Navigation2 />
      </div>

      {/* Distance in corner */}
      <div className={`heads-up-distance threat-${threatLevel}`}>
        {distance.value} {distance.unit}
      </div>

      {/* Threat count indicator */}
      {threatCount > 1 && (
        <div className="heads-up-count">
          <AlertTriangle size={16} />
          <span>{threatCount}</span>
        </div>
      )}
    </div>
  );
});

/**
 * HistoryPanel component - threat encounter history
 */
const HistoryPanel = memo(function HistoryPanel({ history, stats, onClear, onClose }) {
  return (
    <div className="history-panel">
      <div className="history-header">
        <h3>Encounter History</h3>
        <div className="history-actions">
          <button className="clear-btn" onClick={onClear} title="Clear history">
            <Trash2 size={18} />
          </button>
          <button className="close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
      </div>

      <div className="history-stats">
        <div className="stat">
          <span className="stat-value">{stats.totalEncounters}</span>
          <span className="stat-label">Total</span>
        </div>
        <div className="stat">
          <span className="stat-value">{stats.lawEnforcementCount}</span>
          <span className="stat-label">Law Enforcement</span>
        </div>
        <div className="stat">
          <span className="stat-value">{stats.helicopterCount}</span>
          <span className="stat-label">Helicopters</span>
        </div>
        {stats.closestApproach && (
          <div className="stat">
            <span className="stat-value">{stats.closestApproach.distance.toFixed(1)} NM</span>
            <span className="stat-label">Closest</span>
          </div>
        )}
      </div>

      <div className="history-list">
        {history.length === 0 ? (
          <div className="history-empty">No encounters recorded</div>
        ) : (
          history.map((entry) => (
            <div key={entry.id} className={`history-item threat-${entry.threat_level}`}>
              <div className="item-main">
                <span className="item-category">{entry.category}</span>
                {entry.callsign && <span className="item-callsign">{entry.callsign}</span>}
              </div>
              <div className="item-details">
                <span>Closest: {entry.closest_distance.toFixed(1)} NM</span>
                <span>{new Date(entry.first_seen).toLocaleTimeString()}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
});

/**
 * EdgeIndicators component - peripheral vision threat indicators
 */
const EdgeIndicators = memo(function EdgeIndicators({ threats, userHeading }) {
  if (!threats || threats.length === 0) return null;

  // Get the most critical threat
  const criticalThreat = threats[0];
  if (!criticalThreat || criticalThreat.threat_level === 'info') return null;

  // Calculate relative bearing
  const bearing = userHeading !== null
    ? (criticalThreat.bearing - userHeading + 360) % 360
    : criticalThreat.bearing;

  // Determine which edge(s) to highlight
  const indicators = [];
  const color = criticalThreat.threat_level === 'critical' ? '#ef4444' : '#f59e0b';
  const intensity = criticalThreat.threat_level === 'critical' ? 0.7 : 0.4;

  // Map bearing to edge indicators
  if (bearing >= 315 || bearing < 45) {
    indicators.push({ direction: 'top', color, intensity });
  }
  if (bearing >= 45 && bearing < 135) {
    indicators.push({ direction: 'right', color, intensity });
  }
  if (bearing >= 135 && bearing < 225) {
    indicators.push({ direction: 'bottom', color, intensity });
  }
  if (bearing >= 225 && bearing < 315) {
    indicators.push({ direction: 'left', color, intensity });
  }

  return (
    <div className="edge-indicators">
      {indicators.map(({ direction, color: c, intensity: i }) => (
        <div
          key={direction}
          className={`edge-indicator ${direction}`}
          style={{ '--color': c, '--intensity': i }}
        />
      ))}
    </div>
  );
});

/**
 * RadarView component - full screen radar display mode
 */
const RadarView = memo(function RadarView({ threats, userHeading, onThreatClick, selectedThreat }) {
  // Calculate size on render
  const size = useMemo(() => {
    if (typeof window === 'undefined') return 300;
    return Math.min(window.innerWidth - 40, window.innerHeight - 200);
  }, []);

  return (
    <div className="radar-view">
      <MiniRadar
        threats={threats}
        userHeading={userHeading}
        size={size}
        maxRange={25}
        onThreatClick={onThreatClick}
        expanded={true}
        className="radar-fullscreen"
      />
      {selectedThreat && (
        <div className="radar-selected-info">
          <span className="info-category">{selectedThreat.category}</span>
          <span className="info-distance">{selectedThreat.distance_nm.toFixed(1)} NM</span>
          <span className="info-direction">{getDirectionName(selectedThreat.bearing)}</span>
        </div>
      )}
    </div>
  );
});

/**
 * GestureHint component - shows feedback for gesture actions
 */
const GestureHint = memo(function GestureHint({ message }) {
  if (!message) return null;
  return <div className="gesture-hint">{message}</div>;
});

/**
 * GPSDisabledBanner component - shown when user continues without GPS
 */
const GPSDisabledBanner = memo(function GPSDisabledBanner({ onEnableGPS }) {
  return (
    <div className="gps-disabled-banner">
      <MapPinOff size={16} />
      <span>GPS disabled - distance/direction unavailable</span>
      <button onClick={onEnableGPS}>Enable</button>
    </div>
  );
});

// Display modes including new heads-up mode
const DISPLAY_MODES = ['single', 'grid', 'radar', 'headsUp'];

/**
 * Main CannonballMode component
 */
export function CannonballMode({ apiBase, onExit, aircraft = [] }) {
  // Load settings from localStorage
  const [settings, setSettings] = useState(loadSettings);

  // Backend API integration
  const {
    threats: backendThreats,
    threatCount: backendThreatCount,
    connected: backendConnected,
    sessionId: backendSessionId,
    error: backendError,
    lastUpdate: backendLastUpdate,
    sessions: backendSessions,
    patterns: backendPatterns,
    alerts: backendAlerts,
    stats: backendStats,
    updateLocation,
    setThreatRadius: setBackendThreatRadius,
    fetchSessions,
    fetchPatterns,
    fetchAlerts,
    fetchStats,
    acknowledgeAlert,
    acknowledgeAllAlerts,
    checkKnownAircraft,
  } = useCannonballAPI({
    apiBase,
    enabled: settings.useBackend !== false, // Default to using backend
    useWebSocket: true,
    threatRadius: settings.threatRadius,
  });

  // State
  const [threats, setThreats] = useState([]);
  const [selectedThreat, setSelectedThreat] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showGPSModal, setShowGPSModal] = useState(false);
  const [gpsDisabledByUser, setGpsDisabledByUser] = useState(false);
  const [connected, setConnected] = useState(false);
  const [gestureHint, setGestureHint] = useState(null);
  const [voiceControlActive, setVoiceControlActive] = useState(false);

  // Refs
  const wakeLockRef = useRef(null);
  const lastThreatsRef = useRef([]);
  const prevPositionRef = useRef(null);
  const threatHistoryRef = useRef(new Map()); // For behavior detection
  const criticalVibrationRef = useRef(null);
  const updateTimeRef = useRef(Date.now());

  // Settings handlers
  const handleSettingsChange = useCallback((newSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
  }, []);

  // GPS Hook - don't auto-request, we'll handle permission UI
  const {
    position,
    heading,
    accuracy,
    speed: userSpeed,
    isTracking,
    error: gpsError,
    permissionState,
    requestPermission,
    startTracking,
  } = useDeviceGPS({
    enabled: !gpsDisabledByUser,
    interval: 3000,
    highAccuracy: true,
    autoRequest: false,
  });

  // Show GPS permission modal when needed
  useEffect(() => {
    if (permissionState === GPS_PERMISSION_STATES.PROMPT ||
        permissionState === GPS_PERMISSION_STATES.DENIED ||
        permissionState === GPS_PERMISSION_STATES.UNAVAILABLE) {
      if (!gpsDisabledByUser) {
        setShowGPSModal(true);
      }
    } else if (permissionState === GPS_PERMISSION_STATES.GRANTED) {
      setShowGPSModal(false);
    }
  }, [permissionState, gpsDisabledByUser]);

  // GPS Permission handlers
  const handleRequestGPSPermission = useCallback(async () => {
    await requestPermission();
    if (permissionState === GPS_PERMISSION_STATES.GRANTED) {
      startTracking();
    }
  }, [requestPermission, startTracking, permissionState]);

  const handleRetryGPS = useCallback(async () => {
    setGpsDisabledByUser(false);
    await requestPermission();
  }, [requestPermission]);

  const handleContinueWithoutGPS = useCallback(() => {
    setGpsDisabledByUser(true);
    setShowGPSModal(false);
  }, []);

  const handleEnableGPS = useCallback(() => {
    setGpsDisabledByUser(false);
    setShowGPSModal(true);
  }, []);

  const {
    announceThreat,
    announceNewThreat,
    announceClear,
    stop: stopVoice,
  } = useVoiceAlerts({ enabled: settings.voiceEnabled, rate: settings.voiceRate });

  const {
    history,
    stats,
    logThreat,
    clearHistory,
  } = useThreatHistory({ persistent: settings.persistent });

  const {
    vibrateNewThreat,
    vibrateForThreatLevel,
    vibrateClear,
    vibrateError,
    vibrateSelect,
    startContinuousVibration,
    stopContinuousVibration,
  } = useHapticFeedback({ enabled: settings.hapticEnabled, intensity: settings.hapticIntensity });

  // Exit handler ref (to avoid circular dependency with voice control)
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  // Voice control command handler
  const handleVoiceCommand = useCallback((command, transcript) => {
    console.log('Voice command:', command, transcript);

    switch (command) {
      case 'mute':
        handleSettingsChange({ ...settings, voiceEnabled: false });
        break;
      case 'unmute':
        handleSettingsChange({ ...settings, voiceEnabled: true });
        break;
      case 'mode_single':
        handleSettingsChange({ ...settings, displayMode: 'single' });
        break;
      case 'mode_grid':
        handleSettingsChange({ ...settings, displayMode: 'grid' });
        break;
      case 'mode_radar':
        handleSettingsChange({ ...settings, displayMode: 'radar' });
        break;
      case 'mode_headsUp':
        handleSettingsChange({ ...settings, displayMode: 'headsUp' });
        break;
      case 'settings':
        setShowSettings(true);
        break;
      case 'exit':
        // Use ref to call exit to avoid circular dependency
        stopVoice();
        if (wakeLockRef.current) {
          wakeLockRef.current.release();
        }
        onExitRef.current?.();
        break;
      case 'report':
        if (announceThreat && threats.length > 0) {
          announceThreat(threats[0], { force: true });
        } else if (announceClear) {
          announceClear();
        }
        break;
      case 'dismiss':
        setSelectedThreat(null);
        break;
      default:
        break;
    }
  }, [settings, handleSettingsChange, stopVoice, announceThreat, announceClear, threats]);

  // Voice control hook
  const {
    isListening: voiceListening,
    isSupported: voiceSupported,
  } = useVoiceControl({
    enabled: voiceControlActive,
    onCommand: handleVoiceCommand,
    continuous: true,
  });

  // Determine if user is at high speed (for simplified UI)
  const isHighSpeed = useMemo(() => {
    return userSpeed !== null && userSpeed > HIGH_SPEED_THRESHOLD;
  }, [userSpeed]);

  // Speed-based UI class
  const speedClass = isHighSpeed ? 'speed-simplified' : '';

  // Gesture handlers
  const showGestureHintTemp = useCallback((message) => {
    setGestureHint(message);
    setTimeout(() => setGestureHint(null), 1000);
  }, []);

  const handleSwipeLeft = useCallback(() => {
    // Cycle to next display mode
    const currentIndex = DISPLAY_MODES.indexOf(settings.displayMode);
    const nextIndex = (currentIndex + 1) % DISPLAY_MODES.length;
    const newMode = DISPLAY_MODES[nextIndex];
    handleSettingsChange({ ...settings, displayMode: newMode });
    showGestureHintTemp(newMode === 'headsUp' ? 'Heads-Up Mode' : `${newMode.charAt(0).toUpperCase() + newMode.slice(1)} Mode`);
  }, [settings, handleSettingsChange, showGestureHintTemp]);

  const handleSwipeRight = useCallback(() => {
    // Cycle to previous display mode
    const currentIndex = DISPLAY_MODES.indexOf(settings.displayMode);
    const prevIndex = (currentIndex - 1 + DISPLAY_MODES.length) % DISPLAY_MODES.length;
    const newMode = DISPLAY_MODES[prevIndex];
    handleSettingsChange({ ...settings, displayMode: newMode });
    showGestureHintTemp(newMode === 'headsUp' ? 'Heads-Up Mode' : `${newMode.charAt(0).toUpperCase() + newMode.slice(1)} Mode`);
  }, [settings, handleSettingsChange, showGestureHintTemp]);

  const handleSwipeUp = useCallback(() => {
    setShowSettings(true);
    showGestureHintTemp('Settings');
  }, [showGestureHintTemp]);

  const handleSwipeDown = useCallback(() => {
    // Dismiss current threat / deselect
    if (selectedThreat) {
      setSelectedThreat(null);
      showGestureHintTemp('Dismissed');
    }
  }, [selectedThreat, showGestureHintTemp]);

  const handleDoubleTap = useCallback(() => {
    // Toggle voice
    handleSettingsChange({ ...settings, voiceEnabled: !settings.voiceEnabled });
    showGestureHintTemp(settings.voiceEnabled ? 'Voice Off' : 'Voice On');
  }, [settings, handleSettingsChange, showGestureHintTemp]);

  // Get nearest threat
  const nearestThreat = useMemo(() => {
    return selectedThreat || threats[0] || null;
  }, [selectedThreat, threats]);

  // Determine threat glow class for visual indicators
  const threatGlowClass = useMemo(() => {
    if (!threats.length) return '';
    const highestLevel = threats[0]?.threat_level;
    if (highestLevel === 'critical') return 'threat-glow-critical';
    if (highestLevel === 'warning') return 'threat-glow-warning';
    return '';
  }, [threats]);

  // Request wake lock on mount
  useEffect(() => {
    requestWakeLock().then(lock => {
      wakeLockRef.current = lock;
    });

    return () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release();
      }
    };
  }, []);

  // Send location updates to backend when position changes
  useEffect(() => {
    if (position && settings.useBackend !== false) {
      updateLocation(position.lat, position.lon, heading, userSpeed);
    }
  }, [position, heading, userSpeed, updateLocation, settings.useBackend]);

  // Update backend threat radius when settings change
  useEffect(() => {
    if (settings.useBackend !== false) {
      setBackendThreatRadius(settings.threatRadius);
    }
  }, [settings.threatRadius, setBackendThreatRadius, settings.useBackend]);

  // Handle critical threat continuous vibration
  useEffect(() => {
    const hasCritical = threats.some(t => t.threat_level === 'critical');

    if (hasCritical && settings.hapticEnabled && !criticalVibrationRef.current) {
      criticalVibrationRef.current = startContinuousVibration(3000);
    } else if (!hasCritical && criticalVibrationRef.current) {
      stopContinuousVibration(criticalVibrationRef.current);
      criticalVibrationRef.current = null;
    }

    return () => {
      if (criticalVibrationRef.current) {
        stopContinuousVibration(criticalVibrationRef.current);
        criticalVibrationRef.current = null;
      }
    };
  }, [threats, settings.hapticEnabled, startContinuousVibration, stopContinuousVibration]);

  // Calculate threats from aircraft list with debouncing
  // Supports both backend mode (uses API threats) and local mode (calculates from aircraft)
  useEffect(() => {
    // If using backend threats, process them instead of calculating locally
    if (settings.useBackend !== false && backendThreats.length > 0) {
      // Transform backend threats to match expected format
      const transformedThreats = backendThreats.map(t => ({
        hex: t.icao_hex || t.hex,
        callsign: t.callsign,
        category: t.category || (t.is_helicopter ? 'Helicopter' : 'Aircraft'),
        description: t.description || t.identification_reason,
        distance_nm: t.distance_nm,
        bearing: t.bearing,
        direction: t.direction || (t.bearing !== null ? getDirectionName(t.bearing) : null),
        altitude: t.altitude,
        ground_speed: t.ground_speed,
        track: t.track,
        trend: t.trend || 'unknown',
        threat_level: t.threat_level,
        is_law_enforcement: t.is_law_enforcement || t.is_known_le,
        is_helicopter: t.is_helicopter,
        lat: t.lat,
        lon: t.lon,
        closingSpeed: t.closing_speed,
        urgencyScore: t.urgency_score || t.urgencyScore,
        // Backend patterns data
        patterns: t.patterns || [],
        behavior: {
          isCircling: t.patterns?.some(p => p.type === 'circling'),
          isLoitering: t.patterns?.some(p => p.type === 'loitering'),
        },
        // Additional backend data
        agencyName: t.agency_name,
        agencyType: t.agency_type,
        operatorName: t.operator_name,
        knownLE: t.known_le || t.is_known_le,
      }));

      // Sort by urgency score then threat level
      const threatOrder = { critical: 0, warning: 1, info: 2 };
      transformedThreats.sort((a, b) => {
        const urgencyDiff = (b.urgencyScore || 0) - (a.urgencyScore || 0);
        if (Math.abs(urgencyDiff) > 5) return urgencyDiff;
        const levelDiff = (threatOrder[a.threat_level] || 3) - (threatOrder[b.threat_level] || 3);
        if (levelDiff !== 0) return levelDiff;
        return (a.distance_nm ?? Infinity) - (b.distance_nm ?? Infinity);
      });

      // Check for new threats to announce
      for (const threat of transformedThreats) {
        const wasTracked = lastThreatsRef.current.find(t => t.hex === threat.hex);
        if (!wasTracked) {
          if (settings.voiceEnabled) announceNewThreat(threat);
          if (settings.hapticEnabled) vibrateNewThreat(threat.threat_level);
        }
      }

      // Announce if all clear
      if (transformedThreats.length === 0 && lastThreatsRef.current.length > 0) {
        if (settings.voiceEnabled) announceClear();
        if (settings.hapticEnabled) vibrateClear();
      }

      // Log threats to history
      if (settings.persistent) {
        for (const threat of transformedThreats) {
          if (threat.is_law_enforcement || threat.threat_level === 'critical' || threat.knownLE) {
            logThreat(threat);
          }
        }
      }

      lastThreatsRef.current = transformedThreats;
      setThreats(transformedThreats);
      setConnected(backendConnected);
      return;
    }

    // Fallback: Local threat calculation
    // Debounce: only process every 250ms
    const now = Date.now();
    if (now - updateTimeRef.current < 250) return;
    updateTimeRef.current = now;

    // Can work without GPS, just won't have distance/bearing
    if (!aircraft.length) return;

    const calculatedThreats = [];
    const timeDelta = 3; // seconds between updates (approximate)

    for (const ac of aircraft) {
      if (!ac.lat || !ac.lon) continue;

      // Identify law enforcement
      const leInfo = identifyLawEnforcement(ac);

      // Apply filtering settings
      if (settings.showLawEnforcementOnly && !leInfo.isLawEnforcement) {
        continue;
      }
      if (!settings.showAllHelicopters && !leInfo.isLawEnforcement && !leInfo.isInterest) {
        continue;
      }

      // Only include interesting aircraft
      if (!leInfo.isInterest && !settings.showAllHelicopters) continue;

      // If we have GPS, calculate distance and bearing
      let distanceNm = null;
      let bearing = null;

      if (position) {
        distanceNm = calculateDistanceNm(position.lat, position.lon, ac.lat, ac.lon);

        // Apply radius filter
        if (distanceNm > settings.threatRadius) continue;

        bearing = calculateBearing(position.lat, position.lon, ac.lat, ac.lon);
      }

      // Apply altitude filters
      const altitude = ac.alt_baro || ac.alt_geom || ac.alt || 0;
      if (altitude < settings.altitudeFloor || altitude > settings.altitudeCeiling) continue;
      if (altitude > settings.ignoreAboveAltitude) continue;

      // Check whitelisted hexes
      if (settings.whitelistedHexes.includes(ac.hex)) continue;

      const threatLevel = getThreatLevel(ac, distanceNm ?? 10, leInfo);

      // Determine trend and calculate closing speed
      let trend = 'unknown';
      let closingSpeed = null;
      const prevThreat = lastThreatsRef.current.find(t => t.hex === ac.hex);

      if (prevThreat && distanceNm !== null && prevThreat.distance_nm !== null) {
        const distDiff = distanceNm - prevThreat.distance_nm;
        if (distDiff < -0.05) trend = 'approaching';
        else if (distDiff > 0.05) trend = 'departing';
        else trend = 'holding';

        // Calculate closing speed
        if (position && prevPositionRef.current && prevThreat.lat && prevThreat.lon) {
          closingSpeed = calculateClosingSpeed(
            position,
            prevPositionRef.current,
            { lat: ac.lat, lon: ac.lon },
            { lat: prevThreat.lat, lon: prevThreat.lon },
            timeDelta
          );
        }
      }

      // Track position history for behavior detection
      let behavior = { isCircling: false, isLoitering: false };
      if (ac.hex) {
        const history = threatHistoryRef.current.get(ac.hex) || [];
        history.push({ lat: ac.lat, lon: ac.lon, timestamp: Date.now() });
        // Keep last 20 positions
        if (history.length > 20) history.shift();
        threatHistoryRef.current.set(ac.hex, history);

        // Detect circling behavior
        if (settings.detectCircling && history.length >= 10) {
          const circlingResult = detectCirclingBehavior(history, 10);
          behavior.isCircling = circlingResult.isCircling;
          behavior.circleConfidence = circlingResult.confidence;
        }

        // Detect loitering
        if (settings.detectLoitering && history.length >= 2) {
          const firstSeen = { timestamp: history[0].timestamp, distance_nm: distanceNm };
          const loiteringResult = detectLoitering(
            { distance_nm: distanceNm },
            firstSeen,
            settings.loiterThreshold
          );
          behavior.isLoitering = loiteringResult.isLoitering;
          behavior.duration = loiteringResult.duration;
        }
      }

      // Calculate ETA prediction
      let prediction = null;
      if (closingSpeed !== null && distanceNm !== null) {
        prediction = calculateETA({ distance_nm: distanceNm, trend }, closingSpeed);
      }

      // Calculate urgency score
      const urgencyScore = calculateUrgencyScore(
        {
          distance_nm: distanceNm ?? 10,
          is_law_enforcement: leInfo.isLawEnforcement,
          trend,
          threat_level: threatLevel,
        },
        prediction || {},
        behavior
      );

      calculatedThreats.push({
        hex: ac.hex,
        callsign: (ac.flight || '').trim() || null,
        category: leInfo.category || (leInfo.isHelicopter ? 'Helicopter' : 'Aircraft'),
        description: leInfo.description,
        distance_nm: distanceNm,
        bearing,
        direction: bearing !== null ? getDirectionName(bearing) : null,
        altitude,
        ground_speed: ac.gs,
        track: ac.track,
        vertical_rate: ac.baro_rate || ac.geom_rate,
        trend,
        threat_level: threatLevel,
        is_law_enforcement: leInfo.isLawEnforcement,
        is_helicopter: leInfo.isHelicopter,
        lat: ac.lat,
        lon: ac.lon,
        closingSpeed,
        prediction,
        behavior,
        urgencyScore,
      });
    }

    // Sort by urgency score (descending), then threat level, then distance
    const threatOrder = { critical: 0, warning: 1, info: 2 };
    calculatedThreats.sort((a, b) => {
      // First by urgency
      const urgencyDiff = (b.urgencyScore || 0) - (a.urgencyScore || 0);
      if (Math.abs(urgencyDiff) > 5) return urgencyDiff;

      // Then by threat level
      const levelDiff = (threatOrder[a.threat_level] || 3) - (threatOrder[b.threat_level] || 3);
      if (levelDiff !== 0) return levelDiff;

      // Finally by distance
      return (a.distance_nm ?? Infinity) - (b.distance_nm ?? Infinity);
    });

    // Check for new threats to announce
    for (const threat of calculatedThreats) {
      const wasTracked = lastThreatsRef.current.find(t => t.hex === threat.hex);
      if (!wasTracked) {
        if (settings.voiceEnabled) {
          announceNewThreat(threat);
        }
        if (settings.hapticEnabled) {
          vibrateNewThreat(threat.threat_level);
        }
      }
    }

    // Announce if all clear
    if (calculatedThreats.length === 0 && lastThreatsRef.current.length > 0) {
      if (settings.voiceEnabled) {
        announceClear();
      }
      if (settings.hapticEnabled) {
        vibrateClear();
      }
    }

    // Log threats to history
    if (settings.persistent) {
      for (const threat of calculatedThreats) {
        if (threat.is_law_enforcement || threat.threat_level === 'critical' || settings.autoLogCritical) {
          logThreat(threat);
        }
      }
    }

    // Store previous position for closing speed calculation
    prevPositionRef.current = position ? { ...position } : null;
    lastThreatsRef.current = calculatedThreats;
    setThreats(calculatedThreats);
    setConnected(true);
  }, [
    position, aircraft, settings, announceNewThreat, announceClear, logThreat,
    vibrateNewThreat, vibrateClear, backendThreats, backendConnected
  ]);

  // Handle GPS error haptic
  useEffect(() => {
    if (gpsError && settings.hapticEnabled) {
      vibrateError();
    }
  }, [gpsError, settings.hapticEnabled, vibrateError]);

  // Handle exit
  const handleExit = useCallback(() => {
    stopVoice();
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
    }
    if (criticalVibrationRef.current) {
      stopContinuousVibration(criticalVibrationRef.current);
    }
    onExit();
  }, [stopVoice, onExit, stopContinuousVibration]);

  // Handle threat selection
  const handleSelectThreat = useCallback((threat) => {
    setSelectedThreat(threat);
    if (settings.voiceEnabled) {
      announceThreat(threat, { force: true });
    }
    if (settings.hapticEnabled) {
      vibrateSelect();
    }
  }, [settings.voiceEnabled, settings.hapticEnabled, announceThreat, vibrateSelect]);

  // Toggle selected threat
  const handleDeselectThreat = useCallback(() => {
    setSelectedThreat(null);
  }, []);

  // Toggle voice
  const handleToggleVoice = useCallback(() => {
    handleSettingsChange({ ...settings, voiceEnabled: !settings.voiceEnabled });
  }, [settings, handleSettingsChange]);

  // Toggle persistent history
  const handleTogglePersistent = useCallback(() => {
    handleSettingsChange({ ...settings, persistent: !settings.persistent });
  }, [settings, handleSettingsChange]);

  // Determine theme class
  const themeClass = `theme-${settings.theme}`;

  // Render based on display mode
  const renderMainContent = useCallback(() => {
    const gpsActive = isTracking && !!position;

    if (threats.length === 0) {
      if (settings.displayMode === 'headsUp') {
        return <HeadsUpDisplay threat={null} threatCount={0} userHeading={heading} gpsActive={gpsActive} />;
      }
      return <ClearStatus gpsActive={gpsActive} />;
    }

    switch (settings.displayMode) {
      case 'headsUp':
        return (
          <HeadsUpDisplay
            threat={nearestThreat}
            threatCount={threats.length}
            userHeading={heading}
            gpsActive={gpsActive}
          />
        );

      case 'grid':
        return (
          <ThreatGrid
            threats={threats}
            userHeading={heading}
            maxDisplay={4}
            onSelectThreat={handleSelectThreat}
            selectedThreat={selectedThreat}
            showEta={settings.showEta}
          />
        );

      case 'radar':
        return (
          <RadarView
            threats={threats}
            userHeading={heading}
            onThreatClick={handleSelectThreat}
            selectedThreat={selectedThreat}
          />
        );

      case 'single':
      default:
        return nearestThreat ? (
          <ThreatDisplay
            threat={nearestThreat}
            userHeading={heading}
            showMiniRadar={settings.showMiniRadar}
            threats={threats}
            onThreatClick={handleSelectThreat}
            showUrgency={settings.showUrgencyScore}
            showAgencyInfo={settings.showAgencyInfo}
            showPatternDetails={settings.showPatternDetails}
          />
        ) : (
          <ClearStatus gpsActive={gpsActive} />
        );
    }
  }, [threats, settings.displayMode, settings.showMiniRadar, settings.showEta, nearestThreat, heading, isTracking, position, selectedThreat, handleSelectThreat]);

  // Gesture handlers for main content area
  const gestureHandlers = useMemo(() => ({
    onTouchStart: (e) => {
      // Only handle gestures if not on a button
      if (e.target.closest('button')) return;
      gestureState.current = {
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        startTime: Date.now(),
      };
    },
    onTouchEnd: (e) => {
      if (!gestureState.current) return;
      if (e.target.closest('button')) return;

      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - gestureState.current.startX;
      const deltaY = touch.clientY - gestureState.current.startY;
      const deltaTime = Date.now() - gestureState.current.startTime;

      // Check for quick tap (potential double tap)
      const isQuickTap = deltaTime < 300 && Math.abs(deltaX) < 20 && Math.abs(deltaY) < 20;
      if (isQuickTap) {
        const now = Date.now();
        if (now - lastTapTime.current < 300) {
          handleDoubleTap();
          lastTapTime.current = 0;
        } else {
          lastTapTime.current = now;
        }
        gestureState.current = null;
        return;
      }

      // Check for swipes
      if (deltaTime < 300) {
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        if (absX > 50 && absX > absY) {
          if (deltaX > 0) handleSwipeRight();
          else handleSwipeLeft();
        } else if (absY > 50 && absY > absX) {
          if (deltaY > 0) handleSwipeDown();
          else handleSwipeUp();
        }
      }

      gestureState.current = null;
    },
  }), [handleSwipeLeft, handleSwipeRight, handleSwipeUp, handleSwipeDown, handleDoubleTap]);

  // Refs for gesture detection
  const gestureState = useRef(null);
  const lastTapTime = useRef(0);

  return (
    <div
      className={`cannonball-mode ${themeClass} ${threatGlowClass} ${speedClass}`}
      {...gestureHandlers}
    >
      {/* GPS disabled banner */}
      {gpsDisabledByUser && (
        <GPSDisabledBanner onEnableGPS={handleEnableGPS} />
      )}

      {/* Voice listening indicator */}
      {voiceControlActive && voiceListening && (
        <div className="voice-listening-indicator">
          <div className="voice-waves">
            <div className="voice-wave" />
            <div className="voice-wave" />
            <div className="voice-wave" />
          </div>
          <span>Listening...</span>
        </div>
      )}

      <StatusBar
        gpsActive={isTracking && !!position}
        gpsAccuracy={accuracy}
        connected={connected}
        backendConnected={backendConnected}
        useBackend={settings.useBackend !== false}
        threatCount={threats.length}
        persistent={settings.persistent}
        voiceEnabled={settings.voiceEnabled}
        voiceControlActive={voiceControlActive}
        onToggleVoice={handleToggleVoice}
        onTogglePersistent={handleTogglePersistent}
        onToggleVoiceControl={voiceSupported ? () => setVoiceControlActive(!voiceControlActive) : null}
        onShowHistory={() => setShowHistory(true)}
        onShowSettings={() => setShowSettings(true)}
        onExit={handleExit}
      />

      <div
        className="cannonball-main"
        onClick={selectedThreat ? handleDeselectThreat : undefined}
      >
        {renderMainContent()}
      </div>

      {/* Edge indicators for peripheral vision */}
      <EdgeIndicators threats={threats} userHeading={heading} />

      {/* Secondary threat list for single mode */}
      {settings.displayMode === 'single' && threats.length > 1 && !selectedThreat && (
        <ThreatList
          threats={threats.slice(1)}
          onSelect={handleSelectThreat}
        />
      )}

      {/* GPS Error (only show if not disabled by user) */}
      {gpsError && !gpsDisabledByUser && (
        <div className="gps-error">
          <MapPinOff size={16} />
          <span>{gpsError}</span>
        </div>
      )}

      {/* Gesture hint overlay */}
      <GestureHint message={gestureHint} />

      {/* GPS Permission Modal */}
      {showGPSModal && (
        <GPSPermissionModal
          permissionState={permissionState}
          onRequestPermission={handleRequestGPSPermission}
          onRetry={handleRetryGPS}
          onContinueWithout={handleContinueWithoutGPS}
          onClose={() => setShowGPSModal(false)}
        />
      )}

      {showHistory && (
        <HistoryPanel
          history={history}
          stats={stats}
          onClear={clearHistory}
          onClose={() => setShowHistory(false)}
        />
      )}

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onChange={handleSettingsChange}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

export default CannonballMode;
