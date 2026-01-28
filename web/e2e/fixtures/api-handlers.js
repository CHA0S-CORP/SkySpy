/**
 * API Route Handler Factories for E2E Testing
 *
 * Provides factory functions to set up Playwright route mocks for all API endpoints.
 * Supports customizable responses and error simulation.
 */

import {
  mockAircraft,
  mockSafetyEvents,
  mockAlertRules,
  mockAlertHistory,
  mockAudioTransmissions,
  mockSessions,
  mockSightings,
  mockAcarsMessages,
  mockStats,
  mockSystemStatus,
  mockAirports,
  mockNavaids,
  allMockData,
} from './mock-data.js';

/**
 * Default API response wrapper for Django REST Framework style responses
 */
const wrapResponse = (data, options = {}) => {
  const { paginated = false, count = null } = options;

  if (paginated && Array.isArray(data)) {
    return {
      count: count ?? data.length,
      next: null,
      previous: null,
      results: data,
    };
  }

  return data;
};

/**
 * Create a JSON response object for Playwright route.fulfill()
 */
const jsonResponse = (data, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(data),
});

/**
 * Create an error response
 */
const errorResponse = (message, status = 500, detail = null) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify({
    detail: detail || message,
    error: message,
  }),
});

// =============================================================================
// Individual Handler Factories
// =============================================================================

/**
 * Aircraft endpoint handlers
 * Endpoints: /api/v1/aircraft, /api/v1/aircraft/stats, /api/v1/aircraft/top
 */
export function createAircraftHandlers(options = {}) {
  const {
    aircraft = mockAircraft,
    simulateError = false,
    errorMessage = 'Internal server error',
    errorStatus = 500,
    delay = 0,
  } = options;

  return {
    // Main aircraft list (real-time positions)
    '/api/v1/aircraft': async (route) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }
      return route.fulfill(jsonResponse({
        aircraft,
        now: Date.now() / 1000,
        messages: aircraft.reduce((sum, a) => sum + (a.messages || 0), 0),
      }));
    },

    // Aircraft statistics
    '/api/v1/aircraft/stats': async (route) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }
      return route.fulfill(jsonResponse({
        current_count: aircraft.length,
        military_count: aircraft.filter(a => a.dbFlags === 1).length,
        type_breakdown: mockStats.aircraft_by_type,
        tracking_quality: mockStats.tracking_quality,
      }));
    },

    // Top aircraft leaderboards
    '/api/v1/aircraft/top': async (route) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }
      return route.fulfill(jsonResponse(mockStats.leaderboards));
    },
  };
}

/**
 * Airframe/aircraft info endpoint handlers
 * Endpoints: /api/v1/airframes/:hex, /api/v1/lookup/aircraft/:hex
 */
export function createAirframeHandlers(options = {}) {
  const {
    aircraft = mockAircraft,
    simulateError = false,
    errorMessage = 'Internal server error',
    errorStatus = 500,
    notFoundBehavior = '404', // '404' or 'empty'
    delay = 0,
  } = options;

  // Build lookup map
  const airframeMap = {};
  aircraft.forEach(ac => {
    airframeMap[ac.hex?.toUpperCase()] = {
      icao_hex: ac.hex,
      registration: ac.r,
      type_code: ac.t,
      type_description: ac.desc,
      operator: ac.ownOp,
      category: ac.category,
      photos: [
        {
          id: `photo-${ac.hex}`,
          url: `https://example.com/photos/${ac.hex}.jpg`,
          thumbnail_url: `https://example.com/photos/${ac.hex}_thumb.jpg`,
          photographer: 'Test Photographer',
          source: 'planespotters',
        },
      ],
    };
  });

  return {
    // Single airframe lookup
    '/api/v1/airframes/:hex': async (route, request) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }

      const url = new URL(request.url());
      const pathParts = url.pathname.split('/');
      const hex = pathParts[pathParts.length - 1].replace('/', '').toUpperCase();

      const airframe = airframeMap[hex];
      if (!airframe) {
        if (notFoundBehavior === '404') {
          return route.fulfill(errorResponse('Aircraft not found', 404, 'Not found'));
        }
        return route.fulfill(jsonResponse({ icao_hex: hex, found: false }));
      }

      return route.fulfill(jsonResponse(airframe));
    },

    // Alternative lookup endpoint
    '/api/v1/lookup/aircraft/:hex': async (route, request) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }

      const url = new URL(request.url());
      const pathParts = url.pathname.split('/');
      const hex = pathParts[pathParts.length - 1].toUpperCase();

      const airframe = airframeMap[hex];
      if (!airframe) {
        return route.fulfill(jsonResponse({ icao_hex: hex, found: false }));
      }

      return route.fulfill(jsonResponse(airframe));
    },

    // Bulk airframes lookup
    '/api/v1/airframes': async (route, request) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }

      const url = new URL(request.url());
      const icaoIn = url.searchParams.get('icao_hex__in');

      if (icaoIn) {
        const hexes = icaoIn.split(',').map(h => h.toUpperCase());
        const results = hexes
          .map(hex => airframeMap[hex])
          .filter(Boolean);
        return route.fulfill(jsonResponse(wrapResponse(results, { paginated: true })));
      }

      return route.fulfill(jsonResponse(wrapResponse(Object.values(airframeMap), { paginated: true })));
    },
  };
}

