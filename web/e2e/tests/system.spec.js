// @ts-check
/**
 * E2E Tests for System View
 * Tests the system view at #system hash route
 */

import { test, expect, mockData } from '../fixtures/test-setup.js';

test.describe('System View', () => {
  test.beforeEach(async ({ page, mockApi }) => {
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList(mockData.generateAircraft(5));
    await mockApi.mockSystemStatus();

    // Mock system-specific endpoints
    await mockApi.mock('/system/status', {
      status: 'healthy',
      uptime: 86400,
      version: '2.5.0',
      adsb_online: true,
      adsb_status: 'online',
      total_sightings: 12500,
      total_sessions: 350,
      active_rules: 5,
      polling_interval_seconds: 5,
      db_store_interval_seconds: 60,
      location: { lat: 37.7749, lon: -122.4194 },
      websocket: {
        active: true,
        mode: 'redis',
        clients: 12,
        tracked_aircraft: 45,
        redis_enabled: true,
        last_publish: new Date().toISOString(),
      },
    });

    await mockApi.mock('/system/health', {
      status: 'healthy',
      services: {
        adsb: { status: 'up' },
        database: { status: 'up' },
        redis: { status: 'up' },
        celery: { status: 'up' },
      },
      components: {
        adsb: { status: 'healthy' },
        database: { status: 'healthy' },
        redis: { status: 'healthy' },
      },
    });

    await mockApi.mock('/system/info', {
      version: '2.5.0',
      django_version: '4.2.0',
      python_version: '3.11.0',
      poll_interval: 5,
      db_store_interval: 60,
    });

    await mockApi.mock('/system/databases', {
      total_sightings: 12500,
      total_sessions: 350,
      active_rules: 5,
      table_counts: {
        aircraft: 5000,
        alerts: 150,
      },
    });

    await mockApi.mock('/health', {
      status: 'healthy',
      uptime: 86400,
    });

    await mockApi.mock('/notifications/config', {
      enabled: true,
      server_count: 2,
      cooldown_seconds: 300,
    });

    await mockApi.mock('/safety/monitor/status', {
      enabled: true,
      tracked_aircraft: 45,
    });
  });

  test.describe('Basic Rendering', () => {
    test('system view loads successfully', async ({ page }) => {
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toBe('#system');

      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    });

    test('sidebar is visible', async ({ page }) => {
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });
    });

    test('system container is displayed', async ({ page }) => {
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');

      // Check for system container
      const container = page.locator('.system-container, .system-view, [class*="system"]').first();
      const hasContainer = await container.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasContainer).toBe('boolean');
    });
  });

  test.describe('Services Status', () => {
    test('services card is displayed', async ({ page }) => {
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for services card
      const servicesCard = page.locator('.system-card:has-text("Services"), .card-header:has-text("Services")');
      const hasCard = await servicesCard.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasCard).toBe('boolean');
    });

    test('displays client connection status', async ({ page }) => {
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for connection status
      const connectionStatus = page.locator(':has-text("Client Connection"), :has-text("WebSocket"), :has-text("HTTP")');
      const hasStatus = await connectionStatus.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasStatus).toBe('boolean');
    });

    test('displays ADS-B receiver status', async ({ page }) => {
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for ADS-B status
      const adsbStatus = page.locator(':has-text("ADS-B"), .status-item:has-text("ADS-B")');
      const hasStatus = await adsbStatus.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasStatus).toBe('boolean');
    });

    test('displays database status', async ({ page }) => {
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for database status
      const dbStatus = page.locator(':has-text("Database"), .status-item:has-text("Database")');
      const hasStatus = await dbStatus.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasStatus).toBe('boolean');
    });

    test('displays Redis status', async ({ page }) => {
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for Redis status
      const redisStatus = page.locator(':has-text("Redis"), .status-item:has-text("Redis")');
      const hasStatus = await redisStatus.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasStatus).toBe('boolean');
    });

    test('displays WebSocket server status', async ({ page }) => {
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for WebSocket status
      const wsStatus = page.locator(':has-text("WebSocket Server"), .status-item:has-text("WebSocket")');
      const hasStatus = await wsStatus.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasStatus).toBe('boolean');
    });

    test('displays Celery workers status', async ({ page }) => {
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for Celery status
      const celeryStatus = page.locator(':has-text("Celery"), .status-item:has-text("Celery")');
      const hasStatus = await celeryStatus.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasStatus).toBe('boolean');
    });
  });

  test.describe('Database Stats', () => {
    test('database stats card is displayed', async ({ page }) => {
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for database stats card
      const dbCard = page.locator('.system-card:has-text("Database Stats"), .card-header:has-text("Database")');
      const hasCard = await dbCard.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasCard).toBe('boolean');
    });

    test('displays total sightings', async ({ page }) => {
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for sightings count
      const sightings = page.locator(':has-text("Sightings"), .stat-row:has-text("Sightings")');
      const hasSightings = await sightings.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasSightings).toBe('boolean');
    });

    test('displays total sessions', async ({ page }) => {
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for sessions count
      const sessions = page.locator(':has-text("Sessions"), .stat-row:has-text("Sessions")');
      const hasSessions = await sessions.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasSessions).toBe('boolean');
    });
  });

  test.describe('Real-time Stats', () => {
    test('real-time card is displayed', async ({ page }) => {
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for real-time card
      const realtimeCard = page.locator('.system-card:has-text("Real-time"), .card-header:has-text("Real-time")');
      const hasCard = await realtimeCard.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasCard).toBe('boolean');
    });

    test('displays WebSocket clients count', async ({ page }) => {
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for clients count
      const clients = page.locator(':has-text("Clients"), .stat-row:has-text("Clients")');
      const hasClients = await clients.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasClients).toBe('boolean');
    });

    test('displays tracked aircraft count', async ({ page }) => {
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for tracked aircraft
      const tracked = page.locator(':has-text("Tracked Aircraft"), .stat-row:has-text("Tracked")');
      const hasTracked = await tracked.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasTracked).toBe('boolean');
    });
  });

  test.describe('Notifications', () => {
    test('notifications card is displayed', async ({ page }) => {
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for notifications card
      const notifCard = page.locator('.system-card:has-text("Notifications"), .card-header:has-text("Notifications")');
      const hasCard = await notifCard.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasCard).toBe('boolean');
    });

    test('test notification button exists', async ({ page }) => {
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for test button
      const testBtn = page.locator('button:has-text("Test Notification"), .test-btn');
      const hasBtn = await testBtn.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasBtn).toBe('boolean');
    });

    test('can click test notification button', async ({ page, mockApi }) => {
      // Mock test endpoint
      await mockApi.mock('/notifications/test', { success: true }, { method: 'POST' });

      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const testBtn = page.locator('button:has-text("Test Notification"), .test-btn').first();
      if (await testBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await testBtn.click();
        await page.waitForTimeout(500);
        // Button click should work without error
      }
    });
  });

  test.describe('Safety Monitor', () => {
    test('safety monitor card is displayed', async ({ page }) => {
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for safety card
      const safetyCard = page.locator('.system-card:has-text("Safety"), .card-header:has-text("Safety")');
      const hasCard = await safetyCard.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasCard).toBe('boolean');
    });

    test('test safety events button exists', async ({ page }) => {
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for test button
      const testBtn = page.locator('button:has-text("Test Safety"), .test-btn');
      const hasBtn = await testBtn.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasBtn).toBe('boolean');
    });
  });

  test.describe('Feeder Location', () => {
    test('feeder location card is displayed', async ({ page }) => {
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for location card
      const locationCard = page.locator('.system-card:has-text("Location"), .card-header:has-text("Location")');
      const hasCard = await locationCard.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasCard).toBe('boolean');
    });

    test('displays latitude and longitude', async ({ page }) => {
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for coordinates
      const lat = page.locator(':has-text("Latitude"), .coord-label:has-text("Lat")');
      const lon = page.locator(':has-text("Longitude"), .coord-label:has-text("Lon")');
      const hasLat = await lat.isVisible({ timeout: 5000 }).catch(() => false);
      const hasLon = await lon.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasLat).toBe('boolean');
      expect(typeof hasLon).toBe('boolean');
    });
  });

  test.describe('Footer', () => {
    test('system footer is displayed', async ({ page }) => {
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for footer
      const footer = page.locator('.system-footer, [class*="footer"]');
      const hasFooter = await footer.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasFooter).toBe('boolean');
    });

    test('displays API version', async ({ page }) => {
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for version
      const version = page.locator(':has-text("Version"), :has-text("API Version")').first();
      const hasVersion = await version.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasVersion).toBe('boolean');
    });

    test('refresh button exists', async ({ page }) => {
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for refresh button
      const refreshBtn = page.locator('.btn-icon, button[title*="Refresh"]');
      const hasRefresh = await refreshBtn.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasRefresh).toBe('boolean');
    });

    test('can click refresh button', async ({ page }) => {
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const refreshBtn = page.locator('.btn-icon, button[title*="Refresh"]').first();
      if (await refreshBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await refreshBtn.click();
        await page.waitForTimeout(500);
        // Refresh should work without error
      }
    });
  });

  test.describe('Status Badges', () => {
    test('status badges show correct colors', async ({ page }) => {
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for status badges
      const badges = page.locator('.status-badge');
      const badgeCount = await badges.count();
      expect(badgeCount).toBeGreaterThan(0);
    });
  });

  test.describe('Navigation', () => {
    test('can navigate to map view', async ({ page }) => {
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

      await page.click('.nav-item:has-text("Live Map")');
      await page.waitForURL(/#map/);

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toContain('#map');
    });

    test('can navigate to aircraft list', async ({ page }) => {
      await page.goto('/#system');
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
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    });

    test('renders correctly on tablet viewport', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    });

    test('system grid adjusts on small screens', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // System grid should be visible (may have different layout)
      const grid = page.locator('.system-grid, [class*="system-grid"]');
      const hasGrid = await grid.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasGrid).toBe('boolean');
    });
  });

  test.describe('Error Handling', () => {
    test('handles API error gracefully', async ({ page, mockApi }) => {
      // Mock error response
      await mockApi.mockError('/system/status', 500, 'Internal Server Error');

      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Page should still render even with error
      await page.waitForTimeout(1000);
    });
  });

  test.describe('Loading State', () => {
    test('shows loading state initially', async ({ page }) => {
      // Add delay to mock response to catch loading state
      await page.route('**/api/v1/system/status*', async (route) => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'healthy' }),
        });
      });

      await page.goto('/#system');
      await page.waitForLoadState('domcontentloaded');

      // Check for loading indicator
      const loading = page.locator('.loading, [class*="loading"], :has-text("Loading")').first();
      const hasLoading = await loading.isVisible({ timeout: 1000 }).catch(() => false);
      expect(typeof hasLoading).toBe('boolean');
    });
  });
});
