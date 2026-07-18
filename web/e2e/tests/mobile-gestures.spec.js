// @ts-check
/**
 * E2E Tests for Mobile Layout and Touch Gestures
 *
 * Emulates a phone-sized viewport with touch enabled so the mobile navigation
 * drawer (hamburger toggle + slide-in sidebar) is exercised. CI runs desktop
 * chromium only, so mobile is emulated here via test.use() rather than relying
 * on the mobile-chrome project.
 *
 * At <=768px the app renders a floating `.mobile-menu-toggle` button. Tapping it
 * adds `.mobile-menu-open` to `.app`, reveals the `.mobile-menu-overlay`, and
 * slides in the `.sidebar` containing `.nav-item` buttons. Tapping a nav item
 * switches the active view and closes the drawer.
 */

import { test, expect, mockData } from '../fixtures/test-setup.js';

// Emulate a Pixel-5-class phone with touch input for the whole file.
test.use({
  viewport: { width: 393, height: 851 },
  hasTouch: true,
  isMobile: true,
});

test.describe('Mobile Layout and Gestures', () => {
  test.beforeEach(async ({ mockApi }) => {
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList(mockData.generateAircraft(6));
    await mockApi.mockSystemStatus();
    await mockApi.mockAlertRules(mockData.generateAlertRules(3));
    // Endpoints the shell commonly polls so the app renders cleanly on mobile.
    await mockApi.mock('/system/status', {
      status: 'healthy',
      adsb_online: true,
      location: { lat: 37.7749, lon: -122.4194 },
    });
    await mockApi.mock('/health', { status: 'healthy' });
    await mockApi.mock('/alerts/history', { alerts: [], count: 0 });
  });

  test('mobile layout renders with the hamburger toggle at a small viewport', async ({ page }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // The floating menu toggle is only display:flex under the mobile media query.
    const toggle = page.locator('.mobile-menu-toggle');
    await expect(toggle).toBeVisible({ timeout: 10000 });
    await expect(toggle).toHaveAttribute('aria-label', 'Toggle menu');

    // Drawer starts closed: the app should not carry the open modifier.
    await expect(page.locator('.app')).not.toHaveClass(/mobile-menu-open/);
  });

  test('tapping the hamburger opens the mobile menu drawer and overlay', async ({ page }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    const toggle = page.locator('.mobile-menu-toggle');
    await expect(toggle).toBeVisible({ timeout: 10000 });

    // Touch-open the drawer.
    await toggle.tap();

    // The app gains the open modifier and the dimming overlay appears.
    await expect(page.locator('.app')).toHaveClass(/mobile-menu-open/);
    await expect(page.locator('.mobile-menu-overlay')).toBeVisible();

    // The sidebar with its nav items is now reachable.
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.nav-item').first()).toBeVisible();
  });

  test('tapping the overlay closes the mobile menu drawer', async ({ page }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    const toggle = page.locator('.mobile-menu-toggle');
    await toggle.tap();
    await expect(page.locator('.app')).toHaveClass(/mobile-menu-open/);

    // Tapping the scrim dismisses the drawer.
    await page.locator('.mobile-menu-overlay').tap();
    await expect(page.locator('.app')).not.toHaveClass(/mobile-menu-open/);
    await expect(page.locator('.mobile-menu-overlay')).toHaveCount(0);
  });

  test('tapping a nav item switches the view and closes the drawer', async ({ page }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // Open the drawer, then tap the Alerts nav item.
    await page.locator('.mobile-menu-toggle').tap();
    await expect(page.locator('.app')).toHaveClass(/mobile-menu-open/);

    // On mobile the sidebar is collapsed so nav items render icon-only; the
    // accessible label lives in the title attribute.
    const alertsNav = page.locator('.nav-item[title="Alerts"]');
    await expect(alertsNav).toBeVisible();
    await alertsNav.tap();

    // View switches to alerts and the app reflects it.
    await expect(page.locator('.app')).toHaveClass(/view-alerts/, { timeout: 10000 });
    // Selecting a nav item auto-closes the mobile drawer.
    await expect(page.locator('.app')).not.toHaveClass(/mobile-menu-open/);
  });

  test('the aircraft list is reachable via the mobile menu', async ({ page }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // Open drawer and tap the Aircraft List nav item.
    await page.locator('.mobile-menu-toggle').tap();
    await expect(page.locator('.app')).toHaveClass(/mobile-menu-open/);

    const listNav = page.locator('.nav-item[title="Aircraft List"]');
    await expect(listNav).toBeVisible();
    await listNav.tap();

    // The aircraft list container renders and the drawer closes.
    await expect(page.locator('.app')).toHaveClass(/view-aircraft/, { timeout: 10000 });
    await expect(page.locator('.aircraft-list-container')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.app')).not.toHaveClass(/mobile-menu-open/);
  });

  test('mobile sidebar stats bar exposes the aircraft count and settings', async ({ page }) => {
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

    // Open the drawer to reveal the sidebar (and its mobile stats bar).
    await page.locator('.mobile-menu-toggle').tap();
    await expect(page.locator('.sidebar')).toBeVisible();

    // Mobile-only stats bar with settings affordance.
    const statsBar = page.locator('.mobile-sidebar-stats');
    await expect(statsBar).toBeVisible();
    await expect(statsBar.locator('.mobile-settings-btn')).toBeVisible();
  });
});
