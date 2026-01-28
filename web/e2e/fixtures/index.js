/**
 * E2E Test Fixtures for SkySpy Navigation Tests
 *
 * Provides reusable test fixtures, mock data, and page object helpers
 * for Playwright e2e tests.
 */

import { test as base, expect } from '@playwright/test';
import { mockAircraft, generateManyAircraft, noCallsignAircraft } from './aircraft.js';

// Re-export aircraft fixtures
export { mockAircraft, generateManyAircraft, noCallsignAircraft };

// Re-export map-specific mock data and API handlers
export * from './mockData.js';
export { setupApiHandlers as setupMapApiHandlers, setupWebSocketMock as setupMapWebSocketMock, triggerSafetyEvent } from './apiHandlers.js';

// ============================================================================
// Navigation Tab Configuration
// ============================================================================

/**
 * All navigation tabs available in the sidebar
 * Maps tab id to expected route hash and display label
 */
export const NAVIGATION_TABS = [
  { id: 'map', hash: '#map', label: 'Live Map', icon: 'Radar' },
  { id: 'aircraft', hash: '#aircraft', label: 'Aircraft List', icon: 'Plane' },
  { id: 'stats', hash: '#stats', label: 'Statistics', icon: 'BarChart3' },
  { id: 'history', hash: '#history', label: 'History', icon: 'History' },
  { id: 'audio', hash: '#audio', label: 'Radio', icon: 'Radio' },
  { id: 'notams', hash: '#notams', label: 'NOTAMs', icon: 'FileWarning' },
  { id: 'archive', hash: '#archive', label: 'Archive', icon: 'Archive' },
  { id: 'alerts', hash: '#alerts', label: 'Alerts', icon: 'Bell' },
  { id: 'system', hash: '#system', label: 'System', icon: 'Activity' },
];

// Core tabs requested in the test requirements
export const CORE_TABS = ['map', 'aircraft', 'stats', 'history', 'audio', 'alerts', 'system'];

/**
 * External services links in the sidebar
 */
export const EXTERNAL_SERVICES = [
  { id: 'tar1090', label: 'tar1090', path: '/tar1090/' },
  { id: 'graphs', label: 'Graphs1090', path: '/graphs1090/' },
  { id: 'piaware', label: 'PiAware', path: '/piaware/' },
  { id: 'uat', label: 'UAT 978', path: '/uat/' },
  { id: 'acars', label: 'ACARS', path: '/acars/' },
  { id: 'ais', label: 'AIS', path: '/ais/' },
  { id: 'grafana', label: 'Grafana', path: '/grafana/' },
  { id: 'prometheus', label: 'Prometheus', path: '/prometheus/' },
];

// ============================================================================
// LocalStorage Keys
// ============================================================================

export const STORAGE_KEYS = {
  SIDEBAR_COLLAPSED: 'skyspy-sidebar-collapsed',
  CONFIG: 'skyspy-config',
  PREFERENCES: 'skyspy-preferences',
};

// ============================================================================
// Mock Data
// ============================================================================

export const MOCK_STATS = {
  count: 42,
  total: 1234,
  messages_rate: 156.7,
};

export const MOCK_CONFIG = {
  apiBaseUrl: '',
  mapMode: 'pro',
  mapDarkMode: true,
  browserNotifications: false,
};

// ============================================================================
// Page Object Model - Sidebar
// ============================================================================

/**
 * Sidebar Page Object for interacting with the sidebar component
 */
export class SidebarPage {
  constructor(page) {
    this.page = page;
    this.sidebar = page.locator('.sidebar');
    this.toggleButton = page.locator('.sidebar-toggle');
    this.navItems = page.locator('.sidebar-nav .nav-item');
    this.logo = page.locator('.sidebar-header .logo');
    this.servicesToggle = page.locator('.services-toggle');
    this.servicesList = page.locator('.services-list');
    this.connectionStatus = page.locator('.connection-status, .connection-dot');
    this.footer = page.locator('.sidebar-footer');
  }

  /**
   * Get a specific navigation tab button by id
   */
  getNavItem(tabId) {
    return this.page.locator(`.nav-item`).filter({ hasText: new RegExp(`^${this.getTabLabel(tabId)}$`, 'i') }).first();
  }

  /**
   * Get the label for a tab id
   */
  getTabLabel(tabId) {
    const tab = NAVIGATION_TABS.find(t => t.id === tabId);
    return tab ? tab.label : tabId;
  }

