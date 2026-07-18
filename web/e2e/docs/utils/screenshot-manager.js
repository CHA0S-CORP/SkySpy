// @ts-check
import path from 'path';
import fs from 'fs';

/**
 * Screenshot manager for consistent documentation screenshot capture
 *
 * Handles:
 * - Consistent naming conventions
 * - Output organization by viewport
 * - Metadata generation
 * - Element masking
 */

/**
 * @typedef {Object} ScreenshotOptions
 * @property {string} [viewport] - Viewport name (desktop, tablet, mobile)
 * @property {boolean} [fullPage] - Capture full page
 * @property {string[]} [mask] - Selectors to mask
 * @property {string[]} [hide] - Selectors to hide completely
 * @property {Object} [clip] - Clip region
 * @property {string} [description] - Description for metadata
 */

export class ScreenshotManager {
  /**
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    this.page = page;
    this.outputDir = path.join(process.cwd(), 'e2e/docs/output');
    this.metadata = [];
    // Default viewport bucket; the screenshotHelper fixture overrides this with
    // the running Playwright project name (desktop / tablet / mobile) so each
    // viewport lands in its own output directory instead of overwriting desktop.
    this.viewport = 'desktop';
  }

  /**
   * Take a screenshot with consistent settings
   * @param {string} name - Screenshot name (without extension)
   * @param {ScreenshotOptions} options
   */
  async capture(name, options = {}) {
    const {
      viewport = this.viewport,
      fullPage = false,
      mask = [],
      hide = [],
      clip = null,
      description = '',
    } = options;

    // Ensure output directory exists
    const viewportDir = path.join(this.outputDir, viewport);
    if (!fs.existsSync(viewportDir)) {
      fs.mkdirSync(viewportDir, { recursive: true });
    }

    // Apply hiding styles
    if (hide.length > 0) {
      await this.page.addStyleTag({
        content: hide.map((s) => `${s} { display: none !important; }`).join('\n'),
      });
    }

    // Build screenshot options
    const screenshotOptions = {
      path: path.join(viewportDir, `${name}.png`),
      fullPage,
    };

    // Add mask selectors if provided
    if (mask.length > 0) {
      screenshotOptions.mask = mask.map((selector) => this.page.locator(selector));
    }

    // Add clip if provided
    if (clip) {
      screenshotOptions.clip = clip;
    }

    // Take the screenshot
    await this.page.screenshot(screenshotOptions);

    // Record metadata
    this.metadata.push({
      name: `${name}.png`,
      viewport,
      description,
      timestamp: new Date().toISOString(),
      path: screenshotOptions.path,
    });

    return screenshotOptions.path;
  }

  /**
   * Wait for map to be fully rendered with tiles and markers
   * Falls back gracefully if map is not present
   */
  async waitForMapReady() {
    try {
      // Wait for Leaflet container
      await this.page.waitForSelector('.leaflet-container', {
        state: 'visible',
        timeout: 15000,
      });

      // Wait for basemap tiles to actually load. This must NOT be swallowed
      // silently — a blank (tile-less) map is the #1 doc-screenshot defect.
      // Give the CDN generous time, then assert we got a real basemap.
      const tilesLoaded = await this.page
        .waitForFunction(
          () => document.querySelectorAll('.leaflet-tile-loaded').length >= 8,
          { timeout: 30000 }
        )
        .then(() => true)
        .catch(() => false);

      if (!tilesLoaded) {
        const count = await this.page
          .evaluate(() => document.querySelectorAll('.leaflet-tile-loaded').length)
          .catch(() => 0);
        console.warn(
          `[docs] WARNING: basemap tiles did not load (only ${count} tiles) — ` +
            'map screenshot will be blank. Check network access to the tile CDN.'
        );
      }

      // Settle: let tiles paint and markers render.
      await this.page.waitForTimeout(1500);

      // Wait for any loading overlays to disappear
      await this.page
        .waitForSelector('.leaflet-loading', { state: 'hidden', timeout: 5000 })
        .catch(() => {});
    } catch (error) {
      // Map may not be present on this view, continue anyway
      console.log('Map not found or not ready, continuing...');
      await this.page.waitForTimeout(2000);
    }
  }

