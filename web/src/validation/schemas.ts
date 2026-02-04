/**
 * Zod schemas for runtime validation of API responses, WebSocket messages,
 * and localStorage data.
 */

import { z } from 'zod';

// ============================================================================
// Aircraft Schemas
// ============================================================================

/**
 * Live aircraft data from ADS-B receiver
 */
export const AircraftSchema = z.object({
  hex: z.string(),
  flight: z.string().optional(),
  registration: z.string().optional(),
  type: z.string().optional(),
  squawk: z.string().optional(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  altitude: z.number().optional(),
  alt_baro: z.number().optional(),
  alt_geom: z.number().optional(),
  speed: z.number().optional(),
  gs: z.number().optional(),
  tas: z.number().optional(),
  ias: z.number().optional(),
  mach: z.number().optional(),
  track: z.number().optional(),
  mag_heading: z.number().optional(),
  true_heading: z.number().optional(),
  vertical_rate: z.number().optional(),
  baro_rate: z.number().optional(),
  geom_rate: z.number().optional(),
  seen: z.number().optional(),
  seen_pos: z.number().optional(),
  rssi: z.number().optional(),
  messages: z.number().optional(),
  category: z.string().optional(),
  emergency: z.string().optional(),
  military: z.boolean().optional(),
  interesting: z.boolean().optional(),
  distance_nm: z.number().optional(),
  r_dst: z.number().optional(),
  nav_qnh: z.number().optional(),
  nav_altitude_mcp: z.number().optional(),
  nav_heading: z.number().optional(),
  nic: z.number().optional(),
  rc: z.number().optional(),
  version: z.number().optional(),
});

export type Aircraft = z.infer<typeof AircraftSchema>;

/**
 * Enriched aircraft info from database lookups
 */
export const AircraftInfoSchema = z.object({
  icao_hex: z.string(),
  registration: z.string().optional(),
  type_code: z.string().optional(),
  type_name: z.string().optional(),
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  serial_number: z.string().optional(),
  year_built: z.number().optional(),
  age_years: z.number().optional(),
  operator: z.string().optional(),
  operator_icao: z.string().optional(),
  owner: z.string().optional(),
  country: z.string().optional(),
  is_military: z.boolean().optional(),
  category: z.string().optional(),
  photo_url: z.string().url().optional().nullable(),
  photo_thumbnail_url: z.string().url().optional().nullable(),
  photo_photographer: z.string().optional(),
  photo_source: z.string().optional(),
  found: z.boolean().optional(),
  source_data: z.array(z.object({
    source: z.string(),
    last_updated: z.string().optional(),
    fields: z.array(z.string()).optional(),
  })).optional(),
});

export type AircraftInfo = z.infer<typeof AircraftInfoSchema>;

/**
 * Aircraft position for track history
 */
export const AircraftPositionSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  altitude: z.number().optional(),
  gs: z.number().optional(),
  track: z.number().optional(),
  vr: z.number().optional(),
  timestamp: z.string(),
  callsign: z.string().optional(),
});

export type AircraftPosition = z.infer<typeof AircraftPositionSchema>;

// ============================================================================
// Safety Event Schemas
// ============================================================================

export const SafetyEventSeverity = z.enum(['info', 'warning', 'critical']);

export const SafetyEventSchema = z.object({
  id: z.string(),
  event_type: z.string(),
  severity: SafetyEventSeverity,
  icao: z.string().optional(),
  icao_2: z.string().optional(),
  description: z.string(),
  timestamp: z.string(),
  details: z.record(z.unknown()).optional(),
  aircraft_snapshot: z.object({
    lat: z.number().optional(),
    lon: z.number().optional(),
    altitude: z.number().optional(),
    callsign: z.string().optional(),
  }).optional(),
  aircraft_snapshot_2: z.object({
    lat: z.number().optional(),
    lon: z.number().optional(),
    altitude: z.number().optional(),
    callsign: z.string().optional(),
  }).optional(),
});

export type SafetyEvent = z.infer<typeof SafetyEventSchema>;

// ============================================================================
// ACARS Message Schemas
// ============================================================================

export const AcarsMessageSchema = z.object({
  id: z.string(),
  flight: z.string().optional(),
  message: z.string(),
  decoded: z.record(z.unknown()).optional(),
  timestamp: z.string(),
  label: z.string().optional(),
  source: z.enum(['acars', 'vdlm2']).optional(),
  icao_hex: z.string().optional(),
});

export type AcarsMessage = z.infer<typeof AcarsMessageSchema>;

// ============================================================================
// Alert Rule Schemas
// ============================================================================

