// @ts-check
import { test } from '../fixtures/doc-test-setup.js';

/**
 * Cannonball Mode Documentation Screenshots
 *
 * The v2 Cannonball HUD (v2/screens/cannonball/CannonballScreen.jsx) is a
 * full-screen `.v2-cb` overlay with a small fixed control set: DRIVE FOCUS,
 * ALERTS, MARK, SCAN and an exit button. The previous spec chased selectors for
 * a separate "radar-display", "threat-cards", "settings" and "radius-selector"
 * that don't exist here — those element captures either produced nothing or
 * duplicated the HUD. We keep the HUD plus one real interaction (SCAN) and the
 * mobile variant.
 */

test.describe('Cannonball Mode Screenshots', () => {
  test.beforeEach(async ({ page, docMockApi, screenshotState }) => {
    await docMockApi.setupAllMocks();
    await screenshotState.setupForScreenshot();
    await page.goto('/#cannonball');
    await page.waitForLoadState('domcontentloaded');
  });

  test('cannonball-hud', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();
    await screenshotHelper.capture('cannonball-hud', {
      description: 'Cannonball heads-up display with speed and threat indicators',
    });
  });

  test('cannonball-scan', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();

    // Trigger a proximity scan to change the HUD state.
    const scan = page.locator('.v2-cb__btn', { hasText: 'SCAN' }).first();
    if (await scan.isVisible()) {
      await scan.click();
      await page.waitForTimeout(600);
    }

    await screenshotHelper.prepare();
    await screenshotHelper.capture('cannonball-scan', {
      description: 'Cannonball scan sweep highlighting nearby aircraft',
    });
  });

  test('cannonball-mobile', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();
    await screenshotHelper.capture('cannonball-mobile-hud', {
      description: 'Mobile-optimized Cannonball HUD',
    });
  });
});
