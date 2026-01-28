// @ts-check
import { test as base, expect } from '@playwright/test';

/**
 * Mock data generators for API responses
 */
const mockData = {
  /**
   * Generate mock aircraft data
   * @param {number} count - Number of aircraft to generate
   * @returns {Array} Array of aircraft objects
   */
  generateAircraft(count = 5) {
    return Array.from({ length: count }, (_, i) => ({
      hex: `ABC${String(i + 1).padStart(3, '0')}`,
      flight: `SKY${100 + i}`,
      registration: `N${1000 + i}SK`,
      type: ['B738', 'A320', 'B77W', 'E190', 'CRJ9'][i % 5],
      squawk: String(1200 + i),
      lat: 37.7749 + (Math.random() - 0.5) * 2,
      lon: -122.4194 + (Math.random() - 0.5) * 2,
      altitude: 10000 + i * 1000,
      speed: 250 + i * 10,
      track: i * 45,
      vertical_rate: i % 2 === 0 ? 500 : -500,
      seen: Date.now() / 1000,
      seen_pos: Date.now() / 1000,
      messages: 100 + i * 10,
      category: 'A3',
      emergency: null,
    }));
  },

  /**
   * Generate mock ACARS messages
   * @param {number} count - Number of messages to generate
   * @returns {Array} Array of ACARS message objects
   */
  generateAcarsMessages(count = 3) {
    return Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      timestamp: new Date(Date.now() - i * 60000).toISOString(),
      flight: `SKY${100 + i}`,
      registration: `N${1000 + i}SK`,
      label: ['H1', 'SA', 'B6'][i % 3],
      text: `ACARS message content ${i + 1}`,
      mode: 'VHF',
      frequency: 131.550,
    }));
  },

  /**
   * Generate mock alert rules
   * @param {number} count - Number of rules to generate
   * @returns {Array} Array of alert rule objects
   */
  generateAlertRules(count = 2) {
    return Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      name: `Alert Rule ${i + 1}`,
      enabled: true,
      conditions: [
        {
          field: 'altitude',
          operator: i % 2 === 0 ? 'less_than' : 'greater_than',
          value: i % 2 === 0 ? 5000 : 40000,
        },
      ],
      actions: ['notification'],
      created_at: new Date(Date.now() - i * 86400000).toISOString(),
    }));
  },

  /**
   * Generate mock system status
   * @returns {Object} System status object
   */
  generateSystemStatus() {
    return {
      status: 'healthy',
      uptime: 86400,
      version: '2.5.0',
      receivers: {
        adsb: { connected: true, messages_per_second: 150 },
        acars: { connected: true, messages_per_second: 5 },
      },
      database: {
        connected: true,
        size_mb: 512,
      },
    };
  },

  /**
   * Generate mock history data
   * @param {string} hex - Aircraft hex code
   * @param {number} points - Number of track points
   * @returns {Object} History data object
   */
  generateHistory(hex, points = 20) {
    const baseTime = Date.now() / 1000;
    return {
      hex,
      trace: Array.from({ length: points }, (_, i) => ({
        lat: 37.7749 + i * 0.01,
        lon: -122.4194 + i * 0.01,
        alt: 10000 + i * 500,
        gs: 300 + i * 5,
        track: 45,
        timestamp: baseTime - (points - i) * 60,
      })),
    };
  },

  /**
   * Generate mock Cannonball threats (law enforcement/helicopter aircraft)
   * @param {number} count - Number of threats to generate
   * @param {Object} userPosition - User's position {lat, lon}
   * @returns {Array} Array of threat objects
   */
  generateCannonballThreats(count = 3, userPosition = { lat: 37.7749, lon: -122.4194 }) {
    const categories = ['Law Enforcement', 'State Police', 'Sheriff', 'Police Helicopter', 'News Helicopter'];
    const threatLevels = ['critical', 'warning', 'info'];
    const agencies = ['LAPD Air Support', 'CHP', 'SFPD', 'Sheriff Aviation', null];
    const patterns = [
      [{ type: 'circling', confidence_score: 0.85 }],
      [{ type: 'loitering', confidence_score: 0.72 }],
      [{ type: 'grid_search', confidence_score: 0.65 }],
      [],
    ];

    return Array.from({ length: count }, (_, i) => {
      const distanceNm = 2 + i * 3 + Math.random() * 2;
      const bearing = (i * 90 + Math.random() * 45) % 360;
      const threatLevel = threatLevels[Math.min(i, threatLevels.length - 1)];

      // Calculate position based on distance and bearing from user
      const latOffset = (distanceNm / 60) * Math.cos(bearing * Math.PI / 180);
      const lonOffset = (distanceNm / 60) * Math.sin(bearing * Math.PI / 180) / Math.cos(userPosition.lat * Math.PI / 180);

      return {
        icao_hex: `A${String(i + 1).padStart(5, '0')}`,
        hex: `A${String(i + 1).padStart(5, '0')}`,
        callsign: i % 2 === 0 ? `N${900 + i}PD` : `LAPD${i + 1}`,
        category: categories[i % categories.length],
        description: `${categories[i % categories.length]} aircraft`,
        distance_nm: parseFloat(distanceNm.toFixed(2)),
        bearing: parseFloat(bearing.toFixed(1)),
        direction: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.floor(bearing / 45) % 8],
        altitude: 1500 + i * 500,
        ground_speed: 80 + i * 20,
        track: (bearing + 180) % 360,
        trend: ['approaching', 'holding', 'departing'][i % 3],
        threat_level: threatLevel,
        is_law_enforcement: i < 2,
        is_helicopter: i % 2 === 0,
        is_known_le: i === 0,
        known_le: i === 0,
        lat: userPosition.lat + latOffset,
        lon: userPosition.lon + lonOffset,
        closing_speed: i === 0 ? 45 : i === 1 ? 20 : -10,
        urgency_score: Math.max(0, 80 - i * 25),
        patterns: patterns[i % patterns.length],
        agency_name: agencies[i % agencies.length],
        agency_type: i < 2 ? 'local' : null,
        operator_name: agencies[i % agencies.length],
      };
    });
  },

  /**
   * Generate mock Cannonball sessions
   * @param {number} count - Number of sessions to generate
   * @returns {Array} Array of session objects
   */
  generateCannonballSessions(count = 2) {
    return Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      icao_hex: `A${String(i + 1).padStart(5, '0')}`,
      callsign: `N${900 + i}PD`,
      is_active: i === 0,
      threat_level: i === 0 ? 'warning' : 'info',
      urgency_score: 60 - i * 20,
      distance_nm: 5 + i * 3,
      bearing: 45 + i * 90,
      closing_speed_kts: i === 0 ? 30 : -15,
      last_seen: new Date(Date.now() - i * 60000).toISOString(),
      pattern_count: 2 - i,
      alert_count: 3 - i,
      identification_method: 'callsign',
      identification_reason: 'Matches law enforcement callsign pattern',
      operator_name: i === 0 ? 'LAPD Air Support' : null,
    }));
  },

  /**
   * Generate mock Cannonball patterns
   * @param {number} count - Number of patterns to generate
   * @returns {Array} Array of pattern objects
   */
  generateCannonballPatterns(count = 3) {
    const patternTypes = ['circling', 'loitering', 'grid_search', 'speed_trap'];
    const confidenceLevels = ['high', 'medium', 'low'];

    return Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      icao_hex: `A${String(i + 1).padStart(5, '0')}`,
      callsign: `N${900 + i}PD`,
      pattern_type: patternTypes[i % patternTypes.length],
      confidence: confidenceLevels[i % confidenceLevels.length],
      confidence_score: 0.9 - i * 0.15,
      detected_at: new Date(Date.now() - i * 300000).toISOString(),
      duration_seconds: 300 + i * 120,
      center_lat: 37.7749 + i * 0.01,
      center_lon: -122.4194 + i * 0.01,
    }));
  },

  /**
   * Generate mock Cannonball alerts
   * @param {number} count - Number of alerts to generate
   * @returns {Array} Array of alert objects
   */
  generateCannonballAlerts(count = 3) {
    const alertTypes = ['le_detected', 'pattern_detected', 'closing_fast', 'overhead'];
    const priorities = ['critical', 'warning', 'info'];

    return Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      session_icao: `A${String(i + 1).padStart(5, '0')}`,
      alert_type: alertTypes[i % alertTypes.length],
      priority: priorities[i % priorities.length],
      title: `Alert ${i + 1}: ${alertTypes[i % alertTypes.length].replace('_', ' ')}`,
      distance_nm: 3 + i * 2,
      acknowledged: i > 0,
      created_at: new Date(Date.now() - i * 120000).toISOString(),
    }));
  },

  /**
   * Generate mock Cannonball stats
   * @returns {Object} Stats summary object
   */
  generateCannonballStats() {
    return {
      current: {
        active_sessions: 2,
        threats: 3,
      },
      today: {
        alerts: 12,
        patterns: 8,
      },
      week: {
        sessions: 45,
        alerts: 67,
      },
      timestamp: new Date().toISOString(),
    };
  },

  /**
   * Generate mock known LE aircraft
   * @param {number} count - Number of known aircraft to generate
   * @returns {Array} Array of known aircraft objects
   */
  generateCannonballKnownAircraft(count = 3) {
    const agencies = ['LAPD Air Support', 'CHP', 'LA County Sheriff'];
    const agencyTypes = ['local', 'state', 'local'];

    return Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      icao_hex: `A${String(i + 1).padStart(5, '0')}`,
      registration: `N${900 + i}PD`,
      aircraft_type: i % 2 === 0 ? 'AS350' : 'Bell 206',
      agency_name: agencies[i % agencies.length],
      agency_type: agencyTypes[i % agencyTypes.length],
      agency_state: 'CA',
      verified: i < 2,
      times_detected: 15 - i * 5,
      last_detected: new Date(Date.now() - i * 86400000).toISOString(),
    }));
  },
};

