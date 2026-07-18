// @ts-check
import { test } from '../fixtures/doc-test-setup.js';

/**
 * Advanced Analytics View Documentation Screenshots
 *
 * The v2 Analytics screen (v2/screens/analytics/AnalyticsScreen.jsx) fits the
 * viewport — there is no lower "geographic" section to scroll to, so the old
 * `scrollTo(bottom)` capture produced a frame identical to the overview. Instead
 * we drive the real Fleet segmented control (All / Civil / Military,
 * role="radio" `.v2-seg__btn`) and the axis selects to produce a genuinely
 * different scatter/correlation view.
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
      description: 'Advanced analytics: scatter explorer and correlation matrix',
    });
  });

  test('analytics-military', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();

    // Filter the fleet to Military and swap the scatter axes so the charts
    // visibly differ from the default overview.
    await page.getByRole('radio', { name: 'Military' }).click();
    await page.waitForTimeout(300);
    const swap = page.locator('.v2-analytics__swap');
    if (await swap.isVisible()) {
      await swap.click();
      await page.waitForTimeout(300);
    }

    await screenshotHelper.prepare();
    await screenshotHelper.capture('analytics-military', {
      description: 'Analytics filtered to the military fleet with swapped axes',
    });
  });
});