export const AlertConditionSchema = z.object({
  type: z.string(),
  operator: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

export const AlertConditionGroupSchema = z.object({
  logic: z.enum(['AND', 'OR']),
  conditions: z.array(AlertConditionSchema),
});

export const AlertRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  priority: z.enum(['info', 'warning', 'emergency', 'critical']),
  enabled: z.boolean(),
  conditions: z.object({
    logic: z.enum(['AND', 'OR']),
    groups: z.array(AlertConditionGroupSchema),
  }),
  cooldown_minutes: z.number().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export type AlertRule = z.infer<typeof AlertRuleSchema>;

// ============================================================================
// API Response Schemas
// ============================================================================

export const BulkAircraftInfoResponseSchema = z.object({
  aircraft: z.record(AircraftInfoSchema),
  found: z.number(),
  requested: z.number(),
});

export type BulkAircraftInfoResponse = z.infer<typeof BulkAircraftInfoResponseSchema>;

export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    results: z.array(itemSchema),
    count: z.number(),
    next: z.string().url().nullable().optional(),
    previous: z.string().url().nullable().optional(),
  });

// ============================================================================
// WebSocket Message Schemas
// ============================================================================

export const WsAircraftUpdateSchema = z.object({
  type: z.literal('aircraft-update'),
  aircraft: z.array(AircraftSchema),
  timestamp: z.string().optional(),
});

export const WsStatsUpdateSchema = z.object({
  type: z.literal('stats-update'),
  aircraft_count: z.number(),
  messages_per_second: z.number(),
  unique_today: z.number().optional(),
  total_messages: z.number().optional(),
  max_range: z.number().optional(),
  positions_per_second: z.number().optional(),
});

export const WsSafetyEventSchema = z.object({
  type: z.literal('safety-event'),
  event: SafetyEventSchema,
});

export const WsAlertTriggeredSchema = z.object({
  type: z.literal('alert-triggered'),
  rule_id: z.string(),
  rule_name: z.string(),
  aircraft: AircraftSchema.optional(),
  timestamp: z.string(),
});

export const WsMessageSchema = z.discriminatedUnion('type', [
  WsAircraftUpdateSchema,
  WsStatsUpdateSchema,
  WsSafetyEventSchema,
  WsAlertTriggeredSchema,
]);

export type WsMessage = z.infer<typeof WsMessageSchema>;

// ============================================================================
// LocalStorage Schemas
// ============================================================================

export const TrafficFiltersSchema = z.object({
  showMilitary: z.boolean(),
  showCivil: z.boolean(),
  showGround: z.boolean(),
  showAirborne: z.boolean(),
  minAltitude: z.number(),
  maxAltitude: z.number(),
  showWithSquawk: z.boolean(),
  showWithoutSquawk: z.boolean(),
  safetyEventsOnly: z.boolean(),
  showGA: z.boolean(),
  showAirliners: z.boolean(),
});

export type TrafficFilters = z.infer<typeof TrafficFiltersSchema>;

export const DataBlockConfigSchema = z.object({
  showCallsign: z.boolean(),
  showAltitude: z.boolean(),
  showSpeed: z.boolean(),
  showHeading: z.boolean(),
  showVerticalSpeed: z.boolean(),
  showAircraftType: z.boolean(),
  compact: z.boolean(),
});

export type DataBlockConfig = z.infer<typeof DataBlockConfigSchema>;

export const ProRadarSettingsSchema = z.object({
  proTheme: z.enum(['cyan', 'amber', 'green', 'high-contrast']),
  showSpeedColors: z.boolean(),
  showPredictionVectors: z.boolean(),
  showAltitudeTrails: z.boolean(),
  predictionSeconds: z.number(),
  showConflictVisualization: z.boolean(),
  gridOpacity: z.number(),
  showCompassRose: z.boolean(),
  showDataBlocks: z.boolean(),
  showFpsCounter: z.boolean(),
  highContrastMode: z.boolean(),
  reducedMotion: z.boolean(),
  dataBlockConfig: DataBlockConfigSchema,
});

export type ProRadarSettings = z.infer<typeof ProRadarSettingsSchema>;

// ============================================================================
// Feeder/Location Schemas
// ============================================================================

export const FeederLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  name: z.string().optional(),
  altitude_m: z.number().optional(),
});

export type FeederLocation = z.infer<typeof FeederLocationSchema>;

// ============================================================================
// Stats Schemas
// ============================================================================

export const StatsSchema = z.object({
  aircraft_count: z.number(),
  messages_per_second: z.number(),
  unique_today: z.number().optional(),
  total_messages: z.number().optional(),
  max_range: z.number().optional(),
  positions_per_second: z.number().optional(),
});

export type Stats = z.infer<typeof StatsSchema>;
