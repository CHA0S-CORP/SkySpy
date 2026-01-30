import React from 'react';
import { SortableTableHeader } from '../common/SortableTableHeader';
import { SIGHTINGS_COLUMNS } from './historyConstants';

/**
 * Table component for displaying sightings data
 */
export function SightingsTable({
  sightings,
  sortField,
  sortDirection,
  onSort,
  onSelectAircraft
}) {
  return (
    <div className="sightings-table-wrapper">
      <table className="sightings-table">
        <SortableTableHeader
          columns={SIGHTINGS_COLUMNS}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={onSort}
        />
        <tbody>
          {sightings.map((s, i) => (
            <tr key={i}>
              <td>{new Date(s.timestamp).toLocaleTimeString()}</td>
              <td className="mono">
                <span
                  className="icao-link"
                  onClick={() => onSelectAircraft?.(s.icao_hex)}
                >
                  {s.icao_hex}
                </span>
              </td>
              <td>{s.callsign || '--'}</td>
              <td className="mono">{s.altitude?.toLocaleString() || '--'}</td>
              <td className="mono">{s.gs?.toFixed(0) || '--'}</td>
              <td className="mono">{s.distance_nm?.toFixed(1) || '--'}</td>
              <td className="mono">{s.rssi != null ? `${s.rssi.toFixed(1)} dB` : '--'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
