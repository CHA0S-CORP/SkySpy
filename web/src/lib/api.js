/**
 * API layer for SkySpy Django backend
 *
 * Provides typed API methods for all backend endpoints with standardized
 * error handling and response parsing.
 */

import { getClientId } from './clientId';
import { withAuth } from './authHeader';

const API_BASE = '/api/v1';

/**
 * Default request timeout in milliseconds
 */
const DEFAULT_TIMEOUT = 30000;

/**
 * Custom error class for API errors
 */
export class ApiError extends Error {
  /**
   * @param {string} message - Error message
   * @param {number} status - HTTP status code
   * @param {Object|null} data - Error response data from server
   * @param {boolean} isCorsError - Whether this is a CORS-related error
   * @param {boolean} isTimeout - Whether this is a timeout error
   */
  constructor(message, status, data = null, isCorsError = false, isTimeout = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.isCorsError = isCorsError;
    this.isTimeout = isTimeout;
  }
}

/**
 * Parse Django REST Framework error responses into a readable message
 *
 * DRF errors can come in several formats:
 * - { "detail": "Error message" }
 * - { "field_name": ["Error 1", "Error 2"] }
 * - { "non_field_errors": ["Error message"] }
 * - { "error": "Error message" }
 *
 * @param {Object} data - Error response data from DRF
 * @returns {string} Human-readable error message
 */
export function parseDRFError(data) {
  if (!data) {
    return 'Unknown error occurred';
  }

  // Handle simple string error
  if (typeof data === 'string') {
    return data;
  }

  // Handle { detail: "message" } format
  if (data.detail) {
    return data.detail;
  }

  // Handle { error: "message" } format
  if (data.error) {
    return data.error;
  }

  // Handle { message: "message" } format
  if (data.message) {
    return data.message;
  }

  // Handle { non_field_errors: ["error1", "error2"] } format
  if (data.non_field_errors && Array.isArray(data.non_field_errors)) {
    return data.non_field_errors.join(', ');
  }

  // Handle field-level errors { field_name: ["error1", "error2"] }
  const fieldErrors = [];
  for (const [field, errors] of Object.entries(data)) {
    if (Array.isArray(errors)) {
      fieldErrors.push(`${field}: ${errors.join(', ')}`);
    } else if (typeof errors === 'string') {
      fieldErrors.push(`${field}: ${errors}`);
    }
  }

  if (fieldErrors.length > 0) {
    return fieldErrors.join('; ');
  }

  return 'Unknown error occurred';
}

/**
 * Make an API request with standardized error handling and timeout
 *
 * @param {string} endpoint - API endpoint (relative to API_BASE)
 * @param {Object} options - Fetch options
 * @param {string} [options.method='GET'] - HTTP method
 * @param {Object} [options.body] - Request body (will be JSON stringified)
 * @param {Object} [options.params] - URL query parameters
 * @param {Object} [options.headers] - Additional headers
 * @param {number} [options.timeout] - Request timeout in ms (default: 30000)
 * @returns {Promise<Object>} Parsed JSON response
 * @throws {ApiError} On HTTP error responses, timeout, or CORS failures
 */
async function apiRequest(endpoint, options = {}) {
  const {
    method = 'GET',
    body,
    params,
    headers: customHeaders = {},
    timeout = DEFAULT_TIMEOUT,
  } = options;

  // Build URL with query parameters
  let url = `${API_BASE}${endpoint}`;
  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        searchParams.append(key, value);
      }
    }
    const queryString = searchParams.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
  }

  // Build headers. X-Client-Id scopes anonymous-owned resources (chat sessions)
  // to this browser in public AUTH_MODE; ignored by other endpoints. withAuth
  // attaches the JWT bearer when signed in — required for authed endpoints in
  // bearer-only mode (JWT_AUTH_COOKIE=False); harmless (omitted) when anonymous.
  const headers = withAuth({
    'Content-Type': 'application/json',
    'X-Client-Id': getClientId(),
    ...customHeaders,
  });

  // Set up abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // Build fetch options
  const fetchOptions = {
    method,
    headers,
    credentials: 'include', // Include cookies for session auth
    signal: controller.signal,
  };

  if (body && method !== 'GET') {
    fetchOptions.body = JSON.stringify(body);
  }

  let response;
  try {
    // Make the request
    response = await fetch(url, fetchOptions);
  } catch (err) {
    clearTimeout(timeoutId);

    // Handle timeout
    if (err.name === 'AbortError') {
      throw new ApiError(`Request timeout after ${timeout}ms`, 0, null, false, true);
    }

    // Detect CORS errors (typically show as TypeError: Failed to fetch)
    if (err.name === 'TypeError' && err.message.includes('Failed to fetch')) {
      throw new ApiError(
        'CORS error: Unable to access the API. Check that the server allows requests from this origin with credentials.',
        0,
        null,
        true,
        false
      );
    }

    throw new ApiError(err.message || 'Network error', 0, null);
  }

  clearTimeout(timeoutId);

  // Parse response
  let data = null;
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      // Response was not valid JSON
      data = null;
    }
  }

  // Handle errors
  if (!response.ok) {
    const message = data ? parseDRFError(data) : `HTTP ${response.status}`;
    throw new ApiError(message, response.status, data);
  }

  return data;
}

