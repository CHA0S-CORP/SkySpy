import React, { memo, useState, useRef, useEffect } from 'react';
import { Columns, Check, RotateCcw } from 'lucide-react';

/**
 * Column visibility selector dropdown
 */
export const ColumnSelector = memo(function ColumnSelector({
  columns,
  visibleColumns,
  presets,
  onToggleColumn,
  onSetPreset,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Determine active preset
  const getActivePreset = () => {
    const sortedVisible = [...visibleColumns].sort();
    for (const [presetName, presetCols] of Object.entries(presets)) {
      const sortedPreset = [...presetCols].sort();
      if (JSON.stringify(sortedVisible) === JSON.stringify(sortedPreset)) {
        return presetName;
      }
    }
    return null;
  };

  const activePreset = getActivePreset();

  return (
    <div className="al-column-selector" ref={dropdownRef}>
      <button
        className={`al-column-btn ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title="Customize columns"
        aria-label="Customize columns"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <Columns size={16} />
        Columns
      </button>

      {isOpen && (
        <div className="al-column-dropdown" role="menu">
          {/* Presets */}
          <div className="al-column-presets">
            <span className="al-column-presets-label">Presets</span>
            <div className="al-preset-buttons">
              {Object.keys(presets).map((preset) => (
                <button
                  key={preset}
                  className={`al-preset-btn ${activePreset === preset ? 'active' : ''}`}
                  onClick={() => {
                    onSetPreset(preset);
                  }}
                >
                  {preset.charAt(0).toUpperCase() + preset.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="al-column-divider" />

          {/* Column Checkboxes */}
          <div className="al-column-list">
            {columns.map((column) => {
              const isVisible = visibleColumns.includes(column.id);
              return (
                <label
                  key={column.id}
                  className={`al-column-item ${isVisible ? 'active' : ''}`}
                  role="menuitemcheckbox"
                  aria-checked={isVisible}
                >
                  <input
                    type="checkbox"
                    checked={isVisible}
                    onChange={() => onToggleColumn(column.id)}
                  />
                  <span className="al-column-checkbox">
                    {isVisible && <Check size={12} />}
                  </span>
                  <span className="al-column-name">{column.label}</span>
                </label>
              );
            })}
          </div>

          <div className="al-column-divider" />

          {/* Reset Button */}
          <button
            className="al-column-reset"
            onClick={() => onSetPreset('default')}
          >
            <RotateCcw size={14} />
            Reset to Default
          </button>
        </div>
      )}
    </div>
  );
});

export default ColumnSelector;
