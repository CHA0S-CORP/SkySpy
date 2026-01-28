// @ts-check
/**
 * E2E Tests for the Aircraft Detail Page
 * Tests the aircraft detail view at #airframe hash route
 */

import { test, expect, mockData } from '../fixtures/test-setup.js';

test.describe('Aircraft Detail Page', () => {
  const testAircraft = mockData.generateAircraft(1)[0];
  const testIcao = testAircraft.hex;

  test.beforeEach(async ({ page, mockApi }) => {
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList([testAircraft]);
    await mockApi.mockAircraftDetail(testIcao, testAircraft);
    await mockApi.mockSystemStatus();
    await mockApi.mock('/sightings', { sightings: [], count: 0 });
    await mockApi.mock('/audio/transmissions', { transmissions: [], count: 0 });
    await mockApi.mock('/acars', { messages: [], count: 0 });
    await mockApi.mock('/safety/events', { events: [], count: 0 });
    await mockApi.mock(`/airframes/${testIcao}`, {
      icao_hex: testIcao,
      registration: testAircraft.registration,
      type_code: testAircraft.type,
    });
  });

  test.describe('Basic Rendering', () => {
    test('aircraft detail page loads with icao parameter', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toContain('#airframe');
      expect(hash).toContain(`icao=${testIcao}`);

      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    });

    test('sidebar is visible', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Navigation', () => {
    test('can navigate back to map', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

      await page.click('.nav-item:has-text("Live Map")');
      await page.waitForURL(/#map/);

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toContain('#map');
    });

    test('can navigate to aircraft list', async ({ page }) => {
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

      await page.click('.nav-item:has-text("Aircraft List")');
      await page.waitForURL(/#aircraft/);

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toBe('#aircraft');
    });
  });

  test.describe('Responsive Design', () => {
    test('renders correctly on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto(`/#airframe?icao=${testIcao}`);
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    });
  });
});
