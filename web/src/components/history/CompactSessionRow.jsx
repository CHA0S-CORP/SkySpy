import PropTypes from 'prop-types';
import { Sparkline } from '../common/Sparkline';
import { getAircraftIcon, formatDuration, formatTime } from './historyConstants';

/**
 * CompactSessionRow - Dense list row with inline sparkline, signal bars, badges
 */
export function CompactSessionRow({
  session,
  onClick,
  onSelectByTail,
  selected = false,
  showSparkline = true,
  className = '',
}) {
  const {
    callsign,
    icao_hex,
    type,
    tail_number,
    is_military,
    safety_event_count,
    duration_min,
    min_distance_nm,
    max_distance_nm,
    max_rssi,
    max_alt,
    first_seen,
    last_seen,
    altitude_history = [],
  } = session;

  // Get aircraft icon
  const icon = getAircraftIcon(type, is_military);

  // Calculate signal strength bars (1-4)
  const getSignalBars = (rssi) => {
    if (!rssi || rssi < -20) return 1;
    if (rssi < -15) return 2;
    if (rssi < -10) return 3;
    return 4;
  };
  const signalBars = getSignalBars(max_rssi);

  // Format time range
  const timeRange = `${formatTime(first_seen)} - ${formatTime(last_seen)}`;

  // Format distance range
  const distanceRange = min_distance_nm === max_distance_nm
    ? `${Math.round(min_distance_nm)}nm`
    : `${Math.round(min_distance_nm)}-${Math.round(max_distance_nm)}nm`;

  return (
    <div
      className={`compact-session-row ${is_military ? 'compact-session-row--military' : ''} ${
        safety_event_count > 0 ? 'compact-session-row--safety' : ''
      } ${selected ? 'compact-session-row--selected' : ''} ${className}`}
      onClick={() => onClick?.(session)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.(session)}
    >
      {/* Icon */}
      <div className="compact-session-row__icon">{icon}</div>

      {/* Identity */}
      <div className="compact-session-row__identity">
        <div className="compact-session-row__callsign">
          {callsign || icao_hex || 'Unknown'}
          {tail_number && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSelectByTail?.(tail_number);
              }}
              style={{
                marginLeft: '6px',
                padding: '1px 4px',
                background: 'var(--bg-hover)',
                border: 'none',
                borderRadius: '3px',
                fontSize: '10px',
                color: 'var(--accent-cyan)',
                cursor: 'pointer',
              }}
              title={`View all sessions for ${tail_number}`}
            >
              {tail_number}
            </button>
          )}
        </div>
        <div className="compact-session-row__type">
          {type || 'Unknown type'}
        </div>
      </div>

      {/* Sparkline */}
      {showSparkline && altitude_history.length > 0 && (
        <div className="compact-session-row__sparkline">
          <Sparkline
            data={altitude_history}
            type="area"
            width={60}
            height={20}
            color="var(--accent-cyan)"
          />
        </div>
      )}

      {/* Stats */}
      <div className="compact-session-row__stats">
        <div className="compact-session-row__stat">
          <span className="compact-session-row__stat-value">
            {formatDuration(duration_min)}
          </span>
          <span className="compact-session-row__stat-label">Duration</span>
        </div>
        <div className="compact-session-row__stat">
          <span className="compact-session-row__stat-value">{distanceRange}</span>
          <span className="compact-session-row__stat-label">Range</span>
        </div>
        {max_alt > 0 && (
          <div className="compact-session-row__stat">
            <span className="compact-session-row__stat-value">
              {max_alt >= 1000 ? `${(max_alt / 1000).toFixed(1)}k` : max_alt}
            </span>
            <span className="compact-session-row__stat-label">Max Alt</span>
          </div>
        )}
      </div>

      {/* Signal bars */}
      <div className="compact-session-row__signal-bars" title={`Signal: ${max_rssi?.toFixed(1) || 'N/A'} dB`}>
        {[1, 2, 3, 4].map((level) => (
          <div
            key={level}
            className={`compact-session-row__signal-bar ${
              level <= signalBars ? 'compact-session-row__signal-bar--filled' : ''
            }`}
            style={{ height: `${level * 3 + 2}px` }}
          />
        ))}
      </div>

      {/* Badges */}
      <div className="compact-session-row__badges">
        {is_military && (
          <span className="compact-session-row__badge compact-session-row__badge--military">
            MIL
          </span>
        )}
        {safety_event_count > 0 && (
          <span className="compact-session-row__badge compact-session-row__badge--safety">
            {safety_event_count}
          </span>
        )}
      </div>

      {/* Time */}
      <div className="compact-session-row__time">{timeRange}</div>
    </div>
  );
}

CompactSessionRow.propTypes = {
  session: PropTypes.shape({
    callsign: PropTypes.string,
    icao_hex: PropTypes.string,
    type: PropTypes.string,
    tail_number: PropTypes.string,
    is_military: PropTypes.bool,
    safety_event_count: PropTypes.number,
    duration_min: PropTypes.number,
    min_distance_nm: PropTypes.number,
    max_distance_nm: PropTypes.number,
    max_rssi: PropTypes.number,
    max_alt: PropTypes.number,
    first_seen: PropTypes.string,
    last_seen: PropTypes.string,
    altitude_history: PropTypes.arrayOf(PropTypes.number),
  }).isRequired,
  onClick: PropTypes.func,
  onSelectByTail: PropTypes.func,
  selected: PropTypes.bool,
  showSparkline: PropTypes.bool,
  className: PropTypes.string,
};

export default CompactSessionRow;