/**
 * Safety events endpoint handlers
 * Endpoints: /api/v1/safety/events, /api/v1/safety/stats, /api/v1/safety/active
 */
export function createSafetyHandlers(options = {}) {
  const {
    events = mockSafetyEvents,
    simulateError = false,
    errorMessage = 'Internal server error',
    errorStatus = 500,
    delay = 0,
  } = options;

  return {
    // Safety events list
    '/api/v1/safety/events': async (route, request) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }

      const url = new URL(request.url());
      const icaoHex = url.searchParams.get('icao_hex');
      const hours = parseInt(url.searchParams.get('hours') || '24', 10);
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);

      let filtered = events;

      if (icaoHex) {
        filtered = filtered.filter(e =>
          e.icao?.toUpperCase() === icaoHex.toUpperCase() ||
          e.icao_2?.toUpperCase() === icaoHex.toUpperCase()
        );
      }

      return route.fulfill(jsonResponse(wrapResponse(filtered.slice(0, limit), { paginated: true })));
    },

    // Safety statistics
    '/api/v1/safety/stats': async (route) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }
      return route.fulfill(jsonResponse(mockStats.safety));
    },

    // Active safety events (real-time)
    '/api/v1/safety/active': async (route) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }
      const active = events.filter(e => !e.resolved);
      return route.fulfill(jsonResponse({ events: active }));
    },

    // Acknowledge safety event
    '/api/v1/safety/active/:id/acknowledge': async (route, request) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }
      return route.fulfill(jsonResponse({ success: true }));
    },

    // Safety monitor status
    '/api/v1/safety/monitor/status': async (route) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }
      return route.fulfill(jsonResponse({
        enabled: true,
        last_check: new Date().toISOString(),
        active_events: events.filter(e => !e.resolved).length,
      }));
    },
  };
}

/**
 * Alert rules endpoint handlers
 * Endpoints: /api/v1/alerts/rules, /api/v1/alerts/history
 */
export function createAlertHandlers(options = {}) {
  const {
    rules = mockAlertRules,
    history = mockAlertHistory,
    simulateError = false,
    errorMessage = 'Internal server error',
    errorStatus = 500,
    delay = 0,
  } = options;

  // Keep mutable state for CRUD operations
  let currentRules = [...rules];

  return {
    // Alert rules list
    '/api/v1/alerts/rules': async (route, request) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }

      const method = request.method();

      if (method === 'GET') {
        return route.fulfill(jsonResponse(wrapResponse(currentRules, { paginated: true })));
      }

      if (method === 'POST') {
        const body = JSON.parse(await request.postData() || '{}');
        const newRule = {
          id: `rule-${Date.now()}`,
          ...body,
          trigger_count: 0,
          last_triggered: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        currentRules.push(newRule);
        return route.fulfill(jsonResponse(newRule, 201));
      }

      return route.fulfill(errorResponse('Method not allowed', 405));
    },

    // Single rule operations
    '/api/v1/alerts/rules/:id': async (route, request) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }

      const url = new URL(request.url());
      const pathParts = url.pathname.split('/');
      const ruleId = pathParts[pathParts.length - 1];
      const method = request.method();

      const ruleIndex = currentRules.findIndex(r => r.id === ruleId);

      if (method === 'GET') {
        if (ruleIndex === -1) {
          return route.fulfill(errorResponse('Rule not found', 404));
        }
        return route.fulfill(jsonResponse(currentRules[ruleIndex]));
      }

      if (method === 'PATCH' || method === 'PUT') {
        if (ruleIndex === -1) {
          return route.fulfill(errorResponse('Rule not found', 404));
        }
        const body = JSON.parse(await request.postData() || '{}');
        currentRules[ruleIndex] = {
          ...currentRules[ruleIndex],
          ...body,
          updated_at: new Date().toISOString(),
        };
        return route.fulfill(jsonResponse(currentRules[ruleIndex]));
      }

      if (method === 'DELETE') {
        if (ruleIndex === -1) {
          return route.fulfill(errorResponse('Rule not found', 404));
        }
        currentRules.splice(ruleIndex, 1);
        return route.fulfill(jsonResponse({ success: true }));
      }

      return route.fulfill(errorResponse('Method not allowed', 405));
    },

    // Alert history
    '/api/v1/alerts/history': async (route, request) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }

      const url = new URL(request.url());
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);

      return route.fulfill(jsonResponse(wrapResponse(history.slice(0, limit), { paginated: true })));
    },

    // Acknowledge alert history item
    '/api/v1/alerts/history/:id': async (route, request) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }

      if (request.method() === 'PATCH') {
        return route.fulfill(jsonResponse({ success: true }));
      }

      return route.fulfill(errorResponse('Method not allowed', 405));
    },

    // Reset rules to initial state (for tests)
    _reset: () => {
      currentRules = [...rules];
    },
  };
}

