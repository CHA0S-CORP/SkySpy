// @ts-check
/**
 * E2E Tests for the History View
 * Tests the history view at #history hash route
 */

import { test, expect, mockData } from '../fixtures/test-setup.js';

test.describe('History View', () => {
  test.beforeEach(async ({ page, mockApi }) => {
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList(mockData.generateAircraft(5));
    await mockApi.mockSystemStatus();
    await mockApi.mock('/sessions', { sessions: [], count: 0 });
    await mockApi.mock('/sightings', { sightings: [], count: 0 });
    await mockApi.mock('/acars', { messages: [], count: 0 });
    await mockApi.mock('/safety/events', { events: [], count: 0 });
  });

  test.describe('Basic Rendering', () => {
    test('history view loads successfully', async ({ page }) => {
      await page.goto('/#history');
      await page.waitForLoadState('networkidle');

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toBe('#history');

      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    });

    test('sidebar is visible', async ({ page }) => {
      await page.goto('/#history');
      await page.waitForLoadState('networkidle');

      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Navigation', () => {
    test('can navigate to map view', async ({ page }) => {
      await page.goto('/#history');
      await page.waitForLoadState('networkidle');

      await page.click('.nav-item:has-text("Live Map")');
      await page.waitForURL(/#map/);

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toContain('#map');
    });

    test('can navigate to aircraft list', async ({ page }) => {
      await page.goto('/#history');
      await page.waitForLoadState('networkidle');

      await page.click('.nav-item:has-text("Aircraft List")');
      await page.waitForURL(/#aircraft/);

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toBe('#aircraft');
    });
  });

  test.describe('Responsive Design', () => {
    test('renders correctly on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/#history');
      await page.waitForLoadState('networkidle');

      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    });
  });
});
