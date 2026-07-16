// @ts-check
/**
 * E2E Tests for Admin Config View
 * Tests the admin configuration page at #admin hash route (AdminConfigView -> ConfigPage).
 * The ConfigPage uses the useSystemConfig hook, which talks to /api/v1/admin/config/.
 */

import { test, expect } from '../fixtures/test-setup.js';

/**
 * Build a mock config payload matching the shape the useSystemConfig hook expects:
 *   { categories: [ { category, category_display, has_changes, configs: [ ... ] } ] }
 */
function buildConfigPayload() {
  return {
    categories: [
      {
        category: 'location',
        category_display: 'Feeder Location',
        has_changes: false,
        configs: [
          {
            key: 'FEEDER_LAT',
            display_name: 'Feeder Latitude',
            value: '37.7749',
            value_type: 'float',
            description: 'Antenna latitude used for distance calculations.',
            requires_restart: false,
            is_sensitive: false,
            is_readonly: false,
            has_env_override: false,
            validation_rules: { min: -90, max: 90 },
            default_value: '0.0',
          },
          {
            key: 'FEEDER_LON',
            display_name: 'Feeder Longitude',
            value: '-122.4194',
            value_type: 'float',
            description: 'Antenna longitude used for distance calculations.',
            requires_restart: false,
            is_sensitive: false,
            is_readonly: false,
            has_env_override: false,
            validation_rules: { min: -180, max: 180 },
            default_value: '0.0',
          },
        ],
      },
      {
        category: 'safety',
        category_display: 'Safety Monitoring',
        has_changes: false,
        configs: [
          {
            key: 'SAFETY_MONITORING_ENABLED',
            display_name: 'Safety Monitoring Enabled',
            value: 'true',
            value_type: 'boolean',
            description: 'Enable emergency squawk and TCAS monitoring.',
            requires_restart: true,
            is_sensitive: false,
            is_readonly: false,
            has_env_override: false,
            validation_rules: {},
            default_value: 'true',
          },
        ],
      },
    ],
  };
}

/**
 * Register a route for the config list endpoint (GET /api/v1/admin/config/).
 * NOTE: a `**` glob is required to match the trailing slash the hook appends;
 * a single-`*` glob (as the shared mockApi.mock helper uses) does not match `/`.
 */
async function routeConfigList(page, { status = 200, body } = {}) {
  await page.route('**/api/v1/admin/config/', async (route) => {
    // Only the collection GET; sub-actions (bulk_update, etc.) have their own paths.
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body ?? buildConfigPayload()),
    });
  });
}

test.describe('Admin Config View', () => {
  test.beforeEach(async ({ page, mockApi }) => {
    await mockApi.mockAuthConfig();
    // Base config endpoint the hook fetches on mount.
    await routeConfigList(page);
  });

  test('renders the configuration page with header and tabs', async ({ page }) => {
    await page.goto('/#admin');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('.view-admin-config')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'System Configuration' })).toBeVisible();
    // Config sub-tabs (scoped to the config tab bar, not the app header gear button).
    await expect(page.locator('.config-tab', { hasText: 'Settings' })).toBeVisible();
    await expect(page.locator('.config-tab', { hasText: 'Audit Log' })).toBeVisible();
  });

  test('displays config categories and fields from mocked data', async ({ page }) => {
    await page.goto('/#admin');
    await page.waitForLoadState('domcontentloaded');

    // Category headers are rendered even when collapsed.
    await expect(page.getByRole('button', { name: /Feeder Location/ })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole('button', { name: /Safety Monitoring/ })).toBeVisible();

    // Each category header shows a settings count.
    await expect(page.locator('.config-category-header:has-text("Feeder Location")')).toContainText(
      '2 settings'
    );

    // Expand the location category to reveal its fields.
    await page.getByRole('button', { name: /Feeder Location/ }).click();
    await expect(page.locator('.config-field-label', { hasText: 'Feeder Latitude' })).toBeVisible();
    await expect(
      page.locator('.config-field-label', { hasText: 'Feeder Longitude' })
    ).toBeVisible();

    // Field input reflects the mocked value.
    const latInput = page.locator('.config-field', { hasText: 'Feeder Latitude' }).locator('input');
    await expect(latInput).toHaveValue('37.7749');
  });

  test('editing a field surfaces the unsaved-change banner and reset control', async ({ page }) => {
    await page.goto('/#admin');
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('button', { name: /Feeder Location/ }).click();

    const latField = page.locator('.config-field', { hasText: 'Feeder Latitude' });
    const latInput = latField.locator('input');
    await expect(latInput).toHaveValue('37.7749');

    await latInput.fill('40.0');

    // Pending-change banner appears in the header.
    await expect(page.locator('.config-pending-banner')).toBeVisible();
    await expect(page.locator('.config-pending-banner')).toContainText('1 unsaved change');
    await expect(page.getByRole('button', { name: 'Save All' })).toBeVisible();

    // The edited field exposes a reset button; discard reverts the change.
    await expect(latField.locator('.config-reset-btn')).toBeVisible();
    await page.getByRole('button', { name: 'Discard' }).click();

    await expect(page.locator('.config-pending-banner')).toHaveCount(0);
    await expect(latInput).toHaveValue('37.7749');
  });

  test('saving pending changes calls the bulk update endpoint', async ({ page, mockApi }) => {
    let bulkUpdateCalled = false;
    await page.route('**/api/v1/admin/config/bulk_update/*', async (route) => {
      bulkUpdateCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ updated: ['FEEDER_LAT'], errors: {}, requires_restart: [] }),
      });
    });

    await page.goto('/#admin');
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('button', { name: /Feeder Location/ }).click();
    const latInput = page
      .locator('.config-field', { hasText: 'Feeder Latitude' })
      .locator('input');
    await latInput.fill('40.0');

    await expect(page.getByRole('button', { name: 'Save All' })).toBeVisible();
    await page.getByRole('button', { name: 'Save All' }).click();

    await expect.poll(() => bulkUpdateCalled, { timeout: 5000 }).toBe(true);
  });

  test('search filters the visible settings', async ({ page }) => {
    await page.goto('/#admin');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByRole('button', { name: /Feeder Location/ })).toBeVisible({
      timeout: 10000,
    });

    await page.getByPlaceholder('Search settings...').fill('Latitude');

    // Only the matching category/field should remain; search auto-expands matches.
    await expect(page.locator('.config-field-label', { hasText: 'Feeder Latitude' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Safety Monitoring/ })).toHaveCount(0);
  });

  test('shows an error state when the config API returns 403', async ({ page }) => {
    // DRF permission-denied shape: { detail: "..." }. parseDRFError surfaces `detail`.
    // Registered after the beforeEach route, so this handler takes precedence.
    await routeConfigList(page, {
      status: 403,
      body: { detail: 'You do not have permission to perform this action.' },
    });

    await page.goto('/#admin');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('.config-page-error')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Failed to load configuration' })).toBeVisible();
    await expect(page.getByText('You do not have permission to perform this action.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Retry/ })).toBeVisible();
  });
});