  /**
   * Click on a navigation tab
   */
  async clickTab(tabId) {
    const navItem = this.getNavItem(tabId);
    await navItem.click();
  }

  /**
   * Check if a tab is currently active
   */
  async isTabActive(tabId) {
    const navItem = this.getNavItem(tabId);
    const classes = await navItem.getAttribute('class');
    return classes?.includes('active') || false;
  }

  /**
   * Get the active tab element
   */
  getActiveTab() {
    return this.page.locator('.nav-item.active');
  }

  /**
   * Check if sidebar is collapsed
   */
  async isCollapsed() {
    const classes = await this.sidebar.getAttribute('class');
    return classes?.includes('collapsed') || false;
  }

  /**
   * Collapse the sidebar
   */
  async collapse() {
    if (!(await this.isCollapsed())) {
      await this.toggleButton.click();
    }
  }

  /**
   * Expand the sidebar
   */
  async expand() {
    if (await this.isCollapsed()) {
      await this.toggleButton.click();
    }
  }

  /**
   * Toggle sidebar collapsed state
   */
  async toggle() {
    await this.toggleButton.click();
  }

  /**
   * Expand external services section
   */
  async expandServices() {
    const isExpanded = await this.servicesList.isVisible();
    if (!isExpanded) {
      await this.servicesToggle.click();
    }
  }

  /**
   * Get external service link by id
   */
  getServiceLink(serviceId) {
    const service = EXTERNAL_SERVICES.find(s => s.id === serviceId);
    return this.page.locator('.service-link').filter({ hasText: service?.label || serviceId }).first();
  }

  /**
   * Wait for sidebar to be visible
   */
  async waitForSidebar() {
    await this.sidebar.waitFor({ state: 'visible' });
  }
}

// ============================================================================
// Page Object Model - Header
// ============================================================================

/**
 * Header Page Object for interacting with the header component
 */
export class HeaderPage {
  constructor(page) {
    this.page = page;
    this.header = page.locator('.header');
    this.stats = page.locator('.header-stats');
    this.aircraftCount = page.locator('.stat-item').filter({ hasText: 'Aircraft' });
    this.settingsButton = page.locator('.header-btn').last();
    this.timeDisplay = page.locator('.header-time');
    this.notificationButton = page.locator('.header-btn').first();
  }

  /**
   * Get aircraft count from header
   */
  async getAircraftCount() {
    const text = await this.aircraftCount.locator('.stat-value').textContent();
    return parseInt(text, 10) || 0;
  }

  /**
   * Click settings button to open modal
   */
  async openSettings() {
    await this.settingsButton.click();
  }

  /**
   * Wait for header to be visible
   */
  async waitForHeader() {
    await this.header.waitFor({ state: 'visible' });
  }
}

// ============================================================================
// Page Object Model - Settings Modal
// ============================================================================

/**
 * Settings Modal Page Object
 */
export class SettingsModalPage {
  constructor(page) {
    this.page = page;
    this.modal = page.locator('.modal');
    this.overlay = page.locator('.modal-overlay');
    this.closeButton = page.locator('.modal-header button');
    this.cancelButton = page.locator('.btn-secondary');
    this.saveButton = page.locator('.btn-primary');
    this.apiUrlInput = page.locator('input[placeholder*="origin"]');
    this.mapModeSelect = page.locator('select').first();
    this.mapThemeSelect = page.locator('select').nth(1);
  }

  /**
   * Check if modal is open
   */
  async isOpen() {
    return this.modal.isVisible();
  }

  /**
   * Close modal using X button
   */
  async closeWithButton() {
    await this.closeButton.click();
  }

  /**
   * Close modal using Cancel button
   */
  async cancel() {
    await this.cancelButton.click();
  }

  /**
   * Save settings
   */
  async save() {
    await this.saveButton.click();
  }

  /**
   * Close modal by clicking overlay
   */
  async closeWithOverlay() {
    // Click at the edge of the overlay (outside modal)
    await this.overlay.click({ position: { x: 10, y: 10 } });
  }

  /**
   * Wait for modal to be visible
   */
  async waitForModal() {
    await this.modal.waitFor({ state: 'visible' });
  }

  /**
   * Wait for modal to be hidden
   */
  async waitForModalHidden() {
    await this.modal.waitFor({ state: 'hidden' });
  }
}

// ============================================================================
// Extended Test Fixture
// ============================================================================

/**
 * Extended test fixture with page objects
 */
