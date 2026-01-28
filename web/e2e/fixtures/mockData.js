/**
 * Mock data for e2e tests
 */

/**
 * Mock aircraft data for testing
 */
export const mockAircraft = [
  {
    hex: 'A12345',
    flight: 'UAL123',
    lat: 47.45,
    lon: -122.30,
    alt: 35000,
    alt_baro: 35000,
    gs: 450,
    track: 180,
    t: 'B738',
    type: 'B738',
    squawk: '1200',
    military: false,
    emergency: false,
    category: 'A3',
    seen: 0,
    distance_nm: 15.5,
    rssi: -25,
  },
  {
    hex: 'A67890',
    flight: 'DAL456',
    lat: 47.50,
    lon: -122.20,
    alt: 28000,
    alt_baro: 28000,
    gs: 380,
    track: 90,
    t: 'A320',
    type: 'A320',
    squawk: '2345',
    military: false,
    emergency: false,
    category: 'A3',
    seen: 0,
    distance_nm: 8.2,
    rssi: -18,
  },
  {
    hex: 'AE1234',
    flight: 'EVAC01',
    lat: 47.55,
    lon: -122.35,
    alt: 5000,
    alt_baro: 5000,
    gs: 120,
    track: 270,
    t: 'H60',
    type: 'H60',
    squawk: '7700',
    military: true,
    emergency: true,
    category: 'A7',
    seen: 0,
    distance_nm: 3.1,
    rssi: -12,
  },
  {
    hex: 'A11111',
    flight: 'SWA789',
    lat: 47.40,
    lon: -122.40,
    alt: 15000,
    alt_baro: 15000,
    gs: 280,
    track: 45,
    t: 'B737',
    type: 'B737',
    squawk: '3456',
    military: false,
    emergency: false,
    category: 'A3',
    seen: 0,
    distance_nm: 22.7,
    rssi: -32,
  },
  {
    hex: 'AE5678',
    flight: 'RCH001',
    lat: 47.35,
    lon: -122.50,
    alt: 25000,
    alt_baro: 25000,
    gs: 420,
    track: 315,
    t: 'C17',
    type: 'C17',
    squawk: '5678',
    military: true,
    emergency: false,
    category: 'A5',
    seen: 0,
    distance_nm: 35.0,
    rssi: -38,
  },
  {
    hex: 'A44444',
    flight: 'N12345',
    lat: 47.52,
    lon: -122.45,
    alt: 3500,
    alt_baro: 3500,
    gs: 95,
    track: 60,
    t: 'C172',
    type: 'C172',
    squawk: '1200',
    military: false,
    emergency: false,
    category: 'A1',
    seen: 0,
    distance_nm: 5.3,
    rssi: -15,
  },
];

/**
 * Mock aircraft with emergency squawk 7700
 */
export const mockEmergencyAircraft = {
  hex: 'AEMER1',
  flight: 'EMR777',
  lat: 47.60,
  lon: -122.25,
  alt: 8000,
  alt_baro: 8000,
  gs: 200,
  track: 180,
  t: 'B737',
  type: 'B737',
  squawk: '7700',
  military: false,
  emergency: true,
  category: 'A3',
  seen: 0,
  distance_nm: 12.5,
  rssi: -20,
};

/**
 * Mock safety events for testing
 */
export const mockSafetyEvents = [
  {
    id: 'evt-001',
    event_type: 'emergency_squawk',
    severity: 'critical',
    icao: 'AE1234',
    callsign: 'EVAC01',
    squawk: '7700',
    timestamp: new Date().toISOString(),
    resolved: false,
    details: {
      altitude: 5000,
      position: { lat: 47.55, lon: -122.35 },
    },
  },
  {
    id: 'evt-002',
    event_type: 'proximity_conflict',
    severity: 'warning',
    icao: 'A12345',
    icao_2: 'A67890',
    callsign: 'UAL123',
    callsign_2: 'DAL456',
    timestamp: new Date().toISOString(),
    resolved: false,
    details: {
      aircraft_1: { hex: 'A12345', alt: 35000, gs: 450 },
      aircraft_2: { hex: 'A67890', alt: 28000, gs: 380 },
      distance_nm: 2.5,
      altitude_diff_ft: 7000,
    },
  },
];

/**
 * Mock ACARS messages for testing
 */
export const mockAcarsMessages = [
  {
    id: 'acars-001',
    timestamp: new Date().toISOString(),
    flight: 'UAL123',
    tail: 'N12345',
    text: 'POSITION REPORT',
    label: 'H1',
    source: 'acars',
  },
  {
    id: 'acars-002',
    timestamp: new Date().toISOString(),
    flight: 'DAL456',
    tail: 'N67890',
    text: 'WEATHER REQUEST',
    label: 'WX',
    source: 'vdlm2',
  },
];

/**
 * Mock system status
 */
export const mockSystemStatus = {
  location: {
    lat: 47.9377,
    lon: -121.9687,
  },
  websocket_connections: 5,
  uptime_seconds: 86400,
  version: '2.5.0',
};

/**
 * Mock aircraft info (airframe data)
 */
export const mockAircraftInfo = {
  A12345: {
    hex: 'A12345',
    registration: 'N12345',
    typeLong: 'Boeing 737-800',
    operator: 'United Airlines',
    manufacturerName: 'Boeing',
    model: '737-824',
    year: 2015,
  },
  A67890: {
    hex: 'A67890',
    registration: 'N67890',
    typeLong: 'Airbus A320-214',
    operator: 'Delta Air Lines',
    manufacturerName: 'Airbus',
    model: 'A320-214',
    year: 2018,
  },
};

/**
 * Mock aviation overlay data
 */
export const mockAviationData = {
  navaids: [
    { id: 'SEA', name: 'Seattle VOR', lat: 47.44, lon: -122.30, type: 'VOR' },
    { id: 'PAE', name: 'Paine NDB', lat: 47.91, lon: -122.28, type: 'NDB' },
  ],
  airports: [
    { icao: 'KSEA', name: 'Seattle-Tacoma Intl', lat: 47.45, lon: -122.31 },
    { icao: 'KPAE', name: 'Paine Field', lat: 47.91, lon: -122.28 },
  ],
  metars: [],
  pireps: [],
  airspaces: [],
  boundaries: [],
};

/**
 * Mock track history for aircraft trails
 */
export const mockTrackHistory = {
  A12345: [
    { lat: 47.43, lon: -122.32, time: Date.now() - 60000 },
    { lat: 47.44, lon: -122.31, time: Date.now() - 30000 },
    { lat: 47.45, lon: -122.30, time: Date.now() },
  ],
  A67890: [
    { lat: 47.48, lon: -122.22, time: Date.now() - 60000 },
    { lat: 47.49, lon: -122.21, time: Date.now() - 30000 },
    { lat: 47.50, lon: -122.20, time: Date.now() },
  ],
};

export default {
  mockAircraft,
  mockEmergencyAircraft,
  mockSafetyEvents,
  mockAcarsMessages,
  mockSystemStatus,
  mockAircraftInfo,
  mockAviationData,
  mockTrackHistory,
};
