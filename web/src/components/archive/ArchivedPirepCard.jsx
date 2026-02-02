import React from 'react';
import {
  Cloud,
  MapPin,
  Plane,
  Archive,
  ChevronDown,
  ChevronUp,
  Clock,
  Wind,
  ThermometerSnowflake,
  Zap,
} from 'lucide-react';
import { SEVERITY_COLORS, SEVERITY_LEVELS } from './archiveConstants';
import { formatDate, formatRelativeTime } from './archiveUtils';

/**
 * Get the maximum severity level from a PIREP for archive display
 */
function getMaxSeverityLevel(pirep) {
  const turbLevel = SEVERITY_LEVELS[pirep.turbulence_type] || 0;
  const iceLevel = SEVERITY_LEVELS[pirep.icing_type] || 0;
  const isUrgent = pirep.report_type === 'UUA';

  let maxLevel = Math.max(turbLevel, iceLevel);
  if (isUrgent) maxLevel = Math.max(maxLevel, 5);

  return maxLevel;
}

/**
 * Get severity color based on level
 */
function getSeverityColor(level) {
  if (level >= 5) return '#ef4444'; // Red - severe/extreme
  if (level >= 4) return '#f87171'; // Light red - mod-severe
  if (level >= 3) return '#fb923c'; // Orange - moderate
  if (level >= 2) return '#facc15'; // Yellow - light-moderate
  if (level >= 1) return '#a3e635'; // Light green - light
  return '#4ade80'; // Green - none/routine
}

// Archived PIREP Card
export function ArchivedPirepCard({ pirep, expanded, onToggle }) {
  const isUrgent = pirep.report_type === 'UUA';
  const hasTurbulence = pirep.turbulence_type && pirep.turbulence_type !== 'NEG';
  const hasIcing = pirep.icing_type && pirep.icing_type !== 'NEG';
  const hasWindshear =
    pirep.raw_text && (pirep.raw_text.includes('/WS') || pirep.raw_text.includes('LLWS'));

  // Get max severity for indicator bar
  const maxSeverity = getMaxSeverityLevel(pirep);
  const severityColor = getSeverityColor(maxSeverity);

  return (
    <div
      className={`archive-card pirep-card ${isUrgent ? 'urgent' : ''} ${expanded ? 'expanded' : ''} severity-${maxSeverity}`}
      onClick={onToggle}
    >
      {/* Severity indicator bar on left side */}
      <div
        className="severity-indicator"
        style={{ backgroundColor: severityColor }}
        title={`Severity Level: ${maxSeverity}`}
      />

      <div className="archive-card-content">
        <div className="archive-card-header">
          <div className={`archive-type-badge pirep ${isUrgent ? 'urgent' : 'routine'}`}>
            <Cloud size={14} />
            <span>{isUrgent ? 'URGENT' : 'Routine'}</span>
          </div>
          <div className="archive-location">
            <MapPin size={14} />
            <span>{pirep.location || 'Unknown'}</span>
          </div>
          {pirep.aircraft_type && (
            <div className="archive-aircraft">
              <Plane size={12} />
              <span>{pirep.aircraft_type}</span>
            </div>
          )}
          <div className="archive-archived-badge">
            <Archive size={12} />
            <span>{formatRelativeTime(pirep.observation_time)}</span>
          </div>
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>

        <div className="archive-card-conditions">
          {hasTurbulence && (
            <div
              className="condition-badge turbulence"
              data-level={SEVERITY_LEVELS[pirep.turbulence_type] || 0}
              style={{ borderColor: SEVERITY_COLORS[pirep.turbulence_type] }}
            >
              <Wind size={14} />
              <span>Turb: {pirep.turbulence_type}</span>
            </div>
          )}
          {hasIcing && (
            <div
              className="condition-badge icing"
              data-level={SEVERITY_LEVELS[pirep.icing_type] || 0}
              style={{ borderColor: SEVERITY_COLORS[pirep.icing_type] }}
            >
              <ThermometerSnowflake size={14} />
              <span>Ice: {pirep.icing_type}</span>
            </div>
          )}
          {hasWindshear && (
            <div className="condition-badge windshear" data-level="3">
              <Zap size={14} />
              <span>Wind Shear</span>
            </div>
          )}
          {pirep.flight_level && (
            <div className="condition-badge altitude">FL{pirep.flight_level}</div>
          )}
        </div>

        <div className="archive-card-meta">
          <div className="archive-time">
            <Clock size={12} />
            <span>Observed: {formatDate(pirep.observation_time)}</span>
          </div>
        </div>

        {expanded && (
          <div className="archive-card-details">
            {pirep.raw_text && (
              <div className="archive-full-text">
                <h4>Raw Report</h4>
                <pre>{pirep.raw_text}</pre>
              </div>
            )}

            <div className="pirep-details-grid">
              {pirep.altitude_ft && (
                <div className="pirep-detail">
                  <span className="label">Altitude</span>
                  <span className="value">{pirep.altitude_ft.toLocaleString()} ft</span>
                </div>
              )}
              {pirep.temperature_c != null && (
                <div className="pirep-detail">
                  <span className="label">Temperature</span>
                  <span className="value">{pirep.temperature_c}C</span>
                </div>
              )}
              {pirep.wind_dir != null && pirep.wind_speed_kt != null && (
                <div className="pirep-detail">
                  <span className="label">Wind</span>
                  <span className="value">
                    {pirep.wind_dir}deg / {pirep.wind_speed_kt} kt
                  </span>
                </div>
              )}
              {pirep.visibility_sm != null && (
                <div className="pirep-detail">
                  <span className="label">Visibility</span>
                  <span className="value">{pirep.visibility_sm} SM</span>
                </div>
              )}
              {pirep.sky_cover && (
                <div className="pirep-detail">
                  <span className="label">Sky Cover</span>
                  <span className="value">{pirep.sky_cover}</span>
                </div>
              )}
              {pirep.weather && (
                <div className="pirep-detail">
                  <span className="label">Weather</span>
                  <span className="value">{pirep.weather}</span>
                </div>
              )}
            </div>

            {hasTurbulence && (pirep.turbulence_base_ft || pirep.turbulence_top_ft) && (
              <div className="condition-details">
                <h4>Turbulence Details</h4>
                <div className="condition-range">
                  {pirep.turbulence_base_ft && <span>Base: {pirep.turbulence_base_ft} ft</span>}
                  {pirep.turbulence_top_ft && <span>Top: {pirep.turbulence_top_ft} ft</span>}
                  {pirep.turbulence_freq && <span>Freq: {pirep.turbulence_freq}</span>}
                </div>
              </div>
            )}

            {hasIcing && (pirep.icing_base_ft || pirep.icing_top_ft) && (
              <div className="condition-details">
                <h4>Icing Details</h4>
                <div className="condition-range">
                  {pirep.icing_base_ft && <span>Base: {pirep.icing_base_ft} ft</span>}
                  {pirep.icing_top_ft && <span>Top: {pirep.icing_top_ft} ft</span>}
                  {pirep.icing_intensity && <span>Intensity: {pirep.icing_intensity}</span>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ArchivedPirepCard;