export const test = base.extend({
  /**
   * Sidebar page object
   */
  sidebarPage: async ({ page }, use) => {
    const sidebarPage = new SidebarPage(page);
    await use(sidebarPage);
  },

  /**
   * Header page object
   */
  headerPage: async ({ page }, use) => {
    const headerPage = new HeaderPage(page);
    await use(headerPage);
  },

  /**
   * Settings modal page object
   */
  settingsModalPage: async ({ page }, use) => {
    const settingsModalPage = new SettingsModalPage(page);
    await use(settingsModalPage);
  },

  /**
   * Pre-configured page with app loaded
   */
  appPage: async ({ page }, use) => {
    // Navigate to app
    await page.goto('/');

    // Wait for app to load
    await page.waitForSelector('.app', { state: 'visible' });

    // Wait for initial navigation to complete
    await page.waitForFunction(() => window.location.hash !== '');

    await use(page);
  },
});

// Re-export expect
export { expect };

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Set localStorage value before page loads
 */
export async function setStorageValue(page, key, value) {
  await page.addInitScript(([k, v]) => {
    localStorage.setItem(k, JSON.stringify(v));
  }, [key, value]);
}

/**
 * Get localStorage value
 */
export async function getStorageValue(page, key) {
  return page.evaluate((k) => {
    const value = localStorage.getItem(k);
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }, key);
}

/**
 * Clear localStorage
 */
export async function clearStorage(page) {
  await page.evaluate(() => localStorage.clear());
}

/**
 * Wait for hash to change to expected value
 */
export async function waitForHash(page, expectedHash) {
  await page.waitForFunction(
    (hash) => window.location.hash === hash,
    expectedHash,
    { timeout: 10000 }
  );
}

/**
 * Get current hash from page
 */
export async function getCurrentHash(page) {
  return page.evaluate(() => window.location.hash);
}

/**
 * Navigate directly to a hash route
 */
export async function navigateToHash(page, hash) {
  await page.goto(`/${hash}`);
}

/**
 * Navigate using browser back button
 */
export async function goBack(page) {
  await page.goBack();
}

/**
 * Navigate using browser forward button
 */
export async function goForward(page) {
  await page.goForward();
}

/**
 * Check if element has specific class
 */
export async function hasClass(locator, className) {
  const classes = await locator.getAttribute('class');
  return classes?.split(' ').includes(className) || false;
}

// ============================================================================
// Page Object Model - Aircraft List
// ============================================================================

/**
 * Aircraft List Page Object for interacting with the aircraft list view
 */
export class AircraftListPage {
  constructor(page) {
    this.page = page;
    this.container = page.locator('.aircraft-list-container');
    this.searchInput = page.locator('.search-box input');
    this.searchClear = page.locator('.search-clear');
    this.toolbar = page.locator('.list-toolbar');
    this.quickFilters = page.locator('.quick-filters');
    this.advancedFilters = page.locator('.advanced-filters');
    this.filterToggle = page.locator('.filter-toggle-btn');
    this.clearFiltersBtn = page.locator('.clear-filters-btn');
    this.viewToggle = page.locator('.al-view-toggle');
    this.densityToggle = page.locator('.al-density-toggle');
    this.columnSelector = page.locator('.al-column-selector');
    this.tableWrapper = page.locator('.aircraft-table-wrapper');
    this.cardGrid = page.locator('.al-card-grid');
    this.emptyMessage = page.locator('.empty-message');
    this.footer = page.locator('.list-footer');
    this.footerStats = page.locator('.footer-stats');
  }

  /**
   * Navigate to aircraft list view
   */
  async goto() {
    await this.page.goto('/#aircraft');
    await this.waitForList();
  }

  /**
   * Wait for the list container to be visible
   */
  async waitForList() {
    await this.container.waitFor({ state: 'visible' });
  }

  /**
   * Get search input value
   */
  async getSearchValue() {
    return this.searchInput.inputValue();
  }

  /**
   * Search for aircraft
   */
  async search(query) {
    await this.searchInput.fill(query);
  }

  /**
   * Clear search
   */
  async clearSearch() {
    if (await this.searchClear.isVisible()) {
      await this.searchClear.click();
    } else {
      await this.searchInput.fill('');
    }
  }

  /**
   * Toggle a quick filter by id
   */
  async toggleQuickFilter(filterId) {
    const chip = this.page.locator(`.quick-filter-chip`).filter({ hasText: new RegExp(filterId, 'i') });
    await chip.click();
  }

