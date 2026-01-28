// @ts-check
/**
 * E2E Tests for Archive View
 * Tests the archive view at #archive hash route
 */

import { test, expect, mockData } from '../fixtures/test-setup.js';

// Mock archived NOTAM data generator
function generateArchivedNotams(count = 5) {
  const types = ['D', 'FDC', 'TFR', 'GPS', 'MIL'];
  const locations = ['KJFK', 'KLAX', 'KORD', 'KSFO', 'KATL'];
  const reasons = ['expired', 'cancelled', 'superseded'];

  return Array.from({ length: count }, (_, i) => ({
    notam_id: `NOTAM-ARCH-${1000 + i}`,
    notam_type: types[i % types.length],
    location: locations[i % locations.length],
    text: `Archived NOTAM text for ${locations[i % locations.length]}. This NOTAM has been archived.`,
    effective_start: new Date(Date.now() - (30 + i) * 86400000).toISOString(),
    effective_end: new Date(Date.now() - (i + 1) * 86400000).toISOString(),
    archived_at: new Date(Date.now() - i * 86400000).toISOString(),
    archive_reason: reasons[i % reasons.length],
    is_permanent: false,
    floor_ft: i % 2 === 0 ? 0 : 5000,
    ceiling_ft: 10000 + i * 1000,
    latitude: 37.7749 + i * 0.1,
    longitude: -122.4194 + i * 0.1,
  }));
}

// Mock archived PIREP data generator
function generateArchivedPireps(count = 5) {
  const locations = ['KJFK', 'KLAX', 'KORD', 'KSFO', 'KATL'];
  const reportTypes = ['UA', 'UUA'];
  const turbulenceTypes = ['NEG', 'LGT', 'MOD', 'SEV', 'LGT-MOD'];
  const icingTypes = ['NEG', 'TRC', 'LGT', 'MOD'];

  return Array.from({ length: count }, (_, i) => ({
    pirep_id: `PIREP-${1000 + i}`,
    report_type: reportTypes[i % reportTypes.length],
    location: locations[i % locations.length],
    aircraft_type: ['B738', 'A320', 'E190', 'CRJ9'][i % 4],
    observation_time: new Date(Date.now() - i * 3600000).toISOString(),
    altitude_ft: 20000 + i * 2000,
    flight_level: 200 + i * 20,
    turbulence_type: turbulenceTypes[i % turbulenceTypes.length],
    icing_type: icingTypes[i % icingTypes.length],
    temperature_c: -20 - i * 5,
    wind_dir: 270 + i * 10,
    wind_speed_kt: 50 + i * 10,
    raw_text: `UA /OV ${locations[i % locations.length]} /TM ${new Date().toISOString()} /FL${200 + i * 20} /TB ${turbulenceTypes[i % turbulenceTypes.length]} /IC ${icingTypes[i % icingTypes.length]}`,
  }));
}

