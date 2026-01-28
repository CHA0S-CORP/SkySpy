/**
 * SettingsPanel - Quick settings drawer for Cannonball Mode
 *
 * Swipe-down accessible panel with:
 * - Quick toggles (voice, haptic, sound, persistence)
 * - Threat radius slider
 * - Voice rate adjustment
 * - Theme selector
 * - Smart filtering options
 */
import React, { useState, useCallback } from 'react';
import {
  X, Volume2, VolumeX, Smartphone, Eye, EyeOff,
  Bell, BellOff, Radar, Filter, Moon, Sun,
  ChevronDown, ChevronUp, Vibrate,
  Plane, Shield, AlertTriangle, Navigation, Server, Cpu
} from 'lucide-react';

// Default settings
export const DEFAULT_SETTINGS = {
  // Alerts
  voiceEnabled: true,
  voiceRate: 1.0,
  audioEnabled: true,
  audioVolume: 0.7,
  hapticEnabled: true,
  hapticIntensity: 'normal', // gentle, normal, strong

  // Display
  theme: 'dark', // dark, red, highContrast, amoled, daylight
  displayMode: 'single', // single, grid, radar, headsUp
  showEta: true,
  showMiniRadar: true,
  showUrgencyScore: true,
  autoBrightness: true,

  // Filtering
  threatRadius: 25, // nm
  showAllHelicopters: true,
  showLawEnforcementOnly: false,
  altitudeFloor: 0, // feet
  altitudeCeiling: 50000, // feet
  ignoreAboveAltitude: 20000, // ignore cruise traffic
  whitelistedHexes: [], // Aircraft to ignore

  // History
  persistent: true,
  autoLogCritical: true,

  // Behavior detection
  detectCircling: true,
  detectLoitering: true,
  loiterThreshold: 10, // minutes

  // Backend integration
  useBackend: true, // Use server-side pattern detection
  showPatternDetails: true, // Show detailed pattern info
  showAgencyInfo: true, // Show agency name when known
};

function ToggleButton({ active, onToggle, icon: Icon, activeIcon: ActiveIcon, label }) {
  const DisplayIcon = active ? (ActiveIcon || Icon) : Icon;
  return (
    <button
      className={`settings-toggle ${active ? 'active' : ''}`}
      onClick={onToggle}
    >
      <DisplayIcon size={20} />
      <span>{label}</span>
    </button>
  );
}

