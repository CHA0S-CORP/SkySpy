// @ts-check
import { test, expect, docMockData } from '../fixtures/doc-test-setup.js';

/**
 * History Replay Animation Captures
 *
 * Records:
 * - Replay playback controls
 * - Timeline scrubbing
 * - Aircraft track playback
 */

test.describe('History Replay Animations', () => {
  test.beforeEach(async ({ page, docMockApi,screenshotState }) => {
    await docMockApi.setupAllMocks();
    await screenshotState.setupForAnimation();

    // Navigate to history with a session selected
    await page.goto('/#history');
    await page.waitForLoadState('domcontentloaded');
  });

  test('replay-controls', async ({ page, animationHelpers, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();

    // Click on first session to open it
    const sessionRow = page.locator('.session-row, [data-session-id], tr[data-session]').first();
    if (await sessionRow.isVisible()) {
      await sessionRow.click();
      await page.waitForTimeout(500);
    }

    await animationHelpers.startRecording();
    await page.waitForTimeout(1000);

    // Find play button and click
    const playButton = page.locator('button[aria-label*="play"], .play-button, [data-testid="replay-play"]');
    if (await playButton.isVisible()) {
      await playButton.click();
      await page.waitForTimeout(500);
    }

    // Animate replay progress
    await animationHelpers.animateHistoryReplay(6000);

    // Click pause
    const pauseButton = page.locator('button[aria-label*="pause"], .pause-button, [data-testid="replay-pause"]');
    if (await pauseButton.isVisible()) {
      await pauseButton.click();
    }

    await page.waitForTimeout(1500);
    await animationHelpers.stopRecording();
  });

  test('timeline-scrub', async ({ page, animationHelpers, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();

    // Open session
    const sessionRow = page.locator('.session-row, [data-session-id]').first();
    if (await sessionRow.isVisible()) {
      await sessionRow.click();
      await page.waitForTimeout(500);
    }

    await animationHelpers.startRecording();
    await page.waitForTimeout(1000);

    // Find timeline slider
    const timeline = page.locator('[data-testid="timeline-slider"], .timeline-slider, input[type="range"]');

    if (await timeline.isVisible()) {
      const box = await timeline.boundingBox();

      if (box) {
        // Simulate dragging the timeline
        await page.mouse.move(box.x + 10, box.y + box.height / 2);
        await page.mouse.down();

        for (let i = 0; i < 10; i++) {
          await page.mouse.move(box.x + 10 + (box.width - 20) * (i / 10), box.y + box.height / 2);
          await page.waitForTimeout(200);
        }

        await page.mouse.up();
      }
    }

    await page.waitForTimeout(1500);
    await animationHelpers.stopRecording();
  });

  test('track-playback', async ({ page, animationHelpers, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();

    // Navigate to aircraft track view
    const aircraft = docMockData.generateCuratedAircraft()[0];
    await page.goto(`/#aircraft/${aircraft.hex}/track`);
    await page.waitForLoadState('domcontentloaded');

    await screenshotHelper.waitForMapReady();

    await animationHelpers.startRecording();
    await page.waitForTimeout(1000);

    // Simulate track playback
    const trackPoints = 30;
    for (let i = 0; i < trackPoints; i++) {
      const progress = i / trackPoints;

      await page.evaluate(
        ({ lat, lon, progress }) => {
          window.dispatchEvent(
            new CustomEvent('test-track-progress', {
              detail: { lat, lon, progress },
            })
          );
        },
        {
          lat: 37.7749 + progress * 0.1,
          lon: -122.4194 + progress * 0.1,
          progress,
        }
      );

      await page.waitForTimeout(150);
    }

    await page.waitForTimeout(2000);
    await animationHelpers.stopRecording();
  });
});
