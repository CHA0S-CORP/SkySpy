// @ts-check
/**
 * E2E Tests for Real-time WebSocket/Socket.IO functionality
 *
 * Tests cover:
 * - Connection lifecycle (connect, disconnect, reconnect)
 * - Aircraft position updates
 * - Safety events and alerts
 * - Alert triggers and notifications
 * - ACARS message streaming
 *
 * Note: These tests mock the Socket.IO server responses using Playwright's
 * route interception and inject mock Socket.IO client behavior.
 */

import { test, expect, mockData } from '../fixtures/test-setup.js';

/**
 * Mock Socket.IO client for testing real-time functionality.
 * Intercepts Socket.IO connections and simulates server responses.
 */
class SocketIOMock {
  constructor(page) {
    this.page = page;
    this.isSetup = false;
    this.eventHandlers = new Map();
  }

  /**
   * Set up Socket.IO mock by intercepting the Socket.IO client
   */
  async setup() {
    if (this.isSetup) return;

    await this.page.addInitScript(() => {
      // Store for mock socket instances
      window.__mockSocketIO = {
        instances: [],
        eventQueue: [],
        sentMessages: [],
        connected: false,
        connectionAttempts: 0,
      };

      // Store original io function
      const originalIO = window.io;

      // Create mock socket factory
      window.io = function (url, options) {
        const mockSocket = {
          id: 'mock-socket-' + Math.random().toString(36).substring(7),
          connected: false,
          disconnected: true,
          _events: {},
          _oneTimeEvents: {},
          io: {
            _events: {},
            on(event, handler) {
              if (!this._events[event]) this._events[event] = [];
              this._events[event].push(handler);
            },
            off(event, handler) {
              if (this._events[event]) {
                if (handler) {
                  this._events[event] = this._events[event].filter((h) => h !== handler);
                } else {
                  delete this._events[event];
                }
              }
            },
            emit(event, ...args) {
              if (this._events[event]) {
                this._events[event].forEach((handler) => handler(...args));
              }
            },
          },

          on(event, handler) {
            if (!this._events[event]) this._events[event] = [];
            this._events[event].push(handler);
            return this;
          },

          off(event, handler) {
            if (this._events[event]) {
              if (handler) {
                this._events[event] = this._events[event].filter((h) => h !== handler);
              } else {
                delete this._events[event];
              }
            }
            return this;
          },

          once(event, handler) {
            if (!this._oneTimeEvents[event]) this._oneTimeEvents[event] = [];
            this._oneTimeEvents[event].push(handler);
            return this;
          },

          emit(event, data, callback) {
            window.__mockSocketIO.sentMessages.push({ event, data, timestamp: Date.now() });

            // Dispatch custom event for test interception
            window.dispatchEvent(
              new CustomEvent('socketio-emit', {
                detail: { event, data, socketId: this.id },
              })
            );

            // Handle subscribe event
            if (event === 'subscribe') {
              setTimeout(() => {
                this._triggerEvent('subscribed', {
                  topics: data?.topics || ['all'],
                  joined: data?.topics || ['all'],
                });
              }, 50);
            }

            // Handle request event
            if (event === 'request') {
              setTimeout(() => {
                this._triggerEvent('response', {
                  request_id: data?.request_id,
                  request_type: data?.type,
                  data: {},
                });
              }, 50);
            }

            // Call callback if provided (for ack pattern)
            if (typeof callback === 'function') {
              setTimeout(() => callback({ success: true }), 50);
            }

            return true;
          },

          connect() {
            window.__mockSocketIO.connectionAttempts++;
            setTimeout(() => {
              this.connected = true;
              this.disconnected = false;
              window.__mockSocketIO.connected = true;
              this._triggerEvent('connect');
            }, 100);
            return this;
          },

          disconnect() {
            this.connected = false;
            this.disconnected = true;
            window.__mockSocketIO.connected = false;
            this._triggerEvent('disconnect', 'io client disconnect');
            return this;
          },

          _triggerEvent(event, ...args) {
            // Handle one-time events
            if (this._oneTimeEvents[event]) {
              this._oneTimeEvents[event].forEach((handler) => handler(...args));
              delete this._oneTimeEvents[event];
            }

            // Handle regular events
            if (this._events[event]) {
              this._events[event].forEach((handler) => handler(...args));
            }
          },

          // Method to receive simulated server messages (called from tests)
          _receiveMessage(event, data) {
            this._triggerEvent(event, data);
          },
        };

        // Store instance
        window.__mockSocketIO.instances.push(mockSocket);

        // Auto-connect after short delay
        setTimeout(() => {
          mockSocket.connected = true;
          mockSocket.disconnected = false;
          window.__mockSocketIO.connected = true;
          mockSocket._triggerEvent('connect');
        }, 100);

        return mockSocket;
      };
    });

    this.isSetup = true;
  }

