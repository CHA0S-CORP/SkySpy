/**
 * Validation utilities for runtime type checking
 *
 * Use these functions to validate data at runtime, especially:
 * - API responses
 * - WebSocket messages
 * - LocalStorage reads
 */

import { z } from 'zod';
import {
  AircraftSchema,
  AircraftInfoSchema,
  SafetyEventSchema,
  AcarsMessageSchema,
  AlertRuleSchema,
  BulkAircraftInfoResponseSchema,
  TrafficFiltersSchema,
  DataBlockConfigSchema,
  FeederLocationSchema,
  StatsSchema,
  type Aircraft,
  type AircraftInfo,
  type SafetyEvent,
  type AcarsMessage,
  type AlertRule,
  type BulkAircraftInfoResponse,
  type TrafficFilters,
  type DataBlockConfig,
  type FeederLocation,
  type Stats,
} from './schemas';

// Re-export schemas and types
export * from './schemas';

// ============================================================================
// Validation Result Types
// ============================================================================

export interface ValidationSuccess<T> {
  success: true;
  data: T;
}

export interface ValidationError {
  success: false;
  error: z.ZodError;
  issues: z.ZodIssue[];
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationError;

// ============================================================================
// Safe Parse Functions
// ============================================================================

/**
 * Safely parse data with a Zod schema, returning a result object
 */
export function safeParse<T>(
  schema: z.ZodType<T>,
  data: unknown
): ValidationResult<T> {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    error: result.error,
    issues: result.error.issues,
  };
}

/**
 * Parse data with a Zod schema, throwing on error
 */
export function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  return schema.parse(data);
}

/**
 * Parse data with a Zod schema, returning default on error
 */
export function parseWithDefault<T>(
  schema: z.ZodType<T>,
  data: unknown,
  defaultValue: T
): T {
  const result = schema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  return defaultValue;
}

// ============================================================================
// Type-Specific Validators
// ============================================================================

export const validateAircraft = (data: unknown): ValidationResult<Aircraft> =>
  safeParse(AircraftSchema, data);

export const validateAircraftInfo = (data: unknown): ValidationResult<AircraftInfo> =>
  safeParse(AircraftInfoSchema, data);

export const validateSafetyEvent = (data: unknown): ValidationResult<SafetyEvent> =>
  safeParse(SafetyEventSchema, data);

export const validateAcarsMessage = (data: unknown): ValidationResult<AcarsMessage> =>
  safeParse(AcarsMessageSchema, data);

export const validateAlertRule = (data: unknown): ValidationResult<AlertRule> =>
  safeParse(AlertRuleSchema, data);

export const validateBulkAircraftInfoResponse = (
  data: unknown
): ValidationResult<BulkAircraftInfoResponse> =>
  safeParse(BulkAircraftInfoResponseSchema, data);

export const validateTrafficFilters = (data: unknown): ValidationResult<TrafficFilters> =>
  safeParse(TrafficFiltersSchema, data);

export const validateDataBlockConfig = (data: unknown): ValidationResult<DataBlockConfig> =>
  safeParse(DataBlockConfigSchema, data);

export const validateFeederLocation = (data: unknown): ValidationResult<FeederLocation> =>
  safeParse(FeederLocationSchema, data);

export const validateStats = (data: unknown): ValidationResult<Stats> =>
  safeParse(StatsSchema, data);

// ============================================================================
// Array Validators
// ============================================================================

export const validateAircraftArray = (data: unknown): ValidationResult<Aircraft[]> =>
  safeParse(z.array(AircraftSchema), data);

export const validateSafetyEventArray = (data: unknown): ValidationResult<SafetyEvent[]> =>
  safeParse(z.array(SafetyEventSchema), data);

export const validateAcarsMessageArray = (data: unknown): ValidationResult<AcarsMessage[]> =>
  safeParse(z.array(AcarsMessageSchema), data);

export const validateAlertRuleArray = (data: unknown): ValidationResult<AlertRule[]> =>
  safeParse(z.array(AlertRuleSchema), data);

// ============================================================================
// LocalStorage Helpers
// ============================================================================

/**
 * Read and validate JSON from localStorage
 * Returns default value if key doesn't exist or validation fails
 */
export function readValidatedStorage<T>(
  key: string,
  schema: z.ZodType<T>,
  defaultValue: T
): T {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return defaultValue;

    const parsed = JSON.parse(stored);
    const result = schema.safeParse(parsed);

    if (result.success) {
      return result.data;
    }

    console.warn(`Invalid data in localStorage key "${key}":`, result.error.issues);
    return defaultValue;
  } catch (e) {
    console.warn(`Failed to read localStorage key "${key}":`, e);
    return defaultValue;
  }
}

/**
 * Write validated data to localStorage
 * Only writes if data passes validation
 */
export function writeValidatedStorage<T>(
  key: string,
  schema: z.ZodType<T>,
  data: T
): boolean {
  try {
    const result = schema.safeParse(data);
    if (!result.success) {
      console.warn(`Invalid data for localStorage key "${key}":`, result.error.issues);
      return false;
    }

    localStorage.setItem(key, JSON.stringify(result.data));
    return true;
  } catch (e) {
    console.warn(`Failed to write localStorage key "${key}":`, e);
    return false;
  }
}

// ============================================================================
// API Response Helpers
// ============================================================================

/**
 * Validate API response and extract data
 * Logs warning if validation fails but returns raw data as fallback
 */
export function validateApiResponse<T>(
  schema: z.ZodType<T>,
  response: unknown,
  endpoint: string
): T | null {
  const result = schema.safeParse(response);

  if (result.success) {
    return result.data;
  }

  console.warn(`API response validation failed for ${endpoint}:`, result.error.issues);

  // Return null to indicate validation failure
  // Caller can decide to use raw response or handle error
  return null;
}

/**
 * Validate paginated API response
 */
export function validatePaginatedResponse<T>(
  itemSchema: z.ZodType<T>,
  response: unknown,
  endpoint: string
): { results: T[]; count: number; next?: string; previous?: string } | null {
  const paginatedSchema = z.object({
    results: z.array(itemSchema),
    count: z.number(),
    next: z.string().nullable().optional(),
    previous: z.string().nullable().optional(),
  });

  const result = paginatedSchema.safeParse(response);

  if (result.success) {
    return result.data;
  }

  console.warn(`Paginated API response validation failed for ${endpoint}:`, result.error.issues);
  return null;
}
