// @ts-check
import { test, expect, docMockData } from '../fixtures/doc-test-setup.js';

/**
 * Alerts View Documentation Screenshots
 *
 * Captures:
 * - Alert rules list
 * - Rule builder/editor
 * - Alert history
 * - Notification settings
 */

test.describe('Alerts View Screenshots', () => {
  test.beforeEach(async ({ page, docMockApi,screenshotState }) => {
    await docMockApi.setupAllMocks();
    await screenshotState.setupForScreenshot();

    // Navigate to alerts view
    await page.goto('/#alerts');
    await page.waitForLoadState('domcontentloaded');
  });

  test('alerts-rules-list', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    await screenshotHelper.capture('alerts-rules-list', {
      description: 'Alert rules list showing configured notifications',
    });
  });

  test('alerts-rule-card', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Capture individual rule card
    const ruleCard = page.locator('.alert-rule-card, [data-testid="alert-rule"], .rule-card').first();
    if (await ruleCard.isVisible()) {
      await screenshotHelper.captureElement('.alert-rule-card, [data-testid="alert-rule"], .rule-card', 'alerts-rule-card', {
        description: 'Individual alert rule card with conditions and actions',
      });
    }
  });

  test('alerts-rule-builder', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Click add rule button
    const addButton = page.locator('button:has-text("Add Rule"), button:has-text("Create"), [data-testid="add-rule"]');
    if (await addButton.isVisible()) {
      await addButton.click();
      await page.waitForTimeout(500);
    }

    await screenshotHelper.capture('alerts-rule-builder', {
      description: 'Alert rule builder for creating custom notifications',
    });
  });

  test('alerts-condition-builder', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Open rule builder first
    const addButton = page.locator('button:has-text("Add Rule"), button:has-text("Create"), [data-testid="add-rule"]');
    if (await addButton.isVisible()) {
      await addButton.click();
      await page.waitForTimeout(500);

      // Look for condition builder
      const conditionBuilder = page.locator('.condition-builder, [data-testid="condition-builder"]');
      if (await conditionBuilder.isVisible()) {
        await screenshotHelper.captureElement('.condition-builder, [data-testid="condition-builder"]', 'alerts-condition-builder', {
          description: 'Condition builder for specifying alert triggers',
        });
      }
    }

    await screenshotHelper.capture('alerts-condition-form', {
      description: 'Alert condition configuration form',
    });
  });

  test('alerts-history', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Click on history tab if available
    const historyTab = page.locator('[data-tab="history"], button:has-text("History"), [role="tab"]:has-text("History")');
    if (await historyTab.isVisible()) {
      await historyTab.click();
      await page.waitForTimeout(500);
    }

    await screenshotHelper.capture('alerts-history', {
      description: 'Alert trigger history showing past notifications',
    });
  });

  test('alerts-test-modal', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Look for test button on first rule
    const testButton = page.locator('button:has-text("Test"), [data-testid="test-rule"]').first();
    if (await testButton.isVisible()) {
      await testButton.click();
      await page.waitForTimeout(500);
    }

    await screenshotHelper.capture('alerts-test-modal', {
      description: 'Alert rule testing modal with preview',
    });
  });

  test('alerts-notification-settings', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForContentReady();
    await screenshotHelper.prepare();

    // Look for notification settings
    const settingsButton = page.locator('button:has-text("Settings"), [data-testid="notification-settings"]');
    if (await settingsButton.isVisible()) {
      await settingsButton.click();
      await page.waitForTimeout(500);
    }

    await screenshotHelper.capture('alerts-notification-settings', {
      description: 'Notification delivery settings and channels',
    });
  });
});
