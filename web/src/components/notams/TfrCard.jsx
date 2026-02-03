import React from 'react';
import { Shield, Clock } from 'lucide-react';
import { formatDate } from './notamUtils';

// TFR Summary Card
export function TfrCard({ tfr, onViewDetails }) {
  return (
    <button type="button" className="tfr-card" onClick={onViewDetails}>
      <div className="tfr-header">
        <Shield size={18} className="tfr-icon" />
        <div className="tfr-info">
          <span className="tfr-location">{tfr.location}</span>
          <span className="tfr-id">{tfr.notam_id}</span>
        </div>
      </div>
      <div className="tfr-details">
        {tfr.reason && <p className="tfr-reason">{tfr.reason}</p>}
        <div className="tfr-altitude">
          {tfr.floor_ft != null && <span>SFC - {tfr.floor_ft}ft</span>}
          {tfr.ceiling_ft != null && <span>to {tfr.ceiling_ft}ft</span>}
        </div>
        <div className="tfr-time">
          <Clock size={12} />
          <span>{formatDate(tfr.effective_start)}</span>
          {tfr.effective_end && (
            <>
              <span>→</span>
              <span>{formatDate(tfr.effective_end)}</span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}

export default TfrCard;
