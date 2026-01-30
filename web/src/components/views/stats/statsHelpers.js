/**
 * Stats Helper Functions
 * Data processing utilities for the StatsView components
 */

// ACARS label descriptions for display
export const ACARS_LABEL_DESCRIPTIONS = {
  '_d': 'Command',
  'H1': 'Departure',
  'H2': 'Arrival',
  '10': 'OUT Gate',
  '11': 'OFF Takeoff',
  '12': 'ON Landing',
  '13': 'IN Gate',
  '44': 'Position',
  '5Z': 'Airline Op',
  'AA': 'Free Text',
  'SA': 'System',
  'CA': 'CPDLC'
};

// Type to category mappings
export const TYPE_TO_CATEGORY = {
  'B737': 'Commercial', 'B738': 'Commercial', 'B739': 'Commercial', 'A319': 'Commercial',
  'A320': 'Commercial', 'A321': 'Commercial', 'E170': 'Regional', 'E175': 'Regional',
  'CRJ2': 'Regional', 'CRJ7': 'Regional', 'C172': 'GA', 'C182': 'GA', 'PA28': 'GA',
  'EC35': 'Helicopter', 'R44': 'Helicopter', 'B407': 'Helicopter'
};

// Type to manufacturer mappings
export const TYPE_TO_MANUFACTURER = {
  'B737': 'Boeing', 'B738': 'Boeing', 'B739': 'Boeing', 'B77W': 'Boeing',
  'A319': 'Airbus', 'A320': 'Airbus', 'A321': 'Airbus', 'A380': 'Airbus',
  'E170': 'Embraer', 'E175': 'Embraer', 'CRJ2': 'Bombardier', 'CRJ7': 'Bombardier',
  'C172': 'Cessna', 'C182': 'Cessna', 'PA28': 'Piper'
};

// Category colors for charts
export const CATEGORY_COLORS = {
  'Commercial': '#00c8ff',
  'Regional': '#a371f7',
  'GA': '#00ff88',
  'Helicopter': '#ff9f43',
  'Military': '#ff4757',
  'Other': '#6b7280'
};

// Safety event type labels
export const SAFETY_TYPE_LABELS = {
  tcas_ra: 'TCAS RA',
  tcas_ta: 'TCAS TA',
  extreme_vs: 'Extreme V/S',
  vs_reversal: 'VS Reversal',
  proximity_conflict: 'Proximity',
  squawk_emergency: 'Emergency',
  squawk_hijack: 'Hijack',
  squawk_radio_failure: 'Radio Fail'
};

// Safety event type colors
export const SAFETY_TYPE_COLORS = {
  tcas_ra: '#ff4757',
  tcas_ta: '#ff9f43',
  extreme_vs: '#f7d794',
  vs_reversal: '#f7d794',
  proximity_conflict: '#a371f7',
  squawk_emergency: '#ff4757',
  squawk_hijack: '#ff4757',
  squawk_radio_failure: '#ff9f43'
};

// Time range to hours conversion
export const TIME_RANGE_HOURS = {
  '1h': 1,
  '6h': 6,
  '24h': 24,
  '48h': 48,
  '7d': 168
};

/**
 * Build filter query params from filter state
 */
export function buildFilterParams(filters) {
  const {
    hours,
    showMilitaryOnly,
    categoryFilter,
    minAltitude,
    maxAltitude,
    minDistance,
    maxDistance,
    aircraftType
  } = filters;

  const params = new URLSearchParams();
  params.append('hours', hours);
  if (showMilitaryOnly) params.append('military_only', 'true');
  if (categoryFilter) params.append('category', categoryFilter);
  if (minAltitude) params.append('min_altitude', minAltitude);
  if (maxAltitude) params.append('max_altitude', maxAltitude);
  if (minDistance) params.append('min_distance', minDistance);
  if (maxDistance) params.append('max_distance', maxDistance);
  if (aircraftType) params.append('aircraft_type', aircraftType);
  return params.toString();
}

/**
 * Compute real-time stats from pushed aircraft array (client-side)
 */
