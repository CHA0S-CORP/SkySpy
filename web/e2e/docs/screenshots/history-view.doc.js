// @ts-check
import { test } from '../fixtures/doc-test-setup.js';

/**
 * History View Documentation Screenshots
 *
 * The v2 History screen (v2/screens/history/HistoryScreen.jsx) is a single page
 * with a `.v2-hist__tabs` role="tablist" bar. Each tab (Sessions / Sightings /
 * ACARS / Safety / NOTAMs / PIREPs / Archive) fetches its own REST endpoint
 * (mocked in doc-test-setup.js) and renders visibly distinct content — so every
 * screenshot below is a real, non-duplicate view. Earlier specs captured
 * "date-picker", "session-detail", "replay" and "analytics" states that do not
 * exist in the v2 UI; those interactions no-oped and produced frames identical
 * to the default Sessions tab, so they were removed.
 */

// Click a History tab by its visible label and let its query resolve.
async function openTab(page, label) {
  const tab = page.locator('button.v2-hist__tab', { hasText: label }).first();
  await tab.click();
  await page.waitForTimeout(900);
}

test.describe('History View Screenshots', () => {
  test.beforeEach(async ({ page, docMockApi, screenshotState }) => {
    await docMockApi.setupAllMocks();
    await screenshotState.setupForScreenshot();
    await page.goto('/#history');
    await page.waitForLoadState('domcontentloaded');
  });

  test('history-sessions', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();
    await screenshotHelper.capture('history-sessions', {
      description: 'Recording session history with per-session statistics',
    });
  });

  test('history-sightings', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await openTab(page, 'Sightings');
    await screenshotHelper.prepare();
    await screenshotHelper.capture('history-sightings', {
      description: 'Aircraft sighting history with dates and counts',
    });
  });

  test('history-acars', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await openTab(page, 'ACARS');
    await screenshotHelper.prepare();
    await screenshotHelper.capture('history-acars', {
      description: 'Decoded ACARS/VDL message log for tracked aircraft',
    });
  });

  test('history-safety-events', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await openTab(page, 'Safety');
    await screenshotHelper.prepare();
    await screenshotHelper.capture('history-safety-events', {
      description: 'Safety event timeline showing TCAS alerts and deviations',
    });
  });

  test('history-notams', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await openTab(page, 'NOTAMs');
    await screenshotHelper.prepare();
    await screenshotHelper.capture('history-notams', {
      description: 'Live NOTAMs & TFRs affecting the coverage area',
    });
  });

  test('history-pireps', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await openTab(page, 'PIREPs');
    await screenshotHelper.prepare();
    await screenshotHelper.capture('history-pireps', {
      description: 'Archived pilot reports (turbulence, icing, sky cover)',
    });
  });

  test('history-archive', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await openTab(page, 'Archive');
    await screenshotHelper.prepare();
    await screenshotHelper.capture('history-archive', {
      description: 'Expired NOTAMs archive with type and date filters',
    });
  });
});
