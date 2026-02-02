import React from 'react';

/**
 * Visual severity gauge for turbulence or icing
 * Horizontal segmented bar with color gradient
 */
export function SeverityGauge({ type, level, label }) {
  // Turbulence: 6 segments (NEG, LGT, LGT-MOD, MOD, MOD-SEV, SEV/EXTRM)
  // Icing: 4 segments (NEG, TRC/LGT, MOD, SEV)
  const isTurbulence = type === 'turbulence';
  const segments = isTurbulence ? 6 : 4;

  const segmentLabels = isTurbulence
    ? ['NEG', 'LGT', 'L-M', 'MOD', 'M-S', 'SEV']
    : ['NEG', 'LGT', 'MOD', 'SEV'];

  // Map level to active segment index
  const activeIndex = Math.min(level, segments - 1);

  return (
    <div className={`severity-gauge ${type}`}>
      {label && <span className="gauge-label">{label}</span>}
      <div className="gauge-segments">
        {Array.from({ length: segments }, (_, i) => (
          <div
            key={i}
            className={`gauge-segment segment-${i} ${i <= activeIndex ? 'active' : ''} ${i === activeIndex ? 'current' : ''}`}
            title={segmentLabels[i]}
          >
            <span className="segment-label">{segmentLabels[i]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default SeverityGauge;