function SliderSetting({ label, value, onChange, min, max, step = 1, unit = '' }) {
  return (
    <div className="settings-slider">
      <div className="slider-header">
        <span className="slider-label">{label}</span>
        <span className="slider-value">{value}{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

function SectionHeader({ title, expanded, onToggle }) {
  return (
    <button className="settings-section-header" onClick={onToggle}>
      <span>{title}</span>
      {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
    </button>
  );
}

export function SettingsPanel({ settings, onChange, onClose }) {
  const [expandedSection, setExpandedSection] = useState('alerts');

  const updateSetting = useCallback((key, value) => {
    onChange({ ...settings, [key]: value });
  }, [settings, onChange]);

  const toggleSection = useCallback((section) => {
    setExpandedSection(prev => prev === section ? null : section);
  }, []);

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <h3>Settings</h3>
        <button className="close-btn" onClick={onClose}>
          <X size={20} />
        </button>
      </div>

      <div className="settings-content">
        {/* Quick Toggles - Always visible */}
        <div className="settings-quick-toggles">
          <ToggleButton
            active={settings.voiceEnabled}
            onToggle={() => updateSetting('voiceEnabled', !settings.voiceEnabled)}
            icon={VolumeX}
            activeIcon={Volume2}
            label="Voice"
          />
          <ToggleButton
            active={settings.audioEnabled}
            onToggle={() => updateSetting('audioEnabled', !settings.audioEnabled)}
            icon={BellOff}
            activeIcon={Bell}
            label="Tones"
          />
          <ToggleButton
            active={settings.hapticEnabled}
            onToggle={() => updateSetting('hapticEnabled', !settings.hapticEnabled)}
            icon={Vibrate}
            label="Haptic"
          />
          <ToggleButton
            active={settings.persistent}
            onToggle={() => updateSetting('persistent', !settings.persistent)}
            icon={EyeOff}
            activeIcon={Eye}
            label="History"
          />
        </div>

        {/* Alerts Section */}
        <div className="settings-section">
          <SectionHeader
            title="Alerts"
            expanded={expandedSection === 'alerts'}
            onToggle={() => toggleSection('alerts')}
          />
          {expandedSection === 'alerts' && (
            <div className="section-content">
              <SliderSetting
                label="Voice Speed"
                value={settings.voiceRate}
                onChange={(v) => updateSetting('voiceRate', v)}
                min={0.5}
                max={2.0}
                step={0.1}
                unit="x"
              />
              <SliderSetting
                label="Tone Volume"
                value={Math.round(settings.audioVolume * 100)}
                onChange={(v) => updateSetting('audioVolume', v / 100)}
                min={0}
                max={100}
                unit="%"
              />
              <div className="settings-row">
                <span>Haptic Intensity</span>
                <div className="button-group">
                  {['gentle', 'normal', 'strong'].map(intensity => (
                    <button
                      key={intensity}
                      className={settings.hapticIntensity === intensity ? 'active' : ''}
                      onClick={() => updateSetting('hapticIntensity', intensity)}
                    >
                      {intensity}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Display Section */}
        <div className="settings-section">
          <SectionHeader
            title="Display"
            expanded={expandedSection === 'display'}
            onToggle={() => toggleSection('display')}
          />
          {expandedSection === 'display' && (
            <div className="section-content">
              <div className="settings-row">
                <span>Theme</span>
                <div className="button-group">
                  <button
                    className={settings.theme === 'dark' ? 'active' : ''}
                    onClick={() => updateSetting('theme', 'dark')}
                  >
                    <Moon size={14} /> Dark
                  </button>
                  <button
                    className={settings.theme === 'amoled' ? 'active' : ''}
                    onClick={() => updateSetting('theme', 'amoled')}
                  >
                    AMOLED
                  </button>
                  <button
                    className={settings.theme === 'daylight' ? 'active' : ''}
                    onClick={() => updateSetting('theme', 'daylight')}
                  >
                    <Sun size={14} /> Day
                  </button>
                </div>
              </div>
              <div className="settings-row">
                <span>More Themes</span>
                <div className="button-group">
                  <button
                    className={settings.theme === 'red' ? 'active' : ''}
                    onClick={() => updateSetting('theme', 'red')}
                  >
                    Red
                  </button>
                  <button
                    className={settings.theme === 'highContrast' ? 'active' : ''}
                    onClick={() => updateSetting('theme', 'highContrast')}
                  >
                    High Contrast
                  </button>
                </div>
              </div>
              <div className="settings-row">
                <span>View Mode</span>
                <div className="button-group">
                  <button
                    className={settings.displayMode === 'single' ? 'active' : ''}
                    onClick={() => updateSetting('displayMode', 'single')}
                  >
                    Single
                  </button>
                  <button
                    className={settings.displayMode === 'headsUp' ? 'active' : ''}
                    onClick={() => updateSetting('displayMode', 'headsUp')}
                  >
                    <Navigation size={14} /> HUD
                  </button>
                  <button
                    className={settings.displayMode === 'grid' ? 'active' : ''}
                    onClick={() => updateSetting('displayMode', 'grid')}
                  >
                    Grid
                  </button>
                  <button
                    className={settings.displayMode === 'radar' ? 'active' : ''}
                    onClick={() => updateSetting('displayMode', 'radar')}
                  >
                    <Radar size={14} /> Radar
                  </button>
                </div>
              </div>
              <div className="settings-toggle-row">
                <span>Show ETA</span>
                <input
                  type="checkbox"
                  checked={settings.showEta}
                  onChange={(e) => updateSetting('showEta', e.target.checked)}
                />
              </div>
              <div className="settings-toggle-row">
                <span>Mini Radar</span>
                <input
                  type="checkbox"
                  checked={settings.showMiniRadar}
                  onChange={(e) => updateSetting('showMiniRadar', e.target.checked)}
                />
              </div>
              <div className="settings-toggle-row">
                <span>Show Urgency Score</span>
                <input
                  type="checkbox"
                  checked={settings.showUrgencyScore}
                  onChange={(e) => updateSetting('showUrgencyScore', e.target.checked)}
                />
              </div>
            </div>
          )}
        </div>

        {/* Filtering Section */}
        <div className="settings-section">
          <SectionHeader
            title="Filtering"
            expanded={expandedSection === 'filtering'}
            onToggle={() => toggleSection('filtering')}
          />
          {expandedSection === 'filtering' && (
            <div className="section-content">
              <SliderSetting
                label="Threat Radius"
                value={settings.threatRadius}
                onChange={(v) => updateSetting('threatRadius', v)}
                min={5}
                max={50}
                unit=" nm"
              />
              <SliderSetting
                label="Ignore Above"
                value={settings.ignoreAboveAltitude / 1000}
                onChange={(v) => updateSetting('ignoreAboveAltitude', v * 1000)}
                min={5}
                max={50}
                unit="k ft"
              />
              <div className="settings-toggle-row">
                <span><Plane size={14} /> All Helicopters</span>
                <input
                  type="checkbox"
                  checked={settings.showAllHelicopters}
                  onChange={(e) => updateSetting('showAllHelicopters', e.target.checked)}
                />
              </div>
              <div className="settings-toggle-row">
                <span><Shield size={14} /> Law Enforcement Only</span>
                <input
                  type="checkbox"
                  checked={settings.showLawEnforcementOnly}
                  onChange={(e) => updateSetting('showLawEnforcementOnly', e.target.checked)}
                />
              </div>
            </div>
          )}
        </div>

        {/* Behavior Detection Section */}
        <div className="settings-section">
          <SectionHeader
            title="Behavior Detection"
            expanded={expandedSection === 'behavior'}
            onToggle={() => toggleSection('behavior')}
          />
          {expandedSection === 'behavior' && (
            <div className="section-content">
              <div className="settings-toggle-row">
                <span>Detect Circling/Orbits</span>
                <input
                  type="checkbox"
                  checked={settings.detectCircling}
                  onChange={(e) => updateSetting('detectCircling', e.target.checked)}
                />
              </div>
              <div className="settings-toggle-row">
                <span>Detect Loitering</span>
                <input
                  type="checkbox"
                  checked={settings.detectLoitering}
                  onChange={(e) => updateSetting('detectLoitering', e.target.checked)}
                />
              </div>
              <SliderSetting
                label="Loiter Threshold"
                value={settings.loiterThreshold}
                onChange={(v) => updateSetting('loiterThreshold', v)}
                min={5}
                max={30}
                unit=" min"
              />
            </div>
          )}
        </div>

        {/* Backend/Advanced Section */}
        <div className="settings-section">
          <SectionHeader
            title="Advanced"
            expanded={expandedSection === 'advanced'}
            onToggle={() => toggleSection('advanced')}
          />
          {expandedSection === 'advanced' && (
            <div className="section-content">
              <div className="settings-toggle-row">
                <span><Server size={14} /> Use Server Analysis</span>
                <input
                  type="checkbox"
                  checked={settings.useBackend !== false}
                  onChange={(e) => updateSetting('useBackend', e.target.checked)}
                />
              </div>
              <div className="settings-info">
                {settings.useBackend !== false
                  ? 'Using server-side LE database and pattern detection for enhanced accuracy.'
                  : 'Using local analysis only. Enable server analysis for better LE identification.'}
              </div>
              <div className="settings-toggle-row">
                <span>Show Pattern Details</span>
                <input
                  type="checkbox"
                  checked={settings.showPatternDetails}
                  onChange={(e) => updateSetting('showPatternDetails', e.target.checked)}
                  disabled={!settings.useBackend}
                />
              </div>
              <div className="settings-toggle-row">
                <span>Show Agency Info</span>
                <input
                  type="checkbox"
                  checked={settings.showAgencyInfo}
                  onChange={(e) => updateSetting('showAgencyInfo', e.target.checked)}
                  disabled={!settings.useBackend}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Reset button */}
      <div className="settings-footer">
        <button
          className="reset-btn"
          onClick={() => onChange(DEFAULT_SETTINGS)}
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}

export default SettingsPanel;
