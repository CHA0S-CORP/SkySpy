import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { getTypeCategory } from './historyConstants';
import { Sparkline } from '../common/Sparkline';

/**
 * Session card component for displaying aircraft session data
 * Enhanced with altitude sparkline visualization
 */
export function SessionCard({ session, onSelectAircraft, showSparkline = true, compact = false }) {
  const typeCategory = getTypeCategory(session.type);

  // Extract altitude history for sparkline (if available)
  const altitudeData = session.altitude_history || [];

  return (
    <div
      className={`session-card ${session.is_military ? 'military' : ''} ${session.safety_event_count > 0 ? 'has-safety-events' : ''} type-${typeCategory}`}
      role="button"
      tabIndex={0}
      onClick={() => onSelectAircraft?.(session.icao_hex)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelectAircraft?.(session.icao_hex);
        }
      }}
    >
      <div className="session-header">
        <div className="session-identity">
          <div className="session-callsign">
            {session.callsign || session.icao_hex}
            {session.is_military && <span className="military-badge">MIL</span>}
            {session.safety_event_count > 0 && (
              <span
                className="safety-badge"
                title={`${session.safety_event_count} safety event${session.safety_event_count > 1 ? 's' : ''}`}
              >
                <AlertTriangle size={14} />
                {session.safety_event_count}
              </span>
            )}
          </div>
          <div className="session-icao-row">
            <span
              className="icao-link"
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onSelectAircraft?.(session.icao_hex);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  e.preventDefault();
                  onSelectAircraft?.(session.icao_hex);
                }
              }}
            >
              {session.icao_hex}
            </span>
            {session.type && (
              <span className={`session-type type-${typeCategory}`}>{session.type}</span>
            )}
            {session.registration && <span className="session-reg">{session.registration}</span>}
          </div>
        </div>
        <div className="session-duration-badge">
          <span className="duration-value">{Math.round(session.duration_min || 0)}</span>
          <span className="duration-unit">min</span>
        </div>
      </div>

      <div className="session-visual-stats">
        <div className="session-altitude-bar">
          <div className="altitude-bar-label">Altitude</div>
          <div className="altitude-bar-container">
            <div
              className="altitude-bar-fill"
              style={{ width: `${Math.min(100, ((session.max_alt || 0) / 45000) * 100)}%` }}
            />
            <span className="altitude-bar-value">
              {session.max_alt != null ? `${(session.max_alt / 1000).toFixed(0)}k ft` : '--'}
            </span>
          </div>
        </div>
        <div className="session-signal-indicator">
          <div className="signal-label">Signal</div>
          <div
            className={`signal-bars ${session.max_rssi >= -3 ? 'excellent' : session.max_rssi >= -10 ? 'good' : session.max_rssi >= -20 ? 'fair' : 'weak'}`}
          >
            <span className="bar bar-1"></span>
            <span className="bar bar-2"></span>
            <span className="bar bar-3"></span>
            <span className="bar bar-4"></span>
          </div>
          <span className="signal-value">{session.max_rssi?.toFixed(0) || '--'} dB</span>
        </div>
      </div>

      <div className="session-stats">
        <div className="session-stat">
          <span className="session-stat-label">Distance</span>
          <span className="session-stat-value">
            {session.min_distance_nm != null ? `${session.min_distance_nm.toFixed(1)}` : '--'}
            {session.max_distance_nm != null ? ` - ${session.max_distance_nm.toFixed(1)}` : ''} nm
          </span>
        </div>
        <div className="session-stat">
          <span className="session-stat-label">Max V/S</span>
          <span
            className={`session-stat-value ${session.max_vr > 0 ? 'climbing' : session.max_vr < 0 ? 'descending' : ''}`}
          >
            {session.max_vr != null ? `${session.max_vr > 0 ? '+' : ''}${session.max_vr}` : '--'}{' '}
            fpm
          </span>
        </div>
        <div className="session-stat">
          <span className="session-stat-label">Messages</span>
          <span className="session-stat-value">
            {session.message_count?.toLocaleString() || '--'}
          </span>
        </div>
        <div className="session-stat">
          <span className="session-stat-label">Squawks</span>
          <span
            className={`session-stat-value ${session.squawk === '7500' || session.squawk === '7600' || session.squawk === '7700' ? 'emergency-squawk' : ''}`}
          >
            {session.squawk || '--'}
          </span>
        </div>
      </div>

      <div className="session-times">
        <span className="session-time">
          <span className="time-label">First:</span>{' '}
          {new Date(session.first_seen).toLocaleTimeString()}
        </span>
        <span className="session-time">
          <span className="time-label">Last:</span>{' '}
          {new Date(session.last_seen).toLocaleTimeString()}
        </span>
      </div>

      {/* Altitude sparkline visualization */}
      {showSparkline && altitudeData.length > 2 && (
        <div className="session-card__sparkline-row">
          <span style={{ fontSize: '10px', color: 'var(--text-dim)', marginRight: '8px' }}>Alt Profile</span>
          <Sparkline
            data={altitudeData}
            type="area"
            width={compact ? 80 : 120}
            height={compact ? 20 : 28}
            color="var(--accent-cyan)"
            showMinMax={!compact}
          />
        </div>
      )}
    </div>
  );
}
