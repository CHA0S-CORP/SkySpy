import React from 'react';

/**
 * Telemetry Snapshot Component
 * Displays raw aircraft telemetry snapshot data in a grid format
 */
export function TelemetrySnapshot({ snapshot, label, onSelectAircraft }) {
  if (!snapshot) return null;

  return (
    <div className="snapshot-section large">
      {label && <div className="snapshot-label">{label}</div>}
      <div className="snapshot-grid">
        {snapshot.flight && (
          <SnapshotItem label="Callsign" value={snapshot.flight} />
        )}
        {snapshot.hex && (
          <SnapshotItem
            label="ICAO"
            value={snapshot.hex}
            className="icao-link"
            onClick={() => onSelectAircraft?.(snapshot.hex)}
          />
        )}
        {snapshot.lat && (
          <SnapshotItem label="Lat" value={snapshot.lat?.toFixed(5)} />
        )}
        {snapshot.lon && (
          <SnapshotItem label="Lon" value={snapshot.lon?.toFixed(5)} />
        )}
        {snapshot.alt_baro && (
          <SnapshotItem label="Alt (baro)" value={`${snapshot.alt_baro?.toLocaleString()} ft`} />
        )}
        {snapshot.alt_geom && (
          <SnapshotItem label="Alt (geom)" value={`${snapshot.alt_geom?.toLocaleString()} ft`} />
        )}
        {snapshot.gs && (
          <SnapshotItem label="Ground Speed" value={`${snapshot.gs?.toFixed(0)} kts`} />
        )}
        {snapshot.track !== undefined && snapshot.track !== null && (
          <SnapshotItem label="Track" value={`${snapshot.track?.toFixed(0)}deg`} />
        )}
        {snapshot.baro_rate && (
          <SnapshotItem
            label="Baro Rate"
            value={`${snapshot.baro_rate > 0 ? '+' : ''}${snapshot.baro_rate} fpm`}
          />
        )}
        {snapshot.geom_rate && (
          <SnapshotItem
            label="Geom Rate"
            value={`${snapshot.geom_rate > 0 ? '+' : ''}${snapshot.geom_rate} fpm`}
          />
        )}
        {snapshot.squawk && (
          <SnapshotItem label="Squawk" value={snapshot.squawk} />
        )}
        {snapshot.category && (
          <SnapshotItem label="Category" value={snapshot.category} />
        )}
        {snapshot.nav_altitude_mcp && (
          <SnapshotItem label="MCP Alt" value={`${snapshot.nav_altitude_mcp?.toLocaleString()} ft`} />
        )}
        {snapshot.nav_heading !== undefined && snapshot.nav_heading !== null && (
          <SnapshotItem label="Nav Heading" value={`${snapshot.nav_heading?.toFixed(0)}deg`} />
        )}
        {snapshot.emergency && (
          <SnapshotItem
            label="Emergency"
            value={snapshot.emergency}
            className="emergency-value"
          />
        )}
      </div>
    </div>
  );
}

/**
 * Individual Snapshot Item
 */
function SnapshotItem({ label, value, className = '', onClick }) {
  return (
    <div className="snapshot-item">
      <span>{label}</span>
      <span className={className} onClick={onClick}>{value}</span>
    </div>
  );
}

/**
 * Telemetry Snapshots Container
 * Displays both aircraft snapshots in a collapsible section
 */
export function TelemetrySnapshotsContent({ event, onSelectAircraft }) {
  const hasSnapshot = event?.aircraft_snapshot || event?.aircraft_snapshot_2;

  if (!hasSnapshot) return null;

  return (
    <div className="sep-telemetry-content-inner">
      <TelemetrySnapshot
        snapshot={event.aircraft_snapshot}
        label={event.aircraft_snapshot_2 ? 'Aircraft 1' : null}
        onSelectAircraft={onSelectAircraft}
      />
      <TelemetrySnapshot
        snapshot={event.aircraft_snapshot_2}
        label="Aircraft 2"
        onSelectAircraft={onSelectAircraft}
      />
    </div>
  );
}

export default TelemetrySnapshot;
