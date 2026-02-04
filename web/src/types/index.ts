// Aircraft tracking types

export interface Aircraft {
  hex: string;
  flight?: string;
  registration?: string;
  type?: string;
  squawk?: string;
  lat?: number;
  lon?: number;
  altitude?: number;
  alt_baro?: number;
  alt_geom?: number;
  speed?: number;
  gs?: number;
  tas?: number;
  ias?: number;
  mach?: number;
  track?: number;
  mag_heading?: number;
  true_heading?: number;
  vertical_rate?: number;
  baro_rate?: number;
  geom_rate?: number;
  seen?: number;
  seen_pos?: number;
  rssi?: number;
  messages?: number;
  category?: string;
  emergency?: string;
  military?: boolean;
  interesting?: boolean;
  distance_nm?: number;
  r_dst?: number;
  nav_qnh?: number;
  nav_altitude_mcp?: number;
  nav_heading?: number;
  nic?: number;
  rc?: number;
  version?: number;
}

/** Enriched aircraft info from database lookups */
export interface AircraftInfo {
  icao_hex: string;
  registration?: string;
  type_code?: string;
  type_name?: string;
  manufacturer?: string;
  model?: string;
  serial_number?: string;
  year_built?: number;
  age_years?: number;
  operator?: string;
  operator_icao?: string;
  owner?: string;
  country?: string;
  is_military?: boolean;
  category?: string;
  photo_url?: string;
  photo_thumbnail_url?: string;
  photo_photographer?: string;
  photo_source?: string;
  source_data?: SourceDataEntry[];
  found?: boolean;
}

export interface SourceDataEntry {
  source: string;
  last_updated?: string;
  fields?: string[];
}

/** Feeder/receiver location */
export interface FeederLocation {
  lat: number;
  lon: number;
  name?: string;
  altitude_m?: number;
}

/** WebSocket connection config */
export interface WebSocketConfig {
  apiBaseUrl: string;
  mapMode?: 'radar' | 'crt' | 'pro' | 'map';
  mapDarkMode?: boolean;
  browserNotifications?: boolean;
}

export interface AircraftPosition {
  lat: number;
  lon: number;
  altitude?: number;
  timestamp: string;
}

// Alert system types

export interface AlertCondition {
  field: string;
  operator: string;
  value: string | number | boolean;
}

export interface AlertAction {
  type: string;
  config: Record<string, unknown>;
}

export interface AlertRule {
  id: string;
  name: string;
  description?: string;
  conditions: AlertCondition[];
  actions: AlertAction[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

// Statistics types

export interface Stats {
  aircraft_count: number;
  messages_per_second: number;
  unique_today?: number;
  total_messages?: number;
  max_range?: number;
  positions_per_second?: number;
}

// Safety event types

export interface SafetyEvent {
  id: string;
  type: string;
  severity: string;
  aircraft_hex: string;
  description: string;
  timestamp: string;
}

// ACARS message types

export interface AcarsMessage {
  id: string;
  flight?: string;
  message: string;
  decoded?: Record<string, unknown>;
  timestamp: string;
  label?: string;
  source?: 'acars' | 'vdlm2';
  icao_hex?: string;
}

// Map panel visibility state
export interface MapPanelState {
  showAircraftList: boolean;
  showLegend: boolean;
  showAcarsPanel: boolean;
  showFilterMenu: boolean;
  showOverlayMenu: boolean;
  showMobileControls: boolean;
  showAdvisoryPanel: boolean;
  showNotamPanel: boolean;
  showRangeControl: boolean;
  listExpanded: boolean;
  legendCollapsed: boolean;
}

// Traffic filter settings
export interface TrafficFilters {
  showMilitary: boolean;
  showCivil: boolean;
  showGround: boolean;
  showAirborne: boolean;
  minAltitude: number;
  maxAltitude: number;
  showWithSquawk: boolean;
  showWithoutSquawk: boolean;
  safetyEventsOnly: boolean;
  showGA: boolean;
  showAirliners: boolean;
}

// Map overlay settings
export interface OverlaySettings {
  [key: string]: boolean;
}

// Layer opacity settings
export interface LayerOpacities {
  [key: string]: number;
}

// Pro radar mode settings
export interface ProRadarSettings {
  proTheme: 'cyan' | 'amber' | 'green' | 'high-contrast';
  showSpeedColors: boolean;
  showPredictionVectors: boolean;
  showAltitudeTrails: boolean;
  predictionSeconds: number;
  showConflictVisualization: boolean;
  gridOpacity: number;
  showCompassRose: boolean;
  showDataBlocks: boolean;
  showFpsCounter: boolean;
  highContrastMode: boolean;
  reducedMotion: boolean;
  dataBlockConfig: DataBlockConfig;
}

export interface DataBlockConfig {
  showCallsign: boolean;
  showAltitude: boolean;
  showSpeed: boolean;
  showHeading: boolean;
  showVerticalSpeed: boolean;
  showAircraftType: boolean;
  compact: boolean;
}

// Aircraft selection state
export interface AircraftSelectionState {
  selectedAircraft: Aircraft | null;
  sidebarAircraftHex: string | null;
  aircraftDetailHex: string | null;
}

// API response types
export interface BulkAircraftInfoResponse {
  aircraft: Record<string, AircraftInfo>;
  found: number;
  requested: number;
}

export interface PaginatedResponse<T> {
  results: T[];
  count: number;
  next?: string;
  previous?: string;
}
