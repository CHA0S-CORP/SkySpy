import React, { useState } from 'react';
import {
  AlertTriangle, Plane, Radio, Activity, Eye, Shield, Target, Zap, ArrowUpCircle, BarChart3
} from 'lucide-react';
import { useStatsData } from '../../hooks';
import {
  // Existing section components
  FlightPatternsSection,
  GeographicSection,
  SessionAnalyticsSection,
  TimeComparisonSection,
  AcarsStatsSection,
  AchievementsSection,
  // Card components
  KPICard,
  LeaderboardCard,
  SquawkWatchlist,
  // Chart components
  HorizontalBarChart,
  LiveSparkline,
  // Antenna analytics
  PolarPlot,
  RSSIScatter,
  // System cards
  SystemStatusCard,
  SafetyAlertsSummary,
  ConnectionStatusCard,
  AcarsServiceCard,
  SafetyMonitorCard,
  // Filters
  StatsFilterBar,
  // Analytics sections
  HistoricalAnalyticsSection,
  ExtendedStatsSection,
  AcarsSection
} from './stats';

// ============================================================================
// Main StatsView Component - Bento Grid Layout
// ============================================================================

export function StatsView({ apiBase, onSelectAircraft, wsRequest, wsConnected, aircraft: wsAircraft, stats: wsStats, antennaAnalytics: antennaAnalyticsProp }) {
  // Filter state
  const [timeRange, setTimeRange] = useState('24h');
  const [showMilitaryOnly, setShowMilitaryOnly] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [minAltitude, setMinAltitude] = useState('');
  const [maxAltitude, setMaxAltitude] = useState('');
  const [minDistance, setMinDistance] = useState('');
  const [maxDistance, setMaxDistance] = useState('');
  const [aircraftType, setAircraftType] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // Use the custom hook for all data fetching
  const data = useStatsData({
    apiBase,
    wsRequest,
    wsConnected,
    wsAircraft,
    wsStats,
    antennaAnalyticsProp,
    filters: {
      timeRange,
      showMilitaryOnly,
      categoryFilter,
      minAltitude,
      maxAltitude,
      minDistance,
      maxDistance,
      aircraftType
    }
  });

  const {
    stats,
    top,
    aircraftData,
    emergencyAircraft,
    messageRate,
    histStats,
    acarsStats,
    acarsStatsLoading,
    safetyStats,
    systemData,
    trendsData,
    topPerformersData,
    distanceAnalytics,
    speedAnalytics,
    correlationData,
    flightPatternsData,
    flightPatternsLoading,
    geographicData,
    geographicLoading,
    trackingQualityData,
    trackingQualityLoading,
    engagementData,
    engagementLoading,
    favoritesData,
    favoritesLoading,
    antennaAnalytics,
    altitudeData,
    fleetBreakdown,
    safetyEventsByType,
    throughputHistory,
    aircraftHistory
  } = data;

  return (
    <div className="stats-bento-container">
      {/* Emergency Banner */}
      {emergencyAircraft.length > 0 && (
        <div className="emergency-banner">
          <AlertTriangle size={24} />
          <div>
            <strong>Emergency Squawk Detected</strong>
            <div>
              {emergencyAircraft.map((a, i) => (
                <span key={a.hex}>
                  {i > 0 && ', '}
                  <button className="emergency-aircraft-link" onClick={() => onSelectAircraft?.(a.hex)}>
                    {a.hex} ({a.squawk})
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Filter Controls */}
      <StatsFilterBar
        timeRange={timeRange}
        setTimeRange={setTimeRange}
        showMilitaryOnly={showMilitaryOnly}
        setShowMilitaryOnly={setShowMilitaryOnly}
        showAdvancedFilters={showAdvancedFilters}
        setShowAdvancedFilters={setShowAdvancedFilters}
        categoryFilter={categoryFilter}
        setCategoryFilter={setCategoryFilter}
        aircraftType={aircraftType}
        setAircraftType={setAircraftType}
        minAltitude={minAltitude}
        setMinAltitude={setMinAltitude}
        maxAltitude={maxAltitude}
        setMaxAltitude={setMaxAltitude}
        minDistance={minDistance}
        setMinDistance={setMinDistance}
        maxDistance={maxDistance}
        setMaxDistance={setMaxDistance}
      />

      {/* ====================================================================
          BENTO GRID - 3 Column Layout
          ==================================================================== */}
      <div className="bento-grid">

        {/* ----------------------------------------------------------------
            LEFT COLUMN - Live Feed (20%)
            ---------------------------------------------------------------- */}
        <div className="bento-column bento-left">
          <div className="column-header">
            <Eye size={16} />
            <span>Live Feed</span>
          </div>

          {/* Leaderboards */}
          <LeaderboardCard
            title="Closest"
            icon={Target}
            items={top?.closest}
            onSelect={onSelectAircraft}
            valueFormatter={(item) => `${item.distance_nm?.toFixed(1)} nm`}
            emptyText="No data"
          />

          <LeaderboardCard
            title="Fastest"
            icon={Zap}
            items={top?.fastest}
            onSelect={onSelectAircraft}
            valueFormatter={(item) => `${item.gs?.toFixed(0)} kts`}
            emptyText="No data"
          />

          <LeaderboardCard
            title="Highest"
            icon={ArrowUpCircle}
            items={top?.highest}
            onSelect={onSelectAircraft}
            valueFormatter={(item) => `${(item.alt / 1000).toFixed(1)}k ft`}
            emptyText="No data"
          />

          {/* Squawk Watchlist */}
          <SquawkWatchlist
            aircraftData={aircraftData}
            onSelect={onSelectAircraft}
          />
        </div>

        {/* ----------------------------------------------------------------
            CENTER COLUMN - Primary Visuals (60%)
            ---------------------------------------------------------------- */}
        <div className="bento-column bento-center">

          {/* KPI Grid - 3 consolidated groups */}
          <div className="kpi-grid">
            <KPICard
              title="Traffic"
              icon={Plane}
              accentColor="cyan"
              metrics={[
                { label: 'Current', value: stats?.total || 0 },
                { label: 'Msg/s', value: messageRate > 0 ? messageRate.toFixed(0) : '--' }
              ]}
            />
            <KPICard
              title="Reception"
              icon={Radio}
              accentColor="green"
              metrics={[
                { label: 'With Pos', value: stats?.with_position || 0 },
                { label: 'Max Dist', value: distanceAnalytics?.statistics?.max_nm ? `${distanceAnalytics.statistics.max_nm.toFixed(0)}nm` : '--' }
              ]}
            />
            <KPICard
              title="System"
              icon={Activity}
              accentColor="purple"
              metrics={[
                { label: '24h Unique', value: histStats?.unique_aircraft || '--' },
                { label: 'Military', value: stats?.military || 0 }
              ]}
            />
          </div>

          {/* Live Graphs Row */}
          <div className="live-graphs-row">
            <div className="live-graph-card">
              <LiveSparkline
                data={aircraftHistory}
                valueKey="count"
                color="#00c8ff"
                height={50}
                label="Aircraft Count"
                currentValue={stats?.total}
              />
            </div>
            <div className="live-graph-card">
              <LiveSparkline
                data={throughputHistory}
                valueKey="messages"
                color="#00ff88"
                height={50}
                label="Message Rate"
                currentValue={messageRate > 0 ? messageRate.toFixed(0) : 0}
                unit=" msg/s"
              />
            </div>
            <div className="live-graph-card">
              <LiveSparkline
                data={throughputHistory}
                valueKey="withPosition"
                color="#f7d794"
                height={50}
                label="Position Reports"
                currentValue={stats?.with_position}
              />
            </div>
          </div>

          {/* Distribution Charts - Horizontal Bars */}
          <div className="distribution-row">
            <div className="distribution-card">
              <HorizontalBarChart
                title="Altitude Distribution"
                data={altitudeData}
                maxItems={4}
                showPercentage={true}
              />
            </div>

            {fleetBreakdown && (
              <div className="distribution-card">
                <HorizontalBarChart
                  title="Flight Categories"
                  data={fleetBreakdown.categories.map(c => ({
                    label: c.name,
                    count: c.count,
                    pct: c.pct,
                    color: c.color
                  }))}
                  maxItems={6}
                  showPercentage={true}
                />
              </div>
            )}
          </div>

          {/* Safety Events Bar Chart (replaces pie chart) */}
          {safetyStats?.total_events > 0 && (
            <div className="safety-events-section">
              <div className="section-header">
                <Shield size={16} />
                <span>Safety Events ({timeRange})</span>
                <span className="section-badge">{safetyStats.total_events} total</span>
              </div>
              <HorizontalBarChart
                data={safetyEventsByType}
                maxItems={6}
                showPercentage={false}
              />
            </div>
          )}

          {/* ACARS Statistics */}
          <AcarsSection acarsStats={acarsStats} timeRange={timeRange} />

          {/* Antenna Analytics Section */}
          <div className="nerd-stats-section">
            <div className="section-header">
              <BarChart3 size={16} />
              <span>Antenna Analytics</span>
              <span className="section-badge beta">Beta</span>
            </div>
            <div className="nerd-stats-grid">
              <PolarPlot data={antennaAnalytics?.polar} />
              <RSSIScatter data={antennaAnalytics?.rssi} />
            </div>
          </div>

          {/* Historical Analytics Section */}
          <HistoricalAnalyticsSection
            trendsData={trendsData}
            topPerformersData={topPerformersData}
            distanceAnalytics={distanceAnalytics}
            speedAnalytics={speedAnalytics}
            correlationData={correlationData}
            onSelectAircraft={onSelectAircraft}
          />

          {/* Extended Stats Section */}
          <ExtendedStatsSection
            flightPatternsData={flightPatternsData}
            flightPatternsLoading={flightPatternsLoading}
            geographicData={geographicData}
            geographicLoading={geographicLoading}
            trackingQualityData={trackingQualityData}
            trackingQualityLoading={trackingQualityLoading}
            engagementData={engagementData}
            engagementLoading={engagementLoading}
            acarsStats={acarsStats}
            acarsStatsLoading={acarsStatsLoading}
            favoritesData={favoritesData}
            favoritesLoading={favoritesLoading}
            onSelectAircraft={onSelectAircraft}
            FlightPatternsSection={FlightPatternsSection}
            GeographicSection={GeographicSection}
            SessionAnalyticsSection={SessionAnalyticsSection}
            TimeComparisonSection={TimeComparisonSection}
            AcarsStatsSection={AcarsStatsSection}
            AchievementsSection={AchievementsSection}
          />
        </div>

        {/* ----------------------------------------------------------------
            RIGHT COLUMN - System & Safety (20%)
            ---------------------------------------------------------------- */}
        <div className="bento-column bento-right">
          <div className="column-header">
            <Shield size={16} />
            <span>System & Safety</span>
          </div>

          {/* System Status */}
          <SystemStatusCard systemData={systemData} />

          {/* Safety Alerts Summary */}
          <SafetyAlertsSummary safetyStats={safetyStats} timeRange={timeRange} />

          {/* Connection Status */}
          <ConnectionStatusCard wsConnected={wsConnected} />

          {/* ACARS Service Status */}
          <AcarsServiceCard acarsStats={acarsStats} />

          {/* Safety Monitor Status */}
          <SafetyMonitorCard safetyStats={safetyStats} />
        </div>
      </div>
    </div>
  );
}