/**
 * Audio transmissions endpoint handlers
 * Endpoints: /api/v1/audio, /api/v1/audio/matched
 */
export function createAudioHandlers(options = {}) {
  const {
    transmissions = mockAudioTransmissions,
    simulateError = false,
    errorMessage = 'Internal server error',
    errorStatus = 500,
    delay = 0,
  } = options;

  return {
    // Audio transmissions list
    '/api/v1/audio': async (route, request) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }

      const url = new URL(request.url());
      const showStats = url.searchParams.get('stats') === 'true';
      const limit = parseInt(url.searchParams.get('limit') || '100', 10);
      const status = url.searchParams.get('status');
      const channel = url.searchParams.get('channel');

      if (showStats) {
        return route.fulfill(jsonResponse(mockStats.audio));
      }

      let filtered = transmissions;

      if (status && status !== 'all') {
        filtered = filtered.filter(t => t.transcription_status === status);
      }

      if (channel && channel !== 'all') {
        filtered = filtered.filter(t => t.channel_name === channel);
      }

      return route.fulfill(jsonResponse({
        transmissions: filtered.slice(0, limit),
        total: filtered.length,
      }));
    },

    // Audio matched by callsign/hex
    '/api/v1/audio/matched': async (route, request) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }

      const url = new URL(request.url());
      const callsign = url.searchParams.get('callsign');
      const hex = url.searchParams.get('hex');

      let filtered = transmissions;

      if (callsign) {
        filtered = filtered.filter(t =>
          t.identified_airframes?.some(af =>
            af.callsign?.toUpperCase() === callsign.toUpperCase()
          )
        );
      }

      if (hex) {
        filtered = filtered.filter(t =>
          t.identified_airframes?.some(af =>
            af.icao_hex?.toUpperCase() === hex.toUpperCase()
          )
        );
      }

      return route.fulfill(jsonResponse({
        transmissions: filtered,
        total: filtered.length,
      }));
    },
  };
}

/**
 * History endpoint handlers
 * Endpoints: /api/v1/sessions, /api/v1/sightings, /api/v1/history/stats
 */
