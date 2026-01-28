// @ts-check
/**
 * E2E Tests for the Map View
 * Tests the main map view at #map hash route
 */

import { test, expect, mockData } from '../fixtures/test-setup.js';

test.describe('Map View', () => {
  test.beforeEach(async ({ page, mockApi }) => {
    // Set up API mocks before navigation
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList(mockData.generateAircraft(6));
    await mockApi.mockSystemStatus();
    await mockApi.mock('/safety/events', { events: [], count: 0 });
    await mockApi.mock('/acars', { messages: [] });
  });

  test.describe('Basic Rendering', () => {
    test('map view loads successfully', async ({ page }) => {
      await page.goto('/#map');
      await page.waitForLoadState('domcontentloaded');

      // Verify we're on the map view
      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toContain('#map');

      // App container should be visible
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    });

    test('sidebar navigation is visible', async ({ page }) => {
      await page.goto('/#map');
      await page.waitForLoadState('domcontentloaded');

      // Sidebar should be visible
      const sidebar = page.locator('.sidebar');
      await expect(sidebar).toBeVisible({ timeout: 10000 });
    });

    test('header is displayed', async ({ page }) => {
      await page.goto('/#map');
      await page.waitForLoadState('domcontentloaded');

      // Header should be visible
      const header = page.locator('.header');
      await expect(header).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Navigation', () => {
    test('can navigate to aircraft list', async ({ page, helpers }) => {
      await page.goto('/#map');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

      // Click on Aircraft tab in sidebar
      await page.click('.nav-item:has-text("Aircraft List")');

      // Wait for navigation
      await page.waitForURL(/#aircraft/);
      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toBe('#aircraft');
    });

    test('can navigate to alerts', async ({ page }) => {
      await page.goto('/#map');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

      // Click on Alerts tab in sidebar
      await page.click('.nav-item:has-text("Alerts")');

      // Wait for navigation
      await page.waitForURL(/#alerts/);
      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toBe('#alerts');
    });

    test('can navigate to stats', async ({ page }) => {
      await page.goto('/#map');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

      // Click on Stats tab in sidebar
      await page.click('.nav-item:has-text("Statistics")');

      // Wait for navigation
      await page.waitForURL(/#stats/);
      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toBe('#stats');
    });
  });

  test.describe('Settings Modal', () => {
    test('settings modal can be opened and closed', async ({ page }) => {
      await page.goto('/#map');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Click settings button (usually in header or sidebar)
      const settingsBtn = page.locator('button:has-text("Settings"), .settings-btn, [aria-label="Settings"]').first();
      if (await settingsBtn.isVisible()) {
        await settingsBtn.click();

        // Modal should appear
        const modal = page.locator('.modal, [role="dialog"]');
        await expect(modal).toBeVisible({ timeout: 5000 });

        // Close modal
        const closeBtn = modal.locator('button:has-text("Cancel"), button:has-text("Close"), .modal-close').first();
        if (await closeBtn.isVisible()) {
          await closeBtn.click();
          await expect(modal).not.toBeVisible({ timeout: 5000 });
        }
      }
    });
  });

  test.describe('Responsive Design', () => {
    test('mobile menu toggle appears on small screens', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/#map');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Mobile menu toggle should be visible
      const mobileToggle = page.locator('.mobile-menu-toggle');
      await expect(mobileToggle).toBeVisible({ timeout: 10000 });
    });
  });
});
