/**
 * StatusBar - Top bar showing GPS, connection status, and controls
 *
 * Displays:
 * - GPS status and accuracy
 * - Connection status (WebSocket)
 * - Backend API status
 * - Threat count badge
 * - Quick action buttons (voice, history, settings, exit)
 */
import React, { memo } from 'react';
import {
  X, Volume2, VolumeX, History,
  Wifi, WifiOff, MapPin, MapPinOff,
  Settings, AlertTriangle, Eye, EyeOff,
  Mic, MicOff, Server,
} from 'lucide-react';

/**
 * StatusBar component - shows GPS and connection status
 */
export const StatusBar = memo(function StatusBar({
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

export default StatusBar;
