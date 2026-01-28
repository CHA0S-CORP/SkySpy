import React, { useMemo } from 'react';
import {
  Trophy, Award, Star, Target, Flame, Zap,
  Crown, Medal, Gift, Sparkles, CheckCircle,
  Clock, Plane, Globe, Radio, Eye, Loader2
} from 'lucide-react';

/**
 * AchievementsSection - Displays gamification/achievements
 * - Personal records display (cards with icons)
 * - Rare sightings list
 * - Spotting progress (airlines collected, types collected)
 * - Current streaks
 */
export function AchievementsSection({ data, loading, onSelectAircraft }) {
  // Show loading skeleton when data is loading
  if (loading) {
    return (
      <div className="stats-section achievements-section">
        <div className="section-header">
          <Trophy size={18} />
          <span>Achievements</span>
        </div>
        <div className="section-loading">
          <Loader2 size={24} className="spin" />
          <span>Loading achievements...</span>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const {
    personal_records = [],
    rare_sightings = [],
    collection_progress = {},
    streaks = {},
    milestones = [],
    badges = []
  } = data;

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

  return (
    <div className="stats-section achievements-section">
      <div className="section-header">
        <Trophy size={18} />
        <span>Achievements & Records</span>
      </div>

      <div className="achievements-grid">
        {/* Personal Records */}
        <div className="achievements-card records-card">
          <div className="card-header">
            <Medal size={16} />
            <span>Personal Records</span>
          </div>
          {personal_records.length === 0 ? (
            <div className="empty-state">No records yet - keep spotting!</div>
          ) : (
            <div className="records-grid">
              {personal_records.slice(0, 6).map((record, i) => {
                const IconComponent = recordIcons[record.type] || recordIcons.default;
                return (
                  <div
                    key={record.type || i}
                    className={`record-card ${onSelectAircraft && record.icao_hex ? 'clickable' : ''}`}
                    onClick={() => record.icao_hex && onSelectAircraft?.(record.icao_hex)}
                  >
                    <div className="record-icon">
                      <IconComponent size={24} />
                    </div>
                    <div className="record-content">
                      <span className="record-title">{record.title || record.type}</span>
                      <span className="record-value">{record.value}</span>
                      {record.aircraft && (
                        <span className="record-aircraft">{record.aircraft}</span>
                      )}
                      {record.date && (
                        <span className="record-date">{record.date}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Rare Sightings */}
        <div className="achievements-card sightings-card">
          <div className="card-header">
            <Star size={16} />
            <span>Rare Sightings</span>
          </div>
          {rare_sightings.length === 0 ? (
            <div className="empty-state">No rare sightings recorded</div>
          ) : (
            <div className="sightings-list">
              {rare_sightings.slice(0, 8).map((sighting, i) => (
                <div
                  key={sighting.icao_hex || i}
                  className={`sighting-item ${onSelectAircraft ? 'clickable' : ''}`}
                  onClick={() => onSelectAircraft?.(sighting.icao_hex)}
                >
                  <div
                    className="sighting-rarity"
                    style={{ backgroundColor: rarityColors[sighting.rarity] || rarityColors.common }}
                    title={sighting.rarity}
                  >
                    <Sparkles size={12} />
                  </div>
                  <div className="sighting-info">
                    <span className="sighting-type">{sighting.aircraft_type || 'Unknown'}</span>
                    <span className="sighting-callsign">{sighting.callsign || sighting.icao_hex}</span>
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

        {/* Collection Progress */}
        <div className="achievements-card collection-card">
          <div className="card-header">
            <Gift size={16} />
            <span>Spotting Progress</span>
          </div>
          <div className="collection-items">
            <div className="collection-item">
              <div className="collection-header">
                <Plane size={16} />
                <span>Aircraft Types</span>
                <span className="collection-count">{typesCollected}/{typesToTarget}</span>
              </div>
              <div className="collection-bar-track">
                <div
                  className="collection-bar-fill types"
                  style={{ width: `${typesPct}%` }}
                />
              </div>
            </div>

            <div className="collection-item">
              <div className="collection-header">
                <Globe size={16} />
                <span>Airlines</span>
                <span className="collection-count">{airlinesCollected}/{airlinesToTarget}</span>
              </div>
              <div className="collection-bar-track">
                <div
                  className="collection-bar-fill airlines"
                  style={{ width: `${airlinesPct}%` }}
                />
              </div>
            </div>

            <div className="collection-item">
              <div className="collection-header">
                <Globe size={16} />
                <span>Countries</span>
                <span className="collection-count">{countriesCollected}/{countriesToTarget}</span>
              </div>
              <div className="collection-bar-track">
                <div
                  className="collection-bar-fill countries"
                  style={{ width: `${countriesPct}%` }}
                />
              </div>
            </div>
          </div>

          {/* Recent Unlocks */}
          {collection_progress.recent_unlocks?.length > 0 && (
            <div className="recent-unlocks">
              <span className="unlocks-title">Recent Unlocks</span>
              <div className="unlocks-list">
                {collection_progress.recent_unlocks.slice(0, 4).map((unlock, i) => (
                  <span key={i} className="unlock-chip">
                    <CheckCircle size={10} />
                    {unlock}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Current Streaks */}
        <div className="achievements-card streaks-card">
          <div className="card-header">
            <Flame size={16} />
            <span>Current Streaks</span>
          </div>
          <div className="streaks-grid">
            <div className={`streak-item ${(streaks.daily_active || 0) > 0 ? 'active' : ''}`}>
              <div className="streak-icon">
                <Flame size={20} />
              </div>
              <div className="streak-content">
                <span className="streak-value">{streaks.daily_active || 0}</span>
                <span className="streak-label">Day Streak</span>
              </div>
            </div>

            <div className={`streak-item ${(streaks.early_bird || 0) > 0 ? 'active' : ''}`}>
              <div className="streak-icon">
                <Star size={20} />
              </div>
              <div className="streak-content">
                <span className="streak-value">{streaks.early_bird || 0}</span>
                <span className="streak-label">Early Bird</span>
              </div>
            </div>

            <div className={`streak-item ${(streaks.night_owl || 0) > 0 ? 'active' : ''}`}>
              <div className="streak-icon">
                <Eye size={20} />
              </div>
              <div className="streak-content">
                <span className="streak-value">{streaks.night_owl || 0}</span>
                <span className="streak-label">Night Owl</span>
              </div>
            </div>

            <div className={`streak-item ${(streaks.variety_hunter || 0) > 0 ? 'active' : ''}`}>
              <div className="streak-icon">
                <Target size={20} />
              </div>
              <div className="streak-content">
                <span className="streak-value">{streaks.variety_hunter || 0}</span>
                <span className="streak-label">Variety Hunter</span>
              </div>
            </div>
          </div>

          {/* Best streaks */}
          {streaks.best_daily && (
            <div className="best-streak">
              <Crown size={14} />
              <span>Best daily streak: {streaks.best_daily} days</span>
            </div>
          )}
        </div>

        {/* Milestones */}
        {milestones.length > 0 && (
          <div className="achievements-card milestones-card">
            <div className="card-header">
              <Trophy size={16} />
              <span>Milestones</span>
            </div>
            <div className="milestones-list">
              {milestones.slice(0, 6).map((milestone, i) => (
                <div
                  key={milestone.id || i}
                  className={`milestone-item ${milestone.achieved ? 'achieved' : ''}`}
                >
                  <div className="milestone-icon">
                    {milestone.achieved ? <CheckCircle size={18} /> : <Target size={18} />}
                  </div>
                  <div className="milestone-content">
                    <span className="milestone-title">{milestone.title}</span>
                    <span className="milestone-description">{milestone.description}</span>
                    {!milestone.achieved && milestone.progress !== undefined && (
                      <div className="milestone-progress">
                        <div
                          className="milestone-progress-fill"
                          style={{ width: `${milestone.progress}%` }}
                        />
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

        {/* Badges */}
        {badges.length > 0 && (
          <div className="achievements-card badges-card">
            <div className="card-header">
              <Award size={16} />
              <span>Badges</span>
            </div>
            <div className="badges-grid">
              {badges.map((badge, i) => (
                <div
                  key={badge.id || i}
                  className={`badge-item ${badge.unlocked ? 'unlocked' : 'locked'}`}
                  title={badge.description}
                >
                  <div className="badge-icon" style={{ backgroundColor: badge.color }}>
                    {badge.icon === 'star' && <Star size={20} />}
                    {badge.icon === 'trophy' && <Trophy size={20} />}
                    {badge.icon === 'medal' && <Medal size={20} />}
                    {badge.icon === 'crown' && <Crown size={20} />}
                    {(!badge.icon || !['star', 'trophy', 'medal', 'crown'].includes(badge.icon)) && <Award size={20} />}
                  </div>
                  <span className="badge-name">{badge.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default AchievementsSection;
