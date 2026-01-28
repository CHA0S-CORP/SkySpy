import React, { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronDown, X, Clock } from 'lucide-react';

const PRESETS = [
  { label: '1 hour', value: '1h', hours: 1 },
  { label: '6 hours', value: '6h', hours: 6 },
  { label: '24 hours', value: '24h', hours: 24 },
  { label: '48 hours', value: '48h', hours: 48 },
  { label: '7 days', value: '7d', hours: 168 },
  { label: '30 days', value: '30d', hours: 720 },
];

/**
 * DateRangePicker component with presets and custom date range
 * @param {Object} props
 * @param {string} props.value - Current preset value (e.g., '24h') or 'custom'
 * @param {Object} props.customRange - { start: Date, end: Date } for custom range
 * @param {Function} props.onChange - Called with { preset, customRange } when selection changes
 */
export function DateRangePicker({ value = '24h', customRange, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState(value === 'custom' ? 'custom' : 'preset');
  const [startDate, setStartDate] = useState(() => {
    if (customRange?.start) return formatDateForInput(customRange.start);
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return formatDateForInput(d);
  });
  const [endDate, setEndDate] = useState(() => {
    if (customRange?.end) return formatDateForInput(customRange.end);
    return formatDateForInput(new Date());
  });
  const [startTime, setStartTime] = useState(() => {
    if (customRange?.start) return formatTimeForInput(customRange.start);
    return '00:00';
  });
  const [endTime, setEndTime] = useState(() => {
    if (customRange?.end) return formatTimeForInput(customRange.end);
    return '23:59';
  });

  const containerRef = useRef(null);

  // Format date for date input
  function formatDateForInput(date) {
    const d = new Date(date);
    return d.toISOString().split('T')[0];
  }

  // Format time for time input
  function formatTimeForInput(date) {
    const d = new Date(date);
    return d.toTimeString().slice(0, 5);
  }

  // Get display label
  const getDisplayLabel = () => {
    if (value === 'custom' && customRange) {
      const start = new Date(customRange.start);
      const end = new Date(customRange.end);
      return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
    }
    const preset = PRESETS.find(p => p.value === value);
    return preset?.label || value;
  };

  // Handle preset selection
  const handlePresetSelect = (preset) => {
    setMode('preset');
    onChange?.({ preset: preset.value, customRange: null });
    setIsOpen(false);
  };

  // Handle custom range apply
  const handleApplyCustom = () => {
    const start = new Date(`${startDate}T${startTime}`);
    const end = new Date(`${endDate}T${endTime}`);

    if (start > end) {
      alert('Start date must be before end date');
      return;
    }

    onChange?.({
      preset: 'custom',
      customRange: { start, end }
    });
    setIsOpen(false);
  };

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  return (
    <div className="date-range-picker" ref={containerRef}>
      <button
        className="date-range-trigger"
        onClick={() => setIsOpen(!isOpen)}
      >
        <Calendar size={14} />
        <span>{getDisplayLabel()}</span>
        <ChevronDown size={12} className={isOpen ? 'rotated' : ''} />
      </button>

      {isOpen && (
        <div className="date-range-dropdown">
          <div className="date-range-tabs">
            <button
              className={mode === 'preset' ? 'active' : ''}
              onClick={() => setMode('preset')}
            >
              <Clock size={14} />
              Presets
            </button>
            <button
              className={mode === 'custom' ? 'active' : ''}
              onClick={() => setMode('custom')}
            >
              <Calendar size={14} />
              Custom
            </button>
          </div>

          {mode === 'preset' ? (
            <div className="date-range-presets">
              {PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  className={`preset-btn ${value === preset.value ? 'active' : ''}`}
                  onClick={() => handlePresetSelect(preset)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="date-range-custom">
              <div className="date-input-group">
                <label>Start</label>
                <div className="date-time-inputs">
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>
              </div>
              <div className="date-input-group">
                <label>End</label>
                <div className="date-time-inputs">
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </div>
              </div>
              <div className="date-range-actions">
                <button className="cancel-btn" onClick={() => setIsOpen(false)}>
                  Cancel
                </button>
                <button className="apply-btn" onClick={handleApplyCustom}>
                  Apply
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default DateRangePicker;
