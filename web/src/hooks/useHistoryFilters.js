import { useState, useMemo, useCallback, useEffect } from 'react';
import { AIRCRAFT_TYPE_CATEGORIES } from '../components/history/historyConstants';

const DEFAULT_FILTERS = {
  search: '',
  types: [],
  categories: [],
  airlines: [],
  distanceRange: [0, 300],
  altitudeRange: [0, 45000],
  durationRange: [0, 240], // 0-4 hours in minutes
  signalRange: [-30, 0], // RSSI in dB
  militaryOnly: false,
  safetyOnly: false,
  hasCallsign: false,
  emergencyOnly: false,
};

// Common airline prefixes for filtering
export const AIRLINE_PREFIXES = {
  UAL: 'United Airlines',
  DAL: 'Delta Air Lines',
  AAL: 'American Airlines',
  SWA: 'Southwest Airlines',
  JBU: 'JetBlue Airways',
  ASA: 'Alaska Airlines',
  FFT: 'Frontier Airlines',
  NKS: 'Spirit Airlines',
  SKW: 'SkyWest Airlines',
  RPA: 'Republic Airways',
  ENY: 'Envoy Air',
  PDT: 'Piedmont Airlines',
  QXE: 'Horizon Air',
  FDX: 'FedEx Express',
  UPS: 'UPS Airlines',
  GTI: 'Atlas Air',
  BAW: 'British Airways',
  AFR: 'Air France',
  DLH: 'Lufthansa',
  UAE: 'Emirates',
  QTR: 'Qatar Airways',
  SIA: 'Singapore Airlines',
  CPA: 'Cathay Pacific',
  ANA: 'All Nippon Airways',
  JAL: 'Japan Airlines',
  KAL: 'Korean Air',
  ACA: 'Air Canada',
  WJA: 'WestJet',
};

// Emergency squawk codes
const EMERGENCY_SQUAWKS = ['7500', '7600', '7700'];

/**
 * useHistoryFilters - Hook to manage history filter state with URL sync
 */
