import React from 'react';
import { Star, Sparkles } from 'lucide-react';
import { RARITY_COLORS, RARITY_LABELS } from './gamificationConstants';

/**
 * Rare Sightings Tab component
 */
export function SightingsTab({ rare_sightings, onSelectAircraft }) {
  return (
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
                  style={{ backgroundColor: RARITY_COLORS[sighting.rarity] || RARITY_COLORS.common }}
                  title={sighting.rarity}
                >
                  <Sparkles size={16} />
                </div>
                <div className="sighting-info">
                  <span className="sighting-type">{sighting.aircraft_type || 'Unknown'}</span>
                  <span className="sighting-callsign">{sighting.callsign || sighting.icao_hex}</span>
                  <span className="sighting-rarity-label">
                    {RARITY_LABELS[sighting.rarity] || 'Unknown'}
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
  );
}

export default SightingsTab;
