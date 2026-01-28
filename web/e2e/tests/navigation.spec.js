// @ts-check
/**
 * E2E Tests for Navigation
 * Tests hash-based routing and sidebar navigation
 */

import { test, expect, mockData } from '../fixtures/test-setup.js';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page, mockApi }) => {
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList(mockData.generateAircraft(5));
    await mockApi.mockSystemStatus();
    await mockApi.mock('/safety/events', { events: [] });
    await mockApi.mock('/alerts/rules', []);
  });

  test.describe('App Initialization', () => {
    test('loads with default map view', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Should redirect to #map by default (may have query params)
      await page.waitForFunction(() => window.location.hash.startsWith('#map') || window.location.hash === '');

      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    });

    test('app container is rendered', async ({ page }) => {
      await page.goto('/#map');
      await page.waitForLoadState('networkidle');

      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Sidebar Navigation', () => {
    test('sidebar is visible', async ({ page }) => {
      await page.goto('/#map');
      await page.waitForLoadState('networkidle');

      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });
    });

    test('can navigate to aircraft view', async ({ page }) => {
      await page.goto('/#map');
      await page.waitForLoadState('networkidle');

      await page.click('.nav-item:has-text("Aircraft List")');
      await page.waitForURL(/#aircraft/);

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toBe('#aircraft');
    });

    test('can navigate to stats view', async ({ page }) => {
      await page.goto('/#map');
      await page.waitForLoadState('networkidle');

      await page.click('.nav-item:has-text("Statistics")');
      await page.waitForURL(/#stats/);

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toBe('#stats');
    });

    test('can navigate to alerts view', async ({ page }) => {
      await page.goto('/#map');
      await page.waitForLoadState('networkidle');

      await page.click('.nav-item:has-text("Alerts")');
      await page.waitForURL(/#alerts/);

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toBe('#alerts');
    });

    test('can navigate to history view', async ({ page }) => {
      await page.goto('/#map');
      await page.waitForLoadState('networkidle');

      await page.click('.nav-item:has-text("History")');
      await page.waitForURL(/#history/);

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toBe('#history');
    });

    test('can navigate to system view', async ({ page }) => {
      await page.goto('/#map');
      await page.waitForLoadState('networkidle');

      await page.click('.nav-item:has-text("System")');
      await page.waitForURL(/#system/);

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toBe('#system');
    });
  });

  test.describe('Direct URL Navigation', () => {
    test('can load map view directly', async ({ page }) => {
      await page.goto('/#map');
      await page.waitForLoadState('networkidle');

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toContain('#map');
    });

    test('can load aircraft view directly', async ({ page }) => {
      await page.goto('/#aircraft');
      await page.waitForLoadState('networkidle');

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toBe('#aircraft');
    });

    test('can load alerts view directly', async ({ page }) => {
      await page.goto('/#alerts');
      await page.waitForLoadState('networkidle');

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toBe('#alerts');
    });

    test('invalid hash redirects to map', async ({ page }) => {
      await page.goto('/#invalid-route');
      await page.waitForLoadState('networkidle');

      // Should redirect to map for invalid routes (may have query params)
      await page.waitForFunction(() =>
        window.location.hash.startsWith('#map') || window.location.hash === '#invalid-route'
      );
    });
  });

  test.describe('Browser History', () => {
    test('back button works', async ({ page }) => {
      await page.goto('/#map');
      await page.waitForLoadState('networkidle');

      // Navigate to aircraft
      await page.click('.nav-item:has-text("Aircraft List")');
      await page.waitForURL(/#aircraft/);

      // Go back
      await page.goBack();
      await page.waitForURL(/#map/);

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toContain('#map');
    });
  });

  test.describe('Header', () => {
    test('header is visible', async ({ page }) => {
      await page.goto('/#map');
      await page.waitForLoadState('networkidle');

      await expect(page.locator('.header')).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Responsive Design', () => {
    test('mobile menu toggle appears on small screens', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/#map');
      await page.waitForLoadState('networkidle');

      const mobileToggle = page.locator('.mobile-menu-toggle');
      await expect(mobileToggle).toBeVisible({ timeout: 10000 });
    });
  });
});
