// Valid data types for the history view
export const VALID_DATA_TYPES = ['sessions', 'sightings', 'acars', 'safety'];

// Time range options with their hour values
export const TIME_RANGES = ['1h', '6h', '24h', '48h', '7d'];
export const TIME_RANGE_HOURS = { '1h': 1, '6h': 6, '24h': 24, '48h': 48, '7d': 168 };

// Session sort configuration (8 fields)
export const SESSION_SORT_CONFIG = {
  last_seen: { type: 'date', defaultDirection: 'desc' },
  callsign: { type: 'string', defaultDirection: 'asc' },
  type: { type: 'string', defaultDirection: 'asc' },
  duration_min: { type: 'number', defaultDirection: 'desc' },
  min_distance_nm: { type: 'number', defaultDirection: 'asc' },
  max_rssi: { type: 'number', defaultDirection: 'desc' },
  max_alt: { type: 'number', defaultDirection: 'desc' },
  safety_event_count: { type: 'number', defaultDirection: 'desc' }
};

export const SESSION_SORT_FIELDS = [
  { key: 'last_seen', label: 'Time' },
  { key: 'callsign', label: 'Callsign' },
  { key: 'type', label: 'Type' },
  { key: 'duration_min', label: 'Duration' },
  { key: 'min_distance_nm', label: 'Distance' },
  { key: 'max_rssi', label: 'Signal' },
  { key: 'max_alt', label: 'Altitude' },
  { key: 'safety_event_count', label: 'Safety' }
];

// Sightings sort configuration (7 fields)
export const SIGHTINGS_SORT_CONFIG = {
  timestamp: { type: 'date', defaultDirection: 'desc' },
  icao_hex: { type: 'string', defaultDirection: 'asc' },
  callsign: { type: 'string', defaultDirection: 'asc' },
  altitude: { type: 'number', defaultDirection: 'desc' },
  gs: { type: 'number', defaultDirection: 'desc' },
  distance_nm: { type: 'number', defaultDirection: 'asc' },
  rssi: { type: 'number', defaultDirection: 'desc' }
};

export const SIGHTINGS_COLUMNS = [
  { key: 'timestamp', label: 'Time' },
  { key: 'icao_hex', label: 'ICAO' },
  { key: 'callsign', label: 'Callsign' },
  { key: 'altitude', label: 'Altitude', align: 'right' },
  { key: 'gs', label: 'Speed', align: 'right' },
  { key: 'distance_nm', label: 'Distance', align: 'right' },
  { key: 'rssi', label: 'Signal', align: 'right' }
];

// Safety Events sort configuration
export const SAFETY_SORT_CONFIG = {
  severity: {
    type: 'custom',
    defaultDirection: 'desc',
    comparator: (a, b) => {
      const severityOrder = { critical: 3, warning: 2, info: 1 };
      const aVal = severityOrder[a] || 0;
      const bVal = severityOrder[b] || 0;
      return aVal - bVal;
    }
  },
  timestamp: { type: 'date', defaultDirection: 'desc' },
  'details.horizontal_nm': { type: 'number', defaultDirection: 'asc', path: 'details.horizontal_nm' },
  'details.vertical_ft': { type: 'number', defaultDirection: 'asc', path: 'details.vertical_ft' },
  event_type: { type: 'string', defaultDirection: 'asc' }
};

export const SAFETY_SORT_FIELDS = [
  { key: 'severity', label: 'Severity' },
  { key: 'timestamp', label: 'Time' },
  { key: 'details.horizontal_nm', label: 'Horiz Distance' },
  { key: 'details.vertical_ft', label: 'Vert Distance' },
  { key: 'event_type', label: 'Type' }
];

// ACARS sort configuration
export const ACARS_SORT_CONFIG = {
  timestamp: { type: 'date', defaultDirection: 'desc' },
  callsign: { type: 'string', defaultDirection: 'asc' },
  label: { type: 'string', defaultDirection: 'asc' },
  source: { type: 'string', defaultDirection: 'asc' }
};

