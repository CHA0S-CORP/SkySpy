// @ts-check
/**
 * E2E Tests for Map View interactions (extends map.spec.js coverage).
 *
 * Focus: DOM/state-level assertions for MapView.jsx sub-components, NOT canvas
 * pixels. All data is route-mocked; never live backend data.
 *
 * MapView has multiple render modes (src/utils/config.js). Behaviour differs:
 *  - In 'pro' mode the Filter/Layers controls live in the ProSearchBar
 *    (`.pro-header-btn`, they call stopPropagation) and the aircraft list is
 *    hidden by CSS (`.crt-radar-container.pro-mode ~ .radar-aircraft-list`).
 *  - In 'crt' mode the `.radar-aircraft-list` panel is visible and selectable,
 *    and the pro/crt keyboard shortcuts are active.
 * So Filter/Layers panels are exercised in 'pro' mode; the aircraft list and
 * selection are exercised in 'crt' mode. Keyboard shortcuts work in both.
 *
 * The persisted config key is 'adsb-dashboard-config' (utils/config.js).
 */

import { test, expect, mockData } from '../fixtures/test-setup.js';

test.describe('Map Interactions', () => {
  test.beforeEach(async ({ mockApi }) => {
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList(mockData.generateAircraft(6));
    await mockApi.mockSystemStatus();
    await mockApi.mock('/safety/events', { events: [], count: 0 });
    await mockApi.mock('/safety/conflicts', { conflicts: [], count: 0 });
    await mockApi.mock('/acars', { messages: [], count: 0 });
    await mockApi.mock('/airports', { airports: [] });
    await mockApi.mock('/navaids', { navaids: [] });
  });

  /**
   * Navigate to the map in a specific render mode, with the aircraft list
   * forced open. Returns after the sidebar has rendered.
   * @param {import('@playwright/test').Page} page
   * @param {'pro'|'crt'} mode
   */
  async function gotoMap(page, mode) {
    await page.addInitScript((m) => {
      localStorage.setItem('adsb-dashboard-config', JSON.stringify({ mapMode: m }));
      localStorage.setItem('adsb-show-aircraft-list', 'true');
    }, mode);
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 15000 });
  }

  test('Filter control toggles active state and opens the traffic-filter panel', async ({ page }) => {
    await gotoMap(page, 'pro');

    const filterBtn = page.locator('button[title="Traffic Filters"]').first();
    await expect(filterBtn).toBeVisible({ timeout: 10000 });

    // Initially inactive with no panel.
    await expect(filterBtn).not.toHaveClass(/active/);
    await expect(page.locator('.overlay-menu.filter-menu')).toHaveCount(0);

    // Open: button active, panel visible with expected heading.
    await filterBtn.click();
    await expect(filterBtn).toHaveClass(/active/);
    const filterPanel = page.locator('.overlay-menu.filter-menu');
    await expect(filterPanel).toBeVisible();
    await expect(filterPanel).toContainText('Traffic Filters');

    // Close via the button again.
    await filterBtn.click();
    await expect(filterBtn).not.toHaveClass(/active/);
    await expect(page.locator('.overlay-menu.filter-menu')).toHaveCount(0);
  });

  test('Layers control opens the overlay panel and is mutually exclusive with filters', async ({ page }) => {
    await gotoMap(page, 'pro');

    const filterBtn = page.locator('button[title="Traffic Filters"]').first();
    const layersBtn = page.locator('button[title="Map Layers"]').first();
    await expect(layersBtn).toBeVisible({ timeout: 10000 });

    // Open filters first.
    await filterBtn.click();
    await expect(filterBtn).toHaveClass(/active/);

    // Opening Layers closes Filters (mutually exclusive).
    await layersBtn.click();
    await expect(layersBtn).toHaveClass(/active/);
    await expect(filterBtn).not.toHaveClass(/active/);

    const overlayPanel = page.locator('.overlay-menu').filter({ hasText: 'Map Layers' });
    await expect(overlayPanel).toBeVisible();
    await expect(overlayPanel.getByText('Aircraft', { exact: true })).toBeVisible();
  });

  test('aircraft list panel can be hidden and reopened', async ({ page }) => {
    await gotoMap(page, 'crt');

    // The expanded list panel is shown (forced open via localStorage).
    const listPanel = page.locator('.radar-aircraft-list');
    await expect(listPanel).toBeVisible({ timeout: 10000 });
    await expect(listPanel.locator('.aircraft-list-header')).toBeVisible();

    // Hide it via the close (X) button.
    await listPanel.locator('.aircraft-list-close').click();
    await expect(page.locator('.radar-aircraft-list')).toHaveCount(0);

    // The compact "show" button appears; clicking it reopens the panel.
    const showBtn = page.locator('.aircraft-list-show-btn');
    await expect(showBtn).toBeVisible();
    await showBtn.click();
    await expect(page.locator('.radar-aircraft-list')).toBeVisible();
  });

  test('selecting an aircraft from the list opens the selected-aircraft panel', async ({ page }) => {
    await gotoMap(page, 'crt');

    const listPanel = page.locator('.radar-aircraft-list');
    await expect(listPanel).toBeVisible({ timeout: 10000 });

    // The list is populated from the mocked aircraft.
    const firstItem = listPanel.locator('.aircraft-list-item').first();
    await expect(firstItem).toBeVisible();

    // No selected-aircraft popup before selection.
    await expect(page.locator('.aircraft-popup-container')).toHaveCount(0);

    await firstItem.click();

    // Selected-aircraft panel opens; the item is marked selected.
    const popup = page.locator('.aircraft-popup-container');
    await expect(popup).toBeVisible();
    await expect(popup.locator('.aircraft-popup')).toBeVisible();
    await expect(popup.locator('.popup-callsign')).not.toBeEmpty();
    await expect(listPanel.locator('.aircraft-list-item.selected')).toHaveCount(1);

    // Close the popup via its close button.
    await popup.locator('.popup-close').click();
    await expect(page.locator('.aircraft-popup-container')).toHaveCount(0);
  });

  test('keyboard shortcut "?" toggles the keyboard-shortcuts help overlay', async ({ page }) => {
    await gotoMap(page, 'crt');

    // Focus the body (not an input) so the shortcut is not suppressed.
    await page.locator('body').click({ position: { x: 5, y: 5 } });

    await expect(page.locator('.keyboard-help-overlay')).toHaveCount(0);

    await page.keyboard.press('?');
    const help = page.locator('.keyboard-help-overlay');
    await expect(help).toBeVisible();
    await expect(help).toContainText('Keyboard Shortcuts');

    // Toggle back off.
    await page.keyboard.press('?');
    await expect(page.locator('.keyboard-help-overlay')).toHaveCount(0);
  });

  test('keyboard shortcut "i" toggles the session-stats panel', async ({ page }) => {
    await gotoMap(page, 'crt');

    await page.locator('body').click({ position: { x: 5, y: 5 } });

    await expect(page.locator('.session-stats-panel')).toHaveCount(0);

    await page.keyboard.press('i');
    const statsPanel = page.locator('.session-stats-panel');
    await expect(statsPanel).toBeVisible();
    await expect(statsPanel).toContainText('Session Stats');

    await page.keyboard.press('i');
    await expect(page.locator('.session-stats-panel')).toHaveCount(0);
  });
});
