import React, { useMemo } from 'react';
import {
  Calendar, TrendingUp, TrendingDown, Sun, Moon,
  ArrowUpRight, ArrowDownRight, Minus, BarChart2,
  Clock, Loader2
} from 'lucide-react';

/**
 * TimeComparisonSection - Displays time-based comparisons
 * - Week-over-week comparison cards
 * - Day/night ratio visualization
 * - Weekend vs weekday chart
 * - Trend charts (30-day, 12-week, 12-month)
 */
export function TimeComparisonSection({ data, loading }) {
  // Show loading skeleton when data is loading
  if (loading) {
    return (
      <div className="stats-section time-comparison-section">
        <div className="section-header">
          <Calendar size={18} />
          <span>Time Comparison</span>
        </div>
        <div className="section-loading">
          <Loader2 size={24} className="spin" />
          <span>Loading time comparisons...</span>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const {
    week_over_week = {},
    day_night_ratio = {},
    weekend_weekday = {},
    trends = {}
  } = data;

  // Calculate change indicators
  const getChangeIcon = (change) => {
    if (change > 0) return <ArrowUpRight size={14} />;
    if (change < 0) return <ArrowDownRight size={14} />;
    return <Minus size={14} />;
  };

  const getChangeClass = (change) => {
    if (change > 5) return 'positive';
    if (change < -5) return 'negative';
    return 'neutral';
  };

  // Week over week metrics
  const wowMetrics = [
    {
      label: 'Total Aircraft',
      current: week_over_week.current_total ?? '--',
      previous: week_over_week.previous_total ?? '--',
      change: week_over_week.total_change_pct ?? 0
    },
    {
      label: 'Unique Types',
      current: week_over_week.current_types ?? '--',
      previous: week_over_week.previous_types ?? '--',
      change: week_over_week.types_change_pct ?? 0
    },
    {
      label: 'Peak Concurrent',
      current: week_over_week.current_peak ?? '--',
      previous: week_over_week.previous_peak ?? '--',
      change: week_over_week.peak_change_pct ?? 0
    },
    {
      label: 'Avg Duration',
      current: week_over_week.current_avg_duration ? `${week_over_week.current_avg_duration.toFixed(0)}m` : '--',
      previous: week_over_week.previous_avg_duration ? `${week_over_week.previous_avg_duration.toFixed(0)}m` : '--',
      change: week_over_week.duration_change_pct ?? 0
    }
  ];

  // Day/Night data
  const dayCount = day_night_ratio.day_count ?? 0;
  const nightCount = day_night_ratio.night_count ?? 0;
  const totalDayNight = dayCount + nightCount || 1;
  const dayPct = ((dayCount / totalDayNight) * 100).toFixed(1);
  const nightPct = ((nightCount / totalDayNight) * 100).toFixed(1);

  // Weekend/Weekday data
  const weekendCount = weekend_weekday.weekend_count ?? 0;
  const weekdayCount = weekend_weekday.weekday_count ?? 0;
  const weekendAvg = weekend_weekday.weekend_avg ?? 0;
  const weekdayAvg = weekend_weekday.weekday_avg ?? 0;

  // Normalize trend data for chart
  const normalizeTrendData = (trendData, maxPoints) => {
    if (!trendData || trendData.length === 0) return [];
    const data = trendData.slice(-maxPoints);
    const max = Math.max(...data.map(d => d.value || 0), 1);
    return data.map(d => ({
      ...d,
      normalized: ((d.value || 0) / max) * 100
    }));
  };

  const thirtyDayTrend = useMemo(() =>
    normalizeTrendData(trends.daily_30, 30),
    [trends.daily_30]
  );

  const twelveWeekTrend = useMemo(() =>
    normalizeTrendData(trends.weekly_12, 12),
    [trends.weekly_12]
  );

  const twelveMonthTrend = useMemo(() =>
    normalizeTrendData(trends.monthly_12, 12),
    [trends.monthly_12]
  );

  return (
    <div className="stats-section time-comparison-section">
      <div className="section-header">
        <Calendar size={18} />
        <span>Time Comparisons</span>
      </div>

      <div className="time-comparison-grid">
        {/* Week over Week Cards */}
        <div className="comparison-card wow-card">
          <div className="card-header">
            <TrendingUp size={16} />
            <span>Week over Week</span>
          </div>
          <div className="wow-metrics">
            {wowMetrics.map((metric, i) => (
              <div key={i} className="wow-metric">
                <div className="wow-metric-header">
                  <span className="wow-label">{metric.label}</span>
                  <span className={`wow-change ${getChangeClass(metric.change)}`}>
                    {getChangeIcon(metric.change)}
                    {Math.abs(metric.change).toFixed(1)}%
                  </span>
                </div>
                <div className="wow-values">
                  <span className="wow-current">{metric.current}</span>
                  <span className="wow-vs">vs</span>
                  <span className="wow-previous">{metric.previous}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Day/Night Ratio */}
        <div className="comparison-card daynight-card">
          <div className="card-header">
            <Sun size={16} />
            <span>Day/Night Ratio</span>
          </div>
          <div className="daynight-content">
            <div className="daynight-bar">
              <div
                className="daynight-day"
                style={{ width: `${dayPct}%` }}
                title={`Day: ${dayCount} (${dayPct}%)`}
              >
                <Sun size={14} />
              </div>
              <div
                className="daynight-night"
                style={{ width: `${nightPct}%` }}
                title={`Night: ${nightCount} (${nightPct}%)`}
              >
                <Moon size={14} />
              </div>
            </div>
            <div className="daynight-stats">
              <div className="daynight-stat day">
                <Sun size={16} />
                <div className="daynight-stat-content">
                  <span className="daynight-value">{dayCount.toLocaleString()}</span>
                  <span className="daynight-label">Day ({dayPct}%)</span>
                </div>
              </div>
              <div className="daynight-stat night">
                <Moon size={16} />
                <div className="daynight-stat-content">
                  <span className="daynight-value">{nightCount.toLocaleString()}</span>
                  <span className="daynight-label">Night ({nightPct}%)</span>
                </div>
              </div>
            </div>
            {day_night_ratio.sunrise && day_night_ratio.sunset && (
              <div className="daynight-times">
                <span>Sunrise: {day_night_ratio.sunrise}</span>
                <span>Sunset: {day_night_ratio.sunset}</span>
              </div>
            )}
          </div>
        </div>

        {/* Weekend vs Weekday */}
        <div className="comparison-card weekend-card">
          <div className="card-header">
            <Calendar size={16} />
            <span>Weekend vs Weekday</span>
          </div>
          <div className="weekend-content">
            <div className="weekend-bars">
              <div className="weekend-bar-item">
                <span className="weekend-bar-label">Weekday</span>
                <div className="weekend-bar-track">
                  <div
                    className="weekend-bar-fill weekday"
                    style={{
                      width: `${Math.min((weekdayAvg / Math.max(weekdayAvg, weekendAvg, 1)) * 100, 100)}%`
                    }}
                  />
                </div>
                <span className="weekend-bar-value">{weekdayAvg.toFixed(0)}/day</span>
              </div>
              <div className="weekend-bar-item">
                <span className="weekend-bar-label">Weekend</span>
                <div className="weekend-bar-track">
                  <div
                    className="weekend-bar-fill weekend"
                    style={{
                      width: `${Math.min((weekendAvg / Math.max(weekdayAvg, weekendAvg, 1)) * 100, 100)}%`
                    }}
                  />
                </div>
                <span className="weekend-bar-value">{weekendAvg.toFixed(0)}/day</span>
              </div>
            </div>
            <div className="weekend-totals">
              <div className="weekend-total">
                <span className="total-value">{weekdayCount.toLocaleString()}</span>
                <span className="total-label">Weekday flights</span>
              </div>
              <div className="weekend-total">
                <span className="total-value">{weekendCount.toLocaleString()}</span>
                <span className="total-label">Weekend flights</span>
              </div>
            </div>
          </div>
        </div>

        {/* Trend Charts */}
        <div className="comparison-card trends-card">
          <div className="card-header">
            <BarChart2 size={16} />
            <span>Activity Trends</span>
          </div>
          <div className="trends-content">
            {/* 30-Day Trend */}
            {thirtyDayTrend.length > 0 && (
              <div className="trend-chart">
                <div className="trend-label">Last 30 Days</div>
                <div className="trend-bars">
                  {thirtyDayTrend.map((point, i) => (
                    <div
                      key={i}
                      className="trend-bar"
                      style={{ height: `${point.normalized}%` }}
                      title={`${point.label || point.date}: ${point.value}`}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 12-Week Trend */}
            {twelveWeekTrend.length > 0 && (
              <div className="trend-chart">
                <div className="trend-label">Last 12 Weeks</div>
                <div className="trend-bars">
                  {twelveWeekTrend.map((point, i) => (
                    <div
                      key={i}
                      className="trend-bar weekly"
                      style={{ height: `${point.normalized}%` }}
                      title={`${point.label || `Week ${i + 1}`}: ${point.value}`}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 12-Month Trend */}
            {twelveMonthTrend.length > 0 && (
              <div className="trend-chart">
                <div className="trend-label">Last 12 Months</div>
                <div className="trend-bars">
                  {twelveMonthTrend.map((point, i) => (
                    <div
                      key={i}
                      className="trend-bar monthly"
                      style={{ height: `${point.normalized}%` }}
                      title={`${point.label || point.month}: ${point.value}`}
                    />
                  ))}
                </div>
              </div>
            )}

            {thirtyDayTrend.length === 0 && twelveWeekTrend.length === 0 && twelveMonthTrend.length === 0 && (
              <div className="empty-state">No trend data available</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default TimeComparisonSection;
