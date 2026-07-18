import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  ChevronUp,
  ChevronDown,
  Search,
  Shield,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  Plane,
  Filter,
  X,
  ChevronRight,
} from 'lucide-react';
import { VirtualList } from '../common/VirtualList';
import { AircraftRow } from '../aircraft-list/AircraftRow';
import { AircraftCard } from '../aircraft-list/AircraftCard';
import { ViewToggle } from '../aircraft-list/ViewToggle';
import { ColumnSelector } from '../aircraft-list/ColumnSelector';
import { useListPreferences } from '../../hooks/useListPreferences';
import {
  ROW_HEIGHT_COMPACT,
  ROW_HEIGHT_COMFORTABLE,
  QUICK_FILTERS,
  DEFAULT_FILTERS,
  AIRCRAFT_CATEGORIES,
} from '../aircraft-list/aircraftListConstants';

// Normalize altitude for range filtering: 'ground' -> 0, numbers kept, unknown -> null
const normalizeFilterAltitude = (alt) => {
  if (alt === 'ground') return 0;
  return typeof alt === 'number' && !Number.isNaN(alt) ? alt : null;
};

export function AircraftList({ aircraft, onSelectAircraft }) {
  const [sortField, setSortField] = useState('distance_nm');
  const [sortAsc, setSortAsc] = useState(true);
  const [searchFilter, setSearchFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const containerRef = useRef(null);
  const scrollContainerRef = useRef(null);

  // Preferences hook
  const {
    viewMode,
    density,
    visibleColumns,
    columns,
    presets,
    setViewMode,
    setDensity,
    toggleColumn,
    setColumnPreset,
  } = useListPreferences();

  // Filter states - use defaults from constants
  const [filters, setFilters] = useState(DEFAULT_FILTERS);

  const toggleQuickFilter = (filterId, filterValues) => {
    setFilters((prev) => {
      const newFilters = { ...prev };
      Object.entries(filterValues).forEach(([key, value]) => {
        if (prev[key] === value) {
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
    setFilters(DEFAULT_FILTERS);
  };

  const hasActiveFilters = useMemo(() => {
    return (
      searchFilter ||
      filters.military !== null ||
      filters.emergency ||
      filters.climbing ||
      filters.descending ||
      filters.onGround ||
      filters.interesting ||
      filters.highAltitude ||
      filters.lowAltitude ||
      filters.strongSignal ||
      filters.weakSignal ||
      filters.minAltitude ||
      filters.maxAltitude ||
      filters.minDistance ||
      filters.maxDistance ||
      filters.minSpeed ||
      filters.maxSpeed ||
      filters.minHeading ||
      filters.maxHeading ||
      filters.minSignal ||
      filters.maxSignal ||
      filters.aircraftType ||
      filters.category ||
      filters.squawkCode
    );
  }, [searchFilter, filters]);

  const filteredAircraft = useMemo(() => {
    let filtered = [...aircraft];

    // Text search
    if (searchFilter) {
      const f = searchFilter.toLowerCase();
      filtered = filtered.filter(
        (ac) =>
          ac.hex?.toLowerCase().includes(f) ||
          ac.flight?.toLowerCase().includes(f) ||
          ac.type?.toLowerCase().includes(f) ||
          ac.squawk?.includes(f)
      );
    }

    // Military filter
    if (filters.military === true) {
      filtered = filtered.filter((ac) => ac.military);
    } else if (filters.military === false) {
      filtered = filtered.filter((ac) => !ac.military);
    }

    // Emergency filter
    if (filters.emergency) {
      filtered = filtered.filter((ac) => ac.emergency || ac.squawk?.match(/^7[567]00$/));
    }

    // Climbing filter (> 500 fpm)
    if (filters.climbing) {
      filtered = filtered.filter((ac) => (ac.vr || 0) > 500);
    }

    // Descending filter (< -500 fpm)
    if (filters.descending) {
      filtered = filtered.filter((ac) => (ac.vr || 0) < -500);
    }

    // On ground filter
    if (filters.onGround) {
      filtered = filtered.filter((ac) => ac.alt === 0 || ac.alt === null || ac.alt === 'ground');
    }

    // Interesting filter
    if (filters.interesting) {
      filtered = filtered.filter((ac) => ac.interesting);
    }

    // High altitude filter (FL350+)
    if (filters.highAltitude) {
      filtered = filtered.filter((ac) => (ac.alt || 0) >= 35000);
    }

    // Low altitude filter (< 5000 ft)
    if (filters.lowAltitude) {
      filtered = filtered.filter((ac) => {
        const alt = ac.alt;
        return alt !== null && alt !== 'ground' && alt > 0 && alt < 5000;
      });
    }

    // Strong signal filter (RSSI > -10)
    if (filters.strongSignal) {
      filtered = filtered.filter((ac) => ac.rssi !== undefined && ac.rssi > -10);
    }

    // Weak signal filter (RSSI < -25)
    if (filters.weakSignal) {
      filtered = filtered.filter((ac) => ac.rssi !== undefined && ac.rssi < -25);
    }

    // Altitude range (aircraft with unknown altitude are excluded from explicit range filters)
    if (filters.minAltitude) {
      const min = parseInt(filters.minAltitude, 10);
      if (!isNaN(min)) {
        filtered = filtered.filter((ac) => {
          const alt = normalizeFilterAltitude(ac.alt);
          return alt !== null && alt >= min;
        });
      }
    }
    if (filters.maxAltitude) {
      const max = parseInt(filters.maxAltitude, 10);
      if (!isNaN(max)) {
        filtered = filtered.filter((ac) => {
          const alt = normalizeFilterAltitude(ac.alt);
          return alt !== null && alt <= max;
        });
      }
    }

    // Distance range
    if (filters.minDistance) {
      const min = parseFloat(filters.minDistance);
      if (!isNaN(min)) {
        filtered = filtered.filter((ac) => (ac.distance_nm || 0) >= min);
      }
    }
    if (filters.maxDistance) {
      const max = parseFloat(filters.maxDistance);
      if (!isNaN(max)) {
        filtered = filtered.filter((ac) => (ac.distance_nm || 999999) <= max);
      }
    }

    // Speed range
    if (filters.minSpeed) {
      const min = parseInt(filters.minSpeed, 10);
      if (!isNaN(min)) {
        filtered = filtered.filter((ac) => (ac.gs || 0) >= min);
      }
    }
    if (filters.maxSpeed) {
      const max = parseInt(filters.maxSpeed, 10);
      if (!isNaN(max)) {
        filtered = filtered.filter((ac) => (ac.gs || 0) <= max);
      }
    }

    // Heading/Track range (0-360 with wraparound support)
    if (filters.minHeading || filters.maxHeading) {
      const minH = filters.minHeading ? parseInt(filters.minHeading, 10) : 0;
      const maxH = filters.maxHeading ? parseInt(filters.maxHeading, 10) : 360;
      if (!isNaN(minH) && !isNaN(maxH)) {
        filtered = filtered.filter((ac) => {
          const track = ac.track;
          if (track === undefined || track === null) return false;
          // Handle wraparound (e.g., 350-10 means 350-360 and 0-10)
          if (minH <= maxH) {
            return track >= minH && track <= maxH;
          } else {
            return track >= minH || track <= maxH;
          }
        });
      }
    }

    // Signal (RSSI) range
    if (filters.minSignal) {
      const min = parseFloat(filters.minSignal);
      if (!isNaN(min)) {
        filtered = filtered.filter((ac) => ac.rssi !== undefined && ac.rssi >= min);
      }
    }
    if (filters.maxSignal) {
      const max = parseFloat(filters.maxSignal);
      if (!isNaN(max)) {
        filtered = filtered.filter((ac) => ac.rssi !== undefined && ac.rssi <= max);
      }
    }

    // Aircraft type filter
    if (filters.aircraftType) {
      const typeFilter = filters.aircraftType.toUpperCase();
      filtered = filtered.filter((ac) => ac.type?.toUpperCase().includes(typeFilter));
    }

    // Category filter
    if (filters.category) {
      filtered = filtered.filter((ac) => ac.category === filters.category);
    }

    // Squawk code filter
    if (filters.squawkCode) {
      const squawkFilter = filters.squawkCode;
      filtered = filtered.filter((ac) => ac.squawk?.includes(squawkFilter));
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

  // Scroll to top when filters change
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [searchFilter, filters, sortField, sortAsc]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(field === 'distance_nm');
    }
  };

  const SortIcon = ({ field }) =>
    sortField === field ? sortAsc ? <ChevronUp size={14} /> : <ChevronDown size={14} /> : null;

  // Calculate stats for display
  const stats = useMemo(() => {
    const total = aircraft.length;
    const military = aircraft.filter((ac) => ac.military).length;
    const emergency = aircraft.filter(
      (ac) => ac.emergency || ac.squawk?.match(/^7[567]00$/)
    ).length;
    const climbing = aircraft.filter((ac) => (ac.vr || 0) > 500).length;
    const descending = aircraft.filter((ac) => (ac.vr || 0) < -500).length;
    const onGround = aircraft.filter(
      (ac) => ac.alt === 0 || ac.alt === null || ac.alt === 'ground'
    ).length;
    const interesting = aircraft.filter((ac) => ac.interesting).length;
    const highAltitude = aircraft.filter((ac) => (ac.alt || 0) >= 35000).length;
    const lowAltitude = aircraft.filter((ac) => {
      const alt = ac.alt;
      return alt !== null && alt !== 'ground' && alt > 0 && alt < 5000;
    }).length;
    const strongSignal = aircraft.filter((ac) => ac.rssi !== undefined && ac.rssi > -10).length;
    const weakSignal = aircraft.filter((ac) => ac.rssi !== undefined && ac.rssi < -25).length;
    return {
      total,
      military,
      emergency,
      climbing,
      descending,
      onGround,
      interesting,
      highAltitude,
      lowAltitude,
      strongSignal,
      weakSignal,
    };
  }, [aircraft]);

  // Get count for a quick filter
  const getQuickFilterCount = useCallback(
    (filterId) => {
      switch (filterId) {
        case 'emergency':
          return stats.emergency;
        case 'military':
          return stats.military;
        case 'climbing':
          return stats.climbing;
        case 'descending':
          return stats.descending;
        case 'ground':
          return stats.onGround;
        case 'interesting':
          return stats.interesting;
        case 'highAltitude':
          return stats.highAltitude;
        case 'lowAltitude':
          return stats.lowAltitude;
        case 'strongSignal':
          return stats.strongSignal;
        case 'weakSignal':
          return stats.weakSignal;
        default:
          return 0;
      }
    },
    [stats]
  );

  // Row height based on density
  const rowHeight = density === 'compact' ? ROW_HEIGHT_COMPACT : ROW_HEIGHT_COMFORTABLE;

  // Render table row for virtual list
  const renderTableRow = useCallback(
    (ac, index) => (
      <AircraftRow
        aircraft={ac}
        index={index}
        onSelect={onSelectAircraft}
        visibleColumns={visibleColumns}
        density={density}
      />
    ),
    [onSelectAircraft, visibleColumns, density]
  );

  // Get visible column headers
  const visibleColumnHeaders = columns.filter((col) => visibleColumns.includes(col.id));

  return (
    <div className={`aircraft-list-container view-${viewMode}`} ref={containerRef}>
      {/* Main toolbar */}
      <div className="list-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search ICAO, callsign, type, squawk..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
          />
          {searchFilter && (
            <button className="search-clear" onClick={() => setSearchFilter('')}>
              <X size={14} />
            </button>
          )}
        </div>

        <div className="toolbar-actions">
          <ViewToggle
            viewMode={viewMode}
            density={density}
            onViewModeChange={setViewMode}
            onDensityChange={setDensity}
          />

          {viewMode === 'table' && (
            <ColumnSelector
              columns={columns}
              visibleColumns={visibleColumns}
              presets={presets}
              onToggleColumn={toggleColumn}
              onSetPreset={setColumnPreset}
            />
          )}

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
      </div>

      {/* Quick filter chips */}
      <div className="quick-filters">
        {QUICK_FILTERS.map((qf) => {
          const Icon = qf.icon;
          const isActive = isQuickFilterActive(qf.filter);
          const count = getQuickFilterCount(qf.id);
          return (
            <button
              key={qf.id}
              className={`quick-filter-chip ${qf.color} ${isActive ? 'active' : ''}`}
              onClick={() => toggleQuickFilter(qf.id, qf.filter)}
              title={qf.tooltip}
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
            <label htmlFor="altitude-filter-min">Altitude (ft)</label>
            <div className="range-inputs">
              <input
                id="altitude-filter-min"
                type="number"
                placeholder="Min"
                value={filters.minAltitude}
                onChange={(e) => setFilters((prev) => ({ ...prev, minAltitude: e.target.value }))}
              />
              <span>to</span>
              <input
                id="altitude-filter-max"
                type="number"
                placeholder="Max"
                value={filters.maxAltitude}
                onChange={(e) => setFilters((prev) => ({ ...prev, maxAltitude: e.target.value }))}
              />
            </div>
          </div>
          <div className="filter-group">
            <label htmlFor="distance-filter-min">Distance (nm)</label>
            <div className="range-inputs">
              <input
                id="distance-filter-min"
                type="number"
                placeholder="Min"
                value={filters.minDistance}
                onChange={(e) => setFilters((prev) => ({ ...prev, minDistance: e.target.value }))}
              />
              <span>to</span>
              <input
                id="distance-filter-max"
                type="number"
                placeholder="Max"
                value={filters.maxDistance}
                onChange={(e) => setFilters((prev) => ({ ...prev, maxDistance: e.target.value }))}
              />
            </div>
          </div>
          <div className="filter-group">
            <label htmlFor="speed-filter-min">Speed (kts)</label>
            <div className="range-inputs">
              <input
                id="speed-filter-min"
                type="number"
                placeholder="Min"
                value={filters.minSpeed}
                onChange={(e) => setFilters((prev) => ({ ...prev, minSpeed: e.target.value }))}
              />
              <span>to</span>
              <input
                id="speed-filter-max"
                type="number"
                placeholder="Max"
                value={filters.maxSpeed}
                onChange={(e) => setFilters((prev) => ({ ...prev, maxSpeed: e.target.value }))}
              />
            </div>
          </div>
          <div className="filter-group">
            <label htmlFor="heading-filter-min">Heading (deg)</label>
            <div className="range-inputs">
              <input
                id="heading-filter-min"
                type="number"
                placeholder="Min"
                min="0"
                max="360"
                value={filters.minHeading}
                onChange={(e) => setFilters((prev) => ({ ...prev, minHeading: e.target.value }))}
              />
              <span>to</span>
              <input
                id="heading-filter-max"
                type="number"
                placeholder="Max"
                min="0"
                max="360"
                value={filters.maxHeading}
                onChange={(e) => setFilters((prev) => ({ ...prev, maxHeading: e.target.value }))}
              />
            </div>
          </div>
          <div className="filter-group">
            <label htmlFor="signal-filter-min">Signal (dB)</label>
            <div className="range-inputs">
              <input
                id="signal-filter-min"
                type="number"
                placeholder="Min"
                value={filters.minSignal}
                onChange={(e) => setFilters((prev) => ({ ...prev, minSignal: e.target.value }))}
              />
              <span>to</span>
              <input
                id="signal-filter-max"
                type="number"
                placeholder="Max"
                value={filters.maxSignal}
                onChange={(e) => setFilters((prev) => ({ ...prev, maxSignal: e.target.value }))}
              />
            </div>
          </div>
          <div className="filter-group">
            <label htmlFor="type-filter">Aircraft Type</label>
            <input
              id="type-filter"
              type="text"
              placeholder="e.g., B738, A320"
              value={filters.aircraftType}
              onChange={(e) => setFilters((prev) => ({ ...prev, aircraftType: e.target.value }))}
              className="text-filter-input"
            />
          </div>
          <div className="filter-group">
            <label htmlFor="category-filter">Category</label>
            <select
              id="category-filter"
              value={filters.category}
              onChange={(e) => setFilters((prev) => ({ ...prev, category: e.target.value }))}
              className="select-filter"
            >
              {AIRCRAFT_CATEGORIES.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label htmlFor="squawk-filter">Squawk Code</label>
            <input
              id="squawk-filter"
              type="text"
              placeholder="e.g., 7700, 1200"
              value={filters.squawkCode}
              onChange={(e) => setFilters((prev) => ({ ...prev, squawkCode: e.target.value }))}
              className="text-filter-input"
              maxLength={4}
            />
          </div>
        </div>
      )}

      {/* Content Area */}
      {viewMode === 'table' ? (
        /* Virtual Scrolling Table */
        <div className={`aircraft-table-wrapper density-${density}`} ref={scrollContainerRef}>
          <table className={`aircraft-table al-table density-${density}`}>
            <thead>
              <tr>
                {visibleColumnHeaders.map((col) => (
                  <th
                    key={col.id}
                    onClick={col.sortable ? () => handleSort(col.id) : undefined}
                    className={col.sortable ? 'sortable' : ''}
                  >
                    {col.label} {col.sortable && <SortIcon field={col.id} />}
                  </th>
                ))}
              </tr>
            </thead>
          </table>

          {filteredAircraft.length === 0 ? (
            <div className="empty-message-container">
              <div className="empty-message">
                <Plane size={24} />
                <span>No aircraft match your filters</span>
              </div>
            </div>
          ) : (
            <VirtualList
              items={filteredAircraft}
              itemHeight={rowHeight}
              height="auto"
              overscan={5}
              className="al-virtual-table-body"
              getItemKey={(item) => item.hex}
              renderItem={(ac, index) => (
                <table className={`aircraft-table al-table density-${density}`}>
                  <tbody>{renderTableRow(ac, index)}</tbody>
                </table>
              )}
            />
          )}
        </div>
      ) : (
        /* Card Grid View */
        <div className="al-card-grid-wrapper" ref={scrollContainerRef}>
          {filteredAircraft.length === 0 ? (
            <div className="empty-message-container">
              <div className="empty-message">
                <Plane size={24} />
                <span>No aircraft match your filters</span>
              </div>
            </div>
          ) : (
            <div className="al-card-grid">
              {filteredAircraft.map((ac, index) => (
                <AircraftCard key={ac.hex} aircraft={ac} onSelect={onSelectAircraft} />
              ))}
            </div>
          )}
        </div>
      )}

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
          <span className="legend-item climbing">
            <ArrowUp size={12} /> Climbing
          </span>
          <span className="legend-item descending">
            <ArrowDown size={12} /> Descending
          </span>
        </div>
      </div>
    </div>
  );
}
