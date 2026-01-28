import React, { memo } from 'react';
import { Shield, AlertTriangle, ArrowUp, ArrowDown, Radio, Plane } from 'lucide-react';

// Helper to get cardinal direction from heading
const getCardinalDirection = (heading) => {
  if (heading === null || heading === undefined) return null;
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(heading / 45) % 8;
  return directions[index];
};

// Signal strength indicator for cards
const CardSignalIndicator = memo(({ rssi }) => {
  if (rssi === null || rssi === undefined) return null;

  const strength = rssi > -20 ? 4 : rssi > -30 ? 3 : rssi > -40 ? 2 : 1;
  const strengthClass = strength >= 3 ? 'strong' : strength === 2 ? 'medium' : 'weak';

  return (
    <span className={`al-card-signal ${strengthClass}`} title={`${rssi.toFixed(1)} dB`}>
      <Radio size={12} />
      <span className="signal-bars">
        {[1, 2, 3, 4].map(i => (
          <span key={i} className={`bar ${i <= strength ? 'active' : ''}`} />
        ))}
      </span>
    </span>
  );
});

CardSignalIndicator.displayName = 'CardSignalIndicator';

/**
 * Aircraft card component for grid view
 */
export const AircraftCard = memo(function AircraftCard({
  aircraft,
  onSelect,
  compact = false,
}) {
  const ac = aircraft;
  const isClimbing = (ac.vr || 0) > 500;
  const isDescending = (ac.vr || 0) < -500;
  const isEmergency = ac.emergency || ac.squawk?.match(/^7[567]00$/);
  const cardinal = getCardinalDirection(ac.track);

  const cardClasses = [
    'al-card',
    ac.military ? 'military' : '',
    isEmergency ? 'emergency' : '',
    isClimbing ? 'climbing' : '',
    isDescending ? 'descending' : '',
    onSelect ? 'clickable' : '',
    compact ? 'compact' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={cardClasses}
      onClick={() => onSelect?.(ac.hex)}
      role="button"
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect?.(ac.hex);
        }
      }}
    >
      {/* Card Header */}
      <div className="al-card-header">
        <div className="al-card-identity">
          <span className="al-card-callsign">
            {ac.flight || ac.hex}
          </span>
          {ac.flight && (
            <span className="al-card-icao">{ac.hex}</span>
          )}
        </div>
        <div className="al-card-badges">
          {ac.military && (
            <span className="al-card-badge military">
              <Shield size={10} />
              MIL
            </span>
          )}
          {isEmergency && (
            <span className="al-card-badge emergency">
              <AlertTriangle size={10} />
              EMRG
            </span>
          )}
          {isClimbing && (
            <span className="al-card-badge climbing">
              <ArrowUp size={10} />
            </span>
          )}
          {isDescending && (
            <span className="al-card-badge descending">
              <ArrowDown size={10} />
            </span>
          )}
        </div>
        <CardSignalIndicator rssi={ac.rssi} />
      </div>

      {/* Telemetry Grid */}
      <div className="al-card-telemetry">
        <div className="al-card-telem-item">
          <span className="al-card-telem-label">ALT</span>
          <span className="al-card-telem-value">
            {ac.alt != null ? ac.alt.toLocaleString() : '--'}
            <span className="al-card-telem-unit">ft</span>
          </span>
        </div>
        <div className="al-card-telem-item">
          <span className="al-card-telem-label">SPD</span>
          <span className="al-card-telem-value">
            {ac.gs?.toFixed(0) || '--'}
            <span className="al-card-telem-unit">kts</span>
          </span>
        </div>
        <div className="al-card-telem-item">
          <span className="al-card-telem-label">V/S</span>
          <span className={`al-card-telem-value ${isClimbing ? 'climbing' : ''} ${isDescending ? 'descending' : ''}`}>
            {ac.vr ? (
              <>
                {ac.vr > 0 ? '+' : ''}{ac.vr}
                <span className="al-card-telem-unit">fpm</span>
              </>
            ) : '--'}
          </span>
        </div>
        {!compact && (
          <>
            <div className="al-card-telem-item">
              <span className="al-card-telem-label">HDG</span>
              <span className="al-card-telem-value">
                {ac.track != null ? (
                  <>
                    {Math.round(ac.track)}°
                    {cardinal && <span className="al-card-cardinal">{cardinal}</span>}
                  </>
                ) : '--'}
              </span>
            </div>
            <div className="al-card-telem-item">
              <span className="al-card-telem-label">DIST</span>
              <span className="al-card-telem-value">
                {ac.distance_nm?.toFixed(1) || '--'}
                <span className="al-card-telem-unit">nm</span>
              </span>
            </div>
            <div className="al-card-telem-item">
              <span className="al-card-telem-label">TYPE</span>
              <span className="al-card-telem-value type">
                {ac.type || '--'}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Squawk indicator for emergency */}
      {ac.squawk && ac.squawk.match(/^7[567]00$/) && (
        <div className="al-card-squawk-alert">
          <AlertTriangle size={12} />
          Squawk {ac.squawk}
        </div>
      )}
    </div>
  );
});

export default AircraftCard;
