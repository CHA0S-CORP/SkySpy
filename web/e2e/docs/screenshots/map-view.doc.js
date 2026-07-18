// @ts-check
import { test, docMockData } from '../fixtures/doc-test-setup.js';

/**
 * Map View Documentation Screenshots
 *
 * The v2 Live Map (`[data-testid="lm-live-map"]`) is a Leaflet map on a CARTO
 * dark basemap with a toolbar of `.lm__tbtn` buttons:
 *   - lm-filters-btn  (aria "Traffic filters")
 *   - lm-layers-btn   (aria "Map layers")
 *   - aria "Legend" / "Recenter on feeder" / "Fullscreen"
 * waitForMapReady() now asserts the basemap tiles actually loaded, so these are
 * no longer blank-canvas captures.
 */

test.describe('Map View Screenshots', () => {
  test.beforeEach(async ({ page, docMockApi, screenshotState }) => {
    await docMockApi.setupAllMocks();
    await screenshotState.setupForScreenshot();
    await page.goto('/#map');
    await page.waitForLoadState('domcontentloaded');
  });

  test('map-overview', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForMapReady();
    await screenshotHelper.prepare();
    await screenshotHelper.capture('map-overview', {
      description: 'Live map showing aircraft positions over the coverage area',
    });
  });

  test('map-aircraft-popup', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForMapReady();
    await screenshotHelper.prepare();

    // Click a rendered aircraft marker to open its info popup.
    const markers = page.locator('.leaflet-marker-icon, [data-aircraft-hex]');
    if ((await markers.count()) > 0) {
      await markers.first().click({ force: true });
      await page.waitForTimeout(600);
    }

    await screenshotHelper.capture('map-aircraft-popup', {
      description: 'Aircraft popup showing flight details',
    });
  });

  test('map-filters', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForMapReady();

    const btn = page.locator('[data-testid="lm-filters-btn"]');
    if (await btn.isVisible()) {
      await btn.click();
      await page.waitForTimeout(400);
    }

    await screenshotHelper.prepare();
    await screenshotHelper.capture('map-filters', {
      description: 'Traffic filter panel for customizing which aircraft display',
    });
  });

  test('map-overlays', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForMapReady();

    const btn = page.locator('[data-testid="lm-layers-btn"]');
    if (await btn.isVisible()) {
      await btn.click();
      await page.waitForTimeout(400);
    }

    await screenshotHelper.prepare();
    await screenshotHelper.capture('map-overlays', {
      description: 'Map layers panel (weather, airspace, navaids)',
    });
  });

  test('map-legend', async ({ page, screenshotHelper }) => {
    await screenshotHelper.waitForMapReady();

    const btn = page.locator('button[aria-label="Legend"]');
    if (await btn.isVisible()) {
      await btn.click();
      await page.waitForTimeout(400);
    }

    await screenshotHelper.prepare();
    await screenshotHelper.capture('map-legend', {
      description: 'Map legend explaining aircraft categories and markers',
    });
  });

  test('map-with-emergency', async ({ page, screenshotHelper }) => {
    const aircraft = docMockData.generateCuratedAircraft();
    const emergencyAircraft = aircraft.find((a) => a.emergency);
    if (emergencyAircraft) {
      await page.evaluate((hex) => {
        window.dispatchEvent(new CustomEvent('test-highlight-aircraft', { detail: { hex } }));
      }, emergencyAircraft.hex);
    }

    await screenshotHelper.waitForMapReady();
    await screenshotHelper.prepare();
    await screenshotHelper.capture('map-emergency-aircraft', {
      description: 'Map highlighting an emergency squawk (7700) aircraft',
    });
  });
});