export function computeStatsFromAircraft(wsAircraft, wsStats) {
  if (!wsAircraft?.length) return null;

  const altDist = { ground: 0, low: 0, medium: 0, high: 0 };
  let withPosition = 0;
  let military = 0;
  const emergencySquawks = [];

  wsAircraft.forEach(ac => {
    // Count aircraft with position
    if (ac.lat != null && ac.lon != null) withPosition++;

    // Count military
    if (ac.military) military++;

    // Emergency squawks
    if (ac.squawk && ['7500', '7600', '7700'].includes(ac.squawk)) {
      emergencySquawks.push({ hex: ac.hex, squawk: ac.squawk, flight: ac.flight });
    }

    // Altitude distribution
    const alt = ac.alt || ac.altitude || 0;
    if (ac.on_ground || alt <= 0) {
      altDist.ground++;
    } else if (alt < 10000) {
      altDist.low++;
    } else if (alt < 30000) {
      altDist.medium++;
    } else {
      altDist.high++;
    }
  });

  return {
    total: wsAircraft.length,
    with_position: withPosition,
    military,
    emergency_squawks: emergencySquawks,
    altitude: altDist,
    messages: wsStats?.count || 0
  };
}

/**
 * Compute top aircraft from pushed aircraft data
 */
export function computeTopAircraft(wsAircraft) {
  if (!wsAircraft?.length) return null;

  const withDistance = wsAircraft.filter(ac => ac.distance_nm != null);
  const withSpeed = wsAircraft.filter(ac => ac.gs != null);
  const withAlt = wsAircraft.filter(ac => ac.alt != null);

  return {
    closest: [...withDistance].sort((a, b) => a.distance_nm - b.distance_nm).slice(0, 5),
    fastest: [...withSpeed].sort((a, b) => b.gs - a.gs).slice(0, 5),
    highest: [...withAlt].sort((a, b) => b.alt - a.alt).slice(0, 5)
  };
}

/**
 * Compute altitude distribution data for charts
 */
export function computeAltitudeData(stats) {
  const dist = stats?.altitude || stats?.altitude_distribution;
  if (!dist) return [];
  const total = Object.values(dist).reduce((a, b) => a + (b || 0), 0) || 1;
  return [
    { label: 'Ground', count: dist.ground || 0, pct: ((dist.ground || 0) / total) * 100, color: '#6b7280' },
    { label: '< 10k ft', count: dist.low || 0, pct: ((dist.low || 0) / total) * 100, color: '#00ff88' },
    { label: '10-30k ft', count: dist.medium || 0, pct: ((dist.medium || 0) / total) * 100, color: '#00c8ff' },
    { label: '> 30k ft', count: dist.high || 0, pct: ((dist.high || 0) / total) * 100, color: '#a371f7' }
  ];
}

/**
 * Compute fleet breakdown from sessions data
 */
export function computeFleetBreakdown(sessionsData, showMilitaryOnly) {
  let sessions = sessionsData?.sessions;
  if (!sessions?.length) return null;

  if (showMilitaryOnly) {
    sessions = sessions.filter(s => s.is_military);
  }

  const seenHex = new Set();
  const categoryCount = {};
  const manufacturerCount = {};
  const typeCount = {};

  sessions.forEach(session => {
    const hex = session.icao_hex;
    if (!hex || seenHex.has(hex)) return;
    seenHex.add(hex);

    const type = session.type?.toUpperCase();
    if (type) {
      typeCount[type] = (typeCount[type] || 0) + 1;

      const category = session.is_military ? 'Military' : (TYPE_TO_CATEGORY[type] || 'Other');
      categoryCount[category] = (categoryCount[category] || 0) + 1;

      const manufacturer = TYPE_TO_MANUFACTURER[type] || 'Other';
      manufacturerCount[manufacturer] = (manufacturerCount[manufacturer] || 0) + 1;
    }
  });

  const total = Object.values(typeCount).reduce((a, b) => a + b, 0) || 1;

  return {
    categories: Object.entries(categoryCount)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({
        name, count, pct: (count / total) * 100,
        color: CATEGORY_COLORS[name] || '#6b7280'
      })),
    manufacturers: Object.entries(manufacturerCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count]) => ({ name, count, pct: (count / total) * 100 })),
    types: Object.entries(typeCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([type, count]) => ({ type, count, pct: (count / total) * 100 })),
    total: seenHex.size
  };
}

/**
 * Compute safety events by type for bar chart
 */
export function computeSafetyEventsByType(safetyStats) {
  if (!safetyStats?.events_by_type) return [];

  return Object.entries(safetyStats.events_by_type)
    .map(([type, count]) => ({
      label: SAFETY_TYPE_LABELS[type] || type,
      count,
      color: SAFETY_TYPE_COLORS[type] || '#00c8ff'
    }))
    .sort((a, b) => b.count - a.count);
}