  /**
   * Check if a quick filter is active
   */
  async isQuickFilterActive(filterId) {
    const chip = this.page.locator(`.quick-filter-chip`).filter({ hasText: new RegExp(filterId, 'i') });
    const classes = await chip.getAttribute('class');
    return classes?.includes('active') || false;
  }

  /**
   * Open advanced filters panel
   */
  async openAdvancedFilters() {
    if (!(await this.advancedFilters.isVisible())) {
      await this.filterToggle.click();
    }
  }

  /**
   * Close advanced filters panel
   */
  async closeAdvancedFilters() {
    if (await this.advancedFilters.isVisible()) {
      await this.filterToggle.click();
    }
  }

  /**
   * Set altitude range filter
   */
  async setAltitudeRange(min, max) {
    await this.openAdvancedFilters();
    const minInput = this.advancedFilters.locator('.filter-group').first().locator('input').first();
    const maxInput = this.advancedFilters.locator('.filter-group').first().locator('input').last();
    if (min !== undefined) await minInput.fill(String(min));
    if (max !== undefined) await maxInput.fill(String(max));
  }

  /**
   * Set distance range filter
   */
  async setDistanceRange(min, max) {
    await this.openAdvancedFilters();
    const minInput = this.advancedFilters.locator('.filter-group').nth(1).locator('input').first();
    const maxInput = this.advancedFilters.locator('.filter-group').nth(1).locator('input').last();
    if (min !== undefined) await minInput.fill(String(min));
    if (max !== undefined) await maxInput.fill(String(max));
  }

  /**
   * Set speed range filter
   */
  async setSpeedRange(min, max) {
    await this.openAdvancedFilters();
    const minInput = this.advancedFilters.locator('.filter-group').nth(2).locator('input').first();
    const maxInput = this.advancedFilters.locator('.filter-group').nth(2).locator('input').last();
    if (min !== undefined) await minInput.fill(String(min));
    if (max !== undefined) await maxInput.fill(String(max));
  }

  /**
   * Clear all filters
   */
  async clearAllFilters() {
    if (await this.clearFiltersBtn.isVisible()) {
      await this.clearFiltersBtn.click();
    }
  }

  /**
   * Switch to table view
   */
  async switchToTableView() {
    const tableBtn = this.viewToggle.locator('button').first();
    await tableBtn.click();
  }

  /**
   * Switch to card view
   */
  async switchToCardView() {
    const cardBtn = this.viewToggle.locator('button').last();
    await cardBtn.click();
  }

  /**
   * Check if currently in table view
   */
  async isTableView() {
    const classes = await this.container.getAttribute('class');
    return classes?.includes('view-table') || false;
  }

  /**
   * Check if currently in card view
   */
  async isCardView() {
    const classes = await this.container.getAttribute('class');
    return classes?.includes('view-cards') || false;
  }

  /**
   * Set density to compact
   */
  async setCompactDensity() {
    if (await this.densityToggle.isVisible()) {
      const compactBtn = this.densityToggle.locator('button').first();
      await compactBtn.click();
    }
  }

  /**
   * Set density to comfortable
   */
  async setComfortableDensity() {
    if (await this.densityToggle.isVisible()) {
      const comfortableBtn = this.densityToggle.locator('button').last();
      await comfortableBtn.click();
    }
  }

  /**
   * Open column selector dropdown
   */
  async openColumnSelector() {
    const btn = this.columnSelector.locator('.al-column-btn');
    await btn.click();
  }

  /**
   * Toggle column visibility
   */
  async toggleColumn(columnName) {
    await this.openColumnSelector();
    const checkbox = this.page.locator('.al-column-item').filter({ hasText: columnName });
    await checkbox.click();
  }

  /**
   * Select column preset
   */
  async selectColumnPreset(preset) {
    await this.openColumnSelector();
    const presetBtn = this.page.locator('.al-preset-btn').filter({ hasText: preset });
    await presetBtn.click();
  }

  /**
   * Get table header columns
   */
  getTableHeaders() {
    return this.page.locator('.aircraft-table thead th');
  }

  /**
   * Click on a table header to sort
   */
  async clickTableHeader(columnName) {
    const header = this.page.locator('.aircraft-table thead th').filter({ hasText: columnName });
    await header.click();
  }

  /**
   * Get all table rows
   */
  getTableRows() {
    return this.page.locator('.aircraft-table tbody tr, .virtual-list-item tr');
  }

