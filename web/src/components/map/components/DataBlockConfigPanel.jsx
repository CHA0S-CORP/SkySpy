import React, { useMemo } from 'react';
import { X, RotateCcw, Eye, EyeOff, Settings2 } from 'lucide-react';
import { FIELD_DEFINITIONS, MODE_DEFINITIONS } from '../../../hooks/useDataBlockConfig';

/**
 * DataBlockConfigPanel - Configuration panel for aircraft data block display
 *
 * Provides controls for:
 * - Display mode selection (Full/Compact/Minimal)
 * - Individual field toggles
 * - Preview of current configuration
 */
export function DataBlockConfigPanel({
  config,
  onUpdateField,
  onSetMode,
  onReset,
  onClose,
  isPro = true,
}) {
  // Generate preview lines based on current config
  const previewLines = useMemo(() => {
    const { mode, fields } = config;
    const lines = [];

    // Sample data for preview
    const sampleData = {
      callsign: 'UAL123',
      altitude: 'FL350',
      speed: '450kts',
      heading: '270',
      verticalSpeed: '+1500fpm',
      type: 'B738',
      squawk: '1200',
      distance: '45.2nm',
      wakeCategory: 'M',
    };

    if (mode === 'minimal') {
      lines.push(sampleData.callsign);
    } else if (mode === 'compact') {
      const parts = [sampleData.callsign];
      if (fields.speed) parts.push(sampleData.speed);
      if (fields.altitude) parts.push(sampleData.altitude);
      if (fields.heading) parts.push(`${sampleData.heading}\u00B0`);
      if (fields.verticalSpeed) parts.push(sampleData.verticalSpeed);
      if (fields.type) parts.push(sampleData.type);
      if (fields.squawk) parts.push(sampleData.squawk);
      if (fields.distance) parts.push(sampleData.distance);
      if (fields.wakeCategory) parts.push(`[${sampleData.wakeCategory}]`);
      lines.push(parts.join(' '));
    } else {
      // Full mode
      lines.push(sampleData.callsign);
      const line2Parts = [];
      if (fields.speed) line2Parts.push(sampleData.speed);
      if (fields.altitude) line2Parts.push(sampleData.altitude);
      if (line2Parts.length > 0) lines.push(line2Parts.join(' '));
      if (fields.heading) lines.push(`HDG ${sampleData.heading}\u00B0`);
      if (fields.verticalSpeed) lines.push(`VS ${sampleData.verticalSpeed}`);
      if (fields.type) lines.push(sampleData.type);
      if (fields.squawk) lines.push(`SQK ${sampleData.squawk}`);
      if (fields.distance) lines.push(`DST ${sampleData.distance}`);
      if (fields.wakeCategory) lines.push(`WTC ${sampleData.wakeCategory}`);
    }

    return lines;
  }, [config]);

  const enabledCount = Object.values(config.fields).filter(Boolean).length;

  return (
    <div className={`datablock-config-panel ${isPro ? 'pro-style' : ''}`}>
      {/* Header */}
      <div className="datablock-config-header">
        <div className="datablock-config-title">
          <Settings2 size={14} />
          <span>Data Block Config</span>
        </div>
        <button
          className="datablock-config-close"
          onClick={onClose}
          aria-label="Close configuration panel"
        >
          <X size={14} />
        </button>
      </div>

      {/* Display Mode Selection */}
      <div className="datablock-config-section">
        <div className="datablock-section-title">Display Mode</div>
        <div className="datablock-mode-group">
          {MODE_DEFINITIONS.map((mode) => (
            <label key={mode.key} className="datablock-mode-option">
              <input
                type="radio"
                name="datablock-mode"
                value={mode.key}
                checked={config.mode === mode.key}
                onChange={() => onSetMode(mode.key)}
              />
              <span className="datablock-mode-label">
                <span className="mode-name">{mode.label}</span>
                <span className="mode-description">{mode.description}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Field Toggles */}
      <div className="datablock-config-section">
        <div className="datablock-section-title">
          <span>Fields ({enabledCount} enabled)</span>
          <button
            className="datablock-field-action"
            onClick={onReset}
            title="Reset to defaults"
          >
            <RotateCcw size={12} />
          </button>
        </div>

        {/* Callsign - always on */}
        <div className="datablock-field-item disabled">
          <div className="datablock-field-info">
            <span className="field-name">Callsign</span>
            <span className="field-description">Always visible</span>
          </div>
          <div className="datablock-field-toggle locked">
            <Eye size={14} />
          </div>
        </div>

        {/* Toggleable fields */}
        {FIELD_DEFINITIONS.map((field) => (
          <label key={field.key} className="datablock-field-item">
            <div className="datablock-field-info">
              <span className="field-name">{field.label}</span>
              <span className="field-description">{field.description}</span>
            </div>
            <button
              className={`datablock-field-toggle ${config.fields[field.key] ? 'active' : ''}`}
              onClick={() => onUpdateField(field.key, !config.fields[field.key])}
              aria-label={`${config.fields[field.key] ? 'Hide' : 'Show'} ${field.label}`}
            >
              {config.fields[field.key] ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
          </label>
        ))}
      </div>

      {/* Preview */}
      <div className="datablock-config-section">
        <div className="datablock-section-title">Preview</div>
        <div className={`datablock-preview ${isPro ? 'pro-style' : ''}`}>
          {/* Leader line simulation */}
          <div className="preview-leader-line" />
          {/* Blip simulation */}
          <div className="preview-blip" />
          {/* Data block */}
          <div className="preview-datablock">
            {previewLines.map((line, idx) => (
              <div key={idx} className={`preview-line ${idx === 0 ? 'callsign' : 'data'}`}>
                {line}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default DataBlockConfigPanel;
