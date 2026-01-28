import React from 'react';
import { WifiOff } from 'lucide-react';
import { getCardinalDirection } from '../../../utils';

export function LiveTab({ aircraft, trackHistory, calculateDistance }) {
  if (!aircraft) {
    return (
      <div className="detail-empty" role="status">
        <WifiOff size={48} aria-hidden="true" />
        <p>Aircraft not currently tracked</p>
        <span>This aircraft is not in range of the receiver</span>
      </div>
    );
  }

  const verticalRate = aircraft.vr ?? aircraft.baro_rate ?? aircraft.geom_rate ?? null;
  const isExtremeVS = verticalRate !== null && Math.abs(verticalRate) > 3000;
  const vsClass = verticalRate > 0 ? 'climbing' : verticalRate < 0 ? 'descending' : '';

  const altitude = aircraft.alt_baro !== 'ground' && aircraft.alt_baro
    ? aircraft.alt_baro
    : aircraft.alt_geom ?? aircraft.alt;

  const speed = aircraft.gs ?? aircraft.tas ?? aircraft.ias;
  const track = aircraft.track ?? aircraft.true_heading ?? aircraft.mag_heading;
  const distance = calculateDistance(aircraft);

  return (
    <div
      className="detail-live"
      id="panel-live"
      role="tabpanel"
      aria-labelledby="tab-live"
    >
      <div
        className="live-stats-grid"
        role="region"
        aria-label="Live telemetry"
        aria-live="polite"
      >
        <div className="live-stat">
          <span className="live-label">Altitude</span>
          <span className="live-value live-value-animated">
            {altitude?.toLocaleString() || '--'}
          </span>
          <span className="live-unit">ft</span>
        </div>

        <div className="live-stat">
          <span className="live-label">Ground Speed</span>
          <span className="live-value live-value-animated">
            {speed?.toFixed(0) || '--'}
          </span>
          <span className="live-unit">kts</span>
        </div>

        <div className="live-stat">
          <span className="live-label">Vertical Rate</span>
          <span className={`live-value live-value-animated ${vsClass} ${isExtremeVS ? 'extreme-vs' : ''}`}>
            {verticalRate !== null
              ? `${verticalRate > 0 ? '+' : ''}${verticalRate}`
              : '--'}
          </span>
          <span className="live-unit">ft/min</span>
        </div>

        <div className="live-stat">
          <span className="live-label">Track</span>
          <span className="live-value live-value-animated">
            {track != null ? `${track.toFixed(0)}°` : '--'}
          </span>
          <span className="live-unit">{getCardinalDirection(track)}</span>
        </div>

        <div className="live-stat">
          <span className="live-label">Distance</span>
          <span className="live-value live-value-animated">
            {distance?.toFixed(1) ?? '--'}
          </span>
          <span className="live-unit">nm</span>
        </div>

        <div className="live-stat">
          <span className="live-label">Track History</span>
          <span className="live-value">{trackHistory?.length || 0}</span>
          <span className="live-unit">points</span>
        </div>

        <div className="live-stat">
          <span className="live-label">Squawk</span>
          <span className={`live-value ${isEmergencySquawk(aircraft.squawk) ? 'squawk-emergency' : ''}`}>
            {aircraft.squawk || '----'}
          </span>
          <span className="live-unit"></span>
        </div>
      </div>

      <div className="live-position">
        <h4>Position</h4>
        <div className="position-coords">
          <span>Lat: {aircraft.lat?.toFixed(5) || '--'}</span>
          <span>Lon: {aircraft.lon?.toFixed(5) || '--'}</span>
        </div>
      </div>
    </div>
  );
}

function isEmergencySquawk(squawk) {
  return ['7500', '7600', '7700'].includes(squawk);
}
