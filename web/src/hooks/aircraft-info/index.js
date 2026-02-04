/**
 * Aircraft Info Hooks - Modular hook composition for aircraft info lookups
 *
 * This module splits the monolithic useAircraftInfo hook into smaller,
 * focused hooks for better maintainability and testability:
 *
 * - useAircraftInfoCache: LRU cache with TTL
 * - useAircraftInfoFetcher: WebSocket/HTTP fetching with retries
 * - useAircraftInfoBulk: Batch queue management
 * - useAircraftInfoErrors: Error state management
 *
 * The main useAircraftInfo hook composes these together.
 */

export { useAircraftInfoCache } from './useAircraftInfoCache';
export { useAircraftInfoFetcher } from './useAircraftInfoFetcher';
export { useAircraftInfoBulk } from './useAircraftInfoBulk';
export { useAircraftInfoErrors } from './useAircraftInfoErrors';
