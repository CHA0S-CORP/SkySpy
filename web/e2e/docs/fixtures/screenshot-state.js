// @ts-check

/**
 * Screenshot state management for deterministic, reproducible documentation captures
 *
 * Provides utilities to:
 * - Set fixed timestamps for consistent date/time displays
 * - Configure map center and zoom levels
 * - Mask dynamic elements that would cause screenshot drift
 * - Set up consistent UI state (panels open, tabs selected, etc.)
 */

/**
 * Fixed timestamp for all documentation screenshots
 * Set to a specific date/time that looks good in screenshots
 */
export const FIXED_TIMESTAMP = new Date('2024-02-15T14:30:00Z');

/**
 * Fixed location for documentation (San Francisco Bay Area)
 */
export const FIXED_LOCATION = {
  lat: 37.7749,
  lon: -122.4194,
  zoom: 10,
};

/**
 * Create screenshot state manager for a page
 * @param {import('@playwright/test').Page} page
 */
export function screenshotState(page) {
  return {
    /**
     * Set up deterministic time for the page
     * This freezes Date.now() and related functions
     */
    async setFixedTime() {
      await page.addInitScript((timestamp) => {
        const fixedDate = new Date(timestamp);
        const originalNow = Date.now;
        const originalDate = window.Date;

        // Override Date.now()
        Date.now = () => fixedDate.getTime();

        // Override new Date()
        // @ts-ignore
        window.Date = class extends originalDate {
          constructor(...args) {
            if (args.length === 0) {
              super(fixedDate.getTime());
            } else {
              // @ts-ignore
              super(...args);
            }
          }

          static now() {
            return fixedDate.getTime();
          }
        };
      }, FIXED_TIMESTAMP.getTime());
    },

    /**
     * Set up mock geolocation for consistent location
     */
    async setFixedLocation() {
      await page.context().setGeolocation({
        latitude: FIXED_LOCATION.lat,
        longitude: FIXED_LOCATION.lon,
      });
      await page.context().grantPermissions(['geolocation']);
    },

    /**
     * Mask dynamic elements that change between runs
     * @param {string[]} selectors - CSS selectors to mask
     */
    async maskDynamicElements(selectors = []) {
      const defaultSelectors = [
        '[data-testid="live-clock"]',
        '[data-testid="message-count"]',
        '[data-testid="aircraft-count"]',
        '.live-indicator',
        '.pulse-animation',
        '.timestamp-live',
      ];

      const allSelectors = [...defaultSelectors, ...selectors];

      for (const selector of allSelectors) {
        await page.addStyleTag({
          content: `${selector} { visibility: hidden !important; }`,
        });
      }
    },

    /**
     * Hide all tooltips and hover states for clean screenshots
     */
    async hideTooltips() {
      await page.addStyleTag({
        content: `
          [role="tooltip"],
          .tooltip,
          .tippy-box,
          .popover,
          [data-state="open"][data-radix-popper-content-wrapper] {
            visibility: hidden !important;
            opacity: 0 !important;
          }
        `,
      });
    },

    /**
     * Disable all CSS animations for consistent captures
     */
    async disableAnimations() {
      await page.addStyleTag({
        content: `
          *, *::before, *::after {
            animation-duration: 0s !important;
            animation-delay: 0s !important;
            transition-duration: 0s !important;
            transition-delay: 0s !important;
          }
          /* Forcing transitions to 0s stalls Leaflet's tile fade (its
             transitionend handler never fires), leaving tiles at opacity:0 and
             the basemap blank. Keep tiles opaque. */
          .leaflet-tile,
          .leaflet-fade-anim .leaflet-tile,
          .leaflet-fade-anim .leaflet-tile-container {
            opacity: 1 !important;
          }
        `,
      });
    },

    /**
     * Enable animations (for animation captures)
     */
    async enableAnimations() {
      // Remove any animation-disabling styles
      await page.evaluate(() => {
        const styles = document.querySelectorAll('style');
        styles.forEach((style) => {
          if (style.textContent?.includes('animation-duration: 0s')) {
            style.remove();
          }
        });
      });
    },

    /**
     * Wait for map to be fully loaded with tiles and markers
     */
    async waitForMapReady() {
      // Wait for Leaflet container
      await page.waitForSelector('.leaflet-container', { state: 'visible' });

      // Wait for tile layers to load
      await page.waitForFunction(() => {
        const tiles = document.querySelectorAll('.leaflet-tile-loaded');
        return tiles.length > 10; // Ensure multiple tiles loaded
      }, { timeout: 10000 });

      // Wait for aircraft markers if expected
      await page.waitForTimeout(500); // Brief pause for marker rendering
    },

    /**
     * Wait for any loading states to complete
     */
    async waitForLoadingComplete() {
      // Wait for any loading spinners to disappear
      await page.waitForSelector('[data-loading="true"]', { state: 'hidden', timeout: 5000 }).catch(() => {});
      await page.waitForSelector('.loading', { state: 'hidden', timeout: 5000 }).catch(() => {});
      await page.waitForSelector('[aria-busy="true"]', { state: 'hidden', timeout: 5000 }).catch(() => {});

      // Wait for network to be idle
      await page.waitForLoadState('networkidle');
    },

    /**
     * Set up dark mode for screenshots
     * @param {boolean} dark - Whether to use dark mode
     */
    async setDarkMode(dark = true) {
      await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
    },

    /**
     * Complete setup for documentation screenshots
     */
    async setupForScreenshot() {
      await this.setFixedTime();
      await this.setFixedLocation();
      await this.disableAnimations();
      await this.hideTooltips();
      await this.waitForLoadingComplete();
    },

    /**
     * Complete setup for animation captures
     */
    async setupForAnimation() {
      await this.setFixedTime();
      await this.setFixedLocation();
      await this.enableAnimations();
      await this.hideTooltips();
      await this.waitForLoadingComplete();
    },

    /**
     * Center map on a specific location
     * @param {number} lat
     * @param {number} lon
     * @param {number} zoom
     */
    async centerMap(lat = FIXED_LOCATION.lat, lon = FIXED_LOCATION.lon, zoom = FIXED_LOCATION.zoom) {
      await page.evaluate(({ lat, lon, zoom }) => {
        // @ts-ignore
        if (window.map && typeof window.map.setView === 'function') {
          // @ts-ignore
          window.map.setView([lat, lon], zoom);
        }
      }, { lat, lon, zoom });
      await page.waitForTimeout(500);
    },

    /**
     * Scroll to top of page
     */
    async scrollToTop() {
      await page.evaluate(() => window.scrollTo(0, 0));
    },

    /**
     * Close any open modals or dialogs
     */
    async closeModals() {
      // Press Escape to close any open modals
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);

      // Click outside any open dialogs
      await page.click('body', { position: { x: 10, y: 10 }, force: true }).catch(() => {});
    },
  };
}
