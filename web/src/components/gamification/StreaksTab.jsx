import React from 'react';
import { Flame, Star, Eye, Target, Crown } from 'lucide-react';

/**
 * Streaks Tab component
 */
export function StreaksTab({ streaks }) {
  return (
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
  );
}

export default StreaksTab;
