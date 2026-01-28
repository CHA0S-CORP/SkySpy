import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  ChevronUp, ChevronDown, Search, Shield, AlertTriangle,
  ArrowUp, ArrowDown, Plane, Radio, Filter, X, ChevronRight
} from 'lucide-react';
import { VirtualList } from '../common/VirtualList';
import { AircraftRow } from '../aircraft-list/AircraftRow';
import { AircraftCard } from '../aircraft-list/AircraftCard';
import { ViewToggle } from '../aircraft-list/ViewToggle';
import { ColumnSelector } from '../aircraft-list/ColumnSelector';
import { useListPreferences } from '../../hooks/useListPreferences';

// Row heights for virtual scrolling
const ROW_HEIGHT_COMPACT = 32;
const ROW_HEIGHT_COMFORTABLE = 44;
const CARD_HEIGHT = 160;
const CARD_HEIGHT_COMPACT = 100;

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

  // Filter states
  const [filters, setFilters] = useState({
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

  // Row height based on density
  const rowHeight = density === 'compact' ? ROW_HEIGHT_COMPACT : ROW_HEIGHT_COMFORTABLE;

  // Render table row for virtual list
  const renderTableRow = useCallback((ac, index) => (
    <AircraftRow
      aircraft={ac}
      index={index}
      onSelect={onSelectAircraft}
      visibleColumns={visibleColumns}
      density={density}
    />
  ), [onSelectAircraft, visibleColumns, density]);

  // Render card for virtual list (used in grid layout)
  const renderCard = useCallback((ac, index) => (
    <AircraftCard
      aircraft={ac}
      onSelect={onSelectAircraft}
      compact={window.innerWidth < 480}
    />
  ), [onSelectAircraft]);

  // Get visible column headers
  const visibleColumnHeaders = columns.filter(col => visibleColumns.includes(col.id));

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
            onChange={e => setSearchFilter(e.target.value)}
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

      {/* Content Area */}
      {viewMode === 'table' ? (
        /* Virtual Scrolling Table */
        <div className={`aircraft-table-wrapper density-${density}`} ref={scrollContainerRef}>
          <table className={`aircraft-table al-table density-${density}`}>
            <thead>
              <tr>
                {visibleColumnHeaders.map(col => (
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
                  <tbody>
                    {renderTableRow(ac, index)}
                  </tbody>
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
                <AircraftCard
                  key={ac.hex}
                  aircraft={ac}
                  onSelect={onSelectAircraft}
                />
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
          <span className="legend-item climbing"><ArrowUp size={12} /> Climbing</span>
          <span className="legend-item descending"><ArrowDown size={12} /> Descending</span>
        </div>
      </div>
    </div>
  );
}
