import React, { useCallback } from 'react';
import { X, MountainSnow, Eye, EyeOff, RotateCcw } from 'lucide-react';
import { RangeSlider } from '../../common';
import { ALTITUDE_PRESETS } from '../../../hooks/useAltitudeFilter';

/**
 * AltitudeFilterPanel - Quick altitude band filter for Pro Mode
 *
 * Features:
 * - Preset altitude bands (Low, Transition, High, Upper, Super High)
 * - Custom range with dual-handle slider
 * - Toggle between dim and hide filtered aircraft
 * - Keyboard shortcut 'A' to toggle panel
 */
export function AltitudeFilterPanel({
  show,
  onClose,
  altitudeFilter,
  setAltitudePreset,
  setCustomRange,
  toggleHideFiltered,
  resetFilter,
}) {
  // Hooks must be called unconditionally (before any early returns)
  const handlePresetClick = useCallback((presetKey) => {
    setAltitudePreset(presetKey);
  }, [setAltitudePreset]);

  const handleRangeChange = useCallback(([min, max]) => {
    setCustomRange(min, max);
  }, [setCustomRange]);

  // Early return after hooks
  if (!show) return null;

  const formatAltitude = (value) => {
    if (value >= 1000) {
      return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
    }
    return value.toString();
  };

  // Preset buttons configuration
  const presets = [
    { key: 'all', label: 'All', shortLabel: 'All' },
    { key: 'low', label: 'Surface - 10k', shortLabel: 'Low' },
    { key: 'transition', label: '10k - 18k', shortLabel: 'Trans' },
    { key: 'high', label: '18k - 29k', shortLabel: 'High' },
    { key: 'upper', label: '29k - 45k', shortLabel: 'Upper' },
    { key: 'superHigh', label: '45k+', shortLabel: 'Super' },
  ];

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="altitude-filter-panel overlay-menu"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="overlay-menu-header">
        <span>
          <MountainSnow size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
          Altitude Filter
        </span>
        <button onClick={onClose} title="Close (A)">
          <X size={14} />
        </button>
      </div>

      {/* Preset buttons */}
      <div className="altitude-presets">
        {presets.map((preset) => (
          <button
            key={preset.key}
            className={`altitude-preset-btn ${altitudeFilter.preset === preset.key ? 'active' : ''}`}
            onClick={() => handlePresetClick(preset.key)}
            title={ALTITUDE_PRESETS[preset.key]?.label || preset.label}
          >
            <span className="preset-short">{preset.shortLabel}</span>
            <span className="preset-full">{preset.label}</span>
          </button>
        ))}
      </div>

      <div className="overlay-divider" />

      {/* Custom range slider */}
      <div className="altitude-custom-range">
        <div className="range-header">
          <span>Custom Range</span>
          <button
            className={`custom-preset-btn ${altitudeFilter.preset === 'custom' ? 'active' : ''}`}
            onClick={() => handlePresetClick('custom')}
          >
            Custom
          </button>
        </div>
        <RangeSlider
          min={0}
          max={60000}
          step={1000}
          value={[altitudeFilter.min, altitudeFilter.max]}
          onChange={handleRangeChange}
          formatValue={formatAltitude}
          unit="ft"
          color="var(--accent-cyan)"
          disabled={!altitudeFilter.enabled && altitudeFilter.preset === 'all'}
        />
      </div>

      <div className="overlay-divider" />

      {/* Display mode toggle */}
      <div className="altitude-display-mode">
        <span className="mode-label">Filtered aircraft:</span>
        <div className="mode-buttons">
          <button
            className={`mode-btn ${!altitudeFilter.hideFiltered ? 'active' : ''}`}
            onClick={() => altitudeFilter.hideFiltered && toggleHideFiltered()}
            title="Dim filtered aircraft (15% opacity)"
          >
            <Eye size={14} />
            <span>Dim</span>
          </button>
          <button
            className={`mode-btn ${altitudeFilter.hideFiltered ? 'active' : ''}`}
            onClick={() => !altitudeFilter.hideFiltered && toggleHideFiltered()}
            title="Hide filtered aircraft completely"
          >
            <EyeOff size={14} />
            <span>Hide</span>
          </button>
        </div>
      </div>

      {/* Reset button */}
      <div className="overlay-divider" />
      <button className="filter-reset-btn" onClick={resetFilter}>
        <RotateCcw size={14} />
        <span>Reset</span>
      </button>

      {/* Current filter status */}
      {altitudeFilter.enabled && (
        <div className="altitude-status">
          <span className="status-label">Active:</span>
          <span className="status-value">
            {formatAltitude(altitudeFilter.min)}&apos; - {formatAltitude(altitudeFilter.max)}&apos;
          </span>
        </div>
      )}
    </div>
  );
}

export default AltitudeFilterPanel;
