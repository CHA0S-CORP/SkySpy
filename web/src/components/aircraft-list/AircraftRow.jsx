import React, { memo } from 'react';
import { Shield, AlertTriangle, ArrowUp, ArrowDown, Radio } from 'lucide-react';

// Helper to get cardinal direction from heading
const getCardinalDirection = (heading) => {
  if (heading === null || heading === undefined) return null;
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(heading / 45) % 8;
  return directions[index];
};

// Signal strength indicator component
const SignalIndicator = memo(({ rssi }) => {
  if (rssi === null || rssi === undefined) return <span className="signal-indicator">--</span>;

  const strength = rssi > -20 ? 4 : rssi > -30 ? 3 : rssi > -40 ? 2 : 1;
  const strengthClass = strength >= 3 ? 'strong' : strength === 2 ? 'medium' : 'weak';

  return (
    <span className={`signal-indicator ${strengthClass}`} title={`${rssi.toFixed(1)} dB`}>
      <Radio size={12} />
      <span className="signal-bars">
        {[1, 2, 3, 4].map(i => (
          <span key={i} className={`bar ${i <= strength ? 'active' : ''}`} />
        ))}
      </span>
    </span>
  );
});

SignalIndicator.displayName = 'SignalIndicator';

// Vertical speed indicator
const VerticalSpeedIndicator = memo(({ vr }) => {
  if (!vr) return <span className="vs-indicator">--</span>;

  const isClimbing = vr > 100;
  const isDescending = vr < -100;
  const isFast = Math.abs(vr) > 2000;

  return (
    <span className={`vs-indicator ${isClimbing ? 'climbing' : ''} ${isDescending ? 'descending' : ''} ${isFast ? 'fast' : ''}`}>
      {isClimbing && <ArrowUp size={12} />}
      {isDescending && <ArrowDown size={12} />}
      {vr > 0 ? '+' : ''}{vr}
    </span>
  );
});

VerticalSpeedIndicator.displayName = 'VerticalSpeedIndicator';

/**
 * Memoized aircraft table row component
 */
export const AircraftRow = memo(function AircraftRow({
  aircraft,
  index,
  onSelect,
  visibleColumns,
  density = 'comfortable',
}) {
  const ac = aircraft;
  const isClimbing = (ac.vr || 0) > 500;
  const isDescending = (ac.vr || 0) < -500;
  const isEmergency = ac.emergency || ac.squawk?.match(/^7[567]00$/);
  const cardinal = getCardinalDirection(ac.track);

  const isVisible = (columnId) => visibleColumns.includes(columnId);

  const rowClasses = [
    ac.military ? 'military' : '',
    isEmergency ? 'emergency' : '',
    isClimbing ? 'climbing' : '',
    isDescending ? 'descending' : '',
    onSelect ? 'clickable' : '',
    `density-${density}`,
  ].filter(Boolean).join(' ');

  return (
    <tr
      className={rowClasses}
      onClick={() => onSelect?.(ac.hex)}
      role="row"
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect?.(ac.hex);
        }
      }}
    >
      {isVisible('hex') && (
        <td className="mono icao-cell">
          {ac.military && <Shield size={12} className="row-icon military-icon" />}
          {isEmergency && <AlertTriangle size={12} className="row-icon emergency-icon" />}
          {ac.hex}
        </td>
      )}
      {isVisible('flight') && (
        <td className="callsign-cell">{ac.flight || '--'}</td>
      )}
      {isVisible('type') && (
        <td className="mono type-cell">{ac.type || '--'}</td>
      )}
      {isVisible('alt') && (
        <td className="mono alt-cell">
          {ac.alt != null ? ac.alt.toLocaleString() : '--'}
        </td>
      )}
      {isVisible('gs') && (
        <td className="mono speed-cell">{ac.gs?.toFixed(0) || '--'}</td>
      )}
      {isVisible('vr') && (
        <td className="mono vs-cell">
          <VerticalSpeedIndicator vr={ac.vr} />
        </td>
      )}
      {isVisible('track') && (
        <td className="mono hdg-cell">
          {ac.track != null ? (
            <span className="heading-value">
              {Math.round(ac.track)}°
              {cardinal && <span className="cardinal">{cardinal}</span>}
            </span>
          ) : '--'}
        </td>
      )}
      {isVisible('distance_nm') && (
        <td className="mono dist-cell">{ac.distance_nm?.toFixed(1) || '--'}</td>
      )}
      {isVisible('rssi') && (
        <td className="sig-cell">
          <SignalIndicator rssi={ac.rssi} />
        </td>
      )}
      {isVisible('squawk') && (
        <td className={`mono squawk-cell ${ac.squawk?.match(/^7[567]00$/) ? 'emergency-squawk' : ''}`}>
          {ac.squawk || '--'}
        </td>
      )}
    </tr>
  );
});

export default AircraftRow;
