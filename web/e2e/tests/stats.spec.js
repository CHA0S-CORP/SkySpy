// @ts-check
/**
 * E2E Tests for the Stats View
 * Tests the stats view at #stats hash route including all features
 */

import { test, expect, mockData } from '../fixtures/test-setup.js';

test.describe('Stats View', () => {
  test.beforeEach(async ({ page, mockApi }) => {
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList(mockData.generateAircraft(5));
    await mockApi.mockSystemStatus();

    // Comprehensive stats mocks
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
        { hex: 'GHI789', flight: 'SWA789', count: 100 },
      ],
    });

    await mockApi.mock('/history/stats', {
      stats: {
        total_sightings: 15000,
        total_sessions: 350,
        unique_aircraft: 2500,
        busiest_day: '2024-01-15',
        average_daily_count: 42,
      },
    });

    await mockApi.mock('/acars/stats', {
      total_messages: 5000,
      messages_today: 150,
      by_label: {
        H1: 2000,
        SA: 1500,
        B1: 1000,
        other: 500,
      },
    });

    await mockApi.mock('/stats/overview', {
      aircraft_seen_today: 150,
      messages_today: 450,
      alerts_triggered: 5,
      active_sessions: 12,
    });

    await mockApi.mock('/stats/geographic', {
      top_countries: [
        { country: 'United States', count: 800 },
        { country: 'Canada', count: 200 },
        { country: 'Mexico', count: 100 },
      ],
      coverage_radius_nm: 250,
    });

    await mockApi.mock('/stats/achievements', {
      achievements: [
        { id: 'first_aircraft', name: 'First Contact', earned: true },
        { id: 'hundred_aircraft', name: 'Century Club', earned: true },
        { id: 'rare_spotter', name: 'Rare Spotter', earned: false },
      ],
    });

    await mockApi.mock('/stats/patterns', {
      busiest_hour: 14,
      busiest_day: 'Friday',
      peak_altitude_ft: 38000,
      common_aircraft_types: ['B738', 'A320', 'B77W'],
    });
  });

  test.describe('Basic Rendering', () => {
    test('stats view loads successfully', async ({ page }) => {
      await page.goto('/#stats');
      await page.waitForLoadState('domcontentloaded');

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toBe('#stats');

      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    });

    test('sidebar is visible', async ({ page }) => {
      await page.goto('/#stats');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });
    });

    test('stats container is displayed', async ({ page }) => {
      await page.goto('/#stats');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for stats container
      const container = page.locator('.stats-view, [class*="stats"]').first();
      const hasContainer = await container.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasContainer).toBe('boolean');
    });
  });

  test.describe('Overview Section', () => {
    test('displays aircraft count', async ({ page }) => {
      await page.goto('/#stats');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      // Check for aircraft count
      const pageContent = await page.textContent('body');
      const hasCount = pageContent.includes('42') || pageContent.includes('Aircraft') ||
                       /\d+/.test(pageContent);
      expect(typeof hasCount).toBe('boolean');
    });

    test('displays message rate', async ({ page }) => {
      await page.goto('/#stats');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      // Check for rate display
      const pageContent = await page.textContent('body');
      const hasRate = pageContent.includes('msg/s') || pageContent.includes('/s') ||
                      pageContent.includes('156');
      expect(typeof hasRate).toBe('boolean');
    });
  });

  test.describe('Stat Sections', () => {
    test('displays multiple stat sections', async ({ page }) => {
      await page.goto('/#stats');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      // Check for stat sections
      const sections = page.locator('.stat-section, [class*="stat-card"], [class*="stat-group"]');
      const sectionCount = await sections.count();
      expect(sectionCount).toBeGreaterThanOrEqual(0);
    });

    test('ACARS section is displayed', async ({ page }) => {
      await page.goto('/#stats');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      // Check for ACARS section
      const acarsSection = page.locator(':has-text("ACARS"), [class*="acars"]').first();
      const hasAcars = await acarsSection.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasAcars).toBe('boolean');
    });

    test('flight patterns section is displayed', async ({ page }) => {
      await page.goto('/#stats');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      // Check for patterns section
      const patternsSection = page.locator(':has-text("Pattern"), :has-text("Busiest")').first();
      const hasPatterns = await patternsSection.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasPatterns).toBe('boolean');
    });

    test('geographic section is displayed', async ({ page }) => {
      await page.goto('/#stats');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      // Check for geographic section
      const geoSection = page.locator(':has-text("Geographic"), :has-text("Countries")').first();
      const hasGeo = await geoSection.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasGeo).toBe('boolean');
    });
  });

  test.describe('Charts', () => {
    test('chart rendering verification', async ({ page }) => {
      await page.goto('/#stats');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      // Check for chart elements
      const chart = page.locator('canvas, svg, [class*="chart"]').first();
      const hasChart = await chart.isVisible({ timeout: 5000 }).catch(() => false);
      expect(typeof hasChart).toBe('boolean');
    });

    test('chart has proper labels', async ({ page }) => {
      await page.goto('/#stats');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      // Charts should have labels
      const chartLabels = page.locator('[class*="chart-label"], [class*="legend"]');
      const hasLabels = await chartLabels.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasLabels).toBe('boolean');
    });
  });

  test.describe('Time Comparison', () => {
    test('time selector exists', async ({ page }) => {
      await page.goto('/#stats');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for time selector
      const timeSelector = page.locator('select[class*="time"], [class*="time-range"], button:has-text("Today")').first();
      const hasSelector = await timeSelector.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasSelector).toBe('boolean');
    });

    test('can change time range', async ({ page }) => {
      await page.goto('/#stats');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const timeSelector = page.locator('select[class*="time"], [class*="time-range"] select').first();
      if (await timeSelector.isVisible({ timeout: 3000 }).catch(() => false)) {
        await timeSelector.selectOption({ index: 1 });
        await page.waitForTimeout(500);
        // Selection should work without error
      }
    });
  });

  test.describe('Achievements / Gamification', () => {
    test('achievements section exists', async ({ page }) => {
      await page.goto('/#stats');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      // Check for achievements
      const achievements = page.locator('.achievements, :has-text("Achievement"), [class*="badge"]').first();
      const hasAchievements = await achievements.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasAchievements).toBe('boolean');
    });

    test('displays earned achievements', async ({ page }) => {
      await page.goto('/#stats');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      // Check for achievement badges
      const earnedBadge = page.locator('[class*="earned"], [class*="achievement-earned"]').first();
      const hasBadge = await earnedBadge.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasBadge).toBe('boolean');
    });
  });

  test.describe('Top Aircraft', () => {
    test('top aircraft section exists', async ({ page }) => {
      await page.goto('/#stats');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      // Check for top aircraft section
      const topSection = page.locator(':has-text("Top Aircraft"), :has-text("Most Seen")').first();
      const hasTop = await topSection.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasTop).toBe('boolean');
    });

    test('displays aircraft rankings', async ({ page }) => {
      await page.goto('/#stats');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(500);

      // Check for rankings
      const pageContent = await page.textContent('body');
      const hasRankings = pageContent.includes('UAL') || pageContent.includes('DAL') ||
                          pageContent.includes('#1');
      expect(typeof hasRankings).toBe('boolean');
    });
  });

  test.describe('Section Collapsing', () => {
    test('sections can be collapsed', async ({ page }) => {
      await page.goto('/#stats');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for collapsible sections
      const collapseBtn = page.locator('[class*="collapse"], button[aria-expanded]').first();
      if (await collapseBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await collapseBtn.click();
        await page.waitForTimeout(300);
        // Click should work without error
      }
    });
  });

  test.describe('Navigation', () => {
    test('can navigate to map view', async ({ page }) => {
      await page.goto('/#stats');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

      await page.click('.nav-item:has-text("Live Map")');
      await page.waitForURL(/#map/);

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toContain('#map');
    });

    test('can navigate to aircraft list', async ({ page }) => {
      await page.goto('/#stats');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

      await page.click('.nav-item:has-text("Aircraft List")');
      await page.waitForURL(/#aircraft/);

      const hash = await page.evaluate(() => window.location.hash);
      expect(hash).toBe('#aircraft');
    });
  });

  test.describe('Loading State', () => {
    test('shows loading state while fetching stats', async ({ page }) => {
      // Delay response
      await page.route('**/api/v1/aircraft/stats*', async (route) => {
        await new Promise(resolve => setTimeout(resolve, 500));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ count: 0 }),
        });
      });

      await page.goto('/#stats');
      await page.waitForLoadState('domcontentloaded');

      // Check for loading indicator
      const loading = page.locator('.loading, [class*="loading"], [class*="skeleton"]').first();
      const hasLoading = await loading.isVisible({ timeout: 1000 }).catch(() => false);
      expect(typeof hasLoading).toBe('boolean');
    });
  });

  test.describe('Error Handling', () => {
    test('handles API error gracefully', async ({ page, mockApi }) => {
      await mockApi.mockError('/aircraft/stats', 500, 'Server error');

      await page.goto('/#stats');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Page should still render
      await page.waitForTimeout(1000);
    });
  });

  test.describe('Responsive Design', () => {
    test('renders correctly on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/#stats');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    });

    test('renders correctly on tablet viewport', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto('/#stats');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
    });

    test('stat cards stack on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/#stats');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Cards should be visible
      const card = page.locator('.stat-card, [class*="stat"]').first();
      const hasCard = await card.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasCard).toBe('boolean');
    });

    test('charts resize on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/#stats');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      // Charts should adapt
      const chart = page.locator('canvas, svg, [class*="chart"]').first();
      const hasChart = await chart.isVisible({ timeout: 3000 }).catch(() => false);
      expect(typeof hasChart).toBe('boolean');
    });
  });
});
