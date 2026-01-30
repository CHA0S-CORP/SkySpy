import React, { useState, useMemo } from 'react';
import {
  Trophy, Medal, Star, Flame, Gift, CheckCircle,
  Clock, Plane, Globe, RefreshCw, TrendingUp, Target
} from 'lucide-react';
import { useStats } from '../../hooks';
import { TIME_RANGES } from '../gamification/gamificationConstants';
import { RecordsTab } from '../gamification/RecordsTab';
import { SightingsTab } from '../gamification/SightingsTab';
import { StreaksTab } from '../gamification/StreaksTab';
import { BadgesTab } from '../gamification/BadgesTab';

/**
 * GamificationStats - Full page view for gamification/achievements
 */
export function GamificationStats({ apiBase, wsRequest, wsConnected, onSelectAircraft }) {
  const [timeRange, setTimeRange] = useState('24h');
  const [activeTab, setActiveTab] = useState('records');

  const selectedHours = TIME_RANGES[timeRange] || 24;

  const { achievements, loading, error, refetch } = useStats(apiBase, {
    wsRequest,
    wsConnected,
    hours: selectedHours
  });

  const data = achievements;

  const {
    personal_records = [],
    rare_sightings = [],
    collection_progress = {},
    streaks = {},
    milestones = [],
    badges = []
  } = data || {};

  // Calculate collection percentages
  const airlinesCollected = collection_progress.airlines_collected ?? 0;
  const airlinesToTarget = collection_progress.airlines_target ?? 100;
  const airlinesPct = Math.min((airlinesCollected / airlinesToTarget) * 100, 100);

  const typesCollected = collection_progress.types_collected ?? 0;
  const typesToTarget = collection_progress.types_target ?? 100;
  const typesPct = Math.min((typesCollected / typesToTarget) * 100, 100);

  const countriesCollected = collection_progress.countries_collected ?? 0;
  const countriesToTarget = collection_progress.countries_target ?? 50;
  const countriesPct = Math.min((countriesCollected / countriesToTarget) * 100, 100);

  // Summary stats
  const summaryStats = useMemo(() => ({
    totalRecords: personal_records.length,
    totalRareSightings: rare_sightings.length,
    currentStreak: streaks.daily_active ?? 0,
    achievedMilestones: milestones.filter(m => m.achieved).length,
    unlockedBadges: badges.filter(b => b.unlocked).length
  }), [personal_records, rare_sightings, streaks, milestones, badges]);

  if (loading && !data) {
    return (
      <div className="stats-page gamification-page">
        <div className="loading-state">
          <RefreshCw className="spin" size={24} />
          <span>Loading achievements...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="stats-page gamification-page">
        <div className="error-state">
          <span>Error loading data: {error}</span>
          <button onClick={refetch}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="stats-page gamification-page">
      {/* Page Header */}
      <div className="page-header">
        <div className="page-title">
          <Trophy size={24} />
          <h1>Achievements & Records</h1>
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
            {Object.keys(TIME_RANGES).map(range => (
              <button
                key={range}
                className={`time-btn ${timeRange === range ? 'active' : ''}`}
                onClick={() => setTimeRange(range)}
              >
                {range === 'all' ? 'All Time' : range}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-divider" />
        <div className="view-tabs">
          {[
            { key: 'records', label: 'Records', icon: Medal },
            { key: 'sightings', label: 'Rare Sightings', icon: Star },
            { key: 'progress', label: 'Progress', icon: TrendingUp },
            { key: 'streaks', label: 'Streaks', icon: Flame },
            { key: 'badges', label: 'Badges', icon: Medal }
          ].map(tab => (
            <button
              key={tab.key}
              className={`view-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="summary-cards">
        <div className="summary-card gold">
          <div className="summary-icon"><Medal size={20} /></div>
          <div className="summary-content">
            <span className="summary-value">{summaryStats.totalRecords}</span>
            <span className="summary-label">Personal Records</span>
          </div>
        </div>
        <div className="summary-card purple">
          <div className="summary-icon"><Star size={20} /></div>
          <div className="summary-content">
            <span className="summary-value">{summaryStats.totalRareSightings}</span>
            <span className="summary-label">Rare Sightings</span>
          </div>
        </div>
        <div className="summary-card orange">
          <div className="summary-icon"><Flame size={20} /></div>
          <div className="summary-content">
            <span className="summary-value">{summaryStats.currentStreak}</span>
            <span className="summary-label">Day Streak</span>
          </div>
        </div>
        <div className="summary-card green">
          <div className="summary-icon"><CheckCircle size={20} /></div>
          <div className="summary-content">
            <span className="summary-value">{summaryStats.unlockedBadges}/{badges.length}</span>
            <span className="summary-label">Badges</span>
          </div>
        </div>
      </div>

      {/* Main Content - Conditional by Tab */}
      <div className="achievements-content">
        {activeTab === 'records' && (
          <RecordsTab personal_records={personal_records} onSelectAircraft={onSelectAircraft} />
        )}

        {activeTab === 'sightings' && (
          <SightingsTab rare_sightings={rare_sightings} onSelectAircraft={onSelectAircraft} />
        )}

        {activeTab === 'progress' && (
          <div className="achievements-grid expanded">
            <div className="achievements-card collection-card large">
              <div className="card-header">
                <Gift size={16} />
                <span>Spotting Progress</span>
              </div>
              <div className="collection-items expanded">
                <div className="collection-item large">
                  <div className="collection-header">
                    <Plane size={20} />
                    <span>Aircraft Types</span>
                    <span className="collection-count">{typesCollected}/{typesToTarget}</span>
                  </div>
                  <div className="collection-bar-track large">
                    <div className="collection-bar-fill types" style={{ width: `${typesPct}%` }} />
                  </div>
                  <span className="collection-pct">{typesPct.toFixed(1)}%</span>
                </div>

                <div className="collection-item large">
                  <div className="collection-header">
                    <Globe size={20} />
                    <span>Airlines</span>
                    <span className="collection-count">{airlinesCollected}/{airlinesToTarget}</span>
                  </div>
                  <div className="collection-bar-track large">
                    <div className="collection-bar-fill airlines" style={{ width: `${airlinesPct}%` }} />
                  </div>
                  <span className="collection-pct">{airlinesPct.toFixed(1)}%</span>
                </div>

                <div className="collection-item large">
                  <div className="collection-header">
                    <Globe size={20} />
                    <span>Countries</span>
                    <span className="collection-count">{countriesCollected}/{countriesToTarget}</span>
                  </div>
                  <div className="collection-bar-track large">
                    <div className="collection-bar-fill countries" style={{ width: `${countriesPct}%` }} />
                  </div>
                  <span className="collection-pct">{countriesPct.toFixed(1)}%</span>
                </div>
              </div>

              {collection_progress.recent_unlocks?.length > 0 && (
                <div className="recent-unlocks expanded">
                  <span className="unlocks-title">Recent Unlocks</span>
                  <div className="unlocks-list">
                    {collection_progress.recent_unlocks.slice(0, 10).map((unlock, i) => (
                      <span key={i} className="unlock-chip">
                        <CheckCircle size={12} />
                        {unlock}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {milestones.length > 0 && (
              <div className="achievements-card milestones-card large">
                <div className="card-header">
                  <Trophy size={16} />
                  <span>Milestones</span>
                  <span className="card-badge">
                    {milestones.filter(m => m.achieved).length}/{milestones.length}
                  </span>
                </div>
                <div className="milestones-list expanded">
                  {milestones.map((milestone, i) => (
                    <div
                      key={milestone.id || i}
                      className={`milestone-item large ${milestone.achieved ? 'achieved' : ''}`}
                    >
                      <div className="milestone-icon">
                        {milestone.achieved ? <CheckCircle size={24} /> : <Target size={24} />}
                      </div>
                      <div className="milestone-content">
                        <span className="milestone-title">{milestone.title}</span>
                        <span className="milestone-description">{milestone.description}</span>
                        {!milestone.achieved && milestone.progress !== undefined && (
                          <div className="milestone-progress large">
                            <div className="milestone-progress-fill" style={{ width: `${milestone.progress}%` }} />
                            <span className="milestone-progress-text">{milestone.progress.toFixed(0)}%</span>
                          </div>
                        )}
                      </div>
                      {milestone.achieved && milestone.date && (
                        <span className="milestone-date">{milestone.date}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'streaks' && <StreaksTab streaks={streaks} />}

        {activeTab === 'badges' && <BadgesTab badges={badges} />}
      </div>
    </div>
  );
}

export default GamificationStats;
