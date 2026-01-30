/**
 * API route handlers for e2e tests using Playwright
 * These handlers mock the backend API responses
 */

import {
  mockAircraft,
  mockEmergencyAircraft,
  mockSafetyEvents,
  mockAcarsMessages,
  mockSystemStatus,
  mockAircraftInfo,
  mockAviationData,
  mockTrackHistory,
} from './mockData.js';

/**
 * Set up all API route handlers for a Playwright page
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {Object} options - Configuration options
 * @param {boolean} options.includeEmergency - Include emergency aircraft in responses
 * @param {boolean} options.includeSafetyEvents - Include safety events in responses
 */
export async function setupApiHandlers(page, options = {}) {
  const {
    includeEmergency = false,
    includeSafetyEvents = true,
  } = options;

  // Build aircraft list based on options
  const aircraftList = includeEmergency
    ? [...mockAircraft, mockEmergencyAircraft]
    : mockAircraft;

  // Mock system status endpoint
  await page.route('**/api/v1/system/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockSystemStatus),
    });
  });

  // Mock aircraft positions endpoint (legacy REST)
  await page.route('**/api/v1/aircraft', async (route) => {
    const url = new URL(route.request().url());
    const icao = url.searchParams.get('icao') || url.pathname.split('/').pop();

    if (icao && icao !== 'aircraft') {
      // Single aircraft lookup
      const aircraft = aircraftList.find(a => a.hex.toLowerCase() === icao.toLowerCase());
      if (aircraft) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(aircraft),
        });
      } else {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Aircraft not found' }),
        });
      }
    } else {
      // All aircraft
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          aircraft: aircraftList,
          count: aircraftList.length,
          now: Date.now(),
        }),
      });
    }
  });

  // Mock safety events endpoint
  await page.route('**/api/v1/safety/events**', async (route) => {
    const events = includeSafetyEvents ? mockSafetyEvents : [];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        events,
        count: events.length,
      }),
    });
  });

  // Mock active safety events endpoint
  await page.route('**/api/v1/safety/active**', async (route) => {
    const events = includeSafetyEvents ? mockSafetyEvents.filter(e => !e.resolved) : [];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        events,
        count: events.length,
      }),
    });
  });

  // Mock ACARS status endpoint
  await page.route('**/api/v1/acars/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        enabled: true,
        sources: ['acars', 'vdlm2'],
        message_count: mockAcarsMessages.length,
      }),
    });
  });

  // Mock ACARS messages endpoint
  await page.route('**/api/v1/acars**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        messages: mockAcarsMessages,
        count: mockAcarsMessages.length,
      }),
    });
  });

  // Mock airframe info endpoint
  await page.route('**/api/v1/aircraft/*/info', async (route) => {
    const url = route.request().url();
    const match = url.match(/\/aircraft\/([^/]+)\/info/);
    if (match) {
      const hex = match[1].toUpperCase();
      const info = mockAircraftInfo[hex];
      if (info) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(info),
        });
      } else {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Airframe not found' }),
        });
      }
    }
  });

  // Mock airframes photo endpoint
  await page.route('**/api/v1/airframes/*/photos', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        icao_hex: 'ABC123',
        photo_url: 'https://example.com/aircraft-photo.jpg',
        thumbnail_url: 'https://example.com/aircraft-photo-thumb.jpg',
        photographer: 'Test Photographer',
        source: 'planespotters',
      }),
    });
  });

  // Mock sightings endpoint
  await page.route('**/api/v1/sightings**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sightings: [],
        count: 0,
      }),
    });
  });

  // Mock aviation data endpoints
  await page.route('**/api/v1/aviation/navaids**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockAviationData.navaids),
    });
  });

  await page.route('**/api/v1/aviation/airports**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockAviationData.airports),
    });
  });

  await page.route('**/api/v1/aviation/airspaces**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockAviationData.airspaces),
    });
  });

  await page.route('**/api/v1/aviation/airspace-boundaries**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockAviationData.boundaries),
    });
  });

  await page.route('**/api/v1/aviation/metars**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockAviationData.metars),
    });
  });

  await page.route('**/api/v1/aviation/pireps**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockAviationData.pireps),
    });
  });

  // Mock GeoJSON overlay endpoints
  await page.route('**/api/v1/aviation/geojson/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'FeatureCollection',
        features: [],
      }),
    });
  });
}