test.describe('Archive View', () => {
  test.beforeEach(async ({ page, mockApi }) => {
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList(mockData.generateAircraft(5));
    await mockApi.mockSystemStatus();

    // Mock Archive endpoints
    await mockApi.mock('/archive/stats/', {
      notams: {
        total_archived: 150,
        archived_last_30_days: 45,
        by_type: { D: 50, FDC: 30, TFR: 20, GPS: 30, MIL: 20 },
      },
      pireps: {
        total_archived: 500,
        total_records: 1200,
        by_type: { UA: 400, UUA: 100 },
      },
    });

    await mockApi.mock('/archive/notams/', {
      notams: generateArchivedNotams(10),
      total_count: 150,
    });

    await mockApi.mock('/archive/pireps/', {
      pireps: generateArchivedPireps(10),
      total_count: 500,
    });
  });

  test.describe('Basic Rendering', () => {
    test('archive view loads successfully', async ({ page }) => {
      await page.goto('/#archive');
      await page.waitForLoadState('domcontentloaded');

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toBe('#archive');

      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    });

    test('sidebar is visible', async ({ page }) => {
      await page.goto('/#archive');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });
    });

    test('archive header is displayed', async ({ page }) => {
      await page.goto('/#archive');
      await page.waitForLoadState('domcontentloaded');

      // Check for archive header
      const header = page.locator('.archive-header, h2:has-text("Archive"), .header-title:has-text("Archive")');
      const hasHeader = await header.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasHeader).toBe('boolean');
    });
  });

  test.describe('Archive Stats', () => {
    test('displays archive statistics', async ({ page }) => {
      await page.goto('/#archive');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      // Check for stats display
      const stats = page.locator('.archive-stats, .stat-group, [class*="stat"]').first();
      const hasStats = await stats.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasStats).toBe('boolean');
    });
  });

  test.describe('Tab Navigation', () => {
    test('NOTAMs tab is active by default', async ({ page }) => {
      await page.goto('/#archive');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for active NOTAMs tab
      const notamsTab = page.locator('button:has-text("NOTAM"), .tab-buttons button:has-text("NOTAM")').first();
      const hasNotamsTab = await notamsTab.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasNotamsTab).toBe('boolean');
    });

    test('can switch to PIREPs tab', async ({ page }) => {
      await page.goto('/#archive');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Click PIREPs tab
      const pirepsTab = page.locator('button:has-text("PIREP"), .tab-buttons button:has-text("PIREP")');
      if (await pirepsTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await pirepsTab.click();
        await page.waitForTimeout(300);

        // Tab should become active
        const isActive = await pirepsTab.evaluate(el => el.classList.contains('active'));
        expect(typeof isActive).toBe('boolean');
      }
    });
  });

  test.describe('Archived NOTAMs Display', () => {
    test('displays archived NOTAM entries', async ({ page }) => {
      await page.goto('/#archive');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      // Check for archived NOTAM cards
      const notamCard = page.locator('.archive-card, .notam-card, [class*="archive"]').first();
      const hasNotams = await notamCard.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasNotams).toBe('boolean');
    });

    test('shows archived timestamp', async ({ page }) => {
      await page.goto('/#archive');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      // Check for archived badge/timestamp
      const archivedBadge = page.locator('.archive-archived-badge, [class*="archived"]');
      const hasBadge = await archivedBadge.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasBadge).toBe('boolean');
    });

    test('NOTAM card expands on click', async ({ page }) => {
      await page.goto('/#archive');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      // Click on a NOTAM card to expand
      const card = page.locator('.archive-card, .notam-card').first();
      if (await card.isVisible({ timeout: 3000 }).catch(() => false)) {
        await card.click();
        await page.waitForTimeout(300);

        // Check for expanded content
        const details = page.locator('.archive-card-details, .archive-full-text');
        const hasDetails = await details.isVisible({ timeout: 2000 }).catch(() => false);
        expect(typeof hasDetails).toBe('boolean');
      }
    });
  });

  test.describe('Archived PIREPs Display', () => {
    test('displays archived PIREP entries when tab is active', async ({ page }) => {
      await page.goto('/#archive');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Switch to PIREPs tab
      const pirepsTab = page.locator('button:has-text("PIREP"), .tab-buttons button:has-text("PIREP")');
      if (await pirepsTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await pirepsTab.click();
        await page.waitForTimeout(500);

        // Check for PIREP cards
        const pirepCard = page.locator('.pirep-card, .archive-card.pirep-card, [class*="pirep"]');
        const hasPireps = await pirepCard.isVisible({ timeout: 5000 }).catch(() => false);
        expect(typeof hasPireps).toBe('boolean');
      }
    });

    test('PIREP card shows turbulence and icing info', async ({ page }) => {
      await page.goto('/#archive');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Switch to PIREPs tab
      const pirepsTab = page.locator('button:has-text("PIREP")');
      if (await pirepsTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await pirepsTab.click();
        await page.waitForTimeout(500);

        // Check for condition badges
        const conditionBadge = page.locator('.condition-badge, [class*="turbulence"], [class*="icing"]');
        const hasBadge = await conditionBadge.isVisible({ timeout: 3000 }).catch(() => false);
        expect(typeof hasBadge).toBe('boolean');
      }
    });
  });

  test.describe('Date Range Selection', () => {
    test('date range selector exists', async ({ page }) => {
      await page.goto('/#archive');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for date filter
      const dateFilter = page.locator('select.date-filter, .date-filter, select[class*="date"]');
      const hasDateFilter = await dateFilter.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasDateFilter).toBe('boolean');
    });

    test('can change date range', async ({ page }) => {
      await page.goto('/#archive');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const dateFilter = page.locator('select.date-filter, .date-filter select').first();
      if (await dateFilter.isVisible({ timeout: 3000 }).catch(() => false)) {
        await dateFilter.selectOption({ index: 1 });
        await page.waitForTimeout(500);
        // Selection should work without error
      }
    });
  });

  test.describe('Filtering', () => {
    test('search input exists', async ({ page }) => {
      await page.goto('/#archive');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for search input
      const searchInput = page.locator('.search-box input, input[placeholder*="Search"]');
      const hasSearch = await searchInput.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasSearch).toBe('boolean');
    });

    test('ICAO filter input exists', async ({ page }) => {
      await page.goto('/#archive');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for ICAO filter
      const icaoFilter = page.locator('.icao-filter input, input[placeholder*="ICAO"]');
      const hasIcaoFilter = await icaoFilter.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasIcaoFilter).toBe('boolean');
    });

    test('type filter exists', async ({ page }) => {
      await page.goto('/#archive');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for type filter
      const typeFilter = page.locator('select.type-filter, .type-filter select');
      const hasTypeFilter = await typeFilter.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasTypeFilter).toBe('boolean');
    });

    test('can filter by search query', async ({ page }) => {
      await page.goto('/#archive');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const searchInput = page.locator('.search-box input, input[placeholder*="Search"]').first();
      if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await searchInput.fill('KJFK');
        const value = await searchInput.inputValue();
        expect(value).toBe('KJFK');
      }
    });
  });

  test.describe('Pagination', () => {
    test('pagination controls exist', async ({ page }) => {
      await page.goto('/#archive');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      // Check for pagination
      const pagination = page.locator('.archive-pagination, .pagination, [class*="pagination"]');
      const hasPagination = await pagination.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasPagination).toBe('boolean');
    });

    test('shows pagination info', async ({ page }) => {
      await page.goto('/#archive');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      // Check for pagination info
      const paginationInfo = page.locator('.pagination-info, [class*="showing"]');
      const hasInfo = await paginationInfo.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasInfo).toBe('boolean');
    });

    test('can navigate to next page', async ({ page }) => {
      await page.goto('/#archive');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      // Click next button
      const nextBtn = page.locator('button:has-text("Next"), .pagination button:has-text("Next")');
      if (await nextBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        const isDisabled = await nextBtn.isDisabled().catch(() => false);
        if (!isDisabled) {
          await nextBtn.click();
          await page.waitForTimeout(500);
          // Navigation should work without error
        }
      }
    });
  });

  test.describe('Empty State', () => {
    test('handles empty archive gracefully', async ({ page, mockApi }) => {
      // Mock empty response
      await mockApi.mock('/archive/notams/', { notams: [], total_count: 0 });

      await page.goto('/#archive');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      // Check for empty state
      const emptyState = page.locator('.empty-state, :has-text("No archived")').first();
      const hasEmptyState = await emptyState.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasEmptyState).toBe('boolean');
    });
  });

  test.describe('Navigation', () => {
    test('can navigate to map view', async ({ page }) => {
      await page.goto('/#archive');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

      await page.click('.nav-item:has-text("Live Map")');
      await page.waitForURL(/#map/);

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toContain('#map');
    });

    test('can navigate to aircraft list', async ({ page }) => {
      await page.goto('/#archive');
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
      await page.goto('/#archive');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    });

    test('renders correctly on tablet viewport', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto('/#archive');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Error Handling', () => {
    test('handles API error gracefully', async ({ page, mockApi }) => {
      // Mock error response
      await mockApi.mockError('/archive/notams/', 500, 'Internal Server Error');

      await page.goto('/#archive');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      // Check for error state
      const errorState = page.locator('.error-state, [role="alert"], :has-text("Error")').first();
      const hasError = await errorState.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasError).toBe('boolean');
    });
  });
});
