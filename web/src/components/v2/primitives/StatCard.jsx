import React from 'react';

/**
 * KPI stat card: eyebrow label, big mono value, optional sub/trend line.
 *
 * @param {object} props
 * @param {React.ReactNode} props.label
 * @param {React.ReactNode} props.value
 * @param {React.ReactNode} [props.sub]
 * @param {string} [props.valueColor]
 * @param {string} [props.className]
 */
export function StatCard({ label, value, sub, valueColor, className = '', ...rest }) {
  return (
    <div className={`v2-statcard ${className}`} {...rest}>
      <div className="v2-eyebrow">{label}</div>
      <div className="v2-statcard__value" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </div>
      {sub != null && <div className="v2-statcard__sub">{sub}</div>}
    </div>
  );
}
