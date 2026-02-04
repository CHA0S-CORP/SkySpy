import React from 'react';
import {
  ArrowUp,
  Gauge,
  TrendingUp,
  Compass,
  MapPin,
  Radio,
} from 'lucide-react';
import { getCardinalDirection } from '../../../../utils';

/**
 * LiveStatusBar - Compact horizontal metrics display
 *
 * Features:
 * - Single row of key metrics (ALT, SPD, VS, TRK, DST)
 * - Icon + value + unit format
 * - Color coding for climb/descend and emergency squawk
 */
export function LiveStatusBar({ aircraft, calculateDistance }) {
  if (!aircraft) {
    return null;
  }

  const verticalRate = aircraft.vr ?? aircraft.baro_rate ?? aircraft.geom_rate ?? null;
  const isClimbing = verticalRate > 0;
  const isDescending = verticalRate < 0;

  const altitude =
    aircraft.alt_baro !== 'ground' && aircraft.alt_baro
      ? aircraft.alt_baro
      : (aircraft.alt_geom ?? aircraft.alt);

  const speed = aircraft.gs ?? aircraft.tas ?? aircraft.ias;
  const track = aircraft.track ?? aircraft.true_heading ?? aircraft.mag_heading;
  const distance = calculateDistance ? calculateDistance(aircraft) : null;
  const squawk = aircraft.squawk;

  const isEmergencySquawk = ['7500', '7600', '7700'].includes(squawk);

  // Format helpers
  const formatAlt = (alt) => {
    if (alt === null || alt === undefined) return '--';
    return alt >= 1000 ? `${(alt / 1000).toFixed(1)}k` : alt.toString();
  };

  const formatSpeed = (s) => (s != null ? Math.round(s).toString() : '--');

  const formatVS = (vs) => {
    if (vs === null || vs === undefined) return '--';
    const absVs = Math.abs(vs);
    if (absVs >= 1000) {
      return `${vs > 0 ? '+' : ''}${(vs / 1000).toFixed(1)}k`;
    }
    return `${vs > 0 ? '+' : ''}${vs}`;
  };

  const formatTrack = (t) => {
    if (t == null) return '--';
    return `${Math.round(t)}°`;
  };

  const formatDistance = (d) => {
    if (d == null) return '--';
    return d.toFixed(1);
  };

  const vsClass = isClimbing ? 'climbing' : isDescending ? 'descending' : '';

  return (
    <div
      className="sidebar-status-bar"
      role="region"
      aria-label="Live flight status"
      aria-live="polite"
    >
      {/* Altitude */}
      <div className="status-metric">
        <div className="status-metric-icon">
          <ArrowUp size={12} />
        </div>
        <div className="status-metric-content">
          <span className="status-metric-label">ALT</span>
          <span className="status-metric-value">{formatAlt(altitude)} ft</span>
        </div>
      </div>

      {/* Speed */}
      <div className="status-metric">
        <div className="status-metric-icon">
          <Gauge size={12} />
        </div>
        <div className="status-metric-content">
          <span className="status-metric-label">SPD</span>
          <span className="status-metric-value">{formatSpeed(speed)} kts</span>
        </div>
      </div>

      {/* Vertical Speed */}
      <div className="status-metric">
        <div className="status-metric-icon">
          <TrendingUp size={12} />
        </div>
        <div className="status-metric-content">
          <span className="status-metric-label">VS</span>
          <span className={`status-metric-value ${vsClass}`}>
            {formatVS(verticalRate)} fpm
          </span>
        </div>
      </div>

      {/* Track */}
      <div className="status-metric">
        <div className="status-metric-icon">
          <Compass size={12} />
        </div>
        <div className="status-metric-content">
          <span className="status-metric-label">TRK</span>
          <span className="status-metric-value">
            {formatTrack(track)} {track != null ? getCardinalDirection(track) : ''}
          </span>
        </div>
      </div>

      {/* Distance */}
      <div className="status-metric">
        <div className="status-metric-icon">
          <MapPin size={12} />
        </div>
        <div className="status-metric-content">
          <span className="status-metric-label">DST</span>
          <span className="status-metric-value">{formatDistance(distance)} nm</span>
        </div>
      </div>

      {/* Squawk (only show if emergency or non-standard) */}
      {squawk && squawk !== '1200' && (
        <div className="status-metric">
          <div className="status-metric-icon">
            <Radio size={12} />
          </div>
          <div className="status-metric-content">
            <span className="status-metric-label">SQK</span>
            <span className={`status-metric-value ${isEmergencySquawk ? 'emergency' : ''}`}>
              {squawk}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
