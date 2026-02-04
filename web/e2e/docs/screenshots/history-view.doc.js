// @ts-check
import { test, expect, docMockData } from '../fixtures/doc-test-setup.js';

/**
 * History View Documentation Screenshots
 *
 * Captures:
 * - Session list
 * - Sighting history
 * - Safety event timeline
 * - Replay controls
 */

test.describe('History View Screenshots', () => {
  test.beforeEach(async ({ page, docMockApi,screenshotState }) => {
    await docMockApi.setupAllMocks();
    await screenshotState.setupForScreenshot();

    // Navigate to history view
    await page.goto('/#history');
    await page.waitForLoadState('domcontentloaded');
  });

  test('history-sessions', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    await screenshotHelper.capture('history-sessions', {
      description: 'Recording session history with statistics',
    });
  });

  test('history-sightings', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Click on sightings tab if available
    const sightingsTab = page.locator('[data-tab="sightings"], button:has-text("Sightings")');
    if (await sightingsTab.isVisible()) {
      await sightingsTab.click();
      await page.waitForTimeout(500);
    }

    await screenshotHelper.capture('history-sightings', {
      description: 'Aircraft sighting history with dates and counts',
    });
  });

  test('history-safety-events', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Click on safety tab if available
    const safetyTab = page.locator('[data-tab="safety"], button:has-text("Safety")');
    if (await safetyTab.isVisible()) {
      await safetyTab.click();
      await page.waitForTimeout(500);
    }

    await screenshotHelper.capture('history-safety-events', {
      description: 'Safety event timeline showing TCAS alerts and deviations',
    });
  });

  test('history-date-picker', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Open date picker
    const datePicker = page.locator('[data-testid="date-picker"], .date-range-picker, input[type="date"]');
    if (await datePicker.isVisible()) {
      await datePicker.click();
      await page.waitForTimeout(300);
    }

    await screenshotHelper.capture('history-date-picker', {
      description: 'Date range picker for filtering history',
    });
  });

  test('history-session-detail', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Click on first session to view details
    const sessionRow = page.locator('.session-row, [data-session-id], tr[data-session]').first();
    if (await sessionRow.isVisible()) {
      await sessionRow.click();
      await page.waitForTimeout(500);
    }

    await screenshotHelper.capture('history-session-detail', {
      description: 'Session detail view with aircraft list and statistics',
    });
  });

  test('history-replay-controls', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Look for replay controls
    const replayControls = page.locator('[data-testid="replay-controls"], .replay-controls');
    if (await replayControls.isVisible()) {
      await screenshotHelper.captureElement('[data-testid="replay-controls"], .replay-controls', 'history-replay-controls', {
        description: 'History replay controls for reviewing past tracking sessions',
      });
    }

    await screenshotHelper.capture('history-with-replay', {
      description: 'History view with replay controls visible',
    });
  });

  test('history-analytics', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Look for analytics panel
    const analytics = page.locator('[data-testid="analytics-panel"], .analytics-panel');
    if (await analytics.isVisible()) {
      await analytics.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
    }

    await screenshotHelper.capture('history-analytics', {
      description: 'History analytics showing patterns and trends',
    });
  });
});
