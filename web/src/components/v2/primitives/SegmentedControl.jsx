import React from 'react';

/**
 * Segmented control (mock: active = tinted bg + full-color text; inactive --dim).
 *
 * @param {object} props
 * @param {Array<{value: string, label: React.ReactNode}>} props.options
 * @param {string} props.value
 * @param {(value: string) => void} props.onChange
 * @param {string} [props.color] - accent for the active segment (e.g. priority color)
 * @param {string} [props.className]
 */
export function SegmentedControl({ options, value, onChange, color, className = '', ...rest }) {
  const onKeyDown = (e) => {
    const idx = options.findIndex((o) => o.value === value);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      onChange(options[(idx + 1) % options.length].value);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      onChange(options[(idx - 1 + options.length) % options.length].value);
    }
  };
  return (
    <div className={`v2-seg ${className}`} role="radiogroup" {...rest}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            className="v2-seg__btn"
            style={color && active ? { '--v2-seg-color': color } : undefined}
            onClick={() => onChange(opt.value)}
            onKeyDown={onKeyDown}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
