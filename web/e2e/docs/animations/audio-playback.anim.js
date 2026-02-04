// @ts-check
import { test, expect, docMockData } from '../fixtures/doc-test-setup.js';

/**
 * Audio Playback Animation Captures
 *
 * Records:
 * - Audio waveform playback
 * - Transmission stream updates
 * - Playback controls interaction
 */

test.describe('Audio Playback Animations', () => {
  test.beforeEach(async ({ page, docMockApi,screenshotState }) => {
    await docMockApi.setupAllMocks();
    await screenshotState.setupForAnimation();

    await page.goto('/#audio');
    await page.waitForLoadState('domcontentloaded');
  });

  test('audio-playback-controls', async ({ page, animationHelpers, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();

    await animationHelpers.startRecording();
    await page.waitForTimeout(1000);

    // Find and click play on first audio item
    const playButton = page.locator('button[aria-label*="play"], .play-button').first();

    if (await playButton.isVisible()) {
      await playButton.click();
      await page.waitForTimeout(500);

      // Animate playback progress
      await animationHelpers.animateAudioPlayback(4000);

      // Click pause
      const pauseButton = page.locator('button[aria-label*="pause"], .pause-button').first();
      if (await pauseButton.isVisible()) {
        await pauseButton.click();
      }
    }

    await page.waitForTimeout(1500);
    await animationHelpers.stopRecording();
  });

  test('transmission-stream', async ({ page, animationHelpers, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();

    await animationHelpers.startRecording();
    await page.waitForTimeout(1000);

    // Simulate new transmissions arriving
    const transmissions = docMockData.generateCuratedAudioTransmissions();

    for (let i = 0; i < 5; i++) {
      await page.evaluate(
        (transmission) => {
          window.dispatchEvent(
            new CustomEvent('test-new-transmission', {
              detail: {
                ...transmission,
                id: Date.now(),
                timestamp: new Date().toISOString(),
              },
            })
          );
        },
        {
          ...transmissions[i % transmissions.length],
          frequency: 118.0 + Math.random() * 5,
          duration_seconds: 3 + Math.random() * 8,
        }
      );

      await page.waitForTimeout(1500);
    }

    await page.waitForTimeout(2000);
    await animationHelpers.stopRecording();
  });

  test('frequency-filter', async ({ page, animationHelpers, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();

    await animationHelpers.startRecording();
    await page.waitForTimeout(1000);

    // Open filter panel
    const filterButton = page.locator('[data-testid="audio-filters"], button:has-text("Filter")');
    if (await filterButton.isVisible()) {
      await filterButton.click();
      await page.waitForTimeout(500);

      // Select different frequencies
      const freqOptions = page.locator('.frequency-option, [data-frequency], input[name="frequency"]');
      const count = await freqOptions.count();

      for (let i = 0; i < Math.min(count, 3); i++) {
        await freqOptions.nth(i).click();
        await page.waitForTimeout(800);
      }
    }

    await page.waitForTimeout(1500);
    await animationHelpers.stopRecording();
  });

  test('waveform-visualization', async ({ page, animationHelpers, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();

    // Expand first audio item to show waveform
    const audioItem = page.locator('.audio-item, [data-testid="audio-transmission"]').first();
    if (await audioItem.isVisible()) {
      await audioItem.click();
      await page.waitForTimeout(500);
    }

    await animationHelpers.startRecording();
    await page.waitForTimeout(500);

    // Start playback
    const playButton = page.locator('button[aria-label*="play"], .play-button').first();
    if (await playButton.isVisible()) {
      await playButton.click();

      // Simulate waveform progress
      for (let i = 0; i < 50; i++) {
        await page.evaluate((progress) => {
          window.dispatchEvent(
            new CustomEvent('test-waveform-progress', {
              detail: { progress },
            })
          );
        }, i / 50);

        await page.waitForTimeout(100);
      }
    }

    await page.waitForTimeout(1500);
    await animationHelpers.stopRecording();
  });
});
