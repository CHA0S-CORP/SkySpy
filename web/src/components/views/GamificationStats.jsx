import React, { useState, useMemo } from 'react';
import {
  Trophy, Award, Star, Target, Flame, Zap,
  Crown, Medal, Gift, Sparkles, CheckCircle,
  Clock, Plane, Globe, Radio, Eye, RefreshCw,
  TrendingUp, Calendar, Filter, ChevronDown
} from 'lucide-react';
import { useStats } from '../../hooks';

/**
 * GamificationStats - Full page view for gamification/achievements
 * - Personal records display (cards with icons)
 * - Rare sightings list
 * - Spotting progress (airlines collected, types collected)
 * - Current streaks
 * - Milestones and badges
 */
export function GamificationStats({ apiBase, wsRequest, wsConnected, onSelectAircraft }) {
  const [timeRange, setTimeRange] = useState('24h');
  const [activeTab, setActiveTab] = useState('records');

  const hours = { '24h': 24, '7d': 168, '30d': 720, '90d': 2160, 'all': 8760 };
  const selectedHours = hours[timeRange] || 24;

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

  // Icon mapping for records
  const recordIcons = {
    furthest_distance: Target,
    highest_altitude: Zap,
    longest_tracking: Clock,
    fastest_aircraft: Flame,
    most_aircraft_hour: Crown,
    most_types_day: Plane,
    most_countries: Globe,
    most_acars: Radio,
    earliest_morning: Star,
    latest_night: Star,
    default: Award
  };

  // Rarity colors
  const rarityColors = {
    legendary: '#ffd700',
    epic: '#a371f7',
    rare: '#00c8ff',
    uncommon: '#00ff88',
    common: '#6b7280'
  };

  const rarityLabels = {
    legendary: 'Legendary',
    epic: 'Epic',
    rare: 'Rare',
    uncommon: 'Uncommon',
    common: 'Common'
  };

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
            {Object.keys(hours).map(range => (
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
            { key: 'badges', label: 'Badges', icon: Award }
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
        {/* Personal Records Tab */}
        {activeTab === 'records' && (
          <div className="achievements-grid expanded">
            <div className="achievements-card records-card full-width">
              <div className="card-header">
                <Medal size={16} />
                <span>Personal Records</span>
                <span className="card-badge">{personal_records.length} records</span>
              </div>
              {personal_records.length === 0 ? (
                <div className="empty-state">No records yet - keep spotting!</div>
              ) : (
                <div className="records-grid large">
                  {personal_records.map((record, i) => {
                    const IconComponent = recordIcons[record.type] || recordIcons.default;
                    return (
                      <div
                        key={record.type || i}
                        className={`record-card large ${onSelectAircraft && record.icao_hex ? 'clickable' : ''}`}
                        onClick={() => record.icao_hex && onSelectAircraft?.(record.icao_hex)}
                      >
                        <div className="record-icon large">
                          <IconComponent size={32} />
                        </div>
                        <div className="record-content">
                          <span className="record-title">{record.title || record.type}</span>
                          <span className="record-value">{record.value}</span>
                          {record.aircraft && (
                            <span className="record-aircraft">{record.aircraft}</span>
                          )}
                          {record.date && (
                            <span className="record-date">
                              <Calendar size={10} /> {record.date}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Rare Sightings Tab */}
        {activeTab === 'sightings' && (
          <div className="achievements-grid expanded">
            <div className="achievements-card sightings-card full-width">
              <div className="card-header">
                <Star size={16} />
                <span>Rare Sightings</span>
                <span className="card-badge">{rare_sightings.length} sightings</span>
              </div>
              {rare_sightings.length === 0 ? (
                <div className="empty-state">No rare sightings recorded</div>
              ) : (
                <div className="sightings-list expanded">
                  {rare_sightings.map((sighting, i) => (
                    <div
                      key={sighting.icao_hex || i}
                      className={`sighting-item large ${onSelectAircraft ? 'clickable' : ''}`}
                      onClick={() => onSelectAircraft?.(sighting.icao_hex)}
                    >
                      <div
                        className="sighting-rarity large"
                        style={{ backgroundColor: rarityColors[sighting.rarity] || rarityColors.common }}
                        title={sighting.rarity}
                      >
                        <Sparkles size={16} />
                      </div>
                      <div className="sighting-info">
                        <span className="sighting-type">{sighting.aircraft_type || 'Unknown'}</span>
                        <span className="sighting-callsign">{sighting.callsign || sighting.icao_hex}</span>
                        <span className="sighting-rarity-label">
                          {rarityLabels[sighting.rarity] || 'Unknown'}
                        </span>
                      </div>
                      <div className="sighting-details">
                        {sighting.reason && (
                          <span className="sighting-reason">{sighting.reason}</span>
                        )}
                        <span className="sighting-date">{sighting.date}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Progress Tab */}
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
                    <div
                      className="collection-bar-fill types"
                      style={{ width: `${typesPct}%` }}
                    />
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
                    <div
                      className="collection-bar-fill airlines"
                      style={{ width: `${airlinesPct}%` }}
                    />
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
                    <div
                      className="collection-bar-fill countries"
                      style={{ width: `${countriesPct}%` }}
                    />
                  </div>
                  <span className="collection-pct">{countriesPct.toFixed(1)}%</span>
                </div>
              </div>

              {/* Recent Unlocks */}
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

            {/* Milestones */}
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
                            <div
                              className="milestone-progress-fill"
                              style={{ width: `${milestone.progress}%` }}
                            />
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

        {/* Streaks Tab */}
        {activeTab === 'streaks' && (
          <div className="achievements-grid expanded">
            <div className="achievements-card streaks-card full-width">
              <div className="card-header">
                <Flame size={16} />
                <span>Current Streaks</span>
              </div>
              <div className="streaks-grid large">
                <div className={`streak-item large ${(streaks.daily_active || 0) > 0 ? 'active' : ''}`}>
                  <div className="streak-icon large">
                    <Flame size={32} />
                  </div>
                  <div className="streak-content">
                    <span className="streak-value">{streaks.daily_active || 0}</span>
                    <span className="streak-label">Day Streak</span>
                    <span className="streak-description">Consecutive days with activity</span>
                  </div>
                </div>

                <div className={`streak-item large ${(streaks.early_bird || 0) > 0 ? 'active' : ''}`}>
                  <div className="streak-icon large early">
                    <Star size={32} />
                  </div>
                  <div className="streak-content">
                    <span className="streak-value">{streaks.early_bird || 0}</span>
                    <span className="streak-label">Early Bird</span>
                    <span className="streak-description">Days with activity before 7 AM</span>
                  </div>
                </div>

                <div className={`streak-item large ${(streaks.night_owl || 0) > 0 ? 'active' : ''}`}>
                  <div className="streak-icon large night">
                    <Eye size={32} />
                  </div>
                  <div className="streak-content">
                    <span className="streak-value">{streaks.night_owl || 0}</span>
                    <span className="streak-label">Night Owl</span>
                    <span className="streak-description">Days with activity after 10 PM</span>
                  </div>
                </div>

                <div className={`streak-item large ${(streaks.variety_hunter || 0) > 0 ? 'active' : ''}`}>
                  <div className="streak-icon large variety">
                    <Target size={32} />
                  </div>
                  <div className="streak-content">
                    <span className="streak-value">{streaks.variety_hunter || 0}</span>
                    <span className="streak-label">Variety Hunter</span>
                    <span className="streak-description">Days with 10+ unique aircraft types</span>
                  </div>
                </div>
              </div>

              {/* Best streaks */}
              <div className="best-streaks">
                {streaks.best_daily && (
                  <div className="best-streak">
                    <Crown size={16} />
                    <span>Best daily streak: <strong>{streaks.best_daily} days</strong></span>
                  </div>
                )}
                {streaks.best_variety && (
                  <div className="best-streak">
                    <Crown size={16} />
                    <span>Best variety streak: <strong>{streaks.best_variety} days</strong></span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Badges Tab */}
        {activeTab === 'badges' && (
          <div className="achievements-grid expanded">
            <div className="achievements-card badges-card full-width">
              <div className="card-header">
                <Award size={16} />
                <span>Badges</span>
                <span className="card-badge">
                  {badges.filter(b => b.unlocked).length}/{badges.length} unlocked
                </span>
              </div>
              {badges.length === 0 ? (
                <div className="empty-state">No badges available yet</div>
              ) : (
                <div className="badges-grid large">
                  {badges.map((badge, i) => (
                    <div
                      key={badge.id || i}
                      className={`badge-item large ${badge.unlocked ? 'unlocked' : 'locked'}`}
                      title={badge.description}
                    >
                      <div className="badge-icon large" style={{ backgroundColor: badge.color }}>
                        {badge.icon === 'star' && <Star size={28} />}
                        {badge.icon === 'trophy' && <Trophy size={28} />}
                        {badge.icon === 'medal' && <Medal size={28} />}
                        {badge.icon === 'crown' && <Crown size={28} />}
                        {badge.icon === 'flame' && <Flame size={28} />}
                        {badge.icon === 'plane' && <Plane size={28} />}
                        {badge.icon === 'globe' && <Globe size={28} />}
                        {(!badge.icon || !['star', 'trophy', 'medal', 'crown', 'flame', 'plane', 'globe'].includes(badge.icon)) && <Award size={28} />}
                      </div>
                      <span className="badge-name">{badge.name}</span>
                      {badge.description && (
                        <span className="badge-description">{badge.description}</span>
                      )}
                      {badge.unlocked && badge.date && (
                        <span className="badge-date">Earned {badge.date}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default GamificationStats;
