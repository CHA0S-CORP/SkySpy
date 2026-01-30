// ACARS message label descriptions
export const acarsLabelDescriptions = {
  '_d': 'Command/Response', 'H1': 'Departure Message', 'H2': 'Arrival Message',
  '5Z': 'Airline Designated', '80': 'Terminal Weather', '81': 'Terminal Weather',
  '83': 'Request Terminal Weather', 'B1': 'Request Departure Clearance',
  'B2': 'Departure Clearance', 'B3': 'Request Oceanic Clearance',
  'B4': 'Oceanic Clearance', 'B5': 'Departure Slot', 'B6': 'Expected Departure Clearance',
  'BA': 'Beacon Request', 'C1': 'Position Report', 'CA': 'CPDLC',
  'Q0': 'Link Test', 'Q1': 'Link Test', 'Q2': 'Link Test', 'QA': 'ACARS Test',
  'SA': 'System Report', 'SQ': 'Squawk Report',
  '10': 'OUT - Leaving Gate', '11': 'OFF - Takeoff', '12': 'ON - Landing',
  '13': 'IN - Arrived Gate', '14': 'ETA Report', '15': 'Flight Status',
  '16': 'Route Change', '17': 'Fuel Report', '20': 'Delay Report',
  '21': 'Delay Report', '22': 'Ground Delay', '23': 'Estimated Gate Arrival',
  '24': 'Crew Report', '25': 'Passenger Count', '26': 'Connecting Passengers',
  '27': 'Load Report', '28': 'Weight & Balance', '29': 'Cargo/Mail', '2Z': 'Progress Report',
  '30': 'Request Weather', '31': 'METAR', '32': 'TAF', '33': 'ATIS',
  '34': 'PIREP', '35': 'Wind Data', '36': 'SIGMET', '37': 'NOTAM',
  '38': 'Turbulence Report', '39': 'Weather Update', '3M': 'METAR Request', '3S': 'SIGMET Request',
  '40': 'Flight Plan', '41': 'Flight Plan Amendment', '42': 'Route Request',
  '43': 'Oceanic Report', '44': 'Position Report', '45': 'Flight Level Change',
  '46': 'Speed Change', '47': 'Waypoint Report', '48': 'ETA Update', '49': 'Fuel Status',
  '4A': 'Company Specific', '4M': 'Company Specific',
  '50': 'Maintenance Message', '51': 'Engine Report', '52': 'APU Report',
  '53': 'Fault Report', '54': 'System Status', '55': 'Configuration',
  '56': 'Performance Data', '57': 'Trend Data', '58': 'Oil Status',
  '59': 'Exceedance Report', '5A': 'Technical Log', '5U': 'Airline Specific',
  'AA': 'Free Text', 'AB': 'Free Text Reply', 'F3': 'Free Text', 'F5': 'Free Text',
  'F7': 'Departure Info', 'FA': 'Free Text', 'FF': 'Free Text',
  'AD': 'ADS-C Report', 'AE': 'ADS-C Emergency', 'AF': 'ADS-C Contract',
  'A0': 'FANS Application', 'A1': 'CPDLC Connect', 'A2': 'CPDLC Disconnect',
  'A3': 'CPDLC Uplink', 'A4': 'CPDLC Downlink', 'A5': 'CPDLC Cancel',
  'A6': 'CPDLC Status', 'A7': 'CPDLC Error', 'CR': 'CPDLC Request', 'CC': 'CPDLC Communication',
  'D1': 'Data Link', 'D2': 'Data Link', 'RA': 'ACARS Uplink', 'RF': 'Radio Frequency',
  'MA': 'Media Advisory', '00': 'Heartbeat', '7A': 'Telex', '8A': 'Company Specific',
  '8D': 'Telex Delivery', '8E': 'Telex Error',
};

// Quick filter categories with their associated labels
export const quickFilterCategories = {
  position: { name: 'Position', labels: ['C1', 'SQ', '47', '2Z', 'AD', 'AE'] },
  weather: { name: 'Weather', labels: ['15', '30', '31', '32', '33', '34', '35', '36', '37', '38', '39', '44', '80', '81', '83', '3M', '3S'] },
  oooi: { name: 'OOOI', labels: ['10', '11', '12', '13', '14', '16', '17'] },
  operational: { name: 'Operational', labels: ['H1', 'H2', '5Z', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', 'B1', 'B2', 'B9'] },
  freetext: { name: 'Free Text', labels: ['AA', 'AB', 'FA', 'FF', 'F3', 'F5', 'F7'] },
  maintenance: { name: 'Maintenance', labels: ['50', '51', '52', '53', '54', '55', '56', '57', '58', '59', '5A', '5U'] },
};

export const VALID_DETAIL_TABS = ['info', 'live', 'radio', 'acars', 'safety', 'history', 'track'];

export function getAcarsLabelDescription(label, msgLabelInfo = null) {
  if (!label) return null;
  if (msgLabelInfo?.name) return msgLabelInfo.name;
  return acarsLabelDescriptions[label.toUpperCase()] || acarsLabelDescriptions[label] || null;
}

export function getLabelCategory(label) {
  if (!label) return null;
  const upperLabel = label.toUpperCase();
  if (['C1', 'SQ', '47', '2Z', 'AD', 'AE'].includes(upperLabel)) return 'position';
  if (['15', '30', '31', '32', '33', '34', '35', '36', '37', '38', '39', '44', '80', '81', '83', '3M', '3S'].includes(upperLabel)) return 'weather';
  if (['10', '11', '12', '13', '14', '16', '17'].includes(upperLabel)) return 'oooi';
  if (['H1', 'H2', '5Z', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', 'B1', 'B2', 'B9'].includes(upperLabel)) return 'operational';
  if (['AA', 'AB', 'FA', 'FF', 'F3', 'F5', 'F7'].includes(upperLabel)) return 'freetext';
  if (['50', '51', '52', '53', '54', '55', '56', '57', '58', '59', '5A', '5U'].includes(upperLabel)) return 'maintenance';
  if (['CA', 'CR', 'CC', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'AF', 'D1', 'D2'].includes(upperLabel)) return 'cpdlc';
  return null;
}
