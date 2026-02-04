// @ts-check
import { test, expect, docMockData } from '../fixtures/doc-test-setup.js';

/**
 * Stats View Documentation Screenshots
 *
 * Captures:
 * - Stats dashboard overview
 * - Individual chart types
 * - Metric cards
 * - Time range selector
 */

test.describe('Stats View Screenshots', () => {
  test.beforeEach(async ({ page, docMockApi,screenshotState }) => {
    await docMockApi.setupAllMocks();
    await screenshotState.setupForScreenshot();

    // Navigate to stats view
    await page.goto('/#stats');
    await page.waitForLoadState('domcontentloaded');
  });

  test('stats-dashboard', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    await screenshotHelper.capture('stats-dashboard', {
      description: 'Statistics dashboard with key metrics and charts',
    });
  });

  test('stats-cards', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Capture stats cards section
    const statsCards = page.locator('.stats-cards, [data-testid="stats-cards"], .metric-cards');
    if (await statsCards.isVisible()) {
      await screenshotHelper.captureElement('.stats-cards, [data-testid="stats-cards"], .metric-cards', 'stats-metric-cards', {
        description: 'Key metric cards showing daily and weekly statistics',
      });
    }

    await screenshotHelper.capture('stats-cards-overview', {
      description: 'Statistics cards with key performance metrics',
    });
  });

  test('stats-charts', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Scroll to charts section
    const chartsSection = page.locator('.charts-section, [data-testid="stats-charts"]');
    if (await chartsSection.isVisible()) {
      await chartsSection.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
    }

    await screenshotHelper.capture('stats-charts', {
      description: 'Statistics charts showing trends and distributions',
    });
  });

  test('stats-time-range', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Click on time range selector
    const timeRange = page.locator('[data-testid="time-range"], .time-range-selector, select[name*="range"]');
    if (await timeRange.isVisible()) {
      await timeRange.click();
      await page.waitForTimeout(300);
    }

    await screenshotHelper.capture('stats-time-range', {
      description: 'Time range selector for statistics period',
    });
  });

  test('stats-top-aircraft', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Look for top aircraft section
    const topAircraft = page.locator('[data-testid="top-aircraft"], .top-aircraft-types');
    if (await topAircraft.isVisible()) {
      await topAircraft.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
    }

    await screenshotHelper.capture('stats-top-aircraft', {
      description: 'Top aircraft types and operators statistics',
    });
  });

  test('stats-coverage', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Look for coverage section
    const coverage = page.locator('[data-testid="coverage-stats"], .coverage-section');
    if (await coverage.isVisible()) {
      await coverage.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
    }

    await screenshotHelper.capture('stats-coverage', {
      description: 'Receiver coverage and performance statistics',
    });
  });
});
