// @ts-check
import { test } from '../fixtures/doc-test-setup.js';

/**
 * Audio (Radio) View Documentation Screenshots
 *
 * The v2 Radio screen (components/v2/screens/radio/RadioScreen.jsx) renders the
 * `/api/v1/audio` feed with a search box, Status/Channel selects, an Emergency
 * toggle (`.v2-radio__emerg`) and time-range buttons (`.v2-radio__range`).
 * Earlier specs guessed selectors (".play-button", ".audio-item") that don't
 * exist, so all six audio captures collapsed to the same (empty) list. We now
 * capture the populated list and the Emergency-filtered view.
 */

test.describe('Audio View Screenshots', () => {
  test.beforeEach(async ({ page, docMockApi, screenshotState }) => {
    await docMockApi.setupAllMocks();
    await screenshotState.setupForScreenshot();
    await page.goto('/#audio');
    await page.waitForLoadState('domcontentloaded');
  });

  test('audio-list', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();
    await screenshotHelper.capture('audio-list', {
      description: 'Recorded ATC transmissions with transcripts and frequencies',
    });
  });

  test('audio-emergency', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();

    // Toggle the Emergency filter to isolate MAYDAY / urgency traffic.
    const emerg = page.locator('.v2-radio__emerg').first();
    if (await emerg.isVisible()) {
      await emerg.click();
      await page.waitForTimeout(400);
    }

    await screenshotHelper.prepare();
    await screenshotHelper.capture('audio-emergency', {
      description: 'Radio feed filtered to emergency transmissions',
    });
  });
});
