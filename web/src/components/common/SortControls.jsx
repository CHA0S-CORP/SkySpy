import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, ArrowUp, ArrowDown } from 'lucide-react';

/**
 * Reusable Sort Controls Component
 *
 * Desktop: Displays as pill buttons
 * Mobile: Displays as a dropdown selector
 *
 * @param {Object} props
 * @param {Array} props.fields - Array of field configs: { key, label, defaultDirection? }
 * @param {string} props.activeField - Currently active sort field
 * @param {string} props.direction - 'asc' or 'desc'
 * @param {Function} props.onSort - Callback when sort changes: (fieldKey) => void
 * @param {string} [props.className] - Additional CSS class
 * @param {boolean} [props.compact] - Use compact styling
 */
export function SortControls({
  fields,
  activeField,
  direction,
  onSort,
  className = '',
  compact = false
}) {
  const [isMobileDropdownOpen, setIsMobileDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isMobileDropdownOpen) return;

    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsMobileDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMobileDropdownOpen]);

  const activeFieldConfig = fields.find(f => f.key === activeField);
  const activeLabel = activeFieldConfig?.label || activeField;

  const DirectionIcon = direction === 'asc' ? ArrowUp : ArrowDown;

  return (
    <div className={`sort-controls-container ${compact ? 'compact' : ''} ${className}`}>
      {/* Desktop: Pill buttons */}
      <div className="sort-controls-pills">
        <span className="sort-controls-label">Sort:</span>
        {fields.map((field) => (
          <button
            key={field.key}
            className={`sort-pill ${activeField === field.key ? 'active' : ''}`}
            onClick={() => onSort(field.key)}
            title={`Sort by ${field.label}`}
          >
            {field.label}
            {activeField === field.key && (
              <DirectionIcon size={12} className="sort-direction-icon" />
            )}
          </button>
        ))}
      </div>

      {/* Mobile: Dropdown */}
      <div className="sort-controls-mobile" ref={dropdownRef}>
        <button
          className="sort-dropdown-trigger"
          onClick={() => setIsMobileDropdownOpen(!isMobileDropdownOpen)}
        >
          <span className="sort-dropdown-label">Sort:</span>
          <span className="sort-dropdown-value">
            {activeLabel}
            <DirectionIcon size={12} className="sort-direction-icon" />
          </span>
          <ChevronDown
            size={14}
            className={`sort-dropdown-chevron ${isMobileDropdownOpen ? 'open' : ''}`}
          />
        </button>

        {isMobileDropdownOpen && (
          <div className="sort-dropdown-menu">
            {fields.map((field) => (
              <button
                key={field.key}
                className={`sort-dropdown-item ${activeField === field.key ? 'active' : ''}`}
                onClick={() => {
                  onSort(field.key);
                  setIsMobileDropdownOpen(false);
                }}
              >
                <span>{field.label}</span>
                {activeField === field.key && (
                  <DirectionIcon size={12} className="sort-direction-icon" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default SortControls;
