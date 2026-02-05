import { useState, useRef, useEffect, useMemo } from 'react';
import PropTypes from 'prop-types';

/**
 * MultiSelectFacet - Dropdown with checkboxes and counts
 * For type, airline, and label filters
 */
export function MultiSelectFacet({
  label,
  options = [],
  value = [],
  onChange,
  placeholder = 'All',
  showCounts = true,
  showSearch = false,
  maxHeight = 280,
  disabled = false,
  className = '',
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef(null);
  const searchInputRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus search on open
  useEffect(() => {
    if (isOpen && showSearch && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen, showSearch]);

  // Filter options by search
  const filteredOptions = useMemo(() => {
    if (!searchTerm) return options;
    const term = searchTerm.toLowerCase();
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(term) ||
        (opt.value && opt.value.toLowerCase().includes(term))
    );
  }, [options, searchTerm]);

  // Calculate total selected count
  const selectedCount = value.length;
  const totalCount = options.reduce((sum, opt) => sum + (opt.count || 0), 0);

  const handleToggle = (optionValue) => {
    if (disabled) return;
    const newValue = value.includes(optionValue)
      ? value.filter((v) => v !== optionValue)
      : [...value, optionValue];
    onChange?.(newValue);
  };

  const handleSelectAll = () => {
    if (disabled) return;
    onChange?.(options.map((opt) => opt.value));
  };

  const handleClearAll = () => {
    if (disabled) return;
    onChange?.([]);
  };

  const getDisplayText = () => {
    if (selectedCount === 0) return placeholder;
    if (selectedCount === 1) {
      const selected = options.find((opt) => opt.value === value[0]);
      return selected?.label || value[0];
    }
    return `${selectedCount} selected`;
  };

  return (
    <div
      ref={containerRef}
      className={`multi-select-facet ${isOpen ? 'multi-select-facet--open' : ''} ${
        disabled ? 'multi-select-facet--disabled' : ''
      } ${className}`}
      style={{
        position: 'relative',
        display: 'inline-block',
        minWidth: '140px',
      }}
    >
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls="dropdown-listbox"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          width: '100%',
          padding: '6px 10px',
          background: isOpen ? 'var(--bg-hover)' : 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          color: selectedCount > 0 ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontSize: '12px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'all 0.15s ease',
        }}
      >
        {label && (
          <span
            style={{
              color: 'var(--text-dim)',
              fontSize: '10px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            {label}:
          </span>
        )}
        <span
          style={{
            flex: 1,
            textAlign: 'left',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {getDisplayText()}
        </span>
        {selectedCount > 0 && showCounts && (
          <span
            style={{
              background: 'var(--accent-cyan)',
              color: 'var(--bg-dark)',
              padding: '1px 5px',
              borderRadius: '10px',
              fontSize: '10px',
              fontWeight: 600,
            }}
          >
            {selectedCount}
          </span>
        )}
        <svg
          width="10"
          height="6"
          viewBox="0 0 10 6"
          fill="none"
          style={{
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease',
          }}
        >
          <path
            d="M1 1L5 5L9 1"
            stroke="var(--text-dim)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: '4px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
            zIndex: 'var(--z-dropdown)',
            overflow: 'hidden',
          }}
        >
          {/* Search input */}
          {showSearch && (
            <div style={{ padding: '8px', borderBottom: '1px solid var(--border)' }}>
              <input
                ref={searchInputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search..."
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  background: 'var(--bg-hover)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  color: 'var(--text-primary)',
                  fontSize: '12px',
                  outline: 'none',
                }}
              />
            </div>
          )}

          {/* Quick actions */}
          <div
            style={{
              display: 'flex',
              gap: '8px',
              padding: '6px 8px',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <button
              type="button"
              onClick={handleSelectAll}
              style={{
                padding: '2px 6px',
                background: 'transparent',
                border: 'none',
                color: 'var(--accent-cyan)',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              Select All
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              style={{
                padding: '2px 6px',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-secondary)',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              Clear
            </button>
            {showCounts && (
              <span
                style={{
                  marginLeft: 'auto',
                  color: 'var(--text-dim)',
                  fontSize: '10px',
                }}
              >
                {totalCount.toLocaleString()} total
              </span>
            )}
          </div>

          {/* Options list */}
          <div
            id="dropdown-listbox"
            role="listbox"
            aria-label={label || 'Select options'}
            style={{
              maxHeight,
              overflowY: 'auto',
            }}
          >
            {filteredOptions.length === 0 ? (
              <div
                style={{
                  padding: '12px',
                  textAlign: 'center',
                  color: 'var(--text-dim)',
                  fontSize: '12px',
                }}
              >
                No options found
              </div>
            ) : (
              filteredOptions.map((option) => {
                const isSelected = value.includes(option.value);
                return (
                  <div
                    key={option.value}
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={0}
                    onClick={() => handleToggle(option.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleToggle(option.value);
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 10px',
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(0, 212, 255, 0.1)' : 'transparent',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.background = 'var(--bg-hover)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = isSelected
                        ? 'rgba(0, 212, 255, 0.1)'
                        : 'transparent';
                    }}
                  >
                    {/* Checkbox */}
                    <div
                      style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '3px',
                        border: isSelected
                          ? '1px solid var(--accent-cyan)'
                          : '1px solid var(--border)',
                        background: isSelected ? 'var(--accent-cyan)' : 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.15s ease',
                        flexShrink: 0,
                      }}
                    >
                      {isSelected && (
                        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                          <path
                            d="M1 4L3.5 6.5L9 1"
                            stroke="var(--bg-dark)"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </div>

                    {/* Icon */}
                    {option.icon && (
                      <span style={{ fontSize: '14px', flexShrink: 0 }}>{option.icon}</span>
                    )}

                    {/* Label */}
                    <span
                      style={{
                        flex: 1,
                        fontSize: '12px',
                        color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {option.label}
                    </span>

                    {/* Count */}
                    {showCounts && option.count !== undefined && (
                      <span
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-dim)',
                          fontFamily: "'JetBrains Mono', monospace",
                          flexShrink: 0,
                        }}
                      >
                        {option.count.toLocaleString()}
                      </span>
                    )}

                    {/* Color indicator */}
                    {option.color && (
                      <div
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: option.color,
                          flexShrink: 0,
                        }}
                      />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

MultiSelectFacet.propTypes = {
  label: PropTypes.string,
  options: PropTypes.arrayOf(
    PropTypes.shape({
      value: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      count: PropTypes.number,
      icon: PropTypes.node,
      color: PropTypes.string,
    })
  ),
  value: PropTypes.arrayOf(PropTypes.string),
  onChange: PropTypes.func,
  placeholder: PropTypes.string,
  showCounts: PropTypes.bool,
  showSearch: PropTypes.bool,
  maxHeight: PropTypes.number,
  disabled: PropTypes.bool,
  className: PropTypes.string,
};

export default MultiSelectFacet;
