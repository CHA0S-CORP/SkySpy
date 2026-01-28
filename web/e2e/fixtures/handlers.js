/**
 * API mock handlers for e2e testing
 * Provides utilities to intercept and mock API responses
 */

import { mockAircraft, generateManyAircraft, noCallsignAircraft } from './aircraft.js';

/**
 * Setup API route mocks for aircraft list testing
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {Object} options - Configuration options
 */
export async function setupAircraftMocks(page, options = {}) {
  const {
    aircraft = mockAircraft,
    delay = 0,
    failOnce = false,
  } = options;

  let requestCount = 0;

  // Mock WebSocket connection status
  await page.addInitScript(() => {
    window.__mockWsConnected = true;
  });

  // Mock the aircraft API endpoint
  await page.route('**/api/v1/aircraft**', async (route) => {
    requestCount++;

    if (failOnce && requestCount === 1) {
      await route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'Internal Server Error' }),
      });
      return;
    }

    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ aircraft }),
    });
  });

  // Mock system status endpoint
  await page.route('**/api/v1/system/status**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        aircraft_count: aircraft.length,
        websocket_connections: 5,
        location: {
          lat: 52.3676,
          lon: 4.9041,
          name: 'Amsterdam',
        },
      }),
    });
  });

  return { aircraft };
}

/**
 * Setup WebSocket mock for real-time aircraft updates
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {Object} options - Configuration options
 */
export async function setupWebSocketMock(page, options = {}) {
  const { aircraft = mockAircraft } = options;

  await page.addInitScript((aircraftData) => {
    // Mock WebSocket
    class MockWebSocket {
      constructor(url) {
        this.url = url;
        this.readyState = 1; // OPEN
        this.onopen = null;
        this.onmessage = null;
        this.onclose = null;
        this.onerror = null;

        setTimeout(() => {
          if (this.onopen) this.onopen({ type: 'open' });
        }, 10);

        // Simulate aircraft updates
        this._interval = setInterval(() => {
          if (this.onmessage && this.readyState === 1) {
            this.onmessage({
              data: JSON.stringify({
                type: 'aircraft',
                data: aircraftData,
              }),
            });
          }
        }, 1000);
      }

      send(data) {
        // Handle WebSocket requests
        const msg = JSON.parse(data);
        if (msg.type === 'subscribe') {
          // Send initial aircraft data
          if (this.onmessage) {
            this.onmessage({
              data: JSON.stringify({
                type: 'aircraft',
                data: aircraftData,
              }),
            });
          }
        }
      }

      close() {
        this.readyState = 3; // CLOSED
        clearInterval(this._interval);
        if (this.onclose) this.onclose({ type: 'close' });
      }
    }

    window.WebSocket = MockWebSocket;
    window.__mockAircraft = aircraftData;
  }, aircraft);
}

/**
 * Setup empty state mock (no aircraft)
 * @param {import('@playwright/test').Page} page - Playwright page
 */
export async function setupEmptyStateMock(page) {
  return setupAircraftMocks(page, { aircraft: [] });
}

/**
 * Setup large dataset mock for virtual scrolling tests
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {number} count - Number of aircraft to generate
 */
export async function setupLargeDatasetMock(page, count = 100) {
  const aircraft = generateManyAircraft(count);
  return setupAircraftMocks(page, { aircraft });
}

/**
 * Wait for aircraft list to be loaded and visible
 * @param {import('@playwright/test').Page} page - Playwright page
 */
export async function waitForAircraftList(page) {
  await page.waitForSelector('.aircraft-list-container', { state: 'visible' });
}

/**
 * Get count of visible aircraft in the list
 * @param {import('@playwright/test').Page} page - Playwright page
 */
export async function getAircraftCount(page) {
  return page.locator('.aircraft-table tbody tr, .al-card').count();
}

export default {
  setupAircraftMocks,
  setupWebSocketMock,
  setupEmptyStateMock,
  setupLargeDatasetMock,
  waitForAircraftList,
  getAircraftCount,
  mockAircraft,
  generateManyAircraft,
  noCallsignAircraft,
};
