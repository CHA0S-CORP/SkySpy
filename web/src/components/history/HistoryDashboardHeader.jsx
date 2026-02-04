import { useMemo } from 'react';
import PropTypes from 'prop-types';
import { RefreshCw } from 'lucide-react';
import { MetricCard } from '../common/MetricCard';
import { Sparkline } from '../common/Sparkline';

/**
 * HistoryDashboardHeader - Dashboard header with KPI metrics row
 */
export function HistoryDashboardHeader({
  sessions = [],
  sightings = [],
  safetyEvents = [],
  timeRange = 24,
  onTimeRangeChange,
  viewMode = 'grid',
  onViewModeChange,
  loading = false,
  onRefresh,
}) {
  // Calculate metrics from sessions data
  const metrics = useMemo(() => {
    if (!sessions.length) {
      return {
        totalSessions: 0,
        uniqueAircraft: 0,
        avgDuration: 0,
        maxDistance: 0,
        safetyEventCount: 0,
        militaryCount: 0,
        activityTrend: [],
      };
    }

    // Unique aircraft by ICAO
    const uniqueIcaos = new Set(sessions.map((s) => s.icao_hex));

    // Average duration
    const avgDuration = sessions.reduce((sum, s) => sum + (s.duration_min || 0), 0) / sessions.length;

    // Max distance
    const maxDistance = Math.max(...sessions.map((s) => s.max_distance_nm || 0), 0);

    // Military count
    const militaryCount = sessions.filter((s) => s.is_military).length;

    // Safety event count
    const safetyCount = sessions.reduce((sum, s) => sum + (s.safety_event_count || 0), 0);

    // Activity trend (group sessions by hour)
    const hourBuckets = {};
    sessions.forEach((s) => {
      const hour = new Date(s.first_seen).getHours();
      hourBuckets[hour] = (hourBuckets[hour] || 0) + 1;
    });
    const activityTrend = Array.from({ length: 24 }, (_, i) => hourBuckets[i] || 0);

    return {
      totalSessions: sessions.length,
      uniqueAircraft: uniqueIcaos.size,
      avgDuration: Math.round(avgDuration),
      maxDistance: Math.round(maxDistance),
      safetyEventCount: safetyCount,
      militaryCount,
      activityTrend,
    };
  }, [sessions]);

  const timeRanges = [
    { value: 1, label: '1h' },
    { value: 6, label: '6h' },
    { value: 24, label: '24h' },
    { value: 48, label: '48h' },
    { value: 168, label: '7d' },
  ];

  return (
    <div className="history-dashboard-header">
      {/* Top row: Time range + quick stats */}
      <div className="history-dashboard-header__row">
        {/* Time range selector */}
        <div className="time-range-selector">
          {timeRanges.map((range) => (
            <button
              key={range.value}
              className={`time-range-selector__option ${
                timeRange === range.value ? 'time-range-selector__option--active' : ''
              }`}
              onClick={() => onTimeRangeChange?.(range.value)}
            >
              {range.label}
            </button>
          ))}
        </div>

        {/* Metrics cards */}
        <div className="history-dashboard-header__metrics">
          <MetricCard
            label="Sessions"
            value={metrics.totalSessions}
            icon={<span>📡</span>}
            trendData={metrics.activityTrend.slice(-12)}
            trendType="bar"
            size="compact"
            loading={loading}
            color="var(--accent-cyan)"
          />

          <MetricCard
            label="Aircraft"
            value={metrics.uniqueAircraft}
            icon={<span>✈️</span>}
            size="compact"
            loading={loading}
            color="var(--accent-green)"
          />

          <MetricCard
            label="Avg Duration"
            value={metrics.avgDuration}
            unit="min"
            icon={<span>⏱️</span>}
            size="compact"
            loading={loading}
            color="var(--accent-blue)"
          />

          <MetricCard
            label="Max Range"
            value={metrics.maxDistance}
            unit="nm"
            icon={<span>📏</span>}
            size="compact"
            loading={loading}
            color="var(--accent-yellow)"
          />

          {metrics.militaryCount > 0 && (
            <MetricCard
              label="Military"
              value={metrics.militaryCount}
              icon={<span>🎖️</span>}
              size="compact"
              loading={loading}
              color="var(--viz-military)"
            />
          )}

          {metrics.safetyEventCount > 0 && (
            <MetricCard
              label="Safety Events"
              value={metrics.safetyEventCount}
              icon={<span>⚠️</span>}
              size="compact"
              loading={loading}
              color="var(--viz-safety-critical)"
            />
          )}
        </div>

        {/* View toggle + actions */}
        <div className="history-dashboard-header__actions">
          {onRefresh && (
            <button
              className={`refresh-button ${loading ? 'refresh-button--loading' : ''}`}
              onClick={onRefresh}
              disabled={loading}
              title="Refresh data"
            >
              <RefreshCw size={14} className={loading ? 'spinning' : ''} />
            </button>
          )}
          <div className="view-toggle">
            <button
              className={`view-toggle__option ${viewMode === 'grid' ? 'view-toggle__option--active' : ''}`}
              onClick={() => onViewModeChange?.('grid')}
              title="Grid view"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
                <rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
                <rect x="1" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
                <rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
            <button
              className={`view-toggle__option ${viewMode === 'list' ? 'view-toggle__option--active' : ''}`}
              onClick={() => onViewModeChange?.('list')}
              title="List view"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <line x1="1" y1="3" x2="13" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="1" y1="11" x2="13" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <button
              className={`view-toggle__option ${viewMode === 'table' ? 'view-toggle__option--active' : ''}`}
              onClick={() => onViewModeChange?.('table')}
              title="Table view"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="1" y="1" width="12" height="3" rx="1" stroke="currentColor" strokeWidth="1.5" />
                <rect x="1" y="5.5" width="12" height="3" rx="1" stroke="currentColor" strokeWidth="1.5" />
                <rect x="1" y="10" width="12" height="3" rx="1" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Activity sparkline (expanded view) */}
      {metrics.activityTrend.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            paddingTop: '8px',
          }}
        >
          <span
            style={{
              fontSize: '10px',
              color: 'var(--text-dim)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            24h Activity
          </span>
          <Sparkline
            data={metrics.activityTrend}
            type="area"
            width={Math.min(400, window.innerWidth - 200)}
            height={32}
            color="var(--accent-cyan)"
            showLastValue
            valueFormatter={(v) => `${v} sessions`}
          />
        </div>
      )}
    </div>
  );
}

HistoryDashboardHeader.propTypes = {
  sessions: PropTypes.array,
  sightings: PropTypes.array,
  safetyEvents: PropTypes.array,
  timeRange: PropTypes.number,
  onTimeRangeChange: PropTypes.func,
  viewMode: PropTypes.oneOf(['grid', 'list', 'table']),
  onViewModeChange: PropTypes.func,
  loading: PropTypes.bool,
  onRefresh: PropTypes.func,
};

export default HistoryDashboardHeader;
