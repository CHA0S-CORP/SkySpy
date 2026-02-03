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
  speed?: number;
  track?: number;
  vertical_rate?: number;
  seen?: number;
  rssi?: number;
  messages?: number;
  category?: string;
  emergency?: string;
  military?: boolean;
  interesting?: boolean;
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
}
