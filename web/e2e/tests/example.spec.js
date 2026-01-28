// @ts-check
import { test, expect, mockData } from '../fixtures/test-setup.js';

/**
 * Example e2e tests demonstrating fixture usage
 * These tests serve as templates for actual test implementation
 */

test.describe('Application Smoke Tests', () => {
  test('should load the application', async ({ page, mockApi }) => {
    // Set up API mocks before navigating
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList();
    await mockApi.mockSystemStatus();

    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Verify the page loaded
    await expect(page).toHaveTitle(/adsb|skyspy|dashboard/i);
  });

  test('should navigate to map view', async ({ page, mockApi, helpers }) => {
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList();

    await helpers.navigateTo('map');

    // The map view should be visible
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Aircraft List', () => {
  test('should display aircraft list', async ({ page, mockApi }) => {
    await mockApi.mockAuthConfig();
    const aircraft = mockData.generateAircraft(10);
    await mockApi.mockAircraftList(aircraft);

    await page.goto('/#aircraft');
    await page.waitForLoadState('domcontentloaded');

    // Verify aircraft are displayed
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
  });

  test('should handle empty aircraft list', async ({ page, mockApi }) => {
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList([]);

    await page.goto('/#aircraft');
    await page.waitForLoadState('domcontentloaded');

    // Should show empty state or message
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
  });

  test('should handle API error gracefully', async ({ page, mockApi }) => {
    await mockApi.mockAuthConfig();
    await mockApi.mockError('/aircraft', 500, 'Server error');

    await page.goto('/#aircraft');
    await page.waitForLoadState('domcontentloaded');

    // Should show error state
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('WebSocket Integration', () => {
  test('should receive aircraft updates via WebSocket', async ({
    page,
    mockApi,
    wsMock,
  }) => {
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList();

    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // Send a WebSocket message
    await wsMock.sendAircraftUpdate({
      hex: 'ABC123',
      flight: 'SKY999',
      lat: 37.7749,
      lon: -122.4194,
      altitude: 35000,
    });

    // Verify the update was received and processed
    // (Check UI for updated aircraft data)
  });

  test('should receive ACARS messages via WebSocket', async ({
    page,
    mockApi,
    wsMock,
  }) => {
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList();
    await mockApi.mockAcarsMessages();

    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // Send an ACARS message
    await wsMock.sendAcarsMessage({
      id: 999,
      flight: 'SKY123',
      label: 'H1',
      text: 'Test ACARS message',
      timestamp: new Date().toISOString(),
    });

    // Verify the message appears in the UI
  });
});

test.describe('Alerts', () => {
  test('should display alert rules', async ({ page, mockApi }) => {
    await mockApi.mockAuthConfig();
    const rules = mockData.generateAlertRules(5);
    await mockApi.mockAlertRules(rules);
    await mockApi.mock('/alerts/history', { alerts: [] });
    await mockApi.mock('/notifications/channels', { channels: [] });

    await page.goto('/#alerts');
    await page.waitForLoadState('domcontentloaded');

    // Verify alert rules are displayed
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Navigation', () => {
  test.beforeEach(async ({ mockApi }) => {
    // Set up common mocks for navigation tests
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList();
    await mockApi.mockSystemStatus();
  });

  test('should navigate between views using hash routes', async ({
    page,
    helpers,
  }) => {
    // Test map view
    await helpers.navigateTo('map');
    await expect(page).toHaveURL(/#map/);

    // Test aircraft view
    await helpers.navigateTo('aircraft');
    await expect(page).toHaveURL(/#aircraft/);

    // Test alerts view
    await helpers.navigateTo('alerts');
    await expect(page).toHaveURL(/#alerts/);
  });
});

test.describe('Responsive Design', () => {
  test('should adapt to mobile viewport', async ({ page, mockApi }) => {
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList();

    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Verify mobile-specific UI elements
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
  });

  test('should adapt to tablet viewport', async ({ page, mockApi }) => {
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList();

    // Set tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Verify tablet-specific UI elements
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Offline Behavior', () => {
  test('should handle network offline gracefully', async ({
    page,
    mockApi,
    helpers,
  }) => {
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList();

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // Go offline
    await helpers.goOffline();

    // Attempt to refresh or navigate
    // Should show offline indicator or cached data

    // Go back online
    await helpers.goOnline();
  });
});
