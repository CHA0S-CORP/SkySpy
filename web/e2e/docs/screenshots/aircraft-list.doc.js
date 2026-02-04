// @ts-check
import { test, expect, docMockData } from '../fixtures/doc-test-setup.js';

/**
 * Aircraft List View Documentation Screenshots
 *
 * Captures:
 * - Aircraft table/list view
 * - Column customization
 * - Sorting and filtering
 * - Detail row expansion
 */

test.describe('Aircraft List Screenshots', () => {
  test.beforeEach(async ({ page, docMockApi,screenshotState }) => {
    await docMockApi.setupAllMocks();
    await screenshotState.setupForScreenshot();

    // Navigate to aircraft list view
    await page.goto('/#aircraft');
    await page.waitForLoadState('domcontentloaded');
  });

  test('aircraft-list-table', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    await screenshotHelper.capture('aircraft-list-table', {
      description: 'Aircraft list table showing tracked aircraft with flight details',
    });
  });

  test('aircraft-list-filters', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Look for filter controls
    const filterInput = page.locator('[placeholder*="Search"], [placeholder*="Filter"], input[type="search"]');
    if (await filterInput.isVisible()) {
      await filterInput.click();
      await filterInput.fill('United');
      await page.waitForTimeout(300);
    }

    await screenshotHelper.capture('aircraft-list-filtered', {
      description: 'Aircraft list with search filter applied',
    });
  });

  test('aircraft-list-sorted', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Click on altitude column header to sort
    const altitudeHeader = page.locator('th:has-text("Altitude"), [data-column="altitude"]');
    if (await altitudeHeader.isVisible()) {
      await altitudeHeader.click();
      await page.waitForTimeout(300);
    }

    await screenshotHelper.capture('aircraft-list-sorted', {
      description: 'Aircraft list sorted by altitude',
    });
  });

  test('aircraft-list-row-expanded', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Click on first row to expand details
    const firstRow = page.locator('tr[data-aircraft], .aircraft-row, tbody tr').first();
    if (await firstRow.isVisible()) {
      await firstRow.click();
      await page.waitForTimeout(300);
    }

    await screenshotHelper.capture('aircraft-list-row-expanded', {
      description: 'Aircraft list with expanded row showing additional details',
    });
  });

  test('aircraft-list-column-menu', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Look for column customization button
    const columnButton = page.locator('[aria-label*="column"], [data-testid="column-settings"], .column-toggle');
    if (await columnButton.isVisible()) {
      await columnButton.click();
      await page.waitForTimeout(300);
    }

    await screenshotHelper.capture('aircraft-list-column-menu', {
      description: 'Column customization menu for aircraft list',
    });
  });

  test('aircraft-list-mobile', async ({ page, screenshotHelper }) => {
    // This test is for mobile viewport - captured via project config
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    await screenshotHelper.capture('aircraft-list-mobile', {
      description: 'Aircraft list in mobile responsive view',
    });
  });
});