/**
 * Set up WebSocket mock for e2e tests
 * Intercepts WebSocket connections and provides mock data
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {Object} options - Configuration options
 */
export async function setupWebSocketMock(page, options = {}) {
  const {
    includeEmergency = false,
    includeSafetyEvents = true,
  } = options;

  const aircraftList = includeEmergency
    ? [...mockAircraft, mockEmergencyAircraft]
    : mockAircraft;

  // Inject WebSocket mock into page
  await page.addInitScript((data) => {
    const { aircraftList, safetyEvents, acarsMessages } = data;

    // Store original WebSocket
    const OriginalWebSocket = window.WebSocket;

    // Create mock WebSocket class
    class MockWebSocket {
      constructor(url) {
        this.url = url;
        this.readyState = 0; // CONNECTING
        this.onopen = null;
        this.onmessage = null;
        this.onclose = null;
        this.onerror = null;

        // Simulate connection
        setTimeout(() => {
          this.readyState = 1; // OPEN
          if (this.onopen) {
            this.onopen({ type: 'open' });
          }

          // Send initial aircraft snapshot
          setTimeout(() => {
            if (this.onmessage) {
              this.onmessage({
                data: JSON.stringify({
                  type: 'aircraft:snapshot',
                  data: { aircraft: aircraftList },
                }),
              });
            }
          }, 100);

          // Send safety events snapshot
          if (safetyEvents.length > 0) {
            setTimeout(() => {
              if (this.onmessage) {
                this.onmessage({
                  data: JSON.stringify({
                    type: 'safety:snapshot',
                    data: { events: safetyEvents },
                  }),
                });
              }
            }, 200);
          }

          // Simulate periodic aircraft updates
          this._updateInterval = setInterval(() => {
            if (this.readyState === 1 && this.onmessage) {
              // Update aircraft positions slightly
              const updatedAircraft = aircraftList.map(ac => ({
                ...ac,
                lat: ac.lat + (Math.random() - 0.5) * 0.001,
                lon: ac.lon + (Math.random() - 0.5) * 0.001,
                seen: 0,
              }));

              this.onmessage({
                data: JSON.stringify({
                  type: 'aircraft:update',
                  data: { aircraft: updatedAircraft },
                }),
              });
            }
          }, 5000);
        }, 50);
      }

      send(data) {
        // Handle incoming messages
        try {
          const message = JSON.parse(data);

          // Handle subscription
          if (message.action === 'subscribe') {
            setTimeout(() => {
              if (this.onmessage) {
                this.onmessage({
                  data: JSON.stringify({
                    type: 'subscribed',
                    topics: message.topics,
                  }),
                });
              }
            }, 10);
          }

          // Handle request/response
          if (message.action === 'request' && message.request_id) {
            setTimeout(() => {
              if (this.onmessage) {
                let responseData = {};

                if (message.type === 'status') {
                  responseData = {
                    location: { lat: 47.9377, lon: -121.9687 },
                    websocket_connections: 5,
                  };
                } else if (message.type === 'ws-status') {
                  responseData = { subscribers: 5 };
                }

                this.onmessage({
                  data: JSON.stringify({
                    type: 'response',
                    request_id: message.request_id,
                    data: responseData,
                  }),
                });
              }
            }, 20);
          }
        } catch (e) {
          // Ignore parse errors
        }
      }

      close() {
        if (this._updateInterval) {
          clearInterval(this._updateInterval);
        }
        this.readyState = 3; // CLOSED
        if (this.onclose) {
          this.onclose({ type: 'close', code: 1000, reason: 'Normal closure' });
        }
      }
    }

    // Add static constants
    MockWebSocket.CONNECTING = 0;
    MockWebSocket.OPEN = 1;
    MockWebSocket.CLOSING = 2;
    MockWebSocket.CLOSED = 3;

    // Replace WebSocket
    window.WebSocket = MockWebSocket;
  }, {
    aircraftList,
    safetyEvents: includeSafetyEvents ? mockSafetyEvents : [],
    acarsMessages: mockAcarsMessages,
  });
}

/**
 * Trigger a safety event via the mock WebSocket
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {Object} event - Safety event data
 */
export async function triggerSafetyEvent(page, event) {
  await page.evaluate((eventData) => {
    // Find the WebSocket instance and trigger event
    window.dispatchEvent(new CustomEvent('mock:safety:event', { detail: eventData }));
  }, event);
}

export default {
  setupApiHandlers,
  setupWebSocketMock,
  triggerSafetyEvent,
};
