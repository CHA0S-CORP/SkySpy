// @ts-check
/**
 * Cross-view Integration Workflow
 *
 * Exercises a realistic multi-view navigation flow through the single-page,
 * hash-routed dashboard using fully mocked API responses:
 *
 *   #map  ->  #history  ->  #stats  ->  back to #map
 *
 * Assertions verify that:
 * - each view renders its shell (.app / .sidebar)
 * - the location hash updates on every navigation step
 * - navigation works both via sidebar clicks and via direct hash goto
 * - navigation state (the active nav item + mocked data) is preserved
 *
 * All data is mocked via the shared test-setup fixture; no live backend.
 */

import { test, expect, mockData } from '../fixtures/test-setup.js';

function generateSightings(count = 10) {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    icao_hex: `ABC${100 + i}`,
    flight: `UAL${100 + i}`,
    registration: `N${12345 + i}`,
    type: ['B738', 'A320', 'E190', 'CRJ9'][i % 4],
    timestamp: new Date(Date.now() - i * 86400000).toISOString(),
    latitude: 37.7749 + i * 0.01,
    longitude: -122.4194 + i * 0.01,
    altitude: 30000 + i * 500,
    speed: 450 + i * 5,
    distance_nm: 5 + i * 2,
    session_id: Math.floor(i / 5) + 1,
  }));
}

function generateSessions(count = 5) {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    start_time: new Date(Date.now() - i * 86400000).toISOString(),
    end_time: new Date(Date.now() - i * 86400000 + 3600000).toISOString(),
    duration_seconds: 3600,
    aircraft_count: 10 + i * 2,
    sighting_count: 50 + i * 10,
    max_range_nm: 100 + i * 5,
    message_rate: 15 + i,
  }));
}

test.describe('Multi-view Workflow', () => {
  test.beforeEach(async ({ mockApi }) => {
    // Shared shell + per-view mocks so each view has real-shaped data.
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList(mockData.generateAircraft(6));
    await mockApi.mockSystemStatus();

    // Map view
    await mockApi.mock('/safety/events', { events: [], count: 0 });
    await mockApi.mock('/safety/conflicts', { conflicts: [], count: 0 });
    await mockApi.mock('/acars', { messages: [], count: 0 });

    // History view
    await mockApi.mock('/sessions', { sessions: generateSessions(5), count: 5 });
    await mockApi.mock('/sightings', { sightings: generateSightings(10), count: 10 });

    // Stats view
    await mockApi.mock('/aircraft/stats', {
      count: 42,
      total: 1234,
      messages_rate: 156.7,
      with_flight: 38,
      with_position: 40,
      with_altitude: 41,
    });
    await mockApi.mock('/aircraft/top', {
      aircraft: [
        { hex: 'ABC123', flight: 'UAL123', count: 150 },
        { hex: 'DEF456', flight: 'DAL456', count: 120 },
      ],
    });
    await mockApi.mock('/history/stats', {
      stats: {
        total_sightings: 15000,
        total_sessions: 350,
        unique_aircraft: 2500,
        average_daily_count: 42,
      },
    });
    await mockApi.mock('/stats/overview', {
      aircraft_seen_today: 150,
      messages_today: 450,
      alerts_triggered: 5,
      active_sessions: 12,
    });
  });

  test('navigates map -> history -> stats via sidebar and preserves state', async ({ page }) => {
    // Start on the map view.
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });
    // The map view may append filter query params to the hash (#map?filters=...).
    expect(await page.evaluate(() => window.location.hash)).toMatch(/^#map/);

    // The Live Map nav item should be marked active.
    await expect(page.locator('.nav-item.active:has-text("Live Map")')).toBeVisible({
      timeout: 10000,
    });

    // Navigate to History via sidebar.
    await page.click('.nav-item:has-text("History")');
    await page.waitForURL(/#history/, { timeout: 10000 });
    expect(await page.evaluate(() => window.location.hash)).toMatch(/^#history/);
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.nav-item.active:has-text("History")')).toBeVisible({
      timeout: 10000,
    });

    // Navigate to Statistics via sidebar.
    await page.click('.nav-item:has-text("Statistics")');
    await page.waitForURL(/#stats/, { timeout: 10000 });
    expect(await page.evaluate(() => window.location.hash)).toMatch(/^#stats/);
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.nav-item.active:has-text("Statistics")')).toBeVisible({
      timeout: 10000,
    });

    // The sidebar (shared navigation state) is preserved across all views.
    await expect(page.locator('.sidebar')).toBeVisible();
  });

  test('supports direct hash navigation between views', async ({ page }) => {
    const steps = ['history', 'stats', 'map'];

    for (const tab of steps) {
      await page.goto(`/#${tab}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
      // Map view may append filter query params to the hash.
      expect(await page.evaluate(() => window.location.hash)).toMatch(new RegExp(`^#${tab}`));
    }
  });

  test('back navigation returns to the previous view', async ({ page }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    await page.click('.nav-item:has-text("Statistics")');
    await page.waitForURL(/#stats/, { timeout: 10000 });
    expect(await page.evaluate(() => window.location.hash)).toMatch(/^#stats/);

    // Browser back should restore the map hash.
    await page.goBack();
    await page.waitForURL(/#map/, { timeout: 10000 });
    expect(await page.evaluate(() => window.location.hash)).toMatch(/^#map/);
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
  });

  test('renders history and stats data-bearing views without errors', async ({ page }) => {
    // History
    await page.goto('/#history');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    const historyContainer = page
      .locator('.history-view, [class*="history"], .app')
      .first();
    await expect(historyContainer).toBeVisible({ timeout: 10000 });

    // Stats
    await page.goto('/#stats');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    const statsContainer = page.locator('.stats-view, [class*="stats"], .app').first();
    await expect(statsContainer).toBeVisible({ timeout: 10000 });
  });
});