  /**
   * Get a specific table row by index
   */
  getTableRow(index) {
    return this.getTableRows().nth(index);
  }

  /**
   * Get all aircraft cards
   */
  getCards() {
    return this.page.locator('.al-card');
  }

  /**
   * Get a specific card by index
   */
  getCard(index) {
    return this.getCards().nth(index);
  }

  /**
   * Click on an aircraft row to select it
   */
  async clickAircraftRow(index) {
    await this.getTableRow(index).click();
  }

  /**
   * Click on an aircraft card to select it
   */
  async clickAircraftCard(index) {
    await this.getCard(index).click();
  }

  /**
   * Get the displayed aircraft count from footer
   */
  async getDisplayedCount() {
    const statsText = await this.footerStats.locator('.stat-item').first().textContent();
    const match = statsText.match(/(\d+)\s+of\s+(\d+)/);
    if (match) {
      return { filtered: parseInt(match[1], 10), total: parseInt(match[2], 10) };
    }
    return { filtered: 0, total: 0 };
  }

  /**
   * Check if empty state is shown
   */
  async isEmptyStateVisible() {
    return this.emptyMessage.isVisible();
  }

  /**
   * Get the virtual list element
   */
  getVirtualList() {
    return this.page.locator('.virtual-list');
  }

  /**
   * Scroll the virtual list
   */
  async scrollVirtualList(scrollTop) {
    const virtualList = this.getVirtualList();
    await virtualList.evaluate((el, top) => {
      el.scrollTop = top;
    }, scrollTop);
  }

  /**
   * Get the currently visible aircraft hex codes from table
   */
  async getVisibleAircraftHexes() {
    const rows = this.getTableRows();
    const count = await rows.count();
    const hexes = [];
    for (let i = 0; i < count; i++) {
      const cell = rows.nth(i).locator('.icao-cell, td').first();
      const text = await cell.textContent();
      hexes.push(text?.trim());
    }
    return hexes;
  }

  /**
   * Get visible aircraft callsigns from cards
   */
  async getVisibleCardCallsigns() {
    const cards = this.getCards();
    const count = await cards.count();
    const callsigns = [];
    for (let i = 0; i < count; i++) {
      const callsign = cards.nth(i).locator('.al-card-callsign');
      const text = await callsign.textContent();
      callsigns.push(text?.trim());
    }
    return callsigns;
  }

  /**
   * Find aircraft row by ICAO hex
   */
  findRowByHex(hex) {
    return this.page.locator('.aircraft-table tbody tr, .virtual-list-item tr').filter({ hasText: hex });
  }

  /**
   * Find aircraft card by callsign
   */
  findCardByCallsign(callsign) {
    return this.page.locator('.al-card').filter({ hasText: callsign });
  }
}

// ============================================================================
// API Mock Utilities for Aircraft List
// ============================================================================

/**
 * Setup API route mocks for aircraft list testing
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {Object} options - Configuration options
 */
export async function setupAircraftMocks(page, options = {}) {
  const {
    aircraft = mockAircraft,
    delay = 0,
    failOnce = false,
  } = options;

  let requestCount = 0;

  // Mock the aircraft API endpoint
  await page.route('**/api/v1/aircraft**', async (route) => {
    requestCount++;

    if (failOnce && requestCount === 1) {
      await route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'Internal Server Error' }),
      });
      return;
    }

    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ aircraft }),
    });
  });

  // Mock system status endpoint
  await page.route('**/api/v1/system/status**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        aircraft_count: aircraft.length,
        websocket_connections: 5,
        location: {
          lat: 52.3676,
          lon: 4.9041,
          name: 'Amsterdam',
        },
      }),
    });
  });

  return { aircraft };
}

/**
 * Setup WebSocket mock for real-time aircraft updates
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {Object} options - Configuration options
 */
