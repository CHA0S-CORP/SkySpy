import React from 'react';

/**
 * Custom-styled native select per design spec (appearance:none, option bg --bg2).
 * Deliberately NOT Radix Select — the mocks specify native behavior.
 *
 * @param {object} props
 * @param {Array<{value: string, label: string}>} props.options
 * @param {string} props.value
 * @param {(value: string) => void} props.onChange
 * @param {string} [props.label] - accessible name
 * @param {string} [props.className]
 */
export function Select({ options, value, onChange, label, className = '', ...rest }) {
  return (
    <select
      className={`v2-select ${className}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      {...rest}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
