import React, { useState, useMemo } from 'react';
import {
  ChevronUp, ChevronDown, Search, Shield, AlertTriangle,
  ArrowUp, ArrowDown, Plane, Radio, Filter, X, ChevronRight
} from 'lucide-react';

// Helper to get cardinal direction from heading
const getCardinalDirection = (heading) => {
  if (heading === null || heading === undefined) return null;
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(heading / 45) % 8;
  return directions[index];
};

// Signal strength indicator component
const SignalIndicator = ({ rssi }) => {
  if (rssi === null || rssi === undefined) return <span className="signal-indicator">--</span>;

  // RSSI typically ranges from about -30 (excellent) to -50 (poor)
  // Lower absolute value = stronger signal
  const strength = rssi > -20 ? 4 : rssi > -30 ? 3 : rssi > -40 ? 2 : 1;
  const strengthClass = strength >= 3 ? 'strong' : strength === 2 ? 'medium' : 'weak';

  return (
    <span className={`signal-indicator ${strengthClass}`} title={`${rssi.toFixed(1)} dB`}>
      <Radio size={12} />
      <span className="signal-bars">
        {[1, 2, 3, 4].map(i => (
          <span key={i} className={`bar ${i <= strength ? 'active' : ''}`} />
        ))}
      </span>
    </span>
  );
};

// Vertical speed indicator
const VerticalSpeedIndicator = ({ vr }) => {
  if (!vr) return <span className="vs-indicator">--</span>;

  const isClimbing = vr > 100;
  const isDescending = vr < -100;
  const isFast = Math.abs(vr) > 2000;

  return (
    <span className={`vs-indicator ${isClimbing ? 'climbing' : ''} ${isDescending ? 'descending' : ''} ${isFast ? 'fast' : ''}`}>
      {isClimbing && <ArrowUp size={12} />}
      {isDescending && <ArrowDown size={12} />}
      {vr > 0 ? '+' : ''}{vr}
    </span>
  );
};

