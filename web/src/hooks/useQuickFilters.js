import { useState, useMemo, useCallback } from 'react';
import {
  Shield,
  AlertTriangle,
  Plane,
  ArrowDown,
  Star,
  CircleDot,
  Zap,
  Layers,
} from 'lucide-react';

/**
 * Quick Filter Preset Definitions for Pro Mode
 *
 * Each filter defines:
 * - id: Unique identifier
 * - label: Display name
 * - icon: Lucide icon component
 * - color: CSS color class/variable
 * - match: Function that returns true if aircraft matches filter
 * - description: Tooltip text
 */
export const QUICK_FILTER_PRESETS = [
  {
    id: 'all',
    label: 'All',
    icon: Layers,
    color: 'default',
    match: () => true,
    description: 'Show all aircraft (clear filters)',
  },
  {
    id: 'military',
    label: 'Military',
    icon: Shield,
    color: 'purple',
    match: (ac) => ac.military === true,
    description: 'Show only military aircraft',
  },
  {
    id: 'emergency',
    label: 'Emergency',
    icon: AlertTriangle,
    color: 'red',
    match: (ac) => {
      const squawk = ac.squawk;
      return squawk === '7500' || squawk === '7600' || squawk === '7700';
    },
    description: 'Show only squawking 7500/7600/7700',
  },
  {
    id: 'heavy',
    label: 'Heavy/Super',
    icon: Plane,
    color: 'orange',
    match: (ac) => {
      // Wake turbulence category H (Heavy) or J (Super)
      const wakeCategory = ac.wake_category?.toUpperCase() || ac.wtc?.toUpperCase();
      if (wakeCategory === 'H' || wakeCategory === 'J') return true;
      // Also check category for A5 (Heavy)
      const category = ac.category?.toUpperCase();
      return category === 'A5';
    },
    description: 'Show only wake category H (Heavy) or J (Super)',
  },
  {
    id: 'lowAltitude',
    label: 'Low Alt',
    icon: ArrowDown,
    color: 'teal',
    match: (ac) => {
      const alt = typeof ac.alt === 'number' ? ac.alt : parseFloat(ac.alt_baro);
      return !isNaN(alt) && alt < 10000 && alt > 0;
    },
    description: 'Show only aircraft below 10,000 ft',
  },
  {
    id: 'interesting',
    label: 'Interesting',
    icon: Star,
    color: 'yellow',
    match: (ac) => {
      // Military, government, or law enforcement
      if (ac.military) return true;
      // Check for government/law enforcement indicators
      const flight = (ac.flight || '').toUpperCase().trim();
      const operator = (ac.operator || '').toLowerCase();
      // Common government/LE prefixes
      const govPrefixes = ['EXEC', 'SAM', 'AF1', 'AF2', 'DUKE', 'REACH', 'GOTO', 'SPAR'];
      const lePrefixes = ['N1', 'N2', 'CBP', 'ICE', 'FBI', 'DEA', 'ATF', 'DHS', 'USCG'];
      if (govPrefixes.some((p) => flight.startsWith(p))) return true;
      if (lePrefixes.some((p) => flight.startsWith(p))) return true;
      if (
        operator.includes('government') ||
        operator.includes('police') ||
        operator.includes('sheriff')
      )
        return true;
      // Check special registration patterns
      const registration = (ac.registration || ac.r || '').toUpperCase();
      // US government registrations often start with certain patterns
      if (registration.match(/^N[0-9]{1,2}$/)) return true;
      return false;
    },
    description: 'Show Military + Government + Law Enforcement',
  },
  {
    id: 'helicopters',
    label: 'Helicopters',
    icon: CircleDot,
    color: 'cyan',
    match: (ac) => {
      // Category A7 is rotorcraft
      const category = ac.category?.toUpperCase();
      return category === 'A7';
    },
    description: 'Show only rotorcraft (category A7)',
  },
  {
    id: 'jets',
    label: 'Jets Only',
    icon: Zap,
    color: 'blue',
    match: (ac) => {
      // Filter to only show jet aircraft
      // A3 = Large, A4 = High Vortex Large (757), A5 = Heavy, A6 = High Performance
      const category = ac.category?.toUpperCase();
      const jetCategories = ['A3', 'A4', 'A5', 'A6'];
      if (jetCategories.includes(category)) return true;
      // Also check type - jets typically have J in the engine type
      const type = (ac.type || ac.t || '').toUpperCase();
      // Check for common jet type codes
      if (
        type.match(
          /^(A3[0-9]{2}|A220|B7[0-9]{2}|B73|B74|B75|B76|B77|B78|B78X|E[0-9]{3}|CRJ|ERJ|C[0-9]{3}|G[0-9]{3}|GL)/
        )
      )
        return true;
      return false;
    },
    description: 'Show jets only (filter out props/turboprops)',
  },
];

