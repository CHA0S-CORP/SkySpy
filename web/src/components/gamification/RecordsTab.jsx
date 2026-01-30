import React from 'react';
import { Medal, Calendar } from 'lucide-react';
import { RECORD_ICONS } from './gamificationConstants';

/**
 * Personal Records Tab component
 */
export function RecordsTab({ personal_records, onSelectAircraft }) {
  return (
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
              const IconComponent = RECORD_ICONS[record.type] || RECORD_ICONS.default;
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
  );
}

export default RecordsTab;
