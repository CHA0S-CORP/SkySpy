/**
 * ClearStatus - Display when no threats are present
 *
 * Shows:
 * - All clear indicator
 * - GPS status hint
 */
import React, { memo } from 'react';

/**
 * ClearStatus component - shown when no threats
 */
export const ClearStatus = memo(function ClearStatus({ gpsActive }) {
  return (
    <div className="clear-status">
      <div className="clear-icon">
        <div className="clear-circle" />
      </div>
      <div className="clear-text">ALL CLEAR</div>
      <div className="clear-subtext">
        {gpsActive ? 'Scanning for threats...' : 'Enable GPS for scanning'}
      </div>
    </div>
  );
});

export default ClearStatus;
