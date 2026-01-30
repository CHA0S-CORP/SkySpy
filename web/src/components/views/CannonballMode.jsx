/**
 * CannonballMode - Glanceable law enforcement detection display
 *
 * A full-screen, high-contrast interface optimized for detecting
 * law enforcement aircraft while driving.
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';

// Hooks
import { useVoiceAlerts } from '../../hooks/useVoiceAlerts';
import { useThreatHistory } from '../../hooks/useThreatHistory';
import { useHapticFeedback } from '../../hooks/useHapticFeedback';
import { useVoiceControl } from '../../hooks/useVoiceControl';
import { useCannonballAPI } from '../../hooks/useCannonballAPI';
import { useGestures } from '../../hooks/useGestures';
import { useWakeLock } from '../../hooks/useWakeLock';
import { useCannonballSettings } from '../../hooks/useCannonballSettings';
import { useThreatCalculation } from '../../hooks/useThreatCalculation';
import { useCannonballGPS, GPS_PERMISSION_STATES } from '../../hooks/useCannonballGPS';

// Sub-components
import { SettingsPanel } from '../cannonball/SettingsPanel';
import { ThreatGrid } from '../cannonball/ThreatGrid';
import { GPSPermissionModal } from '../cannonball/GPSPermissionModal';
import { HistoryPanel } from '../cannonball/HistoryPanel';
import { ThreatDisplay } from '../cannonball/ThreatDisplay';
import { HeadsUpDisplay } from '../cannonball/HeadsUpDisplay';
import { RadarView } from '../cannonball/RadarView';
import { StatusBar } from '../cannonball/StatusBar';
import { ClearStatus } from '../cannonball/ClearStatus';
import { ThreatList } from '../cannonball/ThreatList';
import { EdgeIndicators } from '../cannonball/EdgeIndicators';
import {
  GestureHint,
  GPSDisabledBanner,
  VoiceListeningIndicator,
  GPSErrorDisplay,
  DISPLAY_MODES,
  HIGH_SPEED_THRESHOLD,
} from '../cannonball/UtilityComponents';

/**
 * Main CannonballMode component
 */