export function AircraftList({ aircraft, onSelectAircraft }) {
  const [sortField, setSortField] = useState('distance_nm');
  const [sortAsc, setSortAsc] = useState(true);
  const [searchFilter, setSearchFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Filter states
  const [filters, setFilters] = useState({
    military: null,      // null = all, true = only military, false = no military
    emergency: false,    // show only emergency squawks
    climbing: false,     // show only climbing aircraft
    descending: false,   // show only descending aircraft
    onGround: false,     // show only ground aircraft
    minAltitude: '',
    maxAltitude: '',
    minDistance: '',
    maxDistance: '',
    minSpeed: '',
    maxSpeed: '',
  });

  // Quick filter presets
  const quickFilters = [
    { id: 'emergency', label: 'Emergency', icon: AlertTriangle, color: 'red', filter: { emergency: true } },
    { id: 'military', label: 'Military', icon: Shield, color: 'purple', filter: { military: true } },
    { id: 'climbing', label: 'Climbing', icon: ArrowUp, color: 'green', filter: { climbing: true } },
    { id: 'descending', label: 'Descending', icon: ArrowDown, color: 'orange', filter: { descending: true } },
    { id: 'ground', label: 'On Ground', icon: Plane, color: 'blue', filter: { onGround: true } },
  ];

  const toggleQuickFilter = (filterId, filterValues) => {
    setFilters(prev => {
      const newFilters = { ...prev };
      // Toggle the filter
      Object.entries(filterValues).forEach(([key, value]) => {
        if (prev[key] === value) {
          // Turn off - reset to default
          newFilters[key] = key === 'military' ? null : false;
        } else {
          newFilters[key] = value;
        }
      });
      return newFilters;
    });
  };

  const isQuickFilterActive = (filterValues) => {
    return Object.entries(filterValues).every(([key, value]) => filters[key] === value);
  };

  const clearAllFilters = () => {
    setSearchFilter('');
    setFilters({
      military: null,
      emergency: false,
      climbing: false,
      descending: false,
      onGround: false,
      minAltitude: '',
      maxAltitude: '',
      minDistance: '',
      maxDistance: '',
      minSpeed: '',
      maxSpeed: '',
    });
  };

  const hasActiveFilters = useMemo(() => {
    return searchFilter ||
      filters.military !== null ||
      filters.emergency ||
      filters.climbing ||
      filters.descending ||
      filters.onGround ||
      filters.minAltitude ||
      filters.maxAltitude ||
      filters.minDistance ||
      filters.maxDistance ||
      filters.minSpeed ||
      filters.maxSpeed;
  }, [searchFilter, filters]);

  const filteredAircraft = useMemo(() => {
    let filtered = [...aircraft];

    // Text search
    if (searchFilter) {
      const f = searchFilter.toLowerCase();
      filtered = filtered.filter(ac =>
        ac.hex?.toLowerCase().includes(f) ||
        ac.flight?.toLowerCase().includes(f) ||
        ac.type?.toLowerCase().includes(f) ||
        ac.squawk?.includes(f)
      );
    }

    // Military filter
    if (filters.military === true) {
      filtered = filtered.filter(ac => ac.military);
    } else if (filters.military === false) {
      filtered = filtered.filter(ac => !ac.military);
    }

    // Emergency filter
    if (filters.emergency) {
      filtered = filtered.filter(ac => ac.emergency || ac.squawk?.match(/^7[567]00$/));
    }

    // Climbing filter (> 500 fpm)
    if (filters.climbing) {
      filtered = filtered.filter(ac => (ac.vr || 0) > 500);
    }

    // Descending filter (< -500 fpm)
    if (filters.descending) {
      filtered = filtered.filter(ac => (ac.vr || 0) < -500);
    }

    // On ground filter
    if (filters.onGround) {
      filtered = filtered.filter(ac => ac.alt === 0 || ac.alt === null || ac.alt === 'ground');
    }

    // Altitude range
    if (filters.minAltitude) {
      const min = parseInt(filters.minAltitude, 10);
      if (!isNaN(min)) {
        filtered = filtered.filter(ac => (ac.alt || 0) >= min);
      }
    }
    if (filters.maxAltitude) {
      const max = parseInt(filters.maxAltitude, 10);
      if (!isNaN(max)) {
        filtered = filtered.filter(ac => (ac.alt || 0) <= max);
      }
    }

    // Distance range
    if (filters.minDistance) {
      const min = parseFloat(filters.minDistance);
      if (!isNaN(min)) {
        filtered = filtered.filter(ac => (ac.distance_nm || 0) >= min);
      }
    }
    if (filters.maxDistance) {
      const max = parseFloat(filters.maxDistance);
      if (!isNaN(max)) {
        filtered = filtered.filter(ac => (ac.distance_nm || 999999) <= max);
      }
    }

    // Speed range
    if (filters.minSpeed) {
      const min = parseInt(filters.minSpeed, 10);
      if (!isNaN(min)) {
        filtered = filtered.filter(ac => (ac.gs || 0) >= min);
      }
    }
    if (filters.maxSpeed) {
      const max = parseInt(filters.maxSpeed, 10);
      if (!isNaN(max)) {
        filtered = filtered.filter(ac => (ac.gs || 0) <= max);
      }
    }

    // Sort
    filtered.sort((a, b) => {
      const aVal = a[sortField] ?? 999999;
      const bVal = b[sortField] ?? 999999;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortAsc ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
    });

    return filtered;
  }, [aircraft, searchFilter, filters, sortField, sortAsc]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(field === 'distance_nm'); // Distance sorts ascending by default
    }
  };

  const SortIcon = ({ field }) => (
    sortField === field ? (sortAsc ? <ChevronUp size={14} /> : <ChevronDown size={14} />) : null
  );

  // Calculate stats for display
  const stats = useMemo(() => {
    const total = aircraft.length;
    const military = aircraft.filter(ac => ac.military).length;
    const emergency = aircraft.filter(ac => ac.emergency || ac.squawk?.match(/^7[567]00$/)).length;
    const climbing = aircraft.filter(ac => (ac.vr || 0) > 500).length;
    const descending = aircraft.filter(ac => (ac.vr || 0) < -500).length;
    return { total, military, emergency, climbing, descending };
  }, [aircraft]);

  return (
    <div className="aircraft-list-container">
      {/* Main toolbar */}
      <div className="list-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search ICAO, callsign, type, squawk..."
            value={searchFilter}
            onChange={e => setSearchFilter(e.target.value)}
          />
          {searchFilter && (
            <button className="search-clear" onClick={() => setSearchFilter('')}>
              <X size={14} />
            </button>
          )}
        </div>
        <button
          className={`filter-toggle-btn ${showFilters ? 'active' : ''} ${hasActiveFilters ? 'has-filters' : ''}`}
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter size={16} />
          Filters
          {hasActiveFilters && <span className="filter-count">!</span>}
          <ChevronRight size={14} className={`chevron ${showFilters ? 'rotated' : ''}`} />
        </button>
        {hasActiveFilters && (
          <button className="clear-filters-btn" onClick={clearAllFilters}>
            <X size={14} />
            Clear All
          </button>
        )}
      </div>

      {/* Quick filter chips */}
      <div className="quick-filters">
        {quickFilters.map(qf => {
          const Icon = qf.icon;
          const isActive = isQuickFilterActive(qf.filter);
          const count = qf.id === 'emergency' ? stats.emergency :
                       qf.id === 'military' ? stats.military :
                       qf.id === 'climbing' ? stats.climbing :
                       qf.id === 'descending' ? stats.descending : 0;
          return (
            <button
              key={qf.id}
              className={`quick-filter-chip ${qf.color} ${isActive ? 'active' : ''}`}
              onClick={() => toggleQuickFilter(qf.id, qf.filter)}
            >
              <Icon size={14} />
              {qf.label}
              {count > 0 && <span className="chip-count">{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Advanced filters panel */}
      {showFilters && (
        <div className="advanced-filters">
          <div className="filter-group">
            <label>Altitude (ft)</label>
            <div className="range-inputs">
              <input
                type="number"
                placeholder="Min"
                value={filters.minAltitude}
                onChange={e => setFilters(prev => ({ ...prev, minAltitude: e.target.value }))}
              />
              <span>to</span>
              <input
                type="number"
                placeholder="Max"
                value={filters.maxAltitude}
                onChange={e => setFilters(prev => ({ ...prev, maxAltitude: e.target.value }))}
              />
            </div>
          </div>
          <div className="filter-group">
            <label>Distance (nm)</label>
            <div className="range-inputs">
              <input
                type="number"
                placeholder="Min"
                value={filters.minDistance}
                onChange={e => setFilters(prev => ({ ...prev, minDistance: e.target.value }))}
              />
              <span>to</span>
              <input
                type="number"
                placeholder="Max"
                value={filters.maxDistance}
                onChange={e => setFilters(prev => ({ ...prev, maxDistance: e.target.value }))}
              />
            </div>
          </div>
          <div className="filter-group">
            <label>Speed (kts)</label>
            <div className="range-inputs">
              <input
                type="number"
                placeholder="Min"
                value={filters.minSpeed}
                onChange={e => setFilters(prev => ({ ...prev, minSpeed: e.target.value }))}
              />
              <span>to</span>
              <input
                type="number"
                placeholder="Max"
                value={filters.maxSpeed}
                onChange={e => setFilters(prev => ({ ...prev, maxSpeed: e.target.value }))}
              />
            </div>
          </div>
        </div>
      )}

      {/* Table */}
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
              <th onClick={() => handleSort('track')}>Hdg <SortIcon field="track" /></th>
              <th onClick={() => handleSort('distance_nm')}>Dist <SortIcon field="distance_nm" /></th>
              <th onClick={() => handleSort('rssi')}>Sig <SortIcon field="rssi" /></th>
              <th>Squawk</th>
            </tr>
          </thead>
          <tbody>
            {filteredAircraft.length === 0 ? (
              <tr className="empty-row">
                <td colSpan="10">
                  <div className="empty-message">
                    <Plane size={24} />
                    <span>No aircraft match your filters</span>
                  </div>
                </td>
              </tr>
            ) : (
              filteredAircraft.map((ac, index) => {
                const isClimbing = (ac.vr || 0) > 500;
                const isDescending = (ac.vr || 0) < -500;
                const isEmergency = ac.emergency || ac.squawk?.match(/^7[567]00$/);
                const cardinal = getCardinalDirection(ac.track);

                return (
                  <tr
                    key={ac.hex || `aircraft-${index}`}
                    className={`
                      ${ac.military ? 'military' : ''}
                      ${isEmergency ? 'emergency' : ''}
                      ${isClimbing ? 'climbing' : ''}
                      ${isDescending ? 'descending' : ''}
                      ${onSelectAircraft ? 'clickable' : ''}
                    `}
                    onClick={() => onSelectAircraft?.(ac.hex)}
                  >
                    <td className="mono icao-cell">
                      {ac.military && <Shield size={12} className="row-icon military-icon" />}
                      {isEmergency && <AlertTriangle size={12} className="row-icon emergency-icon" />}
                      {ac.hex}
                    </td>
                    <td className="callsign-cell">{ac.flight || '--'}</td>
                    <td className="mono type-cell">{ac.type || '--'}</td>
                    <td className="mono alt-cell">
                      {ac.alt != null ? ac.alt.toLocaleString() : '--'}
                    </td>
                    <td className="mono speed-cell">{ac.gs?.toFixed(0) || '--'}</td>
                    <td className="mono vs-cell">
                      <VerticalSpeedIndicator vr={ac.vr} />
                    </td>
                    <td className="mono hdg-cell">
                      {ac.track != null ? (
                        <span className="heading-value">
                          {Math.round(ac.track)}°
                          {cardinal && <span className="cardinal">{cardinal}</span>}
                        </span>
                      ) : '--'}
                    </td>
                    <td className="mono dist-cell">{ac.distance_nm?.toFixed(1) || '--'}</td>
                    <td className="sig-cell">
                      <SignalIndicator rssi={ac.rssi} />
                    </td>
                    <td className={`mono squawk-cell ${ac.squawk?.match(/^7[567]00$/) ? 'emergency-squawk' : ''}`}>
                      {ac.squawk || '--'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer with stats */}
      <div className="list-footer">
        <div className="footer-stats">
          <span className="stat-item">
            <Plane size={14} />
            {filteredAircraft.length} of {aircraft.length}
          </span>
          {stats.military > 0 && (
            <span className="stat-item military">
              <Shield size={14} />
              {stats.military}
            </span>
          )}
          {stats.emergency > 0 && (
            <span className="stat-item emergency">
              <AlertTriangle size={14} />
              {stats.emergency}
            </span>
          )}
        </div>
        <div className="footer-legend">
          <span className="legend-item climbing"><ArrowUp size={12} /> Climbing</span>
          <span className="legend-item descending"><ArrowDown size={12} /> Descending</span>
        </div>
      </div>
    </div>
  );
}
