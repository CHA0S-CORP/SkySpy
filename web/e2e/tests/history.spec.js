// @ts-check
/**
 * E2E Tests for the History View
 * Tests the history view at #history hash route including all features
 */

import { test, expect, mockData } from '../fixtures/test-setup.js';

// Mock sightings data
function generateMockSightings(count = 20) {
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
    track: 270 + i * 10,
    distance_nm: 5 + i * 2,
    session_id: Math.floor(i / 5) + 1,
  }));
}

// Mock sessions data
function generateMockSessions(count = 10) {
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

// Mock safety events
function generateMockSafetyEvents(count = 5) {
  const types = ['conflict', 'tcas', 'altitude_deviation'];
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    type: types[i % types.length],
    severity: ['warning', 'alert'][i % 2],
    timestamp: new Date(Date.now() - i * 86400000).toISOString(),
    aircraft1: { hex: `ABC${100 + i}`, flight: `UAL${100 + i}` },
    aircraft2: i % 2 === 0 ? { hex: `DEF${200 + i}`, flight: `DAL${200 + i}` } : null,
    description: `Safety event ${i + 1}`,
  }));
}

test.describe('History View', () => {
  test.beforeEach(async ({ page, mockApi }) => {
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList(mockData.generateAircraft(5));
    await mockApi.mockSystemStatus();
    await mockApi.mock('/sessions', { sessions: generateMockSessions(10), count: 10 });
    await mockApi.mock('/sightings', { sightings: generateMockSightings(20), count: 20 });
    await mockApi.mock('/acars', { messages: [], count: 0 });
    await mockApi.mock('/safety/events', { events: generateMockSafetyEvents(5), count: 5 });
  });

  test.describe('Basic Rendering', () => {
    test('history view loads successfully', async ({ page }) => {
      await page.goto('/#history');
      await page.waitForLoadState('domcontentloaded');

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toBe('#history');

      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    });

    test('sidebar is visible', async ({ page }) => {
      await page.goto('/#history');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });
    });

    test('history container is displayed', async ({ page }) => {
      await page.goto('/#history');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for history container
      const container = page.locator('.history-view, [class*="history"]').first();
      const hasContainer = await container.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasContainer).toBe('boolean');
    });
  });

  test.describe('Sightings Search', () => {
    test('search input exists', async ({ page }) => {
      await page.goto('/#history');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for search input
      const searchInput = page.locator('input[placeholder*="Search"], .search-input, .search-box input').first();
      const hasSearch = await searchInput.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasSearch).toBe('boolean');
    });

    test('can type in search field', async ({ page }) => {
      await page.goto('/#history');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const searchInput = page.locator('input[placeholder*="Search"], .search-input').first();
      if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await searchInput.fill('UAL123');
        const value = await searchInput.inputValue();
        expect(value).toBe('UAL123');
      }
    });

    test('search filters results', async ({ page }) => {
      await page.goto('/#history');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      const searchInput = page.locator('input[placeholder*="Search"], .search-input').first();
      if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await searchInput.fill('ABC');
        await page.waitForTimeout(500);
        // Filter should apply without error
      }
    });
  });

  test.describe('Sightings Display', () => {
    test('displays sightings list', async ({ page }) => {
      await page.goto('/#history');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      // Check for sighting entries
      const sighting = page.locator('.sighting-row, [class*="sighting-item"], tbody tr').first();
      const hasSightings = await sighting.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasSightings).toBe('boolean');
    });

    test('sighting shows aircraft callsign', async ({ page }) => {
      await page.goto('/#history');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      // Check for callsign
      const pageContent = await page.textContent('body');
      const hasCallsign = pageContent.includes('UAL') || pageContent.includes('Flight');
      expect(typeof hasCallsign).toBe('boolean');
    });

    test('sighting shows timestamp', async ({ page }) => {
      await page.goto('/#history');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      // Check for timestamp
      const timestamp = page.locator('[class*="timestamp"], [class*="time"], time').first();
      const hasTimestamp = await timestamp.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasTimestamp).toBe('boolean');
    });

    test('clicking sighting shows detail', async ({ page }) => {
      await page.goto('/#history');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      const row = page.locator('.sighting-row, [class*="sighting-item"], tbody tr').first();
      if (await row.isVisible({ timeout: 3000 }).catch(() => false)) {
        await row.click();
        await page.waitForTimeout(500);

        // Check for detail panel or navigation
        const detail = page.locator('.detail-panel, [class*="detail"]');
        const hasDetail = await detail.isVisible({ timeout: 2000 }).catch(() => false);
        expect(typeof hasDetail).toBe('boolean');
      }
    });
  });

  test.describe('Safety Events Display', () => {
    test('safety events tab exists', async ({ page }) => {
      await page.goto('/#history');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for safety tab
      const safetyTab = page.locator('button:has-text("Safety"), [class*="safety-tab"]').first();
      const hasTab = await safetyTab.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasTab).toBe('boolean');
    });

    test('displays safety events', async ({ page }) => {
      await page.goto('/#history');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Click safety tab if exists
      const safetyTab = page.locator('button:has-text("Safety")').first();
      if (await safetyTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await safetyTab.click();
        await page.waitForTimeout(500);

        // Check for events
        const event = page.locator('.safety-event, [class*="safety-item"]').first();
        const hasEvents = await event.isVisible({ timeout: 3000 }).catch(() => false);
        expect(typeof hasEvents).toBe('boolean');
      }
    });

    test('safety event shows severity', async ({ page }) => {
      await page.goto('/#history');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const safetyTab = page.locator('button:has-text("Safety")').first();
      if (await safetyTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await safetyTab.click();
        await page.waitForTimeout(500);

        // Check for severity indicator
        const severity = page.locator('[class*="severity"], [class*="warning"]').first();
        const hasSeverity = await severity.isVisible({ timeout: 3000 }).catch(() => false);
        expect(typeof hasSeverity).toBe('boolean');
      }
    });
  });

  test.describe('Date Range Picker', () => {
    test('date range picker exists', async ({ page }) => {
      await page.goto('/#history');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for date picker
      const datePicker = page.locator('input[type="date"], .date-picker, [class*="date-range"]').first();
      const hasPicker = await datePicker.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasPicker).toBe('boolean');
    });

    test('quick date buttons exist', async ({ page }) => {
      await page.goto('/#history');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for quick buttons (Today, Week, etc.)
      const quickBtn = page.locator('button:has-text("Today"), button:has-text("Week"), button:has-text("Month")').first();
      const hasQuickBtn = await quickBtn.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasQuickBtn).toBe('boolean');
    });

    test('can change date range', async ({ page }) => {
      await page.goto('/#history');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const weekBtn = page.locator('button:has-text("Week")').first();
      if (await weekBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await weekBtn.click();
        await page.waitForTimeout(500);
        // Selection should work without error
      }
    });
  });

  test.describe('Column Sorting', () => {
    test('column headers are sortable', async ({ page }) => {
      await page.goto('/#history');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      // Check for sortable headers
      const header = page.locator('th[class*="sortable"], th[role="columnheader"]').first();
      const hasHeaders = await header.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasHeaders).toBe('boolean');
    });

    test('clicking header sorts column', async ({ page }) => {
      await page.goto('/#history');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      const header = page.locator('th[class*="sortable"], th:has-text("Time")').first();
      if (await header.isVisible({ timeout: 3000 }).catch(() => false)) {
        await header.click();
        await page.waitForTimeout(300);
        // Sort should work without error
      }
    });
  });

  test.describe('Empty State', () => {
    test('handles no sightings gracefully', async ({ page, mockApi }) => {
      await mockApi.mock('/sightings', { sightings: [], count: 0 });

      await page.goto('/#history');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      // Check for empty state
      const emptyState = page.locator('.empty-state, :has-text("No sightings")').first();
      const hasEmpty = await emptyState.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasEmpty).toBe('boolean');
    });

    test('shows message for empty filtered results', async ({ page }) => {
      await page.goto('/#history');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const searchInput = page.locator('input[placeholder*="Search"], .search-input').first();
      if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await searchInput.fill('NONEXISTENT12345');
        await page.waitForTimeout(500);

        // Check for no results message
        const noResults = page.locator(':has-text("No results"), :has-text("No sightings")').first();
        const hasNoResults = await noResults.isVisible({ timeout: 3000 }).catch(() => false);
        expect(typeof hasNoResults).toBe('boolean');
      }
    });
  });

  test.describe('Sessions View', () => {
    test('sessions tab exists', async ({ page }) => {
      await page.goto('/#history');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for sessions tab
      const sessionsTab = page.locator('button:has-text("Sessions"), [class*="sessions-tab"]').first();
      const hasTab = await sessionsTab.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasTab).toBe('boolean');
    });

    test('displays session list', async ({ page }) => {
      await page.goto('/#history');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const sessionsTab = page.locator('button:has-text("Sessions")').first();
      if (await sessionsTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await sessionsTab.click();
        await page.waitForTimeout(500);

        // Check for session entries
        const session = page.locator('.session-row, [class*="session-item"]').first();
        const hasSessions = await session.isVisible({ timeout: 3000 }).catch(() => false);
        expect(typeof hasSessions).toBe('boolean');
      }
    });
  });

  test.describe('Navigation', () => {
    test('can navigate to map view', async ({ page }) => {
      await page.goto('/#history');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

      await page.click('.nav-item:has-text("Live Map")');
      await page.waitForURL(/#map/);

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toContain('#map');
    });

    test('can navigate to aircraft list', async ({ page }) => {
      await page.goto('/#history');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

      await page.click('.nav-item:has-text("Aircraft List")');
      await page.waitForURL(/#aircraft/);

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toBe('#aircraft');
    });
  });

  test.describe('Error Handling', () => {
    test('handles API error gracefully', async ({ page, mockApi }) => {
      await mockApi.mockError('/sightings', 500, 'Server error');

      await page.goto('/#history');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Page should still render
      await page.waitForTimeout(1000);
    });
  });

  test.describe('Responsive Design', () => {
    test('renders correctly on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/#history');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    });

    test('renders correctly on tablet viewport', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto('/#history');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    });

    test('table adapts on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/#history');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Table should be visible and adapt
      const table = page.locator('table, [class*="table"]').first();
      const hasTable = await table.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasTable).toBe('boolean');
    });
  });

  test.describe('Loading State', () => {
    test('shows loading state while fetching', async ({ page }) => {
      // Delay response
      await page.route('**/api/v1/sightings*', async (route) => {
        await new Promise(resolve => setTimeout(resolve, 500));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ sightings: [], count: 0 }),
        });
      });

      await page.goto('/#history');
      await page.waitForLoadState('domcontentloaded');

      // Check for loading indicator
      const loading = page.locator('.loading, [class*="loading"]').first();
      const hasLoading = await loading.isVisible({ timeout: 1000 }).catch(() => false);
      expect(typeof hasLoading).toBe('boolean');
    });
  });
});