/**
 * WebSocket mock class for testing WebSocket functionality
 */
class WebSocketMock {
  constructor(page) {
    this.page = page;
    this.handlers = new Map();
    this.sentMessages = [];
    this.isSetup = false;
  }

  /**
   * Set up WebSocket interception
   */
  async setup() {
    if (this.isSetup) return;

    await this.page.addInitScript(() => {
      // Store original WebSocket
      window.__originalWebSocket = window.WebSocket;
      window.__wsInstances = [];
      window.__wsMockHandlers = {};

      // Create mock WebSocket class
      class MockWebSocket {
        constructor(url, protocols) {
          this.url = url;
          this.protocols = protocols;
          this.readyState = 0; // CONNECTING
          this.onopen = null;
          this.onclose = null;
          this.onmessage = null;
          this.onerror = null;
          this._messageQueue = [];

          window.__wsInstances.push(this);

          // Simulate connection after a short delay
          setTimeout(() => {
            this.readyState = 1; // OPEN
            if (this.onopen) {
              this.onopen({ type: 'open' });
            }
            // Process any queued messages
            this._messageQueue.forEach((msg) => {
              if (this.onmessage) {
                this.onmessage({ data: msg });
              }
            });
            this._messageQueue = [];
          }, 50);
        }

        send(data) {
          window.__wsSentMessages = window.__wsSentMessages || [];
          window.__wsSentMessages.push(data);

          // Dispatch custom event for test interception
          window.dispatchEvent(
            new CustomEvent('ws-send', { detail: { url: this.url, data } })
          );
        }

        close(code, reason) {
          this.readyState = 3; // CLOSED
          if (this.onclose) {
            this.onclose({ code: code || 1000, reason: reason || '' });
          }
        }

        // Method to simulate receiving messages (called from tests)
        _receiveMessage(data) {
          if (this.readyState === 1 && this.onmessage) {
            this.onmessage({ data: typeof data === 'string' ? data : JSON.stringify(data) });
          } else {
            this._messageQueue.push(typeof data === 'string' ? data : JSON.stringify(data));
          }
        }
      }

      // Static properties
      MockWebSocket.CONNECTING = 0;
      MockWebSocket.OPEN = 1;
      MockWebSocket.CLOSING = 2;
      MockWebSocket.CLOSED = 3;

      // Replace WebSocket
      window.WebSocket = MockWebSocket;
    });

    this.isSetup = true;
  }

