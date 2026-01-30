/**
 * RadarView - Full screen radar display mode
 *
 * Displays threats on a radar-style visualization with:
 * - Full screen radar view
 * - Threat selection
 * - Selected threat info display
 */
import React, { memo, useMemo } from 'react';
import { getDirectionName } from '../../utils/lawEnforcement';
import { MiniRadar } from './MiniRadar';

/**
 * RadarView component - full screen radar display mode
 */
export const RadarView = memo(function RadarView({
  threats,
  userHeading,
  onThreatClick,
  selectedThreat,
}) {
  // Calculate size on render
  const size = useMemo(() => {
    if (typeof window === 'undefined') return 300;
    return Math.min(window.innerWidth - 40, window.innerHeight - 200);
  }, []);

  return (
    <div className="radar-view">
      <MiniRadar
        threats={threats}
        userHeading={userHeading}
        size={size}
        maxRange={25}
        onThreatClick={onThreatClick}
        expanded={true}
        className="radar-fullscreen"
      />
      {selectedThreat && (
        <div className="radar-selected-info">
          <span className="info-category">{selectedThreat.category}</span>
          <span className="info-distance">{selectedThreat.distance_nm.toFixed(1)} NM</span>
          <span className="info-direction">{getDirectionName(selectedThreat.bearing)}</span>
        </div>
      )}
    </div>
  );
});

export default RadarView;
