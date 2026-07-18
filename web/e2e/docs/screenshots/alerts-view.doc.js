// @ts-check
import { test } from '../fixtures/doc-test-setup.js';

/**
 * Alerts View Documentation Screenshots
 *
 * The v2 Alerts screen (v2/screens/alerts/AlertsScreen.jsx) has a
 * `.v2-alerts__tabs` role="tablist" (Rules / History / Notifications) plus a
 * `[data-testid="v2-alerts-new-rule"]` button that opens the rule builder.
 * Earlier specs guessed selectors ("Add Rule", ".condition-builder",
 * "Test") that don't exist in v2, so those captures no-oped into duplicates of
 * the Rules list. Each capture below drives a real control.
 */

async function openTab(page, label) {
  const tab = page.locator('button.v2-alerts__tab', { hasText: label }).first();
  await tab.click();
  await page.waitForTimeout(700);
}

test.describe('Alerts View Screenshots', () => {
  test.beforeEach(async ({ page, docMockApi, screenshotState }) => {
    await docMockApi.setupAllMocks();
    await screenshotState.setupForScreenshot();
    await page.goto('/#alerts');
    await page.waitForLoadState('domcontentloaded');
  });

  test('alerts-rules-list', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();
    await screenshotHelper.capture('alerts-rules-list', {
      description: 'Alert rules list with priority and status filters',
    });
  });

  test('alerts-rule-builder', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();

    // Open the rule builder via the New Rule button (falls back to the
    // empty-state Create Rule button if the toolbar button is hidden).
    const newRule = page.locator('[data-testid="v2-alerts-new-rule"]');
    if (await newRule.isVisible()) {
      await newRule.click();
    } else {
      await page.locator('.v2-alerts__create').first().click();
    }
    await page.waitForTimeout(600);

    await screenshotHelper.prepare();
    await screenshotHelper.capture('alerts-rule-builder', {
      description: 'Rule builder for creating custom alert conditions',
    });
  });

  test('alerts-history', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await openTab(page, 'History');
    await screenshotHelper.prepare();
    await screenshotHelper.capture('alerts-history', {
      description: 'Alert trigger history showing past notifications',
    });
  });

  test('alerts-notification-settings', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await openTab(page, 'Notifications');
    await screenshotHelper.prepare();
    await screenshotHelper.capture('alerts-notification-settings', {
      description: 'Notification delivery channels and settings',
    });
  });
});
