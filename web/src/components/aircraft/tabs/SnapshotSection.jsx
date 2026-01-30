import React from 'react';

/**
 * Render snapshot data section
 */
export function SnapshotSection({ snapshot, label, currentHex, onSelectAircraft }) {
  if (!snapshot) return null;

  return (
    <div className="snapshot-section">
      {label && <div className="snapshot-label">{label}</div>}
      <div className="snapshot-grid">
        {snapshot.flight && (
          <div className="snapshot-item">
            <span>Callsign</span>
            <span>{snapshot.flight}</span>
          </div>
        )}
        {snapshot.hex && (
          <div className="snapshot-item">
            <span>ICAO</span>
            {snapshot.hex?.toLowerCase() !== currentHex?.toLowerCase() ? (
              <button className="icao-link" onClick={() => onSelectAircraft?.(snapshot.hex)}>
                {snapshot.hex}
              </button>
            ) : (
              <span>{snapshot.hex}</span>
            )}
          </div>
        )}
        {snapshot.lat && (
          <div className="snapshot-item">
            <span>Lat</span>
            <span>{snapshot.lat?.toFixed(5)}</span>
          </div>
        )}
        {snapshot.lon && (
          <div className="snapshot-item">
            <span>Lon</span>
            <span>{snapshot.lon?.toFixed(5)}</span>
          </div>
        )}
        {snapshot.alt_baro && (
          <div className="snapshot-item">
            <span>Alt (baro)</span>
            <span>{snapshot.alt_baro?.toLocaleString()} ft</span>
          </div>
        )}
        {snapshot.alt_geom && (
          <div className="snapshot-item">
            <span>Alt (geom)</span>
            <span>{snapshot.alt_geom?.toLocaleString()} ft</span>
          </div>
        )}
        {snapshot.gs && (
          <div className="snapshot-item">
            <span>Ground Speed</span>
            <span>{snapshot.gs?.toFixed(0)} kts</span>
          </div>
        )}
        {snapshot.track !== undefined && snapshot.track !== null && (
          <div className="snapshot-item">
            <span>Track</span>
            <span>{snapshot.track?.toFixed(0)}deg</span>
          </div>
        )}
        {snapshot.baro_rate && (
          <div className="snapshot-item">
            <span>Baro Rate</span>
            <span>{snapshot.baro_rate > 0 ? '+' : ''}{snapshot.baro_rate} fpm</span>
          </div>
        )}
        {snapshot.geom_rate && (
          <div className="snapshot-item">
            <span>Geom Rate</span>
            <span>{snapshot.geom_rate > 0 ? '+' : ''}{snapshot.geom_rate} fpm</span>
          </div>
        )}
        {snapshot.squawk && (
          <div className="snapshot-item">
            <span>Squawk</span>
            <span>{snapshot.squawk}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default SnapshotSection;