export async function setupWebSocketMock(page, options = {}) {
  const { aircraft = mockAircraft, updateInterval = 1000 } = options;

  await page.addInitScript(({ aircraftData, interval }) => {
    // Mock WebSocket for channels
    class MockWebSocket {
      constructor(url) {
        this.url = url;
        this.readyState = 1; // OPEN
        this.onopen = null;
        this.onmessage = null;
        this.onclose = null;
        this.onerror = null;
        this._subscriptions = new Set();

        setTimeout(() => {
          if (this.onopen) this.onopen({ type: 'open' });
        }, 10);

        // Simulate aircraft updates
        this._interval = setInterval(() => {
          if (this.onmessage && this.readyState === 1 && this._subscriptions.has('aircraft')) {
            this.onmessage({
              data: JSON.stringify({
                type: 'aircraft',
                data: aircraftData,
              }),
            });
          }
        }, interval);
      }

      send(data) {
        const msg = JSON.parse(data);
        if (msg.type === 'subscribe') {
          this._subscriptions.add(msg.channel || 'all');
          // Send initial aircraft data
          if (this.onmessage) {
            setTimeout(() => {
              this.onmessage({
                data: JSON.stringify({
                  type: 'aircraft',
                  data: aircraftData,
                }),
              });
            }, 50);
          }
        }
      }

      close() {
        this.readyState = 3; // CLOSED
        clearInterval(this._interval);
        if (this.onclose) this.onclose({ type: 'close' });
      }
    }

    window.WebSocket = MockWebSocket;
    window.__mockAircraft = aircraftData;
  }, { aircraftData: aircraft, interval: updateInterval });
}

/**
 * Setup empty state mock (no aircraft)
 */
export async function setupEmptyStateMock(page) {
  return setupAircraftMocks(page, { aircraft: [] });
}

/**
 * Setup large dataset mock for virtual scrolling tests
 */
export async function setupLargeDatasetMock(page, count = 100) {
  const aircraft = generateManyAircraft(count);
  return setupAircraftMocks(page, { aircraft });
}

// Add AircraftListPage to the extended test fixture
export const testWithAircraftList = base.extend({
  aircraftListPage: async ({ page }, use) => {
    const aircraftListPage = new AircraftListPage(page);
    await use(aircraftListPage);
  },
});

// ============================================================================
// Alerts Fixtures
// ============================================================================

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const alertsFixtures = require('./alerts.json');

export { alertsFixtures };

// ============================================================================
// Page Object Model - Alerts View
// ============================================================================

/**
 * Alerts Page Object for interacting with the alerts view
 */
export class AlertsPage {
  constructor(page) {
    this.page = page;
    this.container = page.locator('.alerts-container');
    this.tablist = page.locator('[role="tablist"]');
    this.rulesTab = page.getByRole('tab', { name: 'Rules' });
    this.historyTab = page.getByRole('tab', { name: 'History' });
    this.notificationsTab = page.getByRole('tab', { name: 'Notifications' });
    this.newRuleBtn = page.getByRole('button', { name: /New Rule/i });
    this.importBtn = page.getByRole('button', { name: /Import/i });
    this.exportAllBtn = page.getByRole('button', { name: /Export All/i });
    this.searchInput = page.locator('.rules-search input');
    this.priorityFilter = page.locator('select[aria-label="Filter by priority"]');
    this.statusFilter = page.locator('select[aria-label="Filter by status"]');
    this.sortSelect = page.locator('select[aria-label="Sort rules"]');
    this.rulesList = page.locator('.rules-list');
    this.ruleCards = page.locator('.rule-card-enhanced');
    this.rulesCount = page.locator('.rules-count');
    this.emptyState = page.locator('.rules-empty');
    this.ruleForm = page.locator('.rule-form');
    this.importModal = page.locator('.import-modal');
    this.testModal = page.locator('.modal').filter({ hasText: /Test Rule/ });
    this.alertHistory = page.locator('.alert-history');
    this.alertHistoryItems = page.locator('.alert-history-item');
  }

  /**
   * Navigate to alerts view
   */
  async goto() {
    await this.page.goto('/#alerts');
    await this.waitForAlertsView();
  }

  /**
   * Wait for alerts view to be visible
   */
  async waitForAlertsView() {
    await this.container.waitFor({ state: 'visible' });
  }

  /**
   * Get a rule card by name
   */
  getRuleCard(name) {
    return this.ruleCards.filter({ hasText: name });
  }

  /**
   * Get rule card action button
   */
  getRuleAction(ruleName, action) {
    return this.getRuleCard(ruleName).getByRole('button', { name: new RegExp(action, 'i') });
  }

  /**
   * Click on a rule action (Test, Edit, Duplicate, Export, Delete)
   */
  async clickRuleAction(ruleName, action) {
    await this.getRuleAction(ruleName, action).click();
  }

  /**
   * Toggle rule enabled/disabled
   */
  async toggleRule(ruleName) {
    await this.getRuleCard(ruleName).locator('.toggle-btn').click();
  }