export function createHistoryHandlers(options = {}) {
  const {
    sessions = mockSessions,
    sightings = mockSightings,
    simulateError = false,
    errorMessage = 'Internal server error',
    errorStatus = 500,
    delay = 0,
  } = options;

  return {
    // Flight sessions
    '/api/v1/sessions': async (route, request) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }

      const url = new URL(request.url());
      const limit = parseInt(url.searchParams.get('limit') || '100', 10);
      const militaryOnly = url.searchParams.get('military_only') === 'true';

      let filtered = sessions;

      if (militaryOnly) {
        filtered = filtered.filter(s => s.is_military);
      }

      return route.fulfill(jsonResponse({
        sessions: filtered.slice(0, limit),
        total: filtered.length,
      }));
    },

    // Aircraft sightings
    '/api/v1/sightings': async (route, request) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }

      const url = new URL(request.url());
      const icaoHex = url.searchParams.get('icao_hex');
      const callsign = url.searchParams.get('callsign');
      const limit = parseInt(url.searchParams.get('limit') || '100', 10);

      let filtered = sightings;

      if (icaoHex) {
        filtered = filtered.filter(s => s.icao_hex?.toUpperCase() === icaoHex.toUpperCase());
      }

      if (callsign) {
        filtered = filtered.filter(s =>
          s.callsign?.toUpperCase().includes(callsign.toUpperCase())
        );
      }

      return route.fulfill(jsonResponse({
        sightings: filtered.slice(0, limit),
        total: filtered.length,
      }));
    },

    // History statistics
    '/api/v1/history/stats': async (route) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }
      return route.fulfill(jsonResponse({
        total_aircraft_24h: mockStats.total_aircraft_24h,
        total_positions_24h: mockStats.total_positions_24h,
        total_sessions_24h: mockStats.total_sessions_24h,
        unique_aircraft_24h: mockStats.unique_aircraft_24h,
      }));
    },
  };
}

/**
 * ACARS endpoint handlers
 * Endpoints: /api/v1/acars, /api/v1/acars/stats, /api/v1/acars/status, /api/v1/acars/labels
 */
export function createAcarsHandlers(options = {}) {
  const {
    messages = mockAcarsMessages,
    simulateError = false,
    errorMessage = 'Internal server error',
    errorStatus = 500,
    delay = 0,
  } = options;

  return {
    // ACARS messages list
    '/api/v1/acars': async (route, request) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }

      const url = new URL(request.url());
      const icaoHex = url.searchParams.get('icao_hex');
      const callsign = url.searchParams.get('callsign');
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);

      let filtered = messages;

      if (icaoHex) {
        filtered = filtered.filter(m => m.icao_hex?.toUpperCase() === icaoHex.toUpperCase());
      }

      if (callsign) {
        filtered = filtered.filter(m =>
          m.callsign?.toUpperCase().includes(callsign.toUpperCase())
        );
      }

      return route.fulfill(jsonResponse({
        messages: filtered.slice(0, limit),
        total: filtered.length,
      }));
    },

    // ACARS statistics
    '/api/v1/acars/stats': async (route) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }
      return route.fulfill(jsonResponse(mockStats.acars));
    },

    // ACARS receiver status
    '/api/v1/acars/status': async (route) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }
      return route.fulfill(jsonResponse({
        enabled: true,
        connected: true,
        sources: ['vdl2', 'acars'],
        messages_per_minute: 78,
      }));
    },

    // ACARS label reference
    '/api/v1/acars/labels': async (route) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }
      return route.fulfill(jsonResponse({
        labels: {
          'H1': { name: 'Departure Message', category: 'operational' },
          'H2': { name: 'Arrival Message', category: 'operational' },
          'C1': { name: 'Position Report', category: 'position' },
          '80': { name: 'Terminal Weather', category: 'weather' },
          '5Z': { name: 'Airline Designated', category: 'operational' },
        },
      }));
    },
  };
}

/**
 * System status endpoint handlers
 * Endpoints: /api/v1/system/status, /api/v1/system/health, /api/v1/system/info, /api/v1/system/databases
 */
export function createSystemHandlers(options = {}) {
  const {
    status = mockSystemStatus,
    simulateError = false,
    errorMessage = 'Internal server error',
    errorStatus = 500,
    delay = 0,
    unhealthy = false, // Simulate unhealthy state
  } = options;

  const healthyStatus = { ...status };
  const unhealthyStatus = {
    ...status,
    status: 'unhealthy',
    components: {
      ...status.components,
      database: { ...status.components.database, status: 'unhealthy' },
    },
  };

  return {
    // System status
    '/api/v1/system/status': async (route) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }
      return route.fulfill(jsonResponse(unhealthy ? unhealthyStatus : healthyStatus));
    },

    // Health check
    '/api/v1/system/health': async (route) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }
      return route.fulfill(jsonResponse({
        status: unhealthy ? 'unhealthy' : 'healthy',
        timestamp: new Date().toISOString(),
      }));
    },

    // System info
    '/api/v1/system/info': async (route) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }
      return route.fulfill(jsonResponse({
        version: status.version,
        uptime_seconds: status.uptime_seconds,
        receiver_location: status.receiver_location,
        features: status.features,
      }));
    },

    // Database stats
    '/api/v1/system/databases': async (route) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }
      return route.fulfill(jsonResponse({
        primary: status.components.database,
        redis: status.components.redis,
      }));
    },

    // Notifications config
    '/api/v1/notifications/config': async (route) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }
      return route.fulfill(jsonResponse({
        push_enabled: true,
        email_enabled: true,
        webhook_enabled: true,
      }));
    },

    // Notifications test
    '/api/v1/notifications/test': async (route, request) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }
      if (request.method() === 'POST') {
        return route.fulfill(jsonResponse({ success: true, message: 'Test notification sent' }));
      }
      return route.fulfill(errorResponse('Method not allowed', 405));
    },
  };
}