/**
 * Hook for managing quick filter state in Pro Mode
 *
 * @param {Object} options
 * @param {Function} options.onFilterChange - Callback when active filter changes
 * @returns {Object} Filter state and controls
 */
export function useQuickFilters({ onFilterChange } = {}) {
  // Track which filters are active (multiple can be active for additive filtering)
  const [activeFilters, setActiveFilters] = useState(new Set(['all']));
  // Track visibility of the filter bar
  const [showFilterBar, setShowFilterBar] = useState(() => {
    try {
      const saved = localStorage.getItem('adsb-pro-show-quick-filters');
      return saved !== null ? saved === 'true' : false;
    } catch {
      return false;
    }
  });

  // Toggle a filter on/off
  const toggleFilter = useCallback(
    (filterId) => {
      setActiveFilters((prev) => {
        const next = new Set(prev);

        if (filterId === 'all') {
          // Clicking 'all' clears other filters
          next.clear();
          next.add('all');
        } else {
          // Remove 'all' when selecting a specific filter
          next.delete('all');

          if (next.has(filterId)) {
            next.delete(filterId);
            // If no filters left, default to 'all'
            if (next.size === 0) {
              next.add('all');
            }
          } else {
            next.add(filterId);
          }
        }

        // Notify parent of change
        onFilterChange?.(Array.from(next));
        return next;
      });
    },
    [onFilterChange]
  );

  // Clear all filters (same as selecting 'all')
  const clearFilters = useCallback(() => {
    setActiveFilters(new Set(['all']));
    onFilterChange?.(['all']);
  }, [onFilterChange]);

  // Toggle filter bar visibility
  const toggleFilterBar = useCallback(() => {
    setShowFilterBar((prev) => {
      const newValue = !prev;
      try {
        localStorage.setItem('adsb-pro-show-quick-filters', String(newValue));
      } catch {
        // Ignore storage errors
      }
      return newValue;
    });
  }, []);

  // Filter function to apply to aircraft array
  const filterAircraft = useCallback(
    (aircraft) => {
      // If 'all' is active, return all aircraft
      if (activeFilters.has('all') || activeFilters.size === 0) {
        return aircraft;
      }

      // Get the match functions for all active filters
      const activePresets = QUICK_FILTER_PRESETS.filter(
        (p) => p.id !== 'all' && activeFilters.has(p.id)
      );

      // Return aircraft that match ANY of the active filters (OR logic)
      return aircraft.filter((ac) => activePresets.some((preset) => preset.match(ac)));
    },
    [activeFilters]
  );

  // Compute counts for each filter
  const computeFilterCounts = useCallback((aircraft) => {
    const counts = {};
    QUICK_FILTER_PRESETS.forEach((preset) => {
      if (preset.id === 'all') {
        counts.all = aircraft.length;
      } else {
        counts[preset.id] = aircraft.filter((ac) => preset.match(ac)).length;
      }
    });
    return counts;
  }, []);

  // Memoized list of active filter IDs
  const activeFilterIds = useMemo(() => Array.from(activeFilters), [activeFilters]);

  // Check if any non-'all' filter is active
  const hasActiveFilters = useMemo(
    () => activeFilters.size > 0 && !activeFilters.has('all'),
    [activeFilters]
  );

  return {
    // State
    activeFilters: activeFilterIds,
    showFilterBar,
    hasActiveFilters,
    presets: QUICK_FILTER_PRESETS,

    // Actions
    toggleFilter,
    clearFilters,
    toggleFilterBar,
    filterAircraft,
    computeFilterCounts,

    // Helpers
    isFilterActive: (id) => activeFilters.has(id),
  };
}

export default useQuickFilters;
