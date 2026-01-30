import React from 'react';
import { Award, Star, Trophy, Medal, Crown, Flame, Plane, Globe } from 'lucide-react';

const BADGE_ICONS = {
  star: Star,
  trophy: Trophy,
  medal: Medal,
  crown: Crown,
  flame: Flame,
  plane: Plane,
  globe: Globe,
};

/**
 * Badges Tab component
 */
export function BadgesTab({ badges }) {
  return (
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
            {badges.map((badge, i) => {
              const IconComponent = BADGE_ICONS[badge.icon] || Award;
              return (
                <div
                  key={badge.id || i}
                  className={`badge-item large ${badge.unlocked ? 'unlocked' : 'locked'}`}
                  title={badge.description}
                >
                  <div className="badge-icon large" style={{ backgroundColor: badge.color }}>
                    <IconComponent size={28} />
                  </div>
                  <span className="badge-name">{badge.name}</span>
                  {badge.description && (
                    <span className="badge-description">{badge.description}</span>
                  )}
                  {badge.unlocked && badge.date && (
                    <span className="badge-date">Earned {badge.date}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default BadgesTab;
