// @ts-check
import { test } from '../fixtures/doc-test-setup.js';

/**
 * System View Documentation Screenshots
 *
 * Captures:
 * - System status overview (services banner, health gauges)
 * - Service detail rows lower on the page
 */

test.describe('System View Screenshots', () => {
  test.beforeEach(async ({ page, docMockApi, screenshotState }) => {
    await docMockApi.setupAllMocks();
    await screenshotState.setupForScreenshot();

    await page.goto('/#system');
    await page.waitForLoadState('domcontentloaded');
  });

  test('system-overview', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    await screenshotHelper.capture('system-overview', {
      description: 'System status with services banner and health gauges',
    });
  });

  test('system-services', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(400);

    await screenshotHelper.capture('system-services', {
      description: 'Service status rows with uptime and latency detail',
    });
  });
});
