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
 * - Multiple display modes (single, grid, radar)
 * - Theme support (dark, red, highContrast)
 * - Settings persistence
 * - Wake lock to prevent screen sleep
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  X, Navigation2, Volume2, VolumeX, History, Trash2,
  Wifi, WifiOff, MapPin, MapPinOff, Settings, AlertTriangle,
  Eye, EyeOff, ChevronUp, ChevronDown, Minus,
} from 'lucide-react';

import { useDeviceGPS } from '../../hooks/useDeviceGPS';
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

// Sub-components
import { SettingsPanel, DEFAULT_SETTINGS } from '../cannonball/SettingsPanel';
import { ThreatGrid } from '../cannonball/ThreatGrid';
import { MiniRadar } from '../cannonball/MiniRadar';

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
function StatusBar({
  gpsActive,
  gpsAccuracy,
  connected,
  threatCount,
  persistent,
  voiceEnabled,
  onToggleVoice,
  onTogglePersistent,
  onShowHistory,
  onShowSettings,
  onExit,
}) {
  return (
    <div className="cannonball-status-bar">
      <div className="status-left">
        <div className={`status-indicator ${gpsActive ? 'active' : 'inactive'}`}>
          {gpsActive ? <MapPin size={16} /> : <MapPinOff size={16} />}
          <span>{gpsActive ? `GPS ${gpsAccuracy ? `(${Math.round(gpsAccuracy)}m)` : ''}` : 'NO GPS'}</span>
        </div>
        <div className={`status-indicator ${connected ? 'active' : 'inactive'}`}>
          {connected ? <Wifi size={16} /> : <WifiOff size={16} />}
          <span>{connected ? 'LIVE' : 'OFFLINE'}</span>
        </div>
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
          {voiceEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </button>
        <button
          className={`status-btn ${persistent ? 'active' : ''}`}
          onClick={onTogglePersistent}
          title={persistent ? 'History enabled' : 'Ephemeral mode'}
        >
          {persistent ? <Eye size={18} /> : <EyeOff size={18} />}
        </button>
        <button className="status-btn" onClick={onShowHistory} title="View history">
          <History size={18} />
        </button>
        <button className="status-btn" onClick={onShowSettings} title="Settings">
          <Settings size={18} />
        </button>
        <button className="status-btn exit-btn" onClick={onExit} title="Exit Cannonball">
          <X size={20} />
        </button>
      </div>
    </div>
  );
}

/**
 * DirectionArrow component - rotates based on threat bearing
 */
function DirectionArrow({ bearing, userHeading, threatLevel }) {
  // Calculate relative bearing if user heading is available
  const rotation = userHeading !== null
    ? (bearing - userHeading + 360) % 360
    : bearing;

  return (
    <div
      className={`direction-arrow threat-${threatLevel}`}
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      <Navigation2 size={80} />
    </div>
  );
}

/**
 * ThreatDisplay component - main threat information (single mode)
 */
function ThreatDisplay({ threat, userHeading, showMiniRadar, threats, onThreatClick }) {
  const threatLevel = threat.threat_level || 'info';

  // Format distance
  const formatDistance = (nm) => {
    if (nm < 0.5) {
      const feet = Math.round(nm * 6076.12 / 100) * 100;
      return { value: feet, unit: 'FT' };
    } else if (nm < 10) {
      return { value: nm.toFixed(1), unit: 'NM' };
    } else {
      return { value: Math.round(nm), unit: 'NM' };
    }
  };

  const distance = formatDistance(threat.distance_nm);

  // Trend indicator
  const TrendIcon = threat.trend === 'approaching' ? ChevronDown
    : threat.trend === 'departing' ? ChevronUp
    : Minus;

  return (
    <div className={`threat-display threat-${threatLevel}`}>
      <div className="threat-header">
        <span className="threat-category">{threat.category || 'AIRCRAFT'}</span>
        {threat.callsign && (
          <span className="threat-callsign">{threat.callsign}</span>
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
}

/**
 * ClearStatus component - shown when no threats
 */
function ClearStatus({ gpsActive }) {
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
}

/**
 * ThreatList component - secondary threats
 */
function ThreatList({ threats, onSelect }) {
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
        </button>
      ))}
    </div>
  );
}

/**
 * HistoryPanel component - threat encounter history
 */
function HistoryPanel({ history, stats, onClear, onClose }) {
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
}

/**
 * RadarView component - full screen radar display mode
 */