  /**
   * Check if rule is enabled
   */
  async isRuleEnabled(ruleName) {
    const toggle = this.getRuleCard(ruleName).locator('.toggle-btn');
    const classes = await toggle.getAttribute('class');
    return classes?.includes('enabled') || false;
  }

  /**
   * Open the create rule form
   */
  async openCreateForm() {
    await this.newRuleBtn.click();
    await this.ruleForm.waitFor({ state: 'visible' });
  }

  /**
   * Open the edit form for a rule
   */
  async openEditForm(ruleName) {
    await this.clickRuleAction(ruleName, 'Edit');
    await this.ruleForm.waitFor({ state: 'visible' });
  }

  /**
   * Close the rule form
   */
  async closeForm() {
    await this.page.getByRole('button', { name: /Close form/i }).click();
    await this.ruleForm.waitFor({ state: 'hidden' });
  }

  /**
   * Fill in rule form fields
   */
  async fillRuleForm(data) {
    if (data.name) {
      await this.page.locator('#rule-name').fill(data.name);
    }
    if (data.severity) {
      await this.page.getByRole('radio', { name: new RegExp(data.severity, 'i') }).check();
    }
    if (data.conditions) {
      for (let i = 0; i < data.conditions.length; i++) {
        const cond = data.conditions[i];
        if (i > 0) {
          await this.page.getByRole('button', { name: /Add Condition/i }).click();
        }
        const row = this.page.locator('.condition-row').nth(i);
        if (cond.type) {
          await row.locator('select').first().selectOption(cond.type);
        }
        if (cond.operator) {
          await row.locator('.operator-select').selectOption(cond.operator);
        }
        if (cond.value) {
          await row.locator('input[type="text"]').fill(cond.value);
        }
      }
    }
    if (data.cooldown !== undefined) {
      await this.page.locator('#cooldown').fill(String(data.cooldown));
    }
    if (data.enabled !== undefined) {
      const checkbox = this.page.locator('#enabled');
      if (data.enabled) {
        await checkbox.check();
      } else {
        await checkbox.uncheck();
      }
    }
  }

  /**
   * Save the rule form
   */
  async saveForm() {
    await this.page.getByRole('button', { name: /Save Rule/i }).click();
    await this.ruleForm.waitFor({ state: 'hidden' });
  }

  /**
   * Delete a rule (handles confirmation dialog)
   */
  async deleteRule(ruleName) {
    this.page.on('dialog', async dialog => {
      await dialog.accept();
    });
    await this.clickRuleAction(ruleName, 'Delete');
  }

  /**
   * Search for rules
   */
  async search(query) {
    await this.searchInput.fill(query);
  }

  /**
   * Clear search
   */
  async clearSearch() {
    await this.searchInput.fill('');
  }

  /**
   * Filter by priority
   */
  async filterByPriority(priority) {
    await this.priorityFilter.selectOption(priority);
  }

  /**
   * Filter by status
   */
  async filterByStatus(status) {
    await this.statusFilter.selectOption(status);
  }

  /**
   * Sort rules
   */
  async sortBy(option) {
    await this.sortSelect.selectOption(option);
  }

  /**
   * Clear all filters
   */
  async clearFilters() {
    if (await this.page.getByRole('button', { name: /Clear Filters/i }).isVisible()) {
      await this.page.getByRole('button', { name: /Clear Filters/i }).click();
    }
  }

  /**
   * Get the displayed rule count
   */
  async getRuleCount() {
    const text = await this.rulesCount.textContent();
    const match = text?.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Switch to History tab
   */
  async goToHistory() {
    await this.historyTab.click();
    await this.alertHistory.waitFor({ state: 'visible' });
  }

  /**
   * Switch to Notifications tab
   */
  async goToNotifications() {
    await this.notificationsTab.click();
  }

  /**
   * Switch to Rules tab
   */
  async goToRules() {
    await this.rulesTab.click();
    await this.rulesList.waitFor({ state: 'visible' });
  }

  /**
   * Acknowledge an alert in history
   */
  async acknowledgeAlert(index = 0) {
    const item = this.alertHistoryItems.nth(index);
    await item.getByRole('button', { name: /Acknowledge/i }).click();
  }

  /**
   * Import rules from file
   */
  async importRules(fileContent, filename = 'import.json') {
    const fileInput = this.page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: filename,
      mimeType: 'application/json',
      buffer: Buffer.from(typeof fileContent === 'string' ? fileContent : JSON.stringify(fileContent)),
    });
    await this.importModal.waitFor({ state: 'visible' });
  }

  /**
   * Confirm import
   */
  async confirmImport() {
    await this.page.getByRole('button', { name: /Import \d+ Rules?/i }).click();
    await this.importModal.waitFor({ state: 'hidden' });
  }

  /**
   * Cancel import
   */
  async cancelImport() {
    await this.importModal.getByRole('button', { name: /Cancel/i }).click();
    await this.importModal.waitFor({ state: 'hidden' });
  }

  /**
   * Test a rule
   */
  async testRule(ruleName) {
    await this.clickRuleAction(ruleName, 'Test');
    await this.testModal.waitFor({ state: 'visible' });
  }

  /**
   * Close test modal
   */
  async closeTestModal() {
    await this.testModal.getByRole('button', { name: /Close/i }).click();
    await this.testModal.waitFor({ state: 'hidden' });
  }
}

