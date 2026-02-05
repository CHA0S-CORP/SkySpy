import { useMemo } from 'react';
import PropTypes from 'prop-types';

/**
 * FlightStatsPanel - Compact KPI sidebar for flight statistics
 */
export function FlightStatsPanel({
  sightings = [],
  // session = {}, // Reserved for future use
  className = '',
}) {
  // Calculate statistics from sightings
  const stats = useMemo(() => {
    if (!sightings.length) {
      return {
        duration: 0,
        positionCount: 0,
        minAlt: null,
        maxAlt: null,
        avgAlt: null,
        minSpeed: null,
        maxSpeed: null,
        avgSpeed: null,
        maxVS: null,
        minVS: null,
        minDistance: null,
        maxDistance: null,
        signalMin: null,
        signalMax: null,
        signalAvg: null,
      };
    }

    // Duration
    const firstTime = new Date(sightings[0].timestamp).getTime();
    const lastTime = new Date(sightings[sightings.length - 1].timestamp).getTime();
    const durationMs = lastTime - firstTime;
    const durationMin = Math.round(durationMs / 60000);

    // Altitude stats
    const altitudes = sightings
      .map((s) => s.altitude)
      .filter((a) => a !== null && a !== undefined && a > 0);
    const minAlt = altitudes.length ? Math.min(...altitudes) : null;
    const maxAlt = altitudes.length ? Math.max(...altitudes) : null;
    const avgAlt = altitudes.length
      ? Math.round(altitudes.reduce((a, b) => a + b, 0) / altitudes.length)
      : null;

    // Speed stats
    const speeds = sightings.map((s) => s.gs).filter((s) => s !== null && s !== undefined && s > 0);
    const minSpeed = speeds.length ? Math.min(...speeds) : null;
    const maxSpeed = speeds.length ? Math.max(...speeds) : null;
    const avgSpeed = speeds.length
      ? Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length)
      : null;

    // Vertical speed stats
    const vSpeeds = sightings.map((s) => s.vr).filter((v) => v !== null && v !== undefined);
    const maxVS = vSpeeds.length ? Math.max(...vSpeeds) : null;
    const minVS = vSpeeds.length ? Math.min(...vSpeeds) : null;

    // Distance stats
    const distances = sightings
      .map((s) => s.distance_nm)
      .filter((d) => d !== null && d !== undefined);
    const minDistance = distances.length ? Math.min(...distances) : null;
    const maxDistance = distances.length ? Math.max(...distances) : null;

    // Signal stats
    const signals = sightings.map((s) => s.rssi).filter((r) => r !== null && r !== undefined);
    const signalMin = signals.length ? Math.min(...signals) : null;
    const signalMax = signals.length ? Math.max(...signals) : null;
    const signalAvg = signals.length
      ? (signals.reduce((a, b) => a + b, 0) / signals.length).toFixed(1)
      : null;

    return {
      duration: durationMin,
      positionCount: sightings.length,
      minAlt,
      maxAlt,
      avgAlt,
      minSpeed,
      maxSpeed,
      avgSpeed,
      maxVS,
      minVS,
      minDistance,
      maxDistance,
      signalMin,
      signalMax,
      signalAvg,
    };
  }, [sightings]);

  const formatAltitude = (alt) => {
    if (alt === null || alt === undefined) return '--';
    return alt >= 1000 ? `${(alt / 1000).toFixed(1)}k` : alt;
  };

  const formatSpeed = (spd) => {
    if (spd === null || spd === undefined) return '--';
    return Math.round(spd);
  };

  const formatVS = (vs) => {
    if (vs === null || vs === undefined) return '--';
    return vs > 0 ? `+${vs}` : vs;
  };

  const formatDistance = (dist) => {
    if (dist === null || dist === undefined) return '--';
    return dist.toFixed(1);
  };

  const formatSignal = (sig) => {
    if (sig === null || sig === undefined) return '--';
    return sig.toFixed(1);
  };

  return (
    <div className={`flight-stats-panel ${className}`}>
      <div className="flight-stats-panel__title">Flight Statistics</div>

      {/* Duration and positions */}
      <div className="flight-stats-panel__stat">
        <span className="flight-stats-panel__stat-label">Duration</span>
        <span className="flight-stats-panel__stat-value">{stats.duration} min</span>
      </div>
      <div className="flight-stats-panel__stat">
        <span className="flight-stats-panel__stat-label">Positions</span>
        <span className="flight-stats-panel__stat-value">
          {stats.positionCount.toLocaleString()}
        </span>
      </div>

      {/* Altitude section */}
      <div
        className="flight-stats-panel__title"
        style={{ marginTop: '12px', color: 'var(--viz-altitude-low)' }}
      >
        Altitude
      </div>
      <div className="flight-stats-panel__stat">
        <span className="flight-stats-panel__stat-label">Min</span>
        <span className="flight-stats-panel__stat-value">{formatAltitude(stats.minAlt)} ft</span>
      </div>
      <div className="flight-stats-panel__stat">
        <span className="flight-stats-panel__stat-label">Max</span>
        <span className="flight-stats-panel__stat-value">{formatAltitude(stats.maxAlt)} ft</span>
      </div>
      <div className="flight-stats-panel__stat">
        <span className="flight-stats-panel__stat-label">Avg</span>
        <span className="flight-stats-panel__stat-value">{formatAltitude(stats.avgAlt)} ft</span>
      </div>

      {/* Speed section */}
      <div
        className="flight-stats-panel__title"
        style={{ marginTop: '12px', color: 'var(--viz-speed-mid)' }}
      >
        Speed
      </div>
      <div className="flight-stats-panel__stat">
        <span className="flight-stats-panel__stat-label">Min</span>
        <span className="flight-stats-panel__stat-value">{formatSpeed(stats.minSpeed)} kts</span>
      </div>
      <div className="flight-stats-panel__stat">
        <span className="flight-stats-panel__stat-label">Max</span>
        <span className="flight-stats-panel__stat-value">{formatSpeed(stats.maxSpeed)} kts</span>
      </div>
      <div className="flight-stats-panel__stat">
        <span className="flight-stats-panel__stat-label">Avg</span>
        <span className="flight-stats-panel__stat-value">{formatSpeed(stats.avgSpeed)} kts</span>
      </div>

      {/* Vertical speed section */}
      <div
        className="flight-stats-panel__title"
        style={{ marginTop: '12px', color: 'var(--accent-yellow)' }}
      >
        Vertical Speed
      </div>
      <div className="flight-stats-panel__stat">
        <span className="flight-stats-panel__stat-label">Max Climb</span>
        <span
          className="flight-stats-panel__stat-value"
          style={{ color: stats.maxVS != null && stats.maxVS > 0 ? 'var(--accent-green)' : undefined }}
        >
          {formatVS(stats.maxVS)} fpm
        </span>
      </div>
      <div className="flight-stats-panel__stat">
        <span className="flight-stats-panel__stat-label">Max Desc</span>
        <span
          className="flight-stats-panel__stat-value"
          style={{ color: stats.minVS != null && stats.minVS < 0 ? 'var(--accent-red)' : undefined }}
        >
          {formatVS(stats.minVS)} fpm
        </span>
      </div>

      {/* Distance section */}
      <div
        className="flight-stats-panel__title"
        style={{ marginTop: '12px', color: 'var(--viz-military)' }}
      >
        Distance
      </div>
      <div className="flight-stats-panel__stat">
        <span className="flight-stats-panel__stat-label">Closest</span>
        <span className="flight-stats-panel__stat-value">
          {formatDistance(stats.minDistance)} nm
        </span>
      </div>
      <div className="flight-stats-panel__stat">
        <span className="flight-stats-panel__stat-label">Farthest</span>
        <span className="flight-stats-panel__stat-value">
          {formatDistance(stats.maxDistance)} nm
        </span>
      </div>

      {/* Signal section */}
      <div
        className="flight-stats-panel__title"
        style={{ marginTop: '12px', color: 'var(--viz-signal-excellent)' }}
      >
        Signal Strength
      </div>
      <div className="flight-stats-panel__stat">
        <span className="flight-stats-panel__stat-label">Best</span>
        <span className="flight-stats-panel__stat-value">{formatSignal(stats.signalMax)} dB</span>
      </div>
      <div className="flight-stats-panel__stat">
        <span className="flight-stats-panel__stat-label">Worst</span>
        <span className="flight-stats-panel__stat-value">{formatSignal(stats.signalMin)} dB</span>
      </div>
      <div className="flight-stats-panel__stat">
        <span className="flight-stats-panel__stat-label">Avg</span>
        <span className="flight-stats-panel__stat-value">{stats.signalAvg || '--'} dB</span>
      </div>
    </div>
  );
}

FlightStatsPanel.propTypes = {
  sightings: PropTypes.array,
  session: PropTypes.object,
  className: PropTypes.string,
};

export default FlightStatsPanel;