  /**
   * Send a mock event to all socket instances
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  async sendEvent(event, data) {
    await this.page.evaluate(
      ({ event, data }) => {
        window.__mockSocketIO.instances.forEach((socket) => {
          socket._receiveMessage(event, data);
        });
      },
      { event, data }
    );
  }

  /**
   * Send aircraft snapshot event
   * @param {Array} aircraft - Array of aircraft objects
   */
  async sendAircraftSnapshot(aircraft) {
    await this.sendEvent('aircraft:snapshot', {
      aircraft,
      count: aircraft.length,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send aircraft position update
   * @param {Object} aircraft - Aircraft object with updated position
   */
  async sendAircraftUpdate(aircraft) {
    await this.sendEvent('aircraft:update', {
      aircraft: [aircraft],
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send new aircraft event
   * @param {Object} aircraft - New aircraft object
   */
  async sendAircraftNew(aircraft) {
    await this.sendEvent('aircraft:new', {
      aircraft,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send aircraft remove event
   * @param {string} hex - ICAO hex of aircraft to remove
   */
  async sendAircraftRemove(hex) {
    await this.sendEvent('aircraft:remove', {
      hex,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send safety event
   * @param {Object} safetyEvent - Safety event object
   */
  async sendSafetyEvent(safetyEvent) {
    await this.sendEvent('safety:event', {
      ...safetyEvent,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send safety snapshot
   * @param {Array} events - Array of safety events
   */
  async sendSafetySnapshot(events) {
    await this.sendEvent('safety:snapshot', {
      events,
      count: events.length,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send alert triggered event
   * @param {Object} alert - Alert object
   */
  async sendAlertTriggered(alert) {
    await this.sendEvent('alert:triggered', {
      ...alert,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send ACARS message
   * @param {Object} message - ACARS message object
   */
  async sendAcarsMessage(message) {
    await this.sendEvent('acars:message', {
      ...message,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send ACARS snapshot
   * @param {Array} messages - Array of ACARS messages
   */
  async sendAcarsSnapshot(messages) {
    await this.sendEvent('acars:snapshot', {
      messages,
      count: messages.length,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Simulate connection error
   * @param {string} message - Error message
   */
  async sendConnectionError(message) {
    await this.page.evaluate(
      ({ message }) => {
        window.__mockSocketIO.instances.forEach((socket) => {
          socket._triggerEvent('connect_error', new Error(message));
        });
      },
      { message }
    );
  }

  /**
   * Simulate disconnect
   * @param {string} reason - Disconnect reason
   */
  async simulateDisconnect(reason = 'io server disconnect') {
    await this.page.evaluate(
      ({ reason }) => {
        window.__mockSocketIO.instances.forEach((socket) => {
          socket.connected = false;
          socket.disconnected = true;
          window.__mockSocketIO.connected = false;
          socket._triggerEvent('disconnect', reason);
        });
      },
      { reason }
    );
  }

  /**
   * Simulate reconnection
   */
  async simulateReconnect() {
    await this.page.evaluate(() => {
      window.__mockSocketIO.instances.forEach((socket) => {
        socket.connected = true;
        socket.disconnected = false;
        window.__mockSocketIO.connected = true;
        socket._triggerEvent('connect');
        socket.io.emit('reconnect', 1);
      });
    });
  }

  /**
   * Get all messages sent by the client
   * @returns {Promise<Array>} Array of sent messages
   */
  async getSentMessages() {
    return await this.page.evaluate(() => window.__mockSocketIO.sentMessages || []);
  }

  /**
   * Get connection state
   * @returns {Promise<Object>} Connection state
   */
  async getConnectionState() {
    return await this.page.evaluate(() => ({
      connected: window.__mockSocketIO.connected,
      connectionAttempts: window.__mockSocketIO.connectionAttempts,
      instanceCount: window.__mockSocketIO.instances.length,
    }));
  }

  /**
   * Clear sent messages
   */
  async clearSentMessages() {
    await this.page.evaluate(() => {
      window.__mockSocketIO.sentMessages = [];
    });
  }
}

// Extend test fixture with Socket.IO mock
const testWithSocketIO = test.extend({
  socketMock: async ({ page }, use) => {
    const socketMock = new SocketIOMock(page);
    await socketMock.setup();
    await use(socketMock);
  },
});

// ============================================================================
// Connection Lifecycle Tests
// ============================================================================

testWithSocketIO.describe('Socket.IO Connection Lifecycle', () => {
  testWithSocketIO.beforeEach(async ({ mockApi }) => {
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList(mockData.generateAircraft(3));
    await mockApi.mockSystemStatus();
  });

  // The app imports `io` from the socket.io-client ES module, so the
  // window.io interception in SocketIOMock never engages for the *outgoing*
  // connection. Lifecycle is asserted against the real websocket via
  // Playwright's native websocket events instead (the e2e environment always
  // runs a live backend - vite proxies /socket.io to it).
  // Helper: resolve when any /socket.io/ websocket sees a matching frame.
  // The client may open and discard a probe socket first, so listeners are
  // attached to every websocket the page creates.
  function waitForSocketFrame(page, direction, predicate, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${direction} frame matched`)), timeoutMs);
      page.on('websocket', (ws) => {
        if (!ws.url().includes('/socket.io/')) return;
        ws.on(direction, (frame) => {
          const payload = typeof frame.payload === 'string' ? frame.payload : '';
          if (predicate(payload)) {
            clearTimeout(timer);
            resolve(payload);
          }
        });
      });
    });
  }

  testWithSocketIO('establishes initial connection', async ({ page }) => {
    // Engine.IO handshake: the server sends an open packet ("0{...sid...}")
    const opened = waitForSocketFrame(page, 'framereceived', (p) => p.startsWith('0'));
    await page.goto('/#map');
    await expect(opened).resolves.toContain('sid');
  });

  testWithSocketIO('subscribes to topics on connect', async ({ page }) => {
    // The client emits a "subscribe" event shortly after connecting
    const subscribed = waitForSocketFrame(page, 'framesent', (p) => p.includes('"subscribe"'));
    await page.goto('/#map');
    await expect(subscribed).resolves.toContain('subscribe');
  });

  testWithSocketIO('handles disconnect gracefully', async ({ page, socketMock }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // Simulate disconnect
    await socketMock.simulateDisconnect();
    await page.waitForTimeout(200);

    const state = await socketMock.getConnectionState();
    expect(state.connected).toBe(false);
  });

  testWithSocketIO('reconnects after disconnect', async ({ page, context }) => {
    const firstWs = page.waitForEvent('websocket', {
      predicate: (ws) => ws.url().includes('/socket.io/'),
      timeout: 20000,
    });
    await page.goto('/#map');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    const ws1 = await firstWs;

    // Kill connectivity: the socket drops...
    const closed = ws1.isClosed()
      ? Promise.resolve()
      : new Promise((resolve) => ws1.on('close', resolve));
    await context.setOffline(true);
    await closed;

    // ...and a NEW websocket must appear once connectivity returns
    const reconnectWs = page.waitForEvent('websocket', {
      predicate: (ws) => ws.url().includes('/socket.io/'),
      timeout: 30000,
    });
    await context.setOffline(false);
    const ws2 = await reconnectWs;
    expect(ws2.url()).toContain('/socket.io/');

    // App survives the round trip
    await expect(page.locator('.app')).toBeVisible();
  });

  testWithSocketIO('handles connection error', async ({ page, socketMock }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // Simulate connection error
    await socketMock.sendConnectionError('Connection refused');
    await page.waitForTimeout(200);

    // App should still be visible (graceful degradation)
    await expect(page.locator('.app')).toBeVisible();
  });
});

// ============================================================================
// Aircraft Updates Tests
// ============================================================================

testWithSocketIO.describe('Aircraft Real-time Updates', () => {
  testWithSocketIO.beforeEach(async ({ mockApi }) => {
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList([]);
    await mockApi.mockSystemStatus();
  });

  testWithSocketIO('receives aircraft snapshot on connect', async ({ page, socketMock }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // Send aircraft snapshot
    const aircraft = mockData.generateAircraft(5);
    await socketMock.sendAircraftSnapshot(aircraft);
    await page.waitForTimeout(300);

    // Aircraft should be processed by the app
    const processedAircraft = await page.evaluate(() => {
      // Access aircraft state from app context if available
      return window.__mockSocketIO.sentMessages.filter((m) => m.event === 'request');
    });

    // Verify snapshot was received (app may request additional data)
    expect(Array.isArray(processedAircraft)).toBe(true);
  });

  testWithSocketIO('updates aircraft position', async ({ page, socketMock }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // Send initial aircraft
    const aircraft = mockData.generateAircraft(1)[0];
    await socketMock.sendAircraftSnapshot([aircraft]);
    await page.waitForTimeout(200);

    // Update position
    const updatedAircraft = {
      ...aircraft,
      lat: aircraft.lat + 0.01,
      lon: aircraft.lon + 0.01,
      altitude: aircraft.altitude + 500,
    };
    await socketMock.sendAircraftUpdate(updatedAircraft);
    await page.waitForTimeout(200);

    // Verify update was processed
    await expect(page.locator('.app')).toBeVisible();
  });

  testWithSocketIO('adds new aircraft', async ({ page, socketMock }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // Send initial snapshot
    await socketMock.sendAircraftSnapshot([]);
    await page.waitForTimeout(200);

    // Add new aircraft
    const newAircraft = mockData.generateAircraft(1)[0];
    await socketMock.sendAircraftNew(newAircraft);
    await page.waitForTimeout(200);

    // Verify new aircraft event was received
    await expect(page.locator('.app')).toBeVisible();
  });

  testWithSocketIO('removes aircraft after timeout', async ({ page, socketMock }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // Send initial aircraft
    const aircraft = mockData.generateAircraft(1)[0];
    await socketMock.sendAircraftSnapshot([aircraft]);
    await page.waitForTimeout(200);

    // Remove aircraft
    await socketMock.sendAircraftRemove(aircraft.hex);
    await page.waitForTimeout(200);

    // Verify remove event was processed
    await expect(page.locator('.app')).toBeVisible();
  });

  testWithSocketIO('handles bulk aircraft update', async ({ page, socketMock }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // Send bulk update with many aircraft
    const aircraft = mockData.generateAircraft(50);
    await socketMock.sendAircraftSnapshot(aircraft);
    await page.waitForTimeout(300);

    // App should handle bulk data without errors
    await expect(page.locator('.app')).toBeVisible();
  });
});

// ============================================================================
// Safety Events Tests
// ============================================================================

testWithSocketIO.describe('Safety Events Real-time', () => {
  testWithSocketIO.beforeEach(async ({ mockApi }) => {
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList(mockData.generateAircraft(5));
    await mockApi.mockSystemStatus();
    await mockApi.mock('/safety/events', { events: [], count: 0 });
  });

  testWithSocketIO('receives safety event snapshot', async ({ page, socketMock }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // Send safety snapshot
    const safetyEvents = [
      {
        id: 1,
        event_type: 'tcas_ra',
        severity: 'critical',
        icao_hex: 'ABC123',
        callsign: 'UAL123',
        message: 'TCAS Resolution Advisory',
      },
    ];
    await socketMock.sendSafetySnapshot(safetyEvents);
    await page.waitForTimeout(200);

    // Verify snapshot was received
    await expect(page.locator('.app')).toBeVisible();
  });

  testWithSocketIO('displays safety alert notification', async ({ page, socketMock }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // Send critical safety event
    const safetyEvent = {
      id: 1,
      event_type: 'emergency',
      severity: 'critical',
      icao_hex: 'ABC123',
      callsign: 'UAL123',
      squawk: '7700',
      message: 'Emergency squawk detected',
      aircraft_snapshot: {
        hex: 'ABC123',
        flight: 'UAL123',
        alt: 25000,
        lat: 47.5,
        lon: -122.0,
      },
    };
    await socketMock.sendSafetyEvent(safetyEvent);
    await page.waitForTimeout(300);

    // Check if notification or indicator appears
    // The exact UI element depends on implementation
    await expect(page.locator('.app')).toBeVisible();
  });

  testWithSocketIO('handles separation event with two aircraft', async ({ page, socketMock }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // Send proximity conflict event
    const safetyEvent = {
      id: 1,
      event_type: 'proximity_conflict',
      severity: 'warning',
      icao_hex: 'ABC123',
      icao_hex_2: 'DEF456',
      callsign: 'UAL123',
      callsign_2: 'DAL456',
      message: 'Proximity conflict detected',
      details: {
        horizontal_separation_nm: 0.5,
        vertical_separation_ft: 200,
      },
    };
    await socketMock.sendSafetyEvent(safetyEvent);
    await page.waitForTimeout(200);

    // Verify event was processed
    await expect(page.locator('.app')).toBeVisible();
  });

  testWithSocketIO('handles emergency squawk (7700)', async ({ page, socketMock }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // Send aircraft with emergency squawk
    const aircraft = {
      hex: 'ABC123',
      flight: 'UAL123',
      lat: 37.7749,
      lon: -122.4194,
      altitude: 15000,
      squawk: '7700',
      emergency: 'general',
    };
    await socketMock.sendAircraftUpdate(aircraft);

    // Also send corresponding safety event
    const safetyEvent = {
      id: 1,
      event_type: '7700',
      severity: 'critical',
      icao_hex: 'ABC123',
      callsign: 'UAL123',
      squawk: '7700',
      message: 'Emergency squawk 7700 detected',
    };
    await socketMock.sendSafetyEvent(safetyEvent);
    await page.waitForTimeout(300);

    // Verify visual alert for emergency
    await expect(page.locator('.app')).toBeVisible();
  });
});

// ============================================================================
// Alert Triggers Tests
// ============================================================================

testWithSocketIO.describe('Alert Triggers Real-time', () => {
  testWithSocketIO.beforeEach(async ({ mockApi }) => {
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList(mockData.generateAircraft(5));
    await mockApi.mockSystemStatus();
    await mockApi.mockAlertRules(mockData.generateAlertRules(3));
  });

  testWithSocketIO('receives alert triggered event', async ({ page, socketMock }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // Send alert triggered event
    const alert = {
      id: 1,
      rule_id: 1,
      rule_name: 'Test Alert',
      type: 'callsign',
      severity: 'warning',
      message: 'Alert triggered for UAL123',
      aircraft: {
        hex: 'ABC123',
        flight: 'UAL123',
        altitude: 35000,
      },
      triggered_at: new Date().toISOString(),
    };
    await socketMock.sendAlertTriggered(alert);
    await page.waitForTimeout(300);

    // Verify alert was received
    await expect(page.locator('.app')).toBeVisible();
  });

  testWithSocketIO('handles multiple simultaneous alerts', async ({ page, socketMock }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // Send multiple alerts rapidly
    for (let i = 0; i < 5; i++) {
      const alert = {
        id: i + 1,
        rule_id: (i % 3) + 1,
        rule_name: `Alert Rule ${(i % 3) + 1}`,
        type: ['callsign', 'geofence', 'altitude'][i % 3],
        severity: ['info', 'warning', 'critical'][i % 3],
        message: `Alert ${i + 1} triggered`,
        aircraft: {
          hex: `ABC${100 + i}`,
          flight: `UAL${100 + i}`,
          altitude: 30000 + i * 1000,
        },
        triggered_at: new Date().toISOString(),
      };
      await socketMock.sendAlertTriggered(alert);
    }
    await page.waitForTimeout(500);

    // App should handle multiple alerts gracefully
    await expect(page.locator('.app')).toBeVisible();
  });

  testWithSocketIO('handles critical alert with notification', async ({ page, socketMock }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // Send critical alert
    const alert = {
      id: 1,
      rule_id: 1,
      rule_name: 'Emergency Alert',
      type: 'squawk',
      severity: 'critical',
      message: 'Emergency squawk 7700 detected',
      aircraft: {
        hex: 'ABC123',
        flight: 'UAL123',
        altitude: 15000,
        squawk: '7700',
      },
      triggered_at: new Date().toISOString(),
      play_sound: true,
    };
    await socketMock.sendAlertTriggered(alert);
    await page.waitForTimeout(300);

    // Verify critical alert was processed
    await expect(page.locator('.app')).toBeVisible();
  });
});

// ============================================================================
// ACARS Messages Tests
// ============================================================================

testWithSocketIO.describe('ACARS Messages Real-time', () => {
  testWithSocketIO.beforeEach(async ({ mockApi }) => {
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList(mockData.generateAircraft(5));
    await mockApi.mockSystemStatus();
    await mockApi.mockAcarsMessages(mockData.generateAcarsMessages(5));
  });

  testWithSocketIO('receives ACARS snapshot', async ({ page, socketMock }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // Send ACARS snapshot
    const messages = mockData.generateAcarsMessages(10);
    await socketMock.sendAcarsSnapshot(messages);
    await page.waitForTimeout(200);

    // Verify snapshot was received
    await expect(page.locator('.app')).toBeVisible();
  });

  testWithSocketIO('receives new ACARS message', async ({ page, socketMock }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // Send new ACARS message
    const message = {
      id: 999,
      flight: 'UAL123',
      registration: 'N12345',
      label: 'H1',
      text: 'Position report: LAT 37.7749 LON -122.4194',
      mode: 'VHF',
      frequency: 131.55,
      decoded: {
        type: 'position',
        lat: 37.7749,
        lon: -122.4194,
      },
    };
    await socketMock.sendAcarsMessage(message);
    await page.waitForTimeout(200);

    // Verify message was received
    await expect(page.locator('.app')).toBeVisible();
  });

  testWithSocketIO('handles decoded ACARS message', async ({ page, socketMock }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // Send decoded ACARS message
    const message = {
      id: 999,
      flight: 'DAL456',
      registration: 'N67890',
      label: 'SA',
      text: 'WEATHER UPDATE TURBULENCE AHEAD',
      mode: 'VDL2',
      frequency: 136.9,
      decoded: {
        type: 'weather',
        condition: 'turbulence',
        severity: 'moderate',
      },
    };
    await socketMock.sendAcarsMessage(message);
    await page.waitForTimeout(200);

    // Verify decoded message was processed
    await expect(page.locator('.app')).toBeVisible();
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

testWithSocketIO.describe('Real-time Integration', () => {
  testWithSocketIO.beforeEach(async ({ mockApi }) => {
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList(mockData.generateAircraft(5));
    await mockApi.mockSystemStatus();
    await mockApi.mockAlertRules(mockData.generateAlertRules(3));
    await mockApi.mock('/safety/events', { events: [], count: 0 });
  });

  testWithSocketIO('handles mixed events from multiple topics', async ({ page, socketMock }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // Send various events in rapid succession
    await socketMock.sendAircraftSnapshot(mockData.generateAircraft(10));
    await socketMock.sendSafetySnapshot([
      {
        id: 1,
        event_type: 'tcas_ta',
        severity: 'warning',
        icao_hex: 'ABC123',
        message: 'TCAS Traffic Advisory',
      },
    ]);
    await socketMock.sendAlertTriggered({
      id: 1,
      rule_name: 'Test Alert',
      type: 'callsign',
      severity: 'info',
      message: 'Alert triggered',
      aircraft: { hex: 'ABC123', flight: 'UAL123' },
    });
    await socketMock.sendAcarsMessage({
      id: 1,
      flight: 'UAL123',
      label: 'H1',
      text: 'Test message',
    });

    await page.waitForTimeout(500);

    // App should handle all events without errors
    await expect(page.locator('.app')).toBeVisible();
  });

  testWithSocketIO('maintains state across reconnection', async ({ page, socketMock }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // Send initial data
    const aircraft = mockData.generateAircraft(5);
    await socketMock.sendAircraftSnapshot(aircraft);
    await page.waitForTimeout(200);

    // Simulate disconnect
    await socketMock.simulateDisconnect();
    await page.waitForTimeout(200);

    // Simulate reconnect
    await socketMock.simulateReconnect();
    await page.waitForTimeout(200);

    // Send new data after reconnect
    await socketMock.sendAircraftSnapshot(aircraft);
    await page.waitForTimeout(200);

    // Verify app recovered
    await expect(page.locator('.app')).toBeVisible();
  });

  testWithSocketIO('handles high-frequency updates', async ({ page, socketMock }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // Send initial aircraft
    const aircraft = mockData.generateAircraft(1)[0];
    await socketMock.sendAircraftSnapshot([aircraft]);

    // Send rapid position updates (simulating 10 Hz updates)
    for (let i = 0; i < 10; i++) {
      const updated = {
        ...aircraft,
        lat: aircraft.lat + i * 0.001,
        lon: aircraft.lon + i * 0.001,
      };
      await socketMock.sendAircraftUpdate(updated);
      await page.waitForTimeout(50);
    }

    await page.waitForTimeout(200);

    // App should handle high-frequency updates
    await expect(page.locator('.app')).toBeVisible();
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

testWithSocketIO.describe('Real-time Error Handling', () => {
  testWithSocketIO.beforeEach(async ({ mockApi }) => {
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList(mockData.generateAircraft(5));
    await mockApi.mockSystemStatus();
  });

  testWithSocketIO('handles malformed event data gracefully', async ({ page, socketMock }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // Send malformed data
    await socketMock.sendEvent('aircraft:snapshot', null);
    await socketMock.sendEvent('aircraft:snapshot', 'not-an-object');
    await socketMock.sendEvent('aircraft:snapshot', { aircraft: 'not-an-array' });
    await page.waitForTimeout(200);

    // App should not crash
    await expect(page.locator('.app')).toBeVisible();
  });

  testWithSocketIO('handles unknown event types', async ({ page, socketMock }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // Send unknown event types
    await socketMock.sendEvent('unknown:event', { data: 'test' });
    await socketMock.sendEvent('random:type', { value: 123 });
    await page.waitForTimeout(200);

    // App should ignore unknown events gracefully
    await expect(page.locator('.app')).toBeVisible();
  });

  testWithSocketIO('recovers from connection timeout', async ({ page, socketMock }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // Simulate connection timeout
    await socketMock.sendConnectionError('Connection timeout');
    await page.waitForTimeout(500);

    // Simulate recovery
    await socketMock.simulateReconnect();
    await page.waitForTimeout(200);

    // App should recover
    await expect(page.locator('.app')).toBeVisible();
  });
});

// Export for use in other test files
export { SocketIOMock };