function RadarView({ threats, userHeading, onThreatClick, selectedThreat }) {
  return (
    <div className="radar-view">
      <MiniRadar
        threats={threats}
        userHeading={userHeading}
        size={Math.min(window.innerWidth - 40, window.innerHeight - 200)}
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
}

/**
 * Main CannonballMode component
 */
export function CannonballMode({ apiBase, onExit, aircraft = [] }) {
  // Load settings from localStorage
  const [settings, setSettings] = useState(loadSettings);

  // State
  const [threats, setThreats] = useState([]);
  const [selectedThreat, setSelectedThreat] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [connected, setConnected] = useState(false);

  // Refs
  const wakeLockRef = useRef(null);
  const lastThreatsRef = useRef([]);
  const criticalVibrationRef = useRef(null);

  // Settings handlers
  const handleSettingsChange = useCallback((newSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
  }, []);

  // Hooks
  const {
    position,
    heading,
    accuracy,
    isTracking,
    error: gpsError,
  } = useDeviceGPS({ enabled: true, interval: 3000, highAccuracy: true });

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

  // Get nearest threat
  const nearestThreat = useMemo(() => {
    return selectedThreat || threats[0] || null;
  }, [selectedThreat, threats]);

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

  // Calculate threats from aircraft list when position is available
  useEffect(() => {
    if (!position || !aircraft.length) return;

    const calculatedThreats = [];

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

      // Calculate distance and bearing
      const distanceNm = calculateDistanceNm(position.lat, position.lon, ac.lat, ac.lon);

      // Apply radius filter
      if (distanceNm > settings.threatRadius) continue;

      // Apply altitude filters
      const altitude = ac.alt_baro || ac.alt_geom || ac.alt || 0;
      if (altitude < settings.altitudeFloor || altitude > settings.altitudeCeiling) continue;
      if (altitude > settings.ignoreAboveAltitude) continue;

      // Check whitelisted hexes
      if (settings.whitelistedHexes.includes(ac.hex)) continue;

      const bearing = calculateBearing(position.lat, position.lon, ac.lat, ac.lon);
      const threatLevel = getThreatLevel(ac, distanceNm, leInfo);

      // Determine trend by comparing with previous threats
      let trend = 'unknown';
      const prevThreat = lastThreatsRef.current.find(t => t.hex === ac.hex);
      if (prevThreat) {
        const distDiff = distanceNm - prevThreat.distance_nm;
        if (distDiff < -0.05) trend = 'approaching';
        else if (distDiff > 0.05) trend = 'departing';
        else trend = 'holding';
      }

      calculatedThreats.push({
        hex: ac.hex,
        callsign: (ac.flight || '').trim() || null,
        category: leInfo.category || (leInfo.isHelicopter ? 'Helicopter' : 'Aircraft'),
        description: leInfo.description,
        distance_nm: distanceNm,
        bearing,
        direction: getDirectionName(bearing),
        altitude,
        ground_speed: ac.gs,
        vertical_rate: ac.baro_rate || ac.geom_rate,
        trend,
        threat_level: threatLevel,
        is_law_enforcement: leInfo.isLawEnforcement,
        is_helicopter: leInfo.isHelicopter,
        lat: ac.lat,
        lon: ac.lon,
      });
    }

    // Sort by threat level then distance
    const threatOrder = { critical: 0, warning: 1, info: 2 };
    calculatedThreats.sort((a, b) => {
      const levelDiff = (threatOrder[a.threat_level] || 3) - (threatOrder[b.threat_level] || 3);
      if (levelDiff !== 0) return levelDiff;
      return a.distance_nm - b.distance_nm;
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

    lastThreatsRef.current = calculatedThreats;
    setThreats(calculatedThreats);
    setConnected(true);
  }, [
    position, aircraft, settings, announceNewThreat, announceClear, logThreat,
    vibrateNewThreat, vibrateClear
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
  const renderMainContent = () => {
    if (threats.length === 0) {
      return <ClearStatus gpsActive={isTracking && !!position} />;
    }

    switch (settings.displayMode) {
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
          />
        ) : (
          <ClearStatus gpsActive={isTracking && !!position} />
        );
    }
  };

  return (
    <div
      className={`cannonball-mode ${themeClass}`}
      onClick={selectedThreat ? handleDeselectThreat : undefined}
    >
      <StatusBar
        gpsActive={isTracking && !!position}
        gpsAccuracy={accuracy}
        connected={connected}
        threatCount={threats.length}
        persistent={settings.persistent}
        voiceEnabled={settings.voiceEnabled}
        onToggleVoice={handleToggleVoice}
        onTogglePersistent={handleTogglePersistent}
        onShowHistory={() => setShowHistory(true)}
        onShowSettings={() => setShowSettings(true)}
        onExit={handleExit}
      />

      <div className="cannonball-main">
        {renderMainContent()}
      </div>

      {/* Secondary threat list for single mode */}
      {settings.displayMode === 'single' && threats.length > 1 && !selectedThreat && (
        <ThreatList
          threats={threats.slice(1)}
          onSelect={handleSelectThreat}
        />
      )}

      {gpsError && (
        <div className="gps-error">
          <MapPinOff size={16} />
          <span>{gpsError}</span>
        </div>
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
