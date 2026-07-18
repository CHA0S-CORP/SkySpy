// @ts-check
/**
 * E2E Tests for Safety Events
 *
 * Safety events surface in two places:
 *  - History view safety subview (#history?data=safety) — driven by the HTTP
 *    fallback of useSocketApi against /api/v1/safety/events/ (SafetyEventCard).
 *  - SafetyEventPage detail (#event?id=...) — reached via "View Details".
 *
 * All data is mocked; no assertions are made against live-backend data.
 */

import { test, expect } from '../fixtures/test-setup.js';

/**
 * Route the safety events list endpoint. The app requests it with a trailing
 * slash (`/api/v1/safety/events/?hours=...`) which the shared glob helper does
 * not match, so we register an explicit route here.
 * @param {import('@playwright/test').Page} page
 * @param {Array<object>} events
 */
async function routeSafetyEvents(page, events) {
  await page.route('**/api/v1/safety/events/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ events }),
    });
  });
}

/**
 * Route a single safety event detail endpoint.
 * @param {import('@playwright/test').Page} page
 * @param {string|number} id
 * @param {object} event
 */
async function routeSafetyEventDetail(page, id, event) {
  await page.route(`**/api/v1/safety/events/${id}/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(event),
    });
  });
}

/**
 * Generate realistic SafetyEvent objects matching the Django serializer shape.
 * @param {number} count
 * @returns {Array<object>}
 */
function generateSafetyEvents(count = 3) {
  const types = ['proximity_conflict', 'emergency_squawk', 'rapid_descent'];
  const severities = ['critical', 'warning', 'info'];
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    event_type: types[i % types.length],
    severity: severities[i % severities.length],
    icao: `A0000${i + 1}`,
    icao_2: i === 0 ? 'B00002' : null,
    callsign: `SKY${100 + i}`,
    callsign_2: i === 0 ? 'DAL200' : null,
    squawk: i === 1 ? '7700' : '1200',
    altitude: 10000 + i * 1500,
    message: `Safety event ${i + 1}: ${types[i % types.length].replace(/_/g, ' ')} detected`,
    timestamp: new Date(Date.now() - i * 300000).toISOString(),
    acknowledged: false,
    resolved: false,
    details: {
      horizontal_nm: 1.5 + i,
      vertical_ft: 800 + i * 100,
    },
  }));
}

test.describe('Safety Events', () => {
  test.beforeEach(async ({ page, mockApi }) => {
    // Block the Socket.IO transport (both polling XHR and the WS upgrade) so the
    // socket never becomes "ready" and useSocketApi deterministically uses its
    // HTTP fallback against the mocked REST endpoints (wsConnected stays false).
    // This removes the race where a live socket could overwrite mocked data.
    await page.routeWebSocket(/socket\.io/, (ws) => ws.close());
    await page.route('**/socket.io/**', (route) => route.abort());

    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList([]);
    await mockApi.mockSystemStatus();
    // Keep unrelated history subviews quiet.
    await mockApi.mock('/sessions', { sessions: [] });
    await mockApi.mock('/sightings', { sightings: [] });
    await mockApi.mock('/acars', { messages: [] });
  });

  test('renders safety event cards from mocked /safety/events', async ({ page, mockApi }) => {
    const events = generateSafetyEvents(3);
    await routeSafetyEvents(page, events);

    await page.goto('/#history?data=safety');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 15000 });

    // One card per mocked event.
    const cards = page.locator('.safety-event-card-v2');
    await expect(cards).toHaveCount(3, { timeout: 15000 });

    // The event message text is rendered.
    await expect(page.getByText('proximity conflict', { exact: false }).first()).toBeVisible();
    // The count header reflects the number of events.
    await expect(page.locator('.safety-events-count')).toContainText('3 events');
  });

  test('applies severity styling classes to event cards', async ({ page, mockApi }) => {
    const events = generateSafetyEvents(3);
    await routeSafetyEvents(page, events);

    await page.goto('/#history?data=safety');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.safety-event-card-v2').first()).toBeVisible({ timeout: 15000 });

    // Each severity maps to a distinct background class.
    await expect(page.locator('.safety-event-card-v2.severity-critical')).toHaveCount(1);
    await expect(page.locator('.safety-event-card-v2.severity-warning')).toHaveCount(1);
    await expect(page.locator('.safety-event-card-v2.severity-info')).toHaveCount(1);

    // Severity labels are surfaced as text.
    await expect(page.getByText('CRITICAL', { exact: true }).first()).toBeVisible();
  });

  test('renders event type badge and aircraft chips', async ({ page }) => {
    const events = generateSafetyEvents(1);
    await routeSafetyEvents(page, events);

    await page.goto('/#history?data=safety');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.safety-event-card-v2').first()).toBeVisible({ timeout: 15000 });

    // Type badge shows the humanized, upper-cased event type.
    await expect(page.locator('.sec-type-badge')).toContainText('PROXIMITY CONFLICT');

    // The first event has two involved aircraft -> two clickable chips.
    const chips = page.locator('.safety-event-card-v2 .sec-aircraft-chip');
    await expect(chips).toHaveCount(2);
    await expect(chips.first()).toContainText('SKY100');
    await expect(chips.nth(1)).toContainText('DAL200');
  });

  test('shows empty state when there are no safety events', async ({ page }) => {
    await routeSafetyEvents(page, []);

    await page.goto('/#history?data=safety');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 15000 });

    await expect(page.locator('.no-events-message')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('No safety events in the selected time range')).toBeVisible();
    await expect(page.locator('.safety-event-card-v2')).toHaveCount(0);
    await expect(page.locator('.safety-events-count')).toContainText('0 events');
  });

  test('navigates to the event detail page via "View Details"', async ({ page }) => {
    const events = generateSafetyEvents(1);
    await routeSafetyEvents(page, events);
    // Detail endpoint for the HTTP path (used if socket detail fetch falls back).
    await routeSafetyEventDetail(page, 1, events[0]);

    await page.goto('/#history?data=safety');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.safety-event-card-v2').first()).toBeVisible({ timeout: 15000 });

    await page.locator('.sec-view-btn').first().click();

    // The hash routes to the event detail tab with the mocked id.
    await expect
      .poll(() => page.evaluate(() => window.location.hash), { timeout: 15000 })
      .toContain('event');
    await expect
      .poll(() => page.evaluate(() => window.location.hash))
      .toContain('id=1');

    // SafetyEventPage container renders (either loaded or a graceful error state).
    await expect(page.locator('.safety-event-page-v2')).toBeVisible({ timeout: 15000 });
  });

  test('event detail page renders directly from a mocked event id', async ({ page }) => {
    const events = generateSafetyEvents(1);
    await routeSafetyEvents(page, events);
    await routeSafetyEventDetail(page, 1, events[0]);

    await page.goto('/#event?id=1');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 15000 });

    // The dedicated SafetyEventPage shell is present regardless of load result.
    await expect(page.locator('.safety-event-page-v2')).toBeVisible({ timeout: 15000 });

    // A back-to-safety-events control is always available on this page.
    const backControl = page.locator('.sep-back-btn, .sep-error button');
    await expect(backControl.first()).toBeVisible({ timeout: 15000 });
  });
});