// ============================================================================
// Alerts API Mock Utilities
// ============================================================================

/**
 * Setup API route mocks for alerts view testing
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {Object} options - Configuration options
 */
export async function setupAlertsMocks(page, options = {}) {
  const {
    rules = alertsFixtures.rules,
    history = alertsFixtures.history,
    channels = alertsFixtures.channels,
    aircraft = alertsFixtures.aircraft,
  } = options;

  // Track state for dynamic responses
  let currentRules = [...rules];
  let currentHistory = [...history];
  let nextRuleId = Math.max(0, ...rules.map(r => r.id)) + 1;

  // Mock GET/POST /api/v1/alerts/rules
  await page.route('**/api/v1/alerts/rules', async (route) => {
    const method = route.request().method();

    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rules: currentRules }),
      });
    } else if (method === 'POST') {
      const body = JSON.parse(route.request().postData() || '{}');
      const newRule = {
        id: nextRuleId++,
        ...body,
        trigger_count: 0,
        last_triggered: null,
        created_at: new Date().toISOString(),
      };
      currentRules.push(newRule);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(newRule),
      });
    }
  });

  // Mock PATCH/DELETE /api/v1/alerts/rules/:id
  await page.route('**/api/v1/alerts/rules/*', async (route) => {
    const method = route.request().method();
    const url = route.request().url();
    const idMatch = url.match(/\/rules\/(\d+)/);
    const id = idMatch ? parseInt(idMatch[1]) : null;

    if (method === 'PATCH' && id) {
      const body = JSON.parse(route.request().postData() || '{}');
      const index = currentRules.findIndex(r => r.id === id);
      if (index !== -1) {
        currentRules[index] = { ...currentRules[index], ...body };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(currentRules[index]),
        });
      } else {
        await route.fulfill({ status: 404 });
      }
    } else if (method === 'DELETE' && id) {
      currentRules = currentRules.filter(r => r.id !== id);
      await route.fulfill({ status: 204 });
    } else if (method === 'GET' && id) {
      const rule = currentRules.find(r => r.id === id);
      if (rule) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(rule),
        });
      } else {
        await route.fulfill({ status: 404 });
      }
    }
  });

  // Mock GET/PATCH /api/v1/alerts/history
  await page.route('**/api/v1/alerts/history**', async (route) => {
    const method = route.request().method();
    const url = route.request().url();

    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ alerts: currentHistory }),
      });
    } else if (method === 'PATCH') {
      const idMatch = url.match(/\/history\/(\d+)/);
      const id = idMatch ? parseInt(idMatch[1]) : null;
      if (id) {
        const index = currentHistory.findIndex(a => a.id === id);
        if (index !== -1) {
          currentHistory[index] = { ...currentHistory[index], acknowledged: true };
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(currentHistory[index]),
          });
        }
      }
    }
  });

  // Mock GET /api/v1/notifications/channels
  await page.route('**/api/v1/notifications/channels**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ channels }),
    });
  });

  // Mock system status
  await page.route('**/api/v1/system/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        location: { lat: 40.7128, lon: -74.0060 },
        websocket_connections: 5,
      }),
    });
  });

  // Return helpers for test assertions
  return {
    getRules: () => currentRules,
    getHistory: () => currentHistory,
    addRule: (rule) => {
      const newRule = { id: nextRuleId++, ...rule };
      currentRules.push(newRule);
      return newRule;
    },
  };
}

// Add AlertsPage to the extended test fixture
export const testWithAlerts = base.extend({
  alertsPage: async ({ page }, use) => {
    const alertsPage = new AlertsPage(page);
    await use(alertsPage);
  },
});
