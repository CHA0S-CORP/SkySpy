import React, { useState, useMemo } from 'react';
import {
  Calendar, TrendingUp, TrendingDown, Sun, Moon,
  ArrowUpRight, ArrowDownRight, Minus, BarChart2,
  Clock, Filter, ChevronDown, RefreshCw
} from 'lucide-react';
import { useStats } from '../../hooks';

/**
 * TimeComparisonStats - Full page view for time-based comparisons
 * - Week-over-week comparison cards
 * - Day/night ratio visualization
 * - Weekend vs weekday chart
 * - Trend charts (30-day, 12-week, 12-month)
 */
export function TimeComparisonStats({ apiBase, wsRequest, wsConnected }) {
  const [timeRange, setTimeRange] = useState('24h');
  const [activeTrendView, setActiveTrendView] = useState('daily');

  const hours = { '24h': 24, '48h': 48, '7d': 168, '30d': 720, '90d': 2160 };
  const selectedHours = hours[timeRange] || 24;

  const { timeComparison, loading, error, refetch } = useStats(apiBase, {
    wsRequest,
    wsConnected,
    hours: selectedHours
  });

  const data = timeComparison;

  const {
    week_over_week = {},
    day_night_ratio = {},
    weekend_weekday = {},
    trends = {}
  } = data || {};

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
      change: week_over_week.total_change_pct ?? 0,
      icon: TrendingUp
    },
    {
      label: 'Unique Types',
      current: week_over_week.current_types ?? '--',
      previous: week_over_week.previous_types ?? '--',
      change: week_over_week.types_change_pct ?? 0,
      icon: BarChart2
    },
    {
      label: 'Peak Concurrent',
      current: week_over_week.current_peak ?? '--',
      previous: week_over_week.previous_peak ?? '--',
      change: week_over_week.peak_change_pct ?? 0,
      icon: TrendingUp
    },
    {
      label: 'Avg Duration',
      current: week_over_week.current_avg_duration ? `${week_over_week.current_avg_duration.toFixed(0)}m` : '--',
      previous: week_over_week.previous_avg_duration ? `${week_over_week.previous_avg_duration.toFixed(0)}m` : '--',
      change: week_over_week.duration_change_pct ?? 0,
      icon: Clock
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

  // Summary stats
  const summaryStats = useMemo(() => ({
    dayNightRatio: dayCount > 0 ? `${(dayCount / nightCount).toFixed(1)}:1` : '--',
    weekendVsWeekday: weekdayAvg > 0 ? `${((weekendAvg / weekdayAvg) * 100 - 100).toFixed(0)}%` : '--',
    totalChange: week_over_week.total_change_pct?.toFixed(1) ?? '--',
    trendDirection: (week_over_week.total_change_pct ?? 0) > 0 ? 'up' : 'down'
  }), [dayCount, nightCount, weekendAvg, weekdayAvg, week_over_week]);

  if (loading && !data) {
    return (
      <div className="stats-page time-comparison-page">
        <div className="loading-state">
          <RefreshCw className="spin" size={24} />
          <span>Loading time comparison data...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="stats-page time-comparison-page">
        <div className="error-state">
          <span>Error loading data: {error}</span>
          <button onClick={refetch}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="stats-page time-comparison-page">
      {/* Page Header */}
      <div className="page-header">
        <div className="page-title">
          <Calendar size={24} />
          <h1>Time Comparisons</h1>
        </div>
        <div className="page-actions">
          <button className="refresh-btn" onClick={refetch} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="stats-filters">
        <div className="filter-group">
          <Clock size={14} />
          <span className="filter-label">Time Range</span>
          <div className="time-range-buttons">
            {Object.keys(hours).map(range => (
              <button
                key={range}
                className={`time-btn ${timeRange === range ? 'active' : ''}`}
                onClick={() => setTimeRange(range)}
              >
                {range}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="summary-cards">
        <div className="summary-card">
          <div className="summary-icon"><Sun size={20} /></div>
          <div className="summary-content">
            <span className="summary-value">{summaryStats.dayNightRatio}</span>
            <span className="summary-label">Day/Night Ratio</span>
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-icon"><Calendar size={20} /></div>
          <div className="summary-content">
            <span className="summary-value">{summaryStats.weekendVsWeekday}</span>
            <span className="summary-label">Weekend vs Weekday</span>
          </div>
        </div>
        <div className="summary-card">
          <div className={`summary-icon ${summaryStats.trendDirection}`}>
            {summaryStats.trendDirection === 'up' ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
          </div>
          <div className="summary-content">
            <span className={`summary-value ${getChangeClass(week_over_week.total_change_pct || 0)}`}>
              {summaryStats.totalChange}%
            </span>
            <span className="summary-label">Week Change</span>
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="time-comparison-grid expanded">
        {/* Week over Week Cards */}
        <div className="comparison-card wow-card large">
          <div className="card-header">
            <TrendingUp size={16} />
            <span>Week over Week</span>
          </div>
          <div className="wow-metrics expanded">
            {wowMetrics.map((metric, i) => (
              <div key={i} className="wow-metric large">
                <div className="wow-metric-icon">
                  <metric.icon size={20} />
                </div>
                <div className="wow-metric-content">
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
              </div>
            ))}
          </div>
        </div>

        {/* Day/Night Ratio */}
        <div className="comparison-card daynight-card large">
          <div className="card-header">
            <Sun size={16} />
            <span>Day/Night Ratio</span>
          </div>
          <div className="daynight-content">
            <div className="daynight-bar large">
              <div
                className="daynight-day"
                style={{ width: `${dayPct}%` }}
                title={`Day: ${dayCount} (${dayPct}%)`}
              >
                <Sun size={18} />
                <span className="daynight-pct">{dayPct}%</span>
              </div>
              <div
                className="daynight-night"
                style={{ width: `${nightPct}%` }}
                title={`Night: ${nightCount} (${nightPct}%)`}
              >
                <Moon size={18} />
                <span className="daynight-pct">{nightPct}%</span>
              </div>
            </div>
            <div className="daynight-stats expanded">
              <div className="daynight-stat day">
                <Sun size={24} />
                <div className="daynight-stat-content">
                  <span className="daynight-value">{dayCount.toLocaleString()}</span>
                  <span className="daynight-label">Day Flights ({dayPct}%)</span>
                  {day_night_ratio.day_peak_hour !== undefined && (
                    <span className="daynight-peak">Peak: {day_night_ratio.day_peak_hour}:00</span>
                  )}
                </div>
              </div>
              <div className="daynight-stat night">
                <Moon size={24} />
                <div className="daynight-stat-content">
                  <span className="daynight-value">{nightCount.toLocaleString()}</span>
                  <span className="daynight-label">Night Flights ({nightPct}%)</span>
                  {day_night_ratio.night_peak_hour !== undefined && (
                    <span className="daynight-peak">Peak: {day_night_ratio.night_peak_hour}:00</span>
                  )}
                </div>
              </div>
            </div>
            {day_night_ratio.sunrise && day_night_ratio.sunset && (
              <div className="daynight-times expanded">
                <span><Sun size={12} /> Sunrise: {day_night_ratio.sunrise}</span>
                <span><Moon size={12} /> Sunset: {day_night_ratio.sunset}</span>
              </div>
            )}
          </div>
        </div>

        {/* Weekend vs Weekday */}
        <div className="comparison-card weekend-card large">
          <div className="card-header">
            <Calendar size={16} />
            <span>Weekend vs Weekday</span>
          </div>
          <div className="weekend-content expanded">
            <div className="weekend-bars large">
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
            <div className="weekend-totals expanded">
              <div className="weekend-total">
                <span className="total-value">{weekdayCount.toLocaleString()}</span>
                <span className="total-label">Weekday Total</span>
                <span className="total-days">(Mon-Fri)</span>
              </div>
              <div className="weekend-total">
                <span className="total-value">{weekendCount.toLocaleString()}</span>
                <span className="total-label">Weekend Total</span>
                <span className="total-days">(Sat-Sun)</span>
              </div>
              <div className="weekend-total comparison">
                <span className={`total-value ${weekendAvg > weekdayAvg ? 'positive' : 'neutral'}`}>
                  {weekdayAvg > 0 ? `${((weekendAvg / weekdayAvg) * 100 - 100).toFixed(0)}%` : '--'}
                </span>
                <span className="total-label">Weekend Difference</span>
              </div>
            </div>
          </div>
        </div>

        {/* Trend Charts */}
        <div className="comparison-card trends-card large">
          <div className="card-header">
            <BarChart2 size={16} />
            <span>Activity Trends</span>
            <div className="trend-tabs">
              {[
                { key: 'daily', label: '30 Days' },
                { key: 'weekly', label: '12 Weeks' },
                { key: 'monthly', label: '12 Months' }
              ].map(tab => (
                <button
                  key={tab.key}
                  className={`trend-tab ${activeTrendView === tab.key ? 'active' : ''}`}
                  onClick={() => setActiveTrendView(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <div className="trends-content expanded">
            {/* 30-Day Trend */}
            {activeTrendView === 'daily' && (
              <div className="trend-chart large">
                <div className="trend-label">Last 30 Days</div>
                {thirtyDayTrend.length > 0 ? (
                  <div className="trend-bars large">
                    {thirtyDayTrend.map((point, i) => (
                      <div
                        key={i}
                        className="trend-bar-wrapper"
                        title={`${point.label || point.date}: ${point.value}`}
                      >
                        <div
                          className="trend-bar"
                          style={{ height: `${point.normalized}%` }}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">No daily trend data</div>
                )}
              </div>
            )}

            {/* 12-Week Trend */}
            {activeTrendView === 'weekly' && (
              <div className="trend-chart large">
                <div className="trend-label">Last 12 Weeks</div>
                {twelveWeekTrend.length > 0 ? (
                  <div className="trend-bars large weekly">
                    {twelveWeekTrend.map((point, i) => (
                      <div
                        key={i}
                        className="trend-bar-wrapper"
                        title={`${point.label || `Week ${i + 1}`}: ${point.value}`}
                      >
                        <div
                          className="trend-bar weekly"
                          style={{ height: `${point.normalized}%` }}
                        />
                        <span className="trend-bar-label">W{i + 1}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">No weekly trend data</div>
                )}
              </div>
            )}

            {/* 12-Month Trend */}
            {activeTrendView === 'monthly' && (
              <div className="trend-chart large">
                <div className="trend-label">Last 12 Months</div>
                {twelveMonthTrend.length > 0 ? (
                  <div className="trend-bars large monthly">
                    {twelveMonthTrend.map((point, i) => (
                      <div
                        key={i}
                        className="trend-bar-wrapper"
                        title={`${point.label || point.month}: ${point.value}`}
                      >
                        <div
                          className="trend-bar monthly"
                          style={{ height: `${point.normalized}%` }}
                        />
                        <span className="trend-bar-label">{point.label?.slice(0, 3) || `M${i + 1}`}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">No monthly trend data</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default TimeComparisonStats;
