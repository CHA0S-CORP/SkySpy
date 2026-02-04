import React from 'react';
import { WifiOff } from 'lucide-react';
import { getCardinalDirection } from '../../../utils';

/**
 * TelemetryMetric - Individual metric display in the telemetry bar
 */
function TelemetryMetric({ label, value, unit, className = '' }) {
  return (
    <div className={`telemetry-metric ${className}`}>
      <span className="telemetry-label">{label}</span>
      <div className="telemetry-value">
        <span className="telemetry-number">{value}</span>
        {unit && <span className="telemetry-unit">{unit}</span>}
      </div>
    </div>
  );
}

/**
 * StickyTelemetryBar - Always-visible telemetry bar with 6 key metrics
 *
 * Metrics displayed:
 * - ALT: Altitude (ft)
 * - SPD: Ground Speed (kts)
 * - VS: Vertical Rate (fpm)
 * - TRK: Track (degrees + cardinal)
 * - DST: Distance (nm)
 * - SQK: Squawk code
 */
export function StickyTelemetryBar({ aircraft, calculateDistance, isScrolled = false }) {
  // No aircraft data
  if (!aircraft) {
    return (
      <div
        className={`detail-v2-telemetry ${isScrolled ? 'scrolled' : ''}`}
        role="region"
        aria-label="Live telemetry"
      >
        <div className="telemetry-no-data" role="status">
          <WifiOff size={16} aria-hidden="true" />
          <span>Aircraft not currently tracked</span>
        </div>
      </div>
    );
  }

  // Extract values
  const altitude =
    aircraft.alt_baro !== 'ground' && aircraft.alt_baro
      ? aircraft.alt_baro
      : aircraft.alt_geom ?? aircraft.alt;

  const speed = aircraft.gs ?? aircraft.tas ?? aircraft.ias;
  const verticalRate = aircraft.vr ?? aircraft.baro_rate ?? aircraft.geom_rate ?? null;
  const track = aircraft.track ?? aircraft.true_heading ?? aircraft.mag_heading;
  const distance = calculateDistance?.(aircraft);
  const squawk = aircraft.squawk;

  // Determine vertical rate styling
  const isClimbing = verticalRate !== null && verticalRate > 0;
  const isDescending = verticalRate !== null && verticalRate < 0;
  const isExtremeVS = verticalRate !== null && Math.abs(verticalRate) > 3000;

  const vsClass = [
    isClimbing && 'climbing',
    isDescending && 'descending',
    isExtremeVS && 'extreme',
  ]
    .filter(Boolean)
    .join(' ');

  // Emergency squawk detection
  const isEmergencySquawk = ['7500', '7600', '7700'].includes(squawk);

  // Format helpers
  const formatAlt = (alt) => (alt != null ? alt.toLocaleString() : '--');
  const formatSpeed = (s) => (s != null ? s.toFixed(0) : '--');
  const formatVS = (vs) => {
    if (vs === null) return '--';
    return vs > 0 ? `+${vs}` : `${vs}`;
  };
  const formatTrack = (t) => (t != null ? t.toFixed(0) : '--');
  const formatDistance = (d) => (d != null ? d.toFixed(1) : '--');

  return (
    <div
      className={`detail-v2-telemetry ${isScrolled ? 'scrolled' : ''}`}
      role="region"
      aria-label="Live telemetry"
      aria-live="polite"
    >
      <TelemetryMetric label="ALT" value={formatAlt(altitude)} unit="ft" />
      <TelemetryMetric label="SPD" value={formatSpeed(speed)} unit="kts" />
      <TelemetryMetric label="V/S" value={formatVS(verticalRate)} unit="fpm" className={vsClass} />
      <TelemetryMetric
        label="TRK"
        value={formatTrack(track)}
        unit={track != null ? getCardinalDirection(track) : ''}
      />
      <TelemetryMetric label="DST" value={formatDistance(distance)} unit="nm" />
      <TelemetryMetric
        label="SQK"
        value={squawk || '----'}
        className={isEmergencySquawk ? 'emergency' : ''}
      />
    </div>
  );
}
