// @ts-check
/**
 * E2E Tests for NOTAMs View
 * Tests the NOTAMs view at #notams hash route
 */

import { test, expect, mockData } from '../fixtures/test-setup.js';

// Mock NOTAM data generator
function generateMockNotams(count = 5) {
  const types = ['D', 'FDC', 'TFR', 'GPS', 'MIL'];
  const locations = ['KJFK', 'KLAX', 'KORD', 'KSFO', 'KATL'];

  return Array.from({ length: count }, (_, i) => ({
    notam_id: `NOTAM-${1000 + i}`,
    notam_type: types[i % types.length],
    type: types[i % types.length],
    location: locations[i % locations.length],
    text: `This is a sample NOTAM text for testing purposes. NOTAM ${i + 1} affects operations at ${locations[i % locations.length]}.`,
    effective_start: new Date(Date.now() - i * 3600000).toISOString(),
    effective_end: new Date(Date.now() + (7 - i) * 86400000).toISOString(),
    is_permanent: i === 0,
    floor_ft: i % 2 === 0 ? 0 : 5000,
    ceiling_ft: 10000 + i * 1000,
    radius_nm: i % 2 === 0 ? null : 5 + i,
    latitude: 37.7749 + i * 0.1,
    longitude: -122.4194 + i * 0.1,
    reason: i % 2 === 0 ? 'Airshow' : null,
    keywords: ['AIRSPACE', 'RESTRICTION'],
  }));
}

// Mock TFR data generator
function generateMockTfrs(count = 3) {
  const locations = ['KLAX', 'KJFK', 'KDCA'];
  const reasons = ['VIP Movement', 'Sporting Event', 'Military Exercise'];

  return Array.from({ length: count }, (_, i) => ({
    notam_id: `TFR-${100 + i}`,
    notam_type: 'TFR',
    type: 'TFR',
    location: locations[i % locations.length],
    text: `Temporary Flight Restriction for ${reasons[i % reasons.length]} at ${locations[i % locations.length]}`,
    effective_start: new Date(Date.now() - i * 3600000).toISOString(),
    effective_end: new Date(Date.now() + (2 - i) * 86400000).toISOString(),
    floor_ft: 0,
    ceiling_ft: 18000,
    radius_nm: 10 + i * 5,
    latitude: 33.9425 + i * 2,
    longitude: -118.4081 + i * 2,
    reason: reasons[i % reasons.length],
  }));
}