/**
 * API client with all endpoints organized by domain
 */
export const api = {
  // =========================================================================
  // Aircraft endpoints
  // =========================================================================

  /**
   * Get all currently tracked aircraft
   * @param {Object} [params] - Query parameters
   * @returns {Promise<Object>} Aircraft list with count and metadata
   */
  getAircraft: (params) => apiRequest('/aircraft/', { params }),

  /**
   * Get details for a specific aircraft by ICAO hex code
   * @param {string} hex - ICAO 24-bit hex identifier
   * @returns {Promise<Object>} Aircraft details
   */
  getAircraftDetail: (hex) => apiRequest(`/aircraft/${hex}/`),

  /**
   * Get historical tracking data for an aircraft
   * @param {string} hex - ICAO hex identifier
   * @param {Object} [params] - Query parameters (hours, limit)
   * @returns {Promise<Object>} Aircraft sighting history
   */
  getAircraftHistory: (hex, params) =>
    apiRequest('/sightings/', { params: { icao: hex, ...params } }),

  /**
   * Get top aircraft by various categories
   * @param {Object} [params] - Query parameters (limit)
   * @returns {Promise<Object>} Top aircraft by category
   */
  getAircraftTop: (params) => apiRequest('/aircraft/top/', { params }),

  /**
   * Get aggregate statistics for tracked aircraft
   * @returns {Promise<Object>} Aircraft statistics
   */
  getAircraftStats: () => apiRequest('/aircraft/stats/'),

  /**
   * Get distinct-tail counts per airframe type actually seen by this station.
   * @param {Object} [params] - Query parameters (hours: recency window, omit for all-time)
   * @returns {Promise<{types: Record<string, number>}>} Map of type designator → seen count
   */
  getSeenAirframeTypes: (params) => apiRequest('/airframes/seen-types/', { params }),

  /**
   * Get the seen tails of one airframe type, newest first (paginated for lazy loading).
   * @param {string} type - ICAO type designator (e.g. B738)
   * @param {Object} [params] - Query parameters (limit, offset)
   * @returns {Promise<{results: Object[], count: number, next_offset: number|null}>}
   */
  getSeenAirframesByType: (type, params) =>
    apiRequest('/airframes/seen/', { params: { type, ...params } }),

  /**
   * Get auto-generated airframe type cards (LLM-written for types seen here but
   * absent from the curated static library). Each card is `Airframe`-shaped with
   * `generated: true`; the Airframes screen merges these behind the static ones.
   * @returns {Promise<{cards: Object[], count: number}>}
   */
  getGeneratedAirframeCards: () => apiRequest('/airframes/type-cards/'),

  /**
   * Queue on-demand LLM generation of a reference card for a type designator not
   * yet in the library. Resolves with `{status:'queued', type_code}` (202); the
   * card appears in getGeneratedAirframeCards() once the worker finishes.
   * @param {string} type - ICAO type designator (e.g. SU95)
   */
  generateAirframeCard: (type) =>
    apiRequest('/airframes/type-cards/generate/', { method: 'POST', body: { type } }),

  // =========================================================================
  // Stats endpoints
  // =========================================================================

  /**
   * Get history statistics
   * @param {Object} [params] - Query parameters (hours)
   * @returns {Promise<Object>} Historical statistics
   */
  getStats: (params) => apiRequest('/history/stats/', { params }),

  /**
   * Get session statistics
   * @param {Object} [params] - Query parameters (hours)
   * @returns {Promise<Object>} Session list with count
   */
  getStatsSession: (params) => apiRequest('/sessions/', { params }),

  /**
   * Get top performers/records
   * @param {Object} [params] - Query parameters (hours, limit)
   * @returns {Promise<Object>} Top performers by various metrics
   */
  getStatsRecords: (params) => apiRequest('/history/top-performers/', { params }),

  /**
   * Get activity trends over time
   * @param {Object} [params] - Query parameters (hours, interval)
   * @returns {Promise<Object>} Time-based activity trends
   */
  getStatsTrends: (params) => apiRequest('/history/trends/', { params }),

  /**
   * Get tracking quality statistics
   * @param {Object} [params] - Query parameters (hours, refresh)
   * @returns {Promise<Object>} Tracking quality metrics
   */
  getTrackingQuality: (params) => apiRequest('/stats/tracking-quality/', { params }),

  /**
   * Get engagement statistics
   * @param {Object} [params] - Query parameters (hours, refresh)
   * @returns {Promise<Object>} Engagement metrics
   */
  getEngagementStats: (params) => apiRequest('/stats/engagement/', { params }),

  // =========================================================================
  // Alerts endpoints
  // =========================================================================

  /**
   * Get all alert rules
   * @param {Object} [params] - Query parameters (enabled, priority, rule_type)
   * @returns {Promise<Object>} Alert rules list with count
   */
  getAlertRules: (params) => apiRequest('/alerts/rules/', { params }),

  /**
   * Create a new alert rule
   * @param {Object} data - Alert rule data
   * @returns {Promise<Object>} Created alert rule
   */
  createAlertRule: (data) => apiRequest('/alerts/rules/', { method: 'POST', body: data }),

  /**
   * Update an existing alert rule
   * @param {number|string} id - Alert rule ID
   * @param {Object} data - Updated alert rule data
   * @returns {Promise<Object>} Updated alert rule
   */
  updateAlertRule: (id, data) =>
    apiRequest(`/alerts/rules/${id}/`, { method: 'PATCH', body: data }),

  /**
   * Delete an alert rule
   * @param {number|string} id - Alert rule ID
   * @returns {Promise<void>}
   */
  deleteAlertRule: (id) => apiRequest(`/alerts/rules/${id}/`, { method: 'DELETE' }),

  /**
   * Toggle alert rule enabled status
   * @param {number|string} id - Alert rule ID
   * @returns {Promise<Object>} Updated alert rule
   */
  toggleAlertRule: (id) => apiRequest(`/alerts/rules/${id}/toggle/`, { method: 'POST' }),

  /**
   * Get alert history
   * @param {Object} [params] - Query parameters (hours, rule_id, icao_hex, priority)
   * @returns {Promise<Object>} Alert history list with count
   */
  getAlertHistory: (params) => apiRequest('/alerts/history/', { params }),

  /**
   * Acknowledge an alert
   * @param {number|string} id - Alert history entry ID
   * @returns {Promise<Object>} Updated alert entry
   */
  acknowledgeAlert: (id) => apiRequest(`/alerts/history/${id}/acknowledge/`, { method: 'POST' }),

  /**
   * Acknowledge all unacknowledged alerts
   * @returns {Promise<Object>} { acknowledged: number }
   */
  acknowledgeAllAlerts: () => apiRequest('/alerts/history/acknowledge-all/', { method: 'POST' }),

  /**
   * Clear alert history (own alerts / owner-less in public mode)
   * @returns {Promise<Object>} { deleted: number }
   */
  clearAlertHistory: () => apiRequest('/alerts/history/clear/', { method: 'DELETE' }),

  /**
   * Get alert service metrics
   * @returns {Promise<Object>} Alert service metrics
   */
  getAlertMetrics: () => apiRequest('/alerts/rules/metrics/'),

  // =========================================================================
  // Notification channel endpoints (custom alert targets)
  // =========================================================================

  /**
   * List notification channels (custom alert targets). Apprise URLs are masked.
   * @returns {Promise<Object>} { results: [...] } or array
   */
  getNotificationChannels: (params) => apiRequest('/notifications/channels/', { params }),

  /**
   * Get available notification channel types
   * @returns {Promise<Object>} { types: [...] } or list of type descriptors
   */
  getNotificationChannelTypes: () => apiRequest('/notifications/channels/types/'),

  /**
   * Create a notification channel
   * @param {Object} data - { name, channel_type, apprise_url, description?, enabled?, supports_rich? }
   * @returns {Promise<Object>} Created channel
   */
  createNotificationChannel: (data) =>
    apiRequest('/notifications/channels/', { method: 'POST', body: data }),

  /**
   * Update a notification channel
   * @param {number|string} id
   * @param {Object} data
   * @returns {Promise<Object>} Updated channel
   */
  updateNotificationChannel: (id, data) =>
    apiRequest(`/notifications/channels/${id}/`, { method: 'PATCH', body: data }),

  /**
   * Delete a notification channel
   * @param {number|string} id
   * @returns {Promise<void>}
   */
  deleteNotificationChannel: (id) =>
    apiRequest(`/notifications/channels/${id}/`, { method: 'DELETE' }),

  /**
   * Send a test notification through a channel
   * @param {number|string} id
   * @returns {Promise<Object>} { success, message, verified }
   */
  testNotificationChannel: (id) =>
    apiRequest(`/notifications/channels/${id}/test/`, { method: 'POST' }),

  // =========================================================================
  // History endpoints
  // =========================================================================

  /**
   * Get flight history (sightings)
   * @param {Object} [params] - Query parameters (hours, icao, callsign, military_only, etc.)
   * @returns {Promise<Object>} Sightings list with pagination
   */
  getHistoryFlights: (params) => apiRequest('/sightings/', { params }),

  /**
   * Get time comparison statistics
   * @returns {Promise<Object>} All time comparison stats
   */
  getTimeComparison: () => apiRequest('/history/time-comparison/'),

  /**
   * Get week-over-week comparison
   * @returns {Promise<Object>} Weekly comparison data
   */
  getWeekComparison: () => apiRequest('/history/time-comparison/week/'),

  // =========================================================================
  // ACARS endpoints
  // =========================================================================

  /**
   * Get ACARS messages
   * @param {Object} [params] - Query parameters (hours, source, icao_hex, callsign, label, limit)
   * @returns {Promise<Object>} ACARS messages list with count
   */
  getAcarsMessages: (params) => apiRequest('/acars/', { params }),

  /**
   * Get ACARS statistics
   * @returns {Promise<Object>} ACARS statistics
   */
  getAcarsStats: () => apiRequest('/acars/stats/'),

  /**
   * Get ACARS receiver status
   * @returns {Promise<Object>} ACARS receiver status
   */
  getAcarsStatus: () => apiRequest('/acars/status/'),

  /**
   * Get ACARS message breakdown statistics
   * @param {Object} [params] - Query parameters (hours, use_cache)
   * @returns {Promise<Object>} Message breakdown stats
   */
  getAcarsBreakdown: (params) => apiRequest('/acars/stats/breakdown/', { params }),

  /**
   * Get ACARS trends over time
   * @param {Object} [params] - Query parameters (hours, interval)
   * @returns {Promise<Object>} ACARS trends data
   */
  getAcarsTrends: (params) => apiRequest('/acars/stats/trends/', { params }),

  // =========================================================================
  // Safety endpoints
  // =========================================================================

  /**
   * Get safety events
   * @param {Object} [params] - Query parameters (hours, event_type, severity)
   * @returns {Promise<Object>} Safety events list with count
   */
  getSafetyEvents: (params) => apiRequest('/safety/events/', { params }),

  /**
   * Get safety statistics
   * @param {Object} [params] - Query parameters (hours)
   * @returns {Promise<Object>} Safety statistics
   */
  getSafetyStats: (params) => apiRequest('/safety/events/stats/', { params }),

  /**
   * Get safety monitor status
   * @returns {Promise<Object>} Safety monitor status
   */
  getSafetyMonitorStatus: () => apiRequest('/safety/events/monitor/status/'),

  /**
   * Acknowledge a safety event
   * @param {number|string} id - Safety event ID
   * @returns {Promise<Object>} Updated safety event
   */
  acknowledgeSafetyEvent: (id) =>
    apiRequest(`/safety/events/${id}/acknowledge/`, { method: 'POST' }),

  // =========================================================================
  // NOTAMs endpoints
  // =========================================================================

  /**
   * Get NOTAMs
   * @param {Object} [params] - Query parameters (icao, lat, lon, radius_nm, type, active_only, limit)
   * @returns {Promise<Object>} NOTAMs list with count
   */
  getNotams: (params) => apiRequest('/notams/', { params }),

  /**
   * Get TFRs (Temporary Flight Restrictions)
   * @param {Object} [params] - Query parameters (lat, lon, radius_nm, active_only)
   * @returns {Promise<Object>} TFRs list with count
   */
  getTfrs: (params) => apiRequest('/notams/tfrs/', { params }),

  /**
   * Get NOTAMs for a specific airport
   * @param {string} icao - Airport ICAO code
   * @param {Object} [params] - Query parameters (active_only)
   * @returns {Promise<Object>} NOTAMs for airport
   */
  getAirportNotams: (icao, params) => apiRequest(`/notams/airport/${icao}/`, { params }),

  /**
   * Get NOTAM statistics
   * @returns {Promise<Object>} NOTAM cache statistics
   */
  getNotamStats: () => apiRequest('/notams/stats/'),

  // =========================================================================
  // System endpoints
  // =========================================================================

  /**
   * Get comprehensive system status
   * @returns {Promise<Object>} System status with all component statuses
   */
  getSystemStatus: () => apiRequest('/system/status'),

  /**
   * Get health check status
   * @returns {Promise<Object>} Health status of all services
   */
  getHealthCheck: () => fetch('/health').then((r) => r.json()),

  /**
   * Get API information
   * @returns {Promise<Object>} API info and available endpoints
   */
  getSystemInfo: () => apiRequest('/system/info'),

  /**
   * Get external database statistics
   * @returns {Promise<Object>} External database stats
   */
  getDatabaseStats: () => apiRequest('/system/databases'),

  /**
   * Get geodata cache statistics
   * @returns {Promise<Object>} Geodata cache stats
   */
  getGeodataStats: () => apiRequest('/system/geodata'),

  /**
   * Get weather cache statistics
   * @returns {Promise<Object>} Weather cache stats
   */
  getWeatherStats: () => apiRequest('/system/weather'),

  // =========================================================================
  // Lookup endpoints
  // =========================================================================

  /**
   * Look up aircraft information by ICAO hex
   * @param {string} icao - ICAO hex code
   * @returns {Promise<Object>} Aircraft information from external databases
   */
  lookupAircraft: (icao) => apiRequest(`/lookup/aircraft/${icao}`),

  /**
   * Look up flight route by callsign
   * @param {string} callsign - Flight callsign
   * @returns {Promise<Object>} Route information
   */
  lookupRoute: (callsign) => apiRequest(`/lookup/route/${callsign}`),

  // =========================================================================
  // Aviation data endpoints
  // =========================================================================

  /**
   * Get METAR weather data
   * @param {Object} [params] - Query parameters
   * @returns {Promise<Object>} METAR data
   */
  getMetars: (params) => apiRequest('/aviation/metars/', { params }),

  /**
   * Get TAF forecasts
   * @param {Object} [params] - Query parameters
   * @returns {Promise<Object>} TAF data
   */
  getTafs: (params) => apiRequest('/aviation/tafs/', { params }),

  /**
   * Get PIREPs (Pilot Reports)
   * @param {Object} [params] - Query parameters
   * @returns {Promise<Object>} PIREP data
   */
  getPireps: (params) => apiRequest('/aviation/pireps/', { params }),

  /**
   * Get airport information
   * @param {Object} [params] - Query parameters
   * @returns {Promise<Object>} Airport data
   */
  getAirports: (params) => apiRequest('/aviation/airports/', { params }),

  /**
   * Get active wildfires near a point (cached Watch Duty markers)
   * @param {Object} [params] - { lat, lon, radius_nm }
   * @returns {Promise<Object>} { wildfires: [...], count }
   */
  getWildfires: (params) => apiRequest('/aviation/wildfires/', { params }),

  /**
   * Get the per-fire detail bundle (reports, cameras, scanner feeds)
   * @param {number|string} eventId - Watch Duty geo_event id
   * @returns {Promise<Object>} { event, reports, cameras, radio_feeds }
   */
  getWildfireBundle: (eventId) => apiRequest(`/aviation/wildfires/${eventId}/bundle/`),

  // =========================================================================
  // Map endpoints
  // =========================================================================

  /**
   * Get aircraft positions as GeoJSON
   * @param {Object} [params] - Query parameters
   * @returns {Promise<Object>} GeoJSON FeatureCollection
   */
  getMapGeoJson: (params) => apiRequest('/map/geojson/', { params }),

  // =========================================================================
  // Favorites endpoints
  // =========================================================================

  /**
   * Get user's favorite aircraft
   * @returns {Promise<Object>} Favorites list with count
   */
  getFavorites: () => apiRequest('/stats/favorites/'),

  /**
   * Toggle favorite status for an aircraft
   * @param {string} icao - ICAO hex code
   * @returns {Promise<Object>} Toggle result
   */
  toggleFavorite: (icao) => apiRequest(`/stats/favorites/toggle/${icao}/`, { method: 'POST' }),

  /**
   * Check if aircraft is a favorite
   * @param {string} icao - ICAO hex code
   * @returns {Promise<Object>} Favorite status
   */
  checkFavorite: (icao) => apiRequest(`/stats/favorites/check/${icao}/`),

  // =========================================================================
  // Notifications endpoints
  // =========================================================================

  /**
   * Get notifications
   * @param {Object} [params] - Query parameters
   * @returns {Promise<Object>} Notifications list
   */
  getNotifications: (params) => apiRequest('/notifications/', { params }),

  // =========================================================================
  // Admin endpoints
  // =========================================================================

  admin: {
    /**
     * Get all configuration settings
     * @returns {Promise<Object>} Configuration settings list
     */
    getConfigs: () => apiRequest('/admin/configs/'),

    /**
     * Get a specific configuration setting by ID
     * @param {number|string} id - Configuration ID
     * @returns {Promise<Object>} Configuration setting details
     */
    getConfig: (id) => apiRequest(`/admin/configs/${id}/`),

    /**
     * Update a configuration setting
     * @param {number|string} id - Configuration ID
     * @param {Object} data - Updated configuration data
     * @returns {Promise<Object>} Updated configuration setting
     */
    updateConfig: (id, data) =>
      apiRequest(`/admin/configs/${id}/`, { method: 'PATCH', body: data }),

    /**
     * Get configuration categories
     * @returns {Promise<Object>} Configuration categories list
     */
    getCategories: () => apiRequest('/admin/categories/'),

    /**
     * Get audit log entries
     * @param {Object} [params] - Query parameters (page, limit, user, action, etc.)
     * @returns {Promise<Object>} Audit log entries with pagination
     */
    getAuditLog: (params) => apiRequest('/admin/audit/', { params }),

    /**
     * Export all configuration settings
     * @returns {Promise<Object>} Exported configuration data
     */
    exportConfigs: () => apiRequest('/admin/export/'),

    /**
     * Import configuration settings
     * @param {Object} data - Configuration data to import
     * @returns {Promise<Object>} Import result
     */
    importConfigs: (data) => apiRequest('/admin/import/', { method: 'POST', body: data }),
  },

  // =========================================================================
  // Assistant chat sessions (saved conversations)
  // =========================================================================

  /**
   * List saved chat sessions for the current owner (account or X-Client-Id).
   * @returns {Promise<Object>} DRF paginated list of session summaries
   */
  getChatSessions: () => apiRequest('/assistant/sessions/'),

  /**
   * Get a single chat session with its ordered messages.
   * @param {number|string} id - Session id
   * @returns {Promise<Object>} Session with `messages`
   */
  getChatSession: (id) => apiRequest(`/assistant/sessions/${id}/`),

  /**
   * Create a new (empty) chat session.
   * @param {Object} body - `{ title?, surface? }`
   * @returns {Promise<Object>} Created session
   */
  createChatSession: (body) => apiRequest('/assistant/sessions/', { method: 'POST', body }),

  /**
   * Append completed turns to a session.
   * @param {number|string} id - Session id
   * @param {Array<Object>} messages - `[{ role, text, steps?, sources?, photos?, maps? }]`
   * @returns {Promise<Object>} Updated session with messages
   */
  appendChatMessages: (id, messages) =>
    apiRequest(`/assistant/sessions/${id}/messages/`, { method: 'POST', body: { messages } }),

  /**
   * Delete a saved chat session.
   * @param {number|string} id - Session id
   * @returns {Promise<null>}
   */
  deleteChatSession: (id) => apiRequest(`/assistant/sessions/${id}/`, { method: 'DELETE' }),

  /**
   * Suggested follow-up prompts for the current conversation. Generated by a
   * separate, tool-free LLM context (never touches the agent's answer).
   * @param {Array<{role:string,content:string}>} history - prior turns
   * @param {string} [context] - optional page context
   * @returns {Promise<{suggestions: string[]}>}
   */
  getAssistantSuggestions: (history, context) =>
    apiRequest('/assistant/suggest/', {
      method: 'POST',
      body: context ? { history, context } : { history },
    }),
};

export default api;
