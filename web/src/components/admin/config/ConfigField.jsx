import React, { useState, useCallback } from 'react';
import { Eye, EyeOff, RotateCcw, Info, AlertTriangle } from 'lucide-react';

/**
 * Dynamic field renderer for configuration values.
 * Renders appropriate input based on value_type.
 */
export function ConfigField({
  config,
  value,
  onChange,
  onReset,
  onReveal,
  hasChange = false,
  disabled = false,
}) {
  const [showSecret, setShowSecret] = useState(false);
  const [revealedValue, setRevealedValue] = useState(null);
  const [revealing, setRevealing] = useState(false);

  const handleReveal = useCallback(async () => {
    if (!onReveal) return;

    setRevealing(true);
    try {
      const actualValue = await onReveal(config.key);
      if (actualValue !== null) {
        setRevealedValue(actualValue);
        setShowSecret(true);
      }
    } finally {
      setRevealing(false);
    }
  }, [config.key, onReveal]);

  const handleHide = useCallback(() => {
    setShowSecret(false);
    setRevealedValue(null);
  }, []);

  const handleChange = useCallback(
    (e) => {
      const newValue = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      onChange(config.key, newValue);
    },
    [config.key, onChange]
  );

  const handleReset = useCallback(() => {
    if (onReset) {
      onReset(config.key);
    }
  }, [config.key, onReset]);

  const renderInput = () => {
    const { value_type, validation_rules = {}, is_sensitive, is_readonly } = config;
    const isDisabled = disabled || is_readonly || config.has_env_override;

    // For sensitive fields that haven't been revealed
    if (is_sensitive && !showSecret) {
      return (
        <div className="config-field-secret">
          <input
            type="password"
            value={value || ''}
            onChange={handleChange}
            disabled={isDisabled}
            className={`config-input ${hasChange ? 'config-input-changed' : ''}`}
            placeholder="****"
          />
          <button
            type="button"
            className="config-reveal-btn"
            onClick={handleReveal}
            disabled={revealing || isDisabled}
            title="Reveal value"
          >
            {revealing ? '...' : <Eye size={16} />}
          </button>
        </div>
      );
    }

    // For revealed sensitive fields
    if (is_sensitive && showSecret) {
      return (
        <div className="config-field-secret">
          <input
            type="text"
            value={revealedValue ?? value ?? ''}
            onChange={handleChange}
            disabled={isDisabled}
            className={`config-input ${hasChange ? 'config-input-changed' : ''}`}
          />
          <button
            type="button"
            className="config-reveal-btn"
            onClick={handleHide}
            title="Hide value"
          >
            <EyeOff size={16} />
          </button>
        </div>
      );
    }

    switch (value_type) {
      case 'boolean':
        return (
          <label className="config-toggle">
            <input
              type="checkbox"
              checked={value === true || value === 'true' || value === 'True' || value === '1'}
              onChange={handleChange}
              disabled={isDisabled}
              className={hasChange ? 'config-input-changed' : ''}
            />
            <span className="config-toggle-slider"></span>
            <span className="config-toggle-label">
              {value === true || value === 'true' || value === 'True' || value === '1'
                ? 'Enabled'
                : 'Disabled'}
            </span>
          </label>
        );

      case 'integer':
        return (
          <input
            type="number"
            value={value ?? ''}
            onChange={handleChange}
            disabled={isDisabled}
            min={validation_rules.min}
            max={validation_rules.max}
            step={1}
            className={`config-input ${hasChange ? 'config-input-changed' : ''}`}
          />
        );

      case 'float':
        return (
          <input
            type="number"
            value={value ?? ''}
            onChange={handleChange}
            disabled={isDisabled}
            min={validation_rules.min}
            max={validation_rules.max}
            step={0.1}
            className={`config-input ${hasChange ? 'config-input-changed' : ''}`}
          />
        );

      case 'json':
        return (
          <textarea
            value={typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
            onChange={handleChange}
            disabled={isDisabled}
            rows={4}
            className={`config-input config-input-json ${hasChange ? 'config-input-changed' : ''}`}
            spellCheck={false}
          />
        );

      case 'string':
      case 'secret':
      default:
        // Check if choices are defined
        if (validation_rules.choices && validation_rules.choices.length > 0) {
          return (
            <select
              value={value ?? ''}
              onChange={handleChange}
              disabled={isDisabled}
              className={`config-input ${hasChange ? 'config-input-changed' : ''}`}
            >
              <option value="">Select...</option>
              {validation_rules.choices.map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </select>
          );
        }

        return (
          <input
            type="text"
            value={value ?? ''}
            onChange={handleChange}
            disabled={isDisabled}
            className={`config-input ${hasChange ? 'config-input-changed' : ''}`}
          />
        );
    }
  };

  return (
    <div
      className={`config-field ${hasChange ? 'config-field-changed' : ''} ${config.is_readonly ? 'config-field-readonly' : ''}`}
    >
      <div className="config-field-header">
        <label className="config-field-label">
          {config.display_name}
          {config.requires_restart && (
            <span className="config-restart-badge" title="Requires restart">
              <AlertTriangle size={12} />
            </span>
          )}
          {config.has_env_override && (
            <span className="config-env-badge" title="Overridden by environment variable">
              ENV
            </span>
          )}
        </label>
        {hasChange && onReset && (
          <button
            type="button"
            className="config-reset-btn"
            onClick={handleReset}
            title="Reset to original value"
          >
            <RotateCcw size={14} />
          </button>
        )}
      </div>

      {renderInput()}

      {config.description && (
        <p className="config-field-description">
          <Info size={12} />
          {config.description}
        </p>
      )}

      {config.env_var && (
        <p className="config-field-env">
          Environment variable: <code>{config.env_var}</code>
        </p>
      )}

      {config.validation_rules &&
        (config.validation_rules.min !== undefined ||
          config.validation_rules.max !== undefined) && (
          <p className="config-field-range">
            Range: {config.validation_rules.min ?? '-∞'} to {config.validation_rules.max ?? '∞'}
          </p>
        )}
    </div>
  );
}