/**
 * Aviation data endpoint handlers
 * Endpoints: /api/v1/aviation/airports, /api/v1/aviation/navaids, /api/v1/aviation/airspaces
 */
export function createAviationHandlers(options = {}) {
  const {
    airports = mockAirports,
    navaids = mockNavaids,
    simulateError = false,
    errorMessage = 'Internal server error',
    errorStatus = 500,
    delay = 0,
  } = options;

  return {
    // Airports
    '/api/v1/aviation/airports': async (route, request) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }

      const url = new URL(request.url());
      const radius = parseFloat(url.searchParams.get('radius') || '50');

      // Filter by radius (simplified - assumes all are within radius for testing)
      const filtered = airports.filter(a => (a.distance_nm || 0) <= radius);

      return route.fulfill(jsonResponse({
        airports: filtered,
        total: filtered.length,
      }));
    },

    // NAVAIDs
    '/api/v1/aviation/navaids': async (route, request) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }

      const url = new URL(request.url());
      const radius = parseFloat(url.searchParams.get('radius') || '50');

      const filtered = navaids.filter(n => (n.distance_nm || 0) <= radius);

      return route.fulfill(jsonResponse({
        navaids: filtered,
        total: filtered.length,
      }));
    },

    // Airspaces (G-AIRMETs, etc.)
    '/api/v1/aviation/airspaces': async (route) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }
      return route.fulfill(jsonResponse({
        airspaces: [],
        total: 0,
      }));
    },

    // Airspace boundaries (static)
    '/api/v1/aviation/airspace-boundaries': async (route) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }
      return route.fulfill(jsonResponse({
        boundaries: [],
        total: 0,
      }));
    },

    // GeoJSON data
    '/api/v1/aviation/geojson/:type': async (route) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }
      return route.fulfill(jsonResponse({
        type: 'FeatureCollection',
        features: [],
      }));
    },
  };
}

/**
 * Stats endpoint handlers
 * Endpoints: /api/v1/stats/combined, /api/v1/stats/tracking-quality, etc.
 */
export function createStatsHandlers(options = {}) {
  const {
    stats = mockStats,
    simulateError = false,
    errorMessage = 'Internal server error',
    errorStatus = 500,
    delay = 0,
  } = options;

  return {
    // Combined stats
    '/api/v1/stats/combined': async (route) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }
      return route.fulfill(jsonResponse({
        tracking_quality: stats.tracking_quality,
        engagement: {
          total_sessions: stats.total_sessions_24h,
          unique_aircraft: stats.unique_aircraft_24h,
        },
        favorites: [],
        flight_patterns: stats.aircraft_by_type,
        geographic: {},
      }));
    },

    // Tracking quality
    '/api/v1/stats/tracking-quality': async (route) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }
      return route.fulfill(jsonResponse(stats.tracking_quality));
    },

    // Engagement
    '/api/v1/stats/engagement': async (route) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }
      return route.fulfill(jsonResponse({
        total_sessions: stats.total_sessions_24h,
        unique_aircraft: stats.unique_aircraft_24h,
      }));
    },

    // Favorites
    '/api/v1/stats/favorites': async (route) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }
      return route.fulfill(jsonResponse({ favorites: [] }));
    },

    // Flight patterns
    '/api/v1/stats/flight-patterns': async (route) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }
      return route.fulfill(jsonResponse(stats.aircraft_by_type));
    },

    // Geographic
    '/api/v1/stats/geographic': async (route) => {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (simulateError) {
        return route.fulfill(errorResponse(errorMessage, errorStatus));
      }
      return route.fulfill(jsonResponse({}));
    },
  };
}

// =============================================================================
// Main API Mocks Factory
// =============================================================================

