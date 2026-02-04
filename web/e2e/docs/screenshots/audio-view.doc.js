// @ts-check
import { test, expect, docMockData } from '../fixtures/doc-test-setup.js';

/**
 * Audio View Documentation Screenshots
 *
 * Captures:
 * - Audio transmission list
 * - Frequency filters
 * - Playback controls
 * - Transcript display
 */

test.describe('Audio View Screenshots', () => {
  test.beforeEach(async ({ page, docMockApi,screenshotState }) => {
    await docMockApi.setupAllMocks();
    await screenshotState.setupForScreenshot();

    // Navigate to audio view
    await page.goto('/#audio');
    await page.waitForLoadState('domcontentloaded');
  });

  test('audio-list', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    await screenshotHelper.capture('audio-list', {
      description: 'Audio transmission list showing recorded ATC communications',
    });
  });

  test('audio-item', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Capture individual audio item
    const audioItem = page.locator('.audio-item, [data-testid="audio-transmission"], .transmission-row').first();
    if (await audioItem.isVisible()) {
      await screenshotHelper.captureElement('.audio-item, [data-testid="audio-transmission"], .transmission-row', 'audio-item-card', {
        description: 'Individual audio transmission with frequency and transcript',
      });
    }
  });

  test('audio-filters', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Open filter panel
    const filterButton = page.locator('[data-testid="audio-filters"], button:has-text("Filter"), .filter-toggle');
    if (await filterButton.isVisible()) {
      await filterButton.click();
      await page.waitForTimeout(300);
    }

    await screenshotHelper.capture('audio-filters', {
      description: 'Audio filter controls for frequency and time range',
    });
  });

  test('audio-playback', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Click play on first audio item
    const playButton = page.locator('button[aria-label*="play"], .play-button, [data-testid="play-audio"]').first();
    if (await playButton.isVisible()) {
      await playButton.click();
      await page.waitForTimeout(300);
    }

    await screenshotHelper.capture('audio-playback', {
      description: 'Audio playback controls and waveform display',
    });
  });

  test('audio-transcript', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Look for expanded transcript
    const audioItem = page.locator('.audio-item, [data-testid="audio-transmission"]').first();
    if (await audioItem.isVisible()) {
      await audioItem.click();
      await page.waitForTimeout(500);
    }

    await screenshotHelper.capture('audio-transcript', {
      description: 'Audio transmission with expanded transcript',
    });
  });

  test('audio-emergency', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Look for emergency transmission
    const emergencyItem = page.locator('[data-emergency="true"], .emergency-transmission, .audio-item.critical');
    if (await emergencyItem.isVisible()) {
      await emergencyItem.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
    }

    await screenshotHelper.capture('audio-emergency', {
      description: 'Emergency audio transmission highlighted',
    });
  });

  test('audio-stats', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Look for stats bar
    const statsBar = page.locator('[data-testid="audio-stats"], .audio-stats-bar');
    if (await statsBar.isVisible()) {
      await screenshotHelper.captureElement('[data-testid="audio-stats"], .audio-stats-bar', 'audio-stats-bar', {
        description: 'Audio statistics bar showing reception metrics',
      });
    }

    await screenshotHelper.capture('audio-with-stats', {
      description: 'Audio view with statistics summary',
    });
  });
});