export const ACARS_SORT_FIELDS = [
  { key: 'timestamp', label: 'Time' },
  { key: 'callsign', label: 'Callsign' },
  { key: 'label', label: 'Label' },
  { key: 'source', label: 'Source' }
];

// ACARS quick filter categories with their associated labels
export const ACARS_QUICK_FILTER_CATEGORIES = {
  position: { name: 'Position', labels: ['C1', 'SQ', '47', '2Z', 'AD', 'AE'] },
  weather: { name: 'Weather', labels: ['15', '30', '31', '32', '33', '34', '35', '36', '37', '38', '39', '44', '80', '81', '83', '3M', '3S'] },
  oooi: { name: 'OOOI', labels: ['10', '11', '12', '13', '14', '16', '17'] },
  operational: { name: 'Operational', labels: ['H1', 'H2', '5Z', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', 'B1', 'B2', 'B9'] },
  freetext: { name: 'Free Text', labels: ['AA', 'AB', 'FA', 'FF', 'F3', 'F5', 'F7'] },
  maintenance: { name: 'Maintenance', labels: ['50', '51', '52', '53', '54', '55', '56', '57', '58', '59', '5A', '5U'] },
};

// CPDLC/data link labels (not in quickFilterCategories but used for category detection)
export const CPDLC_LABELS = ['CA', 'CR', 'CC', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'AD', 'AE', 'AF', 'D1', 'D2'];

// ACARS message label descriptions
export const ACARS_LABEL_DESCRIPTIONS = {
  // Common operational labels
  '_d': 'Command/Response',
  'H1': 'Departure Message',
  'H2': 'Arrival Message',
  '5Z': 'Airline Designated',
  '80': 'Terminal Weather',
  '81': 'Terminal Weather',
  '83': 'Request Terminal Weather',
  'B1': 'Request Departure Clearance',
  'B2': 'Departure Clearance',
  'B3': 'Request Oceanic Clearance',
  'B4': 'Oceanic Clearance',
  'B5': 'Departure Slot',
  'B6': 'Expected Departure Clearance',
  'BA': 'Beacon Request',
  'C1': 'Position Report',
  'CA': 'CPDLC',
  'Q0': 'Link Test',
  'Q1': 'Link Test',
  'Q2': 'Link Test',
  'QA': 'ACARS Test',
  'SA': 'System Report',
  'SQ': 'Squawk Report',
  // OOOI Messages
  '10': 'OUT - Leaving Gate',
  '11': 'OFF - Takeoff',
  '12': 'ON - Landing',
  '13': 'IN - Arrived Gate',
  '14': 'ETA Report',
  '15': 'Flight Status',
  '16': 'Route Change',
  '17': 'Fuel Report',
  '20': 'Delay Report',
  '21': 'Delay Report',
  '22': 'Ground Delay',
  '23': 'Estimated Gate Arrival',
  '24': 'Crew Report',
  '25': 'Passenger Count',
  '26': 'Connecting Passengers',
  '27': 'Load Report',
  '28': 'Weight & Balance',
  '29': 'Cargo/Mail',
  '2Z': 'Progress Report',
  // Weather
  '30': 'Request Weather',
  '31': 'METAR',
  '32': 'TAF',
  '33': 'ATIS',
  '34': 'PIREP',
  '35': 'Wind Data',
  '36': 'SIGMET',
  '37': 'NOTAM',
  '38': 'Turbulence Report',
  '39': 'Weather Update',
  '3M': 'METAR Request',
  '3S': 'SIGMET Request',
  // Flight planning
  '40': 'Flight Plan',
  '41': 'Flight Plan Amendment',
  '42': 'Route Request',
  '43': 'Oceanic Report',
  '44': 'Position Report',
  '45': 'Flight Level Change',
  '46': 'Speed Change',
  '47': 'Waypoint Report',
  '48': 'ETA Update',
  '49': 'Fuel Status',
  '4A': 'Company Specific',
  '4M': 'Company Specific',
  // Maintenance
  '50': 'Maintenance Message',
  '51': 'Engine Report',
  '52': 'APU Report',
  '53': 'Fault Report',
  '54': 'System Status',
  '55': 'Configuration',
  '56': 'Performance Data',
  '57': 'Trend Data',
  '58': 'Oil Status',
  '59': 'Exceedance Report',
  '5A': 'Technical Log',
  '5U': 'Airline Specific',
  // Free text
  'AA': 'Free Text',
  'AB': 'Free Text Reply',
  'F3': 'Free Text',
  'F5': 'Free Text',
  'F7': 'Departure Info',
  'FA': 'Free Text',
  'FF': 'Free Text',
  // ADS-C
  'AD': 'ADS-C Report',
  'AE': 'ADS-C Emergency',
  'AF': 'ADS-C Contract',
  // FANS/CPDLC
  'A0': 'FANS Application',
  'A1': 'CPDLC Connect',
  'A2': 'CPDLC Disconnect',
  'A3': 'CPDLC Uplink',
  'A4': 'CPDLC Downlink',
  'A5': 'CPDLC Cancel',
  'A6': 'CPDLC Status',
  'A7': 'CPDLC Error',
  'CR': 'CPDLC Request',
  'CC': 'CPDLC Communication',
  // Data link
  'D1': 'Data Link',
  'D2': 'Data Link',
  // Miscellaneous
  'RA': 'ACARS Uplink',
  'RF': 'Radio Frequency',
  'MA': 'Media Advisory',
  '00': 'Heartbeat',
  '7A': 'Telex',
  '8A': 'Company Specific',
  '8D': 'Telex Delivery',
  '8E': 'Telex Error',
};

// Aircraft type categories for styling
export const AIRCRAFT_TYPE_CATEGORIES = {
  heavy: ['A388', 'A380', 'B748', 'B744', 'A346', 'A345', 'A343', 'A342', 'B77W', 'B77L', 'B789', 'B78X'],
  medium: ['A320', 'A321', 'A319', 'A318', 'B737', 'B738', 'B739', 'B38M', 'B39M', 'E190', 'E195', 'E170', 'E175'],
  light: ['C172', 'C182', 'C208', 'PA28', 'PA32', 'SR22', 'DA40', 'DA42', 'BE36', 'M20P'],
  helicopter: ['R22', 'R44', 'EC35', 'EC45', 'AS50', 'B06', 'B407', 'S76', 'A109', 'H145', 'H160'],
  military: ['F16', 'F15', 'F18', 'F22', 'F35', 'B1', 'B2', 'B52', 'C17', 'C130', 'C5', 'KC10', 'KC135', 'E3', 'E8']
};

// Helper function to get aircraft type category
export const getTypeCategory = (type) => {
  if (!type) return 'unknown';
  const t = type.toUpperCase();
  for (const [category, types] of Object.entries(AIRCRAFT_TYPE_CATEGORIES)) {
    if (types.includes(t)) return category === 'military' ? 'military-type' : category;
  }
  return 'airliner';
};

// Helper function to get category for an ACARS label
export const getLabelCategory = (label) => {
  if (!label) return null;
  const upperLabel = label.toUpperCase();
  for (const [category, data] of Object.entries(ACARS_QUICK_FILTER_CATEGORIES)) {
    if (data.labels.includes(upperLabel)) {
      return category;
    }
  }
  // Check for CPDLC/data link
  if (CPDLC_LABELS.includes(upperLabel)) {
    return 'cpdlc';
  }
  return null;
};

// Get human-readable label description
export const getAcarsLabelDescription = (label, msgLabelInfo = null, labelReference = {}) => {
  if (!label) return null;
  // First check if message has label_info from API
  if (msgLabelInfo?.name) return msgLabelInfo.name;
  // Check API-fetched label reference
  if (labelReference[label]?.name) return labelReference[label].name;
  // Fall back to local descriptions
  return ACARS_LABEL_DESCRIPTIONS[label.toUpperCase()] || ACARS_LABEL_DESCRIPTIONS[label] || null;
};

// Helper to safely parse JSON from fetch response
export const safeJson = async (res) => {
  if (!res.ok) return null;
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) return null;
  try { return await res.json(); } catch { return null; }
};
