import { useCallback, useRef, useState, useEffect } from 'react';
import PropTypes from 'prop-types';

/**
 * RangeSlider - Dual-handle slider for distance, altitude, and signal filters
 */
export function RangeSlider({
  min = 0,
  max = 100,
  value = [0, 100],
  step = 1,
  onChange,
  label,
  unit = '',
  showInputs = false,
  showHistogram = false,
  histogramData = [],
  formatValue = (v) => v.toLocaleString(),
  color = 'var(--accent-cyan)',
  disabled = false,
  className = '',
}) {
  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(null); // 'min', 'max', or 'range'
  const [localValue, setLocalValue] = useState(value);

  // Sync local value with prop
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const clamp = (val, minV, maxV) => Math.min(Math.max(val, minV), maxV);
  const snapToStep = (val) => Math.round(val / step) * step;

  const getValueFromPosition = useCallback(
    (clientX) => {
      if (!trackRef.current) return 0;
      const rect = trackRef.current.getBoundingClientRect();
      const percent = (clientX - rect.left) / rect.width;
      const rawValue = min + percent * (max - min);
      return snapToStep(clamp(rawValue, min, max));
    },
    [min, max, step]
  );

  const handleMouseDown = useCallback(
    (e, handle) => {
      if (disabled) return;
      e.preventDefault();
      setDragging(handle);
    },
    [disabled]
  );

  const handleMouseMove = useCallback(
    (e) => {
      if (!dragging || disabled) return;

      const newValue = getValueFromPosition(e.clientX);

      setLocalValue((prev) => {
        let [minVal, maxVal] = prev;

        if (dragging === 'min') {
          minVal = clamp(newValue, min, maxVal - step);
        } else if (dragging === 'max') {
          maxVal = clamp(newValue, minVal + step, max);
        } else if (dragging === 'range') {
          // Move entire range
          const range = maxVal - minVal;
          const center = newValue;
          minVal = clamp(center - range / 2, min, max - range);
          maxVal = minVal + range;
        }

        return [minVal, maxVal];
      });
    },
    [dragging, disabled, getValueFromPosition, min, max, step]
  );

  const handleMouseUp = useCallback(() => {
    if (dragging) {
      onChange?.(localValue);
      setDragging(null);
    }
  }, [dragging, localValue, onChange]);

  // Mouse event listeners
  useEffect(() => {
    if (dragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [dragging, handleMouseMove, handleMouseUp]);

  const handleInputChange = (index, inputValue) => {
    const numValue = parseFloat(inputValue);
    if (isNaN(numValue)) return;

    const newValue = [...localValue];
    newValue[index] = snapToStep(clamp(numValue, min, max));

    // Ensure min < max
    if (index === 0 && newValue[0] >= newValue[1]) {
      newValue[0] = newValue[1] - step;
    } else if (index === 1 && newValue[1] <= newValue[0]) {
      newValue[1] = newValue[0] + step;
    }

    setLocalValue(newValue);
    onChange?.(newValue);
  };

  const handleTrackClick = (e) => {
    if (disabled || e.target !== trackRef.current) return;
    const clickValue = getValueFromPosition(e.clientX);
    const [minVal, maxVal] = localValue;

    // Move the closest handle
    const distToMin = Math.abs(clickValue - minVal);
    const distToMax = Math.abs(clickValue - maxVal);

    if (distToMin < distToMax) {
      const newValue = [clamp(clickValue, min, maxVal - step), maxVal];
      setLocalValue(newValue);
      onChange?.(newValue);
    } else {
      const newValue = [minVal, clamp(clickValue, minVal + step, max)];
      setLocalValue(newValue);
      onChange?.(newValue);
    }
  };

  const minPercent = ((localValue[0] - min) / (max - min)) * 100;
  const maxPercent = ((localValue[1] - min) / (max - min)) * 100;

  // Render histogram bars if provided
  const renderHistogram = () => {
    if (!showHistogram || histogramData.length === 0) return null;

    const maxCount = Math.max(...histogramData);

    return (
      <div
        style={{
          position: 'absolute',
          bottom: '16px',
          left: 0,
          right: 0,
          height: '24px',
          display: 'flex',
          alignItems: 'flex-end',
          gap: '1px',
          padding: '0 6px',
        }}
      >
        {histogramData.map((count, i) => {
          const percent = (i / (histogramData.length - 1)) * 100;
          const inRange = percent >= minPercent && percent <= maxPercent;
          return (
            <div
              key={i}
              style={{
                flex: 1,
                height: `${(count / maxCount) * 100}%`,
                background: inRange ? color : 'var(--bg-hover)',
                opacity: inRange ? 0.5 : 0.3,
                borderRadius: '1px 1px 0 0',
                minHeight: '2px',
                transition: 'background 0.15s ease',
              }}
            />
          );
        })}
      </div>
    );
  };

  return (
    <div
      className={`range-slider ${disabled ? 'range-slider--disabled' : ''} ${className}`}
      style={{
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
      }}
    >
      {label && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '8px',
          }}
        >
          <span
            style={{
              fontSize: '11px',
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            {label}
          </span>
          <span
            style={{
              fontSize: '11px',
              color: 'var(--text-primary)',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {formatValue(localValue[0])} – {formatValue(localValue[1])} {unit}
          </span>
        </div>
      )}

      <div
        ref={trackRef}
        role="slider"
        aria-label={label || 'Range slider'}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={localValue[0]}
        aria-valuetext={`${formatValue(localValue[0])} to ${formatValue(localValue[1])} ${unit}`.trim()}
        tabIndex={disabled ? -1 : 0}
        onClick={handleTrackClick}
        onKeyDown={(e) => {
          if (disabled) return;
          // const step10 = step * 10; // Available for shift+arrow keys if needed
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault();
            const newVal = [localValue[0], Math.min(max, localValue[1] + step)];
            setLocalValue(newVal);
            onChange?.(newVal);
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault();
            const newVal = [Math.max(min, localValue[0] - step), localValue[1]];
            setLocalValue(newVal);
            onChange?.(newVal);
          }
        }}
        style={{
          position: 'relative',
          height: showHistogram ? '44px' : '20px',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {renderHistogram()}

        {/* Track background */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '4px',
            background: 'var(--bg-hover)',
            borderRadius: '2px',
          }}
        />

        {/* Active range */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: `${minPercent}%`,
            width: `${maxPercent - minPercent}%`,
            height: '4px',
            background: color,
            borderRadius: '2px',
            cursor: dragging === 'range' ? 'grabbing' : 'grab',
          }}
          onMouseDown={(e) => handleMouseDown(e, 'range')}
        />

        {/* Min handle */}
        <div
          style={{
            position: 'absolute',
            bottom: '-4px',
            left: `${minPercent}%`,
            transform: 'translateX(-50%)',
            width: '12px',
            height: '12px',
            background: 'var(--bg-card)',
            border: `2px solid ${color}`,
            borderRadius: '50%',
            cursor: dragging === 'min' ? 'grabbing' : 'grab',
            boxShadow: dragging === 'min' ? `0 0 0 4px ${color}33` : 'none',
            transition: 'box-shadow 0.15s ease',
            zIndex: 2,
          }}
          onMouseDown={(e) => handleMouseDown(e, 'min')}
        />

        {/* Max handle */}
        <div
          style={{
            position: 'absolute',
            bottom: '-4px',
            left: `${maxPercent}%`,
            transform: 'translateX(-50%)',
            width: '12px',
            height: '12px',
            background: 'var(--bg-card)',
            border: `2px solid ${color}`,
            borderRadius: '50%',
            cursor: dragging === 'max' ? 'grabbing' : 'grab',
            boxShadow: dragging === 'max' ? `0 0 0 4px ${color}33` : 'none',
            transition: 'box-shadow 0.15s ease',
            zIndex: 2,
          }}
          onMouseDown={(e) => handleMouseDown(e, 'max')}
        />
      </div>

      {/* Number inputs */}
      {showInputs && (
        <div
          style={{
            display: 'flex',
            gap: '8px',
            marginTop: '8px',
          }}
        >
          <input
            type="number"
            value={localValue[0]}
            min={min}
            max={localValue[1] - step}
            step={step}
            onChange={(e) => handleInputChange(0, e.target.value)}
            disabled={disabled}
            style={{
              flex: 1,
              padding: '4px 8px',
              background: 'var(--bg-hover)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              color: 'var(--text-primary)',
              fontSize: '12px',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          />
          <input
            type="number"
            value={localValue[1]}
            min={localValue[0] + step}
            max={max}
            step={step}
            onChange={(e) => handleInputChange(1, e.target.value)}
            disabled={disabled}
            style={{
              flex: 1,
              padding: '4px 8px',
              background: 'var(--bg-hover)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              color: 'var(--text-primary)',
              fontSize: '12px',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          />
        </div>
      )}
    </div>
  );
}

RangeSlider.propTypes = {
  min: PropTypes.number,
  max: PropTypes.number,
  value: PropTypes.arrayOf(PropTypes.number),
  step: PropTypes.number,
  onChange: PropTypes.func,
  label: PropTypes.string,
  unit: PropTypes.string,
  showInputs: PropTypes.bool,
  showHistogram: PropTypes.bool,
  histogramData: PropTypes.arrayOf(PropTypes.number),
  formatValue: PropTypes.func,
  color: PropTypes.string,
  disabled: PropTypes.bool,
  className: PropTypes.string,
};

export default RangeSlider;
