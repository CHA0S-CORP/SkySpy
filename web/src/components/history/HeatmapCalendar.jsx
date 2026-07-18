import { useMemo } from 'react';
import PropTypes from 'prop-types';

/**
 * HeatmapCalendar - GitHub-style activity heatmap (hour x day)
 */
export function HeatmapCalendar({
  data = [],
  dateField = 'timestamp',
  countField = null, // If null, counts occurrences
  days = 7,
  showLabels = true,
  showLegend = true,
  cellSize = 12,
  cellGap = 2,
  colorScale = 'cyan',
  onCellClick,
  className = '',
}) {
  // Process data into hour x day matrix
  const { matrix, maxCount, dayLabels, hourLabels } = useMemo(() => {
    // Anchor rows to local calendar days (midnight) so events are attributed to
    // the day they occurred, not to rolling 24h windows ending at render time
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // Initialize matrix (days x hours)
    const mat = Array.from({ length: days }, () => Array(24).fill(0));

    // Day labels (showing day of week)
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dLabels = [];
    for (let d = 0; d < days; d++) {
      const date = new Date(startOfToday);
      date.setDate(startOfToday.getDate() - (days - 1 - d));
      dLabels.push(dayNames[date.getDay()]);
    }

    // Hour labels
    const hLabels = Array.from({ length: 24 }, (_, i) =>
      i % 6 === 0 ? `${i.toString().padStart(2, '0')}:00` : ''
    );

    // Count occurrences per hour/day
    data.forEach((item) => {
      const timestamp = item[dateField];
      if (!timestamp) return;

      const date = new Date(timestamp);
      if (Number.isNaN(date.getTime())) return;

      // Calculate day index by calendar-day difference (0 = oldest, days-1 = today)
      const startOfEventDay = new Date(date);
      startOfEventDay.setHours(0, 0, 0, 0);
      // Math.round tolerates DST-shortened/lengthened days
      const daysDiff = Math.round(
        (startOfToday.getTime() - startOfEventDay.getTime()) / (24 * 60 * 60 * 1000)
      );
      const dayIndex = days - 1 - daysDiff;

      if (dayIndex < 0 || dayIndex >= days) return;

      const hour = date.getHours();
      const value = countField ? item[countField] || 1 : 1;
      mat[dayIndex][hour] += value;
    });

    const max = Math.max(...mat.flat(), 1);

    return { matrix: mat, maxCount: max, dayLabels: dLabels, hourLabels: hLabels };
  }, [data, dateField, countField, days]);

  // Color scales
  const colorScales = {
    cyan: {
      0: 'rgba(0, 212, 255, 0.05)',
      0.25: 'rgba(0, 212, 255, 0.25)',
      0.5: 'rgba(0, 212, 255, 0.5)',
      0.75: 'rgba(0, 212, 255, 0.75)',
      1: 'rgba(0, 212, 255, 0.95)',
    },
    green: {
      0: 'rgba(74, 222, 128, 0.05)',
      0.25: 'rgba(74, 222, 128, 0.25)',
      0.5: 'rgba(74, 222, 128, 0.5)',
      0.75: 'rgba(74, 222, 128, 0.75)',
      1: 'rgba(74, 222, 128, 0.95)',
    },
    heat: {
      0: 'rgba(59, 130, 246, 0.8)',
      0.25: 'rgba(34, 197, 94, 0.8)',
      0.5: 'rgba(250, 204, 21, 0.8)',
      0.75: 'rgba(249, 115, 22, 0.8)',
      1: 'rgba(239, 68, 68, 0.8)',
    },
  };

  const getColor = (count) => {
    if (count === 0) return 'var(--bg-hover)';
    const normalized = count / maxCount;
    const scale = colorScales[colorScale] || colorScales.cyan;
    const thresholds = Object.keys(scale)
      .map(Number)
      .sort((a, b) => a - b);

    for (let i = thresholds.length - 1; i >= 0; i--) {
      if (normalized >= thresholds[i]) {
        return scale[thresholds[i]];
      }
    }
    return scale[0];
  };

  const labelWidth = showLabels ? 30 : 0;

  return (
    <div className={`heatmap-calendar ${className}`}>
      {/* Hour labels (top) */}
      {showLabels && (
        <div
          className="heatmap-calendar__header"
          style={{
            display: 'flex',
            gap: `${cellGap}px`,
            paddingLeft: `${labelWidth}px`,
            marginBottom: '4px',
          }}
        >
          {hourLabels.map((label, i) => (
            <div
              key={i}
              style={{
                width: cellSize,
                fontSize: '9px',
                color: 'var(--text-dim)',
                textAlign: 'center',
              }}
            >
              {label}
            </div>
          ))}
        </div>
      )}

      {/* Matrix rows (days) */}
      {matrix.map((row, dayIndex) => (
        <div
          key={dayIndex}
          className="heatmap-calendar__row"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: `${cellGap}px`,
            marginBottom: dayIndex < matrix.length - 1 ? `${cellGap}px` : 0,
          }}
        >
          {/* Day label */}
          {showLabels && (
            <div
              className="heatmap-calendar__day-label"
              style={{
                width: labelWidth,
                fontSize: '9px',
                color: 'var(--text-dim)',
                textAlign: 'right',
                paddingRight: '4px',
              }}
            >
              {dayLabels[dayIndex]}
            </div>
          )}

          {/* Hour cells */}
          <div className="heatmap-calendar__cells" style={{ display: 'flex', gap: `${cellGap}px` }}>
            {row.map((count, hourIndex) => (
              <div
                key={hourIndex}
                className="heatmap-calendar__cell"
                role="button"
                tabIndex={0}
                onClick={() => onCellClick?.({ day: dayIndex, hour: hourIndex, count })}
                onKeyDown={(e) =>
                  e.key === 'Enter' && onCellClick?.({ day: dayIndex, hour: hourIndex, count })
                }
                title={`${dayLabels[dayIndex]} ${hourIndex}:00 - ${count} events`}
                style={{
                  width: cellSize,
                  height: cellSize,
                  background: getColor(count),
                  borderRadius: '2px',
                  cursor: onCellClick ? 'pointer' : 'default',
                  transition: 'transform 0.1s ease',
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.transform = 'scale(1.15)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                }}
                onFocus={(e) => {
                  e.currentTarget.style.transform = 'scale(1.15)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Legend */}
      {showLegend && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginTop: '12px',
            paddingLeft: labelWidth,
            fontSize: '10px',
            color: 'var(--text-dim)',
          }}
        >
          <span>Less</span>
          <div style={{ display: 'flex', gap: '2px' }}>
            {[0, 0.25, 0.5, 0.75, 1].map((level) => (
              <div
                key={level}
                style={{
                  width: cellSize - 2,
                  height: cellSize - 2,
                  background: level === 0 ? 'var(--bg-hover)' : getColor(level * maxCount),
                  borderRadius: '2px',
                }}
              />
            ))}
          </div>
          <span>More</span>
        </div>
      )}
    </div>
  );
}

HeatmapCalendar.propTypes = {
  data: PropTypes.array,
  dateField: PropTypes.string,
  countField: PropTypes.string,
  days: PropTypes.number,
  showLabels: PropTypes.bool,
  showLegend: PropTypes.bool,
  cellSize: PropTypes.number,
  cellGap: PropTypes.number,
  colorScale: PropTypes.oneOf(['cyan', 'green', 'heat']),
  onCellClick: PropTypes.func,
  className: PropTypes.string,
};

export default HeatmapCalendar;
