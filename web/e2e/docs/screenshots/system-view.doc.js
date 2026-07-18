// @ts-check
import { test } from '../fixtures/doc-test-setup.js';

/**
 * System View Documentation Screenshots
 *
 * The v2 System screen (v2/screens/system/SystemScreen.jsx) fits the viewport,
 * so the old `scrollTo(bottom)` "services" capture was byte-identical to the
 * overview. The service rows are `.v2-sys__service` buttons that expand an
 * inline detail panel on click — that gives a genuinely different second shot.
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

    // Expand the first service row to reveal uptime/latency detail.
    const svc = page.locator('.v2-sys__service').first();
    if (await svc.isVisible()) {
      await svc.click();
      await page.waitForTimeout(400);
    }

    await screenshotHelper.prepare();
    await screenshotHelper.capture('system-services', {
      description: 'Expanded service row with uptime and latency detail',
    });
  });
});