  /**
   * Send a message to all WebSocket instances
   * @param {Object|string} data - Data to send
   */
  async sendMessage(data) {
    await this.page.evaluate((message) => {
      window.__wsInstances.forEach((ws) => {
        ws._receiveMessage(message);
      });
    }, data);
  }

  /**
   * Send aircraft position update via WebSocket
   * @param {Object} aircraft - Aircraft data
   */
  async sendAircraftUpdate(aircraft) {
    await this.sendMessage({
      type: 'aircraft_update',
      data: aircraft,
    });
  }

  /**
   * Send ACARS message via WebSocket
   * @param {Object} message - ACARS message data
   */
  async sendAcarsMessage(message) {
    await this.sendMessage({
      type: 'acars_message',
      data: message,
    });
  }

  /**
   * Send alert notification via WebSocket
   * @param {Object} alert - Alert data
   */
  async sendAlertNotification(alert) {
    await this.sendMessage({
      type: 'alert',
      data: alert,
    });
  }

  /**
   * Send Cannonball session started message
   * @param {string} sessionId - Session ID
   */
  async sendCannonballSessionStarted(sessionId = 'test-session-123') {
    await this.sendMessage({
      type: 'session_started',
      session_id: sessionId,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send Cannonball threats update via WebSocket
   * @param {Array} threats - Array of threat objects
   */
  async sendCannonballThreats(threats) {
    await this.sendMessage({
      type: 'threats',
      data: threats,
      count: threats.length,
      position: { lat: 37.7749, lon: -122.4194 },
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send Cannonball radius updated confirmation
   * @param {number} radiusNm - New radius in nautical miles
   */
  async sendCannonballRadiusUpdated(radiusNm) {
    await this.sendMessage({
      type: 'radius_updated',
      radius_nm: radiusNm,
    });
  }

  /**
   * Send Cannonball error message
   * @param {string} message - Error message
   */
  async sendCannonballError(message) {
    await this.sendMessage({
      type: 'error',
      message,
    });
  }

  /**
   * Get all messages sent by the client
   * @returns {Promise<Array>} Array of sent messages
   */
  async getSentMessages() {
    return await this.page.evaluate(() => window.__wsSentMessages || []);
  }

  /**
   * Clear sent messages
   */
  async clearSentMessages() {
    await this.page.evaluate(() => {
      window.__wsSentMessages = [];
    });
  }
}

/**
 * Extended test fixture with API mocking and helper functions
 */
export const test = base.extend({
  /**
   * Mock API routes handler
   */
  mockApi: async ({ page }, use) => {
    const mocks = new Map();

    const mockApi = {
      /**
       * Set up a mock response for an API endpoint
       * @param {string} path - API path (e.g., '/api/v1/aircraft')
       * @param {Object|Function} response - Response data or function returning response
       * @param {Object} options - Additional options
       */
      async mock(path, response, options = {}) {
        const { status = 200, headers = {}, method = '*' } = options;
        const fullPath = path.startsWith('/api') ? path : `/api/v1${path}`;

        mocks.set(fullPath, { response, status, headers, method });

        await page.route(`**${fullPath}*`, async (route) => {
          const request = route.request();
          const mockConfig = mocks.get(fullPath);

          if (mockConfig.method !== '*' && request.method() !== mockConfig.method) {
            return route.continue();
          }

          const responseData =
            typeof mockConfig.response === 'function'
              ? mockConfig.response(request)
              : mockConfig.response;

          await route.fulfill({
            status: mockConfig.status,
            contentType: 'application/json',
            headers: mockConfig.headers,
            body: JSON.stringify(responseData),
          });
        });
      },

      /**
       * Mock the aircraft list endpoint
       * @param {Array} aircraft - Aircraft data to return
       */
      async mockAircraftList(aircraft = mockData.generateAircraft()) {
        await this.mock('/aircraft', { aircraft, now: Date.now() / 1000 });
      },

      /**
       * Mock the aircraft detail endpoint
       * @param {string} hex - Aircraft hex code
       * @param {Object} data - Aircraft detail data
       */
      async mockAircraftDetail(hex, data = null) {
        const aircraft = data || {
          ...mockData.generateAircraft(1)[0],
          hex,
        };
        await this.mock(`/aircraft/${hex}`, aircraft);
      },

      /**
       * Mock the ACARS messages endpoint
       * @param {Array} messages - ACARS messages to return
       */
      async mockAcarsMessages(messages = mockData.generateAcarsMessages()) {
        await this.mock('/acars', { messages });
      },

      /**
       * Mock the alert rules endpoint
       * @param {Array} rules - Alert rules to return
       */
      async mockAlertRules(rules = mockData.generateAlertRules()) {
        await this.mock('/alerts/rules', rules);
      },

      /**
       * Mock the system status endpoint
       * @param {Object} status - System status data
       */
      async mockSystemStatus(status = mockData.generateSystemStatus()) {
        await this.mock('/system/status', status);
      },

      /**
       * Mock the auth config endpoint for public mode (no auth required)
       */
      async mockAuthConfig() {
        await this.mock('/auth/config', {
          auth_enabled: false,
          auth_mode: 'public',
          oidc_enabled: false,
        });
      },

      /**
       * Mock the history endpoint
       * @param {string} hex - Aircraft hex code
       * @param {Object} history - History data
       */
      async mockHistory(hex, history = null) {
        const data = history || mockData.generateHistory(hex);
        await this.mock(`/history/${hex}`, data);
      },

      /**
       * Mock an error response
       * @param {string} path - API path
       * @param {number} status - HTTP status code
       * @param {string} message - Error message
       */
      async mockError(path, status = 500, message = 'Internal Server Error') {
        await this.mock(path, { error: message }, { status });
      },

      /**
       * Mock the Cannonball threats endpoint
       * @param {Array} threats - Threat data to return
       */
      async mockCannonballThreats(threats = mockData.generateCannonballThreats()) {
        await this.mock('/cannonball/threats', {
          threats,
          count: threats.length,
          total_detected: threats.length,
          timestamp: new Date().toISOString(),
        });
      },

      /**
       * Mock the Cannonball location endpoint
       */
      async mockCannonballLocation() {
        await this.mock('/cannonball/location', {
          status: 'ok',
          location: { lat: 37.7749, lon: -122.4194 },
        }, { method: 'POST' });
      },

      /**
       * Mock the Cannonball activate endpoint
       */
      async mockCannonballActivate() {
        await this.mock('/cannonball/activate', {
          status: 'activated',
          user_id: 'test-user',
        }, { method: 'POST' });
      },

      /**
       * Mock the Cannonball sessions endpoint
       * @param {Array} sessions - Session data to return
       */
      async mockCannonballSessions(sessions = mockData.generateCannonballSessions()) {
        await this.mock('/cannonball/sessions', {
          sessions,
          count: sessions.length,
          active_count: sessions.filter(s => s.is_active).length,
        });
      },

      /**
       * Mock the Cannonball patterns endpoint
       * @param {Array} patterns - Pattern data to return
       */
      async mockCannonballPatterns(patterns = mockData.generateCannonballPatterns()) {
        await this.mock('/cannonball/patterns', {
          patterns,
          count: patterns.length,
          by_type: {
            circling: patterns.filter(p => p.pattern_type === 'circling').length,
            loitering: patterns.filter(p => p.pattern_type === 'loitering').length,
          },
        });
      },

      /**
       * Mock the Cannonball alerts endpoint
       * @param {Array} alerts - Alert data to return
       */
      async mockCannonballAlerts(alerts = mockData.generateCannonballAlerts()) {
        await this.mock('/cannonball/alerts', {
          alerts,
          count: alerts.length,
          unacknowledged: alerts.filter(a => !a.acknowledged).length,
        });
      },

      /**
       * Mock the Cannonball stats endpoint
       * @param {Object} stats - Stats data to return
       */
      async mockCannonballStats(stats = mockData.generateCannonballStats()) {
        await this.mock('/cannonball/stats/summary', stats);
      },

      /**
       * Mock the Cannonball known aircraft endpoint
       * @param {Array} aircraft - Known aircraft data to return
       */
      async mockCannonballKnownAircraft(aircraft = mockData.generateCannonballKnownAircraft()) {
        await this.mock('/cannonball/known-aircraft', {
          aircraft,
          count: aircraft.length,
          verified_count: aircraft.filter(a => a.verified).length,
        });
      },

      /**
       * Mock all Cannonball endpoints with default data
       */
      async mockAllCannonball() {
        await this.mockCannonballThreats();
        await this.mockCannonballLocation();
        await this.mockCannonballActivate();
        await this.mockCannonballSessions();
        await this.mockCannonballPatterns();
        await this.mockCannonballAlerts();
        await this.mockCannonballStats();
        await this.mockCannonballKnownAircraft();
      },

      /**
       * Clear all mocks
       */
      async clear() {
        mocks.clear();
        await page.unrouteAll();
      },
    };

    await use(mockApi);
  },

  /**
   * WebSocket mock handler
   */
  wsMock: async ({ page }, use) => {
    const wsMock = new WebSocketMock(page);
    await wsMock.setup();
    await use(wsMock);
  },

  /**
   * Helper functions for common test operations
   */
  helpers: async ({ page }, use) => {
    const helpers = {
      /**
       * Navigate to a hash route
       * @param {string} route - Route name (map, aircraft, alerts, etc.)
       */
      async navigateTo(route) {
        await page.goto(`/#${route}`);
        await page.waitForLoadState('domcontentloaded');
      },

      /**
       * Wait for an element with specific text
       * @param {string} text - Text to search for
       * @param {Object} options - Locator options
       */
      async waitForText(text, options = {}) {
        await page.getByText(text, options).waitFor({ state: 'visible' });
      },

      /**
       * Click an element by text
       * @param {string} text - Text of element to click
       */
      async clickByText(text) {
        await page.getByText(text).click();
      },

      /**
       * Fill an input by label
       * @param {string} label - Input label
       * @param {string} value - Value to fill
       */
      async fillByLabel(label, value) {
        await page.getByLabel(label).fill(value);
      },

      /**
       * Check if an element is visible
       * @param {string} selector - CSS selector
       * @returns {Promise<boolean>}
       */
      async isVisible(selector) {
        return await page.locator(selector).isVisible();
      },

      /**
       * Get all visible text content
       * @param {string} selector - CSS selector
       * @returns {Promise<Array<string>>}
       */
      async getAllText(selector) {
        return await page.locator(selector).allTextContents();
      },

      /**
       * Wait for API response
       * @param {string} path - API path to wait for
       * @returns {Promise<Response>}
       */
      async waitForApiResponse(path) {
        return await page.waitForResponse((response) =>
          response.url().includes(path)
        );
      },

      /**
       * Take a screenshot with a descriptive name
       * @param {string} name - Screenshot name
       */
      async screenshot(name) {
        await page.screenshot({
          path: `test-results/screenshots/${name}.png`,
          fullPage: true,
        });
      },

      /**
       * Simulate network offline
       */
      async goOffline() {
        await page.context().setOffline(true);
      },

      /**
       * Simulate network online
       */
      async goOnline() {
        await page.context().setOffline(false);
      },

      /**
       * Wait for page to be fully loaded
       */
      async waitForPageLoad() {
        await page.waitForLoadState('networkidle');
        await page.waitForLoadState('domcontentloaded');
      },

      /**
       * Scroll element into view
       * @param {string} selector - CSS selector
       */
      async scrollIntoView(selector) {
        await page.locator(selector).scrollIntoViewIfNeeded();
      },

      /**
       * Get computed style of element
       * @param {string} selector - CSS selector
       * @param {string} property - CSS property name
       * @returns {Promise<string>}
       */
      async getStyle(selector, property) {
        return await page.locator(selector).evaluate(
          (el, prop) => window.getComputedStyle(el).getPropertyValue(prop),
          property
        );
      },
    };

    await use(helpers);
  },
});

// Export expect for use in tests
export { expect };

// Export mock data generators
export { mockData };

// Export WebSocketMock for advanced usage
export { WebSocketMock };