/**
 * Set up all API route mocks for a Playwright page
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {Object} options - Configuration options
 * @param {Object} options.overrides - Override specific endpoint responses
 * @param {Object} options.errors - Simulate errors for specific endpoint categories
 * @param {number} options.globalDelay - Add delay to all responses (ms)
 * @param {boolean} options.logRequests - Log all API requests for debugging
 * @returns {Object} Object with reset methods and handler references
 */
export async function createApiMocks(page, options = {}) {
  const {
    overrides = {},
    errors = {},
    globalDelay = 0,
    logRequests = false,
  } = options;

  // Create all handlers with options
  const handlerFactories = {
    aircraft: createAircraftHandlers,
    airframes: createAirframeHandlers,
    safety: createSafetyHandlers,
    alerts: createAlertHandlers,
    audio: createAudioHandlers,
    history: createHistoryHandlers,
    acars: createAcarsHandlers,
    system: createSystemHandlers,
    aviation: createAviationHandlers,
    stats: createStatsHandlers,
  };

  const handlers = {};

  // Create handlers for each category
  for (const [category, factory] of Object.entries(handlerFactories)) {
    const categoryOptions = {
      delay: globalDelay,
      ...(errors[category] && {
        simulateError: true,
        errorMessage: errors[category].message || 'Simulated error',
        errorStatus: errors[category].status || 500,
      }),
      ...(overrides[category] || {}),
    };
    handlers[category] = factory(categoryOptions);
  }

  // Flatten all handlers into a single object
  const allHandlers = {};
  for (const categoryHandlers of Object.values(handlers)) {
    for (const [path, handler] of Object.entries(categoryHandlers)) {
      if (!path.startsWith('_')) { // Skip internal methods
        allHandlers[path] = handler;
      }
    }
  }

  // Apply route handlers to page
  for (const [pathPattern, handler] of Object.entries(allHandlers)) {
    // Convert path pattern to regex
    // e.g., '/api/v1/airframes/:hex' -> /\/api\/v1\/airframes\/[^\/]+/
    const regexPattern = pathPattern
      .replace(/:[^/]+/g, '[^/]+')
      .replace(/\//g, '\\/');

    const regex = new RegExp(`${regexPattern}(?:\\?.*)?$`);

    await page.route(regex, async (route, request) => {
      if (logRequests) {
        console.log(`[API Mock] ${request.method()} ${request.url()}`);
      }
      await handler(route, request);
    });
  }

  // Return object with utility methods
  return {
    handlers,

    /**
     * Update handlers for a specific category
     */
    updateCategory: async (category, options) => {
      if (handlerFactories[category]) {
        handlers[category] = handlerFactories[category]({
          delay: globalDelay,
          ...options,
        });
      }
    },

    /**
     * Reset all handlers to default state
     */
    reset: () => {
      // Reset alert rules state
      if (handlers.alerts?._reset) {
        handlers.alerts._reset();
      }
    },

    /**
     * Simulate error for a specific category
     */
    simulateError: async (category, errorOptions = {}) => {
      const { message = 'Simulated error', status = 500 } = errorOptions;
      if (handlerFactories[category]) {
        handlers[category] = handlerFactories[category]({
          delay: globalDelay,
          simulateError: true,
          errorMessage: message,
          errorStatus: status,
        });
      }
    },

    /**
     * Clear error simulation for a category
     */
    clearError: async (category) => {
      if (handlerFactories[category]) {
        handlers[category] = handlerFactories[category]({
          delay: globalDelay,
        });
      }
    },
  };
}

/**
 * Quick setup function for simple test cases
 * Sets up all API mocks with default mock data
 */
export async function setupDefaultMocks(page) {
  return createApiMocks(page, {
    logRequests: process.env.DEBUG === 'true',
  });
}

/**
 * Setup mocks with all errors simulated (for error handling tests)
 */
export async function setupErrorMocks(page, errorStatus = 500, errorMessage = 'Server error') {
  const errors = {};
  const categories = ['aircraft', 'airframes', 'safety', 'alerts', 'audio', 'history', 'acars', 'system', 'aviation', 'stats'];

  for (const category of categories) {
    errors[category] = { status: errorStatus, message: errorMessage };
  }

  return createApiMocks(page, { errors });
}

/**
 * Setup mocks with delayed responses (for loading state tests)
 */
export async function setupDelayedMocks(page, delayMs = 1000) {
  return createApiMocks(page, { globalDelay: delayMs });
}

// Export everything
export {
  jsonResponse,
  errorResponse,
  wrapResponse,
  allMockData,
};

export default createApiMocks;
