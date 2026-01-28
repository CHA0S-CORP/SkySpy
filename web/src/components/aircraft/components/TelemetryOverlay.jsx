import React from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';

export function TelemetryOverlay({
  telemetry,
  isCollapsed,
  onToggle
}) {
  if (!telemetry) return null;

  const vs = telemetry.vr ?? telemetry.baro_rate ?? telemetry.geom_rate ?? null;
  const vsClass = vs > 0 ? 'climbing' : vs < 0 ? 'descending' : '';

  return (
    <div
      className={`track-telemetry-overlay ${isCollapsed ? 'collapsed' : ''}`}
      role="region"
      aria-label="Aircraft telemetry"
      aria-expanded={!isCollapsed}
    >
      <button
        className="telem-toggle"
        onClick={onToggle}
        title={isCollapsed ? 'Expand telemetry' : 'Collapse telemetry'}
        aria-label={isCollapsed ? 'Expand telemetry display' : 'Collapse telemetry display'}
      >
        {isCollapsed ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronUp size={14} aria-hidden="true" />
        )}
      </button>

      {!isCollapsed && (
        <>
          <div className="telem-row" aria-live="polite">
            <div className="telem-item">
              <span className="telem-label">ALT</span>
              <span className="telem-value">
                {telemetry.altitude?.toLocaleString() || '--'}
              </span>
              <span className="telem-unit">ft</span>
            </div>
            <div className="telem-item">
              <span className="telem-label">GS</span>
              <span className="telem-value">
                {telemetry.gs?.toFixed(0) || '--'}
              </span>
              <span className="telem-unit">kts</span>
            </div>
            <div className="telem-item">
              <span className="telem-label">VS</span>
              <span className={`telem-value ${vsClass}`}>
                {vs !== null ? (vs > 0 ? '+' : '') + vs : '--'}
              </span>
              <span className="telem-unit">fpm</span>
            </div>
            <div className="telem-item">
              <span className="telem-label">HDG</span>
              <span className="telem-value">
                {telemetry.track?.toFixed(0) || '--'}
              </span>
              <span className="telem-unit">°</span>
            </div>
          </div>
          <div className="telem-time">
            {telemetry.timestamp
              ? new Date(telemetry.timestamp).toLocaleTimeString()
              : '--:--'}
          </div>
        </>
      )}
    </div>
  );
}
