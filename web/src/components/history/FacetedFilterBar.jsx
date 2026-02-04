import { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { MultiSelectFacet } from '../common/MultiSelectFacet';
import { RangeSlider } from '../common/RangeSlider';
import { SavedViewsManager } from './SavedViewsManager';
import { AIRCRAFT_TYPE_CATEGORIES } from './historyConstants';
import { AIRLINE_PREFIXES } from '../../hooks/useHistoryFilters';

/**
 * FacetedFilterBar - Advanced filter bar with search, facets, and range sliders
 */
export function FacetedFilterBar({
  filters,
  onFiltersChange,
  sessions = [],
  showDistanceFilter = true,
  showAltitudeFilter = true,
  showDurationFilter = true,
  showSignalFilter = true,
  showAirlineFilter = true,
  showSavedViews = true,
  onSaveView,
  savedViews = [],
  onLoadView,
  onDeleteView,
  className = '',
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Calculate type options with counts from sessions
  const typeOptions = useMemo(() => {
    const typeCounts = {};
    sessions.forEach((s) => {
      const type = s.type || 'Unknown';
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    });

    // Map to options format
    return Object.entries(typeCounts)
      .map(([type, count]) => ({
        value: type,
        label: type,
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20); // Limit to top 20 types
  }, [sessions]);

  // Calculate category options
  const categoryOptions = useMemo(() => {
    const categoryCounts = { military: 0, helicopter: 0, heavy: 0, medium: 0, light: 0, other: 0 };

    sessions.forEach((s) => {
      if (s.is_military) {
        categoryCounts.military++;
      } else if (s.type && AIRCRAFT_TYPE_CATEGORIES.helicopter?.includes(s.type)) {
        categoryCounts.helicopter++;
      } else if (s.type && AIRCRAFT_TYPE_CATEGORIES.heavy?.includes(s.type)) {
        categoryCounts.heavy++;
      } else if (s.type && AIRCRAFT_TYPE_CATEGORIES.medium?.includes(s.type)) {
        categoryCounts.medium++;
      } else if (s.type && AIRCRAFT_TYPE_CATEGORIES.light?.includes(s.type)) {
        categoryCounts.light++;
      } else {
        categoryCounts.other++;
      }
    });

    return [
      {
        value: 'military',
        label: 'Military',
        count: categoryCounts.military,
        icon: '🎖️',
        color: 'var(--viz-military)',
      },
      { value: 'helicopter', label: 'Helicopter', count: categoryCounts.helicopter, icon: '🚁' },
      { value: 'heavy', label: 'Heavy', count: categoryCounts.heavy, icon: '✈️' },
      { value: 'medium', label: 'Medium', count: categoryCounts.medium },
      { value: 'light', label: 'Light', count: categoryCounts.light },
      { value: 'other', label: 'Other', count: categoryCounts.other },
    ].filter((opt) => opt.count > 0);
  }, [sessions]);

  // Distance histogram for slider
  const distanceHistogram = useMemo(() => {
    const buckets = new Array(20).fill(0);
    const maxDist = Math.max(...sessions.map((s) => s.min_distance_nm || 0), 1);

    sessions.forEach((s) => {
      const dist = s.min_distance_nm || 0;
      const bucket = Math.min(Math.floor((dist / maxDist) * 20), 19);
      buckets[bucket]++;
    });

    return buckets;
  }, [sessions]);

  // Altitude histogram
  const altitudeHistogram = useMemo(() => {
    const buckets = new Array(20).fill(0);
    const maxAlt = 45000; // Fixed max altitude

    sessions.forEach((s) => {
      const alt = s.max_alt || 0;
      const bucket = Math.min(Math.floor((alt / maxAlt) * 20), 19);
      buckets[bucket]++;
    });

    return buckets;
  }, [sessions]);

  // Duration histogram
  const durationHistogram = useMemo(() => {
    const buckets = new Array(20).fill(0);
    const maxDur = 240; // 4 hours max

    sessions.forEach((s) => {
      const dur = Math.min(s.duration_min || 0, maxDur);
      const bucket = Math.min(Math.floor((dur / maxDur) * 20), 19);
      buckets[bucket]++;
    });

    return buckets;
  }, [sessions]);

  // Signal histogram
  const signalHistogram = useMemo(() => {
    const buckets = new Array(20).fill(0);
    const minSig = -30;
    const maxSig = 0;
    const range = maxSig - minSig;

    sessions.forEach((s) => {
      const sig = s.max_rssi;
      if (sig != null) {
        const normalized = (sig - minSig) / range;
        const bucket = Math.min(Math.floor(normalized * 20), 19);
        buckets[bucket]++;
      }
    });

    return buckets;
  }, [sessions]);

  // Airline options with counts
  const airlineOptions = useMemo(() => {
    const airlineCounts = {};

    sessions.forEach((s) => {
      const callsign = s.callsign || '';
      // Extract 3-letter prefix from callsign
      const prefix = callsign.slice(0, 3).toUpperCase();
      if (prefix && AIRLINE_PREFIXES[prefix]) {
        airlineCounts[prefix] = (airlineCounts[prefix] || 0) + 1;
      }
    });

    return Object.entries(airlineCounts)
      .map(([prefix, count]) => ({
        value: prefix,
        label: `${prefix} - ${AIRLINE_PREFIXES[prefix]}`,
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);
  }, [sessions]);

  // Count sessions with callsigns
  const callsignCount = useMemo(() => {
    return sessions.filter((s) => s.callsign).length;
  }, [sessions]);

  // Count emergency squawks
  const emergencyCount = useMemo(() => {
    return sessions.filter((s) => {
      const squawk = s.squawk?.toString();
      return squawk === '7500' || squawk === '7600' || squawk === '7700';
    }).length;
  }, [sessions]);

  // Check if any filters are active
  const hasActiveFilters =
    filters.search ||
    filters.types?.length > 0 ||
    filters.categories?.length > 0 ||
    filters.airlines?.length > 0 ||
    (filters.distanceRange && (filters.distanceRange[0] > 0 || filters.distanceRange[1] < 300)) ||
    (filters.altitudeRange && (filters.altitudeRange[0] > 0 || filters.altitudeRange[1] < 45000)) ||
    (filters.durationRange && (filters.durationRange[0] > 0 || filters.durationRange[1] < 240)) ||
    (filters.signalRange && (filters.signalRange[0] > -30 || filters.signalRange[1] < 0)) ||
    filters.militaryOnly ||
    filters.safetyOnly ||
    filters.hasCallsign ||
    filters.emergencyOnly;

  // Count active advanced filters
  const advancedFilterCount = [
    filters.airlines?.length > 0,
    filters.durationRange && (filters.durationRange[0] > 0 || filters.durationRange[1] < 240),
    filters.signalRange && (filters.signalRange[0] > -30 || filters.signalRange[1] < 0),
    filters.hasCallsign,
    filters.emergencyOnly,
  ].filter(Boolean).length;

  const handleClearAll = () => {
    onFiltersChange?.({
      search: '',
      types: [],
      categories: [],
      airlines: [],
      distanceRange: [0, 300],
      altitudeRange: [0, 45000],
      durationRange: [0, 240],
      signalRange: [-30, 0],
      militaryOnly: false,
      safetyOnly: false,
      hasCallsign: false,
      emergencyOnly: false,
    });
  };

  return (
    <div className={`faceted-filter-bar ${className}`}>
      {/* Search input */}
      <div className="faceted-filter-bar__search">
        <svg
          className="faceted-filter-bar__search-icon"
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
        >
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" />
          <line
            x1="9.5"
            y1="9.5"
            x2="13"
            y2="13"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        <input
          type="text"
          className="faceted-filter-bar__search-input"
          placeholder="Search callsign, ICAO, type..."
          value={filters.search || ''}
          onChange={(e) => onFiltersChange?.({ ...filters, search: e.target.value })}
        />
      </div>

      <div className="faceted-filter-bar__divider" />

      {/* Facet filters */}
      <div className="faceted-filter-bar__facets">
        <MultiSelectFacet
          label="Category"
          options={categoryOptions}
          value={filters.categories || []}
          onChange={(categories) => onFiltersChange?.({ ...filters, categories })}
          placeholder="All"
          showCounts
        />

        <MultiSelectFacet
          label="Type"
          options={typeOptions}
          value={filters.types || []}
          onChange={(types) => onFiltersChange?.({ ...filters, types })}
          placeholder="All"
          showCounts
          showSearch
        />

        {/* Airline filter */}
        {showAirlineFilter && airlineOptions.length > 0 && (
          <MultiSelectFacet
            label="Airline"
            options={airlineOptions}
            value={filters.airlines || []}
            onChange={(airlines) => onFiltersChange?.({ ...filters, airlines })}
            placeholder="All"
            showCounts
            showSearch
          />
        )}

        {/* Quick toggle buttons */}
        <button
          className={`faceted-filter-bar__toggle ${filters.militaryOnly ? 'faceted-filter-bar__toggle--active' : ''}`}
          onClick={() => onFiltersChange?.({ ...filters, militaryOnly: !filters.militaryOnly })}
          style={{
            padding: '6px 10px',
            background: filters.militaryOnly ? 'rgba(168, 85, 247, 0.2)' : 'var(--bg-hover)',
            border: `1px solid ${filters.militaryOnly ? 'var(--viz-military)' : 'var(--border)'}`,
            borderRadius: '6px',
            fontSize: '11px',
            color: filters.militaryOnly ? 'var(--viz-military)' : 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          🎖️ Military
        </button>

        <button
          className={`faceted-filter-bar__toggle ${filters.safetyOnly ? 'faceted-filter-bar__toggle--active' : ''}`}
          onClick={() => onFiltersChange?.({ ...filters, safetyOnly: !filters.safetyOnly })}
          style={{
            padding: '6px 10px',
            background: filters.safetyOnly ? 'rgba(239, 68, 68, 0.2)' : 'var(--bg-hover)',
            border: `1px solid ${filters.safetyOnly ? 'var(--viz-safety-critical)' : 'var(--border)'}`,
            borderRadius: '6px',
            fontSize: '11px',
            color: filters.safetyOnly ? 'var(--viz-safety-critical)' : 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          ⚠️ Safety
        </button>

        <button
          className={`faceted-filter-bar__toggle ${filters.hasCallsign ? 'faceted-filter-bar__toggle--active' : ''}`}
          onClick={() => onFiltersChange?.({ ...filters, hasCallsign: !filters.hasCallsign })}
          title={`${callsignCount} sessions with callsigns`}
          style={{
            padding: '6px 10px',
            background: filters.hasCallsign ? 'rgba(0, 212, 255, 0.2)' : 'var(--bg-hover)',
            border: `1px solid ${filters.hasCallsign ? 'var(--accent-cyan)' : 'var(--border)'}`,
            borderRadius: '6px',
            fontSize: '11px',
            color: filters.hasCallsign ? 'var(--accent-cyan)' : 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          📡 Callsign
        </button>

        {emergencyCount > 0 && (
          <button
            className={`faceted-filter-bar__toggle ${filters.emergencyOnly ? 'faceted-filter-bar__toggle--active' : ''}`}
            onClick={() => onFiltersChange?.({ ...filters, emergencyOnly: !filters.emergencyOnly })}
            title={`${emergencyCount} sessions with emergency squawks`}
            style={{
              padding: '6px 10px',
              background: filters.emergencyOnly ? 'rgba(239, 68, 68, 0.3)' : 'var(--bg-hover)',
              border: `1px solid ${filters.emergencyOnly ? '#ef4444' : 'var(--border)'}`,
              borderRadius: '6px',
              fontSize: '11px',
              color: filters.emergencyOnly ? '#ef4444' : 'var(--text-secondary)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              fontWeight: filters.emergencyOnly ? 600 : 400,
            }}
          >
            🚨 Emergency ({emergencyCount})
          </button>
        )}

        {/* Advanced filters toggle */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={{
            padding: '6px 10px',
            background:
              showAdvanced || advancedFilterCount > 0
                ? 'rgba(0, 212, 255, 0.1)'
                : 'var(--bg-hover)',
            border: `1px solid ${showAdvanced || advancedFilterCount > 0 ? 'var(--accent-cyan)' : 'var(--border)'}`,
            borderRadius: '6px',
            fontSize: '11px',
            color:
              showAdvanced || advancedFilterCount > 0
                ? 'var(--accent-cyan)'
                : 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <span>⚙️ More</span>
          {advancedFilterCount > 0 && (
            <span
              style={{
                background: 'var(--accent-cyan)',
                color: 'var(--bg-dark)',
                padding: '1px 5px',
                borderRadius: '10px',
                fontSize: '10px',
                fontWeight: 600,
              }}
            >
              {advancedFilterCount}
            </span>
          )}
          <svg
            width="10"
            height="6"
            viewBox="0 0 10 6"
            fill="none"
            style={{
              transform: showAdvanced ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease',
            }}
          >
            <path
              d="M1 1L5 5L9 1"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      <div className="faceted-filter-bar__divider" />

      {/* Range sliders */}
      <div className="faceted-filter-bar__sliders">
        {showDistanceFilter && (
          <div className="faceted-filter-bar__slider-wrapper">
            <RangeSlider
              min={0}
              max={300}
              step={5}
              value={filters.distanceRange || [0, 300]}
              onChange={(distanceRange) => onFiltersChange?.({ ...filters, distanceRange })}
              label="Distance"
              unit="nm"
              showHistogram
              histogramData={distanceHistogram}
            />
          </div>
        )}

        {showAltitudeFilter && (
          <div className="faceted-filter-bar__slider-wrapper">
            <RangeSlider
              min={0}
              max={45000}
              step={1000}
              value={filters.altitudeRange || [0, 45000]}
              onChange={(altitudeRange) => onFiltersChange?.({ ...filters, altitudeRange })}
              label="Altitude"
              unit="ft"
              formatValue={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)}
              showHistogram
              histogramData={altitudeHistogram}
            />
          </div>
        )}
      </div>

      {/* Advanced filters section (collapsible) */}
      {showAdvanced && (
        <div className="faceted-filter-bar__advanced">
          <div className="faceted-filter-bar__divider" />
          <div className="faceted-filter-bar__sliders">
            {showDurationFilter && (
              <div className="faceted-filter-bar__slider-wrapper">
                <RangeSlider
                  min={0}
                  max={240}
                  step={5}
                  value={filters.durationRange || [0, 240]}
                  onChange={(durationRange) => onFiltersChange?.({ ...filters, durationRange })}
                  label="Duration"
                  unit="min"
                  formatValue={(v) => (v >= 60 ? `${(v / 60).toFixed(1)}h` : `${v}m`)}
                  showHistogram
                  histogramData={durationHistogram}
                />
              </div>
            )}

            {showSignalFilter && (
              <div className="faceted-filter-bar__slider-wrapper">
                <RangeSlider
                  min={-30}
                  max={0}
                  step={1}
                  value={filters.signalRange || [-30, 0]}
                  onChange={(signalRange) => onFiltersChange?.({ ...filters, signalRange })}
                  label="Signal"
                  unit="dB"
                  color="var(--accent-green)"
                  showHistogram
                  histogramData={signalHistogram}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Saved views */}
      {showSavedViews && (
        <div className="faceted-filter-bar__saved-views">
          <SavedViewsManager
            savedViews={savedViews}
            currentFilters={filters}
            onSave={onSaveView}
            onLoad={onLoadView}
            onDelete={onDeleteView}
          />
        </div>
      )}

      {/* Clear all */}
      {hasActiveFilters && (
        <button className="faceted-filter-bar__clear" onClick={handleClearAll}>
          Clear all
        </button>
      )}
    </div>
  );
}

FacetedFilterBar.propTypes = {
  filters: PropTypes.shape({
    search: PropTypes.string,
    types: PropTypes.arrayOf(PropTypes.string),
    categories: PropTypes.arrayOf(PropTypes.string),
    airlines: PropTypes.arrayOf(PropTypes.string),
    distanceRange: PropTypes.arrayOf(PropTypes.number),
    altitudeRange: PropTypes.arrayOf(PropTypes.number),
    durationRange: PropTypes.arrayOf(PropTypes.number),
    signalRange: PropTypes.arrayOf(PropTypes.number),
    militaryOnly: PropTypes.bool,
    safetyOnly: PropTypes.bool,
    hasCallsign: PropTypes.bool,
    emergencyOnly: PropTypes.bool,
  }),
  onFiltersChange: PropTypes.func,
  sessions: PropTypes.array,
  showDistanceFilter: PropTypes.bool,
  showAltitudeFilter: PropTypes.bool,
  showDurationFilter: PropTypes.bool,
  showSignalFilter: PropTypes.bool,
  showAirlineFilter: PropTypes.bool,
  showSavedViews: PropTypes.bool,
  onSaveView: PropTypes.func,
  savedViews: PropTypes.array,
  onLoadView: PropTypes.func,
  onDeleteView: PropTypes.func,
  className: PropTypes.string,
};

export default FacetedFilterBar;
