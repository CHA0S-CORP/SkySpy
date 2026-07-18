// @ts-check
import { test } from '../fixtures/doc-test-setup.js';

/**
 * Admin Config View Documentation Screenshots
 *
 * Captures the runtime admin configuration screen.
 */

test.describe('Admin View Screenshots', () => {
  test.beforeEach(async ({ page, docMockApi, screenshotState }) => {
    await docMockApi.setupAllMocks();
    await screenshotState.setupForScreenshot();

    await page.goto('/#admin');
    await page.waitForLoadState('domcontentloaded');
  });

  test('admin-overview', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();

    // Expand the config categories so the settings are visible in the capture.
    const expandAll = page.getByText('Expand All', { exact: true });
    if (await expandAll.isVisible().catch(() => false)) {
      await expandAll.click();
      await page.waitForTimeout(300);
    }

    await screenshotHelper.prepare();

    await screenshotHelper.capture('admin-overview', {
      description: 'Admin configuration screen for runtime feature settings',
    });
  });
});
