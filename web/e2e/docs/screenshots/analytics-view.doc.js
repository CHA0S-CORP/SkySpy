// @ts-check
import { test } from '../fixtures/doc-test-setup.js';

/**
 * Advanced Analytics View Documentation Screenshots
 *
 * Captures:
 * - Analytics dashboard overview (scatter explorer + correlation matrix)
 * - Geographic + flight-pattern panels
 */

test.describe('Analytics View Screenshots', () => {
  test.beforeEach(async ({ page, docMockApi, screenshotState }) => {
    await docMockApi.setupAllMocks();
    await screenshotState.setupForScreenshot();

    await page.goto('/#analytics');
    await page.waitForLoadState('domcontentloaded');
  });

  test('analytics-overview', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    await screenshotHelper.capture('analytics-overview', {
      description: 'Advanced analytics with scatter explorer and correlation matrix',
    });
  });

  test('analytics-geographic', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Scroll to the geographic / flight-pattern panels lower on the page
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(400);

    await screenshotHelper.capture('analytics-geographic', {
      description: 'Geographic breakdown, busiest hours and flight-pattern panels',
    });
  });
});