export function CannonballMode({ apiBase, onExit, aircraft = [] }) {
  // Settings management
  const { settings, updateSettings } = useCannonballSettings();

  // GPS management
  const {
    position, heading, accuracy, userSpeed, gpsError, permissionState,
    showGPSModal, gpsDisabledByUser, gpsActive,
    handleRequestGPSPermission, handleRetryGPS,
    handleContinueWithoutGPS, handleEnableGPS, closeGPSModal,
  } = useCannonballGPS();

  // Backend API integration
  const {
    threats: backendThreats,
    connected: backendConnected,
    updateLocation,
    setThreatRadius: setBackendThreatRadius,
  } = useCannonballAPI({
    apiBase,
    enabled: settings.useBackend !== false,
    useWebSocket: true,
    threatRadius: settings.threatRadius,
  });

  // UI State
  const [selectedThreat, setSelectedThreat] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [gestureHint, setGestureHint] = useState(null);
  const [voiceControlActive, setVoiceControlActive] = useState(false);

  // Refs
  const criticalVibrationRef = useRef(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  // Wake lock
  useWakeLock(true);

  // Voice alerts
  const {
    announceThreat, announceNewThreat, announceClear, stop: stopVoice,
  } = useVoiceAlerts({ enabled: settings.voiceEnabled, rate: settings.voiceRate });

  // Threat history
  const { history, stats, logThreat, clearHistory } = useThreatHistory({ persistent: settings.persistent });

  // Haptic feedback
  const {
    vibrateNewThreat, vibrateClear, vibrateError, vibrateSelect,
    startContinuousVibration, stopContinuousVibration,
  } = useHapticFeedback({ enabled: settings.hapticEnabled, intensity: settings.hapticIntensity });

  // Threat calculation
  const { threats, connected } = useThreatCalculation({
    aircraft, position, settings, backendThreats, backendConnected,
    announceNewThreat, announceClear, vibrateNewThreat, vibrateClear, logThreat,
  });

  // Send location updates to backend when position changes
  useEffect(() => {
    if (position && settings.useBackend !== false) {
      updateLocation(position.lat, position.lon, heading, userSpeed);
    }
  }, [position, heading, userSpeed, updateLocation, settings.useBackend]);

  // Update backend threat radius when settings change
  useEffect(() => {
    if (settings.useBackend !== false) setBackendThreatRadius(settings.threatRadius);
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

  // Handle GPS error haptic
  useEffect(() => {
    if (gpsError && settings.hapticEnabled) vibrateError();
  }, [gpsError, settings.hapticEnabled, vibrateError]);

  // Gesture hint helper
  const showGestureHintTemp = useCallback((message) => {
    setGestureHint(message);
    setTimeout(() => setGestureHint(null), 1000);
  }, []);

  // Gesture handlers
  const handleSwipeLeft = useCallback(() => {
    const idx = DISPLAY_MODES.indexOf(settings.displayMode);
    const newMode = DISPLAY_MODES[(idx + 1) % DISPLAY_MODES.length];
    updateSettings({ ...settings, displayMode: newMode });
    showGestureHintTemp(newMode === 'headsUp' ? 'Heads-Up Mode' : `${newMode.charAt(0).toUpperCase() + newMode.slice(1)} Mode`);
  }, [settings, updateSettings, showGestureHintTemp]);

  const handleSwipeRight = useCallback(() => {
    const idx = DISPLAY_MODES.indexOf(settings.displayMode);
    const newMode = DISPLAY_MODES[(idx - 1 + DISPLAY_MODES.length) % DISPLAY_MODES.length];
    updateSettings({ ...settings, displayMode: newMode });
    showGestureHintTemp(newMode === 'headsUp' ? 'Heads-Up Mode' : `${newMode.charAt(0).toUpperCase() + newMode.slice(1)} Mode`);
  }, [settings, updateSettings, showGestureHintTemp]);

  const handleSwipeUp = useCallback(() => {
    setShowSettings(true);
    showGestureHintTemp('Settings');
  }, [showGestureHintTemp]);

  const handleSwipeDown = useCallback(() => {
    if (selectedThreat) {
      setSelectedThreat(null);
      showGestureHintTemp('Dismissed');
    }
  }, [selectedThreat, showGestureHintTemp]);

  const handleDoubleTap = useCallback(() => {
    updateSettings({ ...settings, voiceEnabled: !settings.voiceEnabled });
    showGestureHintTemp(settings.voiceEnabled ? 'Voice Off' : 'Voice On');
  }, [settings, updateSettings, showGestureHintTemp]);

  const gestureHandlers = useGestures({
    onSwipeLeft: handleSwipeLeft, onSwipeRight: handleSwipeRight,
    onSwipeUp: handleSwipeUp, onSwipeDown: handleSwipeDown,
    onDoubleTap: handleDoubleTap, enabled: true,
  });

  // Voice control command handler
  const handleVoiceCommand = useCallback((command) => {
    const modeMap = { mode_single: 'single', mode_grid: 'grid', mode_radar: 'radar', mode_headsUp: 'headsUp' };
    if (command === 'mute') updateSettings({ ...settings, voiceEnabled: false });
    else if (command === 'unmute') updateSettings({ ...settings, voiceEnabled: true });
    else if (modeMap[command]) updateSettings({ ...settings, displayMode: modeMap[command] });
    else if (command === 'settings') setShowSettings(true);
    else if (command === 'exit') { stopVoice(); onExitRef.current?.(); }
    else if (command === 'report') {
      if (threats.length > 0) announceThreat(threats[0], { force: true });
      else announceClear?.();
    }
    else if (command === 'dismiss') setSelectedThreat(null);
  }, [settings, updateSettings, stopVoice, announceThreat, announceClear, threats]);

  const { isListening: voiceListening, isSupported: voiceSupported } = useVoiceControl({
    enabled: voiceControlActive, onCommand: handleVoiceCommand, continuous: true,
  });

  // Computed values
  const isHighSpeed = useMemo(() => userSpeed !== null && userSpeed > HIGH_SPEED_THRESHOLD, [userSpeed]);
  const nearestThreat = useMemo(() => selectedThreat || threats[0] || null, [selectedThreat, threats]);
  const threatGlowClass = useMemo(() => {
    if (!threats.length) return '';
    const level = threats[0]?.threat_level;
    return level === 'critical' ? 'threat-glow-critical' : level === 'warning' ? 'threat-glow-warning' : '';
  }, [threats]);

  // Handlers
  const handleExit = useCallback(() => {
    stopVoice();
    if (criticalVibrationRef.current) stopContinuousVibration(criticalVibrationRef.current);
    onExit();
  }, [stopVoice, onExit, stopContinuousVibration]);

  const handleSelectThreat = useCallback((threat) => {
    setSelectedThreat(threat);
    if (settings.voiceEnabled) announceThreat(threat, { force: true });
    if (settings.hapticEnabled) vibrateSelect();
  }, [settings.voiceEnabled, settings.hapticEnabled, announceThreat, vibrateSelect]);

  const handleToggleVoice = useCallback(() => updateSettings({ ...settings, voiceEnabled: !settings.voiceEnabled }), [settings, updateSettings]);
  const handleTogglePersistent = useCallback(() => updateSettings({ ...settings, persistent: !settings.persistent }), [settings, updateSettings]);

  // Render main content based on display mode
  const renderMainContent = () => {
    if (threats.length === 0) {
      return settings.displayMode === 'headsUp'
        ? <HeadsUpDisplay threat={null} threatCount={0} userHeading={heading} gpsActive={gpsActive} />
        : <ClearStatus gpsActive={gpsActive} />;
    }
    switch (settings.displayMode) {
      case 'headsUp':
        return <HeadsUpDisplay threat={nearestThreat} threatCount={threats.length} userHeading={heading} gpsActive={gpsActive} />;
      case 'grid':
        return <ThreatGrid threats={threats} userHeading={heading} maxDisplay={4} onSelectThreat={handleSelectThreat} selectedThreat={selectedThreat} showEta={settings.showEta} />;
      case 'radar':
        return <RadarView threats={threats} userHeading={heading} onThreatClick={handleSelectThreat} selectedThreat={selectedThreat} />;
      default:
        return nearestThreat
          ? <ThreatDisplay threat={nearestThreat} userHeading={heading} showMiniRadar={settings.showMiniRadar} threats={threats} onThreatClick={handleSelectThreat} showUrgency={settings.showUrgencyScore} showAgencyInfo={settings.showAgencyInfo} showPatternDetails={settings.showPatternDetails} />
          : <ClearStatus gpsActive={gpsActive} />;
    }
  };

  return (
    <div className={`cannonball-mode theme-${settings.theme} ${threatGlowClass} ${isHighSpeed ? 'speed-simplified' : ''}`} {...gestureHandlers}>
      {gpsDisabledByUser && <GPSDisabledBanner onEnableGPS={handleEnableGPS} />}
      <VoiceListeningIndicator active={voiceControlActive} listening={voiceListening} />

      <StatusBar
        gpsActive={gpsActive} gpsAccuracy={accuracy} connected={connected}
        backendConnected={backendConnected} useBackend={settings.useBackend !== false}
        threatCount={threats.length} persistent={settings.persistent}
        voiceEnabled={settings.voiceEnabled} voiceControlActive={voiceControlActive}
        onToggleVoice={handleToggleVoice} onTogglePersistent={handleTogglePersistent}
        onToggleVoiceControl={voiceSupported ? () => setVoiceControlActive(!voiceControlActive) : null}
        onShowHistory={() => setShowHistory(true)} onShowSettings={() => setShowSettings(true)}
        onExit={handleExit}
      />

      <div className="cannonball-main" onClick={selectedThreat ? () => setSelectedThreat(null) : undefined}>
        {renderMainContent()}
      </div>

      <EdgeIndicators threats={threats} userHeading={heading} />
      {settings.displayMode === 'single' && threats.length > 1 && !selectedThreat && (
        <ThreatList threats={threats.slice(1)} onSelect={handleSelectThreat} />
      )}
      {!gpsDisabledByUser && <GPSErrorDisplay error={gpsError} />}
      <GestureHint message={gestureHint} />

      {showGPSModal && (
        <GPSPermissionModal
          permissionState={permissionState}
          onRequestPermission={handleRequestGPSPermission}
          onRetry={handleRetryGPS}
          onContinueWithout={handleContinueWithoutGPS}
          onClose={closeGPSModal}
        />
      )}
      {showHistory && <HistoryPanel history={history} stats={stats} onClear={clearHistory} onClose={() => setShowHistory(false)} />}
      {showSettings && <SettingsPanel settings={settings} onChange={updateSettings} onClose={() => setShowSettings(false)} />}
    </div>
  );
}

export default CannonballMode;