  /**
   * Wait for page content to be ready
   */
  async waitForContentReady() {
    // Wait for DOM to be ready
    await this.page.waitForLoadState('domcontentloaded');

    // Try to wait for network idle, but don't fail if it takes too long
    await this.page.waitForLoadState('networkidle').catch(() => {});

    // Wait for any loading spinners
    await this.page
      .waitForSelector('[data-loading="true"]', { state: 'hidden', timeout: 5000 })
      .catch(() => {});

    await this.page
      .waitForSelector('.skeleton', { state: 'hidden', timeout: 5000 })
      .catch(() => {});

    // Brief pause for render
    await this.page.waitForTimeout(1000);
  }

  /**
   * Hide dynamic elements that would cause screenshot drift
   * @param {string[]} additionalSelectors - Additional selectors to hide
   */
  async maskDynamicContent(additionalSelectors = []) {
    const selectors = [
      // Time-based elements
      '[data-testid="live-clock"]',
      '[data-testid="timestamp"]',
      '.live-time',
      '.relative-time',

      // Counters that update
      '[data-testid="message-count"]',
      '[data-testid="aircraft-count"]',
      '.live-count',

      // Animations
      '.pulse',
      '.blink',
      '[data-animate]',

      // User-specific content
      '[data-testid="user-avatar"]',
      '.user-name',

      ...additionalSelectors,
    ];

    await this.page.addStyleTag({
      content: selectors
        .map(
          (s) => `
          ${s} {
            visibility: hidden !important;
          }
        `
        )
        .join('\n'),
    });
  }

  /**
   * Capture element screenshot
   * @param {string} selector - Element selector
   * @param {string} name - Screenshot name
   * @param {ScreenshotOptions} options
   */
  async captureElement(selector, name, options = {}) {
    const element = this.page.locator(selector);
    await element.waitFor({ state: 'visible' });

    const viewport = options.viewport || this.viewport;
    const viewportDir = path.join(this.outputDir, viewport);

    if (!fs.existsSync(viewportDir)) {
      fs.mkdirSync(viewportDir, { recursive: true });
    }

    const filePath = path.join(viewportDir, `${name}.png`);
    await element.screenshot({ path: filePath });

    this.metadata.push({
      name: `${name}.png`,
      viewport,
      description: options.description || '',
      timestamp: new Date().toISOString(),
      path: filePath,
      element: selector,
    });

    return filePath;
  }

  /**
   * Get all metadata for captured screenshots
   */
  getMetadata() {
    return this.metadata;
  }

  /**
   * Save metadata to JSON file
   * @param {string} filename
   */
  async saveMetadata(filename = 'screenshots-metadata.json') {
    const metadataPath = path.join(this.outputDir, filename);
    fs.writeFileSync(metadataPath, JSON.stringify(this.metadata, null, 2));
    return metadataPath;
  }

  /**
   * Prepare page for screenshot (common setup)
   */
  async prepare() {
    // Disable animations. NOTE: forcing `transition-duration: 0s` breaks
    // Leaflet's tile fade-in — Leaflet clears the tile's opacity via the
    // `transitionend` event, which never fires when the duration is 0, so tiles
    // get stuck at opacity:0 and the map renders as a blank #ddd container.
    // The `.leaflet-tile` override below keeps the basemap visible.
    await this.page.addStyleTag({
      content: `
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
        }
        .leaflet-tile,
        .leaflet-fade-anim .leaflet-tile,
        .leaflet-fade-anim .leaflet-tile-container {
          opacity: 1 !important;
        }
      `,
    });

    // Hide tooltips
    await this.page.addStyleTag({
      content: `
        [role="tooltip"],
        .tooltip,
        .tippy-box,
        [data-radix-popper-content-wrapper] {
          visibility: hidden !important;
          opacity: 0 !important;
        }
      `,
    });

    // Scroll to top
    await this.page.evaluate(() => window.scrollTo(0, 0));

    await this.maskDynamicContent();
  }
}

/**
 * Get viewport dimensions for a project name
 * @param {string} projectName
 */
export function getViewportDimensions(projectName) {
  const viewports = {
    desktop: { width: 1920, height: 1080 },
    tablet: { width: 810, height: 1080 },
    mobile: { width: 390, height: 844 },
  };

  return viewports[projectName] || viewports.desktop;
}
