import React, { useState, useMemo } from 'react';
import { ChevronUp, ChevronDown, Filter, Shield } from 'lucide-react';

export function AircraftList({ aircraft }) {
  const [sortField, setSortField] = useState('distance_nm');
  const [sortAsc, setSortAsc] = useState(true);
  const [filter, setFilter] = useState('');
  const [showMilitary, setShowMilitary] = useState(true);

  const filteredAircraft = useMemo(() => {
    let filtered = [...aircraft];

    if (filter) {
      const f = filter.toLowerCase();
      filtered = filtered.filter(ac =>
        ac.hex?.toLowerCase().includes(f) ||
        ac.flight?.toLowerCase().includes(f) ||
        ac.type?.toLowerCase().includes(f)
      );
    }

    if (!showMilitary) {
      filtered = filtered.filter(ac => !ac.military);
    }

    filtered.sort((a, b) => {
      const aVal = a[sortField] ?? 999999;
      const bVal = b[sortField] ?? 999999;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortAsc ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
    });

    return filtered;
  }, [aircraft, filter, showMilitary, sortField, sortAsc]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const SortIcon = ({ field }) => (
    sortField === field ? (sortAsc ? <ChevronUp size={14} /> : <ChevronDown size={14} />) : null
  );

  return (
    <div className="aircraft-list-container">
      <div className="list-toolbar">
        <div className="search-box">
          <Filter size={16} />
          <input
            type="text"
            placeholder="Filter by ICAO, callsign, type..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        </div>
        <button
          className={`toggle-btn ${showMilitary ? 'active' : ''}`}
          onClick={() => setShowMilitary(!showMilitary)}
        >
          <Shield size={16} />
          Military
        </button>
      </div>

      <div className="aircraft-table-wrapper">
        <table className="aircraft-table">
          <thead>
            <tr>
              <th onClick={() => handleSort('hex')}>ICAO <SortIcon field="hex" /></th>
              <th onClick={() => handleSort('flight')}>Callsign <SortIcon field="flight" /></th>
              <th onClick={() => handleSort('type')}>Type <SortIcon field="type" /></th>
              <th onClick={() => handleSort('alt')}>Altitude <SortIcon field="alt" /></th>
              <th onClick={() => handleSort('gs')}>Speed <SortIcon field="gs" /></th>
              <th onClick={() => handleSort('vr')}>V/S <SortIcon field="vr" /></th>
              <th onClick={() => handleSort('distance_nm')}>Distance <SortIcon field="distance_nm" /></th>
              <th>Squawk</th>
            </tr>
          </thead>
          <tbody>
            {filteredAircraft.map((ac, index) => (
              <tr key={ac.hex || `aircraft-${index}`} className={`${ac.military ? 'military' : ''} ${ac.emergency ? 'emergency' : ''}`}>
                <td className="mono">{ac.hex}</td>
                <td>{ac.flight || '--'}</td>
                <td className="mono">{ac.type || '--'}</td>
                <td className="mono">{ac.alt?.toLocaleString() || '--'}</td>
                <td className="mono">{ac.gs?.toFixed(0) || '--'}</td>
                <td className={`mono ${(ac.vr || 0) > 500 ? 'vr-positive' : (ac.vr || 0) < -500 ? 'vr-negative' : ''}`}>
                  {ac.vr || '--'}
                </td>
                <td className="mono">{ac.distance_nm?.toFixed(1) || '--'}</td>
                <td className={`mono ${ac.squawk?.match(/^7[567]00$/) ? 'emergency-squawk' : ''}`}>
                  {ac.squawk || '--'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="list-footer">
        Showing {filteredAircraft.length} of {aircraft.length} aircraft
      </div>
    </div>
  );
}
