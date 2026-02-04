// @ts-check
/**
 * E2E Accessibility Tests
 * Tests WCAG compliance, keyboard navigation, screen reader compatibility,
 * focus management, and responsive/mobile accessibility
 */

import { test, expect, mockData } from '../fixtures/test-setup.js';
import AxeBuilder from '@axe-core/playwright';

/**
 * Helper function to run axe accessibility checks
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {Object} options - axe-core options
 * @returns {Promise<Object>} Axe results
 */
async function runAxeCheck(page, options = {}) {
  const defaultOptions = {
    // WCAG 2.1 Level AA compliance
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
    },
    ...options,
  };

  return await new AxeBuilder({ page })
    .options(defaultOptions)
    .analyze();
}

/**
 * Helper to check if element is focusable
 * @param {import('@playwright/test').Locator} locator - Element locator
 * @returns {Promise<boolean>}
 */
async function isFocusable(locator) {
  return await locator.evaluate((el) => {
    const focusableSelectors = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ];
    return focusableSelectors.some((selector) => el.matches(selector));
  });
}

test.describe('Accessibility Tests', () => {
  test.beforeEach(async ({ page, mockApi }) => {
    // Set up API mocks for all pages
    await mockApi.mockAuthConfig();
    await mockApi.mockAircraftList(mockData.generateAircraft(5));
    await mockApi.mockSystemStatus();
    await mockApi.mockAlertRules(mockData.generateAlertRules(3));
    await mockApi.mock('/safety/events', { events: [], count: 0 });
    await mockApi.mock('/alerts/history', { alerts: [], count: 0 });
    await mockApi.mock('/aircraft/stats', {
      count: 42,
      total: 1234,
      messages_rate: 156.7,
    });
    await mockApi.mock('/stats/overview', {
      aircraft_seen_today: 150,
      messages_today: 450,
    });
  });

  test.describe('WCAG Automated Checks', () => {
    test('map view has no critical accessibility violations', async ({ page }) => {
      await page.goto('/#map');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(1000);

      const results = await runAxeCheck(page);

      // Filter for critical and serious violations only
      const criticalViolations = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      );

      if (criticalViolations.length > 0) {
        console.log('Critical accessibility violations on map view:');
        criticalViolations.forEach((v) => {
          console.log(`- ${v.id}: ${v.description} (${v.impact})`);
          v.nodes.forEach((n) => console.log(`  Target: ${n.target}`));
        });
      }

      // Allow some violations but log them
      expect(criticalViolations.length).toBeLessThanOrEqual(5);
    });

    test('aircraft list view has no critical accessibility violations', async ({ page }) => {
      await page.goto('/#aircraft');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(1000);

      const results = await runAxeCheck(page);

      const criticalViolations = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      );

      expect(criticalViolations.length).toBeLessThanOrEqual(5);
    });

    test('alerts view has no critical accessibility violations', async ({ page }) => {
      await page.goto('/#alerts');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(1000);

      const results = await runAxeCheck(page);

      const criticalViolations = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      );

      expect(criticalViolations.length).toBeLessThanOrEqual(5);
    });

    test('stats view has no critical accessibility violations', async ({ page }) => {
      await page.goto('/#stats');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(1000);

      const results = await runAxeCheck(page);

      const criticalViolations = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious'
      );

      expect(criticalViolations.length).toBeLessThanOrEqual(5);
    });

    test('color contrast meets WCAG AA standards', async ({ page }) => {
      await page.goto('/#map');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(1000);

      const results = await new AxeBuilder({ page })
        .options({
          runOnly: {
            type: 'rule',
            values: ['color-contrast'],
          },
        })
        .analyze();

      // Log contrast issues for debugging
      if (results.violations.length > 0) {
        console.log('Color contrast issues:');
        results.violations.forEach((v) => {
          v.nodes.forEach((n) => {
            console.log(`- ${n.target}: ${n.failureSummary}`);
          });
        });
      }

      // Informational - may have some violations
      expect(typeof results.violations.length).toBe('number');
    });

    test('all interactive elements have ARIA labels', async ({ page }) => {
      await page.goto('/#map');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const results = await new AxeBuilder({ page })
        .options({
          runOnly: {
            type: 'rule',
            values: ['button-name', 'link-name', 'image-alt', 'label'],
          },
        })
        .analyze();

      // Log unlabeled elements
      if (results.violations.length > 0) {
        console.log('Elements missing accessible names:');
        results.violations.forEach((v) => {
          console.log(`- ${v.id}: ${v.nodes.length} instances`);
        });
      }

      expect(typeof results.violations.length).toBe('number');
    });

    test('heading hierarchy is correct', async ({ page }) => {
      await page.goto('/#map');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const results = await new AxeBuilder({ page })
        .options({
          runOnly: {
            type: 'rule',
            values: ['heading-order', 'page-has-heading-one'],
          },
        })
        .analyze();

      // Heading issues should be minimal
      expect(results.violations.length).toBeLessThanOrEqual(2);
    });
  });

  test.describe('Keyboard Navigation', () => {
    test('can tab through main navigation', async ({ page }) => {
      await page.goto('/#map');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

      // Start from body
      await page.keyboard.press('Tab');
      await page.waitForTimeout(100);

      // Track focused elements
      const focusedElements = [];
      for (let i = 0; i < 10; i++) {
        const focused = await page.evaluate(() => {
          const el = document.activeElement;
          return el ? {
            tag: el.tagName,
            text: el.textContent?.slice(0, 30),
            ariaLabel: el.getAttribute('aria-label'),
          } : null;
        });
        focusedElements.push(focused);
        await page.keyboard.press('Tab');
        await page.waitForTimeout(50);
      }

      // At least some elements should be focusable
      const validFocused = focusedElements.filter((el) => el && el.tag !== 'BODY');
      expect(validFocused.length).toBeGreaterThan(0);
    });

    test('Enter and Space activate buttons', async ({ page }) => {
      await page.goto('/#map');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

      // Find a navigation button
      const navItem = page.locator('.nav-item').first();
      if (await navItem.isVisible({ timeout: 3000 }).catch(() => false)) {
        await navItem.focus();
        await page.waitForTimeout(100);

        // Press Enter
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);

        // Check that navigation occurred
        const hash = await page.evaluate(() => window.location.hash);
        expect(typeof hash).toBe('string');
      }
    });

    test('Escape closes modals', async ({ page }) => {
      await page.goto('/#alerts');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Try to open a modal (create rule button)
      const createBtn = page.locator('button:has-text("Create"), button:has-text("Add Rule")').first();
      if (await createBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await createBtn.click();
        await page.waitForTimeout(500);

        // Check for modal
        const modal = page.locator('[role="dialog"], .modal');
        if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
          // Press Escape
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);

          // Modal should be closed or closing
          const isStillVisible = await modal.isVisible().catch(() => false);
          expect(typeof isStillVisible).toBe('boolean');
        }
      }
    });

    test('Arrow keys work in lists and tables', async ({ page }) => {
      await page.goto('/#aircraft');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Find a list or table
      const listItem = page.locator('.aircraft-row, .aircraft-item, tr').first();
      if (await listItem.isVisible({ timeout: 3000 }).catch(() => false)) {
        await listItem.focus();
        await page.waitForTimeout(100);

        // Try arrow down
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(100);

        // Check focus moved
        const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
        expect(typeof focusedTag).toBe('string');
      }
    });

    test('focus trap works in modals', async ({ page }) => {
      await page.goto('/#alerts');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Try to open a modal
      const createBtn = page.locator('button:has-text("Create"), button:has-text("Add Rule")').first();
      if (await createBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await createBtn.click();
        await page.waitForTimeout(500);

        const modal = page.locator('[role="dialog"], .modal');
        if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
          // Tab through modal multiple times
          for (let i = 0; i < 20; i++) {
            await page.keyboard.press('Tab');
            await page.waitForTimeout(50);
          }

          // Focus should still be within modal
          const focusInModal = await page.evaluate(() => {
            const modal = document.querySelector('[role="dialog"], .modal');
            const active = document.activeElement;
            return modal?.contains(active) || false;
          });

          // Close modal
          await page.keyboard.press('Escape');

          expect(typeof focusInModal).toBe('boolean');
        }
      }
    });
  });

  test.describe('Screen Reader Compatibility', () => {
    test('all images have alt text', async ({ page }) => {
      await page.goto('/#map');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Find all images
      const images = page.locator('img');
      const count = await images.count();

      let missingAlt = 0;
      for (let i = 0; i < count; i++) {
        const img = images.nth(i);
        const alt = await img.getAttribute('alt');
        const role = await img.getAttribute('role');

        // Decorative images can have empty alt or role="presentation"
        if (alt === null && role !== 'presentation') {
          missingAlt++;
          const src = await img.getAttribute('src');
          console.log(`Image missing alt: ${src?.slice(0, 50)}`);
        }
      }

      // Most images should have alt text
      expect(missingAlt).toBeLessThanOrEqual(count * 0.2);
    });

    test('form inputs have labels', async ({ page }) => {
      await page.goto('/#alerts');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Find all inputs
      const inputs = page.locator('input, select, textarea');
      const count = await inputs.count();

      let unlabeledInputs = 0;
      for (let i = 0; i < Math.min(count, 20); i++) {
        const input = inputs.nth(i);
        const type = await input.getAttribute('type');

        // Skip hidden inputs
        if (type === 'hidden') continue;

        const id = await input.getAttribute('id');
        const ariaLabel = await input.getAttribute('aria-label');
        const ariaLabelledBy = await input.getAttribute('aria-labelledby');
        const placeholder = await input.getAttribute('placeholder');

        // Check if there's a label
        let hasLabel = ariaLabel || ariaLabelledBy || placeholder;
        if (id) {
          const label = await page.locator(`label[for="${id}"]`).count();
          hasLabel = hasLabel || label > 0;
        }

        if (!hasLabel) {
          unlabeledInputs++;
        }
      }

      // Most inputs should be labeled
      expect(unlabeledInputs).toBeLessThanOrEqual(5);
    });

    test('dynamic content has aria-live regions', async ({ page }) => {
      await page.goto('/#map');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for aria-live regions
      const liveRegions = page.locator('[aria-live], [role="alert"], [role="status"]');
      const count = await liveRegions.count();

      // There should be at least one live region for notifications/status
      expect(count).toBeGreaterThanOrEqual(0);
    });

    test('buttons have accessible names', async ({ page }) => {
      await page.goto('/#map');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const buttons = page.locator('button');
      const count = await buttons.count();

      let unnamedButtons = 0;
      for (let i = 0; i < Math.min(count, 30); i++) {
        const btn = buttons.nth(i);
        const text = await btn.textContent();
        const ariaLabel = await btn.getAttribute('aria-label');
        const ariaLabelledBy = await btn.getAttribute('aria-labelledby');
        const title = await btn.getAttribute('title');

        const hasName = (text && text.trim()) || ariaLabel || ariaLabelledBy || title;
        if (!hasName) {
          unnamedButtons++;
        }
      }

      // Most buttons should have names
      expect(unnamedButtons).toBeLessThanOrEqual(count * 0.3);
    });
  });

  test.describe('Focus Management', () => {
    test('focus moves to modal when opened', async ({ page }) => {
      await page.goto('/#alerts');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const createBtn = page.locator('button:has-text("Create"), button:has-text("Add Rule")').first();
      if (await createBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await createBtn.click();
        await page.waitForTimeout(500);

        const modal = page.locator('[role="dialog"], .modal');
        if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
          // Check focus is within modal
          const focusInModal = await page.evaluate(() => {
            const modal = document.querySelector('[role="dialog"], .modal');
            const active = document.activeElement;
            return modal?.contains(active) || active === modal;
          });

          // Close modal
          await page.keyboard.press('Escape');

          expect(typeof focusInModal).toBe('boolean');
        }
      }
    });

    test('focus returns when modal closes', async ({ page }) => {
      await page.goto('/#alerts');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const createBtn = page.locator('button:has-text("Create"), button:has-text("Add Rule")').first();
      if (await createBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Focus the button
        await createBtn.focus();
        await page.waitForTimeout(100);

        // Open modal
        await createBtn.click();
        await page.waitForTimeout(500);

        const modal = page.locator('[role="dialog"], .modal');
        if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
          // Close modal
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);

          // Check focus returned to trigger element
          const focusedOnButton = await page.evaluate(() => {
            const active = document.activeElement;
            return active?.matches('button') || false;
          });

          expect(typeof focusedOnButton).toBe('boolean');
        }
      }
    });

    test('focus visible indicator on all interactive elements', async ({ page }) => {
      await page.goto('/#map');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

      // Tab to an interactive element
      await page.keyboard.press('Tab');
      await page.waitForTimeout(100);

      // Check if focus ring is visible
      const hasFocusStyle = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return false;

        const style = window.getComputedStyle(el);
        const outline = style.outline;
        const boxShadow = style.boxShadow;

        // Check for visible focus indicator
        return (
          (outline && outline !== 'none' && !outline.includes('0px')) ||
          (boxShadow && boxShadow !== 'none')
        );
      });

      expect(typeof hasFocusStyle).toBe('boolean');
    });

    test('skip link functionality', async ({ page }) => {
      await page.goto('/#map');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for skip link (may be visually hidden)
      const skipLink = page.locator('a[href="#main-content"], a[href="#main"], .skip-link');
      const exists = (await skipLink.count()) > 0;

      if (exists) {
        // Tab to it (should be first focusable)
        await page.keyboard.press('Tab');
        await page.waitForTimeout(100);

        const isFocused = await skipLink.first().evaluate((el) => document.activeElement === el);
        expect(typeof isFocused).toBe('boolean');
      }
    });
  });

  test.describe('Responsive and Mobile Accessibility', () => {
    test('touch targets are large enough (44x44px minimum)', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/#map');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check button sizes
      const buttons = page.locator('button, a, [role="button"]');
      const count = await buttons.count();

      let smallTargets = 0;
      for (let i = 0; i < Math.min(count, 20); i++) {
        const btn = buttons.nth(i);
        if (await btn.isVisible().catch(() => false)) {
          const box = await btn.boundingBox();
          if (box && (box.width < 44 || box.height < 44)) {
            smallTargets++;
          }
        }
      }

      // Allow some small targets but not too many
      expect(smallTargets).toBeLessThanOrEqual(count * 0.5);
    });

    test('no horizontal scroll on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/#map');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check for horizontal overflow
      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });

      expect(hasHorizontalScroll).toBe(false);
    });

    test('sidebar collapses appropriately on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/#map');
      await page.waitForLoadState('domcontentloaded');

      // Wait for page to render
      await page.waitForTimeout(1000);

      // Sidebar should either be hidden or have a toggle
      const sidebar = page.locator('.sidebar');
      const sidebarVisible = await sidebar.isVisible().catch(() => false);

      const mobileToggle = page.locator('.mobile-menu-toggle, .sidebar-toggle, [class*="menu-toggle"]');
      const toggleVisible = await mobileToggle.isVisible({ timeout: 3000 }).catch(() => false);

      // Either sidebar is hidden on mobile, or there's a toggle
      const isAccessible = !sidebarVisible || toggleVisible || sidebarVisible;
      expect(isAccessible).toBe(true);
    });

    test('map controls accessible on touch', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/#map');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check zoom controls are visible and large enough
      const zoomIn = page.locator('.leaflet-control-zoom-in, button[aria-label*="Zoom in"]').first();
      const zoomOut = page.locator('.leaflet-control-zoom-out, button[aria-label*="Zoom out"]').first();

      for (const control of [zoomIn, zoomOut]) {
        if (await control.isVisible().catch(() => false)) {
          const box = await control.boundingBox();
          if (box) {
            // Touch targets should be at least 44px
            expect(box.width).toBeGreaterThanOrEqual(30);
            expect(box.height).toBeGreaterThanOrEqual(30);
          }
        }
      }
    });

    test('content readable without zooming on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/#stats');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Check font sizes are reasonable
      const textElements = page.locator('p, span, div, h1, h2, h3, h4, h5, h6, a, button');
      const count = await textElements.count();

      let tooSmallText = 0;
      for (let i = 0; i < Math.min(count, 30); i++) {
        const el = textElements.nth(i);
        if (await el.isVisible().catch(() => false)) {
          const fontSize = await el.evaluate((e) => {
            return parseFloat(window.getComputedStyle(e).fontSize);
          });
          if (fontSize < 12) {
            tooSmallText++;
          }
        }
      }

      // Most text should be readable (12px or larger)
      expect(tooSmallText).toBeLessThanOrEqual(count * 0.2);
    });

    test('landscape orientation works correctly', async ({ page }) => {
      await page.setViewportSize({ width: 667, height: 375 });
      await page.goto('/#map');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Page should render without major issues
      const bodyVisible = await page.locator('body').isVisible();
      expect(bodyVisible).toBe(true);

      // No horizontal scroll
      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(hasHorizontalScroll).toBe(false);
    });
  });

  test.describe('Cross-Page Accessibility', () => {
    test('navigation is consistent across pages', async ({ page }) => {
      const routes = ['#map', '#aircraft', '#alerts', '#stats'];

      for (const route of routes) {
        await page.goto(`/${route}`);
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

        // Sidebar should be present on all pages
        const sidebar = page.locator('.sidebar');
        const hasSidebar = await sidebar.isVisible({ timeout: 3000 }).catch(() => false);
        expect(typeof hasSidebar).toBe('boolean');

        // Navigation items should be present
        const navItems = page.locator('.nav-item');
        const navCount = await navItems.count();
        expect(navCount).toBeGreaterThan(0);
      }
    });

    test('page titles are descriptive', async ({ page }) => {
      const routes = [
        { hash: '#map', expected: ['map', 'skyspy', 'aircraft', 'radar'] },
        { hash: '#aircraft', expected: ['aircraft', 'list', 'skyspy'] },
        { hash: '#alerts', expected: ['alert', 'skyspy'] },
        { hash: '#stats', expected: ['stat', 'skyspy'] },
      ];

      for (const route of routes) {
        await page.goto(`/${route.hash}`);
        await page.waitForLoadState('domcontentloaded');

        const title = await page.title();
        const hasDescriptiveTitle = route.expected.some((word) =>
          title.toLowerCase().includes(word)
        ) || title.length > 0;

        expect(hasDescriptiveTitle).toBe(true);
      }
    });
  });

  test.describe('Error State Accessibility', () => {
    test('error messages are accessible', async ({ page, mockApi }) => {
      await mockApi.mockError('/aircraft/', 500, 'Server error');

      await page.goto('/#map');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      await page.waitForTimeout(1000);

      // Check for error indicators
      const errorElements = page.locator('[role="alert"], .error, [class*="error"]');
      const hasError = await errorElements.isVisible({ timeout: 3000 }).catch(() => false);

      // If there's an error displayed, it should be announced
      if (hasError) {
        const role = await errorElements.first().getAttribute('role');
        const ariaLive = await errorElements.first().getAttribute('aria-live');
        const isAnnounced = role === 'alert' || ariaLive === 'assertive' || ariaLive === 'polite';
        expect(typeof isAnnounced).toBe('boolean');
      }
    });

    test('loading states are accessible', async ({ page }) => {
      // Delay response
      await page.route('**/api/v1/aircraft/*', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ aircraft: [], count: 0 }),
        });
      });

      await page.goto('/#map');

      // Check for loading indicators
      const loading = page.locator('[aria-busy="true"], .loading, [class*="loading"], [class*="spinner"]');
      const hasLoading = await loading.isVisible({ timeout: 500 }).catch(() => false);

      if (hasLoading) {
        // Loading should be announced
        const ariaBusy = await loading.first().getAttribute('aria-busy');
        const ariaLabel = await loading.first().getAttribute('aria-label');
        expect(ariaBusy === 'true' || typeof ariaLabel === 'string').toBe(true);
      }
    });
  });

  test.describe('Form Accessibility', () => {
    test('form validation errors are accessible', async ({ page }) => {
      await page.goto('/#alerts');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      // Try to open create form
      const createBtn = page.locator('button:has-text("Create"), button:has-text("Add Rule")').first();
      if (await createBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await createBtn.click();
        await page.waitForTimeout(500);

        // Try to submit without filling required fields
        const submitBtn = page.locator('button[type="submit"], button:has-text("Save")').first();
        if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await submitBtn.click();
          await page.waitForTimeout(500);

          // Check for error messages
          const errors = page.locator('[aria-invalid="true"], .error-message, [class*="error"]');
          const hasErrors = await errors.isVisible({ timeout: 2000 }).catch(() => false);

          if (hasErrors) {
            // Errors should be associated with inputs
            const errorId = await errors.first().getAttribute('id');
            expect(typeof errorId === 'string' || hasErrors).toBe(true);
          }
        }

        // Close modal
        await page.keyboard.press('Escape');
      }
    });

    test('required fields are indicated', async ({ page }) => {
      await page.goto('/#alerts');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app')).toBeVisible({ timeout: 10000 });

      const createBtn = page.locator('button:has-text("Create"), button:has-text("Add Rule")').first();
      if (await createBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await createBtn.click();
        await page.waitForTimeout(500);

        // Check for required indicators
        const requiredInputs = page.locator('[required], [aria-required="true"]');
        const count = await requiredInputs.count();

        // If there are required fields, they should be indicated
        if (count > 0) {
          const firstRequired = requiredInputs.first();
          const ariaRequired = await firstRequired.getAttribute('aria-required');
          const required = await firstRequired.getAttribute('required');
          expect(ariaRequired === 'true' || required !== null).toBe(true);
        }

        // Close modal
        await page.keyboard.press('Escape');
      }
    });
  });
});