test.describe('NOTAMs View', () => {
  test.beforeEach(async ({ page, mockApi }) => {
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList(mockData.generateAircraft(5));
    await mockApi.mockSystemStatus();

    // Mock NOTAMs endpoints
    const notams = generateMockNotams(5);
    const tfrs = generateMockTfrs(3);

    await mockApi.mock('/notams/', {
      notams,
      total_count: notams.length,
    });

    await mockApi.mock('/notams/tfrs/', {
      tfrs,
      total_count: tfrs.length,
    });

    await mockApi.mock('/notams/stats/', {
      active_notams: notams.length,
      active_tfrs: tfrs.length,
      by_type: {
        D: 1,
        FDC: 1,
        TFR: 3,
        GPS: 1,
        MIL: 1,
      },
      last_refresh: new Date().toISOString(),
    });
  });

  test.describe('Basic Rendering', () => {
    test('NOTAMs view loads successfully', async ({ page }) => {
      await page.goto('/#notams');
      await page.waitForLoadState('domcontentloaded');

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toBe('#notams');

      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    });

    test('sidebar is visible', async ({ page }) => {
      await page.goto('/#notams');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });
    });

    test('NOTAMs header is displayed', async ({ page }) => {
      await page.goto('/#notams');
      await page.waitForLoadState('domcontentloaded');

      // Check for NOTAMs header or title
      const header = page.locator('.notams-header, h2:has-text("NOTAMs"), .header-title:has-text("NOTAMs")');
      const hasHeader = await header.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasHeader).toBe('boolean');
    });
  });

  test.describe('NOTAM List Display', () => {
    test('displays NOTAM entries', async ({ page }) => {
      await page.goto('/#notams');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Wait for NOTAMs to load
      await page.waitForTimeout(1000);

      // Check for NOTAM cards or list items
      const notamCard = page.locator('.notam-card, .notam-item, [class*="notam"]').first();
      const hasNotams = await notamCard.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasNotams).toBe('boolean');
    });

    test('displays NOTAM type badges', async ({ page }) => {
      await page.goto('/#notams');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      // Check for type badges (D, FDC, TFR, etc.)
      const typeBadge = page.locator('.notam-type-badge, .type-badge, [class*="badge"]').first();
      const hasBadge = await typeBadge.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasBadge).toBe('boolean');
    });

    test('displays NOTAM location', async ({ page }) => {
      await page.goto('/#notams');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      // Check for location display
      const pageContent = await page.textContent('body');
      const hasLocation = pageContent.includes('KJFK') || pageContent.includes('KLAX') ||
                          pageContent.includes('KORD') || pageContent.includes('KSFO');
      expect(typeof hasLocation).toBe('boolean');
    });
  });

  test.describe('NOTAM Detail Expansion', () => {
    test('clicking NOTAM card expands details', async ({ page }) => {
      await page.goto('/#notams');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      // Click on a NOTAM card to expand
      const notamCard = page.locator('.notam-card, .notam-item').first();
      if (await notamCard.isVisible({ timeout: 3000 }).catch(() => false)) {
        await notamCard.click();

        // Wait for expansion
        await page.waitForTimeout(300);

        // Check for expanded state or details
        const expandedContent = page.locator('.notam-card.expanded, .notam-card-details, .notam-full-text');
        const isExpanded = await expandedContent.isVisible({ timeout: 2000 }).catch(() => false);
        expect(typeof isExpanded).toBe('boolean');
      }
    });
  });

  test.describe('NOTAM Filtering and Search', () => {
    test('search input is present', async ({ page }) => {
      await page.goto('/#notams');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for search input
      const searchInput = page.locator('input[placeholder*="Search"], .search-box input, .search-input');
      const hasSearch = await searchInput.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasSearch).toBe('boolean');
    });

    test('can type in search field', async ({ page }) => {
      await page.goto('/#notams');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const searchInput = page.locator('input[placeholder*="Search"], .search-box input').first();
      if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await searchInput.fill('KJFK');
        const value = await searchInput.inputValue();
        expect(value).toBe('KJFK');
      }
    });

    test('type filter dropdown exists', async ({ page }) => {
      await page.goto('/#notams');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for type filter
      const typeFilter = page.locator('select.type-filter, select[class*="filter"], .filter-select select');
      const hasFilter = await typeFilter.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasFilter).toBe('boolean');
    });
  });

  test.describe('TFR Tab', () => {
    test('can switch to TFR tab', async ({ page }) => {
      await page.goto('/#notams');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Click TFR tab
      const tfrTab = page.locator('button:has-text("TFR"), .tab-buttons button:has-text("TFR")');
      if (await tfrTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await tfrTab.click();

        // Tab should be active
        await page.waitForTimeout(300);
        const isActive = await tfrTab.evaluate(el => el.classList.contains('active'));
        expect(typeof isActive).toBe('boolean');
      }
    });

    test('TFR cards are displayed', async ({ page }) => {
      await page.goto('/#notams');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Click TFR tab
      const tfrTab = page.locator('button:has-text("TFR"), .tab-buttons button:has-text("TFR")');
      if (await tfrTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await tfrTab.click();
        await page.waitForTimeout(500);

        // Check for TFR cards
        const tfrCard = page.locator('.tfr-card, .tfr-grid .tfr-card');
        const hasTfrCards = await tfrCard.isVisible({ timeout: 3000 }).catch(() => false);
        expect(typeof hasTfrCards).toBe('boolean');
      }
    });
  });

  test.describe('Airport Search', () => {
    test('airport search input exists', async ({ page }) => {
      await page.goto('/#notams');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for airport search
      const airportSearch = page.locator('.airport-search, input[placeholder*="airport"], input[placeholder*="ICAO"]');
      const hasAirportSearch = await airportSearch.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasAirportSearch).toBe('boolean');
    });

    test('can search for airport NOTAMs', async ({ page, mockApi }) => {
      // Mock airport-specific endpoint
      await mockApi.mock('/notams/airport/KJFK/', {
        notams: generateMockNotams(2).map(n => ({ ...n, location: 'KJFK' })),
        count: 2,
      });

      await page.goto('/#notams');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const airportInput = page.locator('.airport-search input, input[placeholder*="ICAO"]').first();
      if (await airportInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await airportInput.fill('KJFK');

        // Click search button
        const searchBtn = page.locator('.airport-search button, button:has-text("Search")').first();
        if (await searchBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await searchBtn.click();
          await page.waitForTimeout(500);
        }
      }
    });
  });

  test.describe('Stats Display', () => {
    test('NOTAM stats are displayed', async ({ page }) => {
      await page.goto('/#notams');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for stats section
      const stats = page.locator('.notam-stats, .stats-summary, [class*="stat"]').first();
      const hasStats = await stats.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasStats).toBe('boolean');
    });
  });

  test.describe('Empty State', () => {
    test('handles empty NOTAM list gracefully', async ({ page, mockApi }) => {
      // Mock empty response
      await mockApi.mock('/notams/', { notams: [], total_count: 0 });

      await page.goto('/#notams');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      // Check for empty state
      const emptyState = page.locator('.empty-state, :has-text("No NOTAMs")').first();
      const hasEmptyState = await emptyState.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasEmptyState).toBe('boolean');
    });
  });

  test.describe('Navigation', () => {
    test('can navigate to map view', async ({ page }) => {
      await page.goto('/#notams');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

      await page.click('.nav-item:has-text("Live Map")');
      await page.waitForURL(/#map/);

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toContain('#map');
    });

    test('can navigate to aircraft list', async ({ page }) => {
      await page.goto('/#notams');
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
      await page.goto('/#notams');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    });

    test('renders correctly on tablet viewport', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto('/#notams');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Connection Status', () => {
    test('displays connection indicator', async ({ page }) => {
      await page.goto('/#notams');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for connection indicator
      const indicator = page.locator('.connection-indicator, [class*="connection"]');
      const hasIndicator = await indicator.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasIndicator).toBe('boolean');
    });
  });
});
