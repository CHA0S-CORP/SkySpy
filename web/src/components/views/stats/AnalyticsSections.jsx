import React, { useState } from 'react';
import { TrendingUp, Award, Target, Zap, Activity, BarChart3, Layers, Navigation2, Globe, Calendar, Radio, Trophy } from 'lucide-react';
import { HorizontalBarChart } from './StatsCharts';
import { ACARS_LABEL_DESCRIPTIONS } from './statsHelpers';

/**
 * TrendsTab - Trends analytics content
 */
export function TrendsTab({ trendsData }) {
  if (!trendsData) return null;

  return (
    <div className="analytics-content">
      <div className="trends-summary">
        <div className="trend-stat">
          <span className="trend-label">Total Unique</span>
          <span className="trend-value">{trendsData.summary?.total_unique_aircraft || 0}</span>
        </div>
        <div className="trend-stat">
          <span className="trend-label">Peak Concurrent</span>
          <span className="trend-value">{trendsData.summary?.peak_concurrent || 0}</span>
        </div>
        <div className="trend-stat">
          <span className="trend-label">Intervals</span>
          <span className="trend-value">{trendsData.summary?.total_intervals || 0}</span>
        </div>
      </div>
      {trendsData.intervals?.length > 0 && (
        <div className="trends-chart">
          <div className="trend-bars">
            {trendsData.intervals.map((interval, i) => {
              const maxCount = Math.max(...trendsData.intervals.map(i => i.unique_aircraft || 0));
              const height = maxCount > 0 ? ((interval.unique_aircraft || 0) / maxCount) * 100 : 0;
              return (
                <div
                  key={i}
                  className="trend-bar"
                  style={{ height: `${height}%` }}
                  title={`${new Date(interval.timestamp).toLocaleTimeString()}: ${interval.unique_aircraft} aircraft`}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * TopPerformersTab - Top performers analytics content
 */
export function TopPerformersTab({ topPerformersData, onSelectAircraft }) {
  const [topPerformersTab, setTopPerformersTab] = useState('longest');

  if (!topPerformersData) return null;

  return (
    <div className="analytics-content">
      <div className="top-performers-tabs">
        {[
          { key: 'longest', label: 'Longest' },
          { key: 'furthest', label: 'Furthest' },
          { key: 'highest', label: 'Highest' },
          { key: 'closest', label: 'Closest' }
        ].map(tab => (
          <button
            key={tab.key}
            className={`top-tab ${topPerformersTab === tab.key ? 'active' : ''}`}
            onClick={() => setTopPerformersTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="top-performers-list">
        {(topPerformersData[topPerformersTab === 'longest' ? 'longest_tracked' :
          topPerformersTab === 'furthest' ? 'furthest_distance' :
          topPerformersTab === 'highest' ? 'highest_altitude' : 'closest_approach'] || [])
          .slice(0, 6).map((ac, i) => (
            <div
              key={ac.icao_hex}
              className={`performer-item ${onSelectAircraft ? 'clickable' : ''} ${ac.is_military ? 'military' : ''}`}
              onClick={() => onSelectAircraft?.(ac.icao_hex)}
            >
              <span className="performer-rank">{i + 1}</span>
              <div className="performer-info">
                <span className="performer-callsign">
                  {ac.callsign || ac.icao_hex}
                  {ac.is_military && <span className="mil-badge">MIL</span>}
                </span>
                <span className="performer-type">{ac.aircraft_type || 'Unknown'}</span>
              </div>
              <span className="performer-value">
                {topPerformersTab === 'longest' && `${ac.duration_min?.toFixed(0)} min`}
                {topPerformersTab === 'furthest' && `${ac.max_distance_nm?.toFixed(1)} nm`}
                {topPerformersTab === 'highest' && `${ac.max_altitude?.toLocaleString()} ft`}
                {topPerformersTab === 'closest' && `${ac.min_distance_nm?.toFixed(1)} nm`}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}

/**
 * DistanceTab - Distance analytics content
 */
export function DistanceTab({ distanceAnalytics }) {
  if (!distanceAnalytics) return null;

  return (
    <div className="analytics-content">
      <div className="distance-stats">
        <div className="stat-box">
          <span className="stat-label">Mean</span>
          <span className="stat-value">{distanceAnalytics.statistics?.mean_nm?.toFixed(1) || '--'} nm</span>
        </div>
        <div className="stat-box">
          <span className="stat-label">Max</span>
          <span className="stat-value">{distanceAnalytics.statistics?.max_nm?.toFixed(1) || '--'} nm</span>
        </div>
        <div className="stat-box">
          <span className="stat-label">Median</span>
          <span className="stat-value">{distanceAnalytics.statistics?.median_nm?.toFixed(1) || '--'} nm</span>
        </div>
        <div className="stat-box">
          <span className="stat-label">90th %</span>
          <span className="stat-value">{distanceAnalytics.statistics?.percentile_90?.toFixed(1) || '--'} nm</span>
        </div>
      </div>
      {distanceAnalytics.distribution && (
        <HorizontalBarChart
          title="Distance Distribution"
          data={Object.entries(distanceAnalytics.distribution).map(([band, count]) => ({
            label: band,
            count,
            color: '#00c8ff'
          }))}
          maxItems={8}
          showPercentage={false}
        />
      )}
    </div>
  );
}

/**
 * SpeedTab - Speed analytics content
 */
export function SpeedTab({ speedAnalytics, onSelectAircraft }) {
  if (!speedAnalytics) return null;

  return (
    <div className="analytics-content">
      <div className="speed-stats">
        <div className="stat-box">
          <span className="stat-label">Mean</span>
          <span className="stat-value">{speedAnalytics.statistics?.mean_kt || '--'} kt</span>
        </div>
        <div className="stat-box">
          <span className="stat-label">Max</span>
          <span className="stat-value">{speedAnalytics.statistics?.max_kt || '--'} kt</span>
        </div>
        <div className="stat-box">
          <span className="stat-label">90th %</span>
          <span className="stat-value">{speedAnalytics.statistics?.percentile_90 || '--'} kt</span>
        </div>
      </div>
      {speedAnalytics.fastest_sessions?.length > 0 && (
        <div className="fastest-list">
          <div className="fastest-title">Fastest Aircraft</div>
          {speedAnalytics.fastest_sessions.slice(0, 5).map((ac, i) => (
            <div
              key={ac.icao_hex}
              className={`fastest-item ${onSelectAircraft ? 'clickable' : ''}`}
              onClick={() => onSelectAircraft?.(ac.icao_hex)}
            >
              <span className="fastest-rank">{i + 1}</span>
              <span className="fastest-callsign">{ac.callsign || ac.icao_hex}</span>
              <span className="fastest-speed">{ac.max_speed} kt</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * PatternsTab - Patterns analytics content
 */
export function PatternsTab({ correlationData }) {
  if (!correlationData) return null;

  return (
    <div className="analytics-content">
      <div className="patterns-grid">
        <div className="pattern-card">
          <div className="pattern-title">Altitude vs Speed</div>
          {correlationData.altitude_vs_speed?.slice(0, 4).map((band, i) => (
            <div key={band.altitude_band} className="pattern-row">
              <span className="pattern-label">{band.altitude_band}</span>
              <span className="pattern-value">{band.avg_speed || '--'} kt avg</span>
            </div>
          ))}
        </div>
        <div className="pattern-card">
          <div className="pattern-title">Peak Activity</div>
          <div className="peak-info">
            <span className="peak-hour">
              {correlationData.time_of_day_patterns?.peak_hour !== undefined
                ? `${correlationData.time_of_day_patterns.peak_hour}:00`
                : '--'}
            </span>
            <span className="peak-count">
              {correlationData.time_of_day_patterns?.peak_aircraft_count || 0} aircraft
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * HistoricalAnalyticsSection - Complete historical analytics section with tabs
 */
export function HistoricalAnalyticsSection({
  trendsData,
  topPerformersData,
  distanceAnalytics,
  speedAnalytics,
  correlationData,
  onSelectAircraft
}) {
  const [activeAnalyticsTab, setActiveAnalyticsTab] = useState('trends');

  return (
    <div className="analytics-section">
      <div className="analytics-header">
        <div className="analytics-title">
          <BarChart3 size={18} />
          Historical Analytics
        </div>
        <div className="analytics-tabs">
          {[
            { key: 'trends', label: 'Trends', icon: TrendingUp },
            { key: 'top', label: 'Top Performers', icon: Award },
            { key: 'distance', label: 'Distance', icon: Target },
            { key: 'speed', label: 'Speed', icon: Zap },
            { key: 'patterns', label: 'Patterns', icon: Activity }
          ].map(tab => (
            <button
              key={tab.key}
              className={`analytics-tab ${activeAnalyticsTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveAnalyticsTab(tab.key)}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeAnalyticsTab === 'trends' && <TrendsTab trendsData={trendsData} />}
      {activeAnalyticsTab === 'top' && <TopPerformersTab topPerformersData={topPerformersData} onSelectAircraft={onSelectAircraft} />}
      {activeAnalyticsTab === 'distance' && <DistanceTab distanceAnalytics={distanceAnalytics} />}
      {activeAnalyticsTab === 'speed' && <SpeedTab speedAnalytics={speedAnalytics} onSelectAircraft={onSelectAircraft} />}
      {activeAnalyticsTab === 'patterns' && <PatternsTab correlationData={correlationData} />}
    </div>
  );
}

/**
 * ExtendedStatsSection - Extended analytics section with tabs for Django API data
 */
export function ExtendedStatsSection({
  flightPatternsData,
  flightPatternsLoading,
  geographicData,
  geographicLoading,
  trackingQualityData,
  trackingQualityLoading,
  engagementData,
  engagementLoading,
  acarsStats,
  acarsStatsLoading,
  favoritesData,
  favoritesLoading,
  onSelectAircraft,
  // Section components
  FlightPatternsSection,
  GeographicSection,
  SessionAnalyticsSection,
  TimeComparisonSection,
  AcarsStatsSection,
  AchievementsSection
}) {
  const [activeExtendedSection, setActiveExtendedSection] = useState('patterns');

  return (
    <div className="extended-stats-section">
      <div className="extended-stats-header">
        <div className="extended-stats-title">
          <Layers size={18} />
          Extended Analytics
        </div>
        <div className="extended-stats-tabs">
          {[
            { key: 'patterns', label: 'Flight Patterns', icon: Navigation2 },
            { key: 'geographic', label: 'Geographic', icon: Globe },
            { key: 'tracking', label: 'Tracking', icon: Activity },
            { key: 'engagement', label: 'Engagement', icon: Calendar },
            { key: 'acars', label: 'ACARS', icon: Radio },
            { key: 'favorites', label: 'Favorites', icon: Trophy }
          ].map(tab => (
            <button
              key={tab.key}
              className={`extended-tab ${activeExtendedSection === tab.key ? 'active' : ''}`}
              onClick={() => setActiveExtendedSection(tab.key)}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeExtendedSection === 'patterns' && (
        <FlightPatternsSection
          data={flightPatternsData}
          loading={flightPatternsLoading}
          onSelectAircraft={onSelectAircraft}
        />
      )}

      {activeExtendedSection === 'geographic' && (
        <GeographicSection
          data={geographicData}
          loading={geographicLoading}
          onSelectAircraft={onSelectAircraft}
        />
      )}

      {activeExtendedSection === 'tracking' && (
        <SessionAnalyticsSection
          data={trackingQualityData}
          loading={trackingQualityLoading}
        />
      )}

      {activeExtendedSection === 'engagement' && (
        <TimeComparisonSection
          data={engagementData}
          loading={engagementLoading}
        />
      )}

      {activeExtendedSection === 'acars' && (
        <AcarsStatsSection
          data={acarsStats}
          loading={acarsStatsLoading}
        />
      )}

      {activeExtendedSection === 'favorites' && (
        <AchievementsSection
          data={favoritesData}
          loading={favoritesLoading}
          onSelectAircraft={onSelectAircraft}
        />
      )}
    </div>
  );
}

/**
 * AcarsSection - ACARS statistics section (inline in center column)
 */
export function AcarsSection({ acarsStats, timeRange }) {
  if (!acarsStats) return null;

  return (
    <div className="acars-section">
      <div className="section-header">
        <Radio size={16} />
        <span>ACARS/VDL2 ({timeRange})</span>
        <span className="section-badge">{acarsStats.last_24h?.toLocaleString() || 0} messages</span>
      </div>
      <div className="acars-stats-row">
        <div className="acars-stat">
          <span className="acars-stat-value">{acarsStats.total_messages?.toLocaleString() || '--'}</span>
          <span className="acars-stat-label">Total</span>
        </div>
        <div className="acars-stat">
          <span className="acars-stat-value">{acarsStats.last_hour?.toLocaleString() || '--'}</span>
          <span className="acars-stat-label">Last Hour</span>
        </div>
        <div className={`acars-stat ${acarsStats.service_stats?.running ? 'active' : 'inactive'}`}>
          <span className="acars-stat-value">{acarsStats.service_stats?.running ? 'Active' : 'Stopped'}</span>
          <span className="acars-stat-label">Service</span>
        </div>
      </div>
      {acarsStats.top_labels?.length > 0 && (
        <HorizontalBarChart
          title="Top Message Types"
          data={acarsStats.top_labels.slice(0, 6).map(item => ({
            label: `${item.label} - ${ACARS_LABEL_DESCRIPTIONS[item.label] || item.label}`,
            count: item.count,
            color: '#00c8ff'
          }))}
          maxItems={6}
          showPercentage={false}
        />
      )}
    </div>
  );
}
