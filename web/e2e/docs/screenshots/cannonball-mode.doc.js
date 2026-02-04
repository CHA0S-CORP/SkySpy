// @ts-check
import { test, expect, docMockData } from '../fixtures/doc-test-setup.js';

/**
 * Cannonball Mode Documentation Screenshots
 *
 * Captures:
 * - Cannonball HUD overview
 * - Radar display
 * - Threat cards
 * - Settings panel
 */

test.describe('Cannonball Mode Screenshots', () => {
  test.beforeEach(async ({ page, docMockApi,screenshotState }) => {
    await docMockApi.setupAllMocks();
    await screenshotState.setupForScreenshot();

    // Navigate to cannonball mode
    await page.goto('/#cannonball');
    await page.waitForLoadState('domcontentloaded');
  });

  test('cannonball-hud', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    await screenshotHelper.capture('cannonball-hud', {
      description: 'Cannonball mode heads-up display with threat indicators',
    });
  });

  test('cannonball-radar', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Capture radar display
    const radar = page.locator('.radar-display, [data-testid="radar"], .cannonball-radar');
    if (await radar.isVisible()) {
      await screenshotHelper.captureElement('.radar-display, [data-testid="radar"], .cannonball-radar', 'cannonball-radar-display', {
        description: 'Radar sweep display showing aircraft positions',
      });
    }

    await screenshotHelper.capture('cannonball-radar-view', {
      description: 'Full radar view with sweep and markers',
    });
  });

  test('cannonball-threats', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Look for threat list
    const threatList = page.locator('.threat-list, [data-testid="threat-cards"], .threats-panel');
    if (await threatList.isVisible()) {
      await screenshotHelper.captureElement('.threat-list, [data-testid="threat-cards"], .threats-panel', 'cannonball-threat-list', {
        description: 'Threat cards showing detected aircraft with urgency levels',
      });
    }
  });

  test('cannonball-threat-critical', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Capture critical threat card
    const criticalThreat = page.locator('[data-threat-level="critical"], .threat-critical, .threat-card.critical');
    if (await criticalThreat.isVisible()) {
      await screenshotHelper.captureElement('[data-threat-level="critical"], .threat-critical, .threat-card.critical', 'cannonball-threat-critical', {
        description: 'Critical threat card showing law enforcement aircraft',
      });
    }
  });

  test('cannonball-settings', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Open settings
    const settingsButton = page.locator('button:has-text("Settings"), [data-testid="cannonball-settings"], .settings-toggle');
    if (await settingsButton.isVisible()) {
      await settingsButton.click();
      await page.waitForTimeout(300);
    }

    await screenshotHelper.capture('cannonball-settings', {
      description: 'Cannonball mode settings for radius and alerts',
    });
  });

  test('cannonball-radius-selector', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Look for radius selector
    const radiusSelector = page.locator('[data-testid="radius-selector"], .radius-control, input[name="radius"]');
    if (await radiusSelector.isVisible()) {
      await screenshotHelper.captureElement('[data-testid="radius-selector"], .radius-control', 'cannonball-radius-selector', {
        description: 'Detection radius configuration control',
      });
    }
  });

  test('cannonball-patterns', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Look for pattern detection panel
    const patterns = page.locator('[data-testid="patterns-panel"], .patterns-detected, .pattern-list');
    if (await patterns.isVisible()) {
      await patterns.scrollIntoViewIfNeeded();
      await screenshotHelper.captureElement('[data-testid="patterns-panel"], .patterns-detected', 'cannonball-patterns', {
        description: 'Detected surveillance patterns (circling, loitering)',
      });
    }
  });

  test('cannonball-alerts-panel', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Look for alerts panel
    const alertsPanel = page.locator('[data-testid="cannonball-alerts"], .cannonball-alerts');
    if (await alertsPanel.isVisible()) {
      await alertsPanel.scrollIntoViewIfNeeded();
      await screenshotHelper.captureElement('[data-testid="cannonball-alerts"], .cannonball-alerts', 'cannonball-alerts-panel', {
        description: 'Cannonball mode alert notifications',
      });
    }
  });

  test('cannonball-mobile', async ({ page, screenshotHelper }) => {
    // Mobile-optimized view
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    await screenshotHelper.capture('cannonball-mobile-hud', {
      description: 'Mobile-optimized Cannonball HUD',
    });
  });
});