export function useHistoryFilters({ hashParams, setHashParams, initialFilters = {} } = {}) {
  const [filters, setFilters] = useState(() => ({
    ...DEFAULT_FILTERS,
    ...initialFilters,
  }));

  // Sync filters from URL hash params
  useEffect(() => {
    if (hashParams) {
      const newFilters = { ...DEFAULT_FILTERS };

      if (hashParams.search) {
        newFilters.search = hashParams.search;
      }
      if (hashParams.types) {
        newFilters.types = hashParams.types.split(',');
      }
      if (hashParams.categories) {
        newFilters.categories = hashParams.categories.split(',');
      }
      if (hashParams.airlines) {
        newFilters.airlines = hashParams.airlines.split(',');
      }
      if (hashParams.distMin || hashParams.distMax) {
        newFilters.distanceRange = [
          parseInt(hashParams.distMin) || 0,
          parseInt(hashParams.distMax) || 300,
        ];
      }
      if (hashParams.altMin || hashParams.altMax) {
        newFilters.altitudeRange = [
          parseInt(hashParams.altMin) || 0,
          parseInt(hashParams.altMax) || 45000,
        ];
      }
      if (hashParams.durMin || hashParams.durMax) {
        newFilters.durationRange = [
          parseInt(hashParams.durMin) || 0,
          parseInt(hashParams.durMax) || 240,
        ];
      }
      if (hashParams.sigMin || hashParams.sigMax) {
        newFilters.signalRange = [
          parseInt(hashParams.sigMin) || -30,
          parseInt(hashParams.sigMax) || 0,
        ];
      }
      if (hashParams.military === 'true') {
        newFilters.militaryOnly = true;
      }
      if (hashParams.safety === 'true') {
        newFilters.safetyOnly = true;
      }
      if (hashParams.callsign === 'true') {
        newFilters.hasCallsign = true;
      }
      if (hashParams.emergency === 'true') {
        newFilters.emergencyOnly = true;
      }

      setFilters(newFilters);
    }
  }, [hashParams]);

  // Update URL when filters change
  const updateFilters = useCallback(
    (newFilters) => {
      setFilters(newFilters);

      if (setHashParams) {
        const params = {};

        if (newFilters.search) {
          params.search = newFilters.search;
        }
        if (newFilters.types?.length > 0) {
          params.types = newFilters.types.join(',');
        }
        if (newFilters.categories?.length > 0) {
          params.categories = newFilters.categories.join(',');
        }
        if (newFilters.airlines?.length > 0) {
          params.airlines = newFilters.airlines.join(',');
        }
        if (
          newFilters.distanceRange &&
          (newFilters.distanceRange[0] > 0 || newFilters.distanceRange[1] < 300)
        ) {
          params.distMin = newFilters.distanceRange[0];
          params.distMax = newFilters.distanceRange[1];
        }
        if (
          newFilters.altitudeRange &&
          (newFilters.altitudeRange[0] > 0 || newFilters.altitudeRange[1] < 45000)
        ) {
          params.altMin = newFilters.altitudeRange[0];
          params.altMax = newFilters.altitudeRange[1];
        }
        if (
          newFilters.durationRange &&
          (newFilters.durationRange[0] > 0 || newFilters.durationRange[1] < 240)
        ) {
          params.durMin = newFilters.durationRange[0];
          params.durMax = newFilters.durationRange[1];
        }
        if (
          newFilters.signalRange &&
          (newFilters.signalRange[0] > -30 || newFilters.signalRange[1] < 0)
        ) {
          params.sigMin = newFilters.signalRange[0];
          params.sigMax = newFilters.signalRange[1];
        }
        if (newFilters.militaryOnly) {
          params.military = 'true';
        }
        if (newFilters.safetyOnly) {
          params.safety = 'true';
        }
        if (newFilters.hasCallsign) {
          params.callsign = 'true';
        }
        if (newFilters.emergencyOnly) {
          params.emergency = 'true';
        }

        setHashParams((prev) => ({ ...prev, ...params }));
      }
    },
    [setHashParams]
  );

  const resetFilters = useCallback(() => {
    updateFilters(DEFAULT_FILTERS);
  }, [updateFilters]);

  // Filter sessions based on current filters
  const filterSessions = useCallback(
    (sessions) => {
      if (!sessions || !sessions.length) return [];

      return sessions.filter((session) => {
        // Search filter (callsign, ICAO, type)
        if (filters.search) {
          const searchLower = filters.search.toLowerCase();
          const matchesSearch =
            session.callsign?.toLowerCase().includes(searchLower) ||
            session.icao_hex?.toLowerCase().includes(searchLower) ||
            session.type?.toLowerCase().includes(searchLower) ||
            session.tail_number?.toLowerCase().includes(searchLower);
          if (!matchesSearch) return false;
        }

        // Type filter
        if (filters.types?.length > 0) {
          if (!filters.types.includes(session.type)) return false;
        }

        // Category filter
        if (filters.categories?.length > 0) {
          const category = getSessionCategory(session);
          if (!filters.categories.includes(category)) return false;
        }

        // Airline filter (match callsign prefix)
        if (filters.airlines?.length > 0) {
          const callsign = session.callsign || '';
          const matchesAirline = filters.airlines.some((prefix) =>
            callsign.toUpperCase().startsWith(prefix)
          );
          if (!matchesAirline) return false;
        }

        // Distance range filter
        if (filters.distanceRange) {
          const dist = session.min_distance_nm || 0;
          if (dist < filters.distanceRange[0] || dist > filters.distanceRange[1]) return false;
        }

        // Altitude range filter
        if (filters.altitudeRange) {
          const alt = session.max_alt || 0;
          if (alt < filters.altitudeRange[0] || alt > filters.altitudeRange[1]) return false;
        }

        // Duration range filter
        if (filters.durationRange) {
          const dur = session.duration_min || 0;
          if (dur < filters.durationRange[0] || dur > filters.durationRange[1]) return false;
        }

        // Signal strength range filter
        if (filters.signalRange) {
          const signal = session.max_rssi;
          if (
            signal != null &&
            (signal < filters.signalRange[0] || signal > filters.signalRange[1])
          ) {
            return false;
          }
        }

        // Military only filter
        if (filters.militaryOnly && !session.is_military) return false;

        // Safety only filter
        if (filters.safetyOnly && !session.safety_event_count) return false;

        // Has callsign filter
        if (filters.hasCallsign && !session.callsign) return false;

        // Emergency squawk filter
        if (filters.emergencyOnly) {
          const squawk = session.squawk?.toString();
          if (!squawk || !EMERGENCY_SQUAWKS.includes(squawk)) return false;
        }

        return true;
      });
    },
    [filters]
  );

  // Filter sightings based on current filters
  const filterSightings = useCallback(
    (sightings) => {
      if (!sightings || !sightings.length) return [];

      return sightings.filter((sighting) => {
        // Search filter
        if (filters.search) {
          const searchLower = filters.search.toLowerCase();
          const matchesSearch =
            sighting.callsign?.toLowerCase().includes(searchLower) ||
            sighting.icao_hex?.toLowerCase().includes(searchLower);
          if (!matchesSearch) return false;
        }

        // Distance range filter
        if (filters.distanceRange) {
          const dist = sighting.distance_nm || 0;
          if (dist < filters.distanceRange[0] || dist > filters.distanceRange[1]) return false;
        }

        // Altitude range filter
        if (filters.altitudeRange) {
          const alt = sighting.altitude || 0;
          if (alt < filters.altitudeRange[0] || alt > filters.altitudeRange[1]) return false;
        }

        return true;
      });
    },
    [filters]
  );

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return (
      filters.search ||
      filters.types?.length > 0 ||
      filters.categories?.length > 0 ||
      filters.airlines?.length > 0 ||
      (filters.distanceRange && (filters.distanceRange[0] > 0 || filters.distanceRange[1] < 300)) ||
      (filters.altitudeRange &&
        (filters.altitudeRange[0] > 0 || filters.altitudeRange[1] < 45000)) ||
      (filters.durationRange && (filters.durationRange[0] > 0 || filters.durationRange[1] < 240)) ||
      (filters.signalRange && (filters.signalRange[0] > -30 || filters.signalRange[1] < 0)) ||
      filters.militaryOnly ||
      filters.safetyOnly ||
      filters.hasCallsign ||
      filters.emergencyOnly
    );
  }, [filters]);

  return {
    filters,
    setFilters: updateFilters,
    resetFilters,
    filterSessions,
    filterSightings,
    hasActiveFilters,
  };
}

/**
 * Helper to get category for a session
 */
function getSessionCategory(session) {
  if (session.is_military) return 'military';
  if (session.type && AIRCRAFT_TYPE_CATEGORIES.helicopter?.includes(session.type)) {
    return 'helicopter';
  }
  if (session.type && AIRCRAFT_TYPE_CATEGORIES.heavy?.includes(session.type)) {
    return 'heavy';
  }
  if (session.type && AIRCRAFT_TYPE_CATEGORIES.medium?.includes(session.type)) {
    return 'medium';
  }
  if (session.type && AIRCRAFT_TYPE_CATEGORIES.light?.includes(session.type)) {
    return 'light';
  }
  return 'other';
}

export default useHistoryFilters;
