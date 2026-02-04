// @ts-check
import { test, expect, docMockData } from '../fixtures/doc-test-setup.js';

/**
 * Map View Documentation Screenshots
 *
 * Captures:
 * - Map overview with aircraft markers
 * - Aircraft popup/tooltip
 * - Map overlays (weather, airspace)
 * - Conflict/safety banner
 */

test.describe('Map View Screenshots', () => {
  test.beforeEach(async ({ page, docMockApi,screenshotState }) => {
    // Set up all mocks
    await docMockApi.setupAllMocks();

    // Prepare page for screenshots
    await screenshotState.setupForScreenshot();

    // Navigate to map view
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
  });

  test('map-overview', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForMapReady();
    await screenshotHelper.prepare();

    await screenshotHelper.capture('map-overview', {
      description: 'Main map view showing aircraft positions and coverage area',
    });
  });

  test('map-aircraft-popup', async ({ page, screenshotHelper,screenshotState }) => {
    await screenshotHelper.waitForMapReady();
    await screenshotHelper.prepare();

    // Click on an aircraft marker to show popup
    // Look for aircraft marker icons
    const markers = page.locator('.leaflet-marker-icon, .aircraft-marker, [data-aircraft-hex]');
    const markerCount = await markers.count();

    if (markerCount > 0) {
      // Click on first visible marker
      await markers.first().click({ force: true });
      await page.waitForTimeout(500);
    }

    await screenshotHelper.capture('map-aircraft-popup', {
      description: 'Aircraft information popup showing flight details',
    });
  });

  test('map-overlays', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForMapReady();
    await screenshotHelper.prepare();

    // Open overlay menu if available
    const overlayButton = page.locator('[data-testid="overlay-menu"], [aria-label*="overlay"], .overlay-toggle');
    if (await overlayButton.isVisible()) {
      await overlayButton.click();
      await page.waitForTimeout(300);
    }

    await screenshotHelper.capture('map-overlays', {
      description: 'Map overlay menu showing available layers',
    });
  });

  test('map-filters', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForMapReady();
    await screenshotHelper.prepare();

    // Open filter menu if available
    const filterButton = page.locator('[data-testid="filter-menu"], [aria-label*="filter"], .filter-toggle');
    if (await filterButton.isVisible()) {
      await filterButton.click();
      await page.waitForTimeout(300);
    }

    await screenshotHelper.capture('map-filters', {
      description: 'Aircraft filter menu for customizing display',
    });
  });

  test('map-with-emergency', async ({ page, screenshotHelper, docMockApi }) => {
    // Re-mock with emergency aircraft emphasized
    const aircraft = docMockData.generateCuratedAircraft();
    const emergencyAircraft = aircraft.find((a) => a.emergency);

    if (emergencyAircraft) {
      // Ensure emergency aircraft is visible
      await page.evaluate((hex) => {
        // Dispatch event to highlight/center on emergency aircraft
        window.dispatchEvent(
          new CustomEvent('test-highlight-aircraft', { detail: { hex } })
        );
      }, emergencyAircraft.hex);
    }

    await screenshotHelper.waitForMapReady();
    await screenshotHelper.prepare();

    await screenshotHelper.capture('map-emergency-aircraft', {
      description: 'Map highlighting emergency squawk (7700) aircraft',
    });
  });

  test('map-controls', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForMapReady();
    await screenshotHelper.prepare();

    // Capture map controls panel
    const controls = page.locator('.map-controls, [data-testid="map-controls"]');
    if (await controls.isVisible()) {
      await screenshotHelper.captureElement('.map-controls, [data-testid="map-controls"]', 'map-controls-panel', {
        description: 'Map control buttons for zoom, center, and settings',
      });
    }

    await screenshotHelper.capture('map-full-controls', {
      description: 'Map view with control panel visible',
    });
  });
});
