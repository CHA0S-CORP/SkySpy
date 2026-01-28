import React, { useMemo, useCallback, useState } from 'react';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

/**
 * Activity Heatmap showing time-of-day and day-of-week patterns
 * @param {Object} props
 * @param {Array} props.data - Array of objects with timestamp field
 * @param {string} props.timestampKey - Key to extract timestamp from data points (default: 'timestamp')
 * @param {Function} props.onCellClick - Callback when clicking a cell (day, hour, count)
 * @param {string} props.colorScheme - Color scheme: 'cyan' | 'green' | 'purple' | 'orange'
 * @param {string} props.title - Heatmap title
 * @param {string} props.variant - 'full' (7x24) or 'compact' (7x4 time blocks)
 */
export function ActivityHeatmap({
  data = [],
  timestampKey = 'timestamp',
  onCellClick,
  colorScheme = 'cyan',
  title = 'Activity Heatmap',
  variant = 'full',
}) {
  const [hoveredCell, setHoveredCell] = useState(null);

  // Color schemes
  const colorSchemes = {
    cyan: ['rgba(0, 200, 255, 0.1)', 'rgba(0, 200, 255, 0.3)', 'rgba(0, 200, 255, 0.5)', 'rgba(0, 200, 255, 0.7)', 'rgba(0, 200, 255, 1)'],
    green: ['rgba(0, 255, 136, 0.1)', 'rgba(0, 255, 136, 0.3)', 'rgba(0, 255, 136, 0.5)', 'rgba(0, 255, 136, 0.7)', 'rgba(0, 255, 136, 1)'],
    purple: ['rgba(163, 113, 247, 0.1)', 'rgba(163, 113, 247, 0.3)', 'rgba(163, 113, 247, 0.5)', 'rgba(163, 113, 247, 0.7)', 'rgba(163, 113, 247, 1)'],
    orange: ['rgba(255, 159, 67, 0.1)', 'rgba(255, 159, 67, 0.3)', 'rgba(255, 159, 67, 0.5)', 'rgba(255, 159, 67, 0.7)', 'rgba(255, 159, 67, 1)'],
  };

  const colors = colorSchemes[colorScheme] || colorSchemes.cyan;

  // Build heatmap matrix
  const heatmapData = useMemo(() => {
    const matrix = {};
    let maxCount = 0;

    // Initialize matrix
    DAYS.forEach((_, dayIdx) => {
      if (variant === 'compact') {
        // 4 time blocks: Night (0-5), Morning (6-11), Afternoon (12-17), Evening (18-23)
        [0, 1, 2, 3].forEach(block => {
          matrix[`${dayIdx}-${block}`] = { count: 0, events: [] };
        });
      } else {
        HOURS.forEach(hour => {
          matrix[`${dayIdx}-${hour}`] = { count: 0, events: [] };
        });
      }
    });

    // Count events
    data.forEach(item => {
      const timestamp = item[timestampKey];
      if (!timestamp) return;

      const date = new Date(timestamp);
      if (isNaN(date.getTime())) return;

      const day = date.getDay();
      const hour = date.getHours();

      let key;
      if (variant === 'compact') {
        const block = Math.floor(hour / 6);
        key = `${day}-${block}`;
      } else {
        key = `${day}-${hour}`;
      }

      if (matrix[key]) {
        matrix[key].count++;
        matrix[key].events.push(item);
        maxCount = Math.max(maxCount, matrix[key].count);
      }
    });

    return { matrix, maxCount };
  }, [data, timestampKey, variant]);

  // Get color for cell based on count
  const getCellColor = useCallback((count) => {
    if (count === 0) return 'rgba(90, 122, 154, 0.1)';
    if (heatmapData.maxCount === 0) return colors[0];

    const intensity = count / heatmapData.maxCount;
    if (intensity < 0.2) return colors[0];
    if (intensity < 0.4) return colors[1];
    if (intensity < 0.6) return colors[2];
    if (intensity < 0.8) return colors[3];
    return colors[4];
  }, [heatmapData.maxCount, colors]);

  // Handle cell click
  const handleCellClick = useCallback((dayIdx, hourOrBlock) => {
    const key = `${dayIdx}-${hourOrBlock}`;
    const cellData = heatmapData.matrix[key];
    if (cellData && onCellClick) {
      onCellClick({
        day: dayIdx,
        dayName: DAYS[dayIdx],
        hour: variant === 'compact' ? hourOrBlock * 6 : hourOrBlock,
        block: variant === 'compact' ? hourOrBlock : null,
        count: cellData.count,
        events: cellData.events,
      });
    }
  }, [heatmapData.matrix, onCellClick, variant]);

  // Time labels for full variant
  const hourLabels = variant === 'full'
    ? [0, 3, 6, 9, 12, 15, 18, 21].map(h => ({
        hour: h,
        label: h === 0 ? '12a' : h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`
      }))
    : [
        { block: 0, label: 'Night' },
        { block: 1, label: 'Morning' },
        { block: 2, label: 'Afternoon' },
        { block: 3, label: 'Evening' },
      ];

  // Calculate total events
  const totalEvents = data.length;

  return (
    <div className="activity-heatmap">
      <div className="heatmap-header">
        <span className="heatmap-title">{title}</span>
        <span className="heatmap-total">{totalEvents.toLocaleString()} events</span>
      </div>

      <div className={`heatmap-grid variant-${variant}`}>
        {/* Hour labels (top) */}
        <div className="heatmap-hour-labels">
          <div className="label-spacer"></div>
          {variant === 'full' ? (
            HOURS.map(hour => (
              <div
                key={hour}
                className={`hour-label ${hour % 3 === 0 ? 'major' : ''}`}
              >
                {hour % 3 === 0 ? hourLabels.find(h => h.hour === hour)?.label : ''}
              </div>
            ))
          ) : (
            hourLabels.map(({ block, label }) => (
              <div key={block} className="hour-label block-label">
                {label}
              </div>
            ))
          )}
        </div>

        {/* Day rows */}
        {DAYS.map((day, dayIdx) => (
          <div key={dayIdx} className="heatmap-row">
            <div className="day-label">{day}</div>
            {(variant === 'full' ? HOURS : [0, 1, 2, 3]).map(hourOrBlock => {
              const key = `${dayIdx}-${hourOrBlock}`;
              const cellData = heatmapData.matrix[key];
              const count = cellData?.count || 0;
              const isHovered = hoveredCell === key;

              return (
                <div
                  key={key}
                  className={`heatmap-cell ${count > 0 ? 'has-data' : ''} ${isHovered ? 'hovered' : ''}`}
                  style={{ backgroundColor: getCellColor(count) }}
                  onClick={() => handleCellClick(dayIdx, hourOrBlock)}
                  onMouseEnter={() => setHoveredCell(key)}
                  onMouseLeave={() => setHoveredCell(null)}
                  title={`${day} ${variant === 'full' ? `${hourOrBlock}:00` : hourLabels[hourOrBlock].label}: ${count} events`}
                >
                  {variant === 'compact' && count > 0 && (
                    <span className="cell-count">{count}</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="heatmap-legend">
        <span className="legend-label">Less</span>
        <div className="legend-scale">
          {colors.map((color, i) => (
            <div
              key={i}
              className="legend-cell"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
        <span className="legend-label">More</span>
      </div>

      {/* Tooltip */}
      {hoveredCell && heatmapData.matrix[hoveredCell] && (
        <div className="heatmap-tooltip">
          <div className="tooltip-count">
            {heatmapData.matrix[hoveredCell].count} events
          </div>
          <div className="tooltip-time">
            {DAYS[parseInt(hoveredCell.split('-')[0])]}
            {variant === 'full'
              ? ` ${hoveredCell.split('-')[1]}:00`
              : ` ${hourLabels[parseInt(hoveredCell.split('-')[1])].label}`
            }
          </div>
        </div>
      )}
    </div>
  );
}

export default ActivityHeatmap;
